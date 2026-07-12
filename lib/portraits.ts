// 🎨 Portrétová kartotéka postav — KAŽDÁ vestavěná postava se JEDNOU namaluje
// v cílovém pohádkovém stylu (celá postava od hlavy k patě podle fotek
// a kanonického popisu) a portrét se uloží do Vercel Blob. Kreslení scén pak
// místo syrových fotek dostává hotové malované portréty:
//   - konzistence: každá pohádka vychází ze STEJNÉ malované podoby, ne z nového
//     výkladu fotky (vlasy, obličej, oblečení i proporce už jsou „rozhodnuté")
//   - úspora: méně zamítnutí ve vizuální kontrole → méně opravných překreslení
// Portrét se maluje LÍNĚ při prvním použití postavy; pak se už jen čte
// (in-memory cache na teplé funkci + Blob pro studený start).
// Změna vzhledu postavy → zvednout PORTRAIT_VERSION (namaluje se znovu).

import { put, head } from "@vercel/blob";
import { blobToken } from "./blob-token";
import { generateBackgroundImage } from "./gemini";
import { loadReferenceImages, type ReferenceImage } from "./characters";
import type { Character } from "./types";

const PORTRAIT_VERSION = 2; // v2: opravené výšky (Valentýnka po ramena, James = Nicolas) a Janovy vlasy
const memCache = new Map<string, ReferenceImage>();

const PORTRAIT_STYLE =
  "Hand-painted 2D storybook illustration, soft painterly brushwork in classic Disney animated-film style, warm lighting, rich saturated colors. " +
  "Strictly FLAT 2D painting — NOT a 3D render, no CGI, no photorealism. " +
  "Correct natural anatomy: exactly two arms, two legs, five fingers on each hand. " +
  "Absolutely no text, letters, words, watermarks or signatures anywhere in the image.";

function portraitPrompt(c: Character): string {
  return [
    `CHARACTER REFERENCE SHEET: a full-body standing portrait of ${c.name}.`,
    `Exact appearance (copy faithfully from the reference photos and this description): ${c.description}.`,
    `Standing straight facing the viewer, friendly relaxed pose with arms by the sides, the WHOLE body visible from head to toe.`,
    `Plain soft warm-cream studio background with a gentle ground shadow. Exactly ONE character in the image — nobody and nothing else.`,
    PORTRAIT_STYLE,
  ].join(" ");
}

function portraitLabel(c: Character): string {
  return (
    `CANONICAL PORTRAIT of ${c.name} — this is EXACTLY how ${c.name} looks in this book's art style. ` +
    `Copy this appearance in every scene: same hair color and hairstyle, same face, same outfit and colors, same body size and proportions.`
  );
}

/** Veřejná URL portrétu v Blobu (pro náhled), null když ještě není namalovaný. */
export async function portraitUrl(c: Character): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try {
    const h = await head(`portraits/${c.id}-v${PORTRAIT_VERSION}.img`, { token });
    return h.url;
  } catch {
    return null;
  }
}

/** Vrátí malovaný portrét postavy (z cache/Blobu, případně ho JEDNOU namaluje).
 *  force = true → namaluje znovu a přepíše (když se portrét nepovedl). */
export async function getCharacterPortrait(c: Character, force = false): Promise<ReferenceImage | null> {
  const key = `${c.id}-v${PORTRAIT_VERSION}`;
  const cached = !force && memCache.get(key);
  if (cached) return cached;
  const token = blobToken();
  if (!token) return null;
  const pathName = `portraits/${key}.img`;

  // 1) Už namalovaný portrét v Blobu
  if (!force) try {
    const h = await head(pathName, { token });
    const r = await fetch(`${h.url}?t=${Date.now()}`, { cache: "no-store" });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const ref: ReferenceImage = {
        data: buf.toString("base64"),
        mimeType: h.contentType || "image/webp",
        label: portraitLabel(c),
      };
      memCache.set(key, ref);
      return ref;
    }
  } catch {}

  // 2) Namalovat JEDNOU z fotek + kanonického popisu a uložit
  try {
    const photoRefs = loadReferenceImages([c]);
    console.log(`[portraits] drawing canonical portrait of ${c.id}…`);
    const img = await generateBackgroundImage(portraitPrompt(c), photoRefs);
    await put(pathName, img.buffer, {
      access: "public",
      contentType: img.mimeType,
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    const ref: ReferenceImage = {
      data: img.buffer.toString("base64"),
      mimeType: img.mimeType,
      label: portraitLabel(c),
    };
    memCache.set(key, ref);
    return ref;
  } catch (e) {
    console.warn(`[portraits] ${c.id} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Referenční obrázky pro kreslení scén: malované portréty místo syrových fotek.
 * Když portrét (zatím) není k dispozici, postava dostane své fotky jako dřív.
 */
export async function loadPortraitRefs(characters: Character[]): Promise<ReferenceImage[]> {
  const refs: ReferenceImage[] = [];
  for (const c of characters) {
    const portrait = await getCharacterPortrait(c);
    if (portrait) refs.push(portrait);
    else refs.push(...loadReferenceImages([c]));
  }
  return refs;
}

// ── Cílené reference: scéna dostane JEN portréty postav, které v ní vystupují ──
// Při velkém obsazení (9 postav) dostával model 9 portrétů na každou scénu
// a míchal identity (Janova polokošile na cizím dítěti…). Filtruje se podle
// jmen v imagePromptu — kdo ve scéně není jmenovaný, jeho portrét se neposílá.
export interface PortraitRefEntry { keys: string[]; ref: ReferenceImage }

export async function loadPortraitRefEntries(characters: Character[]): Promise<PortraitRefEntry[]> {
  const out: PortraitRefEntry[] = [];
  for (const c of characters) {
    const portrait = await getCharacterPortrait(c);
    const refs = portrait ? [portrait] : loadReferenceImages([c]);
    const keys = [c.name, c.nameEn, c.description?.split(":")[0]]
      .filter(Boolean)
      .map(s => String(s).trim().toLowerCase())
      .filter(s => s.length >= 3);
    for (const ref of refs) out.push({ keys, ref });
  }
  return out;
}

/** Vybere reference postav jmenovaných v textu (celá slova — „Jana" nesmí
 *  chytit „Jan"); bez jediné shody vrátí všechny (pojistka). */
export function refsForText(entries: PortraitRefEntry[], text: string): ReferenceImage[] {
  const low = ` ${text.toLowerCase()} `;
  const wordHit = (k: string) => {
    const i = low.indexOf(k);
    if (i < 0) return false;
    // hranice slova: před a za klíčem nesmí být písmeno (stačí ASCII+diakritika)
    const isLetter = (ch: string) => /[a-záčďéěíňóřšťúůýž]/i.test(ch);
    for (let p = i; p >= 0; p = low.indexOf(k, p + 1)) {
      if (!isLetter(low[p - 1] || " ") && !isLetter(low[p + k.length] || " ")) return true;
    }
    return false;
  };
  const hit = entries.filter(e => e.keys.some(wordHit));
  return (hit.length > 0 ? hit : entries).map(e => e.ref);
}
