// GET /api/bg-image?scene=forest — vrátí URL ilustrovaného pozadí aplikace.
// Obrázek se generuje Geminim JEDNOU (při prvním požadavku), uloží se do
// Vercel Blob pod backgrounds/<id>-vN.png a všechna další volání jen vrací
// hotovou URL. Úklid jobů (prefix jobs/) se těchto souborů nedotkne.

import { NextRequest, NextResponse } from "next/server";
import { head, put } from "@vercel/blob";
import { bgSceneById } from "@/lib/backgrounds";
import { generateBackgroundImage } from "@/lib/gemini";
import { charactersByIds, loadReferenceImages } from "@/lib/characters";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 120;

// Při změně promptů v lib/backgrounds.ts zvednout — vygenerují se nové obrázky
// v2: světy nově obsahují Nicoláska a Valentýnku (podle referenčních fotek)
const BG_VERSION = "v2";

// Děti jsou součástí každého světa pozadí — malé, zezadu/z profilu, u kraje
const KIDS_SUFFIX =
  " Include the two children from the reference photos — Nicolas and Valentýna — as SMALL figures in the lower part of the scene, standing together seen from behind or in half-profile, gazing into the world with wonder. Their hair and look must match the reference photos. They occupy at most one quarter of the image height; the scenery remains the main subject.";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("scene") || "";
  const scene = bgSceneById(id);
  if (!scene) return NextResponse.json({ error: "unknown-scene" }, { status: 400 });
  if (!blobToken()) return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });

  const path = `backgrounds/${scene.id}-${BG_VERSION}.png`;
  try {
    const h = await head(path, { token: blobToken() });
    return NextResponse.json({ url: h.url });
  } catch {
    // ještě neexistuje → vygenerovat
  }

  try {
    const refs = loadReferenceImages(charactersByIds(["nicolas", "valentyna"]));
    const img = await generateBackgroundImage(scene.prompt + KIDS_SUFFIX, refs);
    const blob = await put(path, img.buffer, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: img.mimeType,
      token: blobToken(),
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
