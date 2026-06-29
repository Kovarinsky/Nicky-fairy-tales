import type { Scene } from “./types”;

// Strip non-printable chars — belt-and-suspenders before setting HTTP headers
function sanitizeApiKey(key: string | undefined): string {
  return (key || “”).replace(/[^\x20-\x7E]/g, “”).trim();
}

function sanitizeText(text: string): string {
  return text
    .replace(/…/g, “...”)
    .replace(/–/g, “-”)
    .replace(/—/g, “--”)
    .replace(/[“”]/g, ‘”’)
    .replace(/[‘’]/g, “’”)
    .replace(/[«»]/g, ‘”’)
    .replace(/­/g, “”)   // soft hyphen
    .replace(/​/g, “”);  // zero-width space
}

export async function narrateScene(scene: Scene, overrideVoiceId?: string): Promise<Buffer> {
  const apiKey = sanitizeApiKey(process.env.ELEVENLABS_API_KEY);
  if (!apiKey) throw new Error(“Chybí ELEVENLABS_API_KEY.”);

  const voiceId = sanitizeApiKey(overrideVoiceId || process.env.ELEVENLABS_VOICE_ID);
  if (!voiceId) throw new Error(“Chybí ELEVENLABS_VOICE_ID.”);

  const modelId = sanitizeApiKey(process.env.ELEVENLABS_MODEL_ID) || “eleven_multilingual_v2”;

  // Use native fetch (Node 18+) — avoids node:https header-char validation quirks
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: “POST”,
    headers: {
      “Accept”: “audio/mpeg”,
      “Content-Type”: “application/json”,
      “xi-api-key”: apiKey,
    },
    body: JSON.stringify({
      text: sanitizeText(scene.narration),
      model_id: modelId,
      output_format: “mp3_44100_128”,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${errText.slice(0, 300)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
