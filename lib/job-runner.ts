// Serverový běh generování pohádky (sdílený mezi /api/job/start a
// /api/job/continue). Job je NAVAZOVACÍ: stav i hotové scény se průběžně
// ukládají do Vercel Blob, takže když funkce narazí na časový limit (5 min),
// další volání runJob naváže přesně tam, kde předchozí skončilo — přeskočí
// napsaný příběh i hotové scény a dodělá jen chybějící.

import { put, head } from "@vercel/blob";
import { generateStory, extractPdfBrief, EXTRA_STORY_LANGS, peekEarlyScene, enforceCanonicalAppearance, type StoryExtras } from "@/lib/claude";
import { generateSceneImage, generateSceneSheet, genCounter, isDailyQuotaError, isCreditsDepletedError, isSpendCapError } from "@/lib/gemini";
import { charactersByIds, loadCharacters, type ReferenceImage } from "@/lib/characters";
import { loadPortraitRefEntries, refsForText } from "@/lib/portraits";
import { themeById } from "@/lib/themes";
import type { StoryRequest, Character, Scene, StoryChoiceMeta } from "@/lib/types";
import { blobToken } from "@/lib/blob-token";

const ANCHOR_LABEL =
  "CONSISTENCY ANCHOR — an illustration from THIS SAME story. Copy from it EXACTLY: every character's design, clothing, hair, body size and the relative heights between characters, the art style, AND every recurring object. The car keeps the identical body type, shape, colors and details in this scene (a sedan stays a sedan — it never becomes a different car):";

export const MAX_SCENES = 20;

export interface JobStatus {
  phase: "writing" | "generating" | "done" | "error";
  createdAt: number;
  updatedAt?: number;   // heartbeat — klient podle něj pozná umřelou funkci
  voiceId: string;
  title?: string;
  heroDescription?: string;
  scenesScript?: Scene[];
  total?: number;
  done?: number;
  sceneUrls?: Record<number, string>;
  error?: string;
  /** Poslední chyba kreslení obrázku (429 kvóta, billing…) — ukazuje se v UI */
  imgError?: string;
  /** 🔀 Dva konce: scenesScript = společný děj + konec A + konec B */
  choice?: StoryChoiceMeta;
  /** Kolikrát se psaní příběhu restartovalo (kick bez hotového scénáře) */
  restarts?: number;
  /** Souhrn vloženého PDF — dělá se jednou, restarty ho už nečtou znovu */
  pdfBrief?: string;
  /** Poslední chyba před restartem — jinak ji restart přepsal a nebyla vidět */
  lastError?: string;
  /** ⏱ Tracker přípravy: kdy byl dopsaný příběh a kdy byla pohádka hotová */
  wroteAt?: number;
  finishedAt?: number;
  /** Kolikrát se job sám na serveru předal další funkci (řetězení před 5min limitem) */
  chains?: number;
  /** 💰 Obrázky vygenerované za VŠECHNY běhy jobu (rozpočtová pojistka) */
  imgSpent?: number;
  /** Délka rozepsaného textu při minulém běhu — restart s delším partial = zdravé navázání */
  partialLen?: number;
  /** Restarty psaní BEZ pokroku v partial.json — jen ty znamenají zaseknutí */
  stuckRestarts?: number;
  /** 📋 Deník běhu: posledních ~60 událostí s časem — diagnostika „proč to trvá"
   *  (jede ve statusu, klient ho vidí při každém pollu; 📋 u jobu ho zobrazí) */
  log?: Array<{ t: number; m: string }>;
  /** 🗂️ Archová fáze už jednou skončila „ani jeden nový panel" (obtížná
   *  konzistence — typicky náročný svět/reference) — další řetězy ji
   *  přeskočí a jdou rovnou sólo, ať se stejný neúspěch neopakuje znovu
   *  a znovu na KAŽDÉM restartu funkce. */
  sheetGaveUp?: boolean;
}

