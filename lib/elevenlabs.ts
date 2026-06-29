import { request } from "https";
import type { Scene } from "./types";

// Strip non-printable / non-ASCII chars that Node.js rejects in HTTP header values (ERR_INVALID_CHAR)
function sanitizeApiKey(key: string | undefined): string {
  return (key || "").replace(/[^\x20-\x7E]/g, "").trim();
}

function sanitizeText(text: string): string {
  return (
    text
      .replace(/…/g, "...")  // horizontal ellipsis
      .replace(/–/g, "-")    // en dash
      .replace(/—/g, "--")   // em dash
      .replace(/[“”]/g, '"')  // curly double quotes
      .replace(/[‘’]/g, "'")  // curly single quotes
      .replace(/[«»]/g, '"')  // guillemets
      .replace(/­/g, "")     // soft hyphen
      .replace(/​/g, "")     // zero-width space
  );
}

export async function narrateScene(scene: Scene, overrideVoiceId?: string): Promise<Buffer> {
  const apiKey = sanitizeApiKey(process.env.ELEVENLABS_API_KEY);
  if (!apiKey) throw new Error("Chybí ELEVENLABS_API_KEY.");

  const voiceId = sanitizeApiKey(overrideVoiceId || process.env.ELEVENLABS_VOICE_ID);
  if (!voiceId) throw new Error("Chybí ELEVENLABS_VOICE_ID.");

  const modelId = sanitizeApiKey(process.env.ELEVENLABS_MODEL_ID) || "eleven_multilingual_v2";

  const bodyStr = JSON.stringify({
    text: sanitizeText(scene.narration),
    model_id: modelId,
    output_format: "mp3_44100_128",
  });
  const bodyBuf = Buffer.from(bodyStr, "utf-8");

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.elevenlabs.io",
        path: `/v1/text-to-speech/${voiceId}`,
        method: "POST",
        headers: {
          Accept: "audio/mpeg",
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.length,
          "xi-api-key": apiKey,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          if (res.statusCode && res.statusCode >= 400) {
            reject(
              new Error(`ElevenLabs ${res.statusCode}: ${buf.toString("utf-8").slice(0, 300)}`)
            );
          } else {
            resolve(buf);
          }
        });
        res.on("error", reject);
      }
    );

    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}
