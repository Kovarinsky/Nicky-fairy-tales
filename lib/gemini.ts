import { request } from "https";
import type { Scene } from "./types";

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";

export interface ImageResult {
  buffer: Buffer;
  mimeType: string;
}

type GeminiCandidate = {
  content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
  finishReason?: string;
  safetyRatings?: Array<{ category: string; probability: string; blocked?: boolean }>;
};

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
            reject(new Error(`Gemini ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }
          let data: { candidates?: GeminiCandidate[]; promptFeedback?: { blockReason?: string } };
          try { data = JSON.parse(text); }
          catch { reject(new Error("Gemini JSON parse error: " + text.slice(0, 200))); return; }

          // Check prompt-level block first
          if (data.promptFeedback?.blockReason) {
            reject(new Error(`Gemini BLOCKED: promptFeedback.blockReason=${data.promptFeedback.blockReason}`));
            return;
          }

          for (const cand of data.candidates || []) {
            for (const part of cand.content?.parts || []) {
              if (part.inlineData?.data) {
                resolve({ buffer: Buffer.from(part.inlineData.data, "base64"), mimeType: part.inlineData.mimeType || "image/png" });
                return;
              }
            }
          }

          // No image found — build a detailed diagnostic error
          const reasons = (data.candidates || []).map(c => {
            const blocked = c.safetyRatings?.filter(r => r.blocked || r.probability === "HIGH" || r.probability === "MEDIUM").map(r => `${r.category}:${r.probability}`);
            return `finishReason=${c.finishReason ?? "?"}${blocked?.length ? " blocked=[" + blocked.join(",") + "]" : ""}`;
          }).join(" | ");
          reject(new Error(`NO_IMAGE: ${reasons || "no candidates"}`));
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// Gemini safety filter blocks images when prompts mention specific child ages.
// Strip all age patterns and replace age-specific terms with neutral ones.
function sanitizePrompt(text: string): string {
  return text
    .replace(/\b\d+\s*[-–]\s*year[s]?\s*[-–]\s*old\b/gi, "")         // 6-year-old
    .replace(/\b\d+\s+years?\s+old\b/gi, "")                           // 6 years old
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[-–]?\s*years?\s*[-–]?\s*old\b/gi, "") // six-year-old
    .replace(/\bage[d]?\s*\d+\b/gi, "")                                // age 6, aged 6
    .replace(/\(\s*\d+[^)]*\)/gi, "")                                  // (2 years old), (6 let)
    .replace(/\b\d+let[a-záčďéěíňóřšťúůýž]*\b/gi, "")                 // Czech: 6letý, 2letá
    .replace(/\b\d+\s+let\b/gi, "")                                    // Czech: 6 let
    .replace(/\b\d+\s+rok[ůuy]?\b/gi, "")                              // Czech: 2 roky
    .replace(/\btoddler\s+girl\b/gi, "small girl")
    .replace(/\btoddler\s+boy\b/gi, "small boy")
    .replace(/\btoddler\b/gi, "small child")
    .replace(/\binfant\b/gi, "small child")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export async function generateSceneImage(
  scene: Scene,
  heroDescription: string
): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = (process.env.GEMINI_IMAGE_MODEL || MODEL).trim();

  // imagePrompt from Claude already includes character visual traits per scene.
  // heroDescription is NOT passed to Gemini — it was the source of age-related safety blocks.
  const rawPrompt = [
    scene.imagePrompt,
    "Style: painterly children's book illustration, warm cinematic lighting, rich saturated colors, expressive faces, landscape orientation, no text or letters.",
  ].join(" ");
  const prompt = sanitizePrompt(rawPrompt);
  console.log(`[Gemini] scene ${scene.index} prompt (${prompt.length} chars): ${prompt.slice(0, 200)}`);

  const bodyBuf = Buffer.from(
    JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
    "utf-8"
  );

  const MAX_ATTEMPTS = 4;
  let lastErr = new Error("Gemini nevrátil obrázek");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callGemini(apiKey, model, bodyBuf);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error(`[Gemini] scene ${scene.index} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastErr.message}`);
      const isRateLimit = lastErr.message.startsWith("Gemini 429");
      const isBlocked = lastErr.message.startsWith("Gemini BLOCKED") || lastErr.message.startsWith("NO_IMAGE");
      // Hard 4xx (bad request, auth) or content block → no point retrying
      if ((lastErr.message.match(/^Gemini 4/) && !isRateLimit) || isBlocked) break;
      if (attempt < MAX_ATTEMPTS) {
        const delay = isRateLimit ? 12000 * attempt : 1500 * attempt;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`[scene ${scene.index}] ${lastErr.message}`);
}
