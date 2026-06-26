// POST /api/scene → pro JEDNU scénu vyrobí obrázek (Nano Banana) + audio (ElevenLabs).
// Tělo: { scene: Scene, heroDescription: string, characterIds?: string[] }
// Vrací: { imageUrl: dataURL, audioUrl: dataURL }
//
// Pokud jsou zadané characterIds, načtou se jejich referenční fotky a obrázek
// se generuje tak, aby postavy vypadaly jako vaše děti.
//
// Pro MVP vracíme média jako data URL (base64) – není potřeba řešit úložiště.

import { NextRequest, NextResponse } from "next/server";
import { generateSceneImage } from "@/lib/gemini";
import { narrateScene } from "@/lib/elevenlabs";
import { charactersByIds, loadReferenceImages } from "@/lib/characters";
import type { Scene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const scene = body.scene as Scene;
    const heroDescription = String(body.heroDescription || "");
    const ids: string[] = Array.isArray(body.characterIds) ? body.characterIds : [];

    if (!scene || !scene.narration || !scene.imagePrompt) {
      return NextResponse.json({ error: "Neplatná scéna." }, { status: 400 });
    }

    const referenceImages = ids.length
      ? loadReferenceImages(charactersByIds(ids))
      : [];

    // Obrázek a hlas zároveň – jsou nezávislé.
    const [image, audio] = await Promise.all([
      generateSceneImage(scene, heroDescription, referenceImages),
      narrateScene(scene),
    ]);

    return NextResponse.json({
      imageUrl: `data:${image.mimeType};base64,${image.buffer.toString("base64")}`,
      audioUrl: `data:audio/mpeg;base64,${audio.toString("base64")}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
