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
    "- Pokud jsou přiloženy referenční obrázky nebo PDF, použij je jako inspiraci",
    "  pro styl, atmosféru nebo detaily příběhu.",
    "",
    "Odpověz POUZE validním JSON objektem (bez ```), přesně v tomto tvaru:",
    "{",
    '  "title": string,',
    '  "heroDescription": string,',
    '  "scenes": [ { "index": number, "narration": string, "imagePrompt": string } ]',
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

  const cast = allChars.map((c) => `- ${c.name} (${c.description})`).join("\n");

  const hasNicky = allChars.some((c) => c.id === "nicolas");
  const hasValentyna = allChars.some((c) => c.id === "valentyna");
  const hasParents = allChars.some((c) => c.id === "jan" || c.id === "jana");

  const familyContext = [
    hasNicky && hasValentyna
      ? "Nicolasek je o celou hlavu vyssi nez Valentynka – jejich rozdil ve velikosti patri do pribehu."
      : "",
    hasNicky && hasValentyna ? "Sourozenci spolu spolupracuji, starsi pomaha mladsim." : "",
    hasParents && (hasNicky || hasValentyna)
      ? "Rodice jsou v pribehu laskypnou oporou – pomahaji, ale nechavaji deti zazit dobrodruzstvi."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const lines = [
    req.themeName ? `Svet / tema: ${req.themeName}` : "",
    req.themePrompt || "",
    req.topic ? `Prani / zapletka: ${req.topic}` : "",
    `Postavy:`,
    cast,
    familyContext,
    `Vek ditete: ${req.age} let`,
    `Pocet scen: ${req.sceneCount}`,
    `Jazyk: cestina`,
    "",
    "V `imagePrompt` (anglicky) vzdy zopakuj vzhled vystupujicich postav a zasad scenu do zvoleneho sveta.",
  ];

  if (extras.inspirationUrlText) {
    lines.push("", "Dodatecny kontext z webove stranky:", extras.inspirationUrlText);
  }
  if (extras.inspirationImages && extras.inspirationImages.length > 0) {
    lines.push(
      "",
      `Prilozen(y) ${extras.inspirationImages.length} referencni obra(zy/zek) – pouzij jako inspiraci pro atmosferu a vizualni styl.`
    );
  }
  if (extras.inspirationPdfBase64) {
    lines.push("", "Prilozene PDF pouzij jako inspiraci pro obsah nebo styl pribehu.");
  }
  if (extras.customCharacters && extras.customCharacters.length > 0) {
    const withPhoto = extras.customCharacters.filter((c) => c.photoBase64);
    if (withPhoto.length > 0) {
      lines.push(
        "",
        `Prilozen(a) ${withPhoto.length} fotka/ky vlastnich postav – zachovej jejich vzhled v pribehu.`
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
    max_tokens: 4096,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content }],
  });

  return parseScript(raw);
}
