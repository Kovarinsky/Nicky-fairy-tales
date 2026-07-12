import { NextRequest, NextResponse } from "next/server";
import { generateSceneImage, genCounter } from "@/lib/gemini";
import { narrateScene, prepareNarrationText } from "@/lib/elevenlabs";
import { narrateWithGemini } from "@/lib/gemini-tts";
import { charactersByIds, type ReferenceImage } from "@/lib/characters";
import { loadPortraitRefEntries, refsForText } from "@/lib/portraits";
import { writeUsageRecord } from "@/lib/job-runner";
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

    // TTS router: hlasy "gemini:<jméno>" namluví Gemini TTS (WAV), ostatní ElevenLabs
    const narrate = async (): Promise<{ buffer: Buffer; mimeType: string }> => {
      if (voiceId?.startsWith("gemini:")) {
        return narrateWithGemini(prepareNarrationText(scene.narration), voiceId.slice(7));
      }
      return { buffer: await narrateScene(scene, voiceId), mimeType: "audio/mpeg" };
    };

    if (audioOnly) {
      // Líný hlas: namluvení jedné stránky až při čtení (a přepnutí hlasu)
      const audio = await narrate().catch((e: Error) => {
        throw new Error(`[TTS] ${e.message}`);
      });
      // Spotřeba hlasu se účtuje tady (generování pohádky už hlas nevyrábí)
      writeUsageRecord(0, scene.narration.length, typeof body.deviceId === "string" ? body.deviceId : undefined)
        .catch(() => {});
      return NextResponse.json({
        audioUrl: `data:${audio.mimeType};base64,${audio.buffer.toString("base64")}`,
      });
    }

    // Reference postav: CÍLENĚ jen portréty postav jmenovaných v této scéně
    // (všech 9 najednou vedlo k míchání identit) + fotky vlastních postav
    const characterIds: string[] = Array.isArray(body.characterIds) ? body.characterIds : [];
    const refEntries = await loadPortraitRefEntries(charactersByIds(characterIds));
    const refImages: ReferenceImage[] = refsForText(refEntries, `${scene.imagePrompt} ${scene.narration}`);
    const customImages = Array.isArray(body.customCharacterImages) ? body.customCharacterImages : [];
    for (const ci of customImages) {
      if (ci?.data && ci?.mimeType) refImages.push({ data: ci.data, mimeType: ci.mimeType, name: "a custom story character" });
    }

    // Consistency anchor: the first finished illustration of THIS story —
    // characters, sizes, art style and recurring objects are copied from it
    const anchor = body.styleAnchor;
    if (anchor?.data && anchor?.mimeType) {
      refImages.push({
        data: anchor.data,
        mimeType: anchor.mimeType,
        label:
          "CONSISTENCY ANCHOR — an illustration from THIS SAME story. Copy from it EXACTLY: every character's design, clothing, hair, body size and the relative heights between characters, the art style, AND every recurring object. The car keeps the identical body type, shape, colors and details in this scene (a sedan stays a sedan — it never becomes a different car):",
      });
    }

    let imageDebug = "";
    let audioDebug = "";
    // noAudio: hlas se vyrábí líně až při čtení — scéna generuje jen obrázek
    const noAudio = body.noAudio === true;
    const genAtStart = { ...genCounter };
    const [imageResult, audio] = await Promise.all([
      generateSceneImage(scene, heroDescription, refImages).catch((e: Error) => {
        imageDebug = e.message;
        console.error(`[Gemini] ${e.message}`);
        return null; // fallback to SVG placeholder
      }),
      noAudio
        ? Promise.resolve(null)
        : narrate().catch((e: Error) => {
            audioDebug = e.message;
            console.error(`[TTS] ${e.message}`);
            return null; // audio is optional — book works without it
          }),
    ]);

    // Build image URL — use SVG placeholder if Gemini failed
    let imageUrl: string;
    if (imageResult) {
      // Spotřeba: obrázky kreslené mimo serverovou frontu (líná větev B,
      // oprava scény, lokální pipeline) — skutečný počet generování vč. QA
      writeUsageRecord(
        Math.max(1, genCounter.img1k - genAtStart.img1k), 0,
        typeof body.deviceId === "string" ? body.deviceId : undefined,
        Math.max(0, genCounter.img4k - genAtStart.img4k)
      ).catch(() => {});
      imageUrl = `data:${imageResult.mimeType};base64,${imageResult.buffer.toString("base64")}`;
    } else {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1a1040"/><stop offset="100%" stop-color="#3d1060"/></linearGradient></defs><rect width="800" height="450" fill="url(#g)"/><text x="400" y="190" text-anchor="middle" fill="rgba(255,255,255,0.35)" font-size="72" font-family="serif">✨</text><text x="400" y="270" text-anchor="middle" fill="rgba(255,255,255,0.5)" font-size="22" font-family="sans-serif">Scéna ${scene.index}</text></svg>`;
      imageUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    }

    return NextResponse.json({
      imageUrl,
      ...(audio ? { audioUrl: `data:${audio.mimeType};base64,${audio.buffer.toString("base64")}` } : {}),
      ...(imageDebug ? { imageDebug } : {}),
      ...(audioDebug ? { audioDebug } : {}),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
