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
  /** Měkký kontaktní stín pod postavou (výchozí true). */
  shadow?: boolean;
  /** Jemné dolad'ění barvy/jasu sprite podle okolí pozadí, ať nepůsobí "nalepeně" (výchozí true). */
  lightMatch?: boolean;
}

/** Vzorek průměrné barvy dané oblasti pozadí — appka ho používá k jemnému
 *  doladění tónu/jasu sprite (viz applyLightMatch), aby postava, namalovaná
 *  na neutrálním chroma-key studiovém osvětlení, alespoň barevně zapadla
 *  do NÁLADY konkrétního pozadí (skutečnou směrovou stínohru appka takhle
 *  nedostane — na to by bylo potřeba AI přesvětlení, ne kód). */
async function sampleAverageColor(buffer: Buffer, region: { left: number; top: number; width: number; height: number }): Promise<RgbColor> {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 0, h = meta.height || 0;
  const left = Math.max(0, Math.min(w - 1, Math.round(region.left)));
  const top = Math.max(0, Math.min(h - 1, Math.round(region.top)));
  const width = Math.max(1, Math.min(w - left, Math.round(region.width)));
  const height = Math.max(1, Math.min(h - top, Math.round(region.height)));
  const { data } = await sharp(buffer)
    .extract({ left, top, width, height })
    .resize(1, 1)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { r: data[0], g: data[1], b: data[2] };
}

/** Jemně posune barvu/jas sprite (natočeného na neutrální studiové osvětlení)
 *  směrem k okolní barvě pozadí — per-pixel blend jen tam, kde je sprite
 *  neprůhledný (alfa kanál zůstává netknutý). `strength` 0-1, drženo nízko
 *  (výchozí 0,16), ať appka jen "zabarví" postavu do nálady, ne ji přebarví. */
async function applyLightMatch(spritePng: Buffer, ambient: RgbColor, strength = 0.16): Promise<Buffer> {
  const img = sharp(spritePng).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const out = Buffer.from(data);
  // jemné dorovnání celkového jasu ke scéně (chroma-key studio je vždy jasné/
  // neutrální ~200, tmavší/teplejší pozadí by jinak nechalo postavu "zářit")
  const ambientLuma = 0.299 * ambient.r + 0.587 * ambient.g + 0.114 * ambient.b;
  const brightness = Math.max(0.82, Math.min(1.08, 0.5 + ambientLuma / 400));
  for (let i = 0; i < out.length; i += channels) {
    if (out[i + 3] === 0) continue;
    const r = Math.min(255, out[i] * brightness);
    const g = Math.min(255, out[i + 1] * brightness);
    const b = Math.min(255, out[i + 2] * brightness);
    out[i] = Math.round(r * (1 - strength) + ambient.r * strength);
    out[i + 1] = Math.round(g * (1 - strength) + ambient.g * strength);
    out[i + 2] = Math.round(b * (1 - strength) + ambient.b * strength);
  }
  return sharp(out, { raw: { width, height, channels } }).png().toBuffer();
}

/** Měkký rozostřený eliptický kontaktní stín (SVG → raster) — appka ho
 *  vkládá TĚSNĚ POD nohy sprite, ať nepůsobí jako "vystřižená nálepka". */
async function buildContactShadow(width: number, height: number): Promise<Buffer> {
  const rx = Math.round(width * 0.38);
  const ry = Math.round(height * 0.16);
  const blur = Math.max(3, Math.round(width * 0.06));
  const cx = Math.round(width / 2), cy = Math.round(height / 2);
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${blur}" /></filter></defs>
    <ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="black" opacity="0.32" filter="url(#b)" />
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Složí 1+ průhledných sprite vrstev na pozadí, v pořadí zezadu dopředu
 *  (pozdější v poli = blíž kameře, "nad" předchozími). Ke KAŽDÉ vrstvě appka
 *  (pokud nevypnuto) přidá měkký kontaktní stín pod nohama + jemné doladění
 *  barvy/jasu podle okolí pozadí — obojí čistý kód, žádné další AI volání.
 *  Vrací WebP (stejná komprese jako zbytek appky, viz compressImage v
 *  lib/gemini.ts). */
export async function compositeSpritesOnBackground(
  background: ImageResult, sprites: SpritePlacement[]
): Promise<ImageResult> {
  const composites: sharp.OverlayOptions[] = [];
  for (const s of sprites) {
    let spriteBuf = s.png;
    if (s.width) {
      spriteBuf = await sharp(s.png).resize({ width: Math.round(s.width) }).png().toBuffer();
    }
    const meta = await sharp(spriteBuf).metadata();
    const w = meta.width || 0, h = meta.height || 0;

    if (s.lightMatch !== false) {
      const ambient = await sampleAverageColor(background.buffer, { left: s.left, top: s.top, width: w, height: h });
      spriteBuf = await applyLightMatch(spriteBuf, ambient);
    }

    if (s.shadow !== false) {
      // stín leží pod postavou, mírně užší než sprite a přisazený k dolnímu
      // okraji (nohy) — proto vlastní menší canvas, ne stejná bbox jako sprite.
      const shadowW = Math.round(w * 0.9);
      const shadowH = Math.max(10, Math.round(h * 0.1));
      const shadowBuf = await buildContactShadow(shadowW, shadowH);
      composites.push({
        input: shadowBuf,
        left: Math.round(s.left + (w - shadowW) / 2),
        top: Math.round(s.top + h - shadowH * 0.65),
      });
    }

    composites.push({ input: spriteBuf, left: Math.round(s.left), top: Math.round(s.top) });
  }
  const buf = await sharp(background.buffer).composite(composites).webp({ quality: 85 }).toBuffer();
  return { buffer: buf, mimeType: "image/webp" };
}
