// 🧪 ECONOMY-PLAN.md Fáze 4B (mockup větev claude/economy-mockup, NEmerguje
// se do main bez živého ověření + tvého schválení) — JEDNO, natrvalo
// cachované pozadí NA TÉMA (16:9, na šířku, BEZ postav — ty do něj doplňuje
// zvlášť composeSceneOnBackground, lib/gemini.ts), znovupoužité napříč
// VŠEMI budoucími scénami a pohádkami stejného tématu.
//
// Na rozdíl od app/api/bg-image/route.ts (portrétová 9:16 dekorace domovské
// obrazovky appky, se dvěma dětmi zapečenýma NATRVALO přímo do obrázku) je
// tohle čistá krajina/interiér bez lidí — postavy KAŽDÉ konkrétní scény se
// do ní vkládají až za běhu, podle toho, kdo a co v dané chvíli dělá.
//
// Cenově: jedno pozadí na téma = jednorázová investice (~$0,067), amortizovaná
// napříč mnoha budoucími scénami/pohádkami stejného tématu — přesně stejná
// logika jako u zamčené knihovny postav (lib/portraits.ts), jen pro scenérii
// místo postav. Skutečná úspora appky je ale v MÍŘE ZAMÍTNUTÍ kontrolou (viz
// ECONOMY-PLAN.md 8.2) — samotná KOMPOZICE scény pořád stojí 1 obrázek/scénu.

import { put, head } from "@vercel/blob";
import { blobToken } from "./blob-token";
import { generateBackgroundImage, type ImageResult } from "./gemini";
import { bgSceneById } from "./backgrounds";

const STORY_BG_VERSION = 1;
const memCache = new Map<string, ImageResult>();

function pathFor(themeId: string): string {
  return `backgrounds/story-${themeId}-v${STORY_BG_VERSION}.img`;
}

/** Veřejná URL pozadí (pro náhled/debug), null když ještě není namalované. */
export async function storyBackgroundUrl(themeId: string): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try {
    const h = await head(pathFor(themeId), { token });
    return h.url;
  } catch {
    return null;
  }
}

/** Vrátí (z cache/Blobu, případně jednou namaluje) pozadí pro dané téma.
 *  force=true přeskočí cache a namaluje znovu (stejný vzor jako lib/portraits.ts). */
export async function getStoryBackground(themeId: string, force = false): Promise<ImageResult | null> {
  const scene = bgSceneById(themeId);
  if (!scene) return null;
  const key = `${themeId}-v${STORY_BG_VERSION}`;
  const cached = !force && memCache.get(key);
  if (cached) return cached;
  const token = blobToken();
  if (!token) return null;
  const pathName = pathFor(themeId);

  if (!force) try {
    const h = await head(pathName, { token });
    const r = await fetch(h.url, { cache: "force-cache" });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const img: ImageResult = { buffer: buf, mimeType: h.contentType || "image/webp" };
      memCache.set(key, img);
      return img;
    }
  } catch {}

  try {
    console.log(`[story-bg] 🧪 drawing STORY background for theme "${themeId}"…`);
    // scene.prompt je BEZ postav (appka je vkládá až za scénu) — na rozdíl
    // od app/api/bg-image/route.ts, který dřív do stejného promptu přidával
    // KIDS_SUFFIX (Nicolásek+Valentýnka zapečení natrvalo). 16:9 místo 9:16
    // appčiny domovské dekorace — musí sedět na skutečné rozvržení stránky.
    const img = await generateBackgroundImage(scene.prompt, [], "16:9");
    await put(pathName, img.buffer, {
      access: "public",
      contentType: img.mimeType,
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    memCache.set(key, img);
    return img;
  } catch (e) {
    console.warn(`[story-bg] theme "${themeId}" failed: ${e instanceof Error ? e.message : e}`);
    return null; // scéna spadne zpátky na normální čerstvé generování
  }
}
