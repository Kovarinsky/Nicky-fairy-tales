// Serverový běh generování pohádky (sdílený mezi /api/job/start a
// /api/job/continue). Job je NAVAZOVACÍ: stav i hotové scény se průběžně
// ukládají do Vercel Blob, takže když funkce narazí na časový limit (5 min),
// další volání runJob naváže přesně tam, kde předchozí skončilo — přeskočí
// napsaný příběh i hotové scény a dodělá jen chybějící.

import { put, head } from "@vercel/blob";
import { generateStory, type StoryExtras } from "@/lib/claude";
import { generateSceneImage } from "@/lib/gemini";
import { narrateScene } from "@/lib/elevenlabs";
import { charactersByIds, loadCharacters, loadReferenceImages, type ReferenceImage } from "@/lib/characters";
import { themeById } from "@/lib/themes";
import type { StoryRequest, Character, Scene } from "@/lib/types";
import { blobToken } from "@/lib/blob-token";

const ANCHOR_LABEL =
  "CONSISTENCY ANCHOR — an illustration from THIS SAME story. Copy from it EXACTLY: every character's design, clothing, hair, body size and the relative heights between characters, the art style, AND every recurring object. The car keeps the identical body type, shape, colors and details in this scene (a sedan stays a sedan — it never becomes a different car):";

export const MAX_SCENES = 20;

export interface JobStatus {
  phase: "writing" | "generating" | "done" | "error";
  createdAt: number;
  updatedAt?: number;   // heartbeat — klient podle něj pozná umřelou funkci
  voiceId: string;
  title?: string;
  heroDescription?: string;
  scenesScript?: Scene[];
  total?: number;
  done?: number;
  sceneUrls?: Record<number, string>;
  error?: string;
  /** Poslední chyba kreslení obrázku (429 kvóta, billing…) — ukazuje se v UI */
  imgError?: string;
}

