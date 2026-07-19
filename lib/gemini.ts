import { request } from "https";
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
export const genCounter = { img1k: 0, img4k: 0 };

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
                if (imageSize === "4K") genCounter.img4k += 1; else genCounter.img1k += 1;
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
export async function verifySceneImage(
  apiKey: string, img: ImageResult, heroDescription: string, scenePrompt = "",
  refs: ReferenceImage[] = [], // 🕵️ kanonické portréty — inspektor porovnává TVÁŘE, ne jen text
  deadline?: number
): Promise<{ ok: boolean; problems: string; badRules: number } | null> {
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
              "Run this TWELVE-RULE checklist and FAIL the image on ANY violation:",
              "0) STYLE: the image MUST be a hand-painted 2D storybook ILLUSTRATION. A photograph, photorealistic render, 3D/CGI look, or stock-photo style image = FAIL immediately (this alone fails the image, regardless of content).",
              "1) IDENTIFY every visible person one by one and match each to a named character by hair, face and outfit. COUNT them: the number of visible people MUST EQUAL the number of characters named in the scene description — more OR fewer = FAIL. ANY person you cannot confidently match (extra child, stranger, background figure) = FAIL. A character named in the scene description who is MISSING = FAIL. A person who mixes features of TWO characters (one character's face with another's outfit or hairstyle — swapped/merged identities) = FAIL. EXCEPTION: when the scene description itself mentions a GROUP (a team, other players, opponents, the crowd, the audience, villagers…), unnamed background figures belonging to that group are ALLOWED — list them as 'group:<what>' in people, they don't fail the count; but none of them may look like a copy of a named hero.",
              "2) Each named character appears EXACTLY ONCE — two similar children or two similar adults = FAIL.",
              "3) HAIR COLOR of EVERY person matches their sheet entry (blond stays blond, brown stays brown, dark stays dark) — check person by person. SKIN TONE/ethnicity must also match (a character described with fair light skin drawn as a different ethnicity/race, or vice versa, = FAIL) — but ALLOW natural lighting variation: a slightly warmer, sun-kissed, tanned or shadowed rendering of the SAME underlying skin tone (e.g. bright outdoor/beach/summer light) is NOT a violation. Only flag a clear ethnicity/race change, not a shade difference plausibly caused by lighting.",
              "4) Hair LENGTH and STYLE match the sheet (short stays short, long stays long; beard per sheet).",
              "5) CLOTHING: each character wears THEIR OWN outfit (or their 'Story outfits:'/'Team kits:' variant for this scene). A signature outfit on the WRONG person (e.g. a different child wearing Nicolas's white T-shirt with red stripes) = FAIL. The SAME signature garment on TWO different people (two lilac hoodies, two striped polos) = FAIL. An adult's signature outfit worn by a child (or vice versa) = FAIL. If the sheet has a 'Team kits:' entry and this scene shows that group activity happening, everyone taking part MUST wear their group's stated uniform, NOT default/casual clothes — someone in everyday clothes during the activity = FAIL; members of the SAME group must all match each other's uniform, a rival/opposing group must be in their clearly different stated uniform.",
              "6) Dressing level is UNIFORM for the scene: no winter coat next to a T-shirt; indoors without jackets/hats; never summer clothes in snow.",
              "7) BODY PROPORTIONS: children child-sized, adults adult-sized, relative heights per the 'Heights:' entry — UNLESS the scene description above explicitly states a DIFFERENT height/size relationship for this scene (a deliberate story-driven transformation like a growth spurt or magical size change); when it does, judge against THAT instead and do not fail for matching it.",
              "8) ANATOMY: exactly two arms, two legs, five fingers per hand, natural faces; bicycles have two wheels.",
              "9) KEY OBJECTS identical to their sheet entry — the same vehicle/boat/toy type and colors as stated. Each key object appears EXACTLY ONCE — two copies of the same boat/lighthouse/vehicle in one image = FAIL (unless the scene explicitly says otherwise).",
              "10) NO text, letters, watermarks or signatures anywhere in the image. EXCEPTION: a scoreboard may show ONLY the score as plain digits (e.g. '2:1') — but team/country abbreviations or any other letters ON the scoreboard (or anywhere else) still FAIL.",
              "11) FRAMING: nothing important is CUT OFF by the image edges — no cropped heads or faces, no half-cut characters, and no key objects (boat, vehicle, building, the moon…) sliced by the border. Background scenery may naturally continue past the edge.",
              "12) SETTING: if the sheet contains a 'World & setting lock', the scene's venue must MATCH it — e.g. a football match happens ON a proper pitch with lines and goals (never on a river bank), a named real person looks like the described HUMAN.",
              ...(refParts.length ? [
                "13) IDENTITY MATCH TO REFERENCES: compare EVERY visible named character against their REFERENCE image above — it must clearly be the SAME person: same face, same underlying SKIN TONE/ethnicity, same hair color and style, same apparent AGE and BODY SIZE (a small child in the reference must stay a small child — drawn as a teenager or adult = FAIL; an adult must stay an adult), same signature outfit. A character who looks like a DIFFERENT person than their reference (different ethnicity, different age, different face) = FAIL. Do NOT fail for lighting-only differences (sun-tanned, warmer/cooler color grading, shadows, golden-hour light) when the person is otherwise clearly the same individual — judge the underlying tone, not the lighting. EXCEPTION: if the scene description explicitly states this character is now a different height/size (a deliberate story-driven transformation), a body-size difference from the reference is CORRECT, not a fail — still check face/hair/ethnicity/outfit match.",
              ] : []),
              "Minor painterly variation is fine — but violations of the rules above are NEVER minor.",
              'Reply with ONLY JSON. ALWAYS include a "people" audit — list every visible person as "<who you matched them to or UNKNOWN>". Passing image: {"people":["Nicolas","Valentýna"],"ok":true}. Failing image: {"people":[...],"ok":false,"rules":[<numbers of violated rules>],"problems":"<max 60 words: per violated rule a short English reason>"}. Any UNKNOWN in people means rule 1 failed.',
            ].join("\n") },
          ],
        }],
        // thinkingBudget 0 je KRITICKÝ: gemini-2.5-flash jinak „přemýšlí"
        // ~475 tokenů z limitu a verdikt se UTRHNE (finish=MAX_TOKENS) —
        // kontrola pak tiše neběžela a vadné obrázky procházely neověřené.
        // (jen pro 2.5 — jiné verify modely parametr neznají a vrátily by 400)
        generationConfig: {
          maxOutputTokens: 700,
          responseMimeType: "application/json",
          ...(VERIFY_MODEL.includes("2.5") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
        },
      }, GEMINI_VERIFY_TIMEOUT_MS);
      const data = JSON.parse(raw) as { candidates?: GeminiCandidate[] };
      const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("QA verdict missing JSON");
      const v = JSON.parse(m[0]) as { ok?: boolean; rules?: number[]; problems?: string; people?: string[] };
      let ok = v.ok !== false;
      let problems = String(v.problems || "").slice(0, 400);
      // Pojistka: inspektor vyjmenoval osobu, kterou nepřiřadil k žádné
      // postavě (UNKNOWN) — cizí člověk v obraze, i kdyby dal ok:true
      // (osoby smí být řetězce i objekty {name: …} — kontrola přes JSON)
      if (ok && Array.isArray(v.people) && /unknown|stranger/i.test(JSON.stringify(v.people))) {
        ok = false;
        problems = "rule 1: an unmatched person (stranger/extra figure) is present";
      }
      const badRules = ok ? 0 : Math.max(1, Array.isArray(v.rules) ? v.rules.length : 1);
      return { ok, problems, badRules };
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

