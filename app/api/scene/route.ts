// POST /api/scene → pro JEDNU scénu vyrobí obrázek (Nano Banana) + audio (ElevenLabs).
// Tělo: { scene: Scene, heroDescription: string }
// Vrací: { imageUrl: dataURL, audioUrl: dataURL }
//
// Pro MVP vracíme média jako data URL (base64) – není potřeba řešit úložiště.
// Až bude appka nasazená, přepneme na ukládání do /public/stories nebo blob storage.

import { NextRequest, NextResponse } from "next/server";
import { generateSceneImage } from "@/lib/gemini";
import { narrateScene } from "@/lib/elevenlabs";
import type { Scene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const scene = body.scene as Scene;
    const heroDescription = String(body.heroDescription || "");

    if (!scene || !scene.narration || !scene.imagePrompt) {
      return NextResponse.json({ error: "Neplatná scéna." }, { status: 400 });
    }

    // Obrázek a hlas zároveň – jsou nezávislé.
    const [image, audio] = await Promise.all([
      generateSceneImage(scene, heroDescription),
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
