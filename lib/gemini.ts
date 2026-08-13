import { request } from "https";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Scene } from "./types";
import type { ReferenceImage } from "./characters";

// Primární model: gemini-3.1-flash-image ($0.067 ≈ 1,55 Kč/obrázek) — v2.81
// vráceno z levnějšího 2.5 (0,90 Kč): kreslil méně konzistentně a sklouzával
// do 3D renderu. Přebít jde přes GEMINI_IMAGE_MODEL_PRIMARY.
const IMAGE_MODEL = (process.env.GEMINI_IMAGE_MODEL_PRIMARY || process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image").trim();
// Záložní obrázkový model — denní kvóta (limit 1000/den) platí NA MODEL,
// takže když primární narazí na strop, druhý model jede dál.
// .trim() — hodnota ve Vercelu může mít omylem vložený newline na konci.
const FALLBACK_RAW = (process.env.GEMINI_IMAGE_MODEL_FALLBACK || "gemini-2.5-flash-image").trim();
const FALLBACK_IMAGE_MODEL = FALLBACK_RAW !== IMAGE_MODEL ? FALLBACK_RAW : "gemini-2.5-flash-image";
const SANITIZE_MODEL = "gemini-2.0-flash"; // fast text model — sanitizes its own image model's prompt
// Vizuální kontrola desatera — silnější vision model (přepsatelný env proměnnou)
const VERIFY_MODEL = (process.env.GEMINI_VERIFY_MODEL || "gemini-2.5-flash").trim();

// Denní kvóta / vyčerpaný kredit / měsíční rozpočtový strop — okamžité
// opakování je zbytečné (reset až o půlnoci PT / po dobití / po ručním
// zvednutí stropu). Joby na tuto chybu musí přestat pálit pokusy.
export function isDailyQuotaError(msg: string): boolean {
  return /per_day|per day|requests_per_model|credits are depleted|QUOTA_DAILY|spending cap|spend cap/i.test(msg);
}

/** Vyčerpaný PŘEDPLACENÝ kredit (nevyprší o půlnoci — je třeba dobít v AI Studio) */
export function isCreditsDepletedError(msg: string): boolean {
  return /credits are depleted|prepayment/i.test(msg);
}

/** Měsíční ROZPOČTOVÝ STROP (spend cap) na projektu Gemini API — JINÁ věc
 *  než kredit: platba do Google Cloud Billing ho NEZVEDNE (to je jiný účet/
 *  jiná položka), strop se musí zvednout ručně v AI Studio (Usage & billing
 *  → Spend limit na https://aistudio.google.com/). */
export function isSpendCapError(msg: string): boolean {
  return /spending cap|spend cap/i.test(msg);
}

export interface ImageResult {
  buffer: Buffer;
  mimeType: string;
}

// 💰 Počítadlo SKUTEČNĚ vygenerovaných obrázků (včetně QA překreslení a
// portrétů) pro přesné účtování: 1K sólo vs. 4K archy se platí jinak.
// Volající si před prací vezme snímek a po práci zapíše rozdíl.
// 🩺 2026-08-11: bývalo to plochá modulová proměnná — na Vercel Fluid Compute
// (viz Knowledge Updates: sdílí teplé instance mezi SOUBĚŽNÝMI requesty)
// se tak při 2 pohádkách generovaných zároveň (appka to sama umožňuje,
// MAX_ACTIVE_JOBS=2) míchaly obrázky JEDNÉ pohádky do účtu DRUHÉ — živý
// test (6str. + 12str. najednou) zapsal do usage logu identické `images:10`
// pro obě, ačkoli měly 6 a 12 (resp. 11 dokreslených) scén. AsyncLocalStorage
// dá každému běhu job-runneru (runWithGenCounter) VLASTNÍ počítadlo, co
// žije jen v jeho vlastním async řetězu — souběžné requesty na stejné teplé
// instanci se už nepletou, žádná změna signatur volání napříč gemini.ts.
const genCounterStore = new AsyncLocalStorage<{ img1k: number; img4k: number }>();
// Fallback pro volání MIMO runWithGenCounter (staré skripty/testy) — sdílený
// jako dřív, ať appka nepadá, jen v tomhle případě není žádná izolace.
const fallbackGenCounter = { img1k: 0, img4k: 0 };
export function getGenCounter(): { img1k: number; img4k: number } {
  return genCounterStore.getStore() ?? fallbackGenCounter;
}
/** Obal na CELÝ běh jednoho jobu/requestu — every Gemini image call uvnitř
 *  fn() (i přes await/Promise.all) uvidí stejné, izolované počítadlo. */
export function runWithGenCounter<T>(fn: () => Promise<T>): Promise<T> {
  return genCounterStore.run({ img1k: 0, img4k: 0 }, fn);
}

// Gemini vrací obrázky jako PNG (~1,5 MB na scénu) — 15stránková pohádka
// pak má 25 MB+. WebP v plném rozlišení knížky je ~5× menší bez viditelné
// ztráty; šetří úložiště, stahování do telefonu i posílání pohádky.
async function compressImage(img: ImageResult): Promise<ImageResult> {
  try {
    const sharp = (await import("sharp")).default;
    const buf = await sharp(img.buffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    if (buf.length < img.buffer.length) {
      console.log(`[Gemini] compress ${Math.round(img.buffer.length / 1024)} kB → ${Math.round(buf.length / 1024)} kB`);
      return { buffer: buf, mimeType: "image/webp" };
    }
  } catch (e) {
    console.warn("[Gemini] compress failed, keeping original:", e instanceof Error ? e.message : e);
  }
  return img;
}

type GeminiCandidate = {
  content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
  finishReason?: string;
  safetyRatings?: Array<{ category: string; probability: string; blocked?: boolean }>;
};

// ⏱ Bez timeoutu se hen (žádná odpověď, ani chyba) hangla klidně 25+ minut —
// celý job pak stál a do 📋 deníku se nezapsalo vůbec nic (nebylo co logovat,
// promise nikdy nedospěla k resolve ani reject). req.setTimeout je NEČINNOSTNÍ
// limit (žádná data po tuto dobu) — destroy(err) vyvolá "error" a promise
// se rejectne, takže existující retry/backoff/fallback logika převezme řízení.
// Dva different stropy: kreslení (4K archy legitimně trvají déle) vs. textové
// volání (sanitizace/QA kontrola vrací pár vět JSON — nemá důvod běžet skoro
// tak dlouho jako samotné kreslení; 90 s tu jen zbytečně natahovalo worst-case
// jedné scény, když se ověření muselo opakovat).
const GEMINI_IMAGE_TIMEOUT_MS = 60_000;
const GEMINI_TEXT_TIMEOUT_MS = 45_000;
const GEMINI_VERIFY_TIMEOUT_MS = 30_000;

function geminiPost(apiKey: string, model: string, body: object, timeoutMs = GEMINI_TEXT_TIMEOUT_MS): Promise<string> {
  const bodyBuf = Buffer.from(JSON.stringify(body), "utf-8");
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "generativelanguage.googleapis.com", path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": bodyBuf.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Gemini request timed out after ${timeoutMs / 1000}s (no response)`));
    });
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// Step 1: Ask Gemini text model to sanitize the prompt so it passes the image model's own safety filter.
// Gemini knows its own safety rules best — it rewrites the prompt itself.
async function sanitizeWithGemini(apiKey: string, rawPrompt: string): Promise<string> {
  try {
    const raw = await geminiPost(apiKey, SANITIZE_MODEL, {
      contents: [{
        role: "user",
        parts: [{
          text: [
            "You are a prompt sanitizer for Gemini image generation of children's fairy tale illustrations.",
            "Rewrite the following prompt so it passes Gemini's content safety filter without losing visual detail.",
            "",
            "Rules:",
            "- Remove all age numbers: '6-year-old', '6 years old', 'toddler', 'infant', Czech: 'letý', 'let', 'roků'",
            "- KEEP relative height/size comparisons between characters (e.g. 'the smallest', 'reaches his waist', 'slightly taller than', 'much taller') — these are allowed and important for consistency",
            "- Replace any element that would show readable text in the image (signs with writing, open books showing text, newspapers with headlines, shop labels, posters with words, billboards) with a purely visual alternative (e.g. 'a colorful sign' instead of 'a sign saying Welcome', 'a closed storybook' instead of 'a book with text')",
            "- Keep ALL character names, hair color/style, eye color, clothing colors and types, scene action, and the style suffix UNCHANGED",
            "- NEVER shorten, summarize or drop ANY character description — every character entry in the APPEARANCE LOCK must appear in full in the output, including invented creatures, 'Key objects:', 'Story outfits:' and 'Heights:' entries",
            "- Output ONLY the rewritten prompt — no explanation, no quotes, no markdown",
            "",
            "Prompt:",
            rawPrompt,
          ].join("\n"),
        }],
      }],
      // Dost prostoru pro CELÝ zámek vzhledu — nízký strop ořezával popisy
      // vymyšlených postav na konci (jednou blond, podruhé hnědé vlasy)
      generationConfig: { maxOutputTokens: 2500 },
    });

    const data = JSON.parse(raw) as { candidates?: GeminiCandidate[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    // Výrazně kratší výstup = model zámek vzhledu zkrátil (ořezané postavy)
    // → radši bezpečný regex fallback nad plným promptem
    if (text && text.length > rawPrompt.length * 0.55) {
      console.log(`[Gemini sanitize] ${rawPrompt.length} chars → ${text.length} chars`);
      return text;
    }
    if (text) console.warn(`[Gemini sanitize] output too short (${text.length}/${rawPrompt.length} chars) — using regex fallback`);
  } catch (e) {
    console.warn("[Gemini sanitize] text model failed, using regex fallback:", e instanceof Error ? e.message : e);
  }
  return regexSanitize(rawPrompt);
}

// Regex fallback if the text model call fails
function regexSanitize(text: string): string {
  return text
    .replace(/\b\d+\s*[-–]\s*year[s]?\s*[-–]\s*old\b/gi, "")
    .replace(/\b\d+\s+years?\s+old\b/gi, "")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[-–]?\s*years?\s*[-–]?\s*old\b/gi, "")
    .replace(/\bage[d]?\s*\d+\b/gi, "")
    .replace(/\(\s*\d+[^)]*\)/gi, "")
    .replace(/\b\d+let[a-záčďéěíňóřšťúůýž]*\b/gi, "")
    .replace(/\b\d+\s+let\b/gi, "")
    .replace(/\b\d+\s+rok[ůuy]?\b/gi, "")
    .replace(/\btoddler\b/gi, "child")
    .replace(/\binfant\b/gi, "child")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ")
    .trim();
}

// Step 2: Call Gemini image model with the sanitized prompt (+ reference photos)
function callGeminiImage(apiKey: string, model: string, prompt: string, aspect: string | null = "16:9", refImages: ReferenceImage[] = [], imageSize?: string): Promise<ImageResult> {
  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE", "TEXT"] };
  // Uniform aspect ratio (16:9 scenes, 9:16 app backgrounds); null = model default
  // imageSize "4K" — archy scén (víc scén v jednom obrázku, pak se rozřežou)
  if (aspect) generationConfig.imageConfig = { aspectRatio: aspect, ...(imageSize ? { imageSize } : {}) };
  // Reference photos go first, each labeled with the character's name,
  // so Gemini can match the likeness when drawing the stylized scene
  const parts: Array<Record<string, unknown>> = [];
  for (const ref of refImages) {
    parts.push({ text: ref.label || `Reference photo of ${ref.name || "a story character"} (match this person's/animal's likeness):` });
    parts.push({ inlineData: { data: ref.data, mimeType: ref.mimeType } });
  }
  if (refImages.length > 0) {
    parts.push({ text: "Draw the characters so they are clearly recognizable as the people/animals in the reference photos above — same face shape, hair color and style, eye color, build, AGE and body size — but rendered in the illustration style described below. Keep every character's age and size true to their photo in every scene. Do NOT copy the photos' backgrounds or clothing unless the prompt says so." });
  }
  parts.push({ text: prompt });
  const bodyBuf = Buffer.from(
    JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig,
    }),
    "utf-8"
  );
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "generativelanguage.googleapis.com", path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": bodyBuf.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gemini ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }
          let data: { candidates?: GeminiCandidate[]; promptFeedback?: { blockReason?: string } };
          try { data = JSON.parse(text); }
          catch { reject(new Error("Gemini JSON parse error: " + text.slice(0, 200))); return; }

          if (data.promptFeedback?.blockReason) {
            reject(new Error(`Gemini BLOCKED: ${data.promptFeedback.blockReason}`));
            return;
          }
          for (const cand of data.candidates || []) {
            for (const part of cand.content?.parts || []) {
              if (part.inlineData?.data) {
                // 💰 skutečně vygenerovaný (placený) obrázek
                if (imageSize === "4K") getGenCounter().img4k += 1; else getGenCounter().img1k += 1;
                resolve({ buffer: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType || "image/png" });
                return;
              }
            }
          }
          const reasons = (data.candidates || []).map(c => {
            const blocked = c.safetyRatings?.filter(r => r.blocked || r.probability === "HIGH" || r.probability === "MEDIUM").map(r => `${r.category}:${r.probability}`);
            return `finishReason=${c.finishReason ?? "?"}${blocked?.length ? " blocked=[" + blocked.join(",") + "]" : ""}`;
          }).join(" | ");
          reject(new Error(`NO_IMAGE: ${reasons || "no candidates"}`));
        });
        res.on("error", reject);
      }
    );
    // ⏱ Bez timeoutu se hen (žádná odpověď) hangla klidně 25+ minut — job
    // stál a do 📋 deníku se nezapsalo nic, protože ta promise nikdy nedospěla
    // k resolve ani reject. destroy(err) vyvolá "error" → existující retry/
    // backoff/model-fallback logika v generateSceneImage převezme řízení.
    req.setTimeout(GEMINI_IMAGE_TIMEOUT_MS, () => {
      req.destroy(new Error(`Gemini request timed out after ${GEMINI_IMAGE_TIMEOUT_MS / 1000}s (no response)`));
    });
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// ── Vision QA: kontrola desatera na KAŽDÉM obrázku ─────────────────────────
// Běží na SERVERU, takže platí pro všechna zařízení a všechny cesty generování.
// Odolnost: až 2 pokusy o samotnou kontrolu (výpadek/429 kontrolu neumlčí),
// JSON režim + dostatečný limit tokenů (utržená odpověď dřív prošla jako „ok").
// Vrací null, jen když se kontrola ani na 2. pokus nepovedla — volající pak
// NEPŘEPISUJE poslední ověřený stav neověřeným obrázkem.
// deadline: když čas na TENTO běh dochází, kontrola se rovnou vzdá (žádné
// další čekání/pokusy) — dřív mohla sama o sobě natáhnout jednu scénu o
// stovky sekund a připravit ji tak o šanci na bezpečné předání štafety.
/** Závažnost jednoho nálezu vizuální kontroly. */
export type QaSeverity = "MINOR" | "MODERATE" | "MAJOR";
/** Co s obrázkem udělat: přijmout / cíleně doeditovat / překreslit celý. */
export type QaAction = "ACCEPT" | "EDIT" | "REDRAW";

