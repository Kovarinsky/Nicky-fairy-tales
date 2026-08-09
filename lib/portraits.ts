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
import { generateBackgroundImage, verifySceneImage, STYLE_SUFFIX, type ImageResult } from "./gemini";
import { loadReferenceImages, loadCharacters, charactersByIds, type ReferenceImage } from "./characters";
import type { Character } from "./types";

// v3: portréty procházejí KONTROLOU (dřív jediná cesta bez QA — vadný portrét
// Belly se stal referencí a chyba se replikovala do všech pohádek) + popisy
// nově zamykají barvu pleti; bump = celá knihovna se překreslí
// v4: Archieho popis dřív říkal "red-brindle" — model to bral jako výzvu k
// výrazným tygřím pruhům, i když reálná fotka ukazuje skoro jednobarevnou
// srst jen s náznakem žíhání; popis teď explicitně říká "SOLID... NOT
// tiger-striped" (viz reference/characters.json)
// 2026-08-06: Valentýnka (hnědé→hnědo-zelené oči) a Eva (hnědé→hnědo-blond
// vlasy) — uživatelovo přání ("zamknout tyto podoby, s jemnou změnou…").
// Záměrně NEBUMPnuto (stejný precedent jako Archie výš) — jen tyhle dvě
// postavy se překreslí cíleně přes ?redraw=valentyna / ?redraw=eva, ne
// celá devítičlenná knihovna.
// 2026-08-06 (5): Archieho popis dál rozšířen — bílý flek na ČELE (dřív jen
// čenich) + hrudní skvrna má SRDÍČKOVÝ tvar (uživatel: "nemá bílé fleky na
// čele a typické bílé srdíčko") + explicitní "small-to-medium, NOT large"
// (uživatel: "stále je gigantický"). Zase záměrně NEBUMPnuto, cílený
// ?redraw=archie.
// 2026-08-06 (6): srdíčko na hrudi ZASE ZRUŠENO (uživatel si to rozmyslel:
// "sundej Archiemu srdíčko z hrudi") — zpět na obyčejný bílý flek. Poslední
// doladění velikosti dolů ("lehce ho zmenši, aby byl Valentýnce po pás").
// v5 (2026-08-08): CELÁ rodina dostala pojmenovaný zámek odstínu vlasů
// (espresso-hnědá/kaštanová/karamelová/bronde/golden-blond + vzájemné
// srovnání "tmavší než"/"světlejší než" — viz reference/characters.json) —
// řeší nahlášené "Jan zase vypadá jinak", kde appčina vlastní kontrola
// tolerovala posun uvnitř barevné rodiny jako MINOR (gemini.ts pravidlo 3
// dostalo výjimku pro tyhle pojmenované zámky). Jan navíc dostal třetí
// referenční fotku (jan-face3.jpg, čerstvá, jasně ukazuje skutečnou vysokou
// ustupující hranici vlasů) a text posílen na konkrétní míru (~40 % holého
// čela) — uživatel potvrdil tenhle směr přímo na fotce. Archie dostal 3
// další čerstvé fotky (archie-3/4/5.jpg) + text výslovně říká, že jeho
// velikost/objem se NEMĚNÍ podle pózy nebo vzdálenosti od kamery (řeší
// "gigantický" vzhled v scénách, kde sedí blízko kamery). Tohle je záměrně
// PLNÝ bump (ne cílený ?redraw=), protože se mění popis skoro celé
// devítičlenné knihovny najednou, ne jedné postavy.
const PORTRAIT_VERSION = 5;
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
    // 🩺 2026-08-06: appka dřív po 2. neúspěšné kontrole zahodila CELÝ portrét
    // (return null → scéna dostane syrovou fotku), i když šlo často jen o
    // opakovaný FALEŠNÝ nález QA (appčina vlastní diagnóza, viz
    // SUSPICIOUS_FINDINGS_COUNT ve sdíleném verifySceneImage, gemini.ts —
    // živě potvrzeno na výškovém listu: "styl je správný painterly" nahlášeno
    // jako MAJOR chyba). generateSceneImage (gemini.ts, scény pohádky) tohle
    // řeší jinak: nikdy nezahazuje na null, drží si NEJLÉPE ověřený pokus a
    // POUŽIJE ho, i nedokonalý — portrét teď dělá totéž.
    let best = { img, badRules: v && !v.ok ? v.badRules : 0, problems: v?.problems || "" };
    if (v && !v.ok) {
      console.warn(`[portraits] ${c.id} REJECTED (${v.problems.slice(0, 140)}) → redraw with correction`);
      const img2 = await generateBackgroundImage(
        `${portraitPrompt(c)} ⚠ CORRECTION: the previous attempt violated: ${v.problems.slice(0, 300)}. Follow the description EXACTLY (hair color and length, skin tone, eye color, clothing).`,
        photoRefs
      );
      const v2 = await verifySceneImage(apiKey, img2, c.description, sceneDesc, photoRefs);
      if (v2 && (v2.ok || v2.badRules < best.badRules)) {
        best = { img: img2, badRules: v2.ok ? 0 : v2.badRules, problems: v2.problems };
      }
      if (best.badRules > 0) console.warn(`[portraits] ${c.id} still imperfect [${best.badRules}] (${best.problems}) → using best available attempt`);
      else console.log(`[portraits] ${c.id} fixed ✓`);
    }
    img = best.img;
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

/** Vygeneruje N kandidátních variant portrétu JEDNÉ postavy (na žádost
 *  "chci aby se víc podobal mě, připrav 3 varianty, z kterých vybereme
 *  finální podobu") — stejný vzor jako generateFamilyGroupAnchorCandidates
 *  pro skupinovou kotvu, jen pro jednotlivce s RŮZNÝMI popisy místo
 *  různých prostředí. Uloží na DOČASNÉ cesty (candidates/), appka žádnou
 *  nepoužívá jako referenci, dokud se ručně nepromuje. */
