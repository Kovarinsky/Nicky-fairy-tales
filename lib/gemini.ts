import { request } from "https";
import type { Scene } from "./types";
import type { ReferenceImage } from "./characters";

// Primární model: levnější gemini-2.5-flash-image (~$0.039 ≈ 0,90 Kč/obrázek).
// Starší proměnná GEMINI_IMAGE_MODEL (na Vercelu gemini-3.1-flash-image,
// $0.067 ≈ 1,55 Kč) je od v2.79 už jen ZÁLOHA — kvalita storybook ilustrací je
// srovnatelná a náklady o ~42 % nižší. Přebít jde přes GEMINI_IMAGE_MODEL_PRIMARY.
const IMAGE_MODEL = (process.env.GEMINI_IMAGE_MODEL_PRIMARY || "gemini-2.5-flash-image").trim();
// Záložní obrázkový model — denní kvóta (limit 1000/den) platí NA MODEL,
// takže když primární narazí na strop, druhý model jede dál.
// .trim() — hodnota ve Vercelu může mít omylem vložený newline na konci.
const FALLBACK_IMAGE_MODEL = (process.env.GEMINI_IMAGE_MODEL_FALLBACK || process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image").trim();
const SANITIZE_MODEL = "gemini-2.0-flash"; // fast text model — sanitizes its own image model's prompt

// Denní kvóta / vyčerpaný kredit — okamžité opakování je zbytečné (reset až
// o půlnoci PT / po dobití). Joby na tuto chybu musí přestat pálit pokusy.
export function isDailyQuotaError(msg: string): boolean {
  return /per_day|per day|requests_per_model|credits are depleted|QUOTA_DAILY/i.test(msg);
}

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
            "- KEEP relative height/size comparisons between characters (e.g. 'the smallest', 'reaches his waist', 'slightly taller than', 'much taller') — these are allowed and important for consistency",
            "- Replace any element that would show readable text in the image (signs with writing, open books showing text, newspapers with headlines, shop labels, posters with words, billboards) with a purely visual alternative (e.g. 'a colorful sign' instead of 'a sign saying Welcome', 'a closed storybook' instead of 'a book with text')",
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
    .replace(/\btoddler\b/gi, "child")
    .replace(/\binfant\b/gi, "child")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+,/g, ",").replace(/,\s*,/g, ",").replace(/\s{2,}/g, " ")
    .trim();
}

// Step 2: Call Gemini image model with the sanitized prompt (+ reference photos)
function callGeminiImage(apiKey: string, model: string, prompt: string, aspect: string | null = "16:9", refImages: ReferenceImage[] = []): Promise<ImageResult> {
  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE", "TEXT"] };
  // Uniform aspect ratio (16:9 scenes, 9:16 app backgrounds); null = model default
  if (aspect) generationConfig.imageConfig = { aspectRatio: aspect };
  // Reference photos go first, each labeled with the character's name,
  // so Gemini can match the likeness when drawing the stylized scene
  const parts: Array<Record<string, unknown>> = [];
  for (const ref of refImages) {
    parts.push({ text: ref.label || `Reference photo of ${ref.name || "a story character"} (match this person's/animal's likeness):` });
    parts.push({ inlineData: { data: ref.data, mimeType: ref.mimeType } });
  }
  if (refImages.length > 0) {
    parts.push({ text: "Draw the characters so they are clearly recognizable as the people/animals in the reference photos above — same face shape, hair color and style, eye color, build, AGE and body size — but rendered in the illustration style described below. Keep every character's age and size true to their photo in every scene. Do NOT copy the photos' backgrounds or clothing unless the prompt says so." });
  }
  parts.push({ text: prompt });
  const bodyBuf = Buffer.from(
    JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig,
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

// Pozadí aplikace — ilustrovaná scenérie ve stejném stylu jako pohádky,
// na výšku (telefon), bez postav a bez textu. Prompt je bezpečný a pevně
// daný (lib/backgrounds.ts), sanitizace není potřeba.
export async function generateBackgroundImage(prompt: string): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = IMAGE_MODEL.trim();
  let aspect: string | null = "9:16";
  let lastErr = new Error("Gemini nevrátil obrázek");
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await callGeminiImage(apiKey, model, prompt, aspect);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      console.error(`[Gemini bg] attempt ${attempt}/3: ${lastErr.message}`);
      if (aspect && /image_config|imageConfig|aspect_ratio|aspectRatio|Unknown name/i.test(lastErr.message)) {
        aspect = null;
        continue;
      }
      if (lastErr.message.match(/^Gemini 4/) && !lastErr.message.startsWith("Gemini 429")) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 5000 * attempt));
    }
  }
  throw lastErr;
}