export async function putJson(path: string, data: unknown): Promise<string> {
  const blob = await put(path, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken(),
  });
  return blob.url;
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const h = await head(path, { token: blobToken() });
    const res = await fetch(`${h.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function fetchUrlText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NickyFairyBot/1.0)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
  } catch {
    return "";
  }
}

export async function runJob(id: string, body: Record<string, unknown>) {
  const statusPath = `jobs/${id}/status.json`;

  // Navázání: existující stav (napsaný příběh + hotové scény) se přeskočí.
  // I job ve stavu error se scénami naváže (např. po resetu denní kvóty) —
  // dokreslí jen chybějící obrázky, nepíše a nekreslí celou pohádku znovu.
  const prev = await readJson<JobStatus>(statusPath);
  // Úvodní zápis z /api/job/start (pojistka proti zombie jobu) NENÍ minulý
  // běh — pozná se podle chybějícího updatedAt (ten přidává až write()).
  // Dřív se počítal jako restart a KAŽDÝ job startoval jako „(2. pokus)".
  const hadRealRun = !!prev?.updatedAt;
  const st: JobStatus =
    prev && prev.scenesScript?.length
      ? { ...prev, error: undefined, imgError: undefined }
      : {
          phase: "writing",
          createdAt: prev?.createdAt ?? Date.now(),
          voiceId: String(body.voiceId || prev?.voiceId || ""),
          // Restart psaní (kick bez hotového scénáře) dřív MAZAL chybovou
          // hlášku — job vypadal věčně jako „Píšu…". Teď se chyba přenáší
          // a po 3. restartu BEZ POKROKU se job zastaví s viditelnou příčinou.
          restarts: hadRealRun ? (prev?.restarts ?? 0) + 1 : (prev?.restarts ?? 0),
          lastError: prev?.error || prev?.lastError,
          pdfBrief: prev?.pdfBrief,
          chains: prev?.chains,
          partialLen: prev?.partialLen,
          stuckRestarts: prev?.stuckRestarts,
          log: prev?.log, // deník přežívá restarty psaní
        };
  const write = () => {
    st.updatedAt = Date.now();
    return putJson(statusPath, st).catch(e => console.error(`[job ${id}] status write failed:`, e));
  };
  // 📋 Deník: co se kdy stalo (trvání kroků, chyby) — bez await, zapíše se
  // s nejbližším write(); do konzole jde záznam hned
  const logEv = (m: string) => {
    st.log = [...(st.log || []), { t: Date.now(), m: m.slice(0, 200) }].slice(-60);
    console.log(`[job ${id}] ${m}`);
  };
  const secsSince = (t0: number) => Math.round((Date.now() - t0) / 1000);

  // Tvrdý strop počtu běhů psaní (zdravé řetězení dlouhého psaní projde,
  // skutečné zaseknutí chytá kontrola pokroku partial.json níže)
  if (!st.scenesScript?.length && (st.restarts ?? 0) >= 8) {
    st.phase = "error";
    st.error = `Psaní příběhu opakovaně selhává${st.lastError ? ` (${st.lastError.slice(0, 200)})` : ""} — zrušte pohádku ✕ a zadejte ji znovu, případně s méně stránkami.`;
    await write();
    return;
  }

  // ── ♻️ SAMO-ŘETĚZENÍ: Vercel funkci utne po 5 minutách. Dřív pokračování
  // spouštěla jen OTEVŘENÁ appka (poll watchdog) — zamčený telefon = mrtvý
  // job a „příprava" přes hodinu. Teď se job před limitem sám předá další
  // funkci přes /api/job/continue (force přeskočí pojistku čerstvého stavu).
  const runStartedAt = Date.now();
  const SELF_KICK_AT = 240_000;   // kontroly mezi scénami/archy
  const WRITING_KICK_AT = 280_000; // psaní = jeden dlouhý stream → časovač (zbytečné řetězy stojí čas)
  const timeUp = () => Date.now() - runStartedAt > SELF_KICK_AT;

  // 🚀 GLOBÁLNÍ STROP na CELOU pohádku, přes VŠECHNY řetězy (cíl < 5 min od
  // zadání) — počítá se od st.createdAt, ne od runStartedAt (ten se resetuje
  // s každým novým řetězem). Po překročení appka přestává opravovat vadné
  // obrázky (přijme první průchod i s vadami — jde je později 🖌 opravit
  // ručně) a nezahajuje další řetěz kvůli obrázkům — raději hotová pohádka
  // s pár nedokonalými scénami hned, než perfektní za 30 minut.
  const HARD_DEADLINE_MS = 280_000; // 4:40 — necháváme ~20 s na dopsání a zápis
  const hardDeadlineAt = st.createdAt + HARD_DEADLINE_MS;
  const overallTimeUp = () => Date.now() > hardDeadlineAt;
  let selfKicked = false;
  const selfContinue = async (): Promise<void> => {
    if (selfKicked) return;
    selfKicked = true;
    const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
    if (!host) return; // lokální vývoj — pokračování zajistí klient jako dřív
    st.chains = (st.chains ?? 0) + 1;
    if (st.chains > 10) { // pojistka proti nekonečnému řetězu (nikdy nenastává)
      st.phase = "error";
      st.error = "Příprava se opakovaně nedokončila ani po mnoha pokusech — zrušte pohádku ✕ a zadejte ji znovu.";
      await write();
      return;
    }
    logEv(`♻️ předávám štafetu další funkci (řetěz ${st.chains}, běh ${secsSince(runStartedAt)}s)`);
    await write();
    try {
      await fetch(`https://${host}/api/job/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, force: true }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      console.warn(`[job ${id}] self-continue failed:`, e instanceof Error ? e.message : e);
      selfKicked = false; // klientský watchdog zůstává jako záloha
    }
  };

  // ⚡ Kreslení BĚHEM psaní: jakmile stream dopíše 1. scénu, začne se malovat
  // souběžně s psaním zbytku — psaní (~2 min) a kotva (~1 min) se překryjí
  let earlyDraw: Promise<{ buffer: Buffer; mimeType: string } | null> | null = null;
  let earlyImg: { buffer: Buffer; mimeType: string } | null = null;

  // ⚡ Portréty postav se načítají SOUBĚŽNĚ s psaním (dřív se na ně čekalo
  // až po dopsání — u studeného startu ~3–5 s navíc)
  const refIds: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
  const refEntriesPromise = loadPortraitRefEntries(charactersByIds(refIds)).catch(() => [] as Awaited<ReturnType<typeof loadPortraitRefEntries>>);

  try {
    logEv(`▶ běh funkce start${(st.chains ?? 0) > 0 ? ` (řetěz ${st.chains})` : ""}${st.scenesScript?.length ? ` — scénář hotový, ${Object.keys(st.sceneUrls || {}).length}/${st.total ?? "?"} scén nakresleno` : (st.restarts ?? 0) > 0 ? ` — psaní pokus ${(st.restarts ?? 0) + 1}` : ""}`);
    if (!st.scenesScript?.length) {
      // ── 1) Story (Claude) — same inputs as /api/story ──
      st.phase = "writing";
      await write();
      const topic = String(body.topic || "").trim();
      const theme = body.themeId ? themeById(String(body.themeId)) : undefined;
      const ids: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
      let characters: Character[] = ids.length ? charactersByIds(ids) : loadCharacters();
      if (characters.length === 0) characters = [{ id: "hero", name: "Hrdina", description: "a young child" }];

      const rawCustom = Array.isArray(body.customCharacters) ? (body.customCharacters as StoryExtras["customCharacters"]) : [];
      const urlText = body.inspirationUrl ? await fetchUrlText(String(body.inspirationUrl)) : "";

      // Velké PDF přišlo jako odkaz do vlastního Blob úložiště → stáhnout
      let pdfBase64 = (body.inspirationPdfBase64 as string) || undefined;
      if (!pdfBase64 && typeof body.inspirationPdfUrl === "string") {
        try {
          const u = new URL(body.inspirationPdfUrl);
          if (u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com")) {
            const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
            if (r.ok) {
              const buf = Buffer.from(await r.arrayBuffer());
              if (buf.length <= 11 * 1024 * 1024) pdfBase64 = buf.toString("base64");
            }
          }
        } catch {}
      }

      // Vlastní svět (téma podle fotky/popisu) má přednost před předdefinovaným
      const rawCustomTheme = body.customTheme as { name?: unknown; prompt?: unknown } | undefined;
      const customTheme = rawCustomTheme && typeof rawCustomTheme.prompt === "string"
        ? { name: String(rawCustomTheme.name || "Vlastní svět"), prompt: String(rawCustomTheme.prompt).slice(0, 1200) }
        : undefined;

      const storyReq: StoryRequest = {
        topic,
        themeName: customTheme?.name ?? theme?.name,
        themePrompt: customTheme?.prompt ?? theme?.prompt,
        characters,
        age: Number(body.age) || 4,
        sceneCount: Math.min(Math.max(Number(body.sceneCount) || 6, 1), MAX_SCENES),
        // Povolené jazyky vyprávění (cs/en + testovací); jiné padají na cs
        language: (l => (["cs", "en", ...Object.keys(EXTRA_STORY_LANGS)].includes(l) ? l : "cs"))(String(body.language || "cs")),
        twoEndings: !!body.twoEndings,
        moral: body.moral ? String(body.moral).slice(0, 300) : undefined,
        previousStory: (body.previousStory as { title?: unknown; text?: unknown; heroDescription?: unknown; worldNotes?: unknown } | undefined)?.title
          ? {
              title: String((body.previousStory as { title: unknown }).title).slice(0, 200),
              text: String((body.previousStory as { text?: unknown }).text || "").slice(0, 4000),
              // 📖 Zkopírovaná pohádka nastudovaná zpětně z obrázků (/api/story-adopt) —
              // vypravěč tyto podoby postav zopakuje beze změny, ať pokračování sedí
              heroDescription: (body.previousStory as { heroDescription?: unknown }).heroDescription
                ? String((body.previousStory as { heroDescription: unknown }).heroDescription).slice(0, 3000)
                : undefined,
              worldNotes: (body.previousStory as { worldNotes?: unknown }).worldNotes
                ? String((body.previousStory as { worldNotes: unknown }).worldNotes).slice(0, 1200)
                : undefined,
            }
          : undefined,
      };
      // PDF se do psaní nedává celé (velký dokument nepustil psaní do limitu
      // funkce) — jednou se shrne do briefu, který se uloží k jobu
      if (pdfBase64 && !st.pdfBrief) {
        const tPdf = Date.now();
        logEv("📄 dělám souhrn vloženého PDF");
        await write();
        try {
          st.pdfBrief = await extractPdfBrief(storyReq.language === "en" ? "en" : "cs", pdfBase64);
          logEv(`📄 souhrn PDF hotový za ${secsSince(tPdf)}s`);
          await write();
        } catch (e) {
          logEv(`📄 souhrn PDF CHYBA po ${secsSince(tPdf)}s: ${e instanceof Error ? e.message : e}`);
        }
      }

      const extras: StoryExtras = {
        customCharacters: rawCustom,
        inspirationImages: Array.isArray(body.inspirationImages) ? (body.inspirationImages as StoryExtras["inspirationImages"]) : [],
        pdfBriefText: st.pdfBrief || undefined,
        inspirationUrlText: urlText || undefined,
      };

      // Navázání psaní po restartu: rozepsaný text z minulého běhu se načte
      // a Claude POKRAČUJE tam, kde funkce umřela (prefill odpovědi) —
      // dlouhé pohádky (dva konce, hodně stránek) se dřív po timeoutu
      // psaly pořád znovu OD NULY a nikdy se nedopsaly.
      let resumeText = "";
      if ((st.restarts ?? 0) > 0) {
        const partial = await readJson<{ text?: string }>(`jobs/${id}/partial.json`);
        if (partial?.text && partial.text.length > 500) {
          resumeText = partial.text;
          console.log(`[job ${id}] resuming story from ${resumeText.length} chars`);
        }
        // Restart s POKROKEM (partial narostl) = zdravé navázání po limitu
        // funkce; bez pokroku = skutečné zaseknutí → po 3 se job zastaví
        if (resumeText.length > (prev?.partialLen ?? 0)) st.stuckRestarts = 0;
        else st.stuckRestarts = (prev?.stuckRestarts ?? 0) + 1;
        st.partialLen = resumeText.length;
        if ((st.stuckRestarts ?? 0) >= 3) {
          st.phase = "error";
          st.error = `Psaní příběhu se zaseklo a neposouvá se${st.lastError ? ` (${st.lastError.slice(0, 200)})` : ""} — zrušte pohádku ✕ a zadejte ji znovu, případně s méně stránkami.`;
          await write();
          return;
        }
      }

      // Heartbeat během psaní: stream průběžně obnovuje updatedAt (klient
      // nehlásí falešné zaseknutí) a UKLÁDÁ rozepsaný text pro navázání.
      // ♻️ Časovač: když psaní přesáhne limit funkce, job se sám předá dál
      // (nová funkce naváže na partial.json prefillovaným pokračováním)
      const writingKick = setTimeout(() => { void selfContinue(); }, WRITING_KICK_AT);
      const tWrite = Date.now();
      logEv(`✍️ píšu příběh (${storyReq.sceneCount} scén, ${storyReq.language})${resumeText ? ` — navazuji od ${resumeText.length} znaků` : ""}`);
      let lastBeat = Date.now();
      let latestText = resumeText;
      // ⚡ Nastartuje kreslení scény 1, jakmile je v rozepsaném textu celá
      const tryEarlyDraw = (text: string) => {
        if (earlyDraw) return;
        const peek = peekEarlyScene(text);
        if (!peek) return;
        const hero = enforceCanonicalAppearance(peek.heroDescription, storyReq, extras);
        logEv("⚡ scéna 1 se kreslí souběžně s psaním zbytku příběhu");
        earlyDraw = (async () => {
          const entries = await refEntriesPromise;
          const early: ReferenceImage[] = [...refsForText(entries, `${peek.scene.imagePrompt} ${peek.scene.narration}`)];
          for (const ci of (Array.isArray(body.customCharacterImages) ? (body.customCharacterImages as Array<{ data?: string; mimeType?: string }>) : [])) {
            if (ci?.data && ci?.mimeType) early.push({ data: ci.data, mimeType: ci.mimeType, name: "a custom story character" });
          }
          const img = await generateSceneImage(peek.scene, hero, early, hardDeadlineAt);
          earlyImg = img;
          logEv("⚡ scéna 1 dokreslena během psaní");
          return img;
        })().catch(e => {
          logEv(`⚡ ranné kreslení scény 1 selhalo: ${e instanceof Error ? e.message.slice(0, 120) : e}`);
          return null;
        });
      };
      let script;
      try {
        script = await generateStory(storyReq, extras, (_chars, fullText) => {
        latestText = fullText;
        tryEarlyDraw(fullText);
        const now = Date.now();
        if (now - lastBeat > 20_000) {
          lastBeat = now;
          write();
          putJson(`jobs/${id}/partial.json`, { text: latestText })
            .catch(e => console.warn(`[job ${id}] partial write failed:`, e));
        }
        }, resumeText || undefined);
      } finally {
        clearTimeout(writingKick);
      }
      st.title = script.title;
      st.heroDescription = script.heroDescription;
      // 🔀 Dva konce: konec B se generuje hned za koncem A (jeden seznam scén)
      if (script.choice) {
        st.choice = {
          common: script.choice.afterScene,
          altFrom: script.scenes.length,
          options: script.choice.options,
        };
        st.scenesScript = [...script.scenes, ...script.choice.altScenes];
      } else {
        st.scenesScript = script.scenes;
      }
      st.total = st.scenesScript.length;
      st.done = 0;
      st.sceneUrls = {};
      st.wroteAt = Date.now(); // ⏱ konec psaní
      logEv(`✍️ příběh dopsán za ${secsSince(tWrite)}s (${st.scenesScript.length} scén, ${latestText.length} znaků)`);
      // ♻️ Psaní přeteklo limit a řetěz už běží: scénář se uloží a tento běh
      // končí — obrázky kreslí (jediná) navazující funkce. Už dokreslená
      // ranná scéna 1 se stihne uložit (navazující běh ji přeskočí).
      if (selfKicked) {
        // (čtení přes lokální proměnnou — earlyImg plní asynchronní closure)
        const ei = earlyImg as { buffer: Buffer; mimeType: string } | null;
        if (ei) {
          const url = await putJson(`jobs/${id}/scene-0.json`, {
            index: st.scenesScript[0].index,
            imageUrl: `data:${ei.mimeType};base64,${ei.buffer.toString("base64")}`,
          }).catch(() => null);
          if (url) { st.sceneUrls = { 0: url }; st.done = 1; }
        }
        await write();
        console.log(`[job ${id}] script saved, handing image work to the chained run`);
        return;
      }
    }

    const scenesScript = st.scenesScript!;
    const heroDescription = st.heroDescription || "";
    // 🔀 Líná větev B: obrázky druhého konce se NEKRESLÍ při generování —
    // vzniknou až když na něj čtenář na rozcestí opravdu sáhne (klient si je
    // vyžádá přes /api/scene). Ušetří ~1/3 obrázků u pohádek se dvěma konci.
    const totalAll = scenesScript.length;
    const total = st.choice && st.choice.altFrom > 0 && st.choice.altFrom < totalAll
      ? st.choice.altFrom
      : totalAll;
    st.total = total;
    st.phase = "generating";
    st.sceneUrls = st.sceneUrls || {};
    st.done = Object.keys(st.sceneUrls).length;
    await write();

    // Měření spotřeby: SKUTEČNĚ vygenerované obrázky v tomto běhu (počítadlo
    // v gemini.ts — zahrnuje QA překreslení, portréty i archy; 1K a 4K se
    // účtují zvlášť); hlas se účtuje líně v /api/scene
    const genAtStart = { ...genCounter };
    const madeImages = () => Math.max(0, genCounter.img1k - genAtStart.img1k);
    const madeSheets = () => Math.max(0, genCounter.img4k - genAtStart.img4k);
    const voiceChars = 0;

    // ── 2) Scenes (Gemini) with the consistency anchor ──
    // Reference postav = MALOVANÉ PORTRÉTY z kartotéky, ale CÍLENĚ: každá
    // scéna/arch dostane jen portréty postav, které v ní vystupují — 9 portrétů
    // na každou scénu vedlo k míchání identit
    const refEntries = await refEntriesPromise; // načtené souběžně s psaním
    const customRefs: ReferenceImage[] = [];
    const customImages = Array.isArray(body.customCharacterImages)
      ? (body.customCharacterImages as Array<{ data?: string; mimeType?: string }>)
      : [];
    for (const ci of customImages) {
      if (ci?.data && ci?.mimeType) customRefs.push({ data: ci.data, mimeType: ci.mimeType, name: "a custom story character" });
    }
    const refsFor = (txt: string): ReferenceImage[] => [...refsForText(refEntries, txt), ...customRefs];

    let anchor: ReferenceImage | null = null;
    // Navázání: kotva konzistence = už hotová scéna 1 z minulého běhu
    if (st.sceneUrls[0]) {
      try {
        const s0 = await fetch(st.sceneUrls[0], { cache: "no-store" }).then(r => (r.ok ? r.json() : null));
        const m = typeof s0?.imageUrl === "string" ? s0.imageUrl.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/) : null;
        if (m) anchor = { data: m[2], mimeType: m[1], label: ANCHOR_LABEL };
      } catch {}
    }

    // Denní kvóta Gemini vyčerpaná → STOP celého jobu. Každý další pokus by
    // jen pálil požadavky (limit je 1000/den/model) — reset je až o půlnoci PT.
    let quotaExhausted = false;
    // Vyčerpaný PŘEDPLACENÝ kredit ≠ denní kvóta: nevyprší o půlnoci, je
    // třeba dobít v Google AI Studio — hláška musí říct pravdu
    let creditsDepleted = false;
    // Měsíční ROZPOČTOVÝ STROP ≠ kredit: platba do Google Cloud Billing ho
    // NEZVEDNE — musí se zvednout ručně v AI Studio (Usage & billing)
    let spendCapped = false;

    // 💰 ROZPOČTOVÁ POJISTKA: pohádka smí přes všechny běhy vygenerovat
    // nejvýš ~4 obrázky na stránku (QA překreslení, archy, řetězy) — pak
    // se zastaví s chybou. Smyčka archů dřív pálila kredit bez stropu.
    const IMG_BUDGET = total * 4 + 12;
    const spentBase = st.imgSpent ?? 0; // z minulých běhů (řetězy)
    const spentNow = () => spentBase + madeImages() + madeSheets();
    const budgetBlown = () => spentNow() > IMG_BUDGET;
    if (budgetBlown()) {
      st.phase = "error";
      st.error = `Ochrana rozpočtu: pohádka už vygenerovala ${st.imgSpent} obrázků (limit ${IMG_BUDGET} pro ${total} stránek) a stále není hotová — zrušte ji ✕ a zadejte znovu, případně s méně stránkami.`;
      logEv(`⛔ STOP: rozpočet obrázků vyčerpán (${st.imgSpent}/${IMG_BUDGET})`);
      await write();
      return;
    }

    async function doScene(i: number): Promise<void> {
      if (st.sceneUrls![i] || quotaExhausted || budgetBlown()) return; // hotová / kvóta / rozpočet
      st.imgSpent = spentNow();
      const scene = scenesScript[i];
      const tScene = Date.now();
      const sceneRefs = refsFor(`${scene.imagePrompt} ${scene.narration}`);
      const refs = anchor && i > 0 ? [...sceneRefs, anchor] : sceneRefs;
      // 🎙️ Hlas se NEVYRÁBÍ při generování — namluvení vzniká líně až při
      // čtení hotové pohádky (klient si ho vyžádá přes /api/scene audioOnly).
      // Nepřehrané pohádky tak hlas vůbec neplatí.
      const img = await generateSceneImage(scene, heroDescription, refs, hardDeadlineAt).catch((e: Error) => {
        logEv(`🎨 scéna ${i + 1} CHYBA po ${secsSince(tScene)}s: ${e.message.slice(0, 140)}`);
        st.imgError = e.message.slice(0, 220);
        if (isDailyQuotaError(e.message)) quotaExhausted = true;
        if (isCreditsDepletedError(e.message)) creditsDepleted = true;
        if (isSpendCapError(e.message)) spendCapped = true;
        return null;
      });
      if (!img) { await write(); return; } // retry rounds below; chybu vidí klient
      logEv(`🎨 scéna ${i + 1} hotová za ${secsSince(tScene)}s`);
      st.imgError = undefined;
      const payload = {
        index: scene.index,
        imageUrl: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
      };
      const url = await putJson(`jobs/${id}/scene-${i}.json`, payload);
      st.sceneUrls![i] = url;
      st.done = Object.keys(st.sceneUrls!).length;
      await write();
      if (i === 0 && !anchor) {
        anchor = { data: img.buffer.toString("base64"), mimeType: img.mimeType, label: ANCHOR_LABEL };
      }
    }

    // ⚡ Scéna 1 z ranného kreslení (běžela souběžně s psaním) — když vyšla,
    // rovnou se uloží a poslouží jako kotva stylu; jinak se kreslí normálně
    const earlyDrawP = earlyDraw as Promise<{ buffer: Buffer; mimeType: string } | null> | null;
    if (earlyDrawP && !st.sceneUrls![0]) {
      const img = await earlyDrawP;
      if (img) {
        const url = await putJson(`jobs/${id}/scene-0.json`, {
          index: scenesScript[0].index,
          imageUrl: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
        });
        st.sceneUrls![0] = url;
        st.done = Object.keys(st.sceneUrls!).length;
        anchor = { data: img.buffer.toString("base64"), mimeType: img.mimeType, label: ANCHOR_LABEL };
        await write();
      }
    }

    // Scene 1 first (anchor), then the rest in parallel
    if (!timeUp()) await doScene(0);

    // 🗂️ Režim archů: zbylé scény po skupinách v JEDNOM obrázku (3×3 ve 4K =
    // až 9 scén za cenu jednoho obrázku), rozřezané a zkontrolované jedenácterem
    // per panel. Neprošlé/nevygenerované panely dokreslí sólo kola níže.
    // IMAGE_SHEET_MODE: "3x3" (výchozí) | "2x2" | "off"
    const sheetMode = (process.env.IMAGE_SHEET_MODE || "3x3").toLowerCase();
    if (st.sheetGaveUp) logEv("🗂️ archová fáze už dřív vzdala (žádný nový panel) → rovnou sólo");
    if (sheetMode !== "off" && !quotaExhausted && !st.sheetGaveUp && st.sceneUrls![0]) {
      const maxCells = sheetMode === "2x2" ? 4 : 9;
      // ⚡ Archy jedné vlny běží PARALELNĚ (15 stránek = archy 9+5 najednou —
      // 4K arch generuje ~stejně dlouho jako jedna 1K scéna, sériově to byla
      // zbytečná minuta navíc). Max 2 vlny; vlna bez jediného nového panelu
      // ukončuje archovou fázi (pojistka proti smyčce archů).
      let prevRoundReports = ""; // výtky z 1. vlny → 2. vlna kreslí s korekcí
      for (let round = 1; round <= 2 && !quotaExhausted && !timeUp() && !budgetBlown() && !overallTimeUp(); round++) {
        const pend = [...Array(total).keys()].filter(i => !st.sceneUrls![i]);
        if (pend.length < 2) break;
        const groups: number[][] = [];
        for (let g = 0; g < pend.length; g += maxCells) groups.push(pend.slice(g, g + maxCells));
        // poslední skupina o 1 scéně nemá jako arch smysl — dokreslí ji sólo fáze
        if (groups.length > 1 && groups[groups.length - 1].length < 2) groups.pop();
        const before = Object.keys(st.sceneUrls!).length;
        st.imgSpent = spentNow();
        logEv(`🗂️ kreslím ${groups.length > 1 ? `${groups.length} archy paralelně` : "arch"} (${groups.map(g => g.length).join("+")} scén)`);
        await write(); // heartbeat před dlouhým generováním
        const roundReports: string[] = [];
        await Promise.all(groups.map(async group => {
          const tSheet = Date.now();
          try {
            const groupText = group.map(i => `${scenesScript[i].imagePrompt} ${scenesScript[i].narration}`).join(" ");
            const groupRefs = refsFor(groupText);
            const refs = anchor ? [...groupRefs, anchor] : groupRefs;
            const { results, report } = await generateSceneSheet(group.map(i => scenesScript[i]), heroDescription, refs, prevRoundReports);
            if (report) roundReports.push(report);
            const passed = results.filter(Boolean).length;
            logEv(`🗂️ arch (${group.length} scén) hotový za ${secsSince(tSheet)}s (prošlo ${passed}/${group.length})${report ? ` — ${report.slice(0, 200)}` : ""}`);
            // panely se ukládají paralelně (sériově to stálo ~2–4 s na arch)
            await Promise.all(group.map(async (i, k) => {
              const img = results[k];
              if (!img) return;
              const url = await putJson(`jobs/${id}/scene-${i}.json`, {
                index: scenesScript[i].index,
                imageUrl: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
              });
              st.sceneUrls![i] = url;
            }));
            st.done = Object.keys(st.sceneUrls!).length;
            await write();
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logEv(`🗂️ arch CHYBA po ${secsSince(tSheet)}s: ${msg.slice(0, 140)} → sólo dokreslení`);
            if (isDailyQuotaError(msg)) quotaExhausted = true;
            if (isCreditsDepletedError(msg)) creditsDepleted = true;
            if (isSpendCapError(msg)) spendCapped = true;
          }
        }));
        if (Object.keys(st.sceneUrls!).length === before) {
          logEv("🗂️ archy nepřinesly žádný nový panel → zbytek jde sólo cestou");
          st.sheetGaveUp = true; // příští řetěz už archy nezkouší znovu
          break;
        }
        prevRoundReports = roundReports.join(" | ");
      }
    }

    let idx = 1;
    async function worker() {
      while (idx < total && !timeUp()) { const i = idx++; await doScene(i); }
    }
    // 4 souběžní kreslíři (dřív 3) — sólo dokreslení po neprošlém archu je
    // nejpomalejší fáze; Gemini limity 4 souběhy zvládají
    await Promise.all(Array.from({ length: Math.min(4, Math.max(0, total - 1)) }, worker));

    // Verification rounds — the job is done only when every image exists
    for (let round = 0; round < 2 && !quotaExhausted && !timeUp(); round++) {
      const missing = [...Array(total).keys()].filter(i => !st.sceneUrls![i]);
      if (missing.length === 0) break;
      for (const i of missing) { if (timeUp()) break; await doScene(i); }
    }

    st.imgSpent = spentNow(); // 💰 útrata běhu do stavu (řetězy ji sčítají)

    // 💰 Rozpočet vyčerpán a scény chybí → jasná chyba místo dalších běhů
    if (budgetBlown() && Object.keys(st.sceneUrls!).length < total) {
      st.phase = "error";
      st.error = `Ochrana rozpočtu: pohádka už vygenerovala ${st.imgSpent} obrázků (limit ${IMG_BUDGET} pro ${total} stránek, hotovo ${Object.keys(st.sceneUrls!).length}/${total}) — zrušte ji ✕ a zadejte znovu, případně s méně stránkami.`;
      logEv(`⛔ STOP: rozpočet obrázků vyčerpán (${st.imgSpent}/${IMG_BUDGET})`);
      await write();
      await writeUsageRecord(madeImages(), voiceChars, typeof body.deviceId === "string" ? body.deviceId : undefined, madeSheets(), true);
      return;
    }

    // ♻️ Došel čas funkce a scény ještě chybí → předat štafetu další funkci
    // (hotové scény se přeskočí; klientský watchdog zůstává jako záloha) —
    // ALE jen pokud jsme ještě pod globálním 5min stropem; jinak by se
    // pohádka mohla řetězit donekonečna (viz „Kvarner" — 7 řetězů, 36 min)
    if (!quotaExhausted && Object.keys(st.sceneUrls!).length < total && timeUp()) {
      if (overallTimeUp()) {
        logEv(`⏱️ globální strop ${Math.round(HARD_DEADLINE_MS / 1000)}s dosažen (${Object.keys(st.sceneUrls!).length}/${total} scén hotovo) → uzavírám pohádku i s chybějícími scénami (jdou 🖌 opravit ručně)`);
      } else {
        await selfContinue();
        return;
      }
    }

    // Denní kvóta vyčerpaná uprostřed práce → jasná chyba, žádné další pokusy
    if (quotaExhausted && Object.keys(st.sceneUrls!).length < total) {
      st.phase = "error";
      st.error = spendCapped
        ? `Měsíční ROZPOČTOVÝ STROP Gemini API (${Object.keys(st.sceneUrls!).length}/${total} obrázků hotovo) — POZOR, tohle NENÍ totéž co kredit: platba do Google Cloud Billing tento strop nezvedne. Musíte ho zvednout ručně v AI Studio → Usage and billing → Spend limit (https://aistudio.google.com/) a pohádku zadat znovu. Sám se neobnoví.`
        : creditsDepleted
        ? `Vyčerpaný KREDIT Gemini (${Object.keys(st.sceneUrls!).length}/${total} obrázků hotovo) — dobijte kredit v Google AI Studio (Billing) a pohádku zadejte znovu. Sám se neobnoví.`
        : `Vyčerpán denní limit kreslení Gemini (${Object.keys(st.sceneUrls!).length}/${total} obrázků hotovo). Resetuje se kolem 9:00 ráno — pak pohádku zadejte znovu.`;
      logEv(`⛔ STOP: ${spendCapped ? "měsíční rozpočtový strop" : "denní kvóta"} Gemini vyčerpaná (${Object.keys(st.sceneUrls!).length}/${total})`);
      await write();
      await writeUsageRecord(madeImages(), voiceChars, typeof body.deviceId === "string" ? body.deviceId : undefined, madeSheets(), true);
      return;
    }

    // Ani jeden obrázek = viditelná chyba (typicky vyčerpaná kvóta / billing
    // Gemini) místo „hotové" pohádky plné prázdných stránek
    if (Object.keys(st.sceneUrls!).length === 0) {
      st.phase = "error";
      st.error = st.imgError ? `Obrázky se nekreslí: ${st.imgError}` : "Obrázky se nekreslí (Gemini nevrátil žádný obrázek)";
      await write();
      return;
    }

    st.phase = "done";
    st.finishedAt = Date.now(); // ⏱ pohádka kompletní
    logEv(`✅ HOTOVO — celkem ${Math.round((st.finishedAt - st.createdAt) / 1000)}s od zadání (psaní ${st.wroteAt ? Math.round((st.wroteAt - st.createdAt) / 1000) : "?"}s, řetězů ${st.chains ?? 0})`);
    await write();
    await writeUsageRecord(madeImages(), voiceChars, typeof body.deviceId === "string" ? body.deviceId : undefined, madeSheets(), true,
      (st.finishedAt - st.createdAt) / 1000); // ⏱ trvání přípravy do panelu Spotřeba
  } catch (e) {
    st.phase = "error";
    st.error = e instanceof Error ? e.message : String(e);
    st.lastError = st.error;
    logEv(`💥 CHYBA běhu: ${st.error.slice(0, 160)}`);
    await write();
  }
}

