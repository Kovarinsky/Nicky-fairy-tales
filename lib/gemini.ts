import { request } from "https";
import type { Scene } from "./types";

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

export interface ImageResult {
  buffer: Buffer;
  mimeType: string;
}

function callGemini(
  apiKey: string,
  model: string,
  bodyBuf: Buffer
): Promise<ImageResult> {
  return new Promise((resolve, reject) => {
    const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const req = request(
      {
        hostname: "generativelanguage.googleapis.com",
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": bodyBuf.length },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gemini ${res.statusCode}: ${text.slice(0, 300)}`));
            return;
          }
          let data: {
            candidates?: Array<{
              content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
            }>;
          };
          try { data = JSON.parse(text); }
          catch { reject(new Error("Gemini JSON parse error: " + text.slice(0, 200))); return; }

          for (const cand of data.candidates || []) {
            for (const part of cand.content?.parts || []) {
              if (part.inlineData?.data) {
                resolve({ buffer: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType || "image/png" });
                return;
              }
            }
          }
          reject(new Error("NO_IMAGE"));
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

export async function generateSceneImage(
  scene: Scene,
  heroDescription: string,
  referenceImages: Array<{ data: string; mimeType: string }> = []
): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = (process.env.GEMINI_IMAGE_MODEL || MODEL).trim();

  const hasRefs = referenceImages.length > 0;
  const prompt = [
    hasRefs
      ? "Reference photos attached: use the children's faces, hair color, eye color, and height difference as exact basis. Preserve their real features faithfully."
      : "",
    scene.imagePrompt,
    `Character descriptions: ${heroDescription}`,
    "Art style: painterly semi-realistic children's book illustration, warm cinematic lighting, rich colors, expressive faces, landscape orientation, no text.",
  ].filter(Boolean).join(" ");

  const parts: object[] = [];
  for (const ref of referenceImages) {
    parts.push({ inlineData: { data: ref.data, mimeType: ref.mimeType } });
  }
  parts.push({ text: prompt });

  const bodyBuf = Buffer.from(
    JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseModalities: ["IMAGE", "TEXT"] } }),
    "utf-8"
  );

  const MAX_ATTEMPTS = 3;
  let lastErr = new Error("Gemini nevrátil obrázek");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callGemini(apiKey, model, bodyBuf);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      // 4xx = no point retrying (bad request / quota)
      if (lastErr.message.startsWith("Gemini 4")) break;
      // Short backoff before retry
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, 1200 * attempt));
    }
  }
  const msg = lastErr.message === "NO_IMAGE"
    ? `Gemini nevrátil obrázek pro scénu ${scene.index}`
    : lastErr.message;
  throw new Error(msg);
}