// Pozadí aplikace — ilustrovaná scenérie ve stejném stylu jako pohádky,
// na výšku (telefon). Volitelně s referenčními fotkami postav (Nicolásek
// a Valentýnka bývají součástí každého světa). Prompt je bezpečný a pevně
// daný (lib/backgrounds.ts), sanitizace není potřeba.
export async function generateBackgroundImage(prompt: string, refImages: ReferenceImage[] = []): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = IMAGE_MODEL.trim();
  let aspect: string | null = "9:16";
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

// 🎯 Vytáhne jmenovaný obsazovací seznam ze zavedené konvence, kterou vypravěč
// VŽDY píše na konec imagePromptu ("Only X, Y present — no other people…").
// Používá se jak pro explicitní "CAST:" popisek panelu v archu, tak pro
// seskupování scén se STEJNÝM obsazením do jednoho archu (job-runner.ts) —
// méně různých lidí v jednom obrázku = menší riziko zaměněných identit.
export function sceneCastList(imagePrompt: string): string | null {
  const m = /Only\s+([^—-]+?)\s+present\b/i.exec(imagePrompt);
  return m ? m[1].trim() : null;
}

// Sdílené stavební kameny promptů (sólo obrázek i arch scén)
const STYLE_SUFFIX ="Hand-painted 2D storybook illustration, soft painterly brushwork in classic Disney animated-film style, warm cinematic lighting, rich saturated colors, expressive faces, landscape orientation. Strictly FLAT 2D painting — NOT a 3D render, no CGI, no plastic skin, no photorealism. Correct natural anatomy: every person has EXACTLY two arms, two legs and five fingers on each hand — no extra, missing or deformed limbs; bicycles have exactly two wheels. Absolutely no text, letters, words, signs, labels, captions, subtitles, watermarks, or artist signatures of any kind anywhere in the image.";

