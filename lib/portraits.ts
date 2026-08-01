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
import { generateBackgroundImage, verifySceneImage } from "./gemini";
import { loadReferenceImages, loadCharacters, type ReferenceImage } from "./characters";
import type { Character } from "./types";

// v3: portréty procházejí KONTROLOU (dřív jediná cesta bez QA — vadný portrét
// Belly se stal referencí a chyba se replikovala do všech pohádek) + popisy
// nově zamykají barvu pleti; bump = celá knihovna se překreslí
const PORTRAIT_VERSION = 3;
const memCache = new Map<string, ReferenceImage>();

const PORTRAIT_STYLE =
  "Hand-painted 2D storybook illustration, soft painterly brushwork in classic Disney animated-film style, warm lighting, rich saturated colors. " +
  "Strictly FLAT 2D painting — NOT a 3D render, no CGI, no photorealism. " +
  "Correct natural anatomy: exactly two arms, two legs, five fingers on each hand. " +
  "Absolutely no text, letters, words, watermarks or signatures anywhere in the image.";

// Stejný styl, ale BEZ zákazu textu — výhradně pro celorodinný výškový list
// níž, kde jsou jméno+cm popisky ŽÁDOUCÍ (je to soukromá reference appky,
// nikdy stránka, kterou vidí čtenář).
const REFERENCE_SHEET_STYLE =
  "Hand-painted 2D storybook illustration, soft painterly brushwork in classic Disney animated-film style, warm lighting, rich saturated colors. " +
  "Strictly FLAT 2D painting — NOT a 3D render, no CGI, no photorealism. " +
  "Correct natural anatomy: exactly two arms, two legs, five fingers on each hand.";

