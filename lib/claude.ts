import { request } from "https";
import type { StoryRequest, StoryScript, Character } from "./types";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";
const ANTHROPIC_VERSION = "2023-06-01";

export interface StoryExtras {
  customCharacters?: Array<{
    id: string;
    name: string;
    description: string;
    photoBase64?: string;
    photoMimeType?: string;
  }>;
  inspirationImages?: Array<{ data: string; mimeType: string }>;
  inspirationPdfBase64?: string;
  inspirationUrlText?: string;
}

function buildSystemPrompt(): string {
  return [
    "Jsi laskavý, talentovaný vypravěč dětských pohádek. Píšeš česky.",
    "Tvůj úkol: napsat původní pohádku rozdělenou na scény (stránky knížky).",
    "",
    "═══ PRAVIDLA PRO PŘÍBĚH ═══",
    "- Příběh má jasný začátek, napínavou zápletku a uklidňující, hřejivý konec.",
    "- Žádné násilí, hrůza ani témata nevhodná pro malé děti.",
    "- Každá postava je charakterově konzistentní PO CELÝ příběh (povaha se nemění).",
    "- Postavy v pribehu vzdy vystupuji pod svym jmenem, ne jako 'hrdina' nebo 'divka'.",
    "",
    "═══ NARRACE – STYL A EMOCE ═══",
    "- Každá scéna má 3–5 vět vyprávění.",
    "- Věty variuj rytmicky: krátké pro napětí a překvapení, delší pro klidné momenty.",
    "- Každá scéna musí mít JASNOU EMOCI: úžas, radost, napětí, tajemství, útulnost...",
    "- Používej onomatopoeia a smyslové detaily: 'zašuměl listím', 'vonělo medem', 'zazněl zvoneček'.",
    "- Pro dramatický efekt využij tři tečky (...) a vykřičník pro radost.",
    "- Narrace musí znít přirozeně nahlas – jako by ji četl otec nebo maminka.",
    "- VYHNI SE: suché faktické popisy, opakování stejných slov, fráze bez emocí.",
    "",
    "═══ VIZUÁLNÍ KONZISTENCE POSTAV ═══",
    "- V `heroDescription` (anglicky) popiš KAŽDOU postavu podrobně:",
    "  barva a styl vlasů, barva očí, výška/postava, oblečení v pohádce, charakteristické rysy.",
    "- Pokud jsou přiloženy referenční fotografie postav, popisy MUSÍ odpovídat fotografiím.",
    "- V každém `imagePrompt` zopakuj vizuální popis VŠECH vystupujících postav doslova.",
    "- Výraz ve tváři musí odpovídat emoci dané scény.",
    "",
    "═══ IMAGE PROMPTS ═══",
    "- Psát ANGLICKY, detailní, filmový popis ilustrace.",
    "- Styl: 'painterly semi-realistic storybook illustration, warm cinematic lighting,",
    "  rich colors, expressive faces, detailed background, professional children's book art'.",
    "- Nikdy nezahrnuj text do obrazu. Scénu zasaď do světa pohádky.",
    "- Rozložení: vždy na šířku (landscape orientation).",
    "",
    "═══ SOUNDSCAPE ═══",
    "Každá scéna má `soundscape` – vyberte podle nálady scény (POVINNÉ):",
    '  "magic"     — kouzla, magie, víly, zázraky, kouzelné předměty',
    '  "forest"    — příroda, les, louka, zvířata, venku, zahrada',
    '  "night"     — noc, hvězdy, měsíc, spánek, sny, večer',
    '  "adventure" — pohyb, dobrodružství, výzva, nebezpečí, záchrana',
    '  "cozy"      — domov, jídlo, objetí, bezpečí, rodina, teplo, konec pohádky',
    "",
    "═══ VÝSTUP ═══",
    "Odpověz POUZE validním JSON (bez ``` nebo jiných znaků okolo), přesně:",
    "{",
    '  "title": string,',
    '  "heroDescription": string,   // anglicky, podrobné popisy VŠECH postav',
    '  "scenes": [',
    '    {',
    '      "index": number,',
    '      "narration": string,     // česky, emotivní, TTS-friendly',
    '      "imagePrompt": string,   // anglicky, detailní, s popisem postav',
    '      "soundscape": "magic"|"forest"|"night"|"adventure"|"cozy"',
    '    }',
    "  ]",
    "}",
  ].join("\n");
}

