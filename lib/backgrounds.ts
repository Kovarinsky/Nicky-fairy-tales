// Pozadí aplikace — ilustrované „světy" ve stylu pohádkových obrázků.
// Obrázek maluje Gemini (stejný styl jako scény pohádek), generuje se JEDNOU,
// uloží se do Vercel Blob (backgrounds/<id>-vN.png) a pak se už jen načítá.
// Než se stáhne (nebo offline), drží pod ním CSS gradient dané scény.
// Tlačítkem 🎨 se světy rolují, v režimu Auto se přepnou podle tématu pohádky.

export interface BgScene {
  id: string;
  emoji: string;
  name: string;   // cs
  nameEn: string;
  prompt: string; // co má Gemini namalovat
}

// Stejná řeč stylu jako u scén pohádek (lib/gemini.ts STYLE_SUFFIX) + pravidla
// pro pozadí: prázdná scenérie bez postav, ztlumená, ať je bílý text čitelný.
const BG_STYLE =
  "Walt Disney animated style, painterly storybook illustration, warm cinematic lighting, rich saturated colors, portrait orientation. " +
  "A dreamy scenery backdrop for a children's fairy-tale app: no people or creatures OTHER than the two children specified separately. " +
  "Slightly dark and muted overall so white text on top stays readable. " +
  "Absolutely no text, letters, words, signs, labels or writing of any kind anywhere in the image.";

export const BG_SCENES: BgScene[] = [
  { id: "night",     emoji: "🌙", name: "Noc",     nameEn: "Night",
    prompt: `A quiet starry night sky over a sleeping storybook village on rolling hills, a big glowing full moon, twinkling stars, deep blue tones. ${BG_STYLE}` },
  { id: "forest",    emoji: "🌲", name: "Les",     nameEn: "Forest",
    prompt: `A magical deep forest clearing at dusk, tall friendly old trees, glowing fireflies, soft moonbeams through the canopy, mushrooms and ferns. ${BG_STYLE}` },
  { id: "mountains", emoji: "🏔️", name: "Hory",    nameEn: "Mountains",
    prompt: `Snowy fairy-tale mountains at dusk, frosted pine trees, warm lights of a tiny wooden cottage in a distant valley, gentle falling snow, hint of northern lights. ${BG_STYLE}` },
  { id: "space",     emoji: "🚀", name: "Vesmír",  nameEn: "Space",
    prompt: `Outer space with a friendly ringed planet, colorful smaller planets, sparkling stars, a comet trail and a soft purple-blue nebula. ${BG_STYLE}` },
  { id: "dino",      emoji: "🦕", name: "Džungle", nameEn: "Jungle",
    prompt: `A prehistoric jungle valley with giant ferns and palm leaves, a calm distant volcano with a thin smoke plume, warm orange sunset sky, a winding river. ${BG_STYLE}` },
  { id: "bay",       emoji: "🌊", name: "Moře",    nameEn: "Sea",
    prompt: `A cozy seaside bay in golden evening light, a small lighthouse on a cliff, gentle waves, distant sailboats, soft clouds. ${BG_STYLE}` },
  { id: "road",      emoji: "🏎️", name: "Závody",  nameEn: "Racing",
    prompt: `A winding empty racetrack road through green hills at sunset, colorful pennant flags on poles, distant city lights on the horizon, warm glowing sky. ${BG_STYLE}` },
  { id: "cartoon",   emoji: "🎪", name: "Pouť",    nameEn: "Funfair",
    prompt: `A cheerful vintage funfair at night: a glowing carousel, a lit ferris wheel, a striped circus tent, strings of warm fairy lights, starry sky. ${BG_STYLE}` },
  { id: "fantasy",   emoji: "✨", name: "Kouzlo",  nameEn: "Magic",
    prompt: `A magical fairy-tale castle on a floating island in a twilight purple sky, sparkling stardust, small waterfalls falling off the island, glowing crystals. ${BG_STYLE}` },
];

export function bgSceneById(id: string): BgScene | undefined {
  return BG_SCENES.find(s => s.id === id);
}

/** Které pozadí patří ke kterému tématu pohádky (režim Auto). */
export const THEME_BG: Record<string, string> = {
  krtek: "forest",
  pokemon: "forest",
  sonic: "forest",
  krkonose: "mountains",
  vesmir: "space",
  dinosauri: "dino",
  "paw-patrol": "bay",
  auticka: "road",
  mickey: "cartoon",
};
