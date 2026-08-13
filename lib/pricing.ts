// 💳 Cenový model kreditů: "1 kredit = 1 Kč nákladů appky + 50% marže."
// Nahrazuje starý plochý model (1 kredit = 1 pohádka, viz historie
// storyCreditCost) — appka teď účtuje podle SKUTEČNĚ spotřebovaných zdrojů
// TÉHLE KONKRÉTNÍ pohádky (kolik obrázků/archů se doopravdy nakreslilo —
// portréty postav jsou cachované napříč pohádkami, takže druhá pohádka se
// stejnou rodinou vyjde levněji, protože nic nového kreslit nemusí).
//
// ⚠️ SAZBY NÍŽE JSOU VÝCHOZÍ ODHAD, NE ověřená aktuální fakturace — jediné
// číslo doložené přímo v kódu byl komentář u IMAGE_MODEL v lib/gemini.ts
// ($0.067 ≈ 1,55 Kč/obrázek, z něj i odvozený kurz ~23 Kč/$). Cena psaní
// scénáře (Claude) a namluvení (ElevenLabs) appka dosud vůbec netrackovala
// (viz voiceChars = 0 v job-runner.ts) — čísla níž je NUTNÉ properit proti
// skutečným fakturám z Anthropic/ElevenLabs a upravit, než se na tenhle
// model dá spolehnout v ostrém provozu.

/** Kurz použitý appkou napříč cenovým modelem — jediné místo ke změně. */
export const USD_TO_CZK = 23;

/** Gemini 1K obrázek scény — zdroj: komentář u IMAGE_MODEL, lib/gemini.ts. */
export const COST_USD_PER_IMAGE_1K = 0.067;
/** 4K arch (víc scén v jednom obrázku). Oficiální Gemini 3.1 Flash Image
 *  sazba k 2026-08-13: $0.151 za 4K výstup. */
export const COST_USD_PER_IMAGE_4K = 0.151;
/** ElevenLabs Flash/Turbo API sazba k 2026-08-13. Multilingual v2/v3 stojí
 *  $0.10/1k znaků; produkční default eleven_flash_v2_5 stojí $0.05/1k. */
export const COST_USD_PER_1K_VOICE_CHARS = 0.05;
/** Claude (psaní scénáře) — paušál na 10stránkovou pohádku, POUZE fallback
 *  pro staré/nedohledatelné joby bez writeTokens (viz job-runner.ts). Od
 *  2026-08-06 appka měří SKUTEČNÉ tokeny (message_start/message_delta SSE,
 *  lib/claude.ts onUsage) → actualStoryCostCredits() je použije místo
 *  tohohle paušálu, když jsou k dispozici. */
export const COST_USD_PER_STORY_WRITING = 0.15;

/** Claude Sonnet 5 (claude-sonnet-5) — Anthropic 2026-08-10 oznámil, že
 *  původně úvodní $2/$10 sazba zůstává standardní a 2026-09-01 se nezvýší. */
/** USD za 1M input tokenů. */
export const COST_USD_PER_MTOK_INPUT = 2.0;
/** USD za 1M output tokenů (zahrnuje thinking tokeny, appka thinking
 *  nepoužívá — viz callAnthropicApi). */
export const COST_USD_PER_MTOK_OUTPUT = 10.0;
/** 🩺 2026-08-06 (2): psaní scénáře posílá system prompt s cache_control:
 *  ephemeral (buildSystemPrompt, ~4k tokenů, neměnný napříč pohádkami se
 *  stejným jazykem) — `input_tokens` v odpovědi je proto jen NEKEŠOVANÝ
 *  zbytek promptu, ne jeho celková velikost. cache_creation (zápis, 1. volání
 *  po vypršení 5min TTL) a cache_read (čtení, každé další volání v tom
 *  okně) mají VLASTNÍ sazbu — 1,25× a 0,1× ceny běžného inputu — jinak by
 *  actualStoryCostCredits cenu psaní systematicky podhodnocovala u
 *  KAŽDÉHO volání, co trefí cache (typicky víc než polovina — fronta
 *  pohádek, restarty, navázání po resume). */