function buildAppearanceLock(heroDescription: string): { open: string; close: string } {
  if (!heroDescription) return { open: "", close: "" };
  return {
    open: [
      `⚠ APPEARANCE LOCK — IMMUTABLE across every image in this story:`,
      heroDescription,
      `Every named character MUST look IDENTICAL to this description in EVERY image: same hair color, same hair style, same eye color, same exact clothing items and colors, same shoes — AND the same AGE, same BODY SIZE and PROPORTIONS. Relative heights between characters NEVER change: a toddler stays toddler-sized, a child stays child-sized, adults stay adult-sized. Any recurring OBJECT listed above (vehicle, magic item, toy) keeps IDENTICAL type, shape and colors in every scene — the same car stays the same car, and each key object exists ONCE in the world: NEVER draw two copies of it in one image. These are LOCKED — do NOT change anything between scenes.`,
      `If 'Story outfits:' defines outdoor/indoor variants, draw the variant stated at the end of the scene description — and ALL characters in the scene share the SAME dressing level (never one in a winter coat while another wears a T-shirt).`,
      `ONLY the characters named in the scene are visible — zero additional people, strangers, or background human figures (EXCEPTION: a group the scene itself mentions — a team, opponents, the crowd — may appear as smaller background figures who never resemble the named heroes). Each named character appears EXACTLY ONCE in the image — NEVER draw two copies of the same person.`,
      `IDENTITIES ARE SEPARATE: characters who look similar (two adult men, two adult women, two boys) are DIFFERENT people — NEVER merge them, swap them, or mix their features. Each keeps their OWN hair, face, build and signature clothing exactly as listed. A reference portrait may ONLY be used for the character it belongs to.`,
      `DIRECTION OF ADAPTATION: when animals, creatures or any OTHER characters NOT listed above also appear in this scene, THEY must be drawn to fit this story's established art style and world — the characters listed above NEVER shift their proportions, body size, art style, or color palette to match the newcomers. A named character listed above looks EXACTLY as identical whether alone or surrounded by ten invented animal characters.`,
      `ABSENCE IS ALSO LOCKED: if the description above does NOT mention a feature (no beard/moustache mentioned, no glasses mentioned, no hat mentioned), draw the character WITHOUT it — never add facial hair, glasses, or accessories the description doesn't state, and never remove ones it does state. Facial hair in particular is a common slip: a clean-shaven face stated or implied above must stay clean-shaven in every single scene, never stubble, never a beard.`,
    ].join(" "),
    close: `⚠ CONSISTENCY REMINDER: match hair, eyes, clothing, age, body size and relative heights EXACTLY as stated above — do NOT alter any detail.`,
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
        // Desatero konzistence: každý obrázek projde kontrolou; vadný se
        // překresluje — 2 opravná kola s výčtem chyb + 1 ČERSTVÉ překreslení
        // (nový pokus bez korekce často opraví, co korekce nespraví).
        // Drží se NEJLEPŠÍ OVĚŘENÝ pokus (nejméně porušených pravidel) —
        // neověřený obrázek nikdy nenahradí ověřený.
        // 💰 Scény BEZ jmenované postavy (čistě scenérie/atmosféra) nemají
        // žádnou identitu k ochraně — kontrola + případné překreslení tam jen
        // pálí náklady bez přínosu. Stejný signál (sceneCastList === null)
        // už appka spolehlivě používá i pro "CAST: nobody" v archových panelech.
        if (heroDescription && sceneCastList(scene.imagePrompt)) {
          let v0 = await verifySceneImage(apiKey, img, heroDescription, scene.imagePrompt, refImages, deadline);
          if (!v0 && !(deadline !== undefined && Date.now() > deadline)) {
            // Kontrola 2× selhala (typicky rate-limit) → po pauze ještě jednou;
            // teprve pak se obrázek přijme s varováním (jinak by se nic nedokreslilo)
            await new Promise(r => setTimeout(r, 6000));
            v0 = await verifySceneImage(apiKey, img, heroDescription, scene.imagePrompt, refImages, deadline);
            if (!v0) console.warn(`[Gemini QA] scene ${scene.index}: kontrola opakovaně selhala — obrázek přijat NEOVĚŘENÝ`);
          }
          if (v0 && !v0.ok && deadline !== undefined && Date.now() > deadline) {
            console.warn(`[Gemini QA] scene ${scene.index}: REJECTED [${v0.badRules} rules] (${v0.problems}) but DEADLINE passed → accepted as-is, no redraw`);
          } else if (v0 && !v0.ok) {
            let best = { img, badRules: v0.badRules, problems: v0.problems };
            // 1 kolo (jen cílená korekce s výčtem porušených pravidel) — cena
            // vs. kvalita: méně kol = nižší náklad na scénách, které mají
            // problém, ale víc nedokonalých obrázků projde bez další opravy
            for (let fix = 1; fix <= 1 && best.badRules > 0 && !(deadline !== undefined && Date.now() > deadline); fix++) {
              console.warn(`[Gemini QA] scene ${scene.index}: REJECTED [${best.badRules} rules] (${best.problems}) → correction`);
              try {
                const prompt2 = `${safePrompt} ⚠ CORRECTION: the previous attempt violated these rules: ${best.problems}. Fix EXACTLY these issues — follow the APPEARANCE LOCK precisely, draw ONLY the named characters, each EXACTLY ONCE, with their own hair colors and outfits.`;
                const img2 = await callGeminiImage(apiKey, m, prompt2, withAspect ? "16:9" : null, refImages);
                const v2 = await verifySceneImage(apiKey, img2, heroDescription, scene.imagePrompt, refImages, deadline);
                if (v2 && (v2.ok || v2.badRules < best.badRules)) {
                  best = { img: img2, badRules: v2.ok ? 0 : v2.badRules, problems: v2.problems };
                }
              } catch (e2) {
                console.warn(`[Gemini QA] scene ${scene.index}: redraw failed (${e2 instanceof Error ? e2.message : e2})`);
              }
            }
            img = best.img;
            if (best.badRules > 0) console.warn(`[Gemini QA] scene ${scene.index}: still imperfect after redraw [${best.badRules} rules] (${best.problems})`);
            else console.log(`[Gemini QA] scene ${scene.index}: fixed after redraw ✓`);
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
async function sliceSheet(img: ImageResult, grid: number): Promise<ImageResult[] | null> {
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
    for (let k = 1; k < grid; k++) {
      const vx = findLine(true, info.width, k);
      const hy = findLine(false, info.height, k);
      if (vx === null || hy === null) {
        console.warn(`[Gemini sheet] mřížka nesedí (linka ${k}/${grid} nenalezena) → arch zamítnut`);
        return null;
      }
      vLines.push(vx);
      hLines.push(hy);
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
  correction = "" // výtky z minulé vlny — arch se kreslí S KOREKCÍ, ne naslepo znovu
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
  for (let attempt = 1; attempt <= 2 && !slices; attempt++) {
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
    slices = await sliceSheet(sheet, grid);
    if (!slices) console.warn(`[Gemini sheet] attempt ${attempt}: mřížka nesedí`);
  }
  if (!slices) throw new Error("sheet: mřížka se nepodařila nakreslit");

  // Jedenáctero na každý výřez zvlášť — paralelně po 4 (všech 9 naráz
  // umělo vyčerpat rate-limit kontrolního modelu → kontrola selhala
  // a NEOVĚŘENÝ panel dřív proklouzl bez prohlídky)
  const verdicts: Array<{ ok: boolean; problems: string; badRules: number } | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i += 4) {
    const chunk = await Promise.all(
      Array.from({ length: Math.min(4, n - i) }, (_, j) =>
        verifySceneImage(apiKey, slices![i + j], heroDescription, scenes[i + j].imagePrompt, refImages)
      )
    );
    chunk.forEach((v, j) => { verdicts[i + j] = v; });
  }
  const out: Array<ImageResult | null> = [];
  const reasons: string[] = [];
  for (let i = 0; i < n; i++) {
    const v = verdicts[i];
    if (!v || !v.ok) {
      // ZPŘÍSNĚNO: neověřitelný panel (kontrola 3× selhala) se NEpřijímá —
      // jde na sólo dokreslení s vlastní QA, stejně jako zamítnutý
      reasons.push(`p${i + 1}: ${v ? v.problems.slice(0, 70) : "NEOVĚŘEN (kontrola nedostupná)"}`);
      console.warn(`[Gemini sheet] panel ${i + 1} ${v ? `zamítnut (${v.problems.slice(0, 160)})` : "NEOVĚŘEN (kontrola selhala)"} → sólo`);
      out.push(null);
    } else {
      out.push(await compressImage(slices[i]));
    }
  }
  console.log(`[Gemini sheet] hotovo: ${out.filter(Boolean).length}/${n} panelů prošlo (zbytek sólo)`);
  return { results: out, report: reasons.slice(0, 4).join(" | ") };
}
