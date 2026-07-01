"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { StoryScript, RenderedScene, Scene } from "@/lib/types";
import { AmbientPlayer } from "@/lib/ambient";
import { cacheStory, getCachedStory, evictOldStories } from "@/lib/scene-cache";
import { APP_VERSION } from "@/lib/version";

// ── Local types ─────────────────────────────────────────────────────────────
interface CharOption { id: string; name: string; }
interface ThemeOption { id: string; name: string; emoji: string; }
interface VoiceOption { id: string; name: string; emoji: string; description: string; language: string; }
interface CustomChar {
  id: string; name: string; description: string;
  photoBase64?: string; photoMimeType?: string; previewUrl?: string;
}
interface InspImage { data: string; mimeType: string; previewUrl: string; name: string; }

interface HistoryEntry {
  id: string;
  title: string;
  heroDescription: string;
  createdAt: string;
  scenes: Scene[];            // script only – no media
  selectedIds: string[];
  themeId: string;
  topic: string;
}

const HISTORY_KEY = "nicky-story-history";
const HISTORY_MAX = 10;
const SETTINGS_KEY = "nicky-settings";
const DRAFT_KEY = "nicky-story-draft";

function loadHistory(): HistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch { return []; }
}

function saveHistory(entry: HistoryEntry) {
  try {
    const prev = loadHistory().filter(e => e.id !== entry.id);
    localStorage.setItem(HISTORY_KEY, JSON.stringify([entry, ...prev].slice(0, HISTORY_MAX)));
  } catch { /* localStorage full – silently ignore */ }
}

interface SavedSettings {
  selectedVoiceId?: string;
  sceneCount?: number;
  selectedTheme?: string;
  selectedIds?: string[];
}

function loadSettings(): SavedSettings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  } catch { return {}; }
}

function saveSettings(s: SavedSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

function estimateStorySize(sceneCount: number): string {
  // ~400 KB per scene stored as base64 (220 KB JPEG image + 60 KB MP3 audio, ×1.33 base64)
  const mb = Math.round(sceneCount * 0.4 * 10) / 10;
  return `~${mb} MB`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Safely parse JSON — if the server returns plain text (Vercel 500, rate-limit page, etc.)
// give a readable error instead of "Unexpected token 'A'..."
async function safeJson<T = unknown>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    const preview = text.slice(0, 180).replace(/\s+/g, " ");
    throw new Error(`Nečekaná odpověď serveru (HTTP ${res.status}): ${preview}`);
  }
}