export interface QaFinding {
  rule: number;
  severity: QaSeverity;
  problem: string;
  /** Cílená instrukce pro editaci ("change her eye color to brown"). */
  fix?: string;
  /** Lze to spravit editací detailu, nebo je potřeba celý obrázek znovu? */
  fixable?: boolean;
  /** Co MĚLO být (podle kanonické karty) — u barev slouží k určení rodiny. */
  expected?: string;
  /** Co je NAKRESLENO. */
  observed?: string;
  /** Čeho se nález týká („eye color", „hair", „head size"). */
  attribute?: string;
  /** U měřítka: naměřená odchylka poměru velikosti hlav v procentech. */
  deviationPct?: number;
}

export interface QaVerdict {
  /** Nic, co by se mělo řešit (žádný MODERATE/MAJOR nález). */
  ok: boolean;
  action: QaAction;
  /** Souhrn pro log (zachováno kvůli starším voláním). */
  problems: string;
  /** Počet nálezů, na které se reaguje — porovnávací metrika „nejlepší pokus". */
  badRules: number;
  findings: QaFinding[];
  /** Spojené instrukce pro editaci vadných detailů. */
  fixInstruction: string;
}

// 🚧 Pravidla, u kterých je EDITACE nespolehlivá → vždy překreslit celý obrázek:
// styl (0), tělesné měřítko (7), rámování/ořez (11), prostředí (12) a hlavně
// podoba dítěte podle referenční fotky (13) — obličej skutečného dítěte se
// nikdy „nedoedituje k podobě", to je cesta ke znetvoření.
const REDRAW_ONLY_RULES = new Set([0, 7, 11, 12, 13]);

// 📏 Tolerance měřítka postav (poměr velikosti hlav vůči kánonu).
// Naměřeno na reálných bězích: dobrý obrázek s kanonickou referencí se od
// kánonu liší ~9 %, samotný šum měření graderu je ±3–5 % — pásmo 10 % by tedy
// zamítalo prokazatelně správné obrázky. 15 % je nejtěsnější hodnota, která
// spolehlivě propustí správné a zachytí skutečný rozjezd proporcí.
const HEAD_RATIO_TOLERANCE_PCT = 15;

// 🎨 Rodiny barev — POŘADÍ je významné: sousední položky jsou v malované
// ilustraci prakticky nerozlišitelné (a mění je i samotné osvětlení), skok
// o dvě a víc rodin je skutečná chyba. Rozhodování o závažnosti barev drží
// KÓD, ne grader: v testu tentýž nález („hnědé vs. oříškové oči") dostal na
// jedné scéně MINOR a na jiné MAJOR, což znamenalo placené přemalování
// za rozdíl, který se v knize nepozná.
const EYE_FAMILIES = [
  ["blue", "modr"], ["grey", "gray", "šed", "sed"], ["green", "zelen"],
  ["hazel", "amber", "oříšk", "orisk", "jantar"], ["brown", "hněd", "hned"],
  ["dark brown", "black", "čern", "cern"],
];
const HAIR_FAMILIES = [
  ["platinum", "blond", "golden", "flaxen", "plavé", "plave"],
  ["ginger", "red", "auburn", "zrzav", "kaštan", "kastan", "ryšav"],
  ["brown", "brunette", "hněd", "hned"],
  ["black", "raven", "čern", "cern"],
];

/** Do které rodiny barva patří (−1 = nerozpoznáno). */
function familyIndex(families: string[][], text: string): number {
  const low = text.toLowerCase();
  let best = -1, bestPos = Infinity;
  families.forEach((fam, idx) => {
    for (const word of fam) {
      const p = low.indexOf(word);
      if (p >= 0 && p < bestPos) { bestPos = p; best = idx; }
    }
  });
  return best;
}

/** Přepočítá závažnost nálezu podle měřitelných pravidel — grader jen
 *  POZORUJE (co má být / co je nakresleno / o kolik procent), o závažnosti
 *  rozhoduje tenhle kód, aby stejný nález nedopadal pokaždé jinak. */
function normalizeSeverity(f: QaFinding): QaFinding {
  // ⚠️ ÚNIK IDENTITY má přednost před vším ostatním: „vymyšlená postava
  // vypadá jako Nicolásek" je nález, u kterého jsou barvy vlasů SHODNÉ —
  // tabulka barevných rodin níž by ho proto umlčela jako MINOR a appka by
  // tiše tolerovala přesně tu vadu, kterou to má hlídat (nahlášeno: „všechny
  // vymyšlené postavy vypadaly jako Nicolásek").
  if (/look-?alike|looks like (a |the )?(hero|copy)|near-?copy|same face|copy of|identical to (the )?(hero|reference)/i.test(f.problem)) {
    return { ...f, severity: "MAJOR" };
  }
  // Pravidlo 3 — barvy. VLASY jsou identitní znak (dva sourozenci s různou,
  // byť "sousední" barvou vlasů — blond vs. zrzavá/kaštanová — jsou pro
  // rodiče viditelně PROHOZENÍ, ne malířská odchylka): tolerovat se smí jen
  // stejná rodina (step 0), žádný mezirodinný skok. OČI naopak mají reálné
  // pásmo nejistoty (drobná duhovka, osvětlení) → tam zůstává soused = MINOR.
  // Reálný nahlášený případ: „jednou Vája, potom Nicolásek" — appka s
  // toleranci step<=1 tenhle skutečný swap classifikovala jako MINOR.
  if (f.rule === 3 && f.expected && f.observed) {
    const isHair = /hair|vlas/i.test(`${f.problem} ${f.attribute || ""}`);
    const families = isHair ? HAIR_FAMILIES : EYE_FAMILIES;
    const a = familyIndex(families, f.expected);
    const b = familyIndex(families, f.observed);
    if (a >= 0 && b >= 0) {
      const step = Math.abs(a - b);
      const tolerance = isHair ? 0 : 1;
      return { ...f, severity: step <= tolerance ? "MINOR" : "MAJOR" };
    }
  }
  // Pravidlo 7 — měřítko. Na překreslení kvůli velikosti postavy se platí JEN
  // když je pro to skutečný důvod, protože odhad poměru hlav od vision modelu
  // má reálné chybové pásmo (naměřeno ±3–5 %) a bez výškového listu porovnává
  // proti kánonu, který si musí domyslet z textu. Testem doloženo: grader
  // napíše „head size is SLIGHTLY larger" a k tomu vydá číslo nad tolerancí —
  // a appka za ten „mírný" rozdíl zaplatí přemalování (které se navíc
  // v jednom ze dvou případů vůbec nepovedlo).
  if (f.rule === 7) {
    const dev = typeof f.deviationPct === "number" ? Math.abs(f.deviationPct) : undefined;
    // Skutečné rozbití proporcí: dítě nakreslené jako teenager/dospělý,
    // nebo naopak školák s batolecími proporcemi
    const ageBreak = /adult|teenager|teenage|grown[- ]?up|toddler|infant|baby|dospěl|puberť|batol/i.test(f.problem);
    if (ageBreak) return { ...f, severity: "MAJOR" };
    // Naměřená odchylka rozhoduje — a rozhoduje i PROTI zdrobňujícím slovům:
    // nahlášeno reálným případem, kdy Valentýnka místo k uším sahala
    // Nicoláskovi k pasu (poměr výšek 0,77 → 0,45, tj. −42 %), což žádné
    // „mírně" není, i kdyby to tak kontrola nazvala.
    if (dev !== undefined) {
      return { ...f, severity: dev <= HEAD_RATIO_TOLERANCE_PCT ? "MINOR" : "MAJOR" };
    }
    // Bez čísla: zdrobňující formulace = jen dojem, na ten se neplatí
    if (/slight|mild|marginal|a bit|somewhat|trochu|mírn|nepatrn/i.test(f.problem)) {
      return { ...f, severity: "MINOR" };
    }
    // Bez čísla, ale bez zdrobnění a s výrazným slovníkem („much smaller",
    // „only reaches his waist") — to je popis skutečného rozjezdu proporcí
    if (/much |far |way |half |only reaches|instead of|dvakrát|polovin/i.test(f.problem)) {
      return { ...f, severity: "MAJOR" };
    }
    return { ...f, severity: "MINOR" };
  }
  return f;
}

