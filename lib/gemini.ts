import { request } from "https";
import type { Scene } from "./types";

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

export interface ImageResult {
  buffer: Buffer;
  mimeType: string;
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
      ? "Reference photos attached: use the children's faces, hair color, eye color, and the visible height difference between them as the exact basis for the characters in this illustration. Preserve their real facial features faithfully."
      : "",
    scene.imagePrompt,
    `Character consistency — repeat these exact descriptions in every image: ${heroDescription}`,
    "Art style: painterly semi-realistic children's book illustration.",
    "Warm cinematic lighting, rich saturated colors, detailed expressive faces that show the scene's emotion clearly.",
    "Professional storybook quality. Landscape orientation. No text or letters anywhere in the image.",
  ]
    .filter(Boolean)
    .join(" ");

  const parts: object[] = [];
  for (const ref of referenceImages) {
    parts.push({ inlineData: { data: ref.data, mimeType: ref.mimeType } });
  }
  parts.push({ text: prompt });

  const body = JSON.stringify({
    contents: [{ role: "user", parts }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  });
  const bodyBuf = Buffer.from(body, "utf-8");

  return new Promise((resolve, reject) => {
    const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const req = request(
      {
        hostname: "generativelanguage.googleapis.com",
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": bodyBuf.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");

          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gemini ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }

          let data: {
            candidates?: Array<{
              content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> };
            }>;
          };
          try {
            data = JSON.parse(text);
          } catch {
            reject(new Error("Gemini JSON parse error: " + text.slice(0, 200)));
            return;
          }

          for (const cand of data.candidates || []) {
            for (const part of cand.content?.parts || []) {
              if (part.inlineData?.data) {
                resolve({
                  buffer: Buffer.from(part.inlineData.data, "base64"),
                  mimeType: part.inlineData.mimeType || "image/png",
                });
                return;
              }
            }
          }

          reject(new Error("Gemini nevrátil obrázek pro scénu " + scene.index));
        });
        res.on("error", reject);
      }
    );

    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}