function buildUserPrompt(req: StoryRequest, extras: StoryExtras = {}): string {
  const allChars: Character[] = [
    ...req.characters,
    ...(extras.customCharacters || []).map((cc) => ({
      id: cc.id,
      name: cc.name,
      description: cc.description,
    })),
  ];

  const cast = allChars.map((c) => `- ${c.name}: ${c.description}`).join("\n");

  const hasNicky = allChars.some((c) => c.id === "nicolas");
  const hasValentyna = allChars.some((c) => c.id === "valentyna");
  const hasParents = allChars.some((c) => c.id === "jan" || c.id === "jana");

  const familyContext = [
    hasNicky && hasValentyna
      ? "Nicolas je o celou hlavu vyšší než Valentýna – tento výškový rozdíl musí být viditelný na KAŽDÉM obrázku."
      : "",
    hasNicky && hasValentyna
      ? "Sourozenci spolupracují, starší pomáhá mladší – dynamika staršího sourozence je součástí charakteru."
      : "",
    hasParents && (hasNicky || hasValentyna)
      ? "Rodiče jsou láskyplnou oporou – v příběhu pomáhají, ale nechávají děti zažít dobrodružství."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const ageNote =
    req.age <= 3
      ? "Velmi jednoduché věty (max 8 slov), hodně opakování, uklidňující rytmus."
      : req.age <= 5
      ? "Krátké věty, konkrétní obrazy, kouzelné a hravé."
      : "Věty mohou být delší, příběh může mít mírné napětí a humor.";

  const lines = [
    req.themeName ? `Svět / téma: ${req.themeName}` : "",
    req.themePrompt || "",
    req.topic ? `Přání / zápletka: ${req.topic}` : "",
    `Postavy:`,
    cast,
    familyContext,
    `Věk hlavního publika: ${req.age} let. ${ageNote}`,
    `Počet scén: ${req.sceneCount}`,
    `Jazyk vyprávění: čeština`,
    "",
    "DŮLEŽITÉ pro imagePrompty: v každém obrazu zopakuj přesný vizuální popis",
    "všech postav, které ve scéně vystupují, a zasaď je do prostředí dané scény.",
    "Výraz tváře musí odpovídat emoci scény (radost, úžas, napětí, klid...).",
  ];

  if (extras.inspirationUrlText) {
    lines.push("", "Doplňující kontext z webové stránky:", extras.inspirationUrlText.slice(0, 1500));
  }
  if (extras.inspirationImages && extras.inspirationImages.length > 0) {
    lines.push(
      "",
      `Přiložen(y) ${extras.inspirationImages.length} inspirační obrázek/ky – použij pro atmosféru a vizuální styl.`
    );
  }
  if (extras.inspirationPdfBase64) {
    lines.push("", "Přiložené PDF použij jako inspiraci pro obsah nebo styl příběhu.");
  }
  if (extras.customCharacters && extras.customCharacters.length > 0) {
    const withPhoto = extras.customCharacters.filter((c) => c.photoBase64);
    if (withPhoto.length > 0) {
      lines.push(
        "",
        `Přiložen(a) ${withPhoto.length} fotka/ky vlastních postav – zachovej jejich přesný vzhled v celém příběhu.`
      );
    }
  }

  return lines.filter(Boolean).join("\n");
}

function parseScript(raw: string): StoryScript {
  const cleaned = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1)
    throw new Error("Claude nevrátil JSON. Odpověď: " + raw.slice(0, 200));
  const parsed = JSON.parse(cleaned.slice(start, end + 1)) as StoryScript;
  parsed.scenes = (parsed.scenes || []).map((s, i) => ({ ...s, index: i + 1 }));
  return parsed;
}

type AnthropicPart =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

function callAnthropicApi(body: object): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí ANTHROPIC_API_KEY.");

  const bodyStr = JSON.stringify(body);
  const bodyBuf = Buffer.from(bodyStr, "utf-8");

  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "api.anthropic.com",
        path: "/v1/messages",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
          "content-length": bodyBuf.length,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf-8");
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Anthropic ${res.statusCode}: ${text.slice(0, 400)}`));
            return;
          }
          try {
            const data = JSON.parse(text) as {
              content?: Array<{ type: string; text?: string }>;
              error?: { message?: string };
            };
            if (data.error) {
              reject(new Error(`Anthropic error: ${data.error.message}`));
              return;
            }
            const textBlock = (data.content || []).find((b) => b.type === "text");
            if (!textBlock?.text) {
              reject(new Error("Claude nevrátil text. Odpověď: " + text.slice(0, 200)));
              return;
            }
            resolve(textBlock.text);
          } catch {
            reject(new Error("Anthropic JSON parse error: " + text.slice(0, 200)));
          }
        });
        res.on("error", reject);
      }
    );
    req.on("error", reject);
    req.write(bodyBuf);
    req.end();
  });
}

export async function generateStory(req: StoryRequest, extras: StoryExtras = {}): Promise<StoryScript> {
  const model = (process.env.ANTHROPIC_MODEL || MODEL).trim();
  const parts: AnthropicPart[] = [];

  if (extras.inspirationPdfBase64) {
    parts.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: extras.inspirationPdfBase64 },
    });
  }

  for (const img of extras.inspirationImages || []) {
    parts.push({
      type: "image",
      source: { type: "base64", media_type: img.mimeType, data: img.data },
    });
  }

  for (const cc of extras.customCharacters || []) {
    if (cc.photoBase64 && cc.photoMimeType) {
      parts.push({
        type: "image",
        source: { type: "base64", media_type: cc.photoMimeType, data: cc.photoBase64 },
      });
    }
  }

  parts.push({ type: "text", text: buildUserPrompt(req, extras) });

  const content: string | AnthropicPart[] =
    parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;

  const raw = await callAnthropicApi({
    model,
    max_tokens: 6000,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content }],
  });

  return parseScript(raw);
}
