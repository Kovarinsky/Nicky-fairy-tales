#!/usr/bin/env node
// Jednorázové vygenerování zvukové knihovny appky přes ElevenLabs Music
// (nálady/intro/outro/stingery) a ElevenLabs Sound Effects (jednorázové
// efekty) — NAHRAZUJE dřívější procedurální syntézu (Web Audio oscilátory,
// „MIDI z roku 2000") skutečnou, jednou vyrobenou hudbou/zvukem. Appka za
// běhu už žádné API nevolá — jen přehrává hotové soubory z public/music-lib/.
//
// Spouštěj u sebe, kde funguje síť a je ELEVENLABS_API_KEY v .env.local:
//   npm run gen:music-lib
//
// Bezpečné znovuspuštění: defaultně PŘESKOČÍ soubory, co už existují (rychlé
// a levné přidání nových položek do knihovny) — přidej `--force`, chceš-li
// přegenerovat i ty stávající (např. při doladění promptu).
// Cena je jednorázová (ne za pohádku) — Music API ~$0.15/min, Sound Effects
// řádově centy za klip; celá knihovna vyjde na pár dolarů celkem.

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";

function loadEnv() {
  for (const file of [".env.local", ".env"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        // Vercel CLI zapisuje hodnoty do uvozovek (a někdy i s \r\n uvnitř) —
        // bez odstranění uvozovek šla do API hlaviček doslova "hodnota" i s
        // uvozovkami, což server logicky odmítl jako neplatný klíč.
        let v = m[2].trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        process.env[m[1]] = v.replace(/\\r\\n$/, "").replace(/\\n$/, "");
      }
    }
  }
}
loadEnv();

const API = "https://api.elevenlabs.io";
const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) {
  console.error("❌ Chybí ELEVENLABS_API_KEY v .env.local");
  process.exit(1);
}
const headers = { "xi-api-key": KEY, "Content-Type": "application/json" };
const OUT_DIR = "public/music-lib";
mkdirSync(OUT_DIR, { recursive: true });

// Výchozí: přeskoč soubory, co už existují (šetří čas i peníze při přidávání
// NOVÝCH položek do knihovny). --force přegeneruje úplně všechno (pro
// doladění existujících promptů).
const FORCE = process.argv.includes("--force");
function shouldSkip(path) {
  return !FORCE && existsSync(path);
}