async function resizeAndEncode(file: File, maxPx = 800): Promise<{ data: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(objectUrl);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      resolve({ data: dataUrl.split(",")[1], mimeType: "image/jpeg", previewUrl: dataUrl });
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Nelze načíst obrázek")); };
    img.src = objectUrl;
  });
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getTargetAge(ids: string[]): number {
  const n = ids.includes("nicolas"), v = ids.includes("valentyna");
  if (n && v) return 4; if (v) return 2; if (n) return 6; return 6;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("cs-CZ", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function Home() {
  // Form state
  const [chars, setChars] = useState<CharOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [selectedVoiceId, setSelectedVoiceId] = useState("");
  const [customChars, setCustomChars] = useState<CustomChar[]>([]);
  const [selectedCustomIds, setSelectedCustomIds] = useState<string[]>([]);
  const [addingChar, setAddingChar] = useState(false);
  const [newCharName, setNewCharName] = useState("");
  const [newCharDesc, setNewCharDesc] = useState("");
  const [newCharPhoto, setNewCharPhoto] = useState<{ data: string; mimeType: string; previewUrl: string } | null>(null);
  const charPhotoRef = useRef<HTMLInputElement>(null);
  const [topic, setTopic] = useState("");
  const [inspImages, setInspImages] = useState<InspImage[]>([]);
  const [inspUrlActive, setInspUrlActive] = useState(false);
  const [inspUrl, setInspUrl] = useState("");
  const [inspPdf, setInspPdf] = useState<{ base64: string; name: string } | null>(null);
  const inspImageRef = useRef<HTMLInputElement>(null);
  const inspPdfRef = useRef<HTMLInputElement>(null);
  const [sceneCount, setSceneCount] = useState(6);

  // Generation state
  const [loading, setLoading] = useState(false);
  const [doneCount, setDoneCount] = useState(0);
  const [status, setStatus] = useState("");
  type SceneStatus = "waiting" | "generating" | "done" | "error";
  const [sceneStatuses, setSceneStatuses] = useState<SceneStatus[]>([]);
  const [error, setError] = useState("");

  // Story / reader state
  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState<RenderedScene[]>([]);
  const [page, setPage] = useState(0);
  const [slideKey, setSlideKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const hideControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showCredits, setShowCredits] = useState(false);
  const [regenAudio, setRegenAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ambientRef = useRef<AmbientPlayer | null>(null);
  const pendingPageRef = useRef<number | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // History
  const [storyHistory, setStoryHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const allScenesReady = scenes.length > 0 && scenes.every(s => s.imageUrl && s.audioUrl);
  // bookReady: all images present (SVG fallback always set) — use for UI display and FS trigger
  const bookReady = scenes.length > 0 && scenes.every(s => s.imageUrl);

  // Reader mode: explicit switch so old story stays in memory when form opens
  const [viewMode, setViewMode] = useState<"form" | "reader">("form");
  const readerMode = viewMode === "reader";

  // Background generation state
  const [bgStatus, setBgStatus] = useState<"idle" | "writing" | "generating" | "done">("idle");
  const [bgProgress, setBgProgress] = useState({ done: 0, total: 0 });
  const bgBufferRef = useRef<RenderedScene[]>([]);
  const bgTitleRef = useRef<string>("");

  // In-memory cache: history entry id → fully rendered scenes (images + audio)
  const renderedMapRef = useRef<Map<string, RenderedScene[]>>(new Map());

  // ── Boot ──
  useEffect(() => {
    const saved = loadSettings();
    if (saved.sceneCount !== undefined && saved.sceneCount >= 3 && saved.sceneCount <= 15) {
      setSceneCount(saved.sceneCount);
    }
    fetch("/api/characters").then(r => r.json()).then(d => {
      const list: CharOption[] = d.characters || [];
      setChars(list);
      if (saved.selectedIds && saved.selectedIds.length > 0) {
        const validIds = new Set(list.map(c => c.id));
        const filtered = saved.selectedIds.filter(id => validIds.has(id));
        setSelectedIds(filtered.length > 0 ? filtered : list.map(c => c.id));
      } else {
        setSelectedIds(list.map(c => c.id));
      }
    }).catch(() => {});
    fetch("/api/themes").then(r => r.json()).then(d => {
      setThemes(d.themes || []);
      if (saved.selectedTheme) setSelectedTheme(saved.selectedTheme);
    }).catch(() => {});
    fetch("/api/voices").then(r => r.json()).then(d => {
      const list: VoiceOption[] = d.voices || [];
      setVoices(list);
      if (saved.selectedVoiceId && list.some(v => v.id === saved.selectedVoiceId)) {
        setSelectedVoiceId(saved.selectedVoiceId);
      } else if (list.length > 0) {
        setSelectedVoiceId(list[0].id);
      }
    }).catch(() => {});
    setStoryHistory(loadHistory());

    // Restore story interrupted by window switch
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft?.scenes?.length > 0 && draft.title) {
          setTitle(draft.title);
          setScenes(draft.scenes);
          setPage(draft.page ?? 0);
          setViewMode("reader");
        }
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {}
  }, []);

  // ── Save draft on window switch (Android background kill) ──
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && scenes.length > 0 && viewMode === "reader") {
        try {
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ title, scenes, page }));
        } catch {}
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [scenes, title, page, viewMode]);

  // ── Ambient music lifecycle ──
  useEffect(() => {
    ambientRef.current = new AmbientPlayer();
    return () => { ambientRef.current?.destroy(); };
  }, []);

  // Toggle on/off
  useEffect(() => {
    if (musicOn) ambientRef.current?.start();
    else ambientRef.current?.stop();
  }, [musicOn]);

  // Ducking: 5% during narration, 22% otherwise
  useEffect(() => {
    ambientRef.current?.setVolume(isPlaying ? 0.05 : 0.22);
  }, [isPlaying]);

  // Switch soundscape when page changes
  useEffect(() => {
    if (!bookReady) return;
    ambientRef.current?.setScene(scenes[page]?.soundscape);
  }, [page, bookReady, scenes]);

  // Fullscreen: sync state only on EXTERNAL exit (Escape key, gesture)
  // The class is set immediately in toggleFullscreen() for instant CSS response
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) {
        setIsFullscreen(false);
        setShowControls(false);
        if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
        document.body.classList.remove("is-fullscreen");
      }
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.body.classList.remove("is-fullscreen");
    };
  }, []);

  // Intro fanfare + fullscreen when reader opens
  const introFiredRef = useRef(false);
  useEffect(() => {
    if (!bookReady || viewMode !== "reader" || introFiredRef.current) return;
    introFiredRef.current = true;
    ambientRef.current?.playIntro();
    ambientRef.current?.setScene(scenes[0]?.soundscape);
    // Set fullscreen state + class IMMEDIATELY (works on iOS too; don't wait for fullscreenchange)
    setIsFullscreen(true);
    setShowControls(false);
    document.body.classList.add("is-fullscreen");
    document.documentElement.requestFullscreen?.().catch(() => {});
  }, [bookReady, viewMode, scenes]);

  // Reset intro flag when new story starts
  useEffect(() => {
    if (scenes.length === 0) introFiredRef.current = false;
  }, [scenes.length]);

  // Scroll progress into view when loading starts (mobile UX)
  useEffect(() => {
    if (loading) setTimeout(() => progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [loading]);

  // ── Auto-play narration after slide animation ──
  // Only auto-plays when triggered by audio-end advance or first story load — not manual navigation.
  const isAutoAdvanceRef = useRef(false);
  const currentAudioUrl = scenes[page]?.audioUrl;
  useEffect(() => {
    if (!currentAudioUrl || !bookReady) return;
    if (!isAutoAdvanceRef.current) return;
    isAutoAdvanceRef.current = false;
    const t = setTimeout(() => audioRef.current?.play().catch(() => {}), 420);
    return () => clearTimeout(t);
  }, [page, currentAudioUrl, allScenesReady]);

  // ── Swipe navigation ──
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  function handleTouchStart(e: React.TouchEvent) {
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  }
  function handleTouchEnd(e: React.TouchEvent) {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    const dy = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    // require 30px horizontal movement and horizontal > vertical (2:1 ratio)
    if (Math.abs(dx) < 30 || Math.abs(dx) < Math.abs(dy) * 2) return;
    if (dx < 0 && hasNext) goToPage(page + 1);
    else if (dx > 0 && hasPrev) goToPage(page - 1);
  }

  // ── Fullscreen ──
  function toggleFullscreen() {
    const newFs = !isFullscreen;
    setIsFullscreen(newFs);
    setShowControls(false);
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    document.body.classList.toggle("is-fullscreen", newFs);
    if (newFs) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }

  // ── Tap to show/hide controls in fullscreen ──
  function handleBookTap() {
    if (!isFullscreen) return;
    if (hideControlsTimerRef.current) clearTimeout(hideControlsTimerRef.current);
    setShowControls(true);
    hideControlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }

  // ── Reset to form (keeps old story in memory for "go back") ──
  function resetToForm() {
    audioRef.current?.pause();
    setIsPlaying(false);
    setViewMode("form");
    setIsFullscreen(false);
    document.body.classList.remove("is-fullscreen");
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }

  // ── Switch to completed background story ──
  function switchToBgStory() {
    audioRef.current?.pause();
    setIsPlaying(false);
    const newScenes = [...bgBufferRef.current];
    const newTitle = bgTitleRef.current;
    bgBufferRef.current = [];
    bgTitleRef.current = "";
    setBgStatus("idle");
    setBgProgress({ done: 0, total: 0 });
    introFiredRef.current = false;
    setTitle(newTitle);
    setScenes(newScenes);
    setPage(0);
    setSlideKey(k => k + 1);
    setViewMode("reader");
  }

  // ── Navigation ──
  const goToPage = useCallback((n: number) => {
    if (n < 0 || n >= scenes.length) return;
    audioRef.current?.pause();
    setIsPlaying(false);
    setPage(n);
    setSlideKey(k => k + 1);
  }, [scenes.length]);

  function handleAudioEnded() {
    setIsPlaying(false);
    if (!autoAdvance) return;
    const next = page + 1;
    if (next >= scenes.length) {
      // Last scene — show rolling credits
      setTimeout(() => setShowCredits(true), 800);
      return;
    }
    if (scenes[next]?.imageUrl && scenes[next]?.audioUrl) {
      isAutoAdvanceRef.current = true; // allow auto-play on the next slide
      setTimeout(() => goToPage(next), 1200);
    } else {
      pendingPageRef.current = next;
    }
  }

  // ── Voice switch in reader — audio-only regeneration ──────────────────────
  async function switchVoice(newVoiceId: string) {
    if (newVoiceId === selectedVoiceId || regenAudio) return;
    setSelectedVoiceId(newVoiceId);
    audioRef.current?.pause();
    setIsPlaying(false);
    setRegenAudio(true);

    const CONCURRENCY = 3;
    let idx = 0;
    const tasks = scenes.map((scene, i) => async () => {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scene, audioOnly: true, voiceId: newVoiceId }),
      });
      const data = await safeJson<{ audioUrl?: string; error?: string }>(res);
      if (!res.ok) return;
      setScenes(prev => {
        const next = [...prev];
        next[i] = { ...next[i], audioUrl: data.audioUrl };
        return next;
      });
    });

    async function worker() {
      while (idx < tasks.length) { const i = idx++; await tasks[i](); }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
    setRegenAudio(false);
  }

  // Fire pending advance when a scene finishes generating
  useEffect(() => {
    const p = pendingPageRef.current;
    if (p === null) return;
    if (scenes[p]?.imageUrl && scenes[p]?.audioUrl) {
      pendingPageRef.current = null;
      isAutoAdvanceRef.current = true; // allow auto-play for pending advance
      goToPage(p);
    }
  }, [scenes, goToPage]);

  function togglePlay() {
    const a = audioRef.current; if (!a) return;
    isPlaying ? a.pause() : a.play().catch(() => {});
  }

  // ── Core: generate media for a script ────────────────────────────────────
  async function generateMedia(
    scriptTitle: string,
    heroDescription: string,
    scriptScenes: Scene[],
    customImageRefs: Array<{ data: string; mimeType: string }>,
    voiceId: string,
    background = false
  ): Promise<RenderedScene[]> {
    // Local tracking array — returned at end for caching
    const localScenes: RenderedScene[] = scriptScenes.map(s => ({ ...s }));

    if (background) {
      bgTitleRef.current = scriptTitle;
      bgBufferRef.current = localScenes;  // share reference
      setBgStatus("generating");
      setBgProgress({ done: 0, total: scriptScenes.length });
    } else {
      setTitle(scriptTitle);
      setScenes([...localScenes]);
      setPage(0);
      setSlideKey(0);
      setDoneCount(0);
      setSceneStatuses(scriptScenes.map(() => "waiting"));
      setStatus(`🎨 Generuji ${scriptScenes.length} scén...`);
    }

    const CONCURRENCY = 1;
    let completed = 0;

    const tasks = scriptScenes.map((scene, i) => async () => {
      if (!background) setSceneStatuses(prev => { const n = [...prev]; n[i] = "generating"; return n; });
      try {
        const res = await fetch("/api/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scene,
            heroDescription,
            characterIds: selectedIds,
            customCharacterImages: customImageRefs,
            voiceId: voiceId || undefined,
          }),
        });
        const media = await safeJson<{ imageUrl?: string; audioUrl?: string; error?: string; imageDebug?: string }>(res);
        if (media.imageDebug) console.warn(`[Gemini debug] scene ${i + 1}:`, media.imageDebug);
        if (!res.ok) throw new Error(media.error || `Scéna ${i + 1} selhala.`);
        localScenes[i] = { ...localScenes[i], imageUrl: media.imageUrl, audioUrl: media.audioUrl };
        completed++;
        if (background) {
          setBgProgress({ done: completed, total: scriptScenes.length });
        } else {
          setDoneCount(completed);
          setScenes([...localScenes]);
          setSceneStatuses(prev => { const n = [...prev]; n[i] = "done"; return n; });
        }
      } catch {
        if (!background) setSceneStatuses(prev => { const n = [...prev]; n[i] = "error"; return n; });
      }
    });

    let idx = 0;
    async function worker() {
      while (idx < tasks.length) { const i = idx++; await tasks[i](); }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));

    if (background) setBgStatus("done");
    return localScenes;
  }

  // ── Create story (full flow) ──────────────────────────────────────────────
  async function createStory(e: React.FormEvent) {
    e.preventDefault();
    const background = bookReady; // run in bg if current story (images) already visible
    setError("");
    if (!background) {
      setScenes([]); setTitle(""); setPage(0);
      introFiredRef.current = false;
    } else {
      setBgStatus("writing");
      setBgProgress({ done: 0, total: 0 });
    }
    setLoading(true);
    try {
      setStatus("✍️ Claude vymýšlí příběh...");
      const selectedCustomObjs = customChars.filter(c => selectedCustomIds.includes(c.id));

      const storyRes = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify({
          topic, themeId: selectedTheme || undefined,
          characterIds: selectedIds,
          age: getTargetAge([...selectedIds, ...selectedCustomIds]),
          sceneCount,
          language: voices.find(v => v.id === selectedVoiceId)?.language ?? "cs",
          customCharacters: selectedCustomObjs.map(c => ({
            id: c.id, name: c.name,
            description: c.description,
            photoBase64: c.photoBase64,
            photoMimeType: c.photoMimeType,
          })),
          inspirationUrl: inspUrlActive && inspUrl.trim() ? inspUrl.trim() : undefined,
          inspirationImages: inspImages.map(i => ({ data: i.data, mimeType: i.mimeType })),
          inspirationPdfBase64: inspPdf?.base64 || undefined,
        }),
      });
      const script = await safeJson<StoryScript & { error?: string }>(storyRes);
      if (!storyRes.ok) throw new Error(script.error || "Nepodařilo se vytvořit příběh.");

      // Save to history immediately (text only, before slow image generation)
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        title: script.title,
        heroDescription: script.heroDescription,
        createdAt: new Date().toISOString(),
        scenes: script.scenes,
        selectedIds,
        themeId: selectedTheme,
        topic,
      };
      saveHistory(entry);
      setStoryHistory(loadHistory());

      const customImageRefs = selectedCustomObjs
        .filter(c => c.photoBase64 && c.photoMimeType)
        .map(c => ({ data: c.photoBase64!, mimeType: c.photoMimeType! }));

      saveSettings({ selectedVoiceId, sceneCount, selectedTheme, selectedIds });
      const finalScenes = await generateMedia(script.title, script.heroDescription, script.scenes, customImageRefs, selectedVoiceId, background);
      renderedMapRef.current.set(entry.id, finalScenes);
      // Cache even if some audio failed — imageUrl always has SVG fallback
      cacheStory(entry.id, finalScenes).catch(() => {});
      evictOldStories(loadHistory().map(e => e.id)).catch(() => {});
      if (!background) {
        setStatus("✨ Pohádka je připravena!");
        setViewMode("reader");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Něco se pokazilo.");
      setStatus("");
      if (background) setBgStatus("idle");
    } finally {
      setLoading(false);
    }
  }

  // ── Replay from history ───────────────────────────────────────────────────
  async function replayStory(entry: HistoryEntry) {
    // Helper: switch to a set of ready scenes without interrupting bg generation
    function showCached(readyScenes: RenderedScene[]) {
      audioRef.current?.pause();
      setIsPlaying(false);
      introFiredRef.current = false;
      setTitle(entry.title);
      setScenes([...readyScenes]);
      setPage(0);
      setSlideKey(k => k + 1);
      setViewMode("reader");
      setHistoryOpen(false);
    }

    // 1. Instant restore from in-memory ref (bg generation continues uninterrupted)
    const memCached = renderedMapRef.current.get(entry.id);
    if (memCached && memCached.length > 0) {
      showCached(memCached);
      return;
    }

    // 2. Try IndexedDB — survives PWA restart (bg generation continues uninterrupted)
    const dbCached = await getCachedStory(entry.id);
    if (dbCached && dbCached.length > 0) {
      const restored: RenderedScene[] = entry.scenes.map((s, i) => ({
        ...s,
        imageUrl: dbCached[i]?.imageUrl,
        audioUrl: dbCached[i]?.audioUrl,
      }));
      renderedMapRef.current.set(entry.id, restored);
      showCached(restored);
      return;
    }

    // 3. Cache miss — full regeneration only when nothing else is running
    if (loading || bgStatus !== "idle") {
      // Background gen in progress — can't regenerate now; user sees the toast when it's done
      setHistoryOpen(false);
      return;
    }
    setError(""); setLoading(true);
    setHistoryOpen(false);
    setScenes([]); setTitle(""); setPage(0);
    introFiredRef.current = false;
    try {
      const finalScenes = await generateMedia(entry.title, entry.heroDescription, entry.scenes, [], selectedVoiceId);
      renderedMapRef.current.set(entry.id, finalScenes);
      cacheStory(entry.id, finalScenes).catch(() => {});
      setStatus("✨ Pohádka je připravena!");
      setViewMode("reader");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generování selhalo.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  // ── Form helpers ─────────────────────────────────────────────────────────
  function toggleChar(id: string) {
    setSelectedIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }
  function toggleCustomChar(id: string) {
    setSelectedCustomIds(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }
  async function handleCharPhoto(file: File) {
    const r = await resizeAndEncode(file, 800).catch(() => null);
    if (r) setNewCharPhoto(r);
  }
  function addCustomChar() {
    if (!newCharName.trim()) return;
    const id = `custom_${Date.now()}`;
    setCustomChars(p => [...p, {
      id, name: newCharName.trim(),
      description: newCharDesc.trim() || `a character named ${newCharName.trim()}`,
      photoBase64: newCharPhoto?.data, photoMimeType: newCharPhoto?.mimeType, previewUrl: newCharPhoto?.previewUrl,
    }]);
    setSelectedCustomIds(p => [...p, id]);
    setAddingChar(false); setNewCharName(""); setNewCharDesc(""); setNewCharPhoto(null);
  }
  function removeCustomChar(id: string) {
    setCustomChars(p => p.filter(c => c.id !== id));
    setSelectedCustomIds(p => p.filter(x => x !== id));
  }
  async function handleInspImage(file: File) {
    if (inspImages.length >= 3) return;
    const r = await resizeAndEncode(file, 512).catch(() => null);
    if (r) setInspImages(p => [...p, { ...r, name: file.name }]);
  }
  async function handleInspPdf(file: File) {
    if (file.size > 3.5 * 1024 * 1024) { alert("PDF je příliš velké (max 3.5 MB)."); return; }
    const b = await fileToBase64(file).catch(() => null);
    if (b) setInspPdf({ base64: b, name: file.name });
  }

  const allSelectedCount = selectedIds.length + selectedCustomIds.length;
  const hasInspiration = !!selectedTheme || !!topic.trim() || inspImages.length > 0 || !!inspPdf || (inspUrlActive && !!inspUrl.trim());
  const current = scenes[page];
  const hasNext = page < scenes.length - 1;
  const hasPrev = page > 0;
  const totalScenes = scenes.length;

  // Inline styles for fullscreen — guaranteed to override any CSS cascade/specificity issue
  const fsContainer: React.CSSProperties = readerMode && isFullscreen ? {
    position: 'fixed', inset: '0', maxWidth: '100%', padding: '0',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  } : {};
  const fsBook: React.CSSProperties = isFullscreen ? {
    position: 'fixed', inset: '0', zIndex: 10,
    display: 'flex', flexDirection: 'column',
    margin: '0', overflow: 'hidden',
  } : {};
  const fsBookCard: React.CSSProperties = isFullscreen ? {
    display: 'grid',
    gridTemplateRows: 'auto 1fr auto auto', // image=16:9 fixed, body fills rest, controls/dots auto
    gridTemplateColumns: 'minmax(0, 1fr)',
    flex: '1 1 0', minHeight: '0',
    borderRadius: '0', margin: '0', overflow: 'hidden',
    boxShadow: 'none', animation: 'none',
  } : {};
  const fsBody: React.CSSProperties = isFullscreen ? {
    minHeight: 0, overflowY: 'auto',
    padding: '0.75rem 1.1rem 0.5rem',
    display: 'flex', flexDirection: 'column', justifyContent: 'center',
  } : {};
  const fsControls: React.CSSProperties = isFullscreen ? {
    flexShrink: 0, padding: '0.45rem 1rem 0.5rem',
    opacity: showControls ? 1 : 0,
    pointerEvents: showControls ? 'auto' : 'none',
    transition: 'opacity 0.3s ease',
  } : {};
  const fsDots: React.CSSProperties = isFullscreen ? {
    flexShrink: 0, padding: '0.3rem 1rem 0.45rem', marginTop: '0',
    opacity: showControls ? 1 : 0,
    pointerEvents: showControls ? 'auto' : 'none',
    transition: 'opacity 0.3s ease',
  } : {};

  return (
    <div className={readerMode ? "container reader-mode" : "container"} style={fsContainer}>

      {!readerMode && (
      <>
      <h1>📖 Nickyho pohádky <span className="version-badge">v{APP_VERSION}</span></h1>
      <p className="subtitle">Vyber postavy, téma a inspiraci – pohádka s obrázky a tatínkovým hlasem.</p>

      {/* ── Vrátit se na starší pohádku ── */}
      {bookReady && (
        <button type="button" className="btn-return-story" onClick={() => setViewMode("reader")}>
          ▶ Zpět na „{title}"
        </button>
      )}

      {/* ── FORM ── */}
      <form className="form" onSubmit={createStory}>

        {(chars.length > 0 || customChars.length > 0) && (
          <div className="field">
            <label>Kdo v pohádce vystupuje?</label>
            <div className="chips">
              {chars.map(c => (
                <label key={c.id} className={`chip ${selectedIds.includes(c.id) ? "chip-on" : ""}`}>
                  <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleChar(c.id)} />
                  {c.name}
                </label>
              ))}
              {customChars.map(c => (
                <div key={c.id} className={`chip custom-chip ${selectedCustomIds.includes(c.id) ? "chip-on" : ""}`}>
                  {c.previewUrl && <img src={c.previewUrl} alt={c.name} className="chip-avatar" />}
                  <span className="chip-label" onClick={() => toggleCustomChar(c.id)}>{c.name}</span>
                  <button type="button" className="chip-remove" onClick={() => removeCustomChar(c.id)}>×</button>
                </div>
              ))}
              <button type="button" className={`chip chip-btn ${addingChar ? "chip-on" : ""}`} onClick={() => setAddingChar(p => !p)}>
                {addingChar ? "✕ Zrušit" : "+ Vlastní postava"}
              </button>
            </div>
          </div>
        )}

        {addingChar && (
          <div className="add-char-panel">
            <p className="panel-title">Nová postava</p>
            <div className="field">
              <label>Jméno *</label>
              <input type="text" value={newCharName} onChange={e => setNewCharName(e.target.value)} placeholder="Kubík, Pohádková víla, Dráček..." autoFocus />
            </div>
            <div className="field">
              <label>Popis (nepovinné)</label>
              <textarea value={newCharDesc} onChange={e => setNewCharDesc(e.target.value)} placeholder="Malý hnědý medvídek s červenou mašlí..." />
            </div>
            <div className="field">
              <label>Fotka postavy (nepovinné)</label>
              <div className="file-row">
                <button type="button" className="outline-btn" onClick={() => charPhotoRef.current?.click()}>
                  📷 {newCharPhoto ? "Změnit" : "Nahrát fotku"}
                </button>
                {newCharPhoto && <img src={newCharPhoto.previewUrl} alt="náhled" className="mini-preview" />}
              </div>
              <input ref={charPhotoRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleCharPhoto(f); e.target.value = ""; }} />
            </div>
            <div className="file-row">
              <button type="button" onClick={addCustomChar} disabled={!newCharName.trim()}>Přidat postavu</button>
              <button type="button" className="outline-btn" onClick={() => { setAddingChar(false); setNewCharName(""); setNewCharDesc(""); setNewCharPhoto(null); }}>Zrušit</button>
            </div>
          </div>
        )}

        {themes.length > 0 && (
          <div className="field">
            <label>Svět pohádky</label>
            <div className="chips">
              {themes.map(t => (
                <button type="button" key={t.id} className={`chip chip-btn ${selectedTheme === t.id ? "chip-on" : ""}`}
                  onClick={() => setSelectedTheme(p => p === t.id ? "" : t.id)}>
                  <span>{t.emoji}</span> {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {voices.length > 1 && (
          <div className="field">
            <label>Hlas vypravěče</label>
            <div className="chips">
              {voices.map(v => (
                <button type="button" key={v.id}
                  className={`chip chip-btn ${selectedVoiceId === v.id ? "chip-on" : ""}`}
                  onClick={() => setSelectedVoiceId(v.id)}
                  title={v.description}>
                  <span>{v.emoji}</span> {v.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label>Přání & inspirace</label>
          <textarea value={topic} onChange={e => setTopic(e.target.value)} placeholder="Vlastní zápletka nebo přání (nepovinné)..." />
          <div className="insp-row">
            <button type="button" className={`insp-btn ${inspImages.length > 0 ? "chip-on" : ""}`}
              onClick={() => inspImageRef.current?.click()} disabled={inspImages.length >= 3}>
              📷 Foto{inspImages.length > 0 ? ` (${inspImages.length})` : ""}
            </button>
            <button type="button" className={`insp-btn ${inspUrlActive ? "chip-on" : ""}`} onClick={() => setInspUrlActive(p => !p)}>🔗 Web odkaz</button>
            <button type="button" className={`insp-btn ${inspPdf ? "chip-on" : ""}`} onClick={() => inspPdfRef.current?.click()}>📄 PDF{inspPdf ? " ✓" : ""}</button>
          </div>
          <input ref={inspImageRef} type="file" accept="image/*" multiple style={{ display: "none" }}
            onChange={async e => { for (const f of Array.from(e.target.files || []).slice(0, 3 - inspImages.length)) await handleInspImage(f); e.target.value = ""; }} />
          <input ref={inspPdfRef} type="file" accept=".pdf,application/pdf" style={{ display: "none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleInspPdf(f); e.target.value = ""; }} />
          {inspUrlActive && <input type="url" value={inspUrl} onChange={e => setInspUrl(e.target.value)} placeholder="https://cs.wikipedia.org/wiki/Krteček" className="url-input" />}
          {inspImages.length > 0 && (
            <div className="insp-previews">
              {inspImages.map((img, i) => (
                <div key={i} className="preview-item">
                  <img src={img.previewUrl} alt={img.name} className="preview-thumb" />
                  <button type="button" className="preview-remove" onClick={() => setInspImages(p => p.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
            </div>
          )}
          {inspPdf && (
            <div className="insp-pdf-row">
              <span>📄 {inspPdf.name}</span>
              <button type="button" className="preview-remove-inline" onClick={() => setInspPdf(null)}>×</button>
            </div>
          )}
        </div>

        <div className="field">
          <label>Počet stránek: {sceneCount}</label>
          <input type="range" min={3} max={15} value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))} />
        </div>

        <div className="field">
          <label>Hudba</label>
          <label className={`chip ${musicOn ? "chip-on" : ""}`} style={{display:"flex", justifyContent:"center"}}>
            <input type="checkbox" checked={musicOn} onChange={() => setMusicOn(p => !p)} />
            {musicOn ? "🎵 Zapnuta" : "🔇 Vypnuta"}
          </label>
        </div>

        {loading && bgStatus === "idle" ? (
          <div className="btn-progress" ref={progressRef}>
            <div className="btn-progress-label">{status}</div>
            <div className="btn-progress-track">
              {scenes.length === 0
                ? <div className="btn-progress-shimmer" />
                : <div className="btn-progress-fill" style={{ width: `${Math.round((doneCount / totalScenes) * 100)}%` }}>
                    <span className="btn-progress-pct">{Math.round((doneCount / totalScenes) * 100)}%</span>
                  </div>
              }
            </div>
            <div className="gen-cards" style={{ marginTop: '0.7rem' }}>
              {(scenes.length > 0 ? scenes : Array(sceneCount).fill(null)).map((s, i) => {
                const st = s ? (sceneStatuses[i] ?? "waiting") : "waiting";
                return (
                  <div key={i} className={`gen-card gen-card-${st}`}>
                    {s?.imageUrl
                      ? <img src={s.imageUrl} alt={`Scéna ${i + 1}`} className="gen-card-img" />
                      : <div className="gen-card-placeholder">
                          {st === "generating" && <div className="gen-card-spinner" />}
                          {st === "error" && <span className="gen-card-icon">⚠️</span>}
                          {st === "waiting" && <span className="gen-card-icon">⏳</span>}
                        </div>
                    }
                    <span className="gen-card-label">
                      {st === "done" ? "✓" : st === "error" ? "!" : st === "generating" ? "🎨" : ""} {i + 1}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <button type="submit" className="btn-create" disabled={loading || allSelectedCount === 0 || !hasInspiration}>
            ✨ Vytvořit pohádku
          </button>
        )}
      </form>

      {/* ── HISTORY ── */}
      {storyHistory.length > 0 && (
        <div className="history-box">
          <button type="button" className="history-toggle" onClick={() => setHistoryOpen(p => !p)}>
            📚 Poslední pohádky ({storyHistory.length}) {historyOpen ? "▲" : "▼"}
          </button>
          {historyOpen && (
            <div className="history-list">
              {storyHistory.map(entry => (
                <button key={entry.id} type="button" className="history-item"
                  onClick={() => replayStory(entry)}
                  disabled={loading && bgStatus === "idle"}>
                  <div className="history-item-body">
                    <span className="history-title">{entry.title}</span>
                    <div className="history-badges">
                      <span className="history-badge badge-offline">📥 offline</span>
                      <span className="history-badge badge-size">{estimateStorySize(entry.scenes.length)}</span>
                      <span className="history-badge badge-scenes">{entry.scenes.length} scén</span>
                    </div>
                    <span className="history-date">{fmtDate(entry.createdAt)}</span>
                  </div>
                  <span className="history-play-btn">▶</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      </>
      )}


      {!readerMode && status && !loading && <p className="status">{status}</p>}
      {!readerMode && error && <p className="error">⚠️ {error}</p>}

      {/* ── BOOK – shown when all scene images are ready (audio may be partial) ── */}
      {bookReady && current && (
        <div className="book" style={fsBook}>
          <button type="button" className="back-btn"
            style={isFullscreen ? { display: 'none' } : undefined}
            onClick={resetToForm}>
            ← Nová pohádka
          </button>
          <h2 className="book-title"
            style={isFullscreen ? { flexShrink: 0, fontSize: '1rem', marginBottom: '0', padding: '0.4rem 1rem 0.3rem' } : undefined}>
            {title}
          </h2>

          <div className="book-card" key={slideKey} style={fsBookCard}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={handleBookTap}
          >
            {isFullscreen ? (
              // flex: 1 1 0 + min-height: 0 lets the image fill remaining space after title/text/controls/dots
              current.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={current.imageUrl} alt={`Scéna ${page + 1}`}
                  style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block', flexShrink: 0 }} />
              ) : (
                <div style={{ width: '100%', aspectRatio: '16/9', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', background: 'linear-gradient(135deg,#1a0a3e 0%,#2d0d52 50%,#1a0a3e 100%)', color: 'rgba(255,255,255,0.7)', fontSize: '1rem', fontWeight: 700 }}>
                  <div className="placeholder-spinner" />
                  <span>🎨 Generuji scénu {page + 1}...</span>
                </div>
              )
            ) : (
              current.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="page-image" src={current.imageUrl} alt={`Scéna ${page + 1}`} />
              ) : (
                <div className="page-image placeholder">
                  <div className="placeholder-spinner" />
                  <span>🎨 Generuji scénu {page + 1}...</span>
                </div>
              )
            )}

            <div className="page-body" style={fsBody}>
              <p className="page-text">{current.narration}</p>
            </div>

            <div className="book-controls" style={fsControls}>
              <button type="button" className="ctrl-btn ctrl-nav" onClick={() => goToPage(page - 1)} disabled={!hasPrev} aria-label="Předchozí">←</button>

              <button type="button" className={`ctrl-btn ctrl-play ${!current.audioUrl || regenAudio ? "ctrl-loading" : ""}`}
                onClick={togglePlay} disabled={!current.audioUrl || regenAudio} aria-label={isPlaying ? "Pauza" : "Přehrát"}>
                {regenAudio ? "⏳" : !current.audioUrl ? "⏳" : isPlaying ? "⏸" : "▶"}
              </button>

              <span className="ctrl-counter">{page + 1} / {scenes.length}</span>

              <button type="button" className={`ctrl-btn ctrl-auto ${autoAdvance ? "ctrl-auto-on" : ""}`}
                onClick={() => setAutoAdvance(p => !p)} title={autoAdvance ? "Auto-přechod zapnut" : "Auto-přechod vypnut"}>
                {autoAdvance ? "🔁" : "🔂"}
              </button>

              {/* Voice cycle button — only when multiple voices available */}
              {voices.length > 1 && (
                <button type="button" className={`ctrl-btn ctrl-auto ${regenAudio ? "ctrl-loading" : "ctrl-auto-on"}`}
                  onClick={() => {
                    const idx = voices.findIndex(v => v.id === selectedVoiceId);
                    const next = voices[(idx + 1) % voices.length];
                    switchVoice(next.id);
                  }}
                  disabled={regenAudio}
                  title={`Hlas: ${voices.find(v => v.id === selectedVoiceId)?.name ?? "?"} — klikni pro přepnutí`}
                >
                  {regenAudio ? "⏳" : (voices.find(v => v.id === selectedVoiceId)?.emoji ?? "🎙️")}
                </button>
              )}

              <button type="button" className={`ctrl-btn ctrl-mute ${musicOn ? "ctrl-mute-on" : ""}`}
                onClick={() => setMusicOn(p => !p)}
                title={musicOn ? "Vypnout hudbu" : "Zapnout hudbu"}
                aria-label={musicOn ? "Vypnout hudbu" : "Zapnout hudbu"}
              >
                {musicOn ? "🎵" : "🔇"}
              </button>

              <button type="button" className={`ctrl-btn ctrl-fullscreen ${isFullscreen ? "ctrl-fullscreen-on" : ""}`}
                onClick={toggleFullscreen}
                title={isFullscreen ? "Ukoncit fullscreen" : "Fullscreen"}
                aria-label={isFullscreen ? "Ukoncit fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? "⊡" : "⛶"}
              </button>

              <button type="button" className="ctrl-btn ctrl-home"
                onClick={resetToForm}
                title="Hlavní stránka"
                aria-label="Hlavní stránka"
              >
                🏠
              </button>

              <button type="button" className="ctrl-btn ctrl-nav" onClick={() => goToPage(page + 1)} disabled={!hasNext} aria-label="Další">→</button>
            </div>

            {scenes.length > 1 && (
              <div className="page-dots" style={fsDots}>
                {scenes.map((_, i) => (
                  <button key={i} type="button"
                    className={`dot ${i === page ? "dot-active" : ""} ${scenes[i]?.audioUrl ? "dot-ready" : ""}`}
                    onClick={() => goToPage(i)} aria-label={`Strana ${i + 1}`} />
                ))}
              </div>
            )}
          </div>

          {current.audioUrl && (
            <audio ref={audioRef} key={current.audioUrl} src={current.audioUrl}
              onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={handleAudioEnded} />
          )}
        </div>
      )}

      {/* ── ROLLING CREDITS ── */}
      {/* ── BACKGROUND GENERATION TOAST ── */}
      {bgStatus !== "idle" && (
        <div className="bg-toast">
          {bgStatus === "writing" && <span>✍️ Píšu novou pohádku...</span>}
          {bgStatus === "generating" && (
            <span>🎨 {bgProgress.done} / {bgProgress.total} scén</span>
          )}
          {bgStatus === "done" && (
            <>
              <span>✨ Nová pohádka je hotová!</span>
              <button type="button" className="bg-toast-btn" onClick={switchToBgStory}>▶ Otevřít</button>
            </>
          )}
        </div>
      )}

      {showCredits && (
        <div className="credits-overlay" onClick={() => setShowCredits(false)}>
          <div className="credits-scroll">
            <div className="credits-content">
              <p className="credits-end">✨ Konec ✨</p>
              <p className="credits-title">{title}</p>

              <p className="credits-section">Příběh</p>
              <p className="credits-item">Claude Opus — scénář a narrace</p>
              <p className="credits-item">Google Gemini — ilustrace</p>
              <p className="credits-item">ElevenLabs — hlas vypravěče</p>

              <p className="credits-section">Hrdinové</p>
              {scenes.length > 0 && (
                <p className="credits-item">
                  Nicolásek &amp; Valentýnka
                </p>
              )}

              <p className="credits-section">Vytvořeno s láskou</p>
              <p className="credits-item">pro Nickyho pohádky</p>
              <p className="credits-item">© {new Date().getFullYear()}</p>

              <p className="credits-tap">— klikni pro zavření —</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