/** Z nálezů určí akci: MAJOR na needitovatelném pravidle → REDRAW,
 *  jinak jakýkoli MAJOR/MODERATE → EDIT, samotné MINOR → ACCEPT. */
function decideAction(findings: QaFinding[]): QaAction {
  const actionable = findings.filter(f => f.severity !== "MINOR");
  if (actionable.length === 0) return "ACCEPT";
  const needsRedraw = actionable.some(f =>
    (f.severity === "MAJOR" && REDRAW_ONLY_RULES.has(f.rule)) || f.fixable === false
  );
  return needsRedraw ? "REDRAW" : "EDIT";
}

export async function verifySceneImage(
  apiKey: string, img: ImageResult, heroDescription: string, scenePrompt = "",
  refs: ReferenceImage[] = [], // 🕵️ kanonické portréty — inspektor porovnává TVÁŘE, ne jen text
  deadline?: number
): Promise<QaVerdict | null> {
  // Referenční portréty jdou inspektorovi PŘED kontrolovaný obrázek — dřív
  // soudil jen podle textu a „Bella jako černoška" mu nemohla padnout do oka
  const refParts = refs.slice(0, 8).flatMap((r, i) => [
    { text: `REFERENCE ${i + 1} — ${(r.label || (r.name ? `canonical portrait of ${r.name}` : "reference image")).slice(0, 300)}:` },
    { inlineData: { data: r.data, mimeType: r.mimeType } },
  ]);
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await geminiPost(apiKey, VERIFY_MODEL, {
        contents: [{
          role: "user",
          parts: [
            ...refParts,
            { text: refParts.length ? "IMAGE TO INSPECT (judge ONLY this one against the references and rules):" : "IMAGE TO INSPECT:" },
            { inlineData: { data: img.buffer.toString("base64"), mimeType: img.mimeType } },
            { text: [
              "You are a STRICT quality inspector for a children's storybook illustration.",
              "CANONICAL CHARACTER SHEET:",
              heroDescription.slice(0, 8000),
              ...(scenePrompt ? ["", "SCENE DESCRIPTION (what THIS image should show):", scenePrompt.slice(0, 700)] : []),
              "",
              "Run this checklist and report EVERY violation you find:",
              "0) STYLE: the image must read as a painterly 2D storybook ILLUSTRATION. It is DIGITALLY produced artwork and that is CORRECT and expected — NEVER report a violation merely because it looks digital, computer-made, or 'not literally hand-painted with real brushes'. Report a violation ONLY for these three genuinely wrong looks: (a) photographic realism (real photo, real skin pores/texture, stock-photo look), (b) a 3D/CGI render (plastic-looking shaded models, Pixar-style 3D volumes), or (c) flat hard-edged vector/clipart with uniform fills and outlines. A soft, painterly, richly colored digital illustration — even a very clean or very detailed one — is exactly what this book wants: PASS it.",
              "1) IDENTIFY every visible person one by one and match each to a named character by hair, face and outfit. COUNT them: the number of visible people MUST EQUAL the number of characters named in the scene description — more OR fewer = FAIL. ANY person you cannot confidently match (extra child, stranger, background figure) = FAIL. A character named in the scene description who is MISSING = FAIL. A person who mixes features of TWO characters (one character's face with another's outfit or hairstyle — swapped/merged identities) = FAIL. EXCEPTION: when the scene description itself mentions a GROUP (a team, other players, opponents, the crowd, the audience, villagers…), unnamed background figures belonging to that group are ALLOWED — list them as 'group:<what>' in people, they don't fail the count; but none of them may look like a copy of a named hero.",
              "2) Each named character appears EXACTLY ONCE — two similar children or two similar adults = FAIL.",
              "2b) NO LOOK-ALIKES OF THE HEROES: every person who is NOT one of the characters with a reference portrait (a character invented for this story, a shopkeeper, a new friend, a background figure) must look like a CLEARLY DIFFERENT individual — different face, and a different hair color or hair style from the portrait characters. A secondary/invented person drawn with a hero's face or as a near-copy of a hero (same face and same hair) is a MAJOR violation of this rule, even if the scene legitimately calls for that person to be there. Judge this against their own description in the character sheet.",
              "3) HAIR / EYE / SKIN COLOR — judge by COLOR FAMILIES, not by shade. Hair families: {platinum, golden, dark blond} · {ginger, auburn} · {light, medium, dark brown} · {black}. Eye families in order: {blue} {grey} {green} {hazel/amber} {brown} {dark brown/black}. A different shade INSIDE the same family, or a jump to an ADJACENT eye family (brown↔hazel, blue↔grey, green↔hazel), is MINOR — painterly lighting causes it and it is NOT worth redrawing. A jump BETWEEN hair families (blond→brown, brown→black) or an eye jump of TWO OR MORE families (brown→blue) is MAJOR. EXCEPTION — NAMED SHADE LOCKS: when the character sheet gives this specific character an EXPLICIT named shade (e.g. \"ESPRESSO-DARK-BROWN\", \"CHESTNUT-BROWN\", \"CARAMEL-BROWN\", \"BRONDE\", \"GOLDEN-BLOND\") and/or an explicit comparison to another named family member (e.g. \"darker than James\", \"a shade paler than Nicolas\"), that is a DELIBERATE family-wide consistency lock, not generic guidance — treat a shade landing outside that named description, or a comparison that comes out backwards (e.g. the person who should be darker is drawn lighter), as MAJOR even though it stays inside the same broad hair family. This exception applies ONLY to characters whose sheet entry names a specific shade this way. IMPORTANT — DO NOT GUESS: if a face is small in the frame (roughly less than one tenth of the image height) the iris is only a few pixels wide; then you MUST report eye color as not assessable and NEVER as a violation. SKIN TONE/ethnicity must match, but ALLOW natural lighting variation: a warmer, sun-kissed, tanned or shadowed rendering of the SAME underlying tone is NOT a violation (MINOR at most) — only a clear ethnicity/race change is MAJOR. For a named ANIMAL, a different SPECIES/BREED or a clearly different coat color/pattern than its sheet entry is MAJOR.",
              "4) Hair LENGTH and STYLE match the sheet (short stays short, long stays long; beard per sheet).",
              "5) CLOTHING: each character wears THEIR OWN outfit (or their 'Story outfits:'/'Team kits:' variant for this scene). A signature outfit on the WRONG person (e.g. a different child wearing Nicolas's white T-shirt with red stripes) = FAIL. The SAME signature garment on TWO different people (two lilac hoodies, two striped polos) = FAIL. An adult's signature outfit worn by a child (or vice versa) = FAIL. If the sheet has a 'Team kits:' entry and this scene shows that group activity happening, everyone taking part MUST wear their group's stated uniform, NOT default/casual clothes — someone in everyday clothes during the activity = FAIL; members of the SAME group must all match each other's uniform, a rival/opposing group must be in their clearly different stated uniform.",
              "6) Dressing level is UNIFORM for the scene: no winter coat next to a T-shirt; indoors without jackets/hats; never summer clothes in snow.",
              `7) BODY SCALE AND HEIGHT — measure it, do not eyeball it. Run ALL THREE checks:`,
              `   (a) HEAD-COUNT (body proportions / apparent age): estimate how many head-heights tall each character is. A small toddler is about 4-5 heads, a school-age child about 5-6, a grown-up about 7-7.5. If a character's head-count is off their canonical age bracket by more than roughly one head — a school-age child drawn with toddler proportions, or a child drawn with an adult's 7-head build — that is MAJOR.`,
              `   (b) TOTAL HEIGHT RATIO — but ONLY when two characters are in COMPARABLE poses (both standing upright, or both sitting) and at a similar distance from the camera. Then compare the ratio of their full head-to-toe heights against the canonical sheet and reference portraits. A deviation over ±${HEAD_RATIO_TOLERANCE_PCT}% is MAJOR: a child who should reach an adult's chest but only reaches their hip, or a toddler who should reach her brother's ears but only reaches his waist, is a serious error even though both are "children".`,
              `   (c) WHEN POSES ARE NOT COMPARABLE (one kneels, sits, crouches, leans, or stands much further back) SKIP check (b) entirely and never report a violation from it — apparent height legitimately changes with pose. Judge only (a) and the HEAD-SIZE ratio (head height top-of-skull to chin, excluding hair volume and bows) against the canonical ratio, same ±${HEAD_RATIO_TOLERANCE_PCT}% band. EXCEPTION for a NAMED ANIMAL whose sheet explicitly states its size is constant regardless of pose or camera distance (e.g. Archie the dog): even when poses aren't comparable, still judge whether its overall BULK/BODY VOLUME relative to any nearby child looks larger than a small-to-medium dog should — sitting close to the camera does not excuse a dog that reads as bulky/large next to a child; that is still MAJOR under rule 13 below, not exempt.`,
              `   Report the numeric deviation in "deviationPct" for whichever check you actually used, and name that check in "attribute" (e.g. "total height ratio", "head size ratio", "head-count"). If the scene description explicitly states a DIFFERENT size relationship for this scene (a deliberate story-driven transformation), judge against THAT and do not fail for matching it.`,
              "8) ANATOMY: exactly two arms, two legs, five fingers per hand, natural faces; bicycles have two wheels.",
              "9) KEY OBJECTS identical to their sheet entry — the same vehicle/boat/toy type and colors as stated. Each key object appears EXACTLY ONCE — two copies of the same boat/lighthouse/vehicle in one image = FAIL (unless the scene explicitly says otherwise).",
              "10) NO text, letters, watermarks or signatures anywhere in the image. EXCEPTION: a scoreboard may show ONLY the score as plain digits (e.g. '2:1') — but team/country abbreviations or any other letters ON the scoreboard (or anywhere else) still FAIL.",
              "11) FRAMING: nothing important is CUT OFF by the image edges — no cropped heads or faces, no half-cut characters, and no key objects (boat, vehicle, building, the moon…) sliced by the border. Background scenery may naturally continue past the edge.",
              "12) SETTING: if the sheet contains a 'World & setting lock', the scene's venue must MATCH it — e.g. a football match happens ON a proper pitch with lines and goals (never on a river bank), a named real person looks like the described HUMAN.",
              ...(refParts.length ? [
                "13) IDENTITY MATCH TO REFERENCES: compare EVERY visible named character against their REFERENCE image above — it must clearly be the SAME person: same face, same underlying SKIN TONE/ethnicity, same hair color and style, same apparent AGE and BODY SIZE (a small child in the reference must stay a small child — drawn as a teenager or adult = FAIL; an adult must stay an adult), same signature outfit. A character who looks like a DIFFERENT person than their reference (different ethnicity, different age, different face) = FAIL. Do NOT fail for lighting-only differences (sun-tanned, warmer/cooler color grading, shadows, golden-hour light) when the person is otherwise clearly the same individual — judge the underlying tone, not the lighting. EXCEPTION: if the scene description explicitly states this character is now a different height/size (a deliberate story-driven transformation), a body-size difference from the reference is CORRECT, not a fail — still check face/hair/ethnicity/outfit match.",
              ] : []),
              "",
              "CLASSIFY EVERY FINDING BY SEVERITY — this is as important as finding it:",
              "· MAJOR = breaks the illusion for a child or reader: wrong/missing/extra named person, merged or swapped identities, a character who is not the person in their reference photo, colors jumping between families, broken art style, broken anatomy, body scale outside the stated tolerance, key content cut off by the frame, wrong setting.",
              "· MODERATE = clearly wrong but repairable by touching ONE detail without redrawing the picture: a missing signature accessory, one garment in the wrong color family, stray text/watermark, a duplicated prop.",
              "· MINOR = painterly variation a parent would never notice or complain about: shade differences inside a color family, adjacent eye families, lighting-driven skin warmth, hair length off by one step, body-scale ratio inside the stated tolerance, tiny background details.",
              "Be honest and CALIBRATED: do not inflate a MINOR into a MAJOR to look thorough, and do not downgrade a genuine MAJOR to seem lenient. Most good illustrations legitimately have zero or only MINOR findings.",
              "REPORT MEASUREMENTS, NOT JUST OPINIONS — for these two rules always fill in the extra fields, they decide whether a repair is even needed:",
              "· rule 3 (colors): set \"attribute\" (e.g. \"eye color\", \"hair color\"), \"expected\" (the color word from the character sheet) and \"observed\" (the color word you actually see).",
              `· rule 7 (scale): set "deviationPct" — by how many percent the girl-to-boy (or child-to-adult) HEAD-SIZE ratio in this image differs from the canonical ratio. Estimate the head heights and compute it; a value within ±${HEAD_RATIO_TOLERANCE_PCT} is fine. If you genuinely cannot measure it, omit the field and say so in "problem".`,
              'Reply with ONLY JSON. ALWAYS include a "people" audit — list every visible person as "<who you matched them to or UNKNOWN>". Clean image: {"people":["Nicolas","Valentýna"],"findings":[]}. Otherwise list each finding: {"people":[...],"findings":[{"rule":<number>,"severity":"MINOR"|"MODERATE"|"MAJOR","problem":"<short English reason, max 15 words>","attribute":"<what it concerns, for rules 3 and 7>","expected":"<canonical value, for rule 3>","observed":"<what is drawn, for rule 3>","deviationPct":<number, for rule 7>,"fix":"<a single imperative instruction that would repair ONLY this detail, e.g. \'change Valentýna\'s eye color to brown\'>","fixable":<true if repairing this one detail in place would fix it, false if the whole picture must be drawn again>}]}. Any UNKNOWN in people is a MAJOR finding on rule 1.',
            ].join("\n") },
          ],
        }],
        // thinkingBudget 0 je KRITICKÝ: gemini-2.5-flash jinak „přemýšlí"
        // ~475 tokenů z limitu a verdikt se UTRHNE (finish=MAX_TOKENS) —
        // kontrola pak tiše neběžela a vadné obrázky procházely neověřené.
        // (jen pro 2.5 — jiné verify modely parametr neznají a vrátily by 400)
        generationConfig: {
          // ⚠️ Strukturované nálezy (severity + expected/observed/fix u každého)
          // jsou mnohem delší než dřívější jednořádkové "problems" — na 900
          // tokenech se odpověď u 5–6 nálezů UTRHLA v půlce JSONu a kontrola
          // pak spadla na "verify UNAVAILABLE" (obrázek přijat neověřený).
          maxOutputTokens: 2000,
          responseMimeType: "application/json",
          // 🎯 temperature 0: bez toho běžel grader na defaultu (~1.0) a tentýž
          // obrázek dostával při opakování různé verdikty — u brány, která
          // rozhoduje o placeném překreslení, je rozptyl přímo drahý
          temperature: 0,
          ...(VERIFY_MODEL.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }, GEMINI_VERIFY_TIMEOUT_MS);
      const data = JSON.parse(raw) as { candidates?: GeminiCandidate[] };
      const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("QA verdict missing JSON");
      const v = JSON.parse(m[0]) as {
        ok?: boolean; rules?: number[]; problems?: string; people?: string[];
        findings?: Array<{
          rule?: number; severity?: string; problem?: string; fix?: string; fixable?: boolean;
          expected?: string; observed?: string; attribute?: string; deviationPct?: number;
        }>;
      };
      const findings: QaFinding[] = [];
      for (const f of Array.isArray(v.findings) ? v.findings : []) {
        const sev = String(f.severity || "MAJOR").toUpperCase();
        findings.push(normalizeSeverity({
          rule: Number.isFinite(Number(f.rule)) ? Number(f.rule) : -1,
          severity: sev === "MINOR" || sev === "MODERATE" ? sev : "MAJOR",
          problem: String(f.problem || "").slice(0, 160),
          fix: f.fix ? String(f.fix).slice(0, 200) : undefined,
          fixable: typeof f.fixable === "boolean" ? f.fixable : undefined,
          expected: f.expected ? String(f.expected).slice(0, 60) : undefined,
          observed: f.observed ? String(f.observed).slice(0, 60) : undefined,
          attribute: f.attribute ? String(f.attribute).slice(0, 60) : undefined,
          deviationPct: Number.isFinite(Number(f.deviationPct)) ? Number(f.deviationPct) : undefined,
        }));
      }
      // 🛟 Kompatibilita se starším formátem verdiktu ({ok:false, rules:[…]}) —
      // kdyby grader (jiný model / starší chování) závažnosti nevrátil,
      // ber to jako dřív: každé porušení je MAJOR.
      if (findings.length === 0 && v.ok === false) {
        const rules = Array.isArray(v.rules) && v.rules.length ? v.rules : [-1];
        for (const r of rules) {
          findings.push({
            rule: Number.isFinite(Number(r)) ? Number(r) : -1,
            severity: "MAJOR",
            problem: String(v.problems || "unspecified violation").slice(0, 160),
          });
        }
      }
      // Pojistka: inspektor vyjmenoval osobu, kterou nepřiřadil k žádné
      // postavě (UNKNOWN) — cizí člověk v obraze, i kdyby nález nezapsal
      // (osoby smí být řetězce i objekty {name: …} — kontrola přes JSON)
      if (Array.isArray(v.people) && /unknown|stranger/i.test(JSON.stringify(v.people))
          && !findings.some(f => f.rule === 1)) {
        findings.push({
          rule: 1, severity: "MAJOR",
          problem: "an unmatched person (stranger/extra figure) is present",
          fix: "remove the unidentified extra person from the image",
        });
      }
      // 🩺 ZJIŠTĚNO reálným testem: grader občas místo "vypiš JEN porušení"
      // pochopí úkol jako "okomentuj VŠECHNA pravidla" a vrátí nález ke
      // KAŽDÉMU z ~14 pravidel — i těm, co evidentně PROŠLA (text zní "is
      // correct and expected", "appears exactly once"…), ale se špatně
      // přiřazenou závažností MAJOR. Appka by pak zaplatila překreslení za
      // obrázek, který byl ve skutečnosti v pořádku (stejný obrázek podruhé
      // dostal ok:true). Podezřele vysoký počet nálezů => bereme to jako
      // selhání kontroly a zkusíme to znovu, ne že bychom to rovnou platili.
      const SUSPICIOUS_FINDINGS_COUNT = 8;
      if (findings.length >= SUSPICIOUS_FINDINGS_COUNT && attempt < 2) {
        console.warn(`[Gemini QA] verify attempt ${attempt}/2: podezřele ${findings.length} nálezů najednou (pravděpodobně "okomentovala všechna pravidla" místo jen chyb) → zkouším znovu`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      const actionable = findings.filter(f => f.severity !== "MINOR");
      const action = decideAction(findings);
      const minorNote = findings.length > actionable.length
        ? ` [tolerováno: ${findings.filter(f => f.severity === "MINOR").map(f => `r${f.rule} ${f.problem}`).join("; ").slice(0, 200)}]`
        : "";
      return {
        ok: actionable.length === 0,
        action,
        problems: (actionable.map(f => `r${f.rule}(${f.severity}) ${f.problem}`).join("; ") + minorNote).slice(0, 500),
        badRules: actionable.length,
        findings,
        fixInstruction: actionable.map(f => f.fix || f.problem).filter(Boolean).join("; ").slice(0, 500),
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[Gemini QA] verify attempt ${attempt}/2 failed: ${msg}`);
      // Času se nedostává — další pokus by jen ukrajoval z rozpočtu na
      // dokreslení/předání štafety, aniž by měl reálnou šanci stihnout se
      if (deadline !== undefined && Date.now() > deadline) break;
      if (attempt < 2) await new Promise(r => setTimeout(r, 2500 * attempt));
    }
  }
  console.warn("[Gemini QA] verify UNAVAILABLE after retries — image accepted unchecked");
  return null;
}

// ── 📖 „Nastudovat svět" ZKOPÍROVANÉ pohádky ───────────────────────────────
// Poslaná/přijatá pohádka (odkaz /s/) nenese heroDescription ani worldNotes —
// appka jinou postavu nezná z knihovny. Aby šlo příběh upravovat „jako
// běžnou pohádku" (✨ Pokračování, 🖌 překreslení se zámkem vzhledu), appka
// si napřed z HOTOVÝCH OBRÁZKŮ a textu vypravování zpětně sestaví záznam
// heroDescription + worldNotes ve STEJNÉM formátu, jaký píše vypravěč —
// od teď to appka bere jako kanonický popis této pohádky.
export async function describeStoryCast(
  apiKey: string,
  title: string,
  narration: string,
  images: ReferenceImage[]
): Promise<{ heroDescription: string; worldNotes: string }> {
  const parts: Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = [
    { text: [
      "You are reverse-engineering a children's storybook's character sheet from its FINISHED illustrations, so future illustrations of the SAME story stay consistent.",
      `TITLE: ${title.slice(0, 200)}`,
      `NARRATION (all pages, for character names and roles): ${narration.slice(0, 3500)}`,
      "",
      "Look CAREFULLY at every attached illustration and write TWO fields:",
      "1) \"heroDescription\": one entry per NAMED character that actually appears in the illustrations — 'Name: [hair style+color], [eye color], [exact clothing with colors], [distinctive features].' Be as specific as the pictures allow (exact hair color and length, skin tone, exact outfit colors and items). Separate characters with ' | '. If a recurring object appears (a boat, a vehicle, a toy), add a 'Key objects:' entry with its exact appearance. End with a 'Heights:' entry stating RELATIVE heights/ages you can see (without numeric ages) so body sizes stay consistent. NO age numbers anywhere.",
      "2) \"worldNotes\" (max 110 words): the recurring setting(s)/venue(s) seen across the illustrations, so later scenes keep the same place consistent.",
      "Reply with ONLY JSON: {\"heroDescription\":\"...\",\"worldNotes\":\"...\"}",
    ].join("\n") },
    ...images.slice(0, 4).flatMap(img => [
      { inlineData: { data: img.data, mimeType: img.mimeType } },
    ]),
  ];
  const raw = await geminiPost(apiKey, VERIFY_MODEL, {
    contents: [{ role: "user", parts }],
    generationConfig: {
      maxOutputTokens: 1200,
      responseMimeType: "application/json",
      ...(VERIFY_MODEL.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });
  const data = JSON.parse(raw) as { candidates?: GeminiCandidate[] };
  const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Nastudování světa se nepovedlo (chybí JSON odpověď).");
  const v = JSON.parse(m[0]) as { heroDescription?: string; worldNotes?: string };
  const heroDescription = String(v.heroDescription || "").trim();
  if (!heroDescription) throw new Error("Nastudování světa se nepovedlo (prázdný popis postav).");
  return { heroDescription, worldNotes: String(v.worldNotes || "").trim() };
}

// ── 🖌️ Cílená EDITACE vadného detailu (místo překreslení celé scény) ──────
// Vadný obrázek se pošle ZPĚT modelu s instrukcí „změň POUZE tohle, zbytek
// nech beze změny". Stojí to stejně jako generace, ale:
//   - uspěje výrazně častěji než čerstvé překreslení (u kterého se dřív
//     měřilo, že 3 ze 7 oprav nespravily nic — čistá ztráta),
//   - zachová všechno, co už na obrázku bylo dobré (kompozice, světlo, pózy),
//     takže se oprava barvy očí neprojeví jako úplně jiná scéna.
// Pro needitovatelné vady (styl, měřítko, ořez, podoba dítěte) se NEPOUŽÍVÁ —
// viz REDRAW_ONLY_RULES.
async function editSceneImage(
  apiKey: string, model: string, base: ImageResult, fixInstruction: string,
  refImages: ReferenceImage[] = [], aspect: string | null = "16:9"
): Promise<ImageResult> {
  const parts: Array<Record<string, unknown>> = [];
  for (const ref of refImages.slice(0, 6)) {
    parts.push({ text: ref.label || `Canonical reference of ${ref.name || "a story character"}:` });
    parts.push({ inlineData: { data: ref.data, mimeType: ref.mimeType } });
  }
  parts.push({ text: "IMAGE TO EDIT — return this SAME illustration with only the requested change applied:" });
  parts.push({ inlineData: { data: base.buffer.toString("base64"), mimeType: base.mimeType } });
  parts.push({ text: [
    `Edit the image above. Apply EXACTLY this change and NOTHING else: ${fixInstruction}`,
    "Keep everything else pixel-for-pixel as close to the original as you can: the same composition, camera angle, poses, facial expressions, background, lighting, colors and painting style. Do NOT re-imagine the scene, do NOT move the characters, do NOT change the time of day.",
    "Output the full edited illustration in the same hand-painted 2D storybook style — flat 2D painting, never a 3D render, and no text, letters or watermarks anywhere.",
  ].join(" ") });

  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE", "TEXT"] };
  if (aspect) generationConfig.imageConfig = { aspectRatio: aspect };
  const raw = await geminiPost(apiKey, model, { contents: [{ role: "user", parts }], generationConfig }, GEMINI_IMAGE_TIMEOUT_MS);
  const data = JSON.parse(raw) as { candidates?: GeminiCandidate[]; promptFeedback?: { blockReason?: string } };
  if (data.promptFeedback?.blockReason) throw new Error(`Gemini BLOCKED: ${data.promptFeedback.blockReason}`);
  for (const cand of data.candidates || []) {
    for (const part of cand.content?.parts || []) {
      if (part.inlineData?.data) {
        getGenCounter().img1k += 1; // 💰 editace je placená generace jako každá jiná
        return { buffer: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType || "image/png" };
      }
    }
  }
  throw new Error("NO_IMAGE: editace nevrátila obrázek");
}

// Pozadí aplikace — ilustrovaná scenérie ve stejném stylu jako pohádky,
// na výšku (telefon). Volitelně s referenčními fotkami postav (Nicolásek
// a Valentýnka bývají součástí každého světa). Prompt je bezpečný a pevně
// daný (lib/backgrounds.ts), sanitizace není potřeba.
export async function generateBackgroundImage(prompt: string, refImages: ReferenceImage[] = [], initialAspect: string | null = "9:16"): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = IMAGE_MODEL.trim();
  let aspect: string | null = initialAspect;
  let lastErr = new Error("Gemini nevrátil obrázek");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await compressImage(await callGeminiImage(apiKey, model, prompt, aspect, refImages));
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error(`[Gemini bg] attempt ${attempt}/3: ${lastErr.message}`);
      if (aspect && /image_config|imageConfig|aspect_ratio|aspectRatio|Unknown name/i.test(lastErr.message)) {
        aspect = null;
        continue;
      }
      if (lastErr.message.match(/^Gemini 4/) && !lastErr.message.startsWith("Gemini 429")) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
  throw lastErr;
}

// 🖼️ Vlastní pozadí z fotky (HomeScreen "+ VLASTNÍ"): appka pošle NAHRANOU
// fotku a Gemini ji přemaluje do STEJNÉ ilustrační řeči jako zbytek appky
// (viz BG_STYLE v lib/backgrounds.ts) — kompozice/motiv fotky zůstává
// rozpoznatelný, jen se "obarví" do pohádkového stylu. Na rozdíl od
// generateBackgroundImage (kde appka MALUJE novou scénu podle promptu a
// fotka je jen reference na podobu postav) je tady fotka SAMOTNÝ podklad.
export async function generateCustomBackgroundFromPhoto(photoBase64: string, photoMimeType: string): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = IMAGE_MODEL.trim();
  const prompt = [
    "Repaint this exact photo as a warm, painterly children's storybook illustration background — Walt Disney animated style, rich saturated colors, cinematic warm lighting, portrait orientation.",
    "Keep the same composition, subjects and framing as the photo — recognizable, just repainted in the illustration style, not a literal photo anymore.",
    "Slightly dark and muted overall so white text on top of the image stays readable.",
    "Absolutely no text, letters, words, signs, labels or watermarks anywhere in the image.",
  ].join(" ");
  const refImages: ReferenceImage[] = [{ data: photoBase64, mimeType: photoMimeType, label: "Photo to repaint as the illustration itself (not a character reference):" }];
  let lastErr = new Error("Gemini nevrátil obrázek");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await compressImage(await callGeminiImage(apiKey, model, prompt, "9:16", refImages));
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error(`[Gemini custom bg] attempt ${attempt}/3: ${lastErr.message}`);
      if (attempt < 3) await new Promise(r => setTimeout(r, 3000 * attempt));
    }
  }
  throw lastErr;
}

// 🎯 Vytáhne jmenovaný obsazovací seznam ze zavedené konvence, kterou vypravěč
// VŽDY píše na konec imagePromptu ("Only X, Y present — no other people…").
// Používá se jak pro explicitní "CAST:" popisek panelu v archu, tak pro
// seskupování scén se STEJNÝM obsazením do jednoho archu (job-runner.ts) —
// méně různých lidí v jednom obrázku = menší riziko zaměněných identit.
export function sceneCastList(imagePrompt: string): string | null {
  const m = /Only\s+([^—-]+?)\s+present\b/i.exec(imagePrompt);
  return m ? m[1].trim() : null;
}

// Sdílené stavební kameny promptů (sólo obrázek i arch scén) — připojuje se
// KE KAŽDÉMU volání obrázkového modelu appky bez výjimky (sólo scéna, arch,
// ranné kreslení scény 1), takže tahle věta je jediné místo, kde je jistota,
// že platí doslova VŠUDE, viz nahlášené "na některých slidech je jiný styl".
// 🎥 ZÁMEK ZÁBĚRU: měřením se ukázalo, že tělesné proporce postav model drží
// v toleranci — co ale mezi scénami skákalo (a působilo jako „postava je jinak
// velká"), byla VZDÁLENOST KAMERY: jednou děti přes půl obrázku, jinde malé
// v krajině. Jednotný záběr je proto součástí stylu, ne volba scény.
// 🩺 2026-08-06: EXPORTOVÁNO, ať ho může sdílet i lib/portraits.ts —
// portrétová kartotéka měla svou VLASTNÍ, dřív ručně kopírovanou verzi
// stylu (PORTRAIT_STYLE), která se odsud postupně odchýlila (chybělo
// "cinematic"/"expressive faces" atd.) a navíc kreslila na výšku (9:16)
// místo landscape (16:9) jako skutečné stránky pohádky — výsledek
// (portréty, výškový list, skupinová kotva) pak vizuálně neseděl se
// skutečnými stránkami appky. Sdílený konstant napříč oběma soubory =
// jedna pravda o stylu, žádná budoucí odchylka.
export const STYLE_SUFFIX ="Hand-painted 2D storybook illustration, soft painterly brushwork in classic Disney animated-film style, warm cinematic lighting, rich saturated colors, expressive faces, landscape orientation. CONSISTENT CAMERA: frame every scene as a comfortable medium-wide shot at a child's eye level, with the named characters occupying roughly one third of the image height, their whole bodies visible, and enough of the surroundings to show where they are. Keep this same shot distance and eye level in every scene of the book — never cut to an extreme close-up of faces and never shrink the characters into tiny distant figures in a landscape. THIS ART STYLE IS FIXED FOR THE WHOLE STORY, PAGE AFTER PAGE — never drift toward a different rendering style, palette, linework or level of detail from one scene to the next, and never let brand-new characters introduced mid-story pull the picture toward a different style; THEY are drawn to match this established style, never the other way round. Strictly FLAT 2D painting — NOT a 3D render, no CGI, no plastic skin, no photorealism. Correct natural anatomy: every person has EXACTLY two arms, two legs and five fingers on each hand — no extra, missing or deformed limbs; bicycles have exactly two wheels. Absolutely no text, letters, words, signs, labels, captions, subtitles, watermarks, or artist signatures of any kind anywhere in the image.";

// 📜 KONZISTENČNÍ BIBLE — kompletní, očíslovaný seznam pravidel pro KAŽDÝ
// jednotlivý obrázek. Je součástí SERVEROVÉHO promptu (běží v `generateSceneImage`
// pro každou scénu bez výjimky) — platí úplně STEJNĚ bez ohledu na to, jestli je
// čtenář přihlášený k účtu, nebo ne; přihlášení řídí jen SYNC historie/postav mezi
// zařízeními, nikdy obsah promptu poslaného obrázkovému modelu.
function buildAppearanceLock(heroDescription: string): { open: string; close: string } {
  if (!heroDescription) return { open: "", close: "" };
  return {
    open: [
      `⚠ APPEARANCE LOCK — IMMUTABLE across every image in this story:`,
      heroDescription,
      `1) Every named character MUST look IDENTICAL to this description in EVERY image: same hair color, same hair style, same eye color, same exact clothing items and colors, same shoes — AND the same AGE, same BODY SIZE and PROPORTIONS. Relative heights between characters NEVER change: a toddler stays toddler-sized, a child stays child-sized, adults stay adult-sized. For a named ANIMAL character this means the SAME SPECIES and BREED too — a dog never changes breed (a Staffordshire Bull Terrier never becomes a Doberman, a German Shepherd, or any other breed), and its exact coat color/pattern (brindle, patches, markings) stays identical in every scene.`,
      `2) Any recurring OBJECT listed above (vehicle, magic item, toy) keeps IDENTICAL type, shape and colors in every scene — the same car stays the same car, and each key object exists ONCE in the world: NEVER draw two copies of it in one image.`,
      `3) If 'Story outfits:' defines outdoor/indoor variants, draw the variant stated at the end of the scene description — and ALL characters in the scene share the SAME dressing level (never one in a winter coat while another wears a T-shirt).`,
      `4) ONLY the characters named in the scene are visible — zero additional people, strangers, or background human figures (EXCEPTION: a group the scene itself mentions — a team, opponents, the crowd — may appear as smaller background figures who never resemble the named heroes). Each named character appears EXACTLY ONCE in the image — NEVER draw two copies of the same person.`,
      `5) THE CAST IS CLOSED: draw ONLY the people named above and in the scene text — NEVER invent an extra, unlisted family member (a new sibling, a baby, a cousin, a second dog) just because the scene feels like it could use one. If the story's own text clearly introduces a brand-new named character, that is fine (and it still needs its OWN full description per the story-writing rules) — but never add an ANONYMOUS extra person with no name and no basis in the text.`,
      `6) IDENTITIES ARE SEPARATE: characters who look similar (two adult men, two adult women, two boys) are DIFFERENT people — NEVER merge them, swap them, or mix their features. Each keeps their OWN hair, face, build and signature clothing exactly as listed. A reference portrait may ONLY be used for the character it belongs to.`,
      `6b) REFERENCE PORTRAITS DO NOT LEAK ONTO ANYONE ELSE (this is the single most common failure): the attached reference portraits belong ONLY to the characters they are labelled with. EVERY other person in this image — a character invented for this story, a shopkeeper, a new friend, a passer-by, anyone in a background group — MUST be drawn as a visibly DIFFERENT individual: different face, different hair color AND style, different build, per THEIR OWN description above. Do NOT reuse a reference face, hairstyle or outfit for a person it does not belong to, and do NOT default to a reference face just because you have no photo of that character. If an invented character's description does not pin down some feature, invent one that clearly CONTRASTS with the reference portraits rather than resembling them.`,
      `7) RESPECT ESTABLISHED RELATIONSHIPS: only draw a romantic/spousal embrace (arms around the waist, a couple's close side-by-side pose) between characters the story establishes as partners — everyone else (siblings, friends, other relatives) gets warm but NON-romantic contact: a hand on a shoulder, holding hands as family, standing side by side. Never let two adults who are NOT the established couple end up posed like a couple.`,
      `8) DIRECTION OF ADAPTATION: when animals, creatures or any OTHER characters NOT listed above also appear in this scene, THEY must be drawn to fit this story's established art style and world — the characters listed above NEVER shift their proportions, body size, art style, or color palette to match the newcomers. A named character listed above looks EXACTLY as identical whether alone or surrounded by ten invented animal characters.`,
      `9) ABSENCE IS ALSO LOCKED: if the description above does NOT mention a feature (no beard/moustache mentioned, no glasses mentioned, no hat mentioned), draw the character WITHOUT it — never add facial hair, glasses, or accessories the description doesn't state, and never remove ones it does state. Facial hair in particular is a common slip: a clean-shaven face stated or implied above must stay clean-shaven in every single scene, never stubble, never a beard.`,
      // 🩺 2026-08-12: repeatedly reported drift on one specific canonical
      // character (an adult with an explicitly stated RECEDING HAIRLINE) —
      // every other rule above locks WHICH details must match, but none of
      // them named the failure MODE: when a description states something
      // atypical for that kind of person (not a full head of hair, not a
      // usual marking/color), an independently-drawn scene keeps quietly
      // "correcting" it back toward the more common/expected look, even
      // though hair color/style/clothing stay perfectly matched — the
      // atypical detail alone regresses to average. This mirrors a fix
      // already applied to portrait painting (see portraitPrompt,
      // lib/portraits.ts) but that only covers the ONE portrait image, not
      // every independent scene draw after it — generalized here so it
      // protects any character, not just the ones already special-cased.
      `10) DO NOT REGRESS ATYPICAL FEATURES TOWARD THE GENERIC/EXPECTED LOOK: when a description above states something UNUSUAL for that kind of person or animal — thinning or receding hair instead of a full hairline, an off-standard marking or coloring instead of the typical one, an asymmetric or unusual detail — that is a DELIBERATE, PERMANENT trait, not a one-off note. Draw it EXACTLY as stated in EVERY single scene, even under the natural pull to draw a more "normal"/average-looking version of that face or creature. If a character's hair, marking or build looks noticeably more typical/generic here than the description states, it has been drawn WRONG and must be corrected to match, no matter how small the deviation seems.`,
    ].join(" "),
    close: `⚠ CONSISTENCY REMINDER: match hair, eyes, clothing, age, body size, relative heights, cast size and relationships EXACTLY as stated above — do NOT alter any detail, do NOT add anyone not named, and do NOT soften any unusual/atypical stated feature back toward a more generic look.`,
  };
}

