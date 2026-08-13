// Serverový běh generování pohádky (sdílený mezi /api/job/start a
// /api/job/continue). Job je NAVAZOVACÍ: stav i hotové scény se průběžně
// ukládají do Vercel Blob, takže když funkce narazí na časový limit (5 min),
// další volání runJob naváže přesně tam, kde předchozí skončilo — přeskočí
// napsaný příběh i hotové scény a dodělá jen chybějící.

import { put, head } from "@vercel/blob";
import { generateStory, extractPdfBrief, EXTRA_STORY_LANGS, peekEarlyScene, enforceCanonicalAppearance, inventedCharacterNames, type StoryExtras } from "@/lib/claude";
import { generateSceneImage, generateSceneSheet, getGenCounter, runWithGenCounter, isDailyQuotaError, isCreditsDepletedError, isSpendCapError, sceneCastList } from "@/lib/gemini";
import { charactersByIds, loadCharacters, charactersNamedInHeroDescription, type ReferenceImage } from "@/lib/characters";
import { loadPortraitRefEntries, refsForText, refsForPanels, getFamilyScaleSheet, familyScaleSheetApplies, getFamilyGroupAnchor } from "@/lib/portraits";
import { themeById } from "@/lib/themes";
import type { StoryRequest, Character, Scene, StoryChoiceMeta } from "@/lib/types";
import { blobToken } from "@/lib/blob-token";
import { chargeForCompletedStory } from "@/lib/accounts";
import { estimateStoryCostCredits, actualStoryCostCredits } from "@/lib/pricing";
import { prepareStoryRequestCanon } from "@/lib/story-canon";
import { materializeStorySounds } from "@/lib/elevenlabs-creative";

// 💳 Kreditní systém: "1 kredit = 1 Kč skutečných nákladů appky + 50% marže"
// (viz lib/pricing.ts pro sazby a odůvodnění) — nahrazuje starý plochý model
// (1 kredit = 1 pohádka bez ohledu na spotřebu). Před spuštěním appka umí
// jen ODHADNOUT cenu (kolik obrázků/znaků pohádka bude potřebovat, viz
// estimateStoryCostCredits) — skutečná cena (actualStoryCostCredits, dole
// u "HOTOVO") vychází ze SKUTEČNĚ spotřebovaných zdrojů TÉTO pohádky.
export { estimateStoryCostCredits };

const ANCHOR_LABEL =
  "STORY STYLE / SETTING REFERENCE ONLY — reuse its painterly style, palette, lighting, recurring setting and recurring objects. NEVER copy a person's or animal's face, hair, age, body shape, size, markings, clothing or accessories from this image. For every named library character, the AUTHORITATIVE CHARACTER CANON portrait and contract override this image completely:";

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
  /** 🩺 2026-08-11: kumulativní 1K/4K počty ZVLÁŠŤ, napříč VŠEMI řetězy —
   *  potřeba pro finální writeUsageRecord (nákladový log), protože genCounter
   *  (lib/gemini.ts) je teď per-request izolovaný (AsyncLocalStorage, viz
   *  runWithGenCounter) a KAŽDÝ řetěz startuje s vlastním počítadlem od nuly.
   *  Bez tohohle by finální usage záznam vícekolové pohádky (self-continue
   *  přes 5min limit) počítal jen obrázky z POSLEDNÍHO řetězu, ne z celé
   *  pohádky (živý test: 12str. pohádka, 6 hotových scén, ale usage log
   *  ukázal jen 3 — přesně obrázky z 2. řetězu). st.imgSpent (nahoře) tohle
   *  neřeší, protože sčítá 1K+4K dohromady bez rozlišení typu. */
  spent1k?: number;
  spent4k?: number;
  /** 🩺 2026-08-06: reálné tokeny psaní scénáře (napříč všemi pokusy/řetězy
   *  téhle pohádky) místo paušálu COST_USD_PER_STORY_WRITING — viz
   *  actualStoryCostCredits, lib/pricing.ts. cacheCreation/cacheRead jsou
   *  odděleně, protože mají JINOU sazbu než obyčejný input (1,25×/0,1×) —
   *  system prompt psaní jede s cache_control: ephemeral (lib/claude.ts). */
  writeTokens?: { input: number; output: number; cacheCreation: number; cacheRead: number };
  /** Preflight konflikty knihovních jmen vyřešené před prvním placeným voláním. */
  canonPreflight?: { renamed: number; mappings: string[] };
  /** Stejná ochrana aplikovaná na jména, která si model sám vymyslel ve výstupu. */
  canonPostflight?: { renamed: number; mappings: string[] };
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
  /** 💳 Přihlášený uživatel, kterému se po dokončení odečte kredit (nic pro
   *  anonymní/rodinné použití bez účtu). */
  username?: string;
  /** 💳 Pojistka proti dvojímu odečtu při navázání rozděleného/restartovaného jobu */
  creditsCharged?: boolean;
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

// 🩺 2026-08-11: runJob se volá jak z /api/job/start, tak (samo-řetězeně)
// z /api/job/continue — když appka generuje 2 pohádky souběžně (podporováno,
// viz MAX_ACTIVE_JOBS na klientovi), Vercel Fluid Compute je může obsloužit
// na STEJNÉ teplé instanci. runWithGenCounter (lib/gemini.ts) dá TOMUTO
// běhu vlastní izolované počítadlo obrázků, ať se náklady dvou souběžných
// pohádek nemíchají do nákladového logu (živý test 6+12 stran zapsal oběma
// identické `images:10`, i když měly 6 a 11 hotových scén).
export async function runJob(id: string, body: Record<string, unknown>) {
  return runWithGenCounter(() => runJobImpl(id, body));
}

