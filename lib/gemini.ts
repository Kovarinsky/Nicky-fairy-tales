// Generování ilustrací pomocí Google Gemini "Nano Banana"
// (model gemini-2.5-flash-image). Vrací PNG jako Buffer.
//
// Konzistence postavy: do každého promptu přidáme `heroDescription` ze scénáře,
// takže hrdina vypadá na všech stránkách stejně. (Volitelně lze do contents
// přidat i referenční obrázek – viz pole `referenceImage`.)

import { GoogleGenAI } from "@google/genai";
import type { Scene } from "./types";

const MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chybí GEMINI_API_KEY. Získej ho na https://aistudio.google.com a dej do .env.local."
    );
  }
  return new GoogleGenAI({ apiKey });
}

export interface ImageResult {
  /** Surová PNG data */
  buffer: Buffer;
  mimeType: string;
}

/**
 * Vygeneruje obrázek pro jednu scénu.
 * @param scene scéna se svým imagePrompt
 * @param heroDescription popis postav (drží konzistenci napříč scénami)
 * @param referenceImages volitelné referenční fotky postav (base64) pro podobu skutečným dětem
 */
export async function generateSceneImage(
  scene: Scene,
  heroDescription: string,
  referenceImages: Array<{ data: string; mimeType: string }> = []
): Promise<ImageResult> {
  const ai = getClient();

  const hasRefs = referenceImages.length > 0;
  const prompt = [
    hasRefs
      ? "Use the children in the reference photo(s) as the basis for the characters — keep their faces, hair and the size difference between them recognizable, but render them in the animation style below."
      : "",
    scene.imagePrompt,
    `Characters (keep consistent across all images): ${heroDescription}.`,
    "Style: classic Walt Disney animated movie style — polished and colorful, expressive",
    "characters with big friendly eyes, cinematic warm lighting, magical storybook charm.",
    "No text in the image.",
  ]
    .filter(Boolean)
    .join(" ");

  // contents: referenční fotky (pokud jsou) + textový prompt
  const parts: Array<Record<string, unknown>> = [];
  for (const ref of referenceImages) {
    parts.push({ inlineData: { data: ref.data, mimeType: ref.mimeType } });
  }
  parts.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: "user", parts }],
  });

  // Najdi v odpovědi obrázkovou část
  const candidates = response.candidates || [];
  for (const cand of candidates) {
    for (const part of cand.content?.parts || []) {
      const inline = (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData;
      if (inline?.data) {
        return {
          buffer: Buffer.from(inline.data, "base64"),
          mimeType: inline.mimeType || "image/png",
        };
      }
    }
  }

  throw new Error("Gemini nevrátil obrázek pro scénu " + scene.index);
}
