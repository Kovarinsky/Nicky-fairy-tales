// Generování příběhu pomocí Claude.
// Claude dostane zadání a vrátí strukturovaný scénář (JSON) rozdělený na scény.

import Anthropic from "@anthropic-ai/sdk";
import type { StoryRequest, StoryScript } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chybí ANTHROPIC_API_KEY. Zkopíruj .env.example do .env.local a doplň klíč."
    );
  }
  return new Anthropic({ apiKey });
}

/**
 * Systémový prompt drží Claude v roli vypravěče a vynucuje čistý JSON.
 * Image prompty jsou záměrně anglicky – generátory obrázků na ně reagují lépe.
 */
function buildSystemPrompt(): string {
  return [
    "Jsi laskavý vypravěč dětských pohádek. Píšeš česky, srozumitelně a vřele.",
    "Tvým úkolem je napsat původní pohádku rozdělenou na scény (stránky knížky).",
    "Pravidla:",
    "- Příběh musí mít jasný začátek, zápletku a hezký, uklidňující konec (vhodné před spaním).",
    "- Žádné násilí, strach ani témata nevhodná pro malé děti.",
    "- Vystupují právě zadané postavy (jménem) a jsou popsány konzistentně.",
    "- Každá scéna má 2–4 věty vyprávění (kratší pro mladší děti).",
    "- Ke každé scéně přidej `imagePrompt` ANGLICKY: popis ilustrace v stylu",
    "  'soft children's storybook illustration, warm colors, cozy'. V image promptu",
    "  vždy zopakuj vzhled hrdiny, aby byl na všech obrázcích stejný.",
    "",
    "Odpověz POUZE validním JSON objektem (bez ```), přesně v tomto tvaru:",
    "{",
    '  "title": string,',
    '  "heroDescription": string,   // vzhled hrdiny anglicky, pro konzistenci obrázků',
    '  "scenes": [ { "index": number, "narration": string, "imagePrompt": string } ]',
    "}",
  ].join("\n");
}

function buildUserPrompt(req: StoryRequest): string {
  const cast = req.characters
    .map((c) => `- ${c.name} (${c.description})`)
    .join("\n");
  return [
    req.themeName ? `Svět / téma pohádky: ${req.themeName}` : "",
    req.themePrompt || "",
    req.topic ? `Přání / zápletka od dítěte: ${req.topic}` : "",
    `Postavy, které v pohádce vystupují:`,
    cast,
    req.characters.length > 1
      ? "Postavy jsou sourozenci a v příběhu spolu interagují (mladší vzhlíží ke staršímu)."
      : "",
    `Věk dítěte: ${req.age} let (tomu přizpůsob slovník a délku vět)`,
    `Počet scén: ${req.sceneCount}`,
    `Jazyk vyprávění: čeština`,
    "",
    "V `imagePrompt` (anglicky) vždy zopakuj vzhled vystupujících postav podle popisu výše",
    "(včetně rozdílu ve velikosti) a zasaď scénu do zvoleného světa/tématu.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Vytáhne JSON i kdyby ho model omylem zabalil do code fence. */
function parseScript(raw: string): StoryScript {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Claude nevrátil JSON. Odpověď: " + raw.slice(0, 200));
  }
  const json = cleaned.slice(start, end + 1);
  const parsed = JSON.parse(json) as StoryScript;

  // normalizace pořadí scén
  parsed.scenes = (parsed.scenes || []).map((s, i) => ({ ...s, index: i + 1 }));
  return parsed;
}

/** Hlavní funkce: ze zadání vyrobí scénář. */
export async function generateStory(req: StoryRequest): Promise<StoryScript> {
  const client = getClient();

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(req) }],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude nevrátil textovou odpověď.");
  }
  return parseScript(textBlock.text);
}
