// Serverový běh generování pohádky (sdílený mezi /api/job/start a
// /api/job/continue). Job je NAVAZOVACÍ: stav i hotové scény se průběžně
// ukládají do Vercel Blob, takže když funkce narazí na časový limit (5 min),
// další volání runJob naváže přesně tam, kde předchozí skončilo — přeskočí
// napsaný příběh i hotové scény a dodělá jen chybějící.

import { put, head } from "@vercel/blob";
import { generateStory, extractPdfBrief, type StoryExtras } from "@/lib/claude";
import { generateSceneImage, isDailyQuotaError } from "@/lib/gemini";
import { narrateScene } from "@/lib/elevenlabs";
import { charactersByIds, loadCharacters, type ReferenceImage } from "@/lib/characters";
import { loadPortraitRefs } from "@/lib/portraits";
import { themeById } from "@/lib/themes";
import type { StoryRequest, Character, Scene, StoryChoiceMeta } from "@/lib/types";
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
  /** 🔀 Dva konce: scenesScript = společný děj + konec A + konec B */
  choice?: StoryChoiceMeta;
  /** Kolikrát se psaní příběhu restartovalo (kick bez hotového scénáře) */
  restarts?: number;
  /** Souhrn vloženého PDF — dělá se jednou, restarty ho už nečtou znovu */
  pdfBrief?: string;
  /** Poslední chyba před restartem — jinak ji restart přepsal a nebyla vidět */
  lastError?: string;
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

  // Navázání: existující stav (napsaný příběh + hotové scény) se přeskočí.
  // I job ve stavu error se scénami naváže (např. po resetu denní kvóty) —
  // dokreslí jen chybějící obrázky, nepíše a nekreslí celou pohádku znovu.
  const prev = await readJson<JobStatus>(statusPath);
  const st: JobStatus =
    prev && prev.scenesScript?.length
      ? { ...prev, error: undefined, imgError: undefined }
      : {
          phase: "writing",
          createdAt: prev?.createdAt ?? Date.now(),
          voiceId: String(body.voiceId || ""),
          // Restart psaní (kick bez hotového scénáře) dřív MAZAL chybovou
          // hlášku — job vypadal věčně jako „Píšu…". Teď se chyba přenáší
          // a po 3. restartu se job zastaví s viditelnou příčinou.
          restarts: prev ? (prev.restarts ?? 0) + 1 : 0,
          lastError: prev?.error || prev?.lastError,
          pdfBrief: prev?.pdfBrief,
        };
  const write = () => {
    st.updatedAt = Date.now();
    return putJson(statusPath, st).catch(e => console.error(`[job ${id}] status write failed:`, e));
  };

  if (!st.scenesScript?.length && (st.restarts ?? 0) >= 3) {
    st.phase = "error";
    st.error = `Psaní příběhu opakovaně selhává${st.lastError ? ` (${st.lastError.slice(0, 200)})` : ""} — zrušte pohádku ✕ a zadejte ji znovu, případně s méně stránkami.`;
    await write();
    return;
  }

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

      // Velké PDF přišlo jako odkaz do vlastního Blob úložiště → stáhnout
      let pdfBase64 = (body.inspirationPdfBase64 as string) || undefined;
      if (!pdfBase64 && typeof body.inspirationPdfUrl === "string") {
        try {
          const u = new URL(body.inspirationPdfUrl);
          if (u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com")) {
            const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
            if (r.ok) {
              const buf = Buffer.from(await r.arrayBuffer());
              if (buf.length <= 11 * 1024 * 1024) pdfBase64 = buf.toString("base64");
            }
          }
        } catch {}
      }

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
        twoEndings: !!body.twoEndings,
        moral: body.moral ? String(body.moral).slice(0, 300) : undefined,
        previousStory: (body.previousStory as { title?: unknown; text?: unknown } | undefined)?.title
          ? {
              title: String((body.previousStory as { title: unknown }).title).slice(0, 200),
              text: String((body.previousStory as { text?: unknown }).text || "").slice(0, 4000),
            }
          : undefined,
      };
      // PDF se do psaní nedává celé (velký dokument nepustil psaní do limitu
      // funkce) — jednou se shrne do briefu, který se uloží k jobu
      if (pdfBase64 && !st.pdfBrief) {
        await write();
        try {
          st.pdfBrief = await extractPdfBrief(storyReq.language === "en" ? "en" : "cs", pdfBase64);
          await write();
        } catch (e) {
          console.warn(`[job ${id}] pdf brief failed:`, e instanceof Error ? e.message : e);
        }
      }

      const extras: StoryExtras = {
        customCharacters: rawCustom,
        inspirationImages: Array.isArray(body.inspirationImages) ? (body.inspirationImages as StoryExtras["inspirationImages"]) : [],
        pdfBriefText: st.pdfBrief || undefined,
        inspirationUrlText: urlText || undefined,
      };

      // Navázání psaní po restartu: rozepsaný text z minulého běhu se načte
      // a Claude POKRAČUJE tam, kde funkce umřela (prefill odpovědi) —
      // dlouhé pohádky (dva konce, hodně stránek) se dřív po timeoutu
      // psaly pořád znovu OD NULY a nikdy se nedopsaly.
      let resumeText = "";
      if ((st.restarts ?? 0) > 0) {
        const partial = await readJson<{ text?: string }>(`jobs/${id}/partial.json`);
        if (partial?.text && partial.text.length > 500) {
          resumeText = partial.text;
          console.log(`[job ${id}] resuming story from ${resumeText.length} chars`);
        }
      }

      // Heartbeat během psaní: stream průběžně obnovuje updatedAt (klient
      // nehlásí falešné zaseknutí) a UKLÁDÁ rozepsaný text pro navázání
      let lastBeat = Date.now();
      let latestText = resumeText;
      const script = await generateStory(storyReq, extras, (_chars, fullText) => {
        latestText = fullText;
        const now = Date.now();
        if (now - lastBeat > 20_000) {
          lastBeat = now;
          write();
          putJson(`jobs/${id}/partial.json`, { text: latestText })
            .catch(e => console.warn(`[job ${id}] partial write failed:`, e));
        }
      }, resumeText || undefined);
      st.title = script.title;
      st.heroDescription = script.heroDescription;
      // 🔀 Dva konce: konec B se generuje hned za koncem A (jeden seznam scén)
      if (script.choice) {
        st.choice = {
          common: script.choice.afterScene,
          altFrom: script.scenes.length,
          options: script.choice.options,
        };
        st.scenesScript = [...script.scenes, ...script.choice.altScenes];
      } else {
        st.scenesScript = script.scenes;
      }
      st.total = st.scenesScript.length;
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

    // Měření spotřeby: kolik obrázků a znaků hlasu vznikne V TOMTO běhu
    // (při navázání se už hotové scény nepočítají znovu)
    const imagesAtStart = Object.keys(st.sceneUrls).length;
    let voiceChars = 0;

    // ── 2) Scenes (Gemini + ElevenLabs) with the consistency anchor ──
    // Referencí postav jsou MALOVANÉ PORTRÉTY z kartotéky (jednou nakreslené,
    // pak jen čtené) — stejná podoba v každé pohádce + méně QA překreslení
    const ids: string[] = Array.isArray(body.characterIds) ? (body.characterIds as string[]) : [];
    const refBase: ReferenceImage[] = await loadPortraitRefs(charactersByIds(ids));
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

    // Denní kvóta Gemini vyčerpaná → STOP celého jobu. Každý další pokus by
    // jen pálil požadavky (limit je 1000/den/model) — reset je až o půlnoci PT.
    let quotaExhausted = false;

    async function doScene(i: number): Promise<void> {
      if (st.sceneUrls![i] || quotaExhausted) return; // hotová / kvóta vyčerpaná
      const scene = scenesScript[i];
      const refs = anchor && i > 0 ? [...refBase, anchor] : refBase;
      const [img, audio] = await Promise.all([
        generateSceneImage(scene, heroDescription, refs).catch((e: Error) => {
          console.error(`[job ${id}] scene ${i + 1} image: ${e.message}`);
          st.imgError = e.message.slice(0, 220);
          if (isDailyQuotaError(e.message)) quotaExhausted = true;
          return null;
        }),
        narrateScene(scene, voiceId).catch((e: Error) => {
          console.error(`[job ${id}] scene ${i + 1} audio: ${e.message}`);
          return null;
        }),
      ]);
      if (audio) voiceChars += scene.narration.length;
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
    for (let round = 0; round < 2 && !quotaExhausted; round++) {
      const missing = [...Array(total).keys()].filter(i => !st.sceneUrls![i]);
      if (missing.length === 0) break;
      for (const i of missing) await doScene(i);
    }

    // Denní kvóta vyčerpaná uprostřed práce → jasná chyba, žádné další pokusy
    if (quotaExhausted && Object.keys(st.sceneUrls!).length < total) {
      st.phase = "error";
      st.error = `Vyčerpán denní limit kreslení Gemini (${Object.keys(st.sceneUrls!).length}/${total} obrázků hotovo). Resetuje se kolem 9:00 ráno — pak pohádku zadejte znovu.`;
      await write();
      await writeUsageRecord(Object.keys(st.sceneUrls!).length - imagesAtStart, voiceChars, typeof body.deviceId === "string" ? body.deviceId : undefined);
      return;
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
    await writeUsageRecord(Object.keys(st.sceneUrls!).length - imagesAtStart, voiceChars, typeof body.deviceId === "string" ? body.deviceId : undefined);
  } catch (e) {
    st.phase = "error";
    st.error = e instanceof Error ? e.message : String(e);
    st.lastError = st.error;
    await write();
  }
}

// Záznam spotřeby pro panel 💰: počet obrázků a znaků hlasu z tohoto běhu.
// Data jsou v NÁZVU souboru (usage/u<ts>-i<obrázky>-c<znaky>.json) — /api/usage
// je sečte pouhým výpisem, bez stahování obsahu. Úklid jobs/ se jich nedotkne.
async function writeUsageRecord(images: number, chars: number, device?: string): Promise<void> {
  if (images <= 0 && chars <= 0) return;
  const dev = (device || "").replace(/[^a-z0-9]/gi, "").slice(0, 12);
  try {
    await put(`usage/u${Date.now()}-i${images}-c${chars}${dev ? `-d${dev}` : ""}.json`, "1", {
      access: "public",
      addRandomSuffix: false,
      contentType: "application/json",
      token: blobToken(),
    });
  } catch (e) {
    console.warn("[usage] record failed:", e instanceof Error ? e.message : e);
  }
}