export async function generateCharacterPortraitCandidates(
  baseChar: Character,
  variants: Array<{ label: string; description: string }>
): Promise<Array<{ index: number; label: string; url: string | null; ok: boolean; problems?: string }>> {
  const token = blobToken();
  if (!token) return [];
  const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
  const photoRefs = loadReferenceImages([baseChar]);
  const out: Array<{ index: number; label: string; url: string | null; ok: boolean; problems?: string }> = [];
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    const c: Character = { ...baseChar, description: variant.description };
    console.log(`[portraits] drawing portrait CANDIDATE ${i + 1}/${variants.length} for ${baseChar.id} (${variant.label})…`);
    try {
      const sceneDesc = `A full-body standing storybook portrait of ${c.name}. Only ${c.name} present — exactly one person/animal.`;
      let img = await generateBackgroundImage(portraitPrompt(c), photoRefs);
      let v = await verifySceneImage(apiKey, img, c.description, sceneDesc, photoRefs);
      let problems = v?.problems || "";
      if (v && !v.ok) {
        const img2 = await generateBackgroundImage(
          `${portraitPrompt(c)} ⚠ CORRECTION: the previous attempt violated: ${v.problems.slice(0, 300)}. Follow the description EXACTLY.`,
          photoRefs
        );
        const v2 = await verifySceneImage(apiKey, img2, c.description, sceneDesc, photoRefs);
        if (v2 && (v2.ok || v2.badRules < v.badRules)) { img = img2; problems = v2.problems; }
      }
      const pathName = `portraits/candidates/${baseChar.id}-${i + 1}.img`;
      const { url } = await put(pathName, img.buffer, {
        access: "public",
        contentType: img.mimeType,
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 3600, // dočasné — kandidáti, ne finální portrét
      });
      out.push({ index: i + 1, label: variant.label, url, ok: true, problems: problems || undefined });
    } catch (e) {
      out.push({ index: i + 1, label: variant.label, url: null, ok: false, problems: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/** Povýší už vygenerovaného kandidáta (viz generateCharacterPortraitCandidates)
 *  na FINÁLNÍ portrét postavy — zkopíruje jeho bajty na cestu, kterou appka
 *  skutečně čte (portraits/<id>-v<PORTRAIT_VERSION>.img), BEZ nového
 *  (placeného) generování. Popis v reference/characters.json je NUTNÉ
 *  ručně upravit na text vybrané varianty ZVLÁŠŤ — tahle funkce jen
 *  přesune obrázek, netýká se popisu. */
export async function promoteCharacterPortraitCandidate(charId: string, index: number): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try {
    const h = await head(`portraits/candidates/${charId}-${index}.img`, { token });
    const r = await fetch(h.url, { cache: "no-store" });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const key = `${charId}-v${PORTRAIT_VERSION}`;
    const { url } = await put(`portraits/${key}.img`, buf, {
      access: "public",
      contentType: h.contentType || "image/webp",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    memCache.delete(key);
    return url;
  } catch (e) {
    console.warn(`[portraits] promote portrait candidate ${charId}-${index} failed: ${e instanceof Error ? e.message : e}`);
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
// v3: Archieho popis se opravil (viz PORTRAIT_VERSION v4 výš) — list ho
// cituje taky, musí se překreslit se stejnou opravou
// v4 (2026-08-06): Valentýnka 85→90cm (upřesnil uživatel, viz CANONICAL_HEIGHT_CM claude.ts) — list se musí překreslit se správným poměrem.
// v5 (2026-08-06, 2): 90→96cm — živý test skupinové kotvy ukázal, že i s
// relační větou ("sahá po ramena") 90/111 vizuálně nedosahovalo ramen;
// uživatel po zhlédnutí hotového obrázku: "ještě Vája trochu větší,
// Nicolaskovi po ramena a jsme tam. Ostatní neměnit" — číslo tu jde nahoru
// jen kvůli vykreslení, ne jako revize její skutečné výšky (viz claude.ts).
// v6 (2026-08-06, 3): reference se přepnuly ze syrových FOTEK na NATRVALO
// ULOŽENÉ malované portréty (loadPortraitRefs místo loadReferenceImages) —
// uživatel nahlásil, že táta Jan "vypadá zase trochu jinak" i beze změny
// promptu (appka fotku při každém nezávislém kreslení reinterpretuje znovu).
// Zároveň drobná úprava popisu: Valentýnka hnědé→hnědo-zelené (hazel) oči,
// Eva hnědé→hnědo-blond vlasy (uživatelovo přání "zamknout tyto podoby").
// v7 (2026-08-06, 4): Archieho relační věta upřesněna na skutečná data
// ("do pasu Váji, lehce nad kolena Nicoláska", ne appčin odhad "koleno-bok").
// v8 (2026-08-06, 5): nahlášeno přímo na v7 obrázku — Archie "stále je
// gigantický" (textová relace z v7 zjevně nestačila) + appka mu chyběl
// bílý flek na čele a srdíčkový tvar hrudní skvrny; James navíc vyšel
// neúměrně velký vedle Belly/dospělých. Popis Archieho (characters.json)
// rozšířen o čelní skvrnu + srdíčko + "small-to-medium, NOT large"
// instrukci, relační věta zesílena (explicitní varování před obvyklou
// chybou "psi se kreslí větší kvůli roztomilosti"), James dostal
// samostatnou větu vůči dospělým (dřív byl vztah jen jednosměrný).
// v9 (2026-08-06, 6): uživatel — "sundej Archiemu srdíčko z hrudi a lehce ho
// zmenši, aby byl Valentýnce po pás a jsme tam" — srdíčko na hrudi zrušeno
// zpět na obyčejný bílý flek, poměr doladěn o poslední kousek dolů.
// v10 (2026-08-06, 13) po schválení kotvy: uživatel — "dej ještě pls všechny
// vedle sebe a přidej výškové linky" — přepsáno z DVOU řádků (jeden pro
// každou rodinu, viz komentář u prompt níž) na JEDEN vodorovný řádek se
// všemi 9 (mezera mezi rodinami místo přeskoku na nový řádek) + přidány
// vodorovné referenční linky/pravítko po straně, ať jde výška vyčíst přímo
// z obrázku, ne jen z tištěného cm popisku pod postavou.
// v11 (2026-08-08): list se musí překreslit ze ZNOVU namalovaných portrétů
// (PORTRAIT_VERSION→5, jmenovaný zámek odstínů + Janova/Archieho nová fotka
// — viz komentář tam).
const FAMILY_SCALE_VERSION = 11;
// Duplikát CANONICAL_HEIGHT_CM z claude.ts (import by vytáhl celý claude.ts
// do knihovny portrétů) — mění se JEN spolu s tamní tabulkou, viz komentář tam.
// archie: 40cm — reálná výška při běžném postoji (upřesnil uživatel
// 2026-08-06), NE veterinární kohoutková míra; dřív appka Archieho na
// výškovém listu/kotvě vůbec neuváděla (bez cm ho filtr FAMILY_HEIGHT_CM
// vyřazoval).
const FAMILY_HEIGHT_CM: Record<string, number> = {
  valentyna: 96, nicolas: 111, james: 115, bella: 135,
  jana: 175, eva: 180, jakob: 183, jan: 185, archie: 40,
};

// 🩺 2026-08-06: appka NIKDE neměla zapsané, kdo je čí rodič/dítě — jen
// jednotlivé popisy postav. Skupinová kotva proto řadila lidi ČISTĚ podle
// výšky (viz FAMILY_HEIGHT_CM), a model bez vztahové informace naskládal
// dospělé/děti do dvou "rodinných" shluků NÁHODNĚ (Eva vyšla vedle
// Nicoláska/Jana místo Jany, Jana vedle James/Belly místo Evy) — vizuálně
// špatně spárované rodiny, nahlášeno uživatelem se skutečnou obrázkovou
// ukázkou. Dvě SKUTEČNÉ rodiny appky (potvrzeno uživatelem), Archie patří
// k rodině Jan+Jana+Nicolásek+Valentýnka (upřesnil uživatel):
const FAMILY_UNITS: Array<{ parents: string[]; children: string[]; pets?: string[] }> = [
  { parents: ["jan", "jana"], children: ["nicolas", "valentyna"], pets: ["archie"] },
  { parents: ["jakob", "eva"], children: ["james", "bella"] },
];

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
 *  a natrvalo se cachuje — bump FAMILY_SCALE_VERSION při změně cm/vzhledu.
 *  force=true (nová 2026-08-06 — chybělo, na rozdíl od getCharacterPortrait)
 *  přeskočí cache a namaluje znovu i na STEJNÉ verzované cestě — bez tohohle
 *  `?scale=redraw` tiše vracelo starý cachovaný obrázek (appka to zjistila
 *  živě: runtime logy neukázaly ŽÁDNÝ "drawing FAMILY scale sheet" řádek
 *  po promptové opravě, i když endpoint hlásil `drawn: true`). */
export async function getFamilyScaleSheet(force = false): Promise<ReferenceImage | null> {
  const key = `family-scale-v${FAMILY_SCALE_VERSION}`;
  const cached = !force && memCache.get(key);
  if (cached) return cached;
  const token = blobToken();
  if (!token) return null;
  const pathName = `portraits/${key}.img`;

  if (!force) try {
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
    // 🩺 2026-08-06: dřív řazeno ČISTĚ podle výšky napříč všemi — stejná
    // díra jako u skupinové kotvy (viz FAMILY_UNITS komentář), model bez
    // vztahové informace mohl postavit dvě rodiny vedle sebe špatně
    // spárované. groupAnchorCast() řadí PODLE RODINY (uvnitř rodiny podle
    // výšky) a od teď zahrnuje i Archieho (viz FAMILY_HEIGHT_CM.archie).
    const cast = groupAnchorCast();
    if (cast.length < 2) return null;
    const pets = petIds();
    const peopleCount = cast.filter(c => !pets.has(c.id)).length;
    console.log(`[portraits] drawing FAMILY scale sheet (${cast.map(c => c.id).join("+")})…`);
    // 🩺 2026-08-06: PŮVODNĚ appka řekla "one row", ale 9 lidí je na jeden
    // řádek moc, takže si model sám udělal DVA řádky — a Jana/Nicoláska
    // přitom vykreslil ZNOVU i do druhého řádku (duplicita napříč řádky).
    // Appka proto přešla na DVA VÝSLOVNÉ řádky (jeden per rodina).
    // v10 (2026-08-06, 13): uživatel po schválení kotvy chce zpátky JEDEN
    // řádek ("všechny vedle sebe") + výškové linky — appka teď řeší
    // duplicitní riziko jinak: širší plátno (16:9 místo výchozích 9:16) +
    // výslovný zákaz rozdělení na víc řádků + mezera v seznamu mezi
    // rodinami (ne nový řádek) pro vizuální oddělení, které appka předtím
    // řešila stackováním.
    const familyGroups = FAMILY_UNITS
      .map(unit => [...unit.children, ...unit.parents, ...(unit.pets ?? [])]
        .map(id => cast.find(c => c.id === id)?.name)
        .filter((n): n is string => !!n)
        .sort((a, b) => FAMILY_HEIGHT_CM[cast.find(c => c.name === a)!.id] - FAMILY_HEIGHT_CM[cast.find(c => c.name === b)!.id]))
      .filter(m => m.length > 0);
    const lineupOrder = familyGroups.map(m => m.join(", ")).join(" | [small visible gap] | ");
    const prompt = [
      `CHARACTER HEIGHT REFERENCE SHEET, all ${cast.length} individuals standing in ONE SINGLE HORIZONTAL ROW on the same ground line, side by side — do NOT split them into two rows or stack anyone above another, even though there are ${cast.length} of them; use a WIDE panoramic canvas so everyone fits comfortably in a single line. Left-to-right order: ${lineupOrder} — leave a small but clearly visible gap in the lineup exactly where the first family's list ends and the second begins, so the single row still visually reads as two families standing near each other, not one random crowd. Every person appears EXACTLY ONCE in the whole row.`,
      `Exact appearances (copy faithfully): ${cast.map(c => c.description).join(" | ")}.`,
      // 🩺 Stejná díra jako u portraitPrompt výš (viz komentář tam) — tenhle
      // list ale navíc nemá ani kontrolu (verifySceneImage), takže chybný
      // vzhled odsud šel rovnou do produkce jako "kotva" pro VŠECHNY scény.
      `If any description above explicitly states a feature is ABSENT or DIFFERENT from what would be typical (e.g. "NO dark mask", "NO stripe", a specific marking instead of the usual one for this breed/type), that is a DELIBERATE correction — draw it EXACTLY as stated even if it contradicts what is typical/generic. Do not default to a stereotypical look when a description explicitly rules it out.`,
      pets.size ? `SPECIFICALLY for the dog: the coat is a SOLID warm reddish-brown/tan color, essentially ONE solid color from a normal viewing distance — do NOT draw visible tiger-stripe or heavy brindle patterning across the body; that is the single most common mistake to avoid here.` : "",
      `Every human character FULL BODY head to toe, standing straight and relaxed facing the viewer; the dog on all fours, not standing upright. Every single foot/paw on the SAME flat ground line, evenly spaced, plain soft warm-cream background, even flat lighting, no props, no scenery.`,
      `Their real heights are EXACTLY: ${cast.map(c => `${c.name} ${FAMILY_HEIGHT_CM[c.id]}cm`).join(", ")} (for the dog, height means how tall it stands on all fours) — draw every body scaled precisely to these proportions relative to each other; this is the single most important requirement of this image.`,
      heightsRelationalEntry(cast),
      // 🩺 2026-08-06 (13): uživatel — "přidej výškové linky" — appka dřív
      // tenhle list kreslila BEZ žádných vizuálních vodicích čar, jen s
      // tištěným cm popiskem pod postavou; teď přidán skutečný vizuální
      // odměřovací prvek (jako výškový žebřík na zdi/policejní lineup), aby
      // šla výška vyčíst přímo z obrázku, ne jen z čísla v textu.
      `Draw a set of thin, evenly-spaced horizontal reference/guide lines running the FULL WIDTH of the image at regular height intervals (roughly every 20cm of height, like a growth-chart wall or a police lineup backdrop), so a viewer can see exactly how tall each character is by which line their head reaches. Add small, faint plain-text cm numbers (20, 40, 60, 80...) along the left edge next to each line. These measuring lines and numbers are a DELIBERATE exception to the book's normal no-text, no-props style — this is a private measuring reference for the illustrator, never a page a reader sees.`,
      `Directly BELOW each character, print their name in capital letters and their height in parentheses as two short lines of clean plain text (e.g. "NICOLÁSEK" then "(111CM)") — this is the OTHER exception in this whole book's art style where readable text is wanted, for the same reason as the ruler lines above.`,
      `Exactly ${peopleCount} people plus ${cast.length - peopleCount} dog in the WHOLE image — nobody else, no invented siblings or friends, no one repeated, everyone in the single row.`,
      REFERENCE_SHEET_STYLE,
    ].filter(Boolean).join(" ");
    // 🩺 2026-08-06: dřív loadReferenceImages(cast) — syrové FOTKY. Appka
    // ale KAŽDÉ nezávislé malování reinterpretuje fotku znovu od nuly, takže
    // i beze změny promptu vyšel třeba Jan pokaždé trochu jinak (nahlášeno:
    // "táta Jan vypadá zase trochu jinak"). Model má už namalovaný, natrvalo
    // uložený portrét KAŽDÉ postavy (getCharacterPortrait) — ten samý obrázek
    // appka posílá i do každé scény pohádky (loadPortraitRefs), takže je to
    // SKUTEČNÁ zamčená podoba. Výškový list/kotva teď kreslí ze stejného
    // zdroje místo fotek (chybějící portrét = tichý fallback na fotku, jako
    // v loadPortraitRefs) — příští překreslení by se mělo shodovat s tím,
    // jak postava vypadá ve skutečné pohádce.
    const photoRefs = await loadPortraitRefs(cast);
    const combinedDesc = cast.map(c => c.description).join(" | ");
    const sceneDesc = `A height reference sheet in a SINGLE ROW with EXACTLY these people and dog present ONCE EACH, nobody else, nobody repeated: ${cast.map(c => c.name).join(", ")}. Every one of these names IS in the picture exactly once; do not flag any of them as "missing" or "extra". COUNT the people and the dog separately: ${peopleCount} people + ${cast.length - peopleCount} dog, no more, no fewer. If the image shows more than one row, that is a MAJOR violation.`;
    const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
    // 🩺 2026-08-06 (13): širší plátno (16:9 místo výchozích 9:16 pro
    // generateBackgroundImage) — 9 postav v jednom vodorovném řádku se do
    // úzkého portrétového formátu nevejde, appka by tím model znovu tlačila
    // k neschválenému rozdělení na víc řádků.
    let img = await generateBackgroundImage(prompt, photoRefs, "16:9");
    // 🩺 Portrét jednotlivce se OD v3 kontroluje (viz getCharacterPortrait
    // výš — vadný portrét Belly se jinak stal referencí a chyba se
    // replikovala do všech pohádek); tenhle celorodinný list byl na kontrolu
    // dřív úplně slepý, přestože ho appka používá jako kotvu pro KAŽDOU
    // scénu, ne jen pro jednu postavu — chyba tu měla ještě větší dosah.
    let v = await verifySceneImage(apiKey, img, combinedDesc, sceneDesc, photoRefs);
    // 🩺 2026-08-06: živě zjištěno na TOMTO obrázku, že "2× zamítnuto → žádný
    // list" zahazovalo i fakticky správné pokusy — QA se protiřečila mezi
    // pokusy (jednou "flat vector/clipart", podruhé "soft painterly", jednou
    // dokonce označila SPRÁVNÝ styl jako MAJOR chybu). Stejná oprava jako u
    // getCharacterPortrait výš — drží se NEJLÉPE ověřený pokus a POUŽIJE se,
    // i nedokonalý, místo aby appka skončila úplně bez listu.
    let best = { img, badRules: v && !v.ok ? v.badRules : 0, problems: v?.problems || "" };
    if (v && !v.ok) {
      console.warn(`[portraits] family scale sheet REJECTED (${v.problems.slice(0, 140)}) → redraw with correction`);
      const img2 = await generateBackgroundImage(
        `${prompt} ⚠ CORRECTION: the previous attempt violated: ${v.problems.slice(0, 300)}. Follow every description EXACTLY (hair color, skin tone, markings, clothing).`,
        photoRefs,
        "16:9"
      );
      const v2 = await verifySceneImage(apiKey, img2, combinedDesc, sceneDesc, photoRefs);
      if (v2 && (v2.ok || v2.badRules < best.badRules)) {
        best = { img: img2, badRules: v2.ok ? 0 : v2.badRules, problems: v2.problems };
      }
      if (best.badRules > 0) console.warn(`[portraits] family scale sheet still imperfect [${best.badRules}] (${best.problems}) → using best available attempt`);
      else console.log(`[portraits] family scale sheet fixed ✓`);
    }
    img = best.img;
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

/** Veřejná URL výškového listu (pro náhled), null když ještě není namalovaný. */
export async function familyScaleSheetUrl(): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try {
    const h = await head(`portraits/family-scale-v${FAMILY_SCALE_VERSION}.img`, { token });
    return h.url;
  } catch {
    return null;
  }
}

// ── 🖼️ SKUPINOVÁ KOTVA — jeden obrázek CELÉ rodiny pohromadě v PŘÍBĚHOVÉ
// (ne referenční) kompozici, viz ECONOMY-PLAN.md Fáze 2. Na rozdíl od
// getFamilyScaleSheet výš (klinický řádek vedle sebe, se jmény+cm popisky,
// text VÝJIMEČNĚ povolený) je tohle normální stránková ilustrace appky —
// ŽÁDNÝ text, přirozené seskupení jako na rodinné fotce — a slouží jako
// DALŠÍ reference vedle jednotlivých portrétů: model tak vidí, jak rodina
// vypadá POHROMADĚ v appčině stylu (ne jen izolovaně jeden po druhém),
// což by mělo snížit počet zamítnutí kontrolou u vícepostavových scén.
// Kreslí se JEDNOU CELKOVĚ (ne na pohádku) a natrvalo se cachuje — bump
// GROUP_ANCHOR_VERSION při změně vzhledu/výšek rodiny.
// v2: v1 kreslila na výšku (9:16) vlastním PORTRAIT_STYLE textem — appka
// SKUTEČNÉ stránky pohádky kreslí na šířku (16:9) sdíleným STYLE_SUFFIX
// (lib/gemini.ts), který má navíc "cinematic"/"expressive faces" apod. —
// v1 proto vizuálně neseděla se skutečným stylem appky (nahlášeno uživatelem
// se skutečnými ukázkami stránek). v2 používá stejný STYLE_SUFFIX i stejný
// poměr stran jako opravdové scény.
// v3 (2026-08-06): Valentýnka 85→90cm — kotva se musí překreslit se správným poměrem.
// v4 (2026-08-06, 2): 90→96cm — uživatel po zhlédnutí v2 obrázku: "ještě Vája
// trochu větší, Nicolaskovi po ramena a jsme tam. Ostatní neměnit" — jen
// výška Valentýnky se posouvá (viz FAMILY_HEIGHT_CM výš), nic dalšího v
// promptu (rodinné seskupení, prostředí, styl) se v tomhle kroku nemění.
// v5 (2026-08-06, 3): reference se přepnuly ze syrových FOTEK na NATRVALO
// ULOŽENÉ malované portréty (loadPortraitRefs) — uživatel nahlásil "táta Jan
// vypadá zase trochu jinak" i beze změny promptu (appka fotku při každém
// nezávislém kreslení reinterpretuje znovu, na rozdíl od jednou namalovaného
// a natrvalo cachovaného portrétu, co appka i tak posílá do KAŽDÉ scény
// pohádky — kotva teď kreslí ze stejného zdroje = "zamčená" podoba).
// Zároveň drobná úprava popisu: Valentýnka hnědé→hnědo-zelené (hazel) oči,
// Eva hnědé→hnědo-blond vlasy.
// v6 (2026-08-06, 4): uživatel nahlásil vymyšlenou dívku navíc (hnědé vlasy,
// žluté šaty) stojící v mezeře mezi oběma rodinami na v5 obrázku — appčina
// kontrola ji přehlédla DVAKRÁT v řadě (viz komentář u sceneDesc níž).
// Posílena instrukce (explicitní "spočítej hlavy naposledy" + QA cíleně
// hlídá mezeru mezi shluky) + Archieho relační věta upřesněna na "do pasu
// Váji, lehce nad kolena Nicoláska" (uživatelova reálná data).
// v7 (2026-08-06, 5): stejná dávka oprav jako FAMILY_SCALE_VERSION v8 výš —
// Archie "stále je gigantický" i po v6, chyběl mu bílý flek na čele a
// srdíčkový tvar hrudní skvrny (characters.json rozšířeno), James vyšel
// neúměrně velký vedle Belly/dospělých (nová samostatná relační věta).
// v8 (2026-08-06, 6): uživatel — "sundej Archiemu srdíčko z hrudi a lehce ho
// zmenši, aby byl Valentýnce po pás a jsme tam" — srdíčko zrušeno zpět na
// obyčejný bílý flek, poměr doladěn o poslední kousek dolů.
// v9 (2026-08-06, 12-13) FINÁLNÍ: po sérii kandidátních testů (7)-(12)
// uživatel potvrdil ("Konečně!!") kombinaci Archie -15 % (kotví na
// Nicoláskovi, půlka mezi pasem a kolenem), Vája +10 % (~95 % Nicoláskovy
// výšky), James zřetelně vyšší než Nicolásek. Tahle verze POVYŠUJE přesně
// ten schválený kandidátní obrázek (promoteFamilyGroupAnchorCandidate) —
// žádné nové (placené) kreslení, jen kopie už schválených bajtů.
// v10 (2026-08-08): kotva se musí překreslit ze ZNOVU namalovaných portrétů
// (PORTRAIT_VERSION→5) — jmenovaný zámek odstínů vlasů pro celou rodinu +
// Janova/Archieho nová referenční fotka, viz komentář u PORTRAIT_VERSION.
const GROUP_ANCHOR_VERSION = 10;

function groupAnchorLabel(): string {
  return (
    "CANONICAL FAMILY GROUP REFERENCE — shows the whole family standing together naturally, in this book's exact art style, with correct relative body-size proportions between them. " +
    "Use it to match how these characters look and scale WHEN SEEN TOGETHER in a scene — same hair colors, faces, outfits and relative heights as here. " +
    "IGNORE any person in this reference who is NOT named in this scene's cast — they are shown here only for style/scale reference, they are not present in the scene."
  );
}

/** Obsazení skupinové kotvy/výškového listu — postavy appka zná s přesným cm,
 *  seřazené PODLE RODINY (viz FAMILY_UNITS), uvnitř rodiny od nejmenší po
 *  největší. Sdíleno mezi kandidáty i finální kotvou.
 *  🩺 2026-08-06: PŮVODNĚ řazeno čistě podle výšky napříč VŠEMI — bez
 *  vztahové informace to model poskládal do dvou vizuálních shluků náhodně
 *  (Eva vyšla vedle Nicoláska/Jana, Jana vedle James/Belly — obě špatně,
 *  viz komentář u FAMILY_UNITS). Řazení podle rodiny dá modelu ke
 *  správnému seskupení i pořadí v promptu, ne jen text instrukci. */
function groupAnchorCast(): Character[] {
  const all = loadCharacters().filter(c => FAMILY_HEIGHT_CM[c.id] !== undefined);
  const byId = new Map(all.map(c => [c.id, c]));
  const used = new Set<string>();
  const out: Character[] = [];
  for (const unit of FAMILY_UNITS) {
    const members = [...unit.children, ...unit.parents, ...(unit.pets ?? [])]
      .map(id => byId.get(id))
      .filter((c): c is Character => !!c)
      .sort((a, b) => FAMILY_HEIGHT_CM[a.id] - FAMILY_HEIGHT_CM[b.id]);
    for (const m of members) { out.push(m); used.add(m.id); }
  }
  // Postavy se známým cm, ale MIMO obě rodinné jednotky (dnes žádné,
  // pojistka pro budoucí rozšíření kartotéky) — připojit na konec.
  for (const c of all) if (!used.has(c.id)) out.push(c);
  return out;
}

/** Relační výškové věty ("sahá mu po ramena") pro model — ŽIVÝ TEST ukázal,
 *  že appka dřív posílala jen holá cm čísla (`Their real heights are
 *  EXACTLY: X cm, Y cm…`), a model z toho geometrii nezměřil: Valentýnka
 *  vyšla vizuálně moc malá vůči Nicoláskovi a Nicolásek vyšel VĚTŠÍ než
 *  James, i když čísla pod obrázkem byla správná (nahlášeno uživatelem,
 *  živý test). Zrcadlí STEJNOU logiku, jakou appka už měla v
 *  canonicalHeightsEntry (lib/claude.ts, používá se při psaní scénáře) —
 *  NEIMPORTUJE se odsud přímo (vytáhlo by to celý claude.ts do knihovny
 *  portrétů, viz komentář u FAMILY_HEIGHT_CM výš), jde o záměrnou paralelní
 *  kopii, co se mění spolu s tamní verzí. */
function heightsRelationalEntry(cast: Character[]): string {
  const ids = new Set(cast.map(c => c.id));
  const byId = new Map(cast.map(c => [c.id, c]));
  const name = (id: string) => byId.get(id)?.name ?? id;
  const bits: string[] = [];
  // 🩺 2026-08-06 (12): uživatel — "zvětši Jamese, ten je o něco [vyšší] než
  // Nicolas (James 115cm, Nicolas 111cm)" — dosavadní věta evidentně
  // nevyšla dost výrazně (jen 4cm reálný rozdíl appka poučeně neposílá
  // jako holé číslo, viz komentář výš u FAMILY_HEIGHT_CM, ale slovní vazba
  // "little taller/only to forehead" zjevně nestačila). Zesíleno na
  // "half a head" + explicitní varování proti stejné výšce.
  if (ids.has("nicolas") && ids.has("james")) {
    bits.push(`${name("james")} is noticeably taller than ${name("nicolas")} — by about HALF A HEAD, not just a little. The top of ${name("nicolas")}'s head reaches only to ${name("james")}'s forehead or eyebrows, NOT his ears or eyes. If they look almost the same height, ${name("james")} has been drawn too short and must be enlarged`);
  }
  // 🩺 2026-08-06 (10): živý kandidát (top-of-head-waistband Archie test)
  // vyšel s Vájou nečekaně MALOU vůči Nicoláskovi — uživatel: "zase je
  // miniaturní Vája, zvětši ji na úroveň Nicolasových ramen, bez toho aby
  // hýbal Archiem". Archieho text se NEMĚNÍ (jen tenhle). Přidán konkrétní
  // oděvní orientační bod (límec/rameno trička) po vzoru Archieho pasu +
  // výslovné varování proti podkreslení (zrcadlí Archieho "too big" varování).
  // 🩺 2026-08-06 (12b): uživatel — "Váju o 10% zvětši" (nad rámec (10)
  // výš, poté co zafixovali velikost pro srovnání) — poměr posunut ze
  // ~85-90 % na ~95 % Nicoláskovy výšky: teď sahá skoro k jeho OČÍM/UŠÍM,
  // ne jen k ramenům.
  if (ids.has("valentyna") && ids.has("nicolas")) {
    bits.push(`${name("valentyna")} is only barely shorter than ${name("nicolas")} — the top of her head reaches almost all the way up to his EYES or EARS, well above his shoulders, roughly 95% of his height. She is a toddler but stands nearly as tall as him now — do NOT draw her only shoulder-height or lower, that is too small; if her head only reaches his shoulders or chest, she has been drawn too SMALL and must be enlarged further`);
  }
  if (ids.has("bella")) {
    const anchors = ["james", "nicolas"].filter(id => ids.has(id)).map(name);
    if (anchors.length) bits.push(`${name("bella")} is about half a head taller than ${anchors.join(" and ")}`);
  }
  // 🩺 2026-08-06 (5): nahlášeno přímo na výškovém listu — "James se
  // neúměrně zvětšil" (v řádku 2 vedle Belly/dospělých vyšel nepřiměřeně
  // velký). Dřívější věta ("Bella je o půl hlavy vyšší") byla jen jedním
  // směrem (Bella vůči Jamesovi) — přidána i explicitní věta OPAČNĚ
  // (James vůči dospělým), ať appka dostane oba směry, ne jen jeden.
  if (ids.has("james") && (ids.has("eva") || ids.has("jakob"))) {
    const adultAnchors = ["eva", "jakob"].filter(id => ids.has(id)).map(name);
    bits.push(`${name("james")} is a school-age CHILD, clearly much shorter than ${adultAnchors.join(" and ")} — his head reaches only to about their chest/upper ribs, nowhere near their shoulders`);
  }
  const anyAdult = ["jan", "jana", "eva", "jakob"].some(id => ids.has(id));
  const anyChild = ["nicolas", "valentyna", "james", "bella"].some(id => ids.has(id));
  if (anyAdult && anyChild) bits.push("all the adults are much taller than the children");
  // 🩺 2026-08-06 (4): upřesnil uživatel přímo — "do pasu Váji a lehce nad
  // kolena Nicoláska" (ne "koleno až bok", to bylo appčino vlastní odhadnuté
  // přirovnání, ne reálný údaj).
  // 🩺 2026-08-06 (5): nahlášeno "stále je gigantický" i po předchozí opravě
  // — textová relace sama nestačila. Zesíleno na explicitní kontrast +
  // varování před obvyklou chybou (ilustrace psy běžně kreslí většího kvůli
  // "roztomilosti") a instrukci radši ho podkreslit, než překreslit.
  // 🩺 2026-08-06 (6): živý výsledek už byl BLÍZKO (appka odhadla "waist"),
  // uživatel žádal už jen jemné doladění dolů ("lehce ho zmenši, aby byl
  // Valentýnce po pás a jsme tam") — ne další drastickou opravu.
  // 🩺 2026-08-06 (7) EXPERIMENT — uživatel chce srovnat variantu, kde k
  // pasu Váji sahá Archieho HLAVA (temeno/uši), ne rameno — to je MENŠÍ pes
  // než v8 (hlava psa na všech čtyřech bývá výš než rameno/kohoutek). Zatím
  // JEN kandidátní test (?anchor=candidates), NEpřepisuje kanonickou v8/v9 —
  // podle uživatelova rozhodnutí buď tahle věta zůstane a appka to zafixuje
  // (bump verzí), nebo se vrátí zpět na "shoulder reaches waistline".
  // 🩺 2026-08-06 (8) EXPERIMENT pokračuje — uživatel chce ještě menšího:
  // "výška Archieho uší bude na úrovni Nicoláskova pasu" — nový PRIMÁRNÍ
  // ukotvující bod je teď Nicolásek (ne Vája), a je to uši, ne temeno hlavy.
  // Pořád jen kandidátní test, kanonická v8/v9 nedotčená.
  // 🩺 2026-08-06 (9) EXPERIMENT — živý výsledek (8) vyšel pořád moc velký
  // (uši sahaly spíš k hrudi/žebrům, ne k pasu) — uživatel to potvrdil a
  // vyjasnil (AskUserQuestion): CHTĚNÝ stav je "menší pes — pas u OBOU"
  // (Váje i Nicoláskovi stejně, ne dva různé nesouměřitelné body). Abstraktní
  // tělní popis evidentně nestačí, tak přidán KONKRÉTNÍ oděvní orientační
  // bod (pas kalhot/šatů), který model může vizuálně sledovat.
  // 🩺 2026-08-06 (9b): uživatel upřesnil PŘESNĚ CO měří — "vrchol hlavy
  // Archieho, ne jeho záda" (TOP OF HEAD/skull, ne ramena/kohoutek jako
  // dřív, a ne "uši" — uši nastražené vzhůru by mohly měřit výš než
  // samotná lebka a appka by tím dostala nejednoznačnou instrukci).
  // 🩺 2026-08-06 (12c): uživatel — "stále je Archie moc velký, zmenši ho o
  // 15%" — i cílený "waistband" test vyšel podle uživatele pořád moc velký.
  // Ukotvující bod posunut NÍŽ než pas: na půlku mezi pasem a kolenem
  // (odhad -15 % velikosti), s výslovným zákazem dosáhnout byť jen na pas.
  if (ids.has("archie") && ids.has("nicolas")) {
    bits.push(`${name("archie")} is small — the TOP OF HIS HEAD (the skull/crown, his highest point standing on all fours — NOT his ears if they stick up higher, and NOT his back/shoulder which is much lower) must reach only to the MIDPOINT between the WAISTBAND and the KNEE of ${name("nicolas")}'s shorts — roughly mid-thigh height, clearly BELOW the waistband, not at it. If the top of his head reaches the waistband line or higher, he has been drawn too big and must be shrunk further; his back/shoulder sits even lower than that, close to the knee itself`);
  }
  // 🩺 2026-08-06 (11): uživatel nahlásil, že Archie "se zvětšil s Vájou" —
  // předchozí věta kotvila jeho velikost i na Váji ("waist seam of her
  // dress"), takže když appka zvětšila JI (viz oprava (10) výš), model
  // zvětšil NEZÁMĚRNĚ i jeho, aby dorovnal její nový (vyšší) pas. Uživatel
  // výslovně žádal "rozpoj spojení velikosti Váji a Archieka" — jeho
  // velikost teď určuje VÝHRADNĚ Nicolásek (věta výš), tahle věta jen
  // vysvětluje, kam tím pádem u Váji vyjde (důsledek, ne cíl), a explicitně
  // zakazuje modelu dotahovat ho na její vlastní výšku.
  if (ids.has("archie") && ids.has("valentyna")) {
    bits.push(`${name("archie")}'s size is set ONLY by the ${name("nicolas")} comparison above — it must NOT also be scaled to match ${name("valentyna")}'s height. Whatever point on her body the top of his head ends up reaching (likely somewhere around her lower ribs or hip, now that she stands nearly as tall as ${name("nicolas")} while he stays small) is simply the correct RESULT of his fixed size next to Nicolásek — it is not a separate target to aim for, and her height must never be used to make him bigger`);
  }
  return bits.length ? bits.join("; ") + "." : "";
}

/** Set ID mazlíčků napříč FAMILY_UNITS — použito, kde appka potřebuje
 *  rozlišit "lidi" od "mazlíčky" (počítání osob, popis "N people"). */
function petIds(): Set<string> {
  return new Set(FAMILY_UNITS.flatMap(u => u.pets ?? []));
}

/** Sdílená věta popisující DVĚ rodinné jednotky (kdo je čí rodič/dítě/pes) —
 *  appka nikde neměla zapsané vztahy (viz FAMILY_UNITS výš), takže bez
 *  tohohle textu model rodiny skládal ŠPATNĚ (nahlášeno uživatelem se
 *  skutečnou obrázkovou ukázkou). Používá skupinová kotva i výškový list. */
function familyGroupSentence(cast: Character[]): string {
  const byId = new Map(cast.map(c => [c.id, c]));
  const groups = FAMILY_UNITS
    .map(unit => {
      const parents = unit.parents.map(id => byId.get(id)?.name).filter((n): n is string => !!n);
      const children = unit.children.map(id => byId.get(id)?.name).filter((n): n is string => !!n);
      const petNames = (unit.pets ?? []).map(id => byId.get(id)?.name).filter((n): n is string => !!n);
      if (!parents.length || !children.length) return null;
      const petBit = petNames.length ? `, along with their dog ${petNames.join(" and ")}` : "";
      return `${parents.join(" and ")} are a couple; ${children.join(" and ")} are THEIR children${petBit} — this family stands together as one visual cluster`;
    })
    .filter((s): s is string => !!s);
  return groups.length ? `There are TWO separate families here, grouped together (not mixed): ${groups.join(". ")}.` : "";
}

/** Prompt skupinové kotvy — `setting` popisuje prostředí/kompozici (mění se
 *  mezi kandidátními variantami), zbytek (obsazení, výšky, styl appky) je
 *  vždy stejný. Používá STEJNÝ STYLE_SUFFIX jako skutečné stránky pohádky
 *  (lib/gemini.ts) — ne vlastní kopii, ať appka vizuálně nedriftuje. */
function groupAnchorPrompt(cast: Character[], setting: string): string {
  const pets = petIds();
  const numbered = cast.map((c, i) => `${i + 1}) ${c.name}${pets.has(c.id) ? " (the family dog)" : ""}`).join(", ");
  const peopleCount = cast.filter(c => !pets.has(c.id)).length;
  const familyGroups = familyGroupSentence(cast);
  return [
    `A single storybook illustration of ${cast.map(c => c.name).join(", ")} together — ${setting}`,
    familyGroups
      ? `${familyGroups} They stand as two adjacent clusters (not mixed together), each family close together, facing the viewer with natural friendly smiles. A child (or pet) must stand near THEIR OWN family, never near the other family's members.`
      : `Everyone facing the viewer with natural friendly smiles, arranged in a natural cluster (not a strict line): the two adults side by side near the back, the children grouped in front of or beside them, all standing close together as a real family would.`,
    `Exact appearances (copy faithfully): ${cast.map(c => c.description).join(" | ")}.`,
    `If any description above explicitly states a feature is ABSENT or DIFFERENT from what would be typical (e.g. "NO dark mask", "NO stripe", a specific marking instead of the usual one for this breed/type), that is a DELIBERATE correction — draw it EXACTLY as stated even if it contradicts what is typical/generic. Do not default to a stereotypical look when a description explicitly rules it out.`,
    `Every human character FULL BODY, head to toe, standing on the SAME ground line; the dog on all fours on the same ground line, not standing upright.`,
    `Their real heights are EXACTLY: ${cast.map(c => `${c.name} ${FAMILY_HEIGHT_CM[c.id]}cm`).join(", ")} (for the dog, height means how tall it stands on all fours, not a human comparison pose) — draw every body scaled precisely to these proportions relative to each other; this is the single most important requirement of this image.`,
    // 🩺 2026-08-06 (2): živý test (výškový list) ukázal, že appka posílala
    // jen holá cm čísla, model geometrii z čísel nezměřil — Valentýnka
    // vyšla moc malá a Nicolásek vyšel VĚTŠÍ než James, přestože čísla pod
    // obrázky byla správná (nahlášeno uživatelem). Relační věty ("sahá mu
    // po ramena") appka jinde už používá (canonicalHeightsEntry, claude.ts)
    // — heightsRelationalEntry je stejná logika, jen lokální kopie.
    heightsRelationalEntry(cast),
    // 🩺 2026-08-06: první živý test (kandidát "obývák") vygeneroval 9 lidí
    // místo 8 — model si sám přidal vymyšlené dítě navíc, které navíc
    // vzhledem splývalo s Nicoláskem ("dva Nicoláskové"). Bez konkrétního
    // vyjmenovaného seznamu appka jen řekla "přesně N lidí", bez toho, ať si
    // model VÝSLOVNĚ spočítá, koho vlastně kreslí.
    `The cast is EXACTLY these ${cast.length} individuals (${peopleCount} people + ${cast.length - peopleCount} dog) and NO ONE else — count them as you draw: ${numbered}. Do NOT invent, add, or duplicate any additional sibling, friend, cousin, pet, or background child/adult — if you are tempted to add anyone not on this numbered list, leave that space empty instead. Each of the ${peopleCount} people above must be a CLEARLY DIFFERENT, DISTINCT individual — no two people (especially the children) may share the same face, hairstyle silhouette, or look like copies of one another; their described hair color, hairstyle and outfit are what tells them apart, follow those exactly per name.`,
    // 🩺 2026-08-06 (4): stejná chyba se vrátila v jiné podobě — appčina
    // vlastní kontrola dvakrát v řadě přehlédla neohlášenou DÍVKU NAVÍC
    // (hnědé vlasy, žluté šaty) stojící v mezeře mezi oběma rodinami; ani
    // jeden ze 2 pokusů to nenahlásil jako nález, i když jiné (falešné)
    // nálezy hlásily hojně (nahlášeno uživatelem přímo na hotovém obrázku).
    // Explicitní "spočítej hlavy naposledy" instrukce navíc, cílená přesně
    // na mezeru mezi shluky, kde k tomu došlo.
    `BEFORE YOU FINISH, do one final headcount check: count every human head in the image, left to right. The total must be EXACTLY ${peopleCount} — not ${peopleCount + 1}, not ${peopleCount - 1}. Pay special attention to the empty space BETWEEN the two family clusters — that gap must stay EMPTY, nobody (no extra child, no extra adult, in any outfit or hair color) may stand there or anywhere else outside the ${numbered} you were given.`,
    STYLE_SUFFIX,
  ].filter(Boolean).join(" ");
}

/** Namaluje + ověří (s jedním opravným pokusem) jeden kandidát skupinové
 *  kotvy pro dané `setting`. Drží NEJLÉPE ověřený ze dvou pokusů a ten vrátí
 *  (viz komentář u "best" níž) — nikdy nezahazuje jen kvůli QA nesouhlasu. */
async function drawGroupAnchorCandidate(cast: Character[], setting: string): Promise<ImageResult | null> {
  const prompt = groupAnchorPrompt(cast, setting);
  // 🩺 2026-08-06: dřív loadReferenceImages(cast) — syrové FOTKY, které appka
  // při KAŽDÉM nezávislém malování reinterpretuje znovu od nuly (proto
  // "táta Jan vypadá zase trochu jinak" i beze změny promptu). Kreslí se
  // teď ze stejného zdroje jako skutečné scény pohádky (loadPortraitRefs —
  // natrvalo uložený malovaný portrét, chybějící = tichý fallback na fotku).
  const photoRefs = await loadPortraitRefs(cast);
  const combinedDesc = cast.map(c => c.description).join(" | ");
  const pets = petIds();
  const peopleCount = cast.filter(c => !pets.has(c.id)).length;
  const dogCount = cast.length - peopleCount;
  // 🩺 sceneDesc jde do appčiny vizuální kontroly (verifySceneImage) — bez
  // výslovného počtu appka nepoznala, že model přidal 9. postavu navíc
  // (viz komentář u groupAnchorPrompt), obrázek prošel bez povšimnutí.
  // 🩺 2026-08-06 (4): tahle kontrola vymyšlené dítě přehlédla DVAKRÁT v řadě
  // (appka pak "nejlepší ze 2 pokusů" i tak uložila, protože jiné, SKUTEČNÉ
  // nálezy v obou pokusech ukázaly méně chyb jinde) — nahlášeno uživatelem
  // přímo na hotovém obrázku ("přibyla holčička ve žlutých šatech... to je
  // kdo?"). Posíleno na explicitní instrukci počítat hlavy JEDNU PO DRUHÉ a
  // jmenovitě volá pozornost na mezeru mezi oběma rodinnými shluky.
  const sceneDesc = `A family-portrait style illustration with EXACTLY ${peopleCount} people${dogCount ? ` and ${dogCount} dog` : ""} — ${cast.map(c => c.name).join(", ")} — together, ${setting}. COUNT the people (and the dog, separately) in the image ONE HEAD AT A TIME, left to right, and match each to a name on this list: ${cast.map(c => c.name).join(", ")}. If the people-count or dog-count is off, or if any two people (especially children) look like duplicates of each other, or if there is ANY person standing in the image — including in the gap between the two family clusters — who does not match one of these names, that is a MAJOR violation on rule 1, even if every named person is also correctly present.`;
  const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
  let img = await generateBackgroundImage(prompt, photoRefs, "16:9");
  let v = await verifySceneImage(apiKey, img, combinedDesc, sceneDesc, photoRefs);
  // 🩺 2026-08-06: stejná oprava jako u portrétu/výškového listu výš — "2×
  // zamítnuto → žádný kandidát" zahazovalo i pokusy, co byly fakticky OK a QA
  // se jen protiřečila mezi koly. Drží se NEJLÉPE ověřený pokus a POUŽIJE se.
  let best = { img, badRules: v && !v.ok ? v.badRules : 0, problems: v?.problems || "" };
  if (v && !v.ok) {
    console.warn(`[portraits] group anchor candidate REJECTED (${v.problems.slice(0, 140)}) → redraw with correction`);
    const img2 = await generateBackgroundImage(
      `${prompt} ⚠ CORRECTION: the previous attempt violated: ${v.problems.slice(0, 300)}. Follow every description EXACTLY (hair color, skin tone, markings, clothing).`,
      photoRefs,
      "16:9"
    );
    const v2 = await verifySceneImage(apiKey, img2, combinedDesc, sceneDesc, photoRefs);
    if (v2 && (v2.ok || v2.badRules < best.badRules)) {
      best = { img: img2, badRules: v2.ok ? 0 : v2.badRules, problems: v2.problems };
    }
    if (best.badRules > 0) console.warn(`[portraits] group anchor candidate still imperfect [${best.badRules}] (${best.problems}) → using best available attempt`);
    else console.log(`[portraits] group anchor candidate fixed ✓`);
  }
  return best.img;
}

const CANDIDATE_SETTINGS = [
  "standing close together in their cozy living room, warm afternoon light through a window, a soft rug and a couch visible behind them",
  "standing together outdoors in a sunny meadow with soft green grass, a few flowers, and a gentle blue sky",
  "standing together on a sunny front porch/yard, warm golden-hour light, a bit of garden greenery around them",
];

/** Vygeneruje N kandidátních variant skupinové kotvy (default 3, různá
 *  prostředí, viz CANDIDATE_SETTINGS) a uloží je do Blobu na DOČASNÉ cesty
 *  (ne na finální cestu family-anchor-vN.img) — appka žádnou z nich
 *  nepoužívá jako referenci, dokud se ručně nepromuje přes
 *  promoteFamilyGroupAnchorCandidate. Vrací URL/stav každého kandidáta.
 *  `settingIndex` (volitelné): místo RŮZNÝCH prostředí vygeneruje N
 *  OPAKOVÁNÍ TÉHOŽ prostředí z CANDIDATE_SETTINGS[settingIndex] — pro
 *  ověření konzistence/opravy promptu na stejné kompozici. */
export async function generateFamilyGroupAnchorCandidates(count = 3, settingIndex?: number): Promise<Array<{ index: number; setting: string; url: string | null; ok: boolean }>> {
  const token = blobToken();
  if (!token) return [];
  const cast = groupAnchorCast();
  if (cast.length < 2) return [];
  const settings = settingIndex != null && CANDIDATE_SETTINGS[settingIndex]
    ? Array.from({ length: count }, () => CANDIDATE_SETTINGS[settingIndex])
    : CANDIDATE_SETTINGS.slice(0, count);
  const out: Array<{ index: number; setting: string; url: string | null; ok: boolean }> = [];
  for (let i = 0; i < settings.length; i++) {
    const setting = settings[i];
    console.log(`[portraits] drawing group anchor CANDIDATE ${i + 1}/${settings.length} (${cast.map(c => c.id).join("+")})…`);
    try {
      const img = await drawGroupAnchorCandidate(cast, setting);
      if (!img) {
        out.push({ index: i + 1, setting, url: null, ok: false });
        continue;
      }
      const pathName = `portraits/family-anchor-candidate-${i + 1}.img`;
      const { url } = await put(pathName, img.buffer, {
        access: "public",
        contentType: img.mimeType,
        token,
        addRandomSuffix: false,
        allowOverwrite: true,
        cacheControlMaxAge: 3600, // dočasné — kandidáti, ne finální kotva
      });
      out.push({ index: i + 1, setting, url, ok: true });
    } catch (e) {
      console.warn(`[portraits] group anchor candidate ${i + 1} failed: ${e instanceof Error ? e.message : e}`);
      out.push({ index: i + 1, setting, url: null, ok: false });
    }
  }
  return out;
}

/** Povýší už vygenerovaného kandidáta (viz generateFamilyGroupAnchorCandidates)
 *  na FINÁLNÍ skupinovou kotvu — zkopíruje jeho bajty na cestu, kterou appka
 *  skutečně čte (family-anchor-vN.img), BEZ nového (placeného) generování.
 *  Vrátí URL finální kotvy, nebo null když se kopie nepovede. */
export async function promoteFamilyGroupAnchorCandidate(index: number): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try {
    const h = await head(`portraits/family-anchor-candidate-${index}.img`, { token });
    const r = await fetch(h.url, { cache: "no-store" });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    const key = `family-anchor-v${GROUP_ANCHOR_VERSION}`;
    const { url } = await put(`portraits/${key}.img`, buf, {
      access: "public",
      contentType: h.contentType || "image/webp",
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    memCache.delete(key); // ať se příští getFamilyGroupAnchor() nevrátí ke staré in-memory kopii
    return url;
  } catch (e) {
    console.warn(`[portraits] promote candidate ${index} failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/** Malovaná skupinová kotva celé rodiny (jedna přirozená scéna, BEZ textu);
 *  null když se nepovede nebo chybí Blob úložiště. Používá stejné obsazení
 *  (a stejnou podmínku familyScaleSheetApplies) jako celorodinný výškový list.
 *  force=true — viz stejný komentář u getFamilyScaleSheet (chybělo, appka
 *  bez toho tiše vracela starý cachovaný obrázek na `?anchor=redraw`). */
export async function getFamilyGroupAnchor(force = false): Promise<ReferenceImage | null> {
  const key = `family-anchor-v${GROUP_ANCHOR_VERSION}`;
  const cached = !force && memCache.get(key);
  if (cached) return cached;
  const token = blobToken();
  if (!token) return null;
  const pathName = `portraits/${key}.img`;

  if (!force) try {
    const h = await head(pathName, { token });
    const r = await fetch(h.url, { cache: "force-cache" });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const ref: ReferenceImage = { data: buf.toString("base64"), mimeType: h.contentType || "image/webp", label: groupAnchorLabel() };
      memCache.set(key, ref);
      return ref;
    }
  } catch {}

  // Žádná kotva na Blobu ještě neexistuje: nabídni jednu z kandidátních
  // variant rovnou jako finální (zvolí se ta první ze seznamu) — appka
  // preferuje mít NĚJAKOU kotvu k dispozici nad žádnou; ruční review přes
  // generateFamilyGroupAnchorCandidates/promote zůstává lepší cestou, když
  // je čas si vybrat mezi variantami.
  try {
    const cast = groupAnchorCast();
    if (cast.length < 2) return null;
    console.log(`[portraits] drawing FAMILY GROUP anchor (${cast.map(c => c.id).join("+")})…`);
    const img = await drawGroupAnchorCandidate(cast, CANDIDATE_SETTINGS[0]);
    if (!img) return null; // radši žádná kotva než neověřená
    await put(pathName, img.buffer, {
      access: "public",
      contentType: img.mimeType,
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    const ref: ReferenceImage = { data: img.buffer.toString("base64"), mimeType: img.mimeType, label: groupAnchorLabel() };
    memCache.set(key, ref);
    return ref;
  } catch (e) {
    console.warn(`[portraits] family group anchor failed: ${e instanceof Error ? e.message : e}`);
    return null; // scény pojedou jako dřív, jen bez skupinové kotvy
  }
}

/** Veřejná URL skupinové kotvy (pro náhled), null když ještě není namalovaná. */
export async function familyGroupAnchorUrl(): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try {
    const h = await head(`portraits/family-anchor-v${GROUP_ANCHOR_VERSION}.img`, { token });
    return h.url;
  } catch {
    return null;
  }
}

// ── 🌙 Závěrečný obrázek titulky ("dobrou noc") — NA MÍRU obsazení TÉTO
// pohádky ─────────────────────────────────────────────────────────────────
// Uživatel: "NA konci chci melodii vice milou detskou, a jiný obrázek - S
// N + V (hlavnimi postavami co si uzivatel vybere)." Appka dřív ukazovala
// VŽDY stejný natvrdo uložený obrázek (public/bg-credits.png — Nicolásek +
// Valentýnka v posteli), bez ohledu na to, kdo v KONKRÉTNÍ pohádce vlastně
// vystupoval. Tahle funkce je obdoba skupinové kotvy (getFamilyGroupAnchor),
// jen pro LIBOVOLNOU podmnožinu vestavěných postav — appka cache podle
// setříděné množiny ID, takže běžné obsazení (typicky Nicolásek+Valentýnka)
// se namaluje jednou a pak už jen znovupoužije napříč VŠEMI budoucími
// pohádkami se stejným obsazením; vzácnější kombinace se zaplatí jen jednou
// při prvním výskytu. Vlastní (uživatelem zadané) postavy appka do tohohle
// obrázku NEKRESLÍ (nemají zamčený portrét, viz CLAUDE.md bod 3) — když
// zbydou 0 vestavěných postav, appka spadne zpět na statický obrázek.
const GOODNIGHT_SCENE_VERSION = 1;

function goodnightSceneCacheKey(ids: string[]): string {
  return [...ids].sort().join("-");
}

function goodnightScenePrompt(cast: Character[]): string {
  const pets = petIds();
  const kids = cast.filter(c => !pets.has(c.id));
  return [
    `A single cozy storybook illustration of ${cast.map(c => c.name).join(" and ")} all cuddled up together, fast asleep in one big comfy bed at night — soft moonlight streaming through a bedroom window, a warm little nightlight glowing, plush toys on a shelf, a patchwork quilt with little stars and moons.`,
    `Exact appearances (copy faithfully): ${cast.map(c => c.description).join(" | ")}.`,
    kids.length > 1
      ? `Everyone peacefully asleep, eyes closed, gentle sleepy smiles, snuggled close together under the same quilt.`
      : `Peacefully asleep, eyes closed, a gentle sleepy smile, snuggled under the quilt.`,
    pets.size && cast.some(c => pets.has(c.id)) ? `The dog is curled up asleep at the foot of the bed, not under the quilt.` : "",
    `The cast is EXACTLY these ${cast.length}: ${cast.map(c => c.name).join(", ")} — no one else, do not invent or add any extra person, sibling, friend or pet.`,
    `Portrait orientation, warm dim nighttime lighting, deep blues and soft gold — a tender, sweet goodnight scene, not scary or dark in mood.`,
    STYLE_SUFFIX,
  ].filter(Boolean).join(" ");
}

/** Namaluje/vrátí (z cache) závěrečný "dobrou noc" obrázek přesně pro
 *  obsazení `ids` (vestavěné postavy, setříděno = cache klíč). `force=true`
 *  přeskočí cache a namaluje znovu. Vrací null, když appka nemá ani jednu
 *  platnou vestavěnou postavu (appka pak spadne zpět na statický obrázek). */
export async function getGoodnightScene(ids: string[], force = false): Promise<ReferenceImage | null> {
  const cast = charactersByIds(ids);
  if (cast.length === 0) return null;
  const cacheKeySuffix = goodnightSceneCacheKey(cast.map(c => c.id));
  const key = `goodnight-v${GOODNIGHT_SCENE_VERSION}-${cacheKeySuffix}`;
  const cached = !force && memCache.get(key);
  if (cached) return cached;
  const token = blobToken();
  if (!token) return null;
  const pathName = `portraits/${key}.img`;

  if (!force) try {
    const h = await head(pathName, { token });
    const r = await fetch(h.url, { cache: "force-cache" });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const ref: ReferenceImage = { data: buf.toString("base64"), mimeType: h.contentType || "image/webp" };
      memCache.set(key, ref);
      return ref;
    }
  } catch {}

  try {
    console.log(`[portraits] drawing GOODNIGHT scene (${cast.map(c => c.id).join("+")})…`);
    const photoRefs = await loadPortraitRefs(cast);
    const prompt = goodnightScenePrompt(cast);
    const combinedDesc = cast.map(c => c.description).join(" | ");
    const sceneDesc = `A goodnight bedtime illustration with EXACTLY these ${cast.length} asleep in bed: ${cast.map(c => c.name).join(", ")}. No one else present.`;
    const apiKey = process.env.GEMINI_API_KEY?.trim() || "";
    let img = await generateBackgroundImage(prompt, photoRefs, "9:16");
    let v = await verifySceneImage(apiKey, img, combinedDesc, sceneDesc, photoRefs);
    let best = { img, badRules: v && !v.ok ? v.badRules : 0, problems: v?.problems || "" };
    if (v && !v.ok) {
      const img2 = await generateBackgroundImage(
        `${prompt} ⚠ CORRECTION: the previous attempt violated: ${v.problems.slice(0, 300)}. Follow every description EXACTLY.`,
        photoRefs, "9:16"
      );
      const v2 = await verifySceneImage(apiKey, img2, combinedDesc, sceneDesc, photoRefs);
      if (v2 && (v2.ok || v2.badRules < best.badRules)) best = { img: img2, badRules: v2.ok ? 0 : v2.badRules, problems: v2.problems };
    }
    await put(pathName, best.img.buffer, {
      access: "public", contentType: best.img.mimeType, token,
      addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31536000,
    });
    const ref: ReferenceImage = { data: best.img.buffer.toString("base64"), mimeType: best.img.mimeType };
    memCache.set(key, ref);
    return ref;
  } catch (e) {
    console.warn(`[portraits] goodnight scene failed: ${e instanceof Error ? e.message : e}`);
    return null; // appka spadne zpět na statický /bg-credits.png
  }
}

/** Veřejná URL závěrečného "dobrou noc" obrázku pro dané obsazení, null
 *  když ještě není namalovaný. */
export async function goodnightSceneUrl(ids: string[]): Promise<string | null> {
  const cast = charactersByIds(ids);
  if (cast.length === 0) return null;
  const token = blobToken();
  if (!token) return null;
  try {
    const key = `goodnight-v${GOODNIGHT_SCENE_VERSION}-${goodnightSceneCacheKey(cast.map(c => c.id))}`;
    const h = await head(`portraits/${key}.img`, { token });
    return h.url;
  } catch {
    return null;
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
