// POST /api/job/start — spustí generování celé pohádky NA SERVERU.
// Telefon může okamžitě odejít; průběh a hotové scény se ukládají do
// Vercel Blob a klient si je stáhne přes /api/job/status.
// Vyžaduje BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob) — bez něj vrací 501
// a klient spadne zpět na generování v prohlížeči.

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { waitUntil } from "@vercel/functions";
import { generateStory, type StoryExtras } from "@/lib/claude";
import { generateSceneImage } from "@/lib/gemini";
import { narrateScene } from "@/lib/elevenlabs";
import { charactersByIds, loadCharacters, loadReferenceImages, type ReferenceImage } from "@/lib/characters";
import { themeById } from "@/lib/themes";
import type { StoryRequest, Character, Scene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const ANCHOR_LABEL =
  "CONSISTENCY ANCHOR — an illustration from THIS SAME story. Copy from it EXACTLY: every character's design, clothing, hair, body size and the relative heights between characters, the art style, AND every recurring object. The car keeps the identical body type, shape, colors and details in this scene (a sedan stays a sedan — it never becomes a different car):";

interface JobStatus {
  phase: "writing" | "generating" | "done" | "error";
  createdAt: number;
  voiceId: string;
  title?: string;
  heroDescription?: string;
  scenesScript?: Scene[];
  total?: number;
  done?: number;
  sceneUrls?: Record<number, string>;
  error?: string;
}

async function putJson(path: string, data: unknown): Promise<string> {
  const blob = await put(path, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
  return blob.url;
}

async function fetchUrlText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NickyFairyBot/1.0)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
  } catch {
    return "";
  }
}

async function runJob(id: string, body: Record<string, unknown>) {
  const statusPath = `jobs/${id}/status.json`;
  const st: JobStatus = { phase: "writing", createdAt: Date.now(), voiceId: String(body.voiceId || "") };
  const write = () => putJson(statusPath, st).catch(e => console.error(`[job ${id}] status write failed:`, e));
  await write();

  try {
    // ── 1) Story (Claude) — same inputs as /api/story ──
    const topic = String(body.topic || "").trim();
    const theme = body.themeId ? themeById(String(body.themeId)) : undefined;
    const ids: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
    let characters: Character[] = ids.length ? charactersByIds(ids) : loadCharacters();
    if (characters.length === 0) characters = [{ id: "hero", name: "Hrdina", description: "a young child" }];

    const rawCustom = Array.isArray(body.customCharacters) ? (body.customCharacters as StoryExtras["customCharacters"]) : [];
    const urlText = body.inspirationUrl ? await fetchUrlText(String(body.inspirationUrl)) : "";

    const storyReq: StoryRequest = {
      topic,
      themeName: theme?.name,
      themePrompt: theme?.prompt,
      characters,
      age: Number(body.age) || 4,
      sceneCount: Math.min(Math.max(Number(body.sceneCount) || 6, 1), 15),
      language: String(body.language || "cs") === "en" ? "en" : "cs",
    };
    const extras: StoryExtras = {
      customCharacters: rawCustom,
      inspirationImages: Array.isArray(body.inspirationImages) ? (body.inspirationImages as StoryExtras["inspirationImages"]) : [],
      inspirationPdfBase64: (body.inspirationPdfBase64 as string) || undefined,
      inspirationUrlText: urlText || undefined,
    };

    const script = await generateStory(storyReq, extras);
    const total = script.scenes.length;
    st.phase = "generating";
    st.title = script.title;
    st.heroDescription = script.heroDescription;
    st.scenesScript = script.scenes;
    st.total = total;
    st.done = 0;
    st.sceneUrls = {};
    await write();

    // ── 2) Scenes (Gemini + ElevenLabs) with the consistency anchor ──
    const refBase: ReferenceImage[] = loadReferenceImages(charactersByIds(ids));
    const customImages = Array.isArray(body.customCharacterImages)
      ? (body.customCharacterImages as Array<{ data?: string; mimeType?: string }>)
      : [];
    for (const ci of customImages) {
      if (ci?.data && ci?.mimeType) refBase.push({ data: ci.data, mimeType: ci.mimeType, name: "a custom story character" });
    }
    let anchor: ReferenceImage | null = null;
    const voiceId = String(body.voiceId || "") || undefined;

    async function doScene(i: number): Promise<void> {
      const scene = script.scenes[i];
      const refs = anchor && i > 0 ? [...refBase, anchor] : refBase;
      const [img, audio] = await Promise.all([
        generateSceneImage(scene, script.heroDescription, refs).catch((e: Error) => {
          console.error(`[job ${id}] scene ${i + 1} image: ${e.message}`);
          return null;
        }),
        narrateScene(scene, voiceId).catch((e: Error) => {
          console.error(`[job ${id}] scene ${i + 1} audio: ${e.message}`);
          return null;
        }),
      ]);
      if (!img) return; // retry rounds below
      const payload = {
        index: scene.index,
        imageUrl: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
        ...(audio ? { audioUrl: `data:audio/mpeg;base64,${audio.toString("base64")}` } : {}),
      };
      const url = await putJson(`jobs/${id}/scene-${i}.json`, payload);
      st.sceneUrls![i] = url;
      st.done = Object.keys(st.sceneUrls!).length;
      await write();
      if (i === 0 && !anchor) {
        anchor = { data: img.buffer.toString("base64"), mimeType: img.mimeType, label: ANCHOR_LABEL };
      }
    }

    // Scene 1 first (anchor), then the rest in parallel
    await doScene(0);
    let idx = 1;
    async function worker() {
      while (idx < total) { const i = idx++; await doScene(i); }
    }
    await Promise.all(Array.from({ length: Math.min(3, Math.max(0, total - 1)) }, worker));

    // Verification rounds — the job is done only when every image exists
    for (let round = 0; round < 2; round++) {
      const missing = [...Array(total).keys()].filter(i => !st.sceneUrls![i]);
      if (missing.length === 0) break;
      for (const i of missing) await doScene(i);
    }

    st.phase = "done";
    await write();
  } catch (e) {
    st.phase = "error";
    st.error = e instanceof Error ? e.message : String(e);
    await write();
  }
}

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const body = await req.json();
    const id = crypto.randomUUID();
    const job = runJob(id, body);
    try { waitUntil(job); } catch { /* local dev — the promise runs in-process */ }
    return NextResponse.json({ jobId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
