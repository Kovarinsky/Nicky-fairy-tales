// 🧪 GET /api/sprite-test — DOČASNÝ debug endpoint (mockup větev, žádný
// produkční kód se sem nenapojuje) pro živé ověření vrstvového/sprite
// prototypu (lib/sprite-compositing.ts + generateCharacterSprite,
// lib/gemini.ts). Namaluje Nicoláska v jedné póze na chroma-key pozadí,
// vyseká ho na průhlednost a složí na sdílený tematický základ (lib/
// story-backgrounds.ts) — vrací URL všech tří mezikroků k ručnímu prohlédnutí.
// ?pose=<text> — vlastní póza místo výchozí.

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";
import { charactersByIds } from "@/lib/characters";
import { generateCharacterSprite } from "@/lib/gemini";
import { chromaKeyToTransparent, compositeSpritesOnBackground } from "@/lib/sprite-compositing";
import { getThemeBaseBackground } from "@/lib/story-backgrounds";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const token = blobToken();
  if (!token) return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });

  const pose = req.nextUrl.searchParams.get("pose")
    || "standing upright, facing forward, one arm raised waving hello, big cheerful smile";

  const [nicolas] = charactersByIds(["nicolas"]);
  if (!nicolas) return NextResponse.json({ error: "nicolas-not-found" }, { status: 500 });

  // 1) čerstvá sprite generace (bez portrétové cache — chceme vidět POZICI/styl v nové póze)
  const sprite = await generateCharacterSprite([], nicolas.description, pose);
  const spritePath = `sprite-test/1-raw-${Date.now()}.png`;
  const { url: rawUrl } = await put(spritePath, sprite.buffer, {
    access: "public", contentType: sprite.mimeType, token, addRandomSuffix: false, allowOverwrite: true,
  });

  // 2) chroma-key vysekání na průhlednost
  const transparentPng = await chromaKeyToTransparent(sprite.buffer);
  const transparentPath = `sprite-test/2-transparent-${Date.now()}.png`;
  const { url: transparentUrl } = await put(transparentPath, transparentPng, {
    access: "public", contentType: "image/png", token, addRandomSuffix: false, allowOverwrite: true,
  });

  // 3) kompozice na sdílený tematický základ (les, neutrální poledne)
  const bg = await getThemeBaseBackground("forest");
  let compositeUrl: string | null = null;
  if (bg) {
    const composite = await compositeSpritesOnBackground(bg, [
      { png: transparentPng, left: 400, top: 250, width: 500 },
    ]);
    const compositePath = `sprite-test/3-composite-${Date.now()}.webp`;
    const put3 = await put(compositePath, composite.buffer, {
      access: "public", contentType: composite.mimeType, token, addRandomSuffix: false, allowOverwrite: true,
    });
    compositeUrl = put3.url;
  }

  return NextResponse.json(
    { pose, rawUrl, transparentUrl, compositeUrl, note: bg ? undefined : "theme base background missing" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
