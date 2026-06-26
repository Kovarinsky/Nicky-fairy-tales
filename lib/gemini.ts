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
 * @param heroDescription popis hrdiny (drží konzistenci napříč scénami)
 * @param referenceImage volitelný referenční obrázek hrdiny (base64 PNG) pro ještě lepší konzistenci
 */
export async function generateSceneImage(
  scene: Scene,
  heroDescription: string,
  referenceImage?: { data: string; mimeType: string }
): Promise<ImageResult> {
  const ai = getClient();

  const prompt = [
    scene.imagePrompt,
    `Main character (keep consistent across all images): ${heroDescription}.`,
    "Style: soft children's storybook illustration, warm cozy colors, gentle lighting,",
    "friendly and whimsical, no text in the image.",
  ].join(" ");

  // contents: buď jen text, nebo text + referenční obrázek
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (referenceImage) {
    parts.unshift({
      inlineData: { data: referenceImage.data, mimeType: referenceImage.mimeType },
    });
  }

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