export async function putJson(path: string, data: unknown): Promise<string> {
  const blob = await put(path, JSON.stringify(data), {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
    token: blobToken(),
  });
  return blob.url;
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const h = await head(path, { token: blobToken() });
    const res = await fetch(`${h.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
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

export async function runJob(id: string, body: Record<string, unknown>) {
  const statusPath = `jobs/${id}/status.json`;

  // Navázání: existující stav (napsaný příběh + hotové scény) se přeskočí
  const prev = await readJson<JobStatus>(statusPath);
  const st: JobStatus =
    prev && prev.phase !== "error" && prev.scenesScript?.length
      ? { ...prev }
      : { phase: "writing", createdAt: Date.now(), voiceId: String(body.voiceId || "") };
  const write = () => {
    st.updatedAt = Date.now();
    return putJson(statusPath, st).catch(e => console.error(`[job ${id}] status write failed:`, e));
  };

  try {
    if (!st.scenesScript?.length) {
      // ── 1) Story (Claude) — same inputs as /api/story ──
      st.phase = "writing";
      await write();
      const topic = String(body.topic || "").trim();
      const theme = body.themeId ? themeById(String(body.themeId)) : undefined;
      const ids: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
      let characters: Character[] = ids.length ? charactersByIds(ids) : loadCharacters();
      if (characters.length === 0) characters = [{ id: "hero", name: "Hrdina", description: "a young child" }];

      const rawCustom = Array.isArray(body.customCharacters) ? (body.customCharacters as StoryExtras["customCharacters"]) : [];
      const urlText = body.inspirationUrl ? await fetchUrlText(String(body.inspirationUrl)) : "";

      // Vlastní svět (téma podle fotky/popisu) má přednost před předdefinovaným
      const rawCustomTheme = body.customTheme as { name?: unknown; prompt?: unknown } | undefined;
      const customTheme = rawCustomTheme && typeof rawCustomTheme.prompt === "string"
        ? { name: String(rawCustomTheme.name || "Vlastní svět"), prompt: String(rawCustomTheme.prompt).slice(0, 1200) }
        : undefined;

      const storyReq: StoryRequest = {
        topic,
        themeName: customTheme?.name ?? theme?.name,
        themePrompt: customTheme?.prompt ?? theme?.prompt,
        characters,
        age: Number(body.age) || 4,
        sceneCount: Math.min(Math.max(Number(body.sceneCount) || 6, 1), MAX_SCENES),
        language: String(body.language || "cs") === "en" ? "en" : "cs",
      };
      const extras: StoryExtras = {
        customCharacters: rawCustom,
        inspirationImages: Array.isArray(body.inspirationImages) ? (body.inspirationImages as StoryExtras["inspirationImages"]) : [],
        inspirationPdfBase64: (body.inspirationPdfBase64 as string) || undefined,
        inspirationUrlText: urlText || undefined,
      };

      const script = await generateStory(storyReq, extras);
      st.title = script.title;
      st.heroDescription = script.heroDescription;
      st.scenesScript = script.scenes;
      st.total = script.scenes.length;
      st.done = 0;
      st.sceneUrls = {};
    }

    const scenesScript = st.scenesScript!;
    const heroDescription = st.heroDescription || "";
    const total = scenesScript.length;
    st.phase = "generating";
    st.sceneUrls = st.sceneUrls || {};
    st.done = Object.keys(st.sceneUrls).length;
    await write();

    // ── 2) Scenes (Gemini + ElevenLabs) with the consistency anchor ──
    const ids: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
    const refBase: ReferenceImage[] = loadReferenceImages(charactersByIds(ids));
    const customImages = Array.isArray(body.customCharacterImages)
      ? (body.customCharacterImages as Array<{ data?: string; mimeType?: string }>)
      : [];
    for (const ci of customImages) {
      if (ci?.data && ci?.mimeType) refBase.push({ data: ci.data, mimeType: ci.mimeType, name: "a custom story character" });
    }

    let anchor: ReferenceImage | null = null;
    // Navázání: kotva konzistence = už hotová scéna 1 z minulého běhu
    if (st.sceneUrls[0]) {
      try {
        const s0 = await fetch(st.sceneUrls[0], { cache: "no-store" }).then(r => (r.ok ? r.json() : null));
        const m = typeof s0?.imageUrl === "string" ? s0.imageUrl.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/) : null;
        if (m) anchor = { data: m[2], mimeType: m[1], label: ANCHOR_LABEL };
      } catch {}
    }
    const voiceId = String(body.voiceId || "") || undefined;

    async function doScene(i: number): Promise<void> {
      if (st.sceneUrls![i]) return; // už hotová z předchozího běhu
      const scene = scenesScript[i];
      const refs = anchor && i > 0 ? [...refBase, anchor] : refBase;
      const [img, audio] = await Promise.all([
        generateSceneImage(scene, heroDescription, refs).catch((e: Error) => {
          console.error(`[job ${id}] scene ${i + 1} image: ${e.message}`);
          st.imgError = e.message.slice(0, 220);
          return null;
        }),
        narrateScene(scene, voiceId).catch((e: Error) => {
          console.error(`[job ${id}] scene ${i + 1} audio: ${e.message}`);
          return null;
        }),
      ]);
      if (!img) { await write(); return; } // retry rounds below; chybu vidí klient
      st.imgError = undefined;
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

    // Ani jeden obrázek = viditelná chyba (typicky vyčerpaná kvóta / billing
    // Gemini) místo „hotové" pohádky plné prázdných stránek
    if (Object.keys(st.sceneUrls!).length === 0) {
      st.phase = "error";
      st.error = st.imgError ? `Obrázky se nekreslí: ${st.imgError}` : "Obrázky se nekreslí (Gemini nevrátil žádný obrázek)";
      await write();
      return;
    }

    st.phase = "done";
    await write();
  } catch (e) {
    st.phase = "error";
    st.error = e instanceof Error ? e.message : String(e);
    await write();
  }
}
