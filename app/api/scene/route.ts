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

    if (!scene?.narration || !scene?.imagePrompt) {
      return NextResponse.json({ error: "Neplatná scéna." }, { status: 400 });
    }

    // Reference photos from disk (Nicolas, Valentýnka…)
    const diskImages = ids.length ? loadReferenceImages(charactersByIds(ids)) : [];

    // Custom character photos from browser (sent as base64)
    const customImages: Array<{ data: string; mimeType: string }> = Array.isArray(
      body.customCharacterImages
    )
      ? body.customCharacterImages
      : [];

    const allRefImages = [...diskImages, ...customImages];

    const [image, audio] = await Promise.all([
      generateSceneImage(scene, heroDescription, allRefImages),
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
