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
    const voiceId: string | undefined = typeof body.voiceId === "string" && body.voiceId ? body.voiceId : undefined;
    const audioOnly: boolean = body.audioOnly === true;

    if (!scene?.narration || (!audioOnly && !scene?.imagePrompt)) {
      return NextResponse.json({ error: "Neplatná scéna." }, { status: 400 });
    }

    if (audioOnly) {
      // Audio-only regeneration (voice switch) — skip Gemini
      const audio = await narrateScene(scene, voiceId).catch((e: Error) => {
        throw new Error(`[ElevenLabs] ${e.message}`);
      });
      return NextResponse.json({
        audioUrl: `data:audio/mpeg;base64,${audio.toString("base64")}`,
      });
    }

    let imageDebug = "";
    let audioDebug = "";
    const [imageResult, audio] = await Promise.all([
      generateSceneImage(scene, heroDescription).catch((e: Error) => {
        imageDebug = e.message;
        console.error(`[Gemini] ${e.message}`);
        return null; // fallback to SVG placeholder
      }),
      narrateScene(scene, voiceId).catch((e: Error) => {
        audioDebug = e.message;
        console.error(`[ElevenLabs] ${e.message}`);
        return null; // audio is optional — book works without it
      }),
    ]);

    // Build image URL — use SVG placeholder if Gemini failed
    let imageUrl: string;
    if (imageResult) {
      imageUrl = `data:${imageResult.mimeType};base64,${imageResult.buffer.toString("base64")}`;
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1a1040"/><stop offset="100%" stop-color="#3d1060"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><text x="400" y="190" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="72" font-family="serif">✨</text><text x="400" y="270" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="22" font-family="sans-serif">Scéna ${scene.index}</text></svg>`;
      imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    }

    return NextResponse.json({
      imageUrl,
      ...(audio ? { audioUrl: `data:audio/mpeg;base64,${audio.toString("base64")}` } : {}),
      ...(imageDebug ? { imageDebug } : {}),
      ...(audioDebug ? { audioDebug } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