export async function generateSceneImage(scene: Scene, heroDescription: string, refImages: ReferenceImage[] = []): Promise<ImageResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const model = IMAGE_MODEL.trim();

  // Build raw prompt: character lock bookends the scene (start + end = highest model attention)
  const charLockOpen = heroDescription
    ? [
        `⚠ APPEARANCE LOCK — IMMUTABLE across every image in this story:`,
        heroDescription,
        `Every named character MUST look IDENTICAL to this description in EVERY image: same hair color, same hair style, same eye color, same exact clothing items and colors, same shoes — AND the same AGE, same BODY SIZE and PROPORTIONS. Relative heights between characters NEVER change: a toddler stays toddler-sized, a child stays child-sized, adults stay adult-sized. Any recurring OBJECT listed above (vehicle, magic item, toy) keeps IDENTICAL type, shape and colors in every scene — the same car stays the same car. These are LOCKED — do NOT change anything between scenes.`,
        `ONLY the characters named in the scene are visible — zero additional people, strangers, or background human figures.`,
      ].join(" ")
    : "";

  const charLockClose = heroDescription
    ? `⚠ CONSISTENCY REMINDER: match hair, eyes, clothing, age, body size and relative heights EXACTLY as stated above — do NOT alter any detail.`
    : "";

  const STYLE_SUFFIX = "Walt Disney animated style, painterly storybook illustration, warm cinematic lighting, rich saturated colors, expressive faces, landscape orientation. Absolutely no text, letters, words, signs, labels, captions, subtitles, or writing of any kind anywhere in the image.";

  const rawPrompt = [
    charLockOpen,
    scene.imagePrompt,
    charLockClose,
    STYLE_SUFFIX,
  ].filter(Boolean).join(" ");

  // Gemini sanitizes its own prompt — eliminates content filter guesswork
  const safePrompt = await sanitizeWithGemini(apiKey, rawPrompt);
  console.log(`[Gemini] scene ${scene.index} model=${model} (${safePrompt.length} chars): ${safePrompt.slice(0, 200)}`);

  const MAX_ATTEMPTS = 3;
  // Denní kvóta platí na model → při stropu primárního modelu zkusit záložní
  const models = FALLBACK_IMAGE_MODEL && FALLBACK_IMAGE_MODEL !== model
    ? [model, FALLBACK_IMAGE_MODEL]
    : [model];
  let withAspect = true;
  let lastErr = new Error("Gemini nevrátil obrázek");
  let quotaHits = 0;

  for (const m of models) {
    let dailyCapped = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        return await callGeminiImage(apiKey, m, safePrompt, withAspect ? "16:9" : null, refImages);
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        console.error(`[Gemini] scene ${scene.index} model=${m} attempt ${attempt}/${MAX_ATTEMPTS}: ${lastErr.message}`);
        // Older image models don't know imageConfig/aspectRatio — retry without it
        if (withAspect && /image_config|imageConfig|aspect_ratio|aspectRatio|Unknown name/i.test(lastErr.message)) {
          withAspect = false;
          continue;
        }
        // Denní strop / vyčerpaný kredit: NEOPAKOVAT (reset je za hodiny) —
        // rovnou přejít na záložní model
        if (isDailyQuotaError(lastErr.message)) {
          quotaHits++;
          dailyCapped = true;
          break;
        }
        const isRateLimit = lastErr.message.startsWith("Gemini 429");
        const isBlocked = lastErr.message.startsWith("Gemini BLOCKED");
        if ((lastErr.message.match(/^Gemini 4/) && !isRateLimit) || isBlocked) break;
        if (attempt < MAX_ATTEMPTS) {
          const delay = isRateLimit ? 15000 * attempt : 5000 * attempt;
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    if (!dailyCapped) break; // jiná chyba než kvóta → záložní model nepomůže
    if (dailyCapped && m !== models[models.length - 1]) {
      console.warn(`[Gemini] scene ${scene.index}: model ${m} na denním stropu → zkouším ${models[models.length - 1]}`);
    }
  }

  // Všechny modely na denním stropu → signál pro job-runner, ať job zastaví
  if (quotaHits >= models.length) {
    throw new Error(`QUOTA_DAILY [scene ${scene.index}] ${lastErr.message}`);
  }

  // Last resort for persistently blocked prompts: draw the SAME characters in a
  // gentle generic moment inspired by the narration — better than a missing image
  if (!isDailyQuotaError(lastErr.message)) {
    try {
      const fallbackRaw = [
        charLockOpen,
        `The named characters stand together smiling, in a gentle scene inspired by this story moment: ${scene.narration.slice(0, 140)}`,
        charLockClose,
        STYLE_SUFFIX,
      ].filter(Boolean).join(" ");
      const safeFallback = await sanitizeWithGemini(apiKey, fallbackRaw);
      console.warn(`[Gemini] scene ${scene.index}: using simplified fallback prompt`);
      return await callGeminiImage(apiKey, model, safeFallback, withAspect ? "16:9" : null, refImages);
    } catch (e2) {
      console.error(`[Gemini] scene ${scene.index} fallback failed: ${e2 instanceof Error ? e2.message : e2}`);
    }
  }

  throw new Error(`[scene ${scene.index}] ${lastErr.message}`);
}
