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
      "Set the story in the world of Krteček (Zdeněk Miler): kind woodland animals on a meadow and in a forest. CHARACTER REFERENCE: Krteček: small round black mole, tiny white-rimmed black eyes, tiny pink nose, pure black fur, no clothing, small rounded paws. | Myška: small grey mouse, large pink round ears, tiny black eyes, pink nose, sometimes wears a red dress. | Ježek: small brown hedgehog, spiky brown-grey quills on back, white belly, small black eyes. Pleasant, gentle atmosphere, no evil characters.",
  },
  {
    id: "paw-patrol",
    name: "Tlapková patrola",
    emoji: "🐕",
    prompt:
      "Set the story in the world of Paw Patrol: brave rescue pups working together. CHARACTER REFERENCE: Chase: German shepherd puppy, tan and brown fur, blue police uniform vest with paw badge, blue police cap, blue collar. | Marshall: Dalmatian puppy, white fur with black spots, red firefighter uniform, red firefighter hat. | Rubble: English bulldog puppy, brown and cream fur, yellow construction hat, orange construction vest. | Skye: cockapoo puppy, pink fur with darker pink highlights, pink aviator goggles on head, pink pilot uniform. | Ryder: boy with brown hair, red jacket with paw logo, blue jeans, red helmet. Adventure Bay setting.",
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
      "Set the story in the cheerful world of Mickey Mouse and friends. CHARACTER REFERENCE — use these exact descriptions: Mickey Mouse: round black ears on round head, white oval eyes with black pupils, red shorts with two white round buttons, white four-fingered gloves, large yellow oval shoes, cheerful round black mouse face. | Minnie Mouse: round black ears with large red polka-dot bow on head, white oval eyes, red dress with white polka dots, white collar and white cuffs, white gloves, yellow shoes. | Pluto: large orange-yellow dog body, long floppy ears, big black nose, green collar with tag. | Goofy: tall lanky dog-like character, orange turtleneck, blue overalls with two buttons, brown hat, green long-sleeved shirt underneath. | Donald Duck: white duck, blue sailor shirt, blue sailor hat with black ribbon, red bow tie, no pants, yellow bill and feet.",
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
