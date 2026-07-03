// Pozadí aplikace — barevné „světy" malované čistě v CSS (žádné stahování,
// funguje offline). Tlačítkem 🎨 se dají rolovat, v režimu Auto se pozadí
// přepne samo podle zvoleného tématu pohádky (mapa THEME_BG níže).

export interface BgScene {
  id: string;
  emoji: string;
  name: string;   // cs
  nameEn: string;
}

export const BG_SCENES: BgScene[] = [
  { id: "night",     emoji: "🌙", name: "Noc",     nameEn: "Night" },
  { id: "forest",    emoji: "🌲", name: "Les",     nameEn: "Forest" },
  { id: "mountains", emoji: "🏔️", name: "Hory",    nameEn: "Mountains" },
  { id: "space",     emoji: "🚀", name: "Vesmír",  nameEn: "Space" },
  { id: "dino",      emoji: "🦕", name: "Džungle", nameEn: "Jungle" },
  { id: "bay",       emoji: "🌊", name: "Moře",    nameEn: "Sea" },
  { id: "road",      emoji: "🏎️", name: "Závody",  nameEn: "Racing" },
  { id: "cartoon",   emoji: "🎪", name: "Pouť",    nameEn: "Funfair" },
  { id: "fantasy",   emoji: "✨", name: "Kouzlo",  nameEn: "Magic" },
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
