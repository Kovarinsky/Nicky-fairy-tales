// 🧪 ECONOMY-PLAN.md Fáze 4B (mockup větev claude/economy-mockup, NEmerguje
// se do main bez živého ověření + tvého schválení) — JEDNO, natrvalo
// cachované pozadí (16:9, na šířku, BEZ postav — ty do něj doplňuje zvlášť
// composeSceneOnBackground, lib/gemini.ts), znovupoužité napříč scénami
// jedné pohádky (a napříč BUDOUCÍMI pohádkami se stejným/podobným
// nastavením děje — viz cacheKey níž).
//
// v2 (2026-08-06) OPRAVA: v1 kreslila pozadí podle appčina OBECNÉHO
// franšízového tématu (lib/backgrounds.ts THEME_BG, "les" = appčina
// domovská dekorace — tmavý KOUZELNÝ les s měsícem/světluškami). Živý test
// ukázal reálnou chybu: appka pro Krtečkovskou pohádku napsala do
// "World & setting lock" slunečnou dennní louku BEZ kouzel, ale appka
// KAŽDOU jinou scénu (1-6) kreslila na tmavém kouzelném nočním pozadí —
// scéna 0 (čerstvá, podle skutečného zadání) a scény 1+ (na znovupoužitém
// pozadí) si viditelně odporovaly. Appka teď pozadí kreslí PODLE
// KONKRÉTNÍHO "World & setting lock" textu, který si Claude sám napsal
// PRO TUHLE pohádku (viz extractSettingLock, lib/job-runner.ts) — ne podle
// obecné appčiny "světové" dekorace. Cache klíč je hash TOHOTO textu, takže
// dvě pohádky se STEJNÝM/podobným settingem (např. stejná rodina, stejné
// oblíbené prostředí) pozadí sdílejí; jinak appka namaluje nové.
//
// Na rozdíl od app/api/bg-image/route.ts (portrétová 9:16 dekorace domovské
// obrazovky appky, se dvěma dětmi zapečenýma NATRVALO přímo do obrázku) je
// tohle čistá krajina/interiér bez lidí — postavy KAŽDÉ konkrétní scény se
// do ní vkládají až za běhu, podle toho, kdo a co v dané chvíli dělá.
//
// Cenově: jedno pozadí = jednorázová investice (~$0,067) na CELOU pohádku
// (a případně další pohádky se stejným settingem) — přesně stejná logika
// jako u zamčené knihovny postav (lib/portraits.ts), jen pro scenérii
// místo postav. Skutečná úspora appky je ale v MÍŘE ZAMÍTNUTÍ kontrolou (viz
// ECONOMY-PLAN.md 8.2) — samotná KOMPOZICE scény pořád stojí 1 obrázek/scénu.

import { put, head } from "@vercel/blob";
import { createHash } from "crypto";
import { blobToken } from "./blob-token";
import { generateBackgroundImage, type ImageResult } from "./gemini";

const STORY_BG_VERSION = 2;
const memCache = new Map<string, ImageResult>();

/** Krátký stabilní hash textu settingu — appka ho používá jako cache klíč,
 *  ať appka dvě pohádky se STEJNÝM settingem (stejný text) nemaluje dvakrát. */
export function settingCacheKey(settingText: string): string {
  return createHash("sha1").update(settingText.trim().toLowerCase()).digest("hex").slice(0, 16);
}

function pathFor(key: string): string {
  return `backgrounds/story-${key}-v${STORY_BG_VERSION}.img`;
}

/** Veřejná URL pozadí (pro náhled/debug), null když ještě není namalované. */
export async function storyBackgroundUrl(key: string): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  try {
    const h = await head(pathFor(key), { token });
    return h.url;
  } catch {
    return null;
  }
}

/** Vrátí (z cache/Blobu, případně jednou namaluje) pozadí PRO DANÝ SETTING.
 *  `prompt` je appkou sestavený popis scenérie (viz buildSettingPrompt níž
 *  nebo přímo Claudův "World & setting lock" text) — appka ho maluje jen
 *  jednou pod klíčem `key` (viz settingCacheKey). force=true přeskočí cache
 *  a namaluje znovu (stejný vzor jako lib/portraits.ts). */
export async function getStoryBackground(key: string, prompt: string, force = false): Promise<ImageResult | null> {
  if (!prompt.trim()) return null;
  const cacheKey = `${key}-v${STORY_BG_VERSION}`;
  const cached = !force && memCache.get(cacheKey);
  if (cached) return cached;
  const token = blobToken();
  if (!token) return null;
  const pathName = pathFor(key);

  if (!force) try {
    const h = await head(pathName, { token });
    const r = await fetch(h.url, { cache: "force-cache" });
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      const img: ImageResult = { buffer: buf, mimeType: h.contentType || "image/webp" };
      memCache.set(cacheKey, img);
      return img;
    }
  } catch {}

  try {
    console.log(`[story-bg] 🧪 drawing STORY background for key "${key}" (setting: ${prompt.slice(0, 100)}…)`);
    // BEZ postav (appka je vkládá až za scénu, composeSceneOnBackground).
    // 16:9 místo 9:16 appčiny domovské dekorace — musí sedět na skutečné
    // rozvržení stránky.
    const img = await generateBackgroundImage(prompt, [], "16:9");
    await put(pathName, img.buffer, {
      access: "public",
      contentType: img.mimeType,
      token,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31536000,
    });
    memCache.set(cacheKey, img);
    return img;
  } catch (e) {
    console.warn(`[story-bg] key "${key}" failed: ${e instanceof Error ? e.message : e}`);
    return null; // scéna spadne zpátky na normální čerstvé generování
  }
}

/** Postaví appce prompt pro čistou scenérii (bez postav) z Claudova vlastního
 *  "World & setting lock" textu PRO TUHLE pohádku — appka jím nahrazuje
 *  dřívější obecnou appčinou "světovou" dekoraci (viz komentář nahoře). */
export function buildSettingPrompt(settingText: string): string {
  return [
    `A wide establishing shot of this exact setting, EMPTY of any people or characters (they get added to individual pages separately): ${settingText}`,
    "Hand-painted 2D storybook illustration, soft painterly brushwork in classic Disney animated-film style, warm cinematic lighting, rich saturated colors, landscape orientation.",
    "No people, no animals, no creatures in this image — pure scenery/backdrop only.",
    "Absolutely no text, letters, words, signs, labels or writing of any kind anywhere in the image.",
  ].join(" ");
}