export const COST_USD_PER_MTOK_CACHE_WRITE = COST_USD_PER_MTOK_INPUT * 1.25;
export const COST_USD_PER_MTOK_CACHE_READ = COST_USD_PER_MTOK_INPUT * 0.1;

/** Marže appky nad reálné náklady. */
export const MARGIN_MULTIPLIER = 1.5;

/** Kolik znaků narace appka v průměru čeká na stránku — pro ODHAD ceny PŘED
 *  generováním (skutečná cena po dokončení použije reálně napsaný text). */
const EST_VOICE_CHARS_PER_SCENE = 380;

function usdToCredits(usd: number): number {
  // 1 kredit = 1 Kč nákladů + 50% marže — zaokrouhleno NAHORU (appka nikdy
  // nesmí prodělat na zaokrouhlení dolů u drobných pohádek).
  return Math.max(1, Math.ceil(usd * USD_TO_CZK * MARGIN_MULTIPLIER));
}

/** Odhad ceny PŘED spuštěním — appka podle něj kontroluje, jestli má
 *  uživatel dost kreditů, ještě než začne cokoliv generovat (skutečné
 *  náklady se zjistí až po dokončení, viz actualStoryCostCredits). */
export function estimateStoryCostCredits(body: { sceneCount?: unknown; twoEndings?: unknown }): number {
  const sceneCount = Math.max(1, Math.min(20, Number(body.sceneCount) || 10));
  const endingMultiplier = body.twoEndings ? 1.3 : 1; // druhý konec ~30% scén navíc
  const estImages = Math.ceil(sceneCount * endingMultiplier);
  const estVoiceChars = estImages * EST_VOICE_CHARS_PER_SCENE;
  const usd =
    COST_USD_PER_STORY_WRITING +
    estImages * COST_USD_PER_IMAGE_1K +
    (estVoiceChars / 1000) * COST_USD_PER_1K_VOICE_CHARS;
  return usdToCredits(usd);
}

/** Skutečná cena PO dokončení — podle toho, co appka OPRAVDU nakreslila a
 *  namluvila (portréty/archy z cache se neúčtují znovu). `writeTokens`
 *  (reálné input/output tokeny Claudova psaní scénáře, sečtené napříč
 *  všemi pokusy/resume té které pohádky — viz st.writeTokens v
 *  job-runner.ts) je od 2026-08-06 volitelné a POKUD je k dispozici,
 *  nahradí paušál COST_USD_PER_STORY_WRITING skutečnou cenou. Bez něj
 *  (staré cachované joby) appka spadne zpátky na paušál. */
export function actualStoryCostCredits(
  usage: { images1k: number; images4k: number; voiceChars: number },
  writeTokens?: { input: number; output: number; cacheCreation?: number; cacheRead?: number }
): number {
  const writingCostUsd = writeTokens
    ? (writeTokens.input / 1_000_000) * COST_USD_PER_MTOK_INPUT +
      (writeTokens.output / 1_000_000) * COST_USD_PER_MTOK_OUTPUT +
      ((writeTokens.cacheCreation ?? 0) / 1_000_000) * COST_USD_PER_MTOK_CACHE_WRITE +
      ((writeTokens.cacheRead ?? 0) / 1_000_000) * COST_USD_PER_MTOK_CACHE_READ
    : COST_USD_PER_STORY_WRITING;
  const usd =
    writingCostUsd +
    usage.images1k * COST_USD_PER_IMAGE_1K +
    usage.images4k * COST_USD_PER_IMAGE_4K +
    (usage.voiceChars / 1000) * COST_USD_PER_1K_VOICE_CHARS;
  return usdToCredits(usd);
}
