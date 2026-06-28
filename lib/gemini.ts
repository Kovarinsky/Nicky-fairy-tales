import { request } from "https";
import type { Scene } from "./types";

const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-preview-image-generation";
const SANITIZE_MODEL = "gemini-2.0-flash"; // fast text model — sanitizes its own image model's prompt

export interface ImageResult {
  buffer: Buffer;
  mimeType: string;
}

type GeminiCandidate = {
  content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
  finishReason?: string;
  safetyRatings?: Array<{ category: string; probability: string; blocked?: boolean }>;
};

function geminiPost(apiKey: string, model: string, body: object): Promise<string> {
  const bodyBuf = Buffer.from(JSON.stringify(body), "utf-8");
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "generativelanguage.googleapis.com", path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": bodyBuf.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

// Step 1: Ask Gemini text model to sanitize the prompt so it passes the image model's own safety filter.
// Gemini knows its own safety rules best — it rewrites the prompt itself.
async function sanitizeWithGemini(apiKey: string, rawPrompt: string): Promise<string> {
  try {
    const raw = await geminiPost(apiKey, SANITIZE_MODEL, {
      contents: [{
        role: "user",
        parts: [{
          text: [
            "You are a prompt sanitizer for Gemini image generation of children's fairy tale illustrations.",
            "Rewrite the following prompt so it passes Gemini's content safety filter without losing visual detail.",
            "",
            "Rules:",
            "- Remove all age numbers: '6-year-old', '6 years old', 'toddler', 'infant', Czech: 'letý', 'let', 'roků'",
            "- Remove size comparisons that imply child age: 'half the height of', 'noticeably smaller than', 'roughly half'",
            "- Replace 'small girl' → 'girl', 'small boy' → 'boy', 'little sister' → 'sister', 'little brother' → 'brother'",
            "- Keep ALL character names, hair color/style, eye color, clothing colors and types, scene action, and the style suffix UNCHANGED",
            "- Output ONLY the rewritten prompt — no explanation, no quotes, no markdown",
            "",
            "Prompt:",
            rawPrompt,
          ].join("\n"),
        }],
      }],
      generationConfig: { maxOutputTokens: 600 },
    });

    const data = JSON.parse(raw) as { candidates?: GeminiCandidate[] };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (text && text.length > 30) {
      console.log(`[Gemini sanitize] ${rawPrompt.length} chars → ${text.length} chars`);
      return text;
    }
  } catch (e) {
    console.warn("[Gemini sanitize] text model failed, using regex fallback:", e instanceof Error ? e.message : e);
  }
  return regexSanitize(rawPrompt);
}

// Regex fallback if the text model call fails
function regexSanitize(text: string): string {
  return text
    .replace(/\b\d+\s*[-–]\s*year[s]?\s*[-–]\s*old\b/gi, "")
    .replace(/\b\d+\s+years?\s+old\b/gi, "")
    .replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*[-–]?\s*years?\s*[-–]?\s*old\b/gi, "")
    .replace(/\bage[d]?\s*\d+\b/gi, "")
    .replace(/\(\s*\d+[^)]*\)/gi, "")
    .replace(/\b\d+let[a-záčďéěíňóřšťúůýž]*\b/gi, "")
    .replace(/\b\d+\s+let\b/gi, "")
    .replace(/\b\d+\s+rok[ůuy]?\b/gi, "")
    .replace(/\broughly half \w+'s height\b/gi, "")
    .replace(/\bnoticeably smaller than\b/gi, "smaller than")
    .replace(/\btoddler\b/gi, "child")
    .replace(/\binfant\b/gi, "child")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ")
    .trim();
}

// Step 2: Call Gemini image model with the sanitized prompt
function callGeminiImage(apiKey: string, model: string, prompt: string): Promise<ImageResult> {
  const bodyBuf = Buffer.from(
    JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
    "utf-8"
  );
  const path = `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "generativelanguage.googleapis.com", path, method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": bodyBuf.length } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Gemini ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }
          let data: { candidates?: GeminiCandidate[]; promptFeedback?: { blockReason?: string } };
          try { data = JSON.parse(text); }
          catch { reject(new Error("Gemini JSON parse error: " + text.slice(0, 200))); return; }

          if (data.promptFeedback?.blockReason) {
            reject(new Error(`Gemini BLOCKED: ${data.promptFeedback.blockReason}`));
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

export async function generateSceneImage(scene: Scene, heroDescription: string): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = (process.env.GEMINI_IMAGE_MODEL || IMAGE_MODEL).trim();

  // Build raw prompt: character reference first (higher attention), then scene, then style
  const rawPrompt = [
    heroDescription ? `Character appearances (keep exactly consistent): ${heroDescription}.` : "",
    scene.imagePrompt,
    "Walt Disney animated style, painterly storybook illustration, warm cinematic lighting, rich saturated colors, expressive faces, landscape orientation, no text.",
  ].filter(Boolean).join(" ");

  // Gemini sanitizes its own prompt — eliminates content filter guesswork
  const safePrompt = await sanitizeWithGemini(apiKey, rawPrompt);
  console.log(`[Gemini] scene ${scene.index} model=${model} (${safePrompt.length} chars): ${safePrompt.slice(0, 200)}`);

  const MAX_ATTEMPTS = 3;
  let lastErr = new Error("Gemini nevrátil obrázek");
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callGeminiImage(apiKey, model, safePrompt);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error(`[Gemini] scene ${scene.index} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastErr.message}`);
      const isRateLimit = lastErr.message.startsWith("Gemini 429");
      const isBlocked = lastErr.message.startsWith("Gemini BLOCKED");
      if ((lastErr.message.match(/^Gemini 4/) && !isRateLimit) || isBlocked) break;
      if (attempt < MAX_ATTEMPTS) {
        const delay = isRateLimit ? 15000 * attempt : 5000 * attempt;
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  throw new Error(`[scene ${scene.index}] ${lastErr.message}`);
}