async function runJobImpl(id: string, body: Record<string, unknown>) {
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
          username: typeof body.username === "string" ? body.username : prev?.username,
          // Restart psaní (kick bez hotového scénáře) dřív MAZAL chybovou
          // hlášku — job vypadal věčně jako „Píšu…". Teď se chyba přenáší
          // a po 3. restartu BEZ POKROKU se job zastaví s viditelnou příčinou.
          restarts: hadRealRun ? (prev?.restarts ?? 0) + 1 : (prev?.restarts ?? 0),
          lastError: prev?.error || prev?.lastError,
          pdfBrief: prev?.pdfBrief,
          chains: prev?.chains,
          partialLen: prev?.partialLen,
          stuckRestarts: prev?.stuckRestarts,
          writeTokens: prev?.writeTokens,
          canonPreflight: prev?.canonPreflight,
          canonPostflight: prev?.canonPostflight,
          imgSpent: prev?.imgSpent,
          spent1k: prev?.spent1k,
          spent4k: prev?.spent4k,
          log: prev?.log, // deník přežívá restarty psaní
        };
  // 🩺 Trvalý diagnostický záznam běhu — NEZÁVISLÝ na jobs/<id>/* (ten smaže
  // ✕ zrušení i běžný úklid úložiště). Píše se do JINÉ složky (debug-logs/),
  // kterou úklid nemaže — i po zrušené/chybové pohádce tak zůstává k
  // dispozici plný 📋 deník (appka ho umí zobrazit přes /api/job/debug-log,
  // i když je job dávno pryč). Jen text (žádné obrázky) — pár KB na běh.
  const writeDebugArchive = () => {
    const record = {
      id, title: st.title, topic: typeof body.topic === "string" ? body.topic.slice(0, 300) : undefined,
      phase: st.phase, error: st.error, imgError: st.imgError, lastError: st.lastError,
      total: st.total, done: st.done,
      createdAt: st.createdAt, updatedAt: st.updatedAt, finishedAt: st.finishedAt, wroteAt: st.wroteAt,
      chains: st.chains, restarts: st.restarts, stuckRestarts: st.stuckRestarts,
      canonPreflight: st.canonPreflight, canonPostflight: st.canonPostflight, writeTokens: st.writeTokens,
      spent1k: st.spent1k, spent4k: st.spent4k, imgSpent: st.imgSpent,
      log: st.log,
    };
    return putJson(`debug-logs/${id}.json`, record).catch(e => console.error(`[job ${id}] debug archive write failed:`, e));
  };
  // Heartbeat, early draw a hlavní pipeline mohou zavolat write() souběžně.
  // Přímé paralelní PUTy se dokončovaly mimo pořadí (v benchmarku status
  // po 2958 znacích skočil zpět na 1603), takže starší snapshot přepsal
  // novější. Zápisy statusu se proto serializují v pořadí vzniku.
  let statusWriteChain: Promise<unknown> = Promise.resolve();
  const write = () => {
    st.updatedAt = Date.now();
    void writeDebugArchive();
    const snapshot = JSON.parse(JSON.stringify(st)) as JobStatus;
    statusWriteChain = statusWriteChain
      .then(() => putJson(statusPath, snapshot))
      .catch(e => console.error(`[job ${id}] status write failed:`, e));
    return statusWriteChain;
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
  const SELF_KICK_AT = 200_000;   // kontroly mezi scénami/archy (víc rezervy do tvrdého 300s killu)
  const WRITING_KICK_AT = 280_000; // psaní = jeden dlouhý stream → časovač (zbytečné řetězy stojí čas)
  const timeUp = () => Date.now() - runStartedAt > SELF_KICK_AT;

  // 🚀 GLOBÁLNÍ STROP na CELOU pohádku, přes VŠECHNY řetězy (cíl < 5 min od
  // zadání) — počítá se od st.createdAt, ne od runStartedAt (ten se resetuje
  // s každým novým řetězem). Po překročení appka přestává opravovat vadné
  // obrázky (přijme první průchod i s vadami — jde je později 🖌 opravit
  // ručně) a nezahajuje další řetěz kvůli obrázkům — raději hotová pohádka
  // s pár nedokonalými scénami hned, než perfektní za 30 minut.
  // 🕐 2026-08-05: pevných 280s napříč VŠEMI délkami neplatilo — živý test
  // (5/10/15 scén) ukázal, že 15scénová pohádka narazila na strop s jen
  // 10/15 hotovými scénami. Strop teď škáluje podle (efektivního, twoEndings
  // navyšuje o ~30 %) počtu scén — delší pohádka dostane víc času, ne kratší
  // rozpočet na scénu; ≤10 scén je beze změny (280s už ověřeně stíhá).
  const requestedScenes = Math.max(1, Math.min(MAX_SCENES, Number(body.sceneCount) || 10));
  const effectiveScenes = body.twoEndings ? Math.ceil(requestedScenes * 1.3) : requestedScenes;
  // 🧪 Feature flag prototypu. Je potřeba už před archovou fází, protože
  // ovlivňuje i sekvenční kotvení vymyšlených postav.
  const oneSheetStory = /^(1|true|on)$/i.test(process.env.ONE_SHEET_STORY || "");
  // 🩺 2026-08-12: „pokračování" (previousStory) cituje jména KNIHOVNÍCH
  // postav jako "kanonické, zkopíruj doslova" (buildUserPrompt, claude.ts),
  // klidně i takových, co uživatel pro TUTO pohádku vůbec nezaškrtl —
  // viz charactersNamedInHeroDescription (lib/characters.ts) pro plné
  // odůvodnění a nahlášený bug ("James/Bella… vypadají úplně jinak než v
  // knihovně"). Appka je proto přidá zpátky do referenčního obsazení všude,
  // kde se dnes používá jen `body.characterIds` — dostanou tak svůj SKUTEČNÝ
  // zamčený portrét i doslovné zařazení mezi kanonické postavy pro Clauda.
  const prevHeroDescription =
    typeof (body.previousStory as { heroDescription?: unknown } | undefined)?.heroDescription === "string"
      ? String((body.previousStory as { heroDescription: string }).heroDescription)
      : "";
  const carryoverIds: string[] = prevHeroDescription
    ? charactersNamedInHeroDescription(prevHeroDescription).map((c) => c.id)
    : [];
  const withCarryover = (ids: string[]): string[] =>
    carryoverIds.length ? Array.from(new Set([...ids, ...carryoverIds])) : ids;
  // 🩺 2026-08-11: odhad castSize UŽ TADY (přesný výpočet běží mnohem později,
  // z charactersForNames/rawCustomForNames) — potřeba dřív, protože bez archů
  // (sheet mode, viz SHEET_SKIP_CAST_SIZE níž v souboru — drž stejnou hodnotu
  // 7 na obou místech) se KAŽDÁ scéna kreslí sólo (pomalejší). Živý test
  // (12 scén, castSize 7) doběhl na 360s strop s jen 11/12 hotovými — appka
  // v takovém případě potřebuje víc času, ne stejný rozpočet jako pohádka,
  // co archy použít MŮŽE. Odhad z request body (ne z charactersForNames,
  // co ještě neexistuje) — prázdný výběr = celá rodinná knihovna, stejné
  // pravidlo jako charactersForNames níž.
  const earlyRawIds: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
  const earlyIds: string[] = withCarryover(earlyRawIds);
  // 🩺 castSize odhad drží stejnou "prázdný výběr = celá knihovna" logiku
  // jako `characters` níž — withCarryover by jinak prázdný výběr proměnil na
  // "jen carryover postavy" a odhad by byl NIŽŠÍ než skutečnost.
  const earlyCastSize = (earlyRawIds.length ? earlyIds.length : loadCharacters().length)
    + (Array.isArray(body.customCharacters) ? (body.customCharacters as unknown[]).length : 0);
  const noSheetMode = earlyCastSize >= 7; // drž v souladu se SHEET_SKIP_CAST_SIZE níž
  const HARD_DEADLINE_MS =
    (effectiveScenes <= 10 ? 280_000 :  // 4:40 — ověřeno živě, stíhá
    effectiveScenes <= 15 ? 360_000 :   // 6:00
    480_000)                            // 8:00 — 16-20 (MAX_SCENES) scén
    + (noSheetMode ? 90_000 : 0);       // +1:30 — bez archů kreslí KAŽDOU scénu sólo
  const hardDeadlineAt = st.createdAt + HARD_DEADLINE_MS;
  const overallTimeUp = () => Date.now() > hardDeadlineAt;
  // 🩺 2026-08-05: diagnostika k nevysvětlené nesrovnalosti — živý test (15
  // scén) ukázal, že 2. řetěz (po self-continue) uzavřel pohádku na "strop
  // 280s", i když 15 scén mělo dostat 360s. body.sceneCount by měl být
  // stejný v request.json napříč řetězy (viz /api/job/continue), ale
  // nepotvrzeno přímým měřením — tenhle řádek to příště ukáže napřímo,
  // místo dohledávání oklikou přes vytištěné "Xs" v log zprávách.
  logEv(`🕐 deadline: sceneCount=${body.sceneCount} (typ ${typeof body.sceneCount}) requested=${requestedScenes} effective=${effectiveScenes} → ${Math.round(HARD_DEADLINE_MS / 1000)}s, chains=${st.chains ?? 0}`);

  // 🛟 Strop PRO TENTO BĚH: i když je do globálního limitu ještě daleko, jedna
  // jediná scéna nesměla dosud sama o sobě utéct přes bezpečnou rezervu do
  // tvrdého 300s killu Vercelu — verifySceneImage/generateSceneImage uvnitř
  // umí zkoušet znovu (kontrola 2×, překreslení 2 kola), a v nepříznivém
  // případě to dohromady dokázalo přetéct dřív, než stihl proběhnout
  // selfContinue() — funkce pak spadla na tvrdém limitu UPROSTŘED scény
  // (žádný catch to nezachytí, Vercel proces prostě zabije). sceneDeadline()
  // je MIN z globálního stropu a rezervy TOHOTO běhu — cokoliv níž předává
  // appce (generateSceneImage) jako signál „už nezkoušej, přijmi co je".
  const invocationSafeDeadlineAt = runStartedAt + 260_000;
  const sceneDeadline = () => Math.min(hardDeadlineAt, invocationSafeDeadlineAt);
  let selfKicked = false;
  const selfContinue = async (): Promise<void> => {
    if (selfKicked) return;
    selfKicked = true;
    // Preview job musí pokračovat na STEJNÉM preview deploymentu. Dřívější
    // pořadí preferovalo production URL i ve preview, takže experiment po
    // self-chainu tiše přeskočil na produkční kód a ztratil feature flagy.
    const host = process.env.VERCEL_ENV === "production"
      ? (process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL)
      : (process.env.VERCEL_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL);
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
      // Preview E2E continuation must keep its HTTP function alive; ordinary
      // Preview waitUntil was observed to stop before the last missing scene.
      // Only image-phase handoffs use this token/longer wait — a writing kick
      // near the 300s function ceiling must still return immediately.
      const previewContinuationToken = process.env.VERCEL_ENV !== "production" && st.scenesScript?.length
        ? process.env.PROTOTYPE_BENCHMARK_TOKEN
        : undefined;
      await fetch(`https://${host}/api/job/continue`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(previewContinuationToken ? { "x-prototype-benchmark-token": previewContinuationToken } : {}),
        },
        body: JSON.stringify({ id, force: true }),
        signal: AbortSignal.timeout(previewContinuationToken ? 45_000 : 10_000),
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

  // Snapshot BEFORE portraits/anchors/early scene start. The previous snapshot
  // lived after story writing, so a scene drawn concurrently with Claude was
  // real provider spend but invisible to both budget and failure analytics.
  const genAtRunStart = { ...getGenCounter() };
  const spent1kAtRunStart = st.spent1k ?? 0;
  const spent4kAtRunStart = st.spent4k ?? 0;
  const madeImagesThisRun = () => Math.max(0, getGenCounter().img1k - genAtRunStart.img1k);
  const madeSheetsThisRun = () => Math.max(0, getGenCounter().img4k - genAtRunStart.img4k);

  // ⚡ Portréty postav se načítají SOUBĚŽNĚ s psaním (dřív se na ně čekalo
  // až po dopsání — u studeného startu ~3–5 s navíc)
  const refIds: string[] = withCarryover(Array.isArray(body.characterIds) ? (body.characterIds as string[]) : []);
  const refEntriesPromise = loadPortraitRefEntries(charactersByIds(refIds)).catch(() => [] as Awaited<ReturnType<typeof loadPortraitRefEntries>>);
  // 📏 Celorodinný výškový list — jeden STATICKÝ obrázek (jmény+cm), který
  // drží poměry velikostí postav (textové pravidlo „sahá jí k uším" model
  // změřit neumí). Připojuje se jen když je v pohádce 2+ postav, které appka
  // zná s přesným cm. Načítá se souběžně s psaním; null = bez výškové kotvy.
  const scaleSheetPromise = familyScaleSheetApplies(refIds) ? getFamilyScaleSheet().catch(() => null) : Promise.resolve(null);
  // 🖼️ Skupinová kotva (ECONOMY-PLAN.md Fáze 2) — jedna natrvalo vygenerovaná
  // ilustrace CELÉ rodiny pohromadě (bez textu, na rozdíl od výškového listu
  // výš), doplňuje portréty jako DALŠÍ reference pro vícepostavové scény.
  // Stejná podmínka i stejné souběžné načítání jako výškový list.
  const groupAnchorPromise = familyScaleSheetApplies(refIds) ? getFamilyGroupAnchor().catch(() => null) : Promise.resolve(null);

  try {
    logEv(`▶ běh funkce start${(st.chains ?? 0) > 0 ? ` (řetěz ${st.chains})` : ""}${st.scenesScript?.length ? ` — scénář hotový, ${Object.keys(st.sceneUrls || {}).length}/${st.total ?? "?"} scén nakresleno` : (st.restarts ?? 0) > 0 ? ` — psaní pokus ${(st.restarts ?? 0) + 1}` : ""}`);
    if (!st.scenesScript?.length) {
      // ── 1) Story (Claude) — same inputs as /api/story ──
      st.phase = "writing";
      await write();
      const topic = String(body.topic || "").trim();
      const theme = body.themeId ? themeById(String(body.themeId)) : undefined;
      const rawIds: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
      const ids: string[] = withCarryover(rawIds);
      // 🩺 prázdný výběr pořád spadne na CELOU knihovnu (superset carryoveru,
      // žádná regrese) — jen když uživatel NĚCO zaškrtl, carryover se do
      // toho přimíchá (viz withCarryover výš).
      let characters: Character[] = rawIds.length ? charactersByIds(ids) : loadCharacters();
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

      let storyReq: StoryRequest = {
        topic,
        themeName: customTheme?.name ?? theme?.name,
        themePrompt: customTheme?.prompt ?? theme?.prompt,
        characters,
        age: Number(body.age) || 4,
        sceneCount: Math.min(Math.max(Number(body.sceneCount) || 10, 1), MAX_SCENES),
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

      // 🔒 Canon preflight musí proběhnout PŘED Claude API. Když osnova
      // obsahuje jméno nevybrané knihovní postavy, ponechá se role, ale jméno
      // se deterministicky přejmenuje. Dříve se konflikt zjistil až po ~2 min
      // psaní a celý scénář se opakovaně zahodil.
      const canonPreflight = prepareStoryRequestCanon(storyReq, extras);
      storyReq = canonPreflight.request;
      if (canonPreflight.renames.length) {
        const mappings = canonPreflight.renames.map(r => `${r.libraryId}→${r.replacement}`);
        st.canonPreflight = { renamed: mappings.length, mappings };
        logEv(`🛡️ canon preflight: ${mappings.length} nevybraných knihovních jmen přejmenováno před psaním (${mappings.join(", ")})`);
        await write();
      }

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
        const prevLen = prev?.partialLen ?? 0;
        if (resumeText.length > prevLen) st.stuckRestarts = 0;
        else st.stuckRestarts = (prev?.stuckRestarts ?? 0) + 1;
        st.partialLen = resumeText.length;
        // 📋 Bez tohohle bylo v deníku vidět jen „psaní pokus N", ale ne PROČ
        // se restartuje ani jestli se vůbec někam hýbe — teď je vidět délka
        // rozepsaného textu a počet restartů BEZ pokroku (0–3 → pak stop)
        logEv(`🔁 restart psaní (pokus ${(st.restarts ?? 0) + 1}): rozepsáno ${resumeText.length} znaků (dřív ${prevLen}), bez pokroku ${st.stuckRestarts}×${st.lastError ? ` — minulá chyba: ${st.lastError.slice(0, 140)}` : ""}`);
        if ((st.stuckRestarts ?? 0) >= 3) {
          st.phase = "error";
          st.error = `Psaní příběhu se zaseklo a neposouvá se${st.lastError ? ` (${st.lastError.slice(0, 200)})` : ""} — zrušte pohádku ✕ a zadejte ji znovu, případně s méně stránkami.`;
          logEv(`⛔ STOP: psaní se ${st.stuckRestarts}× po sobě nikam neposunulo`);
          await write();
          return;
        }
        // 🚦 I se SKUTEČNÝM pokrokem (stuckRestarts=0) může psaní teoreticky
        // řetězit až st.chains>10 (~46 min, viz selfContinue výš) — daleko za
        // dohodnutým cílem "max 5 min se vším všudy". overallTimeUp/
        // hardDeadlineAt (280s od zadání) tenhle strop dřív hlídal jen pro
        // KRESLENÍ, ne pro psaní — jenže psaní se, na rozdíl od kreslení,
        // nedá "uzavřít s tím, co je hotovo" (rozepsaná pohádka bez konce se
        // nedá přehrát). Vlastní, o něco velkorysejší strop (dává prostor
        // dlouhým/dvoukoncovým pohádkám), ale ne neomezený.
        const WRITING_HARD_DEADLINE_MS = 480_000; // 8 min od zadání
        if (Date.now() - st.createdAt > WRITING_HARD_DEADLINE_MS) {
          st.phase = "error";
          st.error = "Psaní příběhu trvá výrazně déle než obvykle — appka to radši ukončí, než aby čekala donekonečna. Zrušte pohádku ✕ a zadejte ji znovu, případně s méně stránkami nebo bez alternativních konců.";
          logEv(`⛔ STOP: psaní přesáhlo ${Math.round(WRITING_HARD_DEADLINE_MS / 1000)}s od zadání (${resumeText.length} znaků rozepsáno)`);
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
          // 📏 Scéna 1 je KOTVA pro celý zbytek pohádky — poměry výšek v ní
          // musí sedět především, jinak se chyba replikuje do všech scén
          const sheet0 = await scaleSheetPromise;
          const groupAnchor0 = await groupAnchorPromise;
          if (early.length >= 2) {
            if (sheet0) early.push(sheet0);
            if (groupAnchor0) early.push(groupAnchor0);
          }
          const img = await generateSceneImage(peek.scene, hero, early, sceneDeadline());
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
        // 🕐 Klient polluje /api/job/status co 4s (viz startJobPolling,
        // app/page.tsx) — 20s heartbeat tak nechal stejný "poslední" řádek
        // viset klidně přes 4 polly v kuse a psaní působilo zaseknutě, i
        // když appka reálně streamovala. 8s = skoro každý druhý poll vidí
        // něco nového.
        if (now - lastBeat > 8_000) {
          lastBeat = now;
          logEv(`✍️ píšu… (${latestText.length} znaků zatím, ${secsSince(tWrite)}s)`);
          write();
          putJson(`jobs/${id}/partial.json`, { text: latestText })
            .catch(e => console.warn(`[job ${id}] partial write failed:`, e));
        }
        }, resumeText || undefined, logEv, usage => {
          // Sčítá se napříč pokusy/řetězy (resume = víc volání Claudovi za
          // stejnou pohádku) — appka teď zná REÁLNOU cenu psaní, ne paušál.
          const prevIn = st.writeTokens?.input ?? 0;
          const prevOut = st.writeTokens?.output ?? 0;
          const prevCacheC = st.writeTokens?.cacheCreation ?? 0;
          const prevCacheR = st.writeTokens?.cacheRead ?? 0;
          st.writeTokens = {
            input: prevIn + usage.inputTokens,
            output: prevOut + usage.outputTokens,
            cacheCreation: prevCacheC + usage.cacheCreationTokens,
            cacheRead: prevCacheR + usage.cacheReadTokens,
          };
        }, renames => {
          const mappings = renames.map(r => `${r.libraryId}→${r.replacement}`);
          st.canonPostflight = { renamed: mappings.length, mappings };
        });
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
    // 🔊 Běží souběžně s obrázky; resume je idempotentní díky globální cache.
    // Výsledek se čeká až před finálním stavem done, aby URL zůstaly ve scénáři.
    const customSoundsPromise = materializeStorySounds(scenesScript, 2)
      .catch(() => ({ generated: 0, cachedOrGenerated: 0 }));
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
    // účtují zvlášť). Namlouvání appka spouští líně až KLIENTSKY po
    // dokončení jobu (fillMissingAudio, app/page.tsx), ale text scénáře —
    // a tedy přesný počet znaků, co půjde do ElevenLabs — appka zná už teď.
    const madeImages = madeImagesThisRun;
    const madeSheets = madeSheetsThisRun;
    const voiceChars = scenesScript.reduce((sum, s) => sum + (s.narration?.length || 0), 0);

    // ── 2) Scenes (Gemini) with the consistency anchor ──
    // Reference postav = MALOVANÉ PORTRÉTY z kartotéky, ale CÍLENĚ: každá
    // scéna/arch dostane jen portréty postav, které v ní vystupují — 9 portrétů
    // na každou scénu vedlo k míchání identit
    const refEntries = await refEntriesPromise; // načtené souběžně s psaním
    const scaleSheet = await scaleSheetPromise;  // 📏 kanonické poměry výšek (může být null)
    const groupAnchor = await groupAnchorPromise; // 🖼️ skupinová kotva rodiny (může být null)
    const customRefs: ReferenceImage[] = [];
    const customImages = Array.isArray(body.customCharacterImages)
      ? (body.customCharacterImages as Array<{ data?: string; mimeType?: string }>)
      : [];
    for (const ci of customImages) {
      if (ci?.data && ci?.mimeType) customRefs.push({ data: ci.data, mimeType: ci.mimeType, name: "a custom story character" });
    }
    // 🕵️ Postavy VYMYŠLENÉ pro tuhle pohádku (ne z kartotéky, tedy bez
    // malovaného portrétu) — bez obrázkové kotvy jejich vzhled mezi scénami
    // „plave" (viz „Bora": jednou elf, jednou kočkovitá příšera, jednou
    // skřítek). Jakmile appka takovou postavu poprvé úspěšně nakreslí, uloží
    // si tu scénu jako JEJÍ VLASTNÍ kotvu pro všechny další scény, kde se
    // jmenovitě objeví — stejný trik jako `anchor` níže, jen na míru postavě.
    const rawIdsForNames: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
    const idsForNames: string[] = withCarryover(rawIdsForNames);
    // 🩺 carryover postavy MUSÍ počítat jako kanonické (charactersForNames) tady
    // taky — jinak je inventedCharacterNames níž (a tím pádem i castSize) omylem
    // zařadí mezi VYMYŠLENÉ, přesně bug popsaný u withCarryover/charactersNamedInHeroDescription.
    const charactersForNames = rawIdsForNames.length ? charactersByIds(idsForNames) : loadCharacters();
    const rawCustomForNames = Array.isArray(body.customCharacters) ? (body.customCharacters as StoryExtras["customCharacters"]) : [];
    const inventedNames = inventedCharacterNames(
      heroDescription,
      { characters: charactersForNames } as StoryRequest,
      { customCharacters: rawCustomForNames } as StoryExtras
    );
    const inventedRefs = new Map<string, ReferenceImage>();
    // 🩺 2026-08-05: nahlášeno "Cannot read properties of undefined (reading
    // 'toLowerCase')" — job spadl hned po dokreslení scény 2 (viz volání na
    // scene.imagePrompt níž). Buď scene.imagePrompt, nebo jméno z
    // inventedNames může být za nějakých okolností undefined/prázdné (zatím
    // se nepodařilo přesně dohledat proč, tenhle guard aspoň zavírá celou
    // třídu pádu bez ohledu na to, které z obou to bylo).
    const nameHit = (text: string | undefined, name: string | undefined): boolean => {
      if (!text || !name) return false;
      const low = ` ${text.toLowerCase()} `;
      const k = name.toLowerCase();
      const i = low.indexOf(k);
      if (i < 0) return false;
      const isLetter = (ch: string) => /[a-záčďéěíňóřšťúůýž]/i.test(ch);
      return !isLetter(low[i - 1] || " ") && !isLetter(low[i + k.length] || " ");
    };
    const refsFor = (txt: string): ReferenceImage[] => {
      const own = refsForText(refEntries, txt);
      const invented = inventedNames.filter(n => inventedRefs.has(n) && nameHit(txt, n)).map(n => inventedRefs.get(n)!);
      // 📏 Výškový list + 🖼️ skupinová kotva přiložit JEN když ve scéně stojí
      // 2+ postavy vedle sebe (u sólo scény nemá poměr výšek co držet a jen
      // by ubíraly pozornost)
      const multiChar = own.length + customRefs.length + invented.length >= 2;
      const withScale = multiChar && scaleSheet ? [scaleSheet] : [];
      const withGroupAnchor = multiChar && groupAnchor ? [groupAnchor] : [];
      return [...own, ...customRefs, ...invented, ...withScale, ...withGroupAnchor];
    };

    let anchor: ReferenceImage | null = null;
    // Navázání: kotva konzistence = už hotová scéna 1 z minulého běhu
    if (st.sceneUrls[0]) {
      try {
        const s0 = await fetch(st.sceneUrls[0], { cache: "no-store" }).then(r => (r.ok ? r.json() : null));
        const m = typeof s0?.imageUrl === "string" ? s0.imageUrl.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/) : null;
        if (m) anchor = { data: m[2], mimeType: m[1], label: ANCHOR_LABEL, role: "story-style" };
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
    // 🩺 2026-08-11: odděleně od spentBase (ten míchá 1K+4K) — viz komentář
    // u spent1k/spent4k v JobStatus výš. totalImages1k/4k() = kumulativní
    // počet PŘES VŠECHNY řetězy téhle pohádky, pro finální usage log.
    const spent1kBase = st.spent1k ?? 0;
    const spent4kBase = st.spent4k ?? 0;
    const totalImages1k = () => spent1kBase + madeImages();
    const totalImages4k = () => spent4kBase + madeSheets();
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
      st.spent1k = totalImages1k(); st.spent4k = totalImages4k();
      const scene = scenesScript[i];
      const tScene = Date.now();
      const sceneRefs = refsFor(`${scene.imagePrompt} ${scene.narration}`);
      const refs = anchor && i > 0 ? [...sceneRefs, anchor] : sceneRefs;
      // 🎙️ Hlas se NEVYRÁBÍ při generování — namluvení vzniká líně až při
      // čtení hotové pohádky (klient si ho vyžádá přes /api/scene audioOnly).
      // Nepřehrané pohádky tak hlas vůbec neplatí.
      const img = await generateSceneImage(scene, heroDescription, refs, sceneDeadline()).catch((e: Error) => {
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
        anchor = { data: img.buffer.toString("base64"), mimeType: img.mimeType, label: ANCHOR_LABEL, role: "story-style" };
      }
      // 🕵️ První úspěšné nakreslení vymyšlené postavy = její vlastní kotva
      // pro všechny další scény, kde se jmenovitě objeví (viz komentář výše
      // u refsFor) — best-effort: dvě scény, které stejnou NOVOU postavu
      // kreslí souběžně (4 paralelní kreslíři), se ještě navzájem nechytí.
      for (const name of inventedNames) {
        if (!inventedRefs.has(name) && nameHit(scene.imagePrompt, name)) {
          inventedRefs.set(name, {
            data: img.buffer.toString("base64"), mimeType: img.mimeType, name,
            label: `REFERENCE — ${name}'s design as established earlier in THIS story. Match EXACTLY: species/what it's made of, body shape, colors, distinguishing features, size relative to the other characters:`,
          });
        }
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
        anchor = { data: img.buffer.toString("base64"), mimeType: img.mimeType, label: ANCHOR_LABEL, role: "story-style" };
        await write();
      }
    }

    // Scene 1 first (anchor), then the rest in parallel
    if (!timeUp() && !overallTimeUp()) await doScene(0);

    // 🕵️ Kotva VYMYŠLENÝCH postav musí vzniknout z jejich PRVNÍ scény PODLE
    // PŘÍBĚHU, ne z toho, co náhodou dokreslí dřív — jinak dvě scény
    // zmiňující STEJNOU novou postavu, které začnou kreslit SOUBĚŽNĚ (sheet
    // mode i sólo kreslíři níže běží paralelně), nemají v tu chvíli ještě
    // žádnou kotvu, a každá si tak nezávisle „vymyslí" jiný vzhled (viz
    // „Ötzli" — v úvodní scéně obyčejný horal s lucernou, o pár scén dál
    // najednou bledý ledový přízrak). Přesně tohle byla dřív jen POJISTKA
    // BEST-EFFORT (viz komentář u refsFor/doScene): řešila to, jen když
    // druhá zmínka přišla AŽ PO dokreslení té první. Teď appka pro každé
    // vymyšlené jméno nejdřív SEKVENČNĚ (ne souběžně) dokreslí jeho
    // nejnižší-indexovou scénu, než vůbec spustí archy/paralelní kreslíře
    // níže — kotva tak vždy vznikne z opravdu prvního výskytu v ději.
    // V one-sheet režimu drží návrh nové postavy jediný společný modelový
    // výstup. Samostatná kotvící scéna by z 9panelového storyboardu udělala
    // jen 8 panelů a zničila cílovou ekonomiku 1× hero + 1× 4K.
    if (!oneSheetStory) {
      for (const name of inventedNames) {
        if (inventedRefs.has(name) || timeUp() || overallTimeUp()) continue;
        const firstIdx = [...Array(total).keys()].find(i => !st.sceneUrls![i] && nameHit(scenesScript[i].imagePrompt, name));
        if (firstIdx !== undefined) await doScene(firstIdx);
      }
    }

    // 🗂️ Režim archů: zbylé scény po skupinách v JEDNOM obrázku (3×3 ve 4K =
    // až 9 scén za cenu jednoho obrázku), rozřezané a zkontrolované jedenácterem
    // per panel. Neprošlé/nevygenerované panely dokreslí sólo kola níže.
    // IMAGE_SHEET_MODE: "3x3" (výchozí) | "2x2" | "off"
    // 🧪 EXPERIMENT (test větev): dřív appka u 3+ postav CELÉ pohádky vypínala
    // archy úplně (0/8, 0/8, 5/8, 4/8 prošlých panelů napříč testy). Ale
    // castSize je součet postav VYBRANÝCH pro celou pohádku — spousta scén
    // v takové pohádce ve skutečnosti zobrazuje jen 1-2 z nich pohromadě.
    // Nově se nespolehlivost řeší PER SKUPINA: do archu smí jen scény, jejichž
    // VLASTNÍ obsazení (sceneCastList té konkrétní scény) má ≤2 lidi — scény
    // se 3+ lidmi v jednom panelu jdou vždy rovnou sólo, i v jinak "bohaté"
    // pohádce. Sleduj debug-logy (🗂️ vs 🎨 poměr a prošlé panely) a v případě
    // špatných výsledků vrať `castSize >= 3` větev z historie.
    // 🩺 2026-08-05: castSize se dřív počítal jen z body.characterIds/
    // customCharacters — u prázdného výběru appka ale kreslí CELOU rodinnou
    // knihovnu (viz charactersForNames výš), takže castSize vyšel 0, i když
    // scéna měla reálně 4-5 lidí. Živý test (15 scén, rodina 4 lidí přes
    // fallback) ukázal archy 1/34 panelů za 250s (72 % celkového času) —
    // castSize teď počítá se SKUTEČNĚ použitým obsazením (charactersForNames
    // + rawCustomForNames), ne jen s explicitním výběrem klienta.
    const castSize = charactersForNames.length + (rawCustomForNames?.length ?? 0);
    // 🩺 2026-08-05: nepodmíněný diagnostický log — dřívější "🧪" hlášky
    // se vypisovaly jen nad určitým prahem, takže při NEČEKANĚ nízkém
    // castSize (viz test: fallback na celou rodinu i tak vyšel <3, archy
    // běžely v defaultu) appka mlčela a nešlo to ověřit jinak než odhadem
    // z chování. Tohle ukáže castSize napřímo, pokaždé.
    logEv(`🧬 castSize=${castSize} (charactersForNames=${charactersForNames.length}, rawCustomForNames=${rawCustomForNames?.length ?? 0}, body.characterIds=${JSON.stringify(body.characterIds)})`);
    // 🩺 stejný test (2026-08-05): u castSize 4+ archy V TEHDEJŠÍM (volnějším,
    // max 3 lidi/panel) nastavení prošly jen v 0-8 % případů napříč 5 dávkami
    // — přeskočit je úplně bylo dražší (víc sólo obrázků), ale mnohem
    // rychlejší a spolehlivější než 250s skoro bez užitku.
    // 🩺 2026-08-11: prah zvednut na 7 (z 4) — ALE jen se souběžnou změnou
    // níž (castMidTier teď pokrývá 3-6, ne jen 3): pro castSize 4-6 appka
    // NEPOUŽÍVÁ ten dřívější neúspěšný 3-lidi/panel default, ale rovnou ten
    // přísnější 2×2/max-2-lidi režim, co byl vyhrazený jen pro castSize=3.
    // Skutečná rodina má běžně 5-9 postav (děti+rodiče+pes) — s prahem 4 se
    // archy prakticky NIKDY nepoužily (živý test 2026-08-11, 5 i 7 postav
    // obě spadly do sólo, 2,35 Kč/str. a 1,5 Kč/str. — 1,5-2,3× nad cílem
    // ECONOMY-PLAN ~1 Kč/str.). Sleduj debug-logy (🗂️ vs 🎨 poměr prošlých
    // panelů) — pokud i přísnější varianta u 4-6 zůstane pod ~30% úspěšností,
    // vrať SHEET_SKIP_CAST_SIZE zpátky na 4.
    const SHEET_SKIP_CAST_SIZE = 7;
    const sheetMode = (process.env.IMAGE_SHEET_MODE || "3x3").toLowerCase();
    // 🧪 Prototyp 2026-08-13: první/hero scéna zůstává samostatná kotva a až
    // devět zbývajících scén se pokusí vyrobit v JEDINÉM 4K storyboardu.
    // Feature flag je defaultně vypnutý; produkční pipeline se beze změny.
    if (st.sheetGaveUp) logEv("🗂️ archová fáze už dřív vzdala (žádný nový panel) → rovnou sólo");
    else if (castSize >= SHEET_SKIP_CAST_SIZE) logEv(`🧪 ${castSize} postav v pohádce (≥${SHEET_SKIP_CAST_SIZE}) — archy přeskočeny, rovnou sólo (viz test 2026-08-05, prah zvednut 2026-08-11)`);
    else if (castSize >= 3) logEv(`🧪 ${castSize} postav v pohádce — mezistupeň: archy 2×2, max 2 lidi/panel (přísnější než obvykle, rozšířeno z castSize=3 na 3-${SHEET_SKIP_CAST_SIZE - 1} dne 2026-08-11)`);
    // 🩺 2026-08-05, rozšířeno 2026-08-11: mezistupeň mezi "archy jako
    // obvykle" (≤2) a "přeskočit úplně" (≥7) — u castSize 3-6 zůstávají
    // archy zapnuté, ale s přísnějším 2×2 (víc pixelů/panel, snazší posoudit
    // výšku/barvu očí) a max 2 lidmi/panel (dřívější nálezy byly skoro vždy
    // o poměru MEZI 2+ lidmi v jednom panelu) — snaha zachránit část úspory
    // místo rovnou padnout na dražší sólo. Dřív jen castSize===3.
    const castMidTier = castSize >= 3 && castSize < SHEET_SKIP_CAST_SIZE;
    if (sheetMode !== "off" && !quotaExhausted && !st.sheetGaveUp && castSize < SHEET_SKIP_CAST_SIZE && st.sceneUrls![0]) {
      const maxCells = oneSheetStory ? 9 : castMidTier ? 4 : sheetMode === "2x2" ? 4 : 9;
      // ⚡ Archy jedné vlny běží PARALELNĚ (15 stránek = archy 9+5 najednou —
      // 4K arch generuje ~stejně dlouho jako jedna 1K scéna, sériově to byla
      // zbytečná minuta navíc). Max 2 vlny; vlna bez jediného nového panelu
      // ukončuje archovou fázi (pojistka proti smyčce archů).
      let prevRoundReports = ""; // výtky z 1. vlny → 2. vlna kreslí s korekcí
      const maxSheetRounds = oneSheetStory ? 1 : 2;
      for (let round = 1; round <= maxSheetRounds && !quotaExhausted && !timeUp() && !budgetBlown() && !overallTimeUp(); round++) {
        const pend = [...Array(total).keys()].filter(i => !st.sceneUrls![i]);
        if (pend.length < 2) break;
        // 🎯 Scény se STEJNÝM obsazením seskupit do stejného archu — čím míň
        // různých lidí v jednom obrázku, tím menší riziko zaměněných identit
        // (pořadí panelů v archu na příběhu nezáleží, výřezy se ukládají
        // zpátky podle PŮVODNÍHO indexu scény, ne podle pozice v archu).
        const castKey = (i: number) => (sceneCastList(scenesScript[i].imagePrompt) || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean).sort().join(",");
        const castOf = (i: number) => castKey(i).split(",").filter(Boolean);
        const castPeople = (key: string) => key ? key.split(",").filter(Boolean).length : 0;
        // 🗂️ UVOLNĚNÉ seskupování: dřív se do archu dostaly jen scény s ≤2 lidmi
        // A ZÁROVEŇ naprosto shodným obsazením — u běžné pohádky (kde se cast
        // scénu od scény mění) to znamenalo, že se archy skoro nechytly a vše
        // se kreslilo drahým sólem. Teď se grupuje podle PŘEKRYVU obsazení:
        // panel smí mít až MAX_PANEL_PEOPLE lidí a celý arch až MAX_SHEET_PEOPLE
        // různých osob (per-panel popisky referencí `refsForPanels` umí i
        // míchané obsazení). Obojí jde stáhnout envem, kdyby kvalita klesla.
        const maxPanelPeople = castMidTier ? 2 : Number(process.env.IMAGE_SHEET_MAX_PANEL_PEOPLE || 3);
        const maxSheetPeople = Number(process.env.IMAGE_SHEET_MAX_PEOPLE || (oneSheetStory ? 7 : 4));
        // ⚡ Skutečný počet panelů v JEDNOM archu — dřív šel až na maxCells (9 v
        // 3×3 mřížce). Čím víc panelů v jednom volání, tím víc verifikačních
        // dávek (po 4) a tím déle trvá, než je hotový byť POSLEDNÍ panel toho
        // archu (nahlášeno: „obrázky se načítají dlouho potom co se pohádka
        // načte"). 6 defaultně = max 2 verifikační dávky místo 3, arch pořád
        // stojí stejnou paušální cenu (prázdné buňky = jen klidná scenérie).
        const maxGroupPanels = Math.min(maxCells, Number(process.env.IMAGE_SHEET_MAX_REAL_PANELS || (oneSheetStory ? 9 : 6)));
        // Řadit podle obsazení, při shodě podle indexu scény — sousední scény
        // se tak drží pohromadě, což bývá i stejné prostředí (jeden arch =
        // jedno místo = model drží kulisu konzistentně sám od sebe)
        const pendGrouped = pend.filter(i => castPeople(castKey(i)) <= maxPanelPeople)
          // One-sheet storyboard drží děj chronologicky. Běžný režim dál
          // seskupuje podle castu, jak byl odladěný v produkci.
          .sort((a, b) => oneSheetStory ? a - b : castKey(a).localeCompare(castKey(b)) || a - b);
        const groups: number[][] = [];
        let cur: number[] = [];
        let curPeople = new Set<string>();
        for (const i of pendGrouped) {
          const merged = new Set([...curPeople, ...castOf(i)]);
          if (cur.length > 0 && (merged.size > maxSheetPeople || cur.length >= maxGroupPanels)) {
            groups.push(cur); cur = []; curPeople = new Set();
          }
          for (const p of castOf(i)) curPeople.add(p);
          cur.push(i);
        }
        if (cur.length) groups.push(cur);
        // 💰 Arch stojí PAUŠÁLNĚ $0.151 bez ohledu na počet panelů uvnitř —
        // u 2 scén (2×$0.067 sólo = $0.134) je tedy arch VŽDY DRAŽŠÍ než sólo,
        // i když se to celé povede. Vyplatí se až od 3 scén ($0.151/3 < $0.067).
        // Testem odhaleno: 2panelový arch v run2 uspěl kvalitativně, ale
        // ekonomicky prodělal — proto se tu neseskupuje jen na "≥2", ale "≥3".
        for (let g = groups.length - 1; g >= 0; g--) if (groups[g].length < 3) groups.splice(g, 1);
        if (groups.length === 0) break;
        const before = Object.keys(st.sceneUrls!).length;
        st.imgSpent = spentNow();
        st.spent1k = totalImages1k(); st.spent4k = totalImages4k();
        logEv(`🗂️ kreslím ${groups.length > 1 ? `${groups.length} archy paralelně` : "arch"} (${groups.map(g => g.length).join("+")} scén)`);
        await write(); // heartbeat před dlouhým generováním
        const roundReports: string[] = [];
        await Promise.all(groups.map(async group => {
          const tSheet = Date.now();
          try {
            // 🎯 Panel-aware reference: každý portrét dostane popisek „jen pro
            // PANEL X" — bez toho model při 3+ postavách v archu míchal/
            // vymýšlel obličeje (nevěděl, který portrét patří ke kterému panelu)
            const panelTexts = group.map(i => `${scenesScript[i].imagePrompt} ${scenesScript[i].narration}`);
            const groupRefs = [...refsForPanels(refEntries, panelTexts), ...customRefs];
            // 📏🖼️ Arch kreslí víc scén najednou → poměry výšek se v něm musí
            // držet napříč panely; výškový list i skupinová kotva jsou tu
            // proto vždy (když existují)
            if (scaleSheet) groupRefs.push(scaleSheet);
            if (groupAnchor) groupRefs.push(groupAnchor);
            const refs = anchor ? [...groupRefs, anchor] : groupRefs;
            // ⚡ Panely se ukládají HNED, jak je každý jednotlivě hotový (ne až
            // po nejpomalejším z celého archu) — appka dřív čekala na CELOU
            // skupinu 3-9 scén najednou, než ukázala byť jednu (nahlášeno:
            // „obrázky se načítají dlouho potom co se pohádka načte").
            const { results, report } = await generateSceneSheet(
              group.map(i => scenesScript[i]), heroDescription, refs, prevRoundReports,
              async (k, img) => {
                if (!img) return;
                const i = group[k];
                const url = await putJson(`jobs/${id}/scene-${i}.json`, {
                  index: scenesScript[i].index,
                  imageUrl: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
                });
                st.sceneUrls![i] = url;
                st.done = Object.keys(st.sceneUrls!).length;
                await write();
              },
              oneSheetStory ? {
                deadline: sceneDeadline(),
                lenientSimplePanels: true,
                maxGridAttempts: 1,
                maxPanelEdits: 1,
                allowFixedGridFallback: true,
              } : { deadline: sceneDeadline() }
            );
            if (report) roundReports.push(report);
            const passed = results.filter(Boolean).length;
            logEv(`🗂️ arch (${group.length} scén) hotový za ${secsSince(tSheet)}s (prošlo ${passed}/${group.length})${report ? ` — ${report.slice(0, 200)}` : ""}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            logEv(`🗂️ arch CHYBA po ${secsSince(tSheet)}s: ${msg.slice(0, 140)} → sólo dokreslení`);
            if (isDailyQuotaError(msg)) quotaExhausted = true;
            if (isCreditsDepletedError(msg)) creditsDepleted = true;
            if (isSpendCapError(msg)) spendCapped = true;
          }
        }));
        const afterCount = Object.keys(st.sceneUrls!).length;
        const roundPanels = groups.reduce((n, g) => n + g.length, 0);
        const roundPassRate = roundPanels > 0 ? (afterCount - before) / roundPanels : 1;
        if (afterCount === before) {
          logEv("🗂️ archy nepřinesly žádný nový panel → zbytek jde sólo cestou");
          st.sheetGaveUp = true; // příští řetěz už archy nezkouší znovu
          break;
        }
        // 🩺 2026-08-05: dřív appka pokračovala do dalšího kola i po pouhých
        // 1/12 (8 %) prošlých panelech — živý test ukázal, že další kolo za
        // takové situace skoro nikdy nepomůže (0/11 v dalším kole té samé
        // pohádky) a jen spálí dalších ~115s. Nízká úspěšnost (<25 %) rovnou
        // vzdává, stejně jako nulová.
        if (roundPassRate < 0.25) {
          logEv(`🗂️ nízká úspěšnost archů (${afterCount - before}/${roundPanels}, ${Math.round(roundPassRate * 100)}%) → zbytek jde sólo cestou`);
          st.sheetGaveUp = true;
          break;
        }
        prevRoundReports = roundReports.join(" | ");
      }
    }

    let idx = 1;
    async function worker() {
      while (idx < total && !timeUp() && !overallTimeUp()) { const i = idx++; await doScene(i); }
    }
    // 5 souběžných kreslířů (dřív 4, dřív 3) — sólo dokreslení po neprošlém
    // archu je nejpomalejší fáze. 2026-08-05: opatrně zvýšeno o 1 kvůli
    // testu, co ukázal 15scénové pohádky nestíhat — NEOVĚŘENO živě proti
    // Gemini limitům, sleduj isDailyQuotaError/429 v logu po nasazení; při
    // zhoršení (víc quota chyb, ne rychlejší dokreslení) vrať na 4.
    await Promise.all(Array.from({ length: Math.min(5, Math.max(0, total - 1)) }, worker));

    // Verification rounds — the job is done only when every image exists
    for (let round = 0; round < 2 && !quotaExhausted && !timeUp() && !overallTimeUp(); round++) {
      const missing = [...Array(total).keys()].filter(i => !st.sceneUrls![i]);
      if (missing.length === 0) break;
      for (const i of missing) { if (timeUp() || overallTimeUp()) break; await doScene(i); }
    }

    st.imgSpent = spentNow(); // 💰 útrata běhu do stavu (řetězy ji sčítají)
    st.spent1k = totalImages1k(); st.spent4k = totalImages4k(); // 🩺 viz komentář u JobStatus.spent1k

    // 💰 Rozpočet vyčerpán a scény chybí → jasná chyba místo dalších běhů
    if (budgetBlown() && Object.keys(st.sceneUrls!).length < total) {
      st.phase = "error";
      st.error = `Ochrana rozpočtu: pohádka už vygenerovala ${st.imgSpent} obrázků (limit ${IMG_BUDGET} pro ${total} stránek, hotovo ${Object.keys(st.sceneUrls!).length}/${total}) — zrušte ji ✕ a zadejte znovu, případně s méně stránkami.`;
      logEv(`⛔ STOP: rozpočet obrázků vyčerpán (${st.imgSpent}/${IMG_BUDGET})`);
      await write();
      await writeUsageRecord(totalImages1k(), 0, typeof body.deviceId === "string" ? body.deviceId : undefined, totalImages4k(), true);
      return;
    }

    // ♻️ Došel čas funkce a scény ještě chybí → předat štafetu další funkci
    // (hotové scény se přeskočí; klientský watchdog zůstává jako záloha) —
    // ALE jen pokud jsme ještě pod globálním 5min stropem; jinak by se
    // pohádka mohla řetězit donekonečna (viz „Kvarner" — 7 řetězů, 36 min)
    if (!quotaExhausted && Object.keys(st.sceneUrls!).length < total && (timeUp() || overallTimeUp())) {
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
      // 🩺 Log dřív VŽDY psal "denní kvóta" (i u vyčerpaného kreditu/rozpočtového
      // stropu, viz isDailyQuotaError výš, která "credits are depleted" bere
      // jako PODMNOŽINU obecné "denní kvóty") — matlo to uživatele k dojmu
      // "samo se to ráno spraví", i když šlo o placení, ne o čas.
      logEv(`⛔ STOP: ${spendCapped ? "měsíční rozpočtový strop" : creditsDepleted ? "vyčerpaný kredit" : "denní kvóta"} Gemini vyčerpaná (${Object.keys(st.sceneUrls!).length}/${total})`);
      await write();
      await writeUsageRecord(totalImages1k(), 0, typeof body.deviceId === "string" ? body.deviceId : undefined, totalImages4k(), true);
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

    const soundResult = await customSoundsPromise;
    if (soundResult.cachedOrGenerated > 0) logEv(`🔊 zakázkové SFX ${soundResult.generated}/${soundResult.cachedOrGenerated} (zbytek knihovní fallback)`);
    st.phase = "done";
    st.finishedAt = Date.now(); // ⏱ pohádka kompletní
    logEv(`✅ HOTOVO — celkem ${Math.round((st.finishedAt - st.createdAt) / 1000)}s od zadání (psaní ${st.wroteAt ? Math.round((st.wroteAt - st.createdAt) / 1000) : "?"}s, řetězů ${st.chains ?? 0})`);
    // 💳 Odečet kreditu — jen jednou (creditsCharged pojistí proti dvojímu
    // odečtu, kdyby navázání/restart jobu proběhlo přes už dokončený stav).
    // Skutečná cena (ne odhad z /api/job/start) — portréty/archy z cache
    // (jiná pohádka stejné rodiny) se neúčtují znovu, jen co se OPRAVDU
    // nakreslilo v TOMHLE běhu (madeImages/madeSheets).
    if (st.username && !st.creditsCharged) {
      // Použít kumulativní počty přes VŠECHNY self-chain invokace. madeImages/
      // madeSheets obsahují jen aktuální běh a u řetězené pohádky podhodnocovaly
      // kreditní cenu, zatímco usage log níž už totals používal správně.
      const cost = actualStoryCostCredits({ images1k: totalImages1k(), images4k: totalImages4k(), voiceChars }, st.writeTokens);
      await chargeForCompletedStory(st.username, cost).catch(() => {});
      st.creditsCharged = true;
    }
    await write();
    // TTS se vyrábí až přes /api/scene, který zapisuje SKUTEČNĚ namluvené
    // znaky. Kdyby je story record zapsal také, agregát je počítá dvakrát.
    await writeUsageRecord(totalImages1k(), 0, typeof body.deviceId === "string" ? body.deviceId : undefined, totalImages4k(), true,
      (st.finishedAt - st.createdAt) / 1000); // ⏱ trvání přípravy do panelu Spotřeba
  } catch (e) {
    st.phase = "error";
    st.error = e instanceof Error ? e.message : String(e);
    st.lastError = st.error;
    // Preserve and meter provider spend even when no story is completed. This
    // includes the early scene that may have rendered while Claude was writing.
    st.spent1k = spent1kAtRunStart + madeImagesThisRun();
    st.spent4k = spent4kAtRunStart + madeSheetsThisRun();
    st.imgSpent = st.spent1k + st.spent4k;
    logEv(`💥 CHYBA běhu: ${st.error.slice(0, 160)}`);
    await write();
    await writeUsageRecord(st.spent1k, 0, typeof body.deviceId === "string" ? body.deviceId : undefined, st.spent4k);
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