export async function generateSceneImage(
  scene: Scene, heroDescription: string, refImages: ReferenceImage[] = [],
  deadline?: number // epoch ms — po překročení appka PŘIJME první průchod i s vadami
  // (rychlost > dokonalost, jde 🖌 opravit ručně); bez deadline chová se jako dřív
): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = IMAGE_MODEL.trim();

  // Build raw prompt: character lock bookends the scene (start + end = highest model attention)
  const { open: charLockOpen, close: charLockClose } = buildAppearanceLock(heroDescription);

  const rawPrompt = [
    charLockOpen,
    scene.imagePrompt,
    charLockClose,
    STYLE_SUFFIX,
  ].filter(Boolean).join(" ");

  // ⚡ Líná sanitizace: rychlá regexová očista hned; plná LLM sanitizace se
  // dělá až KDYŽ filtr obsahu opravdu zablokuje (dřív stála 2–5 s u KAŽDÉ
  // scény, blokace je přitom výjimečná)
  let safePrompt = regexSanitize(rawPrompt);
  let llmSanitized = false;
  console.log(`[Gemini] scene ${scene.index} model=${model} (${safePrompt.length} chars): ${safePrompt.slice(0, 200)}`);

  const MAX_ATTEMPTS = 3;
  // Denní kvóta platí na model → při stropu primárního modelu zkusit záložní
  const models = FALLBACK_IMAGE_MODEL && FALLBACK_IMAGE_MODEL !== model
    ? [model, FALLBACK_IMAGE_MODEL]
    : [model];
  let withAspect = true;
  let lastErr = new Error("Gemini nevrátil obrázek");
  let quotaHits = 0;

  for (const m of models) {
    let dailyCapped = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        let img = await callGeminiImage(apiKey, m, safePrompt, withAspect ? "16:9" : null, refImages);
        // Bible konzistence: každý obrázek projde kontrolou; vadný se
        // překresluje — 2 opravná kola s výčtem chyb + 1 ČERSTVÉ překreslení
        // (nový pokus bez korekce často opraví, co korekce nespraví).
        // Drží se NEJLEPŠÍ OVĚŘENÝ pokus (nejméně porušených pravidel) —
        // neověřený obrázek nikdy nenahradí ověřený.
        // ⚠️ Dřív appka kontrolu PŘESKOČILA, když `sceneCastList` nenašel
        // přesnou uzavírací větu "Only X present" v imagePromptu — jenže
        // Claude tuhle větu občas zapomene napsat i u scény, která postavy
        // MÁ (viz nahlášený bug: jmenovky přímo v obrázku prošly bez kontroly,
        // protože scéna "neměla detekovaný cast"). Kontrola teď běží VŽDY,
        // když appka vůbec zná obsazení pohádky (heroDescription) — dražší,
        // ale zavřená mezera je tu důležitější než pár ušetřených requestů.
        if (heroDescription) {
          let v0 = await verifySceneImage(apiKey, img, heroDescription, scene.imagePrompt, refImages, deadline);
          if (!v0 && !(deadline !== undefined && Date.now() > deadline)) {
            // Kontrola 2× selhala (typicky rate-limit) → po pauze ještě jednou;
            // teprve pak se obrázek přijme s varováním (jinak by se nic nedokreslilo)
            await new Promise(r => setTimeout(r, 6000));
            v0 = await verifySceneImage(apiKey, img, heroDescription, scene.imagePrompt, refImages, deadline);
            if (!v0) console.warn(`[Gemini QA] scene ${scene.index}: kontrola opakovaně selhala — obrázek přijat NEOVĚŘENÝ`);
          }
          // 🪶 ODLEHČENÁ KONTROLA U 1–2 JMENOVANÝCH LIDÍ VE SCÉNĚ (ECONOMY-PLAN.md,
          // matice technik: „Odlehčené QA u 1-2 lidí scén" — appka tyhle scény i
          // dnes zvládá spolehlivě, nejméně proměnných k zaměnění). Jediný nález
          // MODERATE (barva doplňku, jedna drobnost) na takové scéně typicky NENÍ
          // hoden placené opravy (editace stojí stejně jako čerstvá generace, viz
          // komentář u genCounter.img1k v editSceneImage níž) — na rozdíl od MAJOR
          // (rozbitý styl, cizí podoba, špatný počet lidí), kde se opravuje pořád,
          // bez ohledu na velikost obsazení. Scény s 3+ lidmi zůstávají na PLNÉ
          // přísnosti (MODERATE i MAJOR se opravují) — tam je prostoru na záměnu
          // identit/proporcí podstatně víc, riziko tolerance vyšší.
          const sceneCastCount = (sceneCastList(scene.imagePrompt) || "").split(",").map(s => s.trim()).filter(Boolean).length;
          const lenientScene = sceneCastCount > 0 && sceneCastCount <= 2;
          if (v0 && !v0.ok && lenientScene && !v0.findings.some(f => f.severity === "MAJOR")) {
            console.log(`[Gemini QA] scene ${scene.index}: jen MODERATE nález na ${sceneCastCount}-osobové scéně → odlehčený režim, tolerováno bez opravy (${v0.problems})`);
          } else if (v0 && !v0.ok && deadline !== undefined && Date.now() > deadline) {
            console.warn(`[Gemini QA] scene ${scene.index}: REJECTED [${v0.badRules} rules] (${v0.problems}) but DEADLINE passed → accepted as-is, no redraw`);
          } else if (v0 && !v0.ok) {
            let best = { img, badRules: v0.badRules, problems: v0.problems };
            // 🎯 Jedno opravné kolo — ale podle ZÁVAŽNOSTI: drobné vady
            // (barva očí, chybějící mašle) se cíleně DOEDITUJÍ na hotovém
            // obrázku, jen skutečné rozbití (styl, měřítko, ořez, cizí
            // podoba) si vyžádá celé nové překreslení. Dřív se za plnou cenu
            // překreslovalo VŠECHNO včetně kosmetiky — 7 z 10 scén, z toho
            // 3 opravy nespravily nic.
            const useEdit = v0.action === "EDIT" && !!v0.fixInstruction;
            for (let fix = 1; fix <= 1 && best.badRules > 0 && !(deadline !== undefined && Date.now() > deadline); fix++) {
              console.warn(`[Gemini QA] scene ${scene.index}: ${v0.action} [${best.badRules}] (${best.problems}) → ${useEdit ? "targeted edit" : "full redraw"}`);
              try {
                const img2 = useEdit
                  ? await editSceneImage(apiKey, m, best.img, v0.fixInstruction, refImages, withAspect ? "16:9" : null)
                  : await callGeminiImage(
                      apiKey, m,
                      `${safePrompt} ⚠ CORRECTION: the previous attempt violated these rules: ${best.problems}. Fix EXACTLY these issues — follow the APPEARANCE LOCK precisely, draw ONLY the named characters, each EXACTLY ONCE, with their own hair colors and outfits.`,
                      withAspect ? "16:9" : null, refImages
                    );
                const v2 = await verifySceneImage(apiKey, img2, heroDescription, scene.imagePrompt, refImages, deadline);
                if (v2 && (v2.ok || v2.badRules < best.badRules)) {
                  best = { img: img2, badRules: v2.ok ? 0 : v2.badRules, problems: v2.problems };
                }
              } catch (e2) {
                console.warn(`[Gemini QA] scene ${scene.index}: ${useEdit ? "edit" : "redraw"} failed (${e2 instanceof Error ? e2.message : e2})`);
              }
            }
            img = best.img;
            if (best.badRules > 0) console.warn(`[Gemini QA] scene ${scene.index}: still imperfect [${best.badRules}] (${best.problems})`);
            else console.log(`[Gemini QA] scene ${scene.index}: fixed ✓`);
          } else if (v0 && v0.ok && v0.findings.length > 0) {
            // Prošlo, ale s tolerovanými drobnostmi — zalogovat, ať je vidět,
            // co všechno tolerance propouští (podklad pro ladění pásem)
            console.log(`[Gemini QA] scene ${scene.index}: OK s tolerancí — ${v0.problems}`);
          }
        }
        return await compressImage(img);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        console.error(`[Gemini] scene ${scene.index} model=${m} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastErr.message}`);
        // Older image models don't know imageConfig/aspectRatio — retry without it
        if (withAspect && /image_config|imageConfig|aspect_ratio|aspectRatio|Unknown name/i.test(lastErr.message)) {
          withAspect = false;
          continue;
        }
        // Denní strop / vyčerpaný kredit: NEOPAKOVAT (reset je za hodiny) —
        // rovnou přejít na záložní model
        if (isDailyQuotaError(lastErr.message)) {
          quotaHits++;
          dailyCapped = true;
          break;
        }
        const isRateLimit = lastErr.message.startsWith("Gemini 429");
        const isBlocked = lastErr.message.startsWith("Gemini BLOCKED");
        // Filtr obsahu zablokoval → teprv teď se prompt přepíše LLM sanitizací
        if (isBlocked && !llmSanitized) {
          llmSanitized = true;
          safePrompt = await sanitizeWithGemini(apiKey, rawPrompt);
          console.log(`[Gemini] scene ${scene.index}: BLOCKED → LLM sanitized (${safePrompt.length} chars)`);
          continue;
        }
        if ((lastErr.message.match(/^Gemini 4/) && !isRateLimit) || isBlocked) break;
        if (attempt < MAX_ATTEMPTS) {
          const delay = isRateLimit ? 15000 * attempt : 5000 * attempt;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    if (!dailyCapped) break; // jiná chyba než kvóta → záložní model nepomůže
    if (dailyCapped && m !== models[models.length - 1]) {
      console.warn(`[Gemini] scene ${scene.index}: model ${m} na denním stropu → zkouším ${models[models.length - 1]}`);
    }
  }

  // Všechny modely na denním stropu → signál pro job-runner, ať job zastaví
  if (quotaHits >= models.length) {
    throw new Error(`QUOTA_DAILY [scene ${scene.index}] ${lastErr.message}`);
  }

  // Last resort for persistently blocked prompts: draw the SAME characters in a
  // gentle generic moment inspired by the narration — better than a missing image
  if (!isDailyQuotaError(lastErr.message)) {
    try {
      const fallbackRaw = [
        charLockOpen,
        `The named characters stand together smiling, in a gentle scene inspired by this story moment: ${scene.narration.slice(0, 140)}`,
        charLockClose,
        STYLE_SUFFIX,
      ].filter(Boolean).join(" ");
      const safeFallback = await sanitizeWithGemini(apiKey, fallbackRaw);
      console.warn(`[Gemini] scene ${scene.index}: using simplified fallback prompt`);
      return await compressImage(await callGeminiImage(apiKey, model, safeFallback, withAspect ? "16:9" : null, refImages));
    } catch (e2) {
      console.error(`[Gemini] scene ${scene.index} fallback failed: ${e2 instanceof Error ? e2.message : e2}`);
    }
  }

  throw new Error(`[scene ${scene.index}] ${lastErr.message}`);
}

