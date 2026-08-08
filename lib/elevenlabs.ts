import type { Scene, WordTiming } from "./types";
import { readJson } from "./job-runner";

// Strip non-printable chars -- belt-and-suspenders before setting HTTP headers
function sanitizeApiKey(key: string | undefined): string {
  return (key || "").replace(/[^\x20-\x7E]/g, "").trim();
}

// Fonetický přepis jmen, která český syntetický hlas čte špatně („James" by
// přečetl „Jamés", „Nicolásek" jako „Nicolásek" s C). Mění se JEN text posílaný
// do TTS — titulky v aplikaci zůstávají s původním pravopisem. Náhrady fungují
// i pro české pády (Jamesovi → Džejmsovi, Archieho → Árčího, Nicoláskem → Nikoláskem).
const CS_PRONUNCIATIONS: Array<[RegExp, string]> = [
  [/Nicol/g, "Nikol"],
  [/James/g, "Džejms"],
  [/Archie/g, "Árčí"],
];

// Česká narace se pozná podle diakritiky — anglický text zůstane nedotčený
function looksCzech(text: string): boolean {
  return /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/.test(text);
}

function applyCzechPronunciations(text: string): string {
  if (!looksCzech(text)) return text;
  let out = text;
  for (const [re, replacement] of CS_PRONUNCIATIONS) out = out.replace(re, replacement);
  return out;
}

// 🗣️ Fonetické nápovědy PRO TUTO KONKRÉTNÍ pohádku — Claude je připojí na
// konec heroDescription (stejný trik appka používá pro worldNotes), když si
// pro příběh vymyslí jméno, které by hlas mohl přečíst špatně (např. postavy
// jídla ve světě "Mexická kuchyně" — Tortillka, Chillička). Statický seznam
// výše pokrývá jen FIXNÍ rodinné postavy — tohle pokrývá cokoli vymyšlené
// PRO JEDNU KONKRÉTNÍ pohádku, aniž by appka musela protahovat nové pole
// přes všechna volání /api/scene — heroDescription tam už beztak chodí vždy.
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractDynamicHints(heroDescription: string): Array<[RegExp, string]> {
  const m = /Pronunciation hints\s*:\s*([^|]+)/i.exec(heroDescription);
  if (!m) return [];
  const pairs: Array<[RegExp, string]> = [];
  for (const part of m[1].split(";")) {
    const [from, to] = part.split("→").map(s => s?.trim());
    if (from && to) pairs.push([new RegExp(escapeRegExp(from), "g"), to]);
  }
  return pairs;
}

function applyDynamicHints(text: string, heroDescription?: string): string {
  if (!heroDescription) return text;
  let out = text;
  for (const [re, to] of extractDynamicHints(heroDescription)) out = out.replace(re, to);
  return out;
}

