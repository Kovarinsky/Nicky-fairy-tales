import { createHash } from "node:crypto";
import { head, put } from "@vercel/blob";
import { blobToken } from "./blob-token";
import type { Scene, SoundCue } from "./types";

const API = "https://api.elevenlabs.io";

function key(): string {
  return (process.env.ELEVENLABS_API_KEY || "").replace(/[^\x20-\x7E]/g, "").trim();
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

async function cachedAudio(path: string): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try { return (await head(path, { token })).url; } catch { return null; }
}

async function audit(kind: "sfx" | "song", cacheHit: boolean, durationSec: number, digest: string): Promise<void> {
  const token = blobToken();
  if (!token) return;
  const path = `creative-usage/u${Date.now()}-${kind}-${cacheHit ? "cache" : "generated"}-d${durationSec}-${digest.slice(0, 12)}.json`;
  await put(path, JSON.stringify({ kind, cacheHit, durationSec, digest, createdAt: Date.now() }), {
    token, access: "public", addRandomSuffix: false, contentType: "application/json",
  }).catch(() => {});
}

async function store(path: string, audio: ArrayBuffer, contentType: string): Promise<string> {
  const token = blobToken();
  if (!token) throw new Error("Blob storage is not configured");
  return (await put(path, Buffer.from(audio), {
    token, access: "public", addRandomSuffix: false, allowOverwrite: true,
    contentType, cacheControlMaxAge: 31536000,
  })).url;
}

export async function generateCustomSound(prompt: string, durationSec = 2.5): Promise<string> {
  const clean = prompt.replace(/\s+/g, " ").trim().slice(0, 450);
  const duration = Math.max(0.5, Math.min(6, Number(durationSec) || 2.5));
  const digest = hash(`${clean}|${duration}`);
  const path = `creative-audio/sfx-v1-${digest}.mp3`;
  const cached = await cachedAudio(path);
  if (cached) { await audit("sfx", true, duration, digest); return cached; }
  if (!key()) throw new Error("ELEVENLABS_API_KEY chybí");
  const res = await fetch(`${API}/v1/sound-generation?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `${clean}. Clean isolated storybook sound, child-friendly, no music, no speech, no background ambience.`,
      duration_seconds: duration,
      prompt_influence: 0.45,
      model_id: "eleven_text_to_sound_v2",
    }),
  });
  if (!res.ok) throw new Error(`ElevenLabs SFX ${res.status}: ${(await res.text()).slice(0, 180)}`);
  const url = await store(path, await res.arrayBuffer(), res.headers.get("content-type") || "audio/mpeg");
  await audit("sfx", false, duration, digest);
  return url;
}

/** Materializuje nejvýše dva scenáristou označené hero zvuky. Selhání je
 * fail-open: cue si ponechá knihovní effect a pohádka se normálně dokončí. */
export async function materializeStorySounds(scenes: Scene[], max = 2): Promise<{ generated: number; cachedOrGenerated: number }> {
  const selected: Array<{ cue: SoundCue; prompt: string }> = [];
  for (const scene of scenes) for (const cue of scene.sfxCues || []) {
    const prompt = cue.customPrompt?.replace(/\s+/g, " ").trim();
    if (prompt && prompt.length >= 12 && selected.length < max) selected.push({ cue, prompt });
  }
  let generated = 0;
  await Promise.all(selected.map(async ({ cue, prompt }) => {
    try {
      cue.audioUrl = await generateCustomSound(prompt, cue.customDurationSec);
      generated++;
    } catch (e) {
      console.warn(`[ElevenLabs SFX] fallback to library ${cue.effect}: ${e instanceof Error ? e.message : e}`);
      delete cue.audioUrl;
    }
  }));
  return { generated, cachedOrGenerated: selected.length };
}

export async function generateStorySong(input: {
  title: string; language: "cs" | "en"; synopsis: string; durationSec?: number;
}): Promise<string> {
  const duration = Math.max(12, Math.min(25, Number(input.durationSec) || 18));
  const synopsis = input.synopsis.replace(/\s+/g, " ").trim().slice(0, 1200);
  const language = input.language === "en" ? "English" : "Czech";
  const prompt = `A short, original, joyful children's storybook song in ${language}, based only on this story: "${input.title}" — ${synopsis}. ` +
    `One memorable chorus, simple child-friendly words, warm smiling singer, playful acoustic instruments, bright major key, clear ending. ` +
    `Mention the story's heroes and central adventure. No copyrighted melody or artist imitation, not a lullaby, no spoken intro.`;
  const digest = hash(`${prompt}|${duration}`);
  const path = `creative-audio/song-v1-${digest}.mp3`;
  const cached = await cachedAudio(path);
  if (cached) { await audit("song", true, duration, digest); return cached; }
  if (!key()) throw new Error("ELEVENLABS_API_KEY chybí");
  const res = await fetch(`${API}/v1/music?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, music_length_ms: duration * 1000, model_id: "music_v2", force_instrumental: false }),
  });
  if (!res.ok) throw new Error(`ElevenLabs Music ${res.status}: ${(await res.text()).slice(0, 220)}`);
  const url = await store(path, await res.arrayBuffer(), res.headers.get("content-type") || "audio/mpeg");
  await audit("song", false, duration, digest);
  return url;
}