// ── 🗂️ Arch scén: víc scén v JEDNOM obrázku, pak rozřezat ────────────────────
// Gemini účtuje za obrázek (podle rozlišení), ne za obsah — 3×3 arch ve 4K
// stojí $0,151 a nese až 9 scén (0,39 Kč/scénu místo 1,56 Kč), výřez 1834×1024
// je nad dnešní kvalitou. Bonus: scény z jednoho tahu jsou přirozeně
// konzistentní. Pojistky: řez jen když jsou mezery opravdu bílé (jinak se
// arch zamítne), jedenáctero na KAŽDÝ výřez zvlášť, až 2 překreslení archu
// s výčtem chyb; panely, které ani pak neprojdou, vrací null a volající je
// dokreslí sólo cestou (generateSceneImage).

/** Ověří bílé dělicí linky a rozřeže arch na grid×grid výřezů (s malým
 *  odsazením, ať v obraze nezůstanou zbytky mezer). Vrací null, když mřížka
 *  nesedí — takový arch se nesmí řezat. */
async function sliceSheet(img: ImageResult, grid: number, allowFixedGridFallback = false): Promise<ImageResult[] | null> {
  try {
    const sharp = (await import("sharp")).default;
    const { data, info } = await sharp(img.buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
    const lum = (x: number, y: number) => data[y * info.width + x];
    const lineWhite = (vertical: boolean, pos: number): number => {
      let sum = 0, cnt = 0;
      const range = vertical ? info.height : info.width;
      for (let t = 0; t < range; t += 9) {
        for (let o = -4; o <= 4; o += 2) {
          const x = vertical ? pos + o : t;
          const y = vertical ? t : pos + o;
          if (x >= 0 && x < info.width && y >= 0 && y < info.height) { sum += lum(x, y); cnt += 1; }
        }
      }
      return cnt ? sum / cnt : 0;
    };
    // 🎯 Model občas netrefí dělicí linku PŘESNĚ na 1/grid, 2/grid… (pár px
    // odchylka) — dřív to celý arch zahodilo (mřížka „nesedí"), i když byl
    // vizuálně v pořádku, a drahý 4K pokus přišel vniveč (plus následné sólo
    // dokreslení všech scén za plnou cenu). Teď se v okolí očekávané pozice
    // (±4 % rozměru) hledá NEJBĚLEJŠÍ linka a řeže se přesně tam.
    const findLine = (vertical: boolean, size: number, k: number): number | null => {
      const expected = Math.round((size * k) / grid);
      const span = Math.round(size * 0.04);
      let best = expected, bestWhite = -1;
      for (let p = Math.max(4, expected - span); p <= Math.min(size - 4, expected + span); p += 2) {
        const w = lineWhite(vertical, p);
        if (w > bestWhite) { bestWhite = w; best = p; }
      }
      return bestWhite >= 195 ? best : null;
    };
    const vLines: number[] = [0];
    const hLines: number[] = [0];
    let usedFixedGrid = false;
    for (let k = 1; k < grid; k++) {
      const vx = findLine(true, info.width, k);
      const hy = findLine(false, info.height, k);
      if (vx === null || hy === null) {
        if (!allowFixedGridFallback) {
          console.warn(`[Gemini sheet] mřížka nesedí (linka ${k}/${grid} nenalezena) → arch zamítnut`);
          return null;
        }
        usedFixedGrid = true;
        break;
      }
      vLines.push(vx);
      hLines.push(hy);
    }
    if (usedFixedGrid) {
      vLines.length = 1;
      hLines.length = 1;
      for (let k = 1; k < grid; k++) {
        vLines.push(Math.round((info.width * k) / grid));
        hLines.push(Math.round((info.height * k) / grid));
      }
      console.warn(`[Gemini sheet] bílé linky nenalezeny → pevný ${grid}×${grid} řez; každý panel ještě rozhodne vision QA`);
    }
    vLines.push(info.width);
    hLines.push(info.height);
    const out: ImageResult[] = [];
    for (let r = 0; r < grid; r++) {
      for (let c = 0; c < grid; c++) {
        const left = vLines[c], right = vLines[c + 1];
        const top = hLines[r], bottom = hLines[r + 1];
        const gx = Math.round((right - left) * 0.015); // odsazení od bílých mezer
        const gy = Math.round((bottom - top) * 0.015);
        const buf = await sharp(img.buffer)
          .extract({ left: left + gx, top: top + gy, width: Math.max(1, right - left - 2 * gx), height: Math.max(1, bottom - top - 2 * gy) })
          .png()
          .toBuffer();
        out.push({ buffer: buf, mimeType: "image/png" });
      }
    }
    return out;
  } catch (e) {
    console.warn(`[Gemini sheet] slice failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Vygeneruje 2–9 scén jedním archem (2×2 pro ≤4, jinak 3×3; volné buňky se
 * vyplní prázdnou scenérií). Vrací výřezy délky scenes.length — prošlé jako
 * ImageResult, neprošlé/nedokreslené jako null (dokreslí se sólo) — a report
 * s důvody zamítnutí (archy běží i paralelně, report nesmí být globální).
 * Při nefunkční mřížce / nepodpoře 4K vyhodí chybu → volající jde sólo cestou.
 */
export async function generateSceneSheet(
  scenes: Scene[],
  heroDescription: string,
  refImages: ReferenceImage[] = [],
  correction = "", // výtky z minulé vlny — arch se kreslí S KOREKCÍ, ne naslepo znovu
  // ⚡ Volitelný callback: zavolá se, JAKMILE je hotový KAŽDÝ jednotlivý panel
  // (po vlastní editaci/QA), místo čekání na celý arch — volající tak může
  // uložit a zobrazit scénu hned, ne až po nejpomalejším panelu z 6-9.
  onPanelReady?: (i: number, result: ImageResult | null) => void | Promise<void>,
  options: {
    /** Epoch ms. Po deadline se už nespouští placená oprava panelu. */
    deadline?: number;
    /** Stejná politika jako solo scény: MODERATE u 1–2 lidí přijmout. */
    lenientSimplePanels?: boolean;
    /** Kolikrát nejvýš znovu vyrábět celý 4K arch kvůli rozbité mřížce. */
    maxGridAttempts?: number;
    /** Sdílený budget placených panelových editací na celý arch. */
    maxPanelEdits?: number;
    /** Bez bílých linek zkusit pevné třetiny; panelová vision QA stále platí. */
    allowFixedGridFallback?: boolean;
  } = {}
): Promise<{ results: Array<ImageResult | null>; report: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = IMAGE_MODEL.trim();
  const n = scenes.length;
  if (n < 2 || n > 9) throw new Error(`sheet: nepodporovaný počet scén ${n}`);
  const grid = n <= 4 ? 2 : 3;
  const cells = grid * grid;

  const { open: lockOpen, close: lockClose } = buildAppearanceLock(heroDescription);
  const panelLines: string[] = [];
  for (let i = 0; i < cells; i++) {
    const r = Math.floor(i / grid) + 1;
    const c = (i % grid) + 1;
    if (i < n) {
      const cast = sceneCastList(scenes[i].imagePrompt);
      panelLines.push(
        `PANEL ${i + 1} (row ${r}, column ${c})${cast ? ` — CAST: ONLY ${cast}, nobody else` : ""}: ${scenes[i].imagePrompt}`
      );
    } else {
      panelLines.push(`PANEL ${i + 1} (row ${r}, column ${c}) — CAST: nobody: a quiet, empty scenery view from the same story world — NO people, NO creatures.`);
    }
  }
  const gutterPos = grid === 2
    ? "exactly through the horizontal and vertical center of the image"
    : "at exactly one-third and two-thirds of the image width and height";
  const rawPrompt = [
    `A single image divided into EXACTLY ${cells} equal rectangular panels in a ${grid}×${grid} grid (${grid} columns, ${grid} rows), separated by STRAIGHT, THICK, PURE-WHITE gutters ${gutterPos}. Each panel is one scene of the SAME storybook, drawn edge to edge inside its panel.`,
    `Compose each panel like a FINISHED book illustration: every character and every key object (boat, vehicle, building, the moon…) FULLY inside its panel with a comfortable breathing margin — nothing important may touch or cross the white gutters or panel edges. No cropped heads, no half-cut characters or objects.`,
    lockOpen,
    ...panelLines,
    `⚠ PANEL CAST RULE: each panel shows ONLY the characters listed in its own CAST — nobody else. A character NOT listed in a panel's CAST must NOT appear in that panel, even though their reference photo or description is provided for other panels. A character LISTED in a panel's CAST must NOT be missing or replaced by a generic/unnamed figure. NEVER invent an extra person who merely resembles a named character (e.g. another small child who looks like one of the heroes) — if a panel's CAST doesn't include them, that person is simply not in the panel at all, not replaced by a look-alike. EXCEPTION: when a panel's CAST or description mentions a group (a team, other players, opponents, the crowd…), paint that group as smaller BACKGROUND figures who never resemble the named heroes.`,
    correction ? `⚠ CORRECTION — a previous attempt violated these rules, fix EXACTLY these issues: ${correction.slice(0, 600)}` : "",
    lockClose,
    STYLE_SUFFIX,
  ].filter(Boolean).join(" ");
  // ⚡ Líná sanitizace jako u sólo scén (LLM přepis až po skutečné blokaci)
  let safePrompt = regexSanitize(rawPrompt);
  let llmSanitized = false;
  console.log(`[Gemini sheet] ${n} scén v mřížce ${grid}×${grid}, model=${model} (${safePrompt.length} chars)`);

  // ČASOVÝ ROZPOČET: arch se generuje JEDNOU (+1 pokus jen při rozbité
  // mřížce) a vadné panely jdou rovnou sólo cestou — celoarchová QA
  // překreslení se nevešla do 5min limitu funkce a job se točil dokola.
  let slices: ImageResult[] | null = null;
  const maxGridAttempts = Math.max(1, Math.min(2, options.maxGridAttempts ?? 2));
  for (let attempt = 1; attempt <= maxGridAttempts && !slices; attempt++) {
    let sheet: ImageResult;
    try {
      sheet = await callGeminiImage(
        apiKey, model,
        attempt === 1
          ? safePrompt
          : `${safePrompt} ⚠ CORRECTION: the previous attempt did not have straight clean white gutters at the exact grid positions — redraw with a PRECISE ${grid}×${grid} grid.`,
        "16:9", refImages, "4K"
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.startsWith("Gemini BLOCKED") && !llmSanitized) {
        llmSanitized = true;
        safePrompt = await sanitizeWithGemini(apiKey, rawPrompt);
        attempt--; // blokace nespotřebuje pokus — zkusí se s přepsaným promptem
        continue;
      }
      throw e;
    }
    slices = await sliceSheet(sheet, grid, options.allowFixedGridFallback === true);
    if (!slices) console.warn(`[Gemini sheet] attempt ${attempt}: mřížka nesedí`);
  }
  if (!slices) throw new Error("sheet: mřížka se nepodařila nakreslit");

  // Jedenáctero na každý výřez zvlášť — paralelně po 4 (všech 9 naráz
  // umělo vyčerpat rate-limit kontrolního modelu → kontrola selhala
  // a NEOVĚŘENÝ panel dřív proklouzl bez prohlídky)
  const verdicts: Array<QaVerdict | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i += 4) {
    const chunk = await Promise.all(
      Array.from({ length: Math.min(4, n - i) }, (_, j) =>
        verifySceneImage(apiKey, slices![i + j], heroDescription, scenes[i + j].imagePrompt, refImages, options.deadline)
      )
    );
    chunk.forEach((v, j) => { verdicts[i + j] = v; });
  }
  const out: Array<ImageResult | null> = new Array(n).fill(null);
  const reasons: string[] = new Array(n).fill("");
  // ⚡ Oprava panelů běžela dřív SEKVENČNĚ (jeden editSceneImage+reverify po
  // druhém) — u archu se 3+ vadnými panely to samo o sobě přidávalo desítky
  // sekund navíc PŘED tím, než se uložil byť jediný obrázek (appka reportovala
  // „obrázky se načítají dlouho potom co se pohádka načte"). Teď běží
  // souběžně a KAŽDÝ panel se přes onPanelReady uloží hned, jak je hotový —
  // ne až po tom nejpomalejším z celého archu. ALE po stejných dávkách po 4
  // jako verifikace výš — reálný test (v4.99.20→21) ukázal, že VŠECH až 6
  // editSceneImage+verifySceneImage najednou umí vyčerpat rate-limit
  // kontrolního modelu úplně stejně jako kdysi 9 souběžných verify (0/6
  // panelů prošlo, log plný „QA verdict missing JSON").
  let panelEditsClaimed = 0;
  const doPanel = async (i: number) => {
    const v = verdicts[i];
    let result: ImageResult | null = null;
    const sceneCastCount = (sceneCastList(scenes[i].imagePrompt) || "").split(",").map(s => s.trim()).filter(Boolean).length;
    const lenientModerate = !!v && !v.ok && options.lenientSimplePanels === true &&
      sceneCastCount > 0 && sceneCastCount <= 2 && !v.findings.some(f => f.severity === "MAJOR");
    if (lenientModerate) {
      console.log(`[Gemini sheet] panel ${i + 1}: jen MODERATE nález na ${sceneCastCount}-osobové scéně → přijato bez placené opravy (${v.problems})`);
      result = await compressImage(slices![i]);
    }
    // 🖌️ Panel s drobnou vadou se NEZAHAZUJE do sóla (to je nejdražší cesta —
    // arch je flat-price, sólo stojí plnou cenu za každou scénu): zkusí se
    // cílená editace přímo na výřezu. Sólo zůstává jen pro skutečné rozbití.
    const editBudget = Math.max(0, options.maxPanelEdits ?? Number.POSITIVE_INFINITY);
    const mayEdit = !result && v && !v.ok && v.action === "EDIT" && !!v.fixInstruction &&
      !(options.deadline !== undefined && Date.now() > options.deadline) && panelEditsClaimed < editBudget;
    if (mayEdit) {
      panelEditsClaimed += 1;
      try {
        const fixed = await editSceneImage(apiKey, model, slices![i], v!.fixInstruction, refImages, null);
        const v2 = await verifySceneImage(apiKey, fixed, heroDescription, scenes[i].imagePrompt, refImages, options.deadline);
        if (v2 && v2.ok) {
          console.log(`[Gemini sheet] panel ${i + 1}: drobná vada doeditována ✓`);
          result = await compressImage(fixed);
        }
      } catch (e) {
        console.warn(`[Gemini sheet] panel ${i + 1}: editace selhala (${e instanceof Error ? e.message : e}) → sólo`);
      }
    }
    if (!result) {
      if (!v || !v.ok) {
        // ZPŘÍSNĚNO: neověřitelný panel (kontrola 3× selhala) se NEpřijímá —
        // jde na sólo dokreslení s vlastní QA, stejně jako zamítnutý
        reasons[i] = `p${i + 1}: ${v ? v.problems.slice(0, 70) : "NEOVĚŘEN (kontrola nedostupná)"}`;
        console.warn(`[Gemini sheet] panel ${i + 1} ${v ? `zamítnut (${v.problems.slice(0, 160)})` : "NEOVĚŘEN (kontrola selhala)"} → sólo`);
      } else {
        if (v.findings.length > 0) console.log(`[Gemini sheet] panel ${i + 1}: OK s tolerancí — ${v.problems}`);
        result = await compressImage(slices![i]);
      }
    }
    out[i] = result;
    await onPanelReady?.(i, result);
  };
  for (let i = 0; i < n; i += 4) {
    await Promise.all(Array.from({ length: Math.min(4, n - i) }, (_, j) => doPanel(i + j)));
  }
  console.log(`[Gemini sheet] hotovo: ${out.filter(Boolean).length}/${n} panelů prošlo (zbytek sólo)`);
  return { results: out, report: reasons.filter(Boolean).slice(0, 4).join(" | ") };
}