async function withRetry(fn, label) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fn();
    } catch (e) {
      console.error(`   ⚠️  ${label} pokus ${attempt}/2 selhal: ${e.message}`);
      if (attempt === 2) return null;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

async function composeMusic(prompt, durationMs) {
  const res = await fetch(`${API}/v1/music?output_format=mp3_44100_128`, {
    method: "POST",
    headers,
    body: JSON.stringify({ prompt, music_length_ms: durationMs, model_id: "music_v2", force_instrumental: true }),
  });
  if (!res.ok) throw new Error(`Music HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function generateSfx(text, durationSeconds, loop = false) {
  const res = await fetch(`${API}/v1/sound-generation?output_format=mp3_44100_128`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text, duration_seconds: durationSeconds, loop,
      prompt_influence: 0.4, model_id: "eleven_text_to_sound_v2",
    }),
  });
  if (!res.ok) throw new Error(`SFX HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ── 🎼 Nálady (Soundscape) — smyčkovatelné hudební podklady, 24s ──────────
const SOUNDSCAPES = {
  magic: "Whimsical magical fairytale ambient music loop, soft twinkling bells, warm dreamy pad, sparkling and gentle, no drums, seamless loop, instrumental orchestral",
  forest: "Peaceful forest ambient music loop, soft acoustic textures, gentle airy woodwind, light and calm atmosphere, no drums, seamless loop, instrumental",
  night: "Calm nighttime lullaby ambient music loop, soft dreamy pad, slow gentle bells, cozy and soothing, no drums, seamless loop, instrumental",
  adventure: "Adventurous storybook orchestral music loop, light rhythmic pulse, hopeful and energetic, playful brass and strings, seamless loop, instrumental",
  cozy: "Warm cozy fireside music loop, soft acoustic guitar and piano, gentle and comforting, seamless loop, instrumental",
  // 🌙 NENÍ vybíratelná scénová nálada (Scene.soundscape) — hraje jen pod
  // závěrečnými titulky (AmbientPlayer.enterSleepMode), samostatný soubor
  // soundscape-lullaby.mp3, proto v tomto configu, ne v app/lib/types.ts.
  lullaby: "Very gentle sleepy lullaby ambient music loop, soft solo music box and hushed strings, minimal, slow and deeply calming, no drums, seamless loop, instrumental",
};

// ── 🎺 Intro/outro — jednou na celou pohádku ──────────────────────────────
const FANFARES = {
  intro: { prompt: "Short triumphant magical fanfare, rising sparkling orchestral flourish, joyful opening for a children's storybook, instrumental", ms: 6000 },
  outro: { prompt: "Short gentle descending lullaby melody, warm resolving orchestral chord, sleepy and peaceful ending for a children's bedtime story, instrumental", ms: 8000 },
  // 🎺 Úvodní fanfáry LADĚNÉ podle prostředí první scény (viz AmbientPlayer.
  // playIntro) — appka zkusí intro-<scene> první, "intro" výše je jen obecný
  // záchranný fallback, kdyby konkrétní varianta chyběla/selhala.
  "intro-magic": { prompt: "Short triumphant magical fanfare, rising sparkling orchestral flourish, joyful and wondrous opening for a children's storybook, instrumental", ms: 6000 },
  "intro-forest": { prompt: "Short cheerful woodland fanfare, rising acoustic flourish with light woodwind and strings, fresh outdoorsy opening for a children's storybook, instrumental", ms: 6000 },
  "intro-night": { prompt: "Short gentle dreamy opening phrase, soft rising bells and warm pad, hushed starry opening for a children's bedtime story, instrumental", ms: 6000 },
  "intro-adventure": { prompt: "Short bold adventurous fanfare, rising brass and strings flourish, energetic and hopeful opening for a children's storybook, instrumental", ms: 6000 },
  "intro-cozy": { prompt: "Short warm gentle opening phrase, soft rising piano and strings flourish, homely and comforting opening for a children's storybook, instrumental", ms: 6000 },
};

// ── 🎨 Homepage: nálada podle SVĚTA POZADÍ appky (lib/backgrounds.ts BG_SCENES) ─
// Nezávislé na náladě scény při čtení. Noc/Les/Kouzlo znějí stejně jako už
// existující soundscape-night/-forest/-magic (viz BG_AUDIO_KEY v lib/ambient.ts)
// — proto tu jsou jen zbylé světy, které ještě vlastní smyčku nemají.
const BG_AMBIENT = {
  mountains: "Peaceful snowy mountain ambient music loop, soft warm horns and gentle strings, crisp and cozy, no drums, seamless loop, instrumental",
  space: "Sparkling outer-space ambient music loop, shimmering bells and slow floating pad, wondrous and calm, no drums, seamless loop, instrumental",
  dino: "Warm prehistoric jungle ambient music loop, soft mallet percussion and gentle woodwind, curious and calm, no drums, seamless loop, instrumental",
  bay: "Gentle seaside ambient music loop, soft strings and airy flute over distant waves, calm and warm, no drums, seamless loop, instrumental",
  road: "Playful road-trip ambient music loop, light acoustic guitar and a bouncy rhythmic pulse, cheerful and breezy, seamless loop, instrumental",
  cartoon: "Cheerful funfair ambient music loop, playful music-box-like bells and light accordion, whimsical and fun, no drums, seamless loop, instrumental",
};

// ── 🎺 Intro podle SVĚTA/TÉMATU pohádky (Krteček, Autíčka, konkrétní pohádka…) ─
// Přednost před náladou scény (viz AmbientPlayer.playIntro) — appka je zkusí
// jako `intro-theme-<id>`, id musí sedět s lib/themes.ts (THEMES) / lib/folk-
// tales.ts (FOLK_TALES). Původní instrumentální nálada, NIKDY doslovná melodie
// známé znělky (copyright) — jen žánr/energie/nástroje odpovídající světu.
// Vlastní (fotka/popis) svět zde záměrně NENÍ — nejde předem vyrobit pevný
// soubor, appka se sama přehodí na náladu 1. scény.
const THEME_INTROS = {
  krtek: "Short gentle whimsical woodland fanfare, soft flute and pizzicato strings, playful and kind, instrumental",
  "paw-patrol": "Short upbeat heroic rescue-team fanfare, bright brass and light percussion, energetic and friendly, instrumental",
  krkonose: "Short majestic folk mountain fanfare, warm horns and a folk fiddle flourish, grand and kind, instrumental",
  mickey: "Short cheerful classic cartoon fanfare, bouncy clarinet and pizzicato strings, playful and bright, instrumental",
  dinosauri: "Short gentle prehistoric adventure fanfare, deep warm brass and soft mallet percussion, curious and friendly, instrumental",
  vesmir: "Short sparkling space adventure fanfare, shimmering bells and rising strings, wondrous and hopeful, instrumental",
  pokemon: "Short cheerful adventurous fanfare, bright bells and playful strings, friendly and energetic, instrumental",
  sonic: "Short fast bright energetic fanfare, playful arpeggio and light percussion, upbeat and fun, instrumental",
  auticka: "Short peppy revving fanfare, playful brass with a light engine-like rhythmic pulse, fun and energetic, instrumental",
  folk_karkulka: "Short gentle forest fairytale fanfare, soft strings and woodwind, warm and a little mysterious, instrumental",
  folk_chaloupka: "Short playful sweet fairytale fanfare, twinkling bells and light woodwind, whimsical and cozy, instrumental",
  folk_popelka: "Short elegant royal ball fanfare, sparkling strings and harp, graceful and magical, instrumental",
  folk_ruzenka: "Short dreamy enchanted fanfare, soft harp and slow strings, magical and gentle, instrumental",
  folk_snehurka: "Short warm woodland fairytale fanfare, gentle bells and soft strings, kind and magical, instrumental",
  folk_zlatovlaska: "Short golden fairytale fanfare, shimmering harp and warm strings, regal and magical, instrumental",
  folk_dlouhy: "Short jolly heroic folk fanfare, playful brass and strings, adventurous and funny, instrumental",
  folk_vsevedy: "Short warm golden journey fanfare, rising strings and gentle brass, hopeful and grand, instrumental",
  folk_smolicek: "Short gentle forest fanfare, soft flute and pizzicato strings, tender and magical, instrumental",
  folk_budulinek: "Short playful folksy fanfare, cheerful fiddle and light strings, cozy and mischievous, instrumental",
  folk_kobli: "Short bouncy playful fanfare, cheerful woodwind and pizzicato strings, cheeky and fun, instrumental",
  folk_repa: "Short jolly village fanfare, warm folk strings and light percussion, cheerful and communal, instrumental",
  folk_hrnecek: "Short cozy village fanfare, playful woodwind and warm strings, gentle and humorous, instrumental",
  folk_mesicky: "Short magical seasonal fanfare, warm strings and soft bells, wondrous and gentle, instrumental",
  folk_kaca: "Short comic folk dance fanfare, playful fiddle and accordion-like strings, cheeky and fun, instrumental",
  folk_otesanek: "Short comic folksy fanfare, bouncy woodwind and pizzicato strings, playful and warm, instrumental",
  folk_sul: "Short stately royal fanfare, warm brass and strings, dignified and gentle, instrumental",
  folk_honza: "Short cheerful road fanfare, playful strings and light brass, warm and hopeful, instrumental",
  folk_palecek: "Short tiny playful fanfare, light pizzicato strings and soft bells, whimsical and nimble, instrumental",
  folk_obusek: "Short comic folk justice fanfare, jaunty strings and brass, playful and triumphant, instrumental",
  folk_petrovsti: "Short playful animal-friends fanfare, warm strings and light woodwind, cozy and cheerful, instrumental",
  folk_kocour: "Short elegant clever-trickster fanfare, playful strings and light brass, witty and grand, instrumental",
  folk_kralovna: "Short icy magical fanfare, shimmering bells and cold strings, wondrous and gentle, instrumental",
  folk_kacatko: "Short tender seasonal fanfare, soft strings and gentle woodwind, warm and hopeful, instrumental",
  folk_saty: "Short comic royal parade fanfare, playful brass and strings, cheeky and grand, instrumental",
  folk_hrasek: "Short cozy royal fanfare, gentle strings and soft harp, warm and playful, instrumental",
  folk_vila: "Short dreamy underwater fanfare, shimmering harp and flowing strings, magical and gentle, instrumental",
  folk_malenka: "Short tiny delicate fanfare, soft strings and light bells, gentle and whimsical, instrumental",
  folk_vojacek: "Short brave toy-soldier fanfare, playful marching brass and light percussion, warm and gentle, instrumental",
  folk_labute: "Short graceful swan fanfare, soft strings and gentle harp, tender and hopeful, instrumental",
  folk_slavik: "Short delicate songbird fanfare, soft flute and gentle strings, tender and warm, instrumental",
  folk_kufr: "Short whimsical flying-adventure fanfare, playful strings and light brass, magical and warm, instrumental",
  folk_kuzlatka: "Short cozy protective fanfare, warm strings and soft woodwind, gentle and reassuring, instrumental",
  folk_muzikanti: "Short jaunty animal-band fanfare, playful strings and brass, warm and comic, instrumental",
};

// ── 🎼 Stingery — krátká kadence na konci KAŽDÉ scény, jedna na náladu ────
const STINGERS = {
  magic: "Very short magical sparkling chime cadence, two notes descending, dreamy resolving flourish, instrumental",
  forest: "Very short gentle acoustic resolving phrase, soft chime, peaceful, instrumental",
  night: "Very short soft lullaby resolving chime, slow gentle bells, instrumental",
  adventure: "Very short playful triumphant resolving flourish, light brass accent, instrumental",
  cozy: "Very short warm gentle resolving chime, soft piano, cozy, instrumental",
};

// ── 🔊 Jednorázové zvukové efekty (text, trvání v s, smyčka?) ─────────────
const SFX = {
  waves: ["gentle ocean waves lapping and receding on a shore", 3.5, true],
  thunder: ["a single distant rumbling thunder clap with rolling echo", 3.0, false],
  wind_gust: ["a sudden gust of wind whooshing through trees", 2.5, false],
  rain: ["steady gentle rain falling", 3.0, true],
  snow_crunch: ["footsteps crunching in fresh snow, two steps", 1.5, false],
  cow: ["a cow mooing once, farm animal", 2.0, false],
  pig: ["a pig oinking twice", 1.5, false],
  chicken: ["a chicken clucking", 1.5, false],
  sheep: ["a sheep bleating once", 1.5, false],
  horse: ["a horse neighing", 2.0, false],
  duck: ["a duck quacking twice", 1.5, false],
  dog: ["a friendly dog barking twice", 1.5, false],
  cat: ["a cat meowing once", 1.5, false],
  frog: ["a frog croaking twice", 1.5, false],
  owl: ["an owl hooting softly at night", 2.0, false],
  rooster: ["a rooster crowing, cock-a-doodle-doo", 2.5, false],
  bee: ["a bee buzzing past", 1.5, false],
  car_engine: ["a car engine starting and idling briefly", 2.0, false],
  train: ["a steam train chugging and a distant whistle", 3.0, false],
  boat_horn: ["a deep boat horn sounding once", 2.0, false],
  clock_tick: ["a clock ticking steadily, four ticks", 2.0, false],
  doorbell: ["a cheerful two-tone doorbell chime", 1.5, false],
  phone_ring: ["an old-fashioned telephone ringing twice", 2.0, false],
  footsteps: ["footsteps walking on a wooden floor, four steps", 1.5, false],
  applause: ["a small group of people clapping and cheering happily", 2.0, false],
  laugh: ["children laughing happily together", 2.0, false],
  splash: ["a small splash of something falling into water", 1.5, false],
  glass_clink: ["two glasses gently clinking together in a toast", 1.0, false],
  magic_chime: ["a magical sparkling chime, whimsical and enchanting", 1.5, false],
  triumphant: ["a short triumphant heroic musical sting, victorious", 1.5, false],
  tense_sting: ["a short suspenseful dramatic musical sting, sudden tension", 1.0, false],
  sad_tone: ["a short sorrowful gentle musical tone, tender and sad", 1.5, false],
  snore: ["a person gently snoring twice, sleeping", 2.0, false],
  // 🎻 nástroje/předměty — obecný "masterprompt" pokrývá jakýkoli konkrétní
  // nástroj/objekt, kterým se v ději právě zahraje/manipuluje (viz lib/claude.ts)
  violin: ["a short cheerful violin melody being played, a simple folk tune", 3.0, false],
  piano: ["a short cheerful piano melody, a few notes played", 2.5, false],
  guitar: ["a short acoustic guitar strum, a couple of gentle chords", 2.5, false],
  flute: ["a short playful flute melody, a few notes", 2.5, false],
  drum: ["a few simple drum beats, a short rhythmic pattern", 1.5, false],
  trumpet: ["a short cheerful trumpet fanfare, a few notes", 2.0, false],
  harp: ["a short gentle harp glissando, a few plucked notes rising", 2.0, false],
  accordion: ["a short cheerful accordion melody, a folk dance tune", 2.5, false],
  xylophone: ["a short playful xylophone melody, a few bright notes", 2.0, false],
  music_box: ["a delicate music box melody, a few tinkling notes", 2.5, false],
  tambourine: ["a tambourine shaking and jingling briefly", 1.5, false],
  harmonica: ["a short cheerful harmonica melody, a few notes", 2.5, false],
  bell_ring: ["a single clear hand bell ringing once", 1.5, false],
  page_turn: ["a book page turning, a soft paper rustle", 1.0, false],
  key_turn: ["a metal key turning in a lock, a single click", 1.0, false],
  sword_clash: ["two swords clashing together once, a metallic clang", 1.0, false],
  whistle: ["a person whistling a short cheerful tune", 2.0, false],
};

async function main() {
  const manifest = {};
  let ok = 0, fail = 0;

  console.log(`🎼 Nálady (${Object.keys(SOUNDSCAPES).length})`);
  for (const [key, prompt] of Object.entries(SOUNDSCAPES)) {
    const path = `${OUT_DIR}/soundscape-${key}.mp3`;
    if (shouldSkip(path)) { manifest[`soundscape-${key}`] = statSync(path).size; console.log(`   ⏭️  ${key} (už existuje)`); continue; }
    const buf = await withRetry(() => composeMusic(prompt, 24000), `soundscape:${key}`);
    if (buf) { writeFileSync(path, buf); manifest[`soundscape-${key}`] = buf.length; ok++; console.log(`   ✅ ${key} (${buf.length} B)`); }
    else fail++;
  }

  console.log(`🎺 Intro/outro`);
  for (const [key, { prompt, ms }] of Object.entries(FANFARES)) {
    const path = `${OUT_DIR}/${key}.mp3`;
    if (shouldSkip(path)) { manifest[key] = statSync(path).size; console.log(`   ⏭️  ${key} (už existuje)`); continue; }
    const buf = await withRetry(() => composeMusic(prompt, ms), key);
    if (buf) { writeFileSync(path, buf); manifest[key] = buf.length; ok++; console.log(`   ✅ ${key} (${buf.length} B)`); }
    else fail++;
  }

  console.log(`🎨 Homepage podle světa pozadí (${Object.keys(BG_AMBIENT).length})`);
  for (const [key, prompt] of Object.entries(BG_AMBIENT)) {
    const path = `${OUT_DIR}/bg-${key}.mp3`;
    if (shouldSkip(path)) { manifest[`bg-${key}`] = statSync(path).size; console.log(`   ⏭️  ${key} (už existuje)`); continue; }
    const buf = await withRetry(() => composeMusic(prompt, 24000), `bg:${key}`);
    if (buf) { writeFileSync(path, buf); manifest[`bg-${key}`] = buf.length; ok++; console.log(`   ✅ ${key} (${buf.length} B)`); }
    else fail++;
  }

  console.log(`🎺 Intro podle světa/tématu (${Object.keys(THEME_INTROS).length})`);
  for (const [key, prompt] of Object.entries(THEME_INTROS)) {
    const path = `${OUT_DIR}/intro-theme-${key}.mp3`;
    if (shouldSkip(path)) { manifest[`intro-theme-${key}`] = statSync(path).size; console.log(`   ⏭️  ${key} (už existuje)`); continue; }
    const buf = await withRetry(() => composeMusic(prompt, 6000), `intro-theme:${key}`);
    if (buf) { writeFileSync(path, buf); manifest[`intro-theme-${key}`] = buf.length; ok++; console.log(`   ✅ ${key} (${buf.length} B)`); }
    else fail++;
  }

  console.log(`🎼 Stingery (${Object.keys(STINGERS).length})`);
  for (const [key, prompt] of Object.entries(STINGERS)) {
    const path = `${OUT_DIR}/stinger-${key}.mp3`;
    if (shouldSkip(path)) { manifest[`stinger-${key}`] = statSync(path).size; console.log(`   ⏭️  ${key} (už existuje)`); continue; }
    const buf = await withRetry(() => composeMusic(prompt, 3000), `stinger:${key}`);
    if (buf) { writeFileSync(path, buf); manifest[`stinger-${key}`] = buf.length; ok++; console.log(`   ✅ ${key} (${buf.length} B)`); }
    else fail++;
  }

  console.log(`🔊 Zvukové efekty (${Object.keys(SFX).length})`);
  for (const [key, [text, dur, loop]] of Object.entries(SFX)) {
    const path = `${OUT_DIR}/sfx-${key}.mp3`;
    if (shouldSkip(path)) { manifest[`sfx-${key}`] = statSync(path).size; console.log(`   ⏭️  ${key} (už existuje)`); continue; }
    const buf = await withRetry(() => generateSfx(text, dur, loop), `sfx:${key}`);
    if (buf) { writeFileSync(path, buf); manifest[`sfx-${key}`] = buf.length; ok++; console.log(`   ✅ ${key} (${buf.length} B)`); }
    else fail++;
    await new Promise(r => setTimeout(r, 300)); // šetrné tempo k API
  }

  writeFileSync(`${OUT_DIR}/manifest.json`, JSON.stringify(manifest, null, 2));
  console.log(`\n✅ Hotovo: ${ok} souborů, ${fail} selhání. Uloženo do ${OUT_DIR}/`);
  if (fail > 0) { console.log("⚠️  Spusť skript znovu — přepíše jen chybějící/nové, hotové soubory neztrácíš."); process.exitCode = 1; }
}

main().catch(e => { console.error("❌ Chyba:", e.message); process.exit(1); });