// Záznam spotřeby pro panel 💰: SKUTEČNĚ vygenerované obrázky z tohoto běhu
// (včetně QA překreslení a portrétů — čte se počítadlo v gemini.ts).
// Data jsou v NÁZVU souboru: usage/u<ts>-i<1K obrázky>-c<znaky>[-s<4K archy>][-t1][-p<s trvání>][-d<zařízení>].json
// (-t1 = záznam celé pohádky, -p = trvání přípravy v sekundách) — /api/usage
// je sečte pouhým výpisem, bez stahování obsahu. Úklid jobs/ se jich nedotkne.
export async function writeUsageRecord(
  images: number, chars: number, device?: string, sheets = 0, story = false, prepSec = 0
): Promise<void> {
  if (images <= 0 && chars <= 0 && sheets <= 0) return;
  const dev = (device || "").replace(/[^a-z0-9]/gi, "").slice(0, 12);
  const p = story && prepSec > 0 ? `-p${Math.min(Math.round(prepSec), 86400)}` : "";
  const name = `usage/u${Date.now()}-i${images}-c${chars}${sheets > 0 ? `-s${sheets}` : ""}${story ? "-t1" : ""}${p}${dev ? `-d${dev}` : ""}.json`;
  try {
    await put(name, "1", {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
      token: blobToken(),
    });
  } catch (e) {
    console.warn("[usage] record failed:", e instanceof Error ? e.message : e);
  }
}