function portraitPrompt(c: Character): string {
  return [
    `CHARACTER REFERENCE SHEET: a full-body standing portrait of ${c.name}.`,
    `Exact appearance (copy faithfully from the reference photos and this description): ${c.description}.`,
    // 🩺 Bez tohohle appka opakovaně malovala Archieho s běžnou "maskou" kolem
    // očí typickou pro jeho plemeno, i když popis i referenční fotka výslovně
    // říkají opak — model dává přednost typickému/generickému vzhledu před
    // explicitní negací v textu. Scénové kreslení tuhle ochranu už mělo
    // (pravidlo 9 v buildAppearanceLock, gemini.ts), prvotní malování portrétu
    // ne — to je přesně krok, který selhával.
    `If the description above explicitly states a feature is ABSENT or DIFFERENT from what would be typical (e.g. "NO dark mask", "NO stripe", a specific marking shape instead of the usual one for this breed/type), that is a DELIBERATE correction — draw it EXACTLY as stated even if it contradicts what is typical or generic for this kind of animal/person. Do not default to a stereotypical look when the description explicitly rules it out.`,
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
    // Portrét je NEMĚNNÝ na tuhle cestu (verze v názvu souboru bump-ne, když
    // se vzhled změní) — na rozdíl od jobs/*.json tu není důvod cache mařit
    // timestampem/no-store; zbytečně to nutilo znovu stahovat stejný obrázek
    // na každý studený start funkce (/api/scene ho čte na scénu zvlášť).
    const r = await fetch(h.url, { cache: "force-cache" });
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

  // 2) Namalovat JEDNOU z fotek + kanonického popisu a uložit — S KONTROLOU:
  // portrét je REFERENCE pro všechny scény, vadný portrét = vadná celá knihovna
  try {
    const photoRefs = loadReferenceImages([c]);
    console.log(`[portraits] drawing canonical portrait of ${c.id}…`);
    const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
    const sceneDesc = `A full-body standing storybook portrait of ${c.name}. Only ${c.name} present — exactly one person/animal.`;
    let img = await generateBackgroundImage(portraitPrompt(c), photoRefs);
    let v = await verifySceneImage(apiKey, img, c.description, sceneDesc, photoRefs);
    if (v && !v.ok) {
      console.warn(`[portraits] ${c.id} REJECTED (${v.problems.slice(0, 140)}) → redraw with correction`);
      img = await generateBackgroundImage(
        `${portraitPrompt(c)} ⚠ CORRECTION: the previous attempt violated: ${v.problems.slice(0, 300)}. Follow the description EXACTLY (hair color and length, skin tone, eye color, clothing).`,
        photoRefs
      );
      v = await verifySceneImage(apiKey, img, c.description, sceneDesc, photoRefs);
      if (v && !v.ok) {
        // ani oprava neprošla → RADĚJI ŽÁDNÝ portrét (scény dostanou fotky)
        console.warn(`[portraits] ${c.id} still rejected (${v.problems.slice(0, 140)}) → falling back to photos`);
        return null;
      }
    }
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

// ── 📏 CELORODINNÝ výškový list — JEDEN statický obrázek s popiskami jmen
// a cm pro celou pevnou rodinnou kartotéku. Textové pravidlo („temeno jí
// sahá k jeho uším") model při kreslení nijak nezměří — je to relační
// geometrie, na kterou v promptu nemá nástroj. Dřív appka kreslila zvlášť
// jeden obrázek PRO KAŽDOU jinou podskupinu postav vybraných do konkrétní
// pohádky (cache key vázaný na výběr obsazení) — teď je to JEDEN natrvalo
// vygenerovaný obrázek pro celou rodinu, vždy stejný cache-hit.
// Skutečná cm jsou z CANONICAL_HEIGHT_CM (lib/claude.ts, reálná rodinná
// fakta) — viditelný text je tu VÝJIMEČNĚ žádoucí (na rozdíl od pohádkových
// stránek, kde appka text vždy zakazuje): jde o SOUKROMOU referenci appky,
// nikdy stránku, kterou vidí čtenář, a jméno+cm napsané přímo u postavy nechá
// jak kreslicí, tak kontrolní model přesně přiřadit barvu vlasů ke jménu —
// cílí na nahlášenou záměnu „jednou Vája, potom Nicolásek".
// v2: list teď prochází stejnou kontrolou (verifySceneImage) a zámkem
// "absence je taky zámek" jako jednotlivé portréty (viz getFamilyScaleSheet
// níž) — bump, ať se případný starý neověřený list v Blobu překreslí znovu
const FAMILY_SCALE_VERSION = 2;
// Duplikát CANONICAL_HEIGHT_CM z claude.ts (import by vytáhl celý claude.ts
// do knihovny portrétů) — mění se JEN spolu s tamní tabulkou, viz komentář tam.
const FAMILY_HEIGHT_CM: Record<string, number> = {
  valentyna: 85, nicolas: 111, james: 115, bella: 135,
  jana: 175, eva: 180, jakob: 183, jan: 185,
};

function familyScaleLabel(): string {
  return (
    "CANONICAL FAMILY HEIGHT REFERENCE SHEET — shows the EXACT height (cm) and hair/face/outfit of every named family member, sorted shortest to tallest, with their name and height printed under each one. " +
    "Use it ONLY to match the height/body-scale RATIO between whichever of these characters actually appear together in this scene — match each visible character's OWN printed cm value to their OWN name, never swap two characters' colors or sizes with each other. " +
    "IGNORE any person in this reference who is NOT named in this scene's cast — they are shown here only for the height comparison, they are not present in the scene."
  );
}

/** Má smysl list vůbec připojovat? Jen když příběh má 2+ postavy, které
 *  appka doopravdy zná s přesným cm (custom/vymyšlené postavy list neumí
 *  pomoct — na obrázku by byli lidé, co ve scéně vůbec nejsou). */
export function familyScaleSheetApplies(characterIds: string[]): boolean {
  return characterIds.filter(id => FAMILY_HEIGHT_CM[id] !== undefined).length >= 2;
}

/** Malovaný celorodinný výškový list se jmény a cm; null když se nepovede
 *  nebo chybí Blob úložiště. Kreslí se JEDNOU CELKOVĚ (ne na pohádku/postavu)
 *  a natrvalo se cachuje — bump FAMILY_SCALE_VERSION při změně cm/vzhledu. */
export async function getFamilyScaleSheet(): Promise<ReferenceImage | null> {
  const key = `family-scale-v${FAMILY_SCALE_VERSION}`;
  const cached = memCache.get(key);
  if (cached) return cached;
  const token = blobToken();
  if (!token) return null;
  const pathName = `portraits/${key}.img`;

  try {
    const h = await head(pathName, { token });
    const r = await fetch(h.url, { cache: "force-cache" });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const ref: ReferenceImage = { data: buf.toString("base64"), mimeType: h.contentType || "image/webp", label: familyScaleLabel() };
      memCache.set(key, ref);
      return ref;
    }
  } catch {}

  try {
    const cast = loadCharacters()
      .filter(c => FAMILY_HEIGHT_CM[c.id] !== undefined)
      .sort((a, b) => FAMILY_HEIGHT_CM[a.id] - FAMILY_HEIGHT_CM[b.id]);
    if (cast.length < 2) return null;
    console.log(`[portraits] drawing FAMILY scale sheet (${cast.map(c => c.id).join("+")})…`);
    const prompt = [
      `CHARACTER HEIGHT REFERENCE SHEET: ${cast.map(c => c.name).join(", ")} standing side by side in one row, shortest to tallest from left to right.`,
      `Exact appearances (copy faithfully): ${cast.map(c => c.description).join(" | ")}.`,
      // 🩺 Stejná díra jako u portraitPrompt výš (viz komentář tam) — tenhle
      // list ale navíc nemá ani kontrolu (verifySceneImage), takže chybný
      // vzhled odsud šel rovnou do produkce jako "kotva" pro VŠECHNY scény.
      `If any description above explicitly states a feature is ABSENT or DIFFERENT from what would be typical (e.g. "NO dark mask", "NO stripe", a specific marking instead of the usual one for this breed/type), that is a DELIBERATE correction — draw it EXACTLY as stated even if it contradicts what is typical/generic. Do not default to a stereotypical look when a description explicitly rules it out.`,
      `Every character FULL BODY head to toe, standing straight and relaxed facing the viewer, all feet on the SAME flat ground line, evenly spaced, plain soft warm-cream background, even flat lighting, no props, no scenery.`,
      `Their real heights are EXACTLY: ${cast.map(c => `${c.name} ${FAMILY_HEIGHT_CM[c.id]}cm`).join(", ")} — draw every body scaled precisely to these proportions relative to each other; this is the single most important requirement of this image.`,
      `Directly BELOW each character, print their name in capital letters and their height in parentheses as two short lines of clean plain text (e.g. "NICOLÁSEK" then "(111CM)") — this is the ONE exception in this whole book's art style where readable text is wanted, because this specific image is a private reference sheet for the illustrator, never a page shown to a reader.`,
      `Exactly ${cast.length} people in the image — nobody else.`,
      REFERENCE_SHEET_STYLE,
    ].join(" ");
    const photoRefs = loadReferenceImages(cast);
    const combinedDesc = cast.map(c => c.description).join(" | ");
    const sceneDesc = `A height reference sheet with ${cast.map(c => c.name).join(", ")} standing side by side, shortest to tallest.`;
    const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
    let img = await generateBackgroundImage(prompt, photoRefs);
    // 🩺 Portrét jednotlivce se OD v3 kontroluje (viz getCharacterPortrait
    // výš — vadný portrét Belly se jinak stal referencí a chyba se
    // replikovala do všech pohádek); tenhle celorodinný list byl na kontrolu
    // dřív úplně slepý, přestože ho appka používá jako kotvu pro KAŽDOU
    // scénu, ne jen pro jednu postavu — chyba tu měla ještě větší dosah.
    let v = await verifySceneImage(apiKey, img, combinedDesc, sceneDesc, photoRefs);
    if (v && !v.ok) {
      console.warn(`[portraits] family scale sheet REJECTED (${v.problems.slice(0, 140)}) → redraw with correction`);
      img = await generateBackgroundImage(
        `${prompt} ⚠ CORRECTION: the previous attempt violated: ${v.problems.slice(0, 300)}. Follow every description EXACTLY (hair color, skin tone, markings, clothing).`,
        photoRefs
      );
      v = await verifySceneImage(apiKey, img, combinedDesc, sceneDesc, photoRefs);
      if (v && !v.ok) {
        // ani oprava neprošla → RADĚJI ŽÁDNÝ list (scény pojedou bez výškové kotvy)
        console.warn(`[portraits] family scale sheet still rejected (${v.problems.slice(0, 140)}) → skipping`);
        return null;
      }
    }
    await put(pathName, img.buffer, {
      access: "public",
      contentType: img.mimeType,
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    const ref: ReferenceImage = { data: img.buffer.toString("base64"), mimeType: img.mimeType, label: familyScaleLabel() };
    memCache.set(key, ref);
    return ref;
  } catch (e) {
    console.warn(`[portraits] family scale sheet failed: ${e instanceof Error ? e.message : e}`);
    return null; // scény pojedou jako dřív, jen bez výškové kotvy
  }
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

// ── Reference pro ARCH (víc scén v jednom obrázku) ──────────────────────────
// Arch dostává portréty CELÉHO obsazení scén v archu najednou (víc postav než
// jedna sólo scéna) — bez vazby na konkrétní panel model u obsazení 3-4+
// postav míchal/vymýšlel obličeje (viz „Unknown children instead of Nicolas
// a Valentýna"). Každý portrét proto dostane navíc popisek „použij jen pro
// PANEL X" podle toho, ve kterých panelech se ta postava jmenovitě objevuje.
export function refsForPanels(entries: PortraitRefEntry[], panelTexts: string[]): ReferenceImage[] {
  const low = panelTexts.map(t => ` ${t.toLowerCase()} `);
  const wordHit = (text: string, k: string) => {
    const i = text.indexOf(k);
    if (i < 0) return false;
    const isLetter = (ch: string) => /[a-záčďéěíňóřšťúůýž]/i.test(ch);
    for (let p = i; p >= 0; p = text.indexOf(k, p + 1)) {
      if (!isLetter(text[p - 1] || " ") && !isLetter(text[p + k.length] || " ")) return true;
    }
    return false;
  };
  const out: ReferenceImage[] = [];
  let anyMatched = false;
  for (const e of entries) {
    const panelNums: number[] = [];
    low.forEach((t, idx) => { if (e.keys.some(k => wordHit(t, k))) panelNums.push(idx + 1); });
    if (panelNums.length > 0) {
      anyMatched = true;
      out.push({
        ...e.ref,
        label: `${e.ref.label || ""} Use this reference ONLY for PANEL ${panelNums.join(", ")} of this sheet — this person does NOT appear in any other panel, ignore this photo when drawing the rest.`.trim(),
      });
    }
  }
  return anyMatched ? out : entries.map(e => e.ref);
}
