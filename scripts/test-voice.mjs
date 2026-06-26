#!/usr/bin/env node
// Lokální ověření ElevenLabs (spouštěj u sebe, kde funguje síť):
//   npm run test:voice
//
// 1) ověří ELEVENLABS_API_KEY
// 2) vypíše hlasy ve tvém účtu (ready k použití) + ID
// 3) nabídne české hlasy z Voice Library (s ID)
// 4) namluví krátkou českou větu do voice-sample.mp3, ať slyšíš kvalitu
//
// Pozn.: model eleven_multilingual_v2 umí česky s libovolným hlasem.

import { readFileSync, writeFileSync, existsSync } from "node:fs";

// ── načti .env.local / .env (bez závislosti na dotenv) ──
function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  }
}
loadEnv();

const API = "https://api.elevenlabs.io";
const KEY = process.env.ELEVENLABS_API_KEY;
const MODEL = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const SAMPLE_TEXT =
  "Ahoj Nicolasi! Tohle je ukázka hlasu, kterým ti budeme vyprávět pohádky. Dobrou noc.";

if (!KEY) {
  console.error("❌ Chybí ELEVENLABS_API_KEY v .env.local");
  process.exit(1);
}

const headers = { "xi-api-key": KEY };

async function main() {
  // 1) ověření klíče
  const subRes = await fetch(`${API}/v1/user/subscription`, { headers });
  if (!subRes.ok) {
    console.error(`❌ Klíč neprošel (HTTP ${subRes.status}). ${await subRes.text()}`);
    process.exit(1);
  }
  const sub = await subRes.json();
  console.log("✅ Klíč funguje");
  console.log(`   Tier: ${sub.tier}`);
  console.log(`   Znaky: ${sub.character_count} / ${sub.character_limit}\n`);

  // 2) hlasy v účtu (ready k použití)
  const myRes = await fetch(`${API}/v2/voices?page_size=100`, { headers });
  const my = myRes.ok ? await myRes.json() : { voices: [] };
  console.log(`🎙️  Hlasy ve tvém účtu (${my.voices?.length || 0}) – ready k použití:`);
  for (const v of my.voices || []) {
    const lang = v.labels?.language || v.labels?.accent || "";
    console.log(`   • ${v.name.padEnd(22)} ${v.voice_id}   ${lang}`);
  }
  console.log();

  // 3) české hlasy z Voice Library (návrhy – přidej je v appce ElevenLabs)
  try {
    const sharedRes = await fetch(`${API}/v1/shared-voices?language=cs&page_size=15`, { headers });
    if (sharedRes.ok) {
      const shared = await sharedRes.json();
      const list = shared.voices || [];
      if (list.length) {
        console.log(`🇨🇿 České hlasy z Voice Library (${list.length}) – přidej je tlačítkem „Add" v appce:`);
        for (const v of list) {
          console.log(`   • ${(v.name || "").padEnd(22)} ${v.voice_id}   ${v.accent || ""}`);
        }
        console.log();
      }
    }
  } catch {
    /* nepovinné */
  }

  // 4) ukázkové namluvení
  const voiceId =
    process.env.ELEVENLABS_VOICE_ID || my.voices?.[0]?.voice_id;
  if (!voiceId) {
    console.log("ℹ️  Nastav ELEVENLABS_VOICE_ID v .env.local a spusť znovu pro ukázku hlasu.");
    return;
  }
  console.log(`🔊 Generuji ukázku hlasem ${voiceId} (model ${MODEL})…`);
  const ttsRes = await fetch(
    `${API}/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ text: SAMPLE_TEXT, model_id: MODEL }),
    }
  );
  if (!ttsRes.ok) {
    console.error(`❌ TTS selhalo (HTTP ${ttsRes.status}). ${await ttsRes.text()}`);
    process.exit(1);
  }
  const buf = Buffer.from(await ttsRes.arrayBuffer());
  writeFileSync("voice-sample.mp3", buf);
  console.log(`✅ Uloženo do voice-sample.mp3 (${buf.length} bajtů) – přehraj si a vyber hlas.`);
}

main().catch((e) => {
  console.error("❌ Chyba:", e.message);
  process.exit(1);
});
