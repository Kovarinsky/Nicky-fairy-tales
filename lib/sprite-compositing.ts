// 🧩 ECONOMY-PLAN.md — vrstvový/sprite prototyp (mockup větev, POUZE technický
// průzkum proveditelnosti — viz generateCharacterSprite v lib/gemini.ts).
// Čistý kód (sharp), ŽÁDNÉ AI volání zde — to je celý smysl: jednou zaplacená
// postavička (sprite) se pak vkládá do libovolného pozadí zdarma.
//
// Postup: 1) sprite je namalovaný na plnou sytou "chroma-key" barvu (např.
// #FF00FF) → chromaKeyToTransparent tuhle barvu vymaskuje na průhlednost
// (per-pixel vzdálenost od klíčové barvy v RGB, s měkkým přechodem na okraji
// proti "barevnému lemu"). 2) compositeSpritesOnBackground vloží 1+ takhle
// připravených průhledných sprite PNG na pozadí na daných pozicích.

import sharp from "sharp";
import type { ImageResult } from "./gemini";

export interface RgbColor { r: number; g: number; b: number; }

export const MAGENTA_KEY: RgbColor = { r: 255, g: 0, b: 255 };

/** Vymaskuje danou "chroma-key" barvu na průhlednost. `tolerance` (0-441,
 *  euklidovská vzdálenost v RGB prostoru) řídí, jak "blízké" magentě pixely
 *  zprůhlední; `feather` přidává měkký přechod těsně nad prahem, aby okraj
 *  postavy (vlasy, prsty) nezůstal s tvrdým barevným lemem. */
export async function chromaKeyToTransparent(
  buffer: Buffer, key: RgbColor = MAGENTA_KEY, tolerance = 90, feather = 40
): Promise<Buffer> {
  const img = sharp(buffer).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels < 4) throw new Error(`chromaKeyToTransparent: expected 4 channels (RGBA), got ${channels}`);

  const out = Buffer.from(data); // kopie, upravujeme alfa kanál in-place
  for (let i = 0; i < out.length; i += channels) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const dist = Math.sqrt((r - key.r) ** 2 + (g - key.g) ** 2 + (b - key.b) ** 2);
    if (dist <= tolerance) {
      out[i + 3] = 0; // plně průhledné
    } else if (dist <= tolerance + feather) {
      // měkký přechod: blízko prahu částečně průhledné, dál plně neprůhledné
      const t = (dist - tolerance) / feather; // 0..1
      out[i + 3] = Math.round(out[i + 3] * t);
    }
  }

  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

export interface SpritePlacement {
  /** Průhledné PNG (výstup chromaKeyToTransparent). */
  png: Buffer;
  /** Levý horní roh v pixelech vzhledem k pozadí. */
  left: number;
  top: number;
  /** Volitelné přeškálování šířky (výška se dopočítá proporčně); bez zadání = původní velikost sprite. */
  width?: number;
}

/** Složí 1+ průhledných sprite vrstev na pozadí, v pořadí zezadu dopředu
 *  (pozdější v poli = blíž kameře, "nad" předchozími). Vrací WebP (stejná
 *  komprese jako zbytek appky, viz compressImage v lib/gemini.ts). */
export async function compositeSpritesOnBackground(
  background: ImageResult, sprites: SpritePlacement[]
): Promise<ImageResult> {
  let pipeline = sharp(background.buffer);
  const composites: sharp.OverlayOptions[] = [];
  for (const s of sprites) {
    let spriteBuf = s.png;
    if (s.width) {
      spriteBuf = await sharp(s.png).resize({ width: Math.round(s.width) }).png().toBuffer();
    }
    composites.push({ input: spriteBuf, left: Math.round(s.left), top: Math.round(s.top) });
  }
  pipeline = pipeline.composite(composites);
  const buf = await pipeline.webp({ quality: 85 }).toBuffer();
  return { buffer: buf, mimeType: "image/webp" };
}
