// Témata pohádek – „svět", do kterého se příběh zasadí.
// Vybírají se na začátku jako zaškrtávátka. `prompt` je nápověda pro Claude.

export interface Theme {
  id: string;
  name: string;
  emoji: string;
  /** Nápověda pro vypravěče (Claude), jak svět uchopit */
  prompt: string;
}

export const THEMES: Theme[] = [
  {
    id: "krtek",
    name: "Krteček",
    emoji: "🐭",
    prompt:
      "Zasaď příběh do světa Krtečka (Zdeněk Miler): laskavý černý krteček a jeho zvířecí kamarádi (myška, ježek, zajíc) na louce a v lese. Hravé, dobrosrdečné, beze slov zlých postav.",
  },
  {
    id: "paw-patrol",
    name: "Tlapková patrola",
    emoji: "🐕",
    prompt:
      "Zasaď příběh do světa Tlapkové patroly (Paw Patrol): parta odvážných štěňátek-záchranářů, která spolupracují a pomáhají kamarádům ve městečku Adventure Bay.",
  },
  {
    id: "krkonose",
    name: "Krkonošské pohádky",
    emoji: "🏔️",
    prompt:
      "Zasaď příběh do Krkonošských pohádek: hodný vládce hor Krakonoš, chytrá Anče, Kuba a hajný, v zasněžených i letních horách. Lidová, vlídná atmosféra.",
  },
  {
    id: "mickey",
    name: "Mickey Mouse",
    emoji: "🐭",
    prompt:
      "Zasaď příběh do veselého světa Mickey Mouse a jeho kamarádů (Minnie, Pluto, Goofy, Donald). Radostné, klasické disneyovské dobrodružství.",
  },
  {
    id: "dinosauri",
    name: "Dinosauři",
    emoji: "🦕",
    prompt:
      "Zasaď příběh do dávného světa hodných dinosaurů – přátelští býložravci, prehistorická příroda, žádné násilí.",
  },
  {
    id: "vesmir",
    name: "Vesmír",
    emoji: "🚀",
    prompt:
      "Zasaď příběh do vesmíru – rakety, planety, hodní mimozemšťané a hvězdy. Dobrodružné a zvídavé.",
  },
  {
    id: "princezny",
    name: "Princezny a draci",
    emoji: "👑",
    prompt:
      "Zasaď příběh do pohádkového království s hodnými princeznami, statečnými rytíři a přátelskými draky.",
  },
  {
    id: "auticka",
    name: "Autíčka",
    emoji: "🚗",
    prompt:
      "Zasaď příběh do světa veselých závodních autíček a aut, která si pomáhají (ve stylu Cars).",
  },
];

export function themeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}
