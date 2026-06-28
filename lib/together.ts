import { request } from "https";
import type { Scene } from "./types";

export interface ImageResult {
  buffer: Buffer;
  mimeType: string;
}

const DEFAULT_MODEL = "black-forest-labs/FLUX.1-schnell";

function callTogether(apiKey: string, model: string, prompt: string): Promise<ImageResult> {
  const bodyBuf = Buffer.from(
    JSON.stringify({
      model,
      prompt,
      width: 1280,
      height: 720,
      steps: 4,
      n: 1,
      response_format: "b64_json",
    }),
    "utf-8"
  );

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.together.xyz",
        path: "/v1/images/generations",
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Together ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }
          let data: { data?: Array<{ b64_json?: string }> };
          try {
            data = JSON.parse(text);
          } catch {
            reject(new Error("Together JSON parse error: " + text.slice(0, 200)));
            return;
          }
          const b64 = data.data?.[0]?.b64_json;
          if (b64) {
            resolve({ buffer: Buffer.from(b64, "base64"), mimeType: "image/jpeg" });
            return;
          }
          reject(new Error("Together: no image in response — " + text.slice(0, 200)));
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

export async function generateSceneImage(scene: Scene, heroDescription: string): Promise<ImageResult> {
  const apiKey = process.env.TOGETHER_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí TOGETHER_API_KEY.");
  const model = (process.env.TOGETHER_IMAGE_MODEL || DEFAULT_MODEL).trim();

  // heroDescription first — FLUX gives higher weight to early tokens
  // Strip any existing style suffix from imagePrompt to avoid duplication
  const scenePrompt = scene.imagePrompt
    .replace(/[.,]?\s*[Pp]ainterly storybook illustration[^.]*\./gi, "")
    .trim();

  const prompt = [
    heroDescription ? `Character appearances (keep exactly consistent): ${heroDescription}.` : "",
    scenePrompt,
    "Walt Disney animated feature film style, painterly storybook illustration, warm cinematic lighting, rich saturated colors, expressive faces, smooth clean lines, landscape orientation, no text.",
  ]
    .filter(Boolean)
    .join(" ");

  console.log(`[Together] scene ${scene.index} model=${model} prompt (${prompt.length} chars): ${prompt.slice(0, 150)}`);

  const MAX_ATTEMPTS = 3;
  let lastErr = new Error("Together nevrátil obrázek");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callTogether(apiKey, model, prompt);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error(`[Together] scene ${scene.index} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastErr.message}`);
      const isRateLimit = lastErr.message.includes("429");
      // Hard auth/model errors → stop immediately
      if (!isRateLimit && /Together 4\d\d/.test(lastErr.message)) break;
      if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, isRateLimit ? 8000 : 2000));
    }
  }
  throw new Error(`[scene ${scene.index}] ${lastErr.message}`);
}
