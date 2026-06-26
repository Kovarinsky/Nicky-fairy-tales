import type { Scene } from "./types";

const ELEVENLABS_BASE = "https://api.elevenlabs.io";

function sanitizeText(text: string): string {
  return text
    .replace(/…/g, "...")   // …
    .replace(/–/g, "-")     // –
    .replace(/—/g, "--")    // —
    .replace(/[“”]/g, '"')  // ""
    .replace(/[‘’]/g, "'")  // ''
    .replace(/«|»/g, '"')   // «»
    .replace(/­/g, "")           // soft hyphen
    .replace(/​/g, "");          // zero-width space
}

export async function narrateScene(scene: Scene): Promise<Buffer> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("Chybí ELEVENLABS_API_KEY.");

  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error("Chybí ELEVENLABS_VOICE_ID.");

  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";

  const res = await fetch(`${ELEVENLABS_BASE}/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text: sanitizeText(scene.narration),
      model_id: modelId,
      output_format: "mp3_44100_128",
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 300)}`);
  }

  const buf = await res.arrayBuffer();
  return Buffer.from(buf);
}