function envNum(name: string, fallback: number): number {
  const n = parseFloat(process.env[name] || "");
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

function sanitizeText(text: string): string {
  return text
    .replace(/…/g, "...")   // horizontal ellipsis
    .replace(/–/g, "-")     // en dash
    .replace(/—/g, "--")    // em dash
    .replace(/[“”]/g, '"')  // curly double quotes
    .replace(/[‘’]/g, "'")  // curly single quotes
    .replace(/[«»]/g, '"')  // guillemets
    .replace(/­/g, "")      // soft hyphen
    .replace(/​/g, "");     // zero-width space
}

/** Stejná úprava textu pro jiné TTS (Gemini): fonetika jmen + typografie */
export function prepareNarrationText(text: string, heroDescription?: string): string {
  return applyDynamicHints(applyCzechPronunciations(sanitizeText(text)), heroDescription);
}

export interface VoiceTuning {
  stability?: number;
  similarityBoost?: number;
  style?: number;
}

/** Vlastní doladění klonovaného hlasu uložené přes PATCH /api/voice-clone (playback only) */
export async function getCloneTuning(voiceId: string): Promise<VoiceTuning | undefined> {
  const clones = await readJson<Array<{ id: string; settings?: VoiceTuning }>>("voices/clones.json");
  return Array.isArray(clones) ? clones.find(c => c.id === voiceId)?.settings : undefined;
}

function voiceSettingsFor(tuning?: VoiceTuning) {
  // Živější přednes: nižší stability = větší intonační rozsah (citoslovce,
  // zvířecí zvuky), style dodá dramatičnost, speaker_boost drží barvu hlasu.
  // Ladění bez nasazování: env ELEVEN_STABILITY / ELEVEN_STYLE /
  // ELEVEN_SIMILARITY (0–1) a ELEVEN_SPEED (0.7–1.2) ve Vercelu
  return {
    stability: tuning?.stability ?? envNum("ELEVEN_STABILITY", 0.42),
    similarity_boost: tuning?.similarityBoost ?? envNum("ELEVEN_SIMILARITY", 0.8),
    style: tuning?.style ?? envNum("ELEVEN_STYLE", 0.35),
    use_speaker_boost: true,
    ...(process.env.ELEVEN_SPEED
      ? { speed: Math.min(1.2, Math.max(0.7, parseFloat(process.env.ELEVEN_SPEED) || 1)) }
      : {}),
  };
}

export async function narrateScene(scene: Scene, overrideVoiceId?: string, tuning?: VoiceTuning, heroDescription?: string): Promise<Buffer> {
  const apiKey = sanitizeApiKey(process.env.ELEVENLABS_API_KEY);
  if (!apiKey) throw new Error("Chybi ELEVENLABS_API_KEY.");

  const voiceId = sanitizeApiKey(overrideVoiceId || process.env.ELEVENLABS_VOICE_ID);
  if (!voiceId) throw new Error("Chybi ELEVENLABS_VOICE_ID.");

  // 🩺 2026-08-06: eleven_flash_v2_5 potvrzeno A/B testem (uživatel poslechl,
  // schválil) — stejná čeština, poloviční cena ($0,091 vs $0,182/1000 znaků
  // v rámci Creator plánu, viz ECONOMY-PLAN.md). Přepnuto z multilingual_v2.
  const modelId = sanitizeApiKey(process.env.ELEVENLABS_MODEL_ID) || "eleven_flash_v2_5";

  // Use native fetch (Node 18+) -- avoids node:https header-char validation quirks
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,
    {
      method: "POST",
      headers: {
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: applyDynamicHints(applyCzechPronunciations(sanitizeText(scene.narration)), heroDescription),
        model_id: modelId,
        output_format: "mp3_44100_128",
        voice_settings: voiceSettingsFor(tuning),
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 300)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/** ElevenLabs vrací zarovnání na úrovni ZNAKŮ (character_start/end_times_seconds
 *  souběžně s polem znaků) — appka si z nich sama poskládá SLOVA (rozdělená
 *  mezerami), protože přehrávač zvýrazňuje celá slova, ne jednotlivá písmena. */
function wordsFromAlignment(alignment: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] }): WordTiming[] {
  const { characters, character_start_times_seconds: starts, character_end_times_seconds: ends } = alignment;
  const words: WordTiming[] = [];
  let cur = "", curStart = -1, curEnd = -1;
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i];
    if (/\s/.test(ch)) {
      if (cur) { words.push({ word: cur, start: curStart, end: curEnd }); cur = ""; curStart = -1; }
      continue;
    }
    if (curStart < 0) curStart = starts[i];
    curEnd = ends[i];
    cur += ch;
  }
  if (cur) words.push({ word: cur, start: curStart, end: curEnd });
  return words;
}

/** Stejné namluvení jako narrateScene, ale přes `/with-timestamps` endpoint —
 *  appka navíc dostane SKUTEČNÉ časování každého slova (ne jen hotové audio),
 *  potřebné pro karaoke zvýrazňování textu v čtečce. Používá appka JEN při
 *  líném namlouvání v reálném čase čtení (viz app/api/scene/route.ts,
 *  audioOnly větev) — generování pohádky samotné časování nepotřebuje.
 *  ElevenLabs za timestamps neúčtuje nic navíc (stejná cena jako narrateScene). */
export async function narrateSceneTimed(scene: Scene, overrideVoiceId?: string, tuning?: VoiceTuning, heroDescription?: string): Promise<{ buffer: Buffer; mimeType: string; wordTimings: WordTiming[] }> {
  const apiKey = sanitizeApiKey(process.env.ELEVENLABS_API_KEY);
  if (!apiKey) throw new Error("Chybi ELEVENLABS_API_KEY.");

  const voiceId = sanitizeApiKey(overrideVoiceId || process.env.ELEVENLABS_VOICE_ID);
  if (!voiceId) throw new Error("Chybi ELEVENLABS_VOICE_ID.");

  const modelId = sanitizeApiKey(process.env.ELEVENLABS_MODEL_ID) || "eleven_flash_v2_5";

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "xi-api-key": apiKey,
      },
      body: JSON.stringify({
        text: applyDynamicHints(applyCzechPronunciations(sanitizeText(scene.narration)), heroDescription),
        model_id: modelId,
        output_format: "mp3_44100_128",
        voice_settings: voiceSettingsFor(tuning),
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json() as {
    audio_base64: string;
    alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };
  };
  const buffer = Buffer.from(data.audio_base64, "base64");
  // Chybějící alignment (appka to zatím nikdy neviděla, ale API kontrakt ho
  // označuje volitelný) → appka vrátí audio bez časování, klient si poradí
  // vlastním ODHADEM (viz page.tsx, stejný fallback jako pro Gemini hlasy).
  const wordTimings = data.alignment ? wordsFromAlignment(data.alignment) : [];
  return { buffer, mimeType: "audio/mpeg", wordTimings };
}
