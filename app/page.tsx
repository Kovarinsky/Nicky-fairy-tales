"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { StoryScript, RenderedScene, Scene } from "@/lib/types";
import { AmbientPlayer } from "@/lib/ambient";
import { cacheStory, getCachedStory, evictOldStories } from "@/lib/scene-cache";
import { APP_VERSION } from "@/lib/version";
import { UI, UI_LANG_KEY, type UILang } from "@/lib/i18n";
import { BG_SCENES, bgSceneById, THEME_BG } from "@/lib/backgrounds";

// ── Local types ─────────────────────────────────────────────────────────────
interface CharOption { id: string; name: string; nameEn?: string; }
interface ThemeOption { id: string; name: string; nameEn?: string; emoji: string; }
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
const CUSTOM_CHARS_KEY = "nicky-custom-chars";
const CUSTOM_THEMES_KEY = "nicky-custom-themes";
const JOB_KEY = "nicky-pending-job";
const SERVER_JOB_KEY = "nicky-server-job";
const HISTORY_MAX = 20; // offline zásoba: posledních 20 pohádek v telefonu
const SETTINGS_KEY = "nicky-settings";
const DRAFT_KEY = "nicky-story-draft";
const BG_KEY = "nicky-bg"; // "auto" | id světa pozadí (lib/backgrounds.ts)

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

// SVG data-URL = server-side fallback when Gemini failed to draw the scene
function isPlaceholderImg(url?: string): boolean {
  return !url || url.startsWith("data:image/svg");
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
  const [stalled, setStalled] = useState(false);
  const lastProgressRef = useRef(0);
  const [fixingScene, setFixingScene] = useState<number | null>(null);
  // Context of the last generation — needed for single-scene image repair
  const heroDescRef = useRef("");
  const imageRefsRef = useRef<Array<{ data: string; mimeType: string }>>([]);
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
  const [musicOn, setMusicOn] = useState(false); // ambient music/sounds off by default
  const [showCredits, setShowCredits] = useState(false);
  const [models, setModels] = useState<{ story: string; image: string } | null>(null);
  const goodnightCacheRef = useRef<{ key: string; url: string } | null>(null);
  const goodnightAudioRef = useRef<HTMLAudioElement | null>(null);
  const [regenAudio, setRegenAudio] = useState(false);
  const [ctrlsOpen, setCtrlsOpen] = useState(false);
  const [forcedLs, setForcedLs] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ambientRef = useRef<AmbientPlayer | null>(null);
  const pendingPageRef = useRef<number | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const bookScrolledRef = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const pageBodyRef = useRef<HTMLDivElement>(null);
  const pageClipRef = useRef<HTMLDivElement>(null);
  const pageImgRef = useRef<HTMLImageElement>(null);
  const navRef = useRef<HTMLDivElement>(null);

  // History
  const [storyHistory, setStoryHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Usage overview (real spend via /api/usage)
  type UsageData = {
    claude?: { usd?: number; days?: number; error?: string };
    elevenlabs?: { used?: number; limit?: number; tier?: string; error?: string };
    czkRate?: number;
  };
  // Which queued story the gen-cards preview (tap a segment to switch)
  const [focusJobId, setFocusJobId] = useState<string | null>(null);

  const [usageOpen, setUsageOpen] = useState(false);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [usageErr, setUsageErr] = useState(false);
  function toggleUsage() {
    const next = !usageOpen;
    setUsageOpen(next);
    if (next && !usage) {
      setUsageErr(false);
      fetch("/api/usage", { signal: AbortSignal.timeout(20_000) })
        .then(r => r.json())
        .then(d => setUsage(d))
        .catch(() => setUsageErr(true));
    }
  }

  const allScenesReady = scenes.length > 0 && scenes.every(s => s.imageUrl && s.audioUrl);
  // bookReady: all images present (SVG fallback always set) — use for UI display and FS trigger
  const bookReady = scenes.length > 0 && scenes.every(s => s.imageUrl);

  // Reader mode: explicit switch so old story stays in memory when form opens
  const [viewMode, setViewMode] = useState<"form" | "reader">("form");
  const readerMode = viewMode === "reader";

  // UI language (CZ default; EN for Nicolas's foreign friends)
  const [uiLang, setUiLang] = useState<UILang>("cs");
  const t = UI[uiLang];
  function switchLang(l: UILang) {
    setUiLang(l);
    try { localStorage.setItem(UI_LANG_KEY, l); } catch {}
    // Match the narrator voice to the UI language when one exists
    const match = voices.find(v => v.language === (l === "cs" ? "cs" : "en"));
    if (match) setSelectedVoiceId(match.id);
  }

  // Background generation state (LOCAL in-browser pipeline)
  const [bgStatus, setBgStatus] = useState<"idle" | "writing" | "generating" | "done">("idle");
  const [bgProgress, setBgProgress] = useState({ done: 0, total: 0 });
  const bgBufferRef = useRef<RenderedScene[]>([]);
  const bgTitleRef = useRef<string>("");

  // Server jobs — a QUEUE: several fairy tales can generate on Vercel at once,
  // each gets its own toast row and the newest one drives the gen-cards
  type ServerJob = { jobId: string; phase: "writing" | "generating" | "done" | "error"; done: number; total: number; title?: string; error?: string; stalled?: boolean };
  const MAX_ACTIVE_JOBS = 3;
  const [serverJobs, setServerJobs] = useState<ServerJob[]>([]);
  // The ref is the synchronous source of truth (poll callbacks and the mount
  // resume mutate it back-to-back — state alone would race); state mirrors it
  const serverJobsRef = useRef<ServerJob[]>([]);
  const syncServerJobs = useCallback((next: ServerJob[]) => {
    serverJobsRef.current = next;
    setServerJobs(next);
    // Persist only unfinished job ids — finished stories live in history
    try {
      const ids = next.filter(j => j.phase === "writing" || j.phase === "generating").map(j => j.jobId);
      if (ids.length === 0) localStorage.removeItem(SERVER_JOB_KEY);
      else localStorage.setItem(SERVER_JOB_KEY, JSON.stringify({ jobs: ids }));
    } catch {}
  }, []);
  const updateServerJob = useCallback((jobId: string, patch: Partial<ServerJob>) => {
    syncServerJobs(serverJobsRef.current.map(j => (j.jobId === jobId ? { ...j, ...patch } : j)));
  }, [syncServerJobs]);
  const removeServerJob = useCallback((jobId: string) => {
    syncServerJobs(serverJobsRef.current.filter(j => j.jobId !== jobId));
  }, [syncServerJobs]);

  // In-memory cache: history entry id → fully rendered scenes (images + audio)
  const renderedMapRef = useRef<Map<string, RenderedScene[]>>(new Map());

  // ── Boot ──
  useEffect(() => {
    // 20 offline pohádek je až ~800 MB — požádat prohlížeč, ať cache nemaže
    try { navigator.storage?.persist?.().catch(() => {}); } catch {}
    // Úklid serverového úložiště i při startu aplikace (ne jen po dokončení
    // pohádky) — plné úložiště blokuje start nových jobů; max 1× za 6 h
    try {
      const last = Number(localStorage.getItem("nicky-cleanup2-at") || 0);
      if (Date.now() - last > 3600_000) {
        localStorage.setItem("nicky-cleanup2-at", String(Date.now()));
        let jobIds: string[] = [];
        try {
          const parsed = JSON.parse(localStorage.getItem(SERVER_JOB_KEY) || "{}");
          jobIds = Array.isArray(parsed?.jobs) ? parsed.jobs : parsed?.jobId ? [parsed.jobId] : [];
        } catch {}
        // Server nedrží hotové pohádky (jsou v telefonu) — chránit jen
        // rozpracované joby; ostatní starší 1 h se mažou
        fetch("/api/job/cleanup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ keepIds: jobIds }),
        }).catch(() => {});
      }
    } catch {}
    const saved = loadSettings();
    if (saved.sceneCount !== undefined && saved.sceneCount >= 3 && saved.sceneCount <= 20) {
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
    fetch("/api/models").then(r => r.json()).then(d => {
      if (d?.story) setModels({ story: d.story, image: d.image });
    }).catch(() => {});
    setStoryHistory(loadHistory());

    // Restore UI language
    try {
      const l = localStorage.getItem(UI_LANG_KEY);
      if (l === "cs" || l === "en") setUiLang(l);
    } catch {}

    // Restore saved custom characters (kept until deleted with ×)
    try {
      const raw = localStorage.getItem(CUSTOM_CHARS_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as CustomChar[];
        if (Array.isArray(saved) && saved.length > 0) {
          setCustomChars(saved.map(c => ({
            ...c,
            previewUrl: c.photoBase64 && c.photoMimeType
              ? `data:${c.photoMimeType};base64,${c.photoBase64}`
              : undefined,
          })));
        }
      }
    } catch {}

    // Restore story interrupted by window switch — only when every scene has
    // an image, otherwise the reader would open onto an empty dark page
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw);
        if (draft?.scenes?.length > 0 && draft.title
            && draft.scenes.every((s: RenderedScene) => s.imageUrl)) {
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
      if (document.hidden && scenes.length > 0 && scenes.every(s => s.imageUrl)) {
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

  // Intro fanfare when reader opens
  const introFiredRef = useRef(false);
  useEffect(() => {
    if (!bookReady || introFiredRef.current) return;
    introFiredRef.current = true;
    if (musicOn) ambientRef.current?.playIntro();
    ambientRef.current?.setScene(scenes[0]?.soundscape);
  }, [bookReady, viewMode, scenes, musicOn]);

  // Reset intro flag when new story starts
  useEffect(() => {
    if (scenes.length === 0) introFiredRef.current = false;
  }, [scenes.length]);

  // ── Anti-stuck guards ──────────────────────────────────────────────────────
  // 1) Keep the screen awake while generating (mobile Chrome freezes timers
  //    and kills fetches when the screen turns off / tab goes background)
  useEffect(() => {
    const active = loading || bgStatus === "generating";
    let lock: { release?: () => Promise<void> } | null = null;
    if (active && "wakeLock" in navigator) {
      (navigator as Navigator & { wakeLock: { request: (t: string) => Promise<never> } })
        .wakeLock.request("screen").then((l: { release?: () => Promise<void> }) => { lock = l; }).catch(() => {});
    }
    return () => { lock?.release?.().catch(() => {}); };
  }, [loading, bgStatus]);

  // 2) Stall watchdog: no scene finished for 2.5 min while generating → offer reload
  //    (the pending-job memory + progressive cache make the reload resume cleanly)
  useEffect(() => {
    const active = loading || bgStatus === "generating";
    if (!active) { setStalled(false); return; }
    const iv = setInterval(() => {
      if (lastProgressRef.current && Date.now() - lastProgressRef.current > 150_000) setStalled(true);
    }, 15_000);
    return () => clearInterval(iv);
  }, [loading, bgStatus]);

  // 3) Returning to a frozen tab with a stalled generation → auto-reload once
  useEffect(() => {
    function onVis() {
      if (document.visibilityState !== "visible") return;
      const active = loading || bgStatus === "generating";
      if (!active || !lastProgressRef.current) return;
      if (Date.now() - lastProgressRef.current > 150_000) {
        try {
          if (!sessionStorage.getItem("nicky-stall-reload")) {
            sessionStorage.setItem("nicky-stall-reload", "1");
            window.location.reload();
          }
        } catch {}
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [loading, bgStatus]);

  // ── Auto-resume an interrupted generation after reload/app kill ───────────
  const resumeFiredRef = useRef(false);
  useEffect(() => {
    if (resumeFiredRef.current) return;
    resumeFiredRef.current = true;
    (async () => {
      let job: { entryId: string; title: string; heroDescription: string; scenes: Scene[]; voiceId?: string; characterIds?: string[] } | null = null;
      try { job = JSON.parse(localStorage.getItem(JOB_KEY) || "null"); } catch {}
      if (!job?.entryId || !Array.isArray(job.scenes) || job.scenes.length === 0) return;
      // Reuse scenes already finished before the interruption
      const cached = await getCachedStory(job.entryId).catch(() => null);
      const merged: RenderedScene[] = job.scenes.map((s, i) => ({
        ...s,
        imageUrl: cached?.[i]?.imageUrl,
        audioUrl: cached?.[i]?.audioUrl,
      }));
      if (merged.every(s => !isPlaceholderImg(s.imageUrl) && s.audioUrl)) {
        try { localStorage.removeItem(JOB_KEY); } catch {}
        return;
      }
      if (job.characterIds?.length) setSelectedIds(job.characterIds);
      setLoading(true);
      try {
        // Background mode → progress toast; when done, the "Otevřít" toast appears
        const finalScenes = await generateMedia(
          job.title, job.heroDescription, job.scenes, [], job.voiceId || "", true, job.entryId, merged
        );
        renderedMapRef.current.set(job.entryId, finalScenes);
      } catch {} finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Safety net: the reader must never be an empty dark page — if there is no
  // story to show (e.g. a bad draft or an empty background buffer put us
  // here), fall back to the form so the menu is always reachable
  useEffect(() => {
    if (viewMode === "reader" && !bookReady) setViewMode("form");
  }, [viewMode, bookReady]);

  // Reader controls: show briefly when reader opens, then auto-hide
  useEffect(() => {
    if (viewMode === "reader") setCtrlsOpen(true);
  }, [viewMode]);
  useEffect(() => {
    if (!ctrlsOpen || viewMode !== "reader") return;
    const t = setTimeout(() => setCtrlsOpen(false), 6000);
    return () => clearTimeout(t);
  }, [ctrlsOpen, viewMode]);

  // Re-run layout-dependent effects when the device rotates (portrait ⇄ landscape)
  const [orientTick, setOrientTick] = useState(0);
  useEffect(() => {
    const onChange = () => setOrientTick(o => o + 1);
    const mq = window.matchMedia("(orientation: landscape)");
    mq.addEventListener("change", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, []);

  // Spoken "good night" when the credits roll at the end of the story
  useEffect(() => {
    if (!showCredits) {
      goodnightAudioRef.current?.pause();
      goodnightAudioRef.current = null;
      return;
    }
    const lang = voices.find(v => v.id === selectedVoiceId)?.language ?? "cs";
    const text = lang === "en"
      ? "Good night, Nicolas and Valentina. Sweet dreams!"
      : "Dobrou noc, Nicolásku a Valentýnko. Sladké sny!";
    const key = `${selectedVoiceId}|${lang}`;
    let cancelled = false;
    (async () => {
      try {
        let url = goodnightCacheRef.current?.key === key ? goodnightCacheRef.current.url : null;
        if (!url) {
          const res = await fetch("/api/scene", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(30_000),
            body: JSON.stringify({
              scene: { index: 0, narration: text, imagePrompt: "x" },
              audioOnly: true,
              voiceId: selectedVoiceId || undefined,
            }),
          });
          const data = await safeJson<{ audioUrl?: string }>(res);
          if (!res.ok || !data.audioUrl) return;
          url = data.audioUrl;
          goodnightCacheRef.current = { key, url };
        }
        if (cancelled) return;
        audioRef.current?.pause();
        const a = new Audio(url);
        goodnightAudioRef.current = a;
        a.play().catch(() => {});
      } catch {}
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showCredits]);

  // Clear inline nav positioning when leaving the reader (form layout uses CSS flow)
  useEffect(() => {
    if (viewMode === "reader") return;
    const nav = navRef.current;
    if (nav) { nav.style.top = ""; nav.style.left = ""; nav.style.width = ""; nav.style.right = ""; }
  }, [viewMode]);

  // Restart the subtitle roll from the top whenever narration starts playing
  const [rollTick, setRollTick] = useState(0);
  useEffect(() => {
    if (isPlaying) setRollTick(t => t + 1);
  }, [isPlaying]);

  // Rolling subtitles: long text scrolls slowly through the small window.
  // Portrait = vertical roll; landscape (single-line ticker) = horizontal roll.
  useEffect(() => {
    const el = pageBodyRef.current;
    if (!el || viewMode !== "reader") return;
    // Landscape: shrink the ticker to the image's DISPLAYED width (letterboxed
    // content, not the full screen); portrait uses the full width
    const imgEl = pageImgRef.current;
    const landscape = window.matchMedia("(orientation: landscape)").matches;
    if (landscape && imgEl && imgEl.naturalWidth > 0) {
      // Image now renders in a fixed 16:9 cover frame — ticker matches the frame width
      const r = imgEl.getBoundingClientRect();
      el.style.width = `${Math.round(r.width)}px`;
      el.style.marginLeft = "auto";
      el.style.marginRight = "auto";
    } else {
      el.style.width = "";
      el.style.marginLeft = "";
      el.style.marginRight = "";
    }
    // Nav arrows integrated INTO the image: vertically centered on it,
    // constrained to its displayed width
    const nav = navRef.current;
    const book = bookRef.current;
    if (nav && imgEl && book) {
      const br = book.getBoundingClientRect();
      const ir = imgEl.getBoundingClientRect();
      nav.style.top = `${Math.round(ir.top - br.top + ir.height / 2)}px`;
      nav.style.left = `${Math.round(ir.left - br.left)}px`;
      nav.style.width = `${Math.round(ir.width)}px`;
      nav.style.right = "auto";
    }
    el.scrollTop = 0;
    el.scrollLeft = 0;
    // Landscape: roluje vnitřní .page-clip (bílý rámeček stojí, text jede)
    const clip = pageClipRef.current;
    const scroller = landscape && clip ? clip : el;
    scroller.scrollLeft = 0;
    // Only the landscape single-line ticker rolls; portrait shows the whole text
    const overflow = scroller.scrollWidth - scroller.clientWidth;
    if (!landscape || overflow <= 0) return;
    // Synchronizace s hlasem: text dojede na konec ~2 s před koncem nahrávky.
    // Bez hlasu (nepřehrává se) fallback na konstantní rychlost.
    const audio = audioRef.current;
    const DELAY_MS = 2200;
    const SPEED = 40; // px/s (fallback)
    const fallbackDur = (overflow / SPEED) * 1000;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const dur = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
      const audioActive = audio && dur > 3 && (audio.currentTime > 0.05 || !audio.paused);
      let p: number;
      if (audioActive) {
        // Řízeno přímo pozicí v nahrávce — drží krok, pauza zastaví text
        p = Math.min(1, Math.max(0, (audio!.currentTime - 1.2) / Math.max(1, dur - 3.2)));
      } else {
        const e = t - start - DELAY_MS;
        p = Math.min(1, Math.max(0, e / fallbackDur));
      }
      scroller.scrollLeft = p * overflow;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [page, slideKey, viewMode, scenes, orientTick, rollTick]);

  // Scroll progress into view when loading starts (mobile UX)
  useEffect(() => {
    if (loading) setTimeout(() => progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }, [loading]);

  // Scroll to book section when it first becomes ready
  useEffect(() => {
    if (bookReady && !bookScrolledRef.current) {
      bookScrolledRef.current = true;
      setTimeout(() => bookRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    }
    if (!bookReady) bookScrolledRef.current = false;
  }, [bookReady]);

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
  }, [page, currentAudioUrl, allScenesReady, slideKey]);

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

  // ── Reset to form (keeps old story in memory for "go back") ──
  function resetToForm() {
    audioRef.current?.pause();
    setIsPlaying(false);
    setViewMode("form");
    try { localStorage.removeItem(DRAFT_KEY); } catch {}
  }

  // ── Switch to completed background story ──
  function switchToBgStory() {
    if (bgBufferRef.current.length === 0) { setBgStatus("idle"); return; }
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
      try {
        const res = await fetch("/api/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(60_000),
          // Only narration is needed for audio — sending the whole scene
          // (with base64 imageUrl) blows the request size limit
          body: JSON.stringify({
            scene: { index: scene.index, narration: scene.narration, imagePrompt: scene.imagePrompt },
            audioOnly: true,
            voiceId: newVoiceId,
          }),
        });
        const data = await safeJson<{ audioUrl?: string; error?: string }>(res);
        if (!res.ok || !data.audioUrl) return;
        setScenes(prev => {
          const next = [...prev];
          next[i] = { ...next[i], audioUrl: data.audioUrl };
          return next;
        });
      } catch {}
    });

    async function worker() {
      while (idx < tasks.length) { const i = idx++; await tasks[i](); }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
    } finally {
      setRegenAudio(false);
    }
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

  // ── Rotate button: force landscape without the system rotation toggle ─────
  // Orientation lock requires fullscreen on Android Chrome; both are reverted
  // when switching back. If the device doesn't support locking (iOS Safari),
  // the button silently does its best (fullscreen only).
  async function toggleForcedLandscape() {
    const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
    if (!forcedLs) {
      try { await document.documentElement.requestFullscreen?.(); } catch {}
      try { await so?.lock?.("landscape"); } catch {}
      setForcedLs(true);
    } else {
      try { so?.unlock?.(); } catch {}
      try { if (document.fullscreenElement) await document.exitFullscreen(); } catch {}
      setForcedLs(false);
    }
  }

  // Leaving fullscreen via system back → drop the forced-landscape state
  useEffect(() => {
    function onFsChange() {
      if (!document.fullscreenElement) setForcedLs(false);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  function togglePlay() {
    const a = audioRef.current; if (!a) return;
    if (isPlaying) {
      a.pause();
    } else {
      a.play().catch(() => {});
      setCtrlsOpen(false);              // hide the panel when narration starts
      if (viewMode !== "reader") setViewMode("reader"); // play from main screen → reader mode
    }
  }

  // ── Core: generate media for a script ────────────────────────────────────
  // entryId → the job is remembered (localStorage) and every finished scene is
  // cached progressively, so an interrupted generation resumes after reload.
  // `existing` lets a resume reuse already-finished scenes.
  async function generateMedia(
    scriptTitle: string,
    heroDescription: string,
    scriptScenes: Scene[],
    customImageRefs: Array<{ data: string; mimeType: string }>,
    voiceId: string,
    background = false,
    entryId?: string,
    existing?: RenderedScene[]
  ): Promise<RenderedScene[]> {
    // Local tracking array — returned at end for caching
    const localScenes: RenderedScene[] =
      existing && existing.length === scriptScenes.length
        ? existing.map(s => ({ ...s }))
        : scriptScenes.map(s => ({ ...s }));
    heroDescRef.current = heroDescription;
    imageRefsRef.current = customImageRefs;

    // Remember the job (script incl. text) until every image is verified
    if (entryId) {
      try {
        localStorage.setItem(JOB_KEY, JSON.stringify({
          entryId, title: scriptTitle, heroDescription,
          scenes: scriptScenes, voiceId, characterIds: selectedIds,
        }));
      } catch {}
    }

    const sceneNeedsWork = (s: RenderedScene) => isPlaceholderImg(s.imageUrl) || !s.audioUrl;
    // done = scene has a real (non-placeholder) image
    const realDone = () => localScenes.filter(s => !isPlaceholderImg(s.imageUrl)).length;

    if (background) {
      bgTitleRef.current = scriptTitle;
      bgBufferRef.current = localScenes;  // share reference
      setBgStatus("generating");
      setBgProgress({ done: realDone(), total: scriptScenes.length });
    } else {
      setTitle(scriptTitle);
      setScenes([...localScenes]);
      setPage(0);
      setSlideKey(0);
      setDoneCount(realDone());
      setSceneStatuses(localScenes.map(s => (sceneNeedsWork(s) ? "waiting" : "done")));
      setStatus(t.statusGenerating(scriptScenes.length));
    }

    // 2 scenes in parallel — Gemini/ElevenLabs handle it, halves total wait time
    const CONCURRENCY = 2;

    const publish = () => {
      lastProgressRef.current = Date.now();   // heartbeat for the stall watchdog
      if (background) {
        setBgProgress({ done: realDone(), total: scriptScenes.length });
      } else {
        setDoneCount(realDone());
        setScenes([...localScenes]);
      }
    };
    lastProgressRef.current = Date.now();

    // Consistency anchor: scene 1's finished image is sent as a visual
    // reference for every later scene (characters, sizes, style, objects)
    const anchorFrom = (url?: string) => {
      if (!url || isPlaceholderImg(url)) return undefined;
      const m = url.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/);
      return m ? { mimeType: m[1], data: m[2] } : undefined;
    };

    async function runScene(i: number) {
      if (!background) setSceneStatuses(prev => { const n = [...prev]; n[i] = "generating"; return n; });
      try {
        const res = await fetch("/api/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(90_000),
          body: JSON.stringify({
            scene: scriptScenes[i],
            heroDescription,
            characterIds: selectedIds,
            customCharacterImages: customImageRefs,
            voiceId: voiceId || undefined,
            ...(i > 0 ? { styleAnchor: anchorFrom(localScenes[0]?.imageUrl) } : {}),
          }),
        });
        const media = await safeJson<{ imageUrl?: string; audioUrl?: string; error?: string; imageDebug?: string }>(res);
        if (media.imageDebug) console.warn(`[Gemini debug] scene ${i + 1}:`, media.imageDebug);
        if (!res.ok) throw new Error(media.error || `Scéna ${i + 1} selhala.`);
        localScenes[i] = { ...localScenes[i], imageUrl: media.imageUrl, audioUrl: media.audioUrl };
        publish();
        if (!background) setSceneStatuses(prev => { const n = [...prev]; n[i] = isPlaceholderImg(media.imageUrl) ? "error" : "done"; return n; });
        // Progressive cache — a finished scene survives reload/app kill
        if (entryId && !isPlaceholderImg(media.imageUrl)) {
          cacheStory(entryId, localScenes).catch(() => {});
        }
      } catch {
        if (!background) setSceneStatuses(prev => { const n = [...prev]; n[i] = "error"; return n; });
      }
    }

    async function runPool(indices: number[]) {
      let idx = 0;
      async function worker() {
        while (idx < indices.length) { const i = indices[idx++]; await runScene(i); }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, indices.length) }, worker));
    }

    // First pass: only scenes that still need work (resume skips finished ones).
    // Scene 1 goes FIRST and alone — its image then anchors all other scenes.
    const initial = localScenes.map((s, i) => (sceneNeedsWork(s) ? i : -1)).filter(i => i >= 0);
    if (initial.includes(0)) {
      await runPool([0]);
    }
    await runPool(initial.filter(i => i !== 0));

    // Verification: the story is NOT complete until every image is real.
    // Up to 3 extra rounds with growing back-off retry the failed scenes.
    for (let round = 1; round <= 3; round++) {
      const failed = localScenes.map((s, i) => (isPlaceholderImg(s.imageUrl) ? i : -1)).filter(i => i >= 0);
      if (failed.length === 0) break;
      if (!background) setStatus(t.statusRepairing(failed.length));
      await new Promise(r => setTimeout(r, 2500 * round));
      await runPool(failed);
    }

    // Job is done only when everything is verified — otherwise it stays
    // remembered and resumes on the next app start
    const complete = localScenes.every(s => !isPlaceholderImg(s.imageUrl));
    if (entryId && complete) {
      try { localStorage.removeItem(JOB_KEY); } catch {}
      try { sessionStorage.removeItem("nicky-stall-reload"); } catch {}
    }
    setStalled(false);

    if (background) setBgStatus("done");
    return localScenes;
  }

  // ── Repair a single scene image (manual, from the reader) ─────────────────
  async function repairSceneImage(i: number) {
    const scene = scenes[i];
    if (!scene || fixingScene !== null) return;
    setFixingScene(i);
    // Anchor the repair to the story's first image for consistency
    const a0 = i > 0 ? scenes[0]?.imageUrl : undefined;
    const m = a0 && !isPlaceholderImg(a0) ? a0.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/) : null;
    try {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          scene,
          heroDescription: heroDescRef.current,
          characterIds: selectedIds,
          customCharacterImages: imageRefsRef.current,
          voiceId: selectedVoiceId || undefined,
          ...(m ? { styleAnchor: { mimeType: m[1], data: m[2] } } : {}),
        }),
      });
      const media = await safeJson<{ imageUrl?: string; audioUrl?: string; error?: string }>(res);
      if (res.ok && media.imageUrl && !isPlaceholderImg(media.imageUrl)) {
        setScenes(prev => {
          const n = [...prev];
          n[i] = { ...n[i], imageUrl: media.imageUrl, audioUrl: n[i].audioUrl || media.audioUrl };
          return n;
        });
      }
    } catch {} finally {
      setFixingScene(null);
    }
  }

  // ── Server-side job: the whole story generates ON Vercel; the phone only
  //    polls for the result — switching apps or locking the screen is fine ──
  const jobTimersRef = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  // Progressive download (per job): finished scenes stream in DURING generation,
  // so the final "open" is instant and gen-cards show real thumbnails
  const jobMediaRef = useRef<Map<string, { scenes: Map<number, { imageUrl?: string; audioUrl?: string }>; fetching: Set<number> }>>(new Map());
  // Per-job scene buffer for the gen-card thumbnails
  const jobBuffersRef = useRef<Map<string, RenderedScene[]>>(new Map());
  // Stall watch (per job): when the server function dies on the 5-min limit, kick /continue
  const jobStallRef = useRef<Map<string, { lastChange: number; lastSig: string; lastKick: number; fails404: number; manualKicks: number }>>(new Map());

  function stallStateFor(jobId: string) {
    let w = jobStallRef.current.get(jobId);
    if (!w) { w = { lastChange: 0, lastSig: "", lastKick: 0, fails404: 0, manualKicks: 0 }; jobStallRef.current.set(jobId, w); }
    return w;
  }

  function kickContinue(jobId: string) {
    return fetch("/api/job/continue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: jobId }),
    }).catch(() => null);
  }

  function stopJobPolling(jobId: string) {
    const tm = jobTimersRef.current.get(jobId);
    if (tm) { clearInterval(tm); jobTimersRef.current.delete(jobId); }
  }

  async function fetchSceneJson(url: string): Promise<{ imageUrl?: string; audioUrl?: string } | null> {
    // 2 attempts — a hiccup while downloading one scene must not lose it
    for (let a = 0; a < 2; a++) {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (r.ok) return await r.json();
      } catch {}
    }
    return null;
  }

  async function finalizeServerJob(st: { title?: string; heroDescription?: string; scenesScript?: Scene[]; sceneUrls?: Record<number, string>; total?: number; voiceId?: string }, jobId: string) {
    const script = st.scenesScript || [];
    const urls = st.sceneUrls || {};
    const pre = jobMediaRef.current.get(jobId)?.scenes ?? new Map<number, { imageUrl?: string; audioUrl?: string }>();
    const media = await Promise.all(script.map(async (_, i) => {
      const cached = pre.get(i);
      if (cached) return cached; // už staženo průběžně během generování
      if (!urls[i]) return null;
      return fetchSceneJson(urls[i]);
    }));
    // Missing image → SVG placeholder (same convention as /api/scene), so the
    // book still opens and shows the "redraw" button instead of nothing
    const missingSvg = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3C/svg%3E";
    const rendered: RenderedScene[] = script.map((s, i) => ({
      ...s,
      imageUrl: media[i]?.imageUrl || missingSvg,
      audioUrl: media[i]?.audioUrl,
    }));
    const entry: HistoryEntry = {
      id: jobId,
      title: st.title || "Pohádka",
      heroDescription: st.heroDescription || "",
      createdAt: new Date().toISOString(),
      scenes: script,
      selectedIds,
      themeId: selectedTheme,
      topic,
    };
    saveHistory(entry);
    setStoryHistory(loadHistory());
    heroDescRef.current = st.heroDescription || "";
    renderedMapRef.current.set(jobId, rendered);
    cacheStory(jobId, rendered).catch(() => {});
    evictOldStories(loadHistory().map(e => e.id)).catch(() => {});
    // Job row → „hotová ▶ Otevřít"; the finished story is no longer persisted
    // as a pending job (it lives in history + IndexedDB now)
    updateServerJob(jobId, {
      phase: "done",
      title: entry.title,
      done: rendered.filter(s => !isPlaceholderImg(s.imageUrl)).length,
      total: script.length,
    });
    // uvolnit průběžnou cache jobu
    jobMediaRef.current.delete(jobId);
    jobBuffersRef.current.delete(jobId);
    jobStallRef.current.delete(jobId);

    // Úklid Blob úložiště: tahle pohádka je stažená v telefonu → její
    // serverová data smazat hned; server nemusí držet žádné hotové pohádky
    // (chránit jen běžící joby, čerstvé chrání hodinová lhůta)
    try {
      fetch("/api/job/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deleteIds: [jobId],
          keepIds: serverJobsRef.current.filter(j => j.phase === "writing" || j.phase === "generating").map(j => j.jobId),
        }),
      }).catch(() => {});
    } catch {}
  }

  // Open a finished server story from its toast row
  async function openServerJob(job: ServerJob) {
    let rendered = renderedMapRef.current.get(job.jobId);
    if (!rendered || rendered.length === 0) {
      // Fallback: merge the history script with the IndexedDB media cache
      const entry = loadHistory().find(e => e.id === job.jobId);
      const dbCached = await getCachedStory(job.jobId).catch(() => null);
      if (entry && dbCached && dbCached.length > 0) {
        rendered = entry.scenes.map((s, i) => ({ ...s, imageUrl: dbCached[i]?.imageUrl, audioUrl: dbCached[i]?.audioUrl }));
      }
    }
    if (!rendered || rendered.length === 0) { removeServerJob(job.jobId); return; }
    audioRef.current?.pause();
    setIsPlaying(false);
    introFiredRef.current = false;
    setTitle(job.title || "Pohádka");
    setScenes([...rendered]);
    setPage(0);
    setSlideKey(k => k + 1);
    setViewMode("reader");
    isAutoAdvanceRef.current = true;
    removeServerJob(job.jobId);
  }

  // Download finished scenes while the job still runs (max 2 at a time per
  // job) and feed them into the gen-card thumbnails
  function prefetchJobScenes(jobId: string, st: { scenesScript?: Scene[]; sceneUrls?: Record<number, string> }) {
    let jm = jobMediaRef.current.get(jobId);
    if (!jm) { jm = { scenes: new Map(), fetching: new Set() }; jobMediaRef.current.set(jobId, jm); }
    const script = st.scenesScript || [];
    const urls = st.sceneUrls || {};
    let buf = jobBuffersRef.current.get(jobId);
    if (script.length > 0 && (!buf || buf.length !== script.length)) {
      buf = script.map((s, i) => ({ ...s, imageUrl: jm!.scenes.get(i)?.imageUrl, audioUrl: jm!.scenes.get(i)?.audioUrl } as RenderedScene));
      jobBuffersRef.current.set(jobId, buf);
    }
    const pending = Object.keys(urls).map(Number)
      .filter(i => !jm!.scenes.has(i) && !jm!.fetching.has(i))
      .slice(0, 2);
    for (const i of pending) {
      jm.fetching.add(i);
      fetchSceneJson(urls[i]).then(m => {
        jm!.fetching.delete(i);
        if (!m) return;
        jm!.scenes.set(i, m);
        const b = jobBuffersRef.current.get(jobId);
        if (b && b[i]) b[i] = { ...b[i], imageUrl: m.imageUrl, audioUrl: m.audioUrl };
      }).catch(() => { jm!.fetching.delete(i); });
    }
  }

  // When done/total stops moving for too long, the server function most
  // likely hit Vercel's 5-minute limit → ask /api/job/continue to resume
  function maybeKickContinue(jobId: string, st: { phase: string; done?: number; total?: number }, stalledNow?: boolean) {
    const w = stallStateFor(jobId);
    const sig = `${st.phase}|${st.done ?? -1}/${st.total ?? -1}`;
    const now = Date.now();
    if (sig !== w.lastSig) {
      w.lastSig = sig; w.lastChange = now;
      lastProgressRef.current = now; // server progress feeds the local stall watchdog too
      if (stalledNow) updateServerJob(jobId, { stalled: false });
      return;
    }
    // writing has no progress signal → longer patience (Claude can take ~3 min on 20 scenes)
    const limit = st.phase === "writing" ? 240_000 : 150_000;
    if (now - w.lastChange < limit) return;
    if (!stalledNow) updateServerJob(jobId, { stalled: true });
    if (now - w.lastKick < 120_000) return;
    w.lastKick = now;
    kickContinue(jobId);
  }

  function startJobPolling(jobId: string) {
    stopJobPolling(jobId);
    const tick = async () => {
      try {
        const res = await fetch(`/api/job/status?id=${jobId}`, { cache: "no-store" });
        if (res.status === 404) {
          // Status was never written — the server start died before its first
          // write. Revive via /continue; give up after ~5 minutes of 404s.
          const w = stallStateFor(jobId);
          w.fails404++;
          if (w.fails404 >= 75) {
            stopJobPolling(jobId);
            updateServerJob(jobId, { phase: "error", error: t.errGeneric });
            return;
          }
          if (w.fails404 >= 8 && Date.now() - w.lastKick > 120_000) {
            w.lastKick = Date.now();
            const r = await kickContinue(jobId);
            // Nejde navázat (zadání se nedochovalo) → ukončit s chybou
            if (r && r.status === 404) {
              stopJobPolling(jobId);
              updateServerJob(jobId, { phase: "error", error: t.errGeneric });
            }
          }
          return;
        }
        if (!res.ok) return;
        stallStateFor(jobId).fails404 = 0;
        const st = await res.json();
        if (st.phase === "writing" || st.phase === "generating") {
          maybeKickContinue(jobId, st, serverJobsRef.current.find(j => j.jobId === jobId)?.stalled);
        }
        if (st.phase === "writing") {
          updateServerJob(jobId, { phase: "writing" });
        } else if (st.phase === "generating") {
          prefetchJobScenes(jobId, st);
          updateServerJob(jobId, { phase: "generating", done: st.done || 0, total: st.total || 0, title: st.title });
        } else if (st.phase === "done") {
          stopJobPolling(jobId);
          await finalizeServerJob(st, jobId);
        } else if (st.phase === "error") {
          stopJobPolling(jobId);
          updateServerJob(jobId, { phase: "error", error: String(st.error || t.errGeneric) });
        }
      } catch {}
    };
    tick();
    jobTimersRef.current.set(jobId, setInterval(tick, 4000));
  }

  function addServerJob(jobId: string) {
    if (!serverJobsRef.current.some(j => j.jobId === jobId)) {
      syncServerJobs([...serverJobsRef.current, { jobId, phase: "writing", done: 0, total: 0 }]);
    }
    startJobPolling(jobId);
  }

  // Resume polling of server jobs after reload / app switch
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SERVER_JOB_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const ids: string[] = Array.isArray(parsed?.jobs) ? parsed.jobs
          : parsed?.jobId ? [parsed.jobId] : []; // zpětná kompatibilita se single-job formátem
        for (const id of ids) if (typeof id === "string" && id) addServerJob(id);
      }
    } catch {}
    const timers = jobTimersRef.current;
    return () => { for (const tm of timers.values()) clearInterval(tm); timers.clear(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Create story (full flow) ──────────────────────────────────────────────
  async function createStory(e: React.FormEvent) {
    e.preventDefault();
    const background = bookReady; // run in bg if current story (images) already visible
    setError("");

    // Mobilní data: pohádka stáhne ~30 MB — jednorázové potvrzení za sezení
    try {
      const conn = (navigator as Navigator & { connection?: { type?: string } }).connection;
      if (conn?.type === "cellular" && !sessionStorage.getItem("nicky-cell-ok")) {
        if (!window.confirm(t.cellularWarn)) return;
        sessionStorage.setItem("nicky-cell-ok", "1");
      }
    } catch {}

    const selectedCustomObjsForJob = customChars.filter(c => selectedCustomIds.includes(c.id));
    // Vlastní svět: prompt jde místo themeId, fotka světa jako inspirace
    const activeCustomTheme = customThemes.find(ct => ct.id === selectedTheme);
    const storyPayload = {
      topic, themeId: activeCustomTheme ? undefined : selectedTheme || undefined,
      customTheme: activeCustomTheme ? { name: activeCustomTheme.name, prompt: activeCustomTheme.prompt } : undefined,
      characterIds: selectedIds,
      age: getTargetAge([...selectedIds, ...selectedCustomIds]),
      sceneCount,
      language: voices.find(v => v.id === selectedVoiceId)?.language ?? "cs",
      customCharacters: selectedCustomObjsForJob.map(c => ({
        id: c.id, name: c.name,
        description: c.description,
        photoBase64: c.photoBase64,
        photoMimeType: c.photoMimeType,
      })),
      inspirationUrl: inspUrlActive && inspUrl.trim() ? inspUrl.trim() : undefined,
      inspirationImages: [
        ...inspImages.map(i => ({ data: i.data, mimeType: i.mimeType })),
        ...(activeCustomTheme?.photoBase64 && activeCustomTheme.photoMimeType
          ? [{ data: activeCustomTheme.photoBase64, mimeType: activeCustomTheme.photoMimeType }] : []),
      ],
      inspirationPdfBase64: inspPdf?.base64 || undefined,
    };

    // Try the SERVER job first — generation survives app switches & screen off.
    // 2 attempts with a generous timeout (cold start + slow mobile upload);
    // the local in-browser pipeline is only a last resort, it has no queue.
    const jobBody = JSON.stringify({
      ...storyPayload,
      voiceId: selectedVoiceId || "",
      customCharacterImages: selectedCustomObjsForJob
        .filter(c => c.photoBase64 && c.photoMimeType)
        .map(c => ({ data: c.photoBase64!, mimeType: c.photoMimeType! })),
    });
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const jobRes = await fetch("/api/job/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(30_000),
          body: jobBody,
        });
        if (jobRes.ok) {
          const { jobId } = await jobRes.json();
          if (jobId) {
            saveSettings({ selectedVoiceId, sceneCount, selectedTheme, selectedIds });
            addServerJob(jobId);
            return; // phone is free — the server does the work
          }
        }
        if (jobRes.status === 501) break; // blob not configured → local pipeline
        // Důvod selhání ukázat (např. blob-write-failed = plné úložiště) —
        // generování pokračuje lokálně, ale uživatel ví, proč není fronta
        try {
          const errBody = await jobRes.json();
          if (attempt === 1 && errBody?.error) setError(`Server: ${String(errBody.error).slice(0, 180)}`);
        } catch {}
        console.warn(`[job/start] attempt ${attempt + 1} failed: HTTP ${jobRes.status}`);
      } catch (e) {
        console.warn(`[job/start] attempt ${attempt + 1} failed:`, e);
      }
    }

    // Local pipeline is exclusive — if server jobs are already running, don't
    // start a second in-browser generation on top of them
    if (serverJobsRef.current.some(j => j.phase === "writing" || j.phase === "generating")) {
      setError(t.errGeneric);
      return;
    }

    if (!background) {
      setScenes([]); setTitle(""); setPage(0);
      introFiredRef.current = false;
    } else {
      setBgStatus("writing");
      setBgProgress({ done: 0, total: 0 });
    }
    setLoading(true);
    try {
      setStatus(t.statusWriting);
      const selectedCustomObjs = customChars.filter(c => selectedCustomIds.includes(c.id));

      const storyRes = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(180_000),
        body: JSON.stringify(storyPayload), // stejné zadání jako serverový job (vč. vlastního světa)
      });
      const script = await safeJson<StoryScript & { error?: string }>(storyRes);
      if (!storyRes.ok) throw new Error(script.error || t.errStory);

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
      const finalScenes = await generateMedia(script.title, script.heroDescription, script.scenes, customImageRefs, selectedVoiceId, background, entry.id);
      renderedMapRef.current.set(entry.id, finalScenes);
      // Cache even if some audio failed — imageUrl always has SVG fallback
      cacheStory(entry.id, finalScenes).catch(() => {});
      evictOldStories(loadHistory().map(e => e.id)).catch(() => {});
      if (!background) {
        setStatus(t.statusReady);
        setViewMode("reader");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t.errGeneric;
      const isFetchAbort = msg === "Failed to fetch" || msg.includes("AbortError") || msg.includes("NetworkError");
      setError(isFetchAbort ? "FETCH_ABORT" : msg);
      setStatus("");
      if (background) setBgStatus("idle");
    } finally {
      setLoading(false);
    }
  }

  // Custom worlds (story themes by photo/description)
  interface CustomTheme { id: string; name: string; prompt: string; photoBase64?: string; photoMimeType?: string; previewUrl?: string }
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  const [addingTheme, setAddingTheme] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [newThemeDesc, setNewThemeDesc] = useState("");
  const [newThemePhoto, setNewThemePhoto] = useState<{ data: string; mimeType: string; previewUrl: string } | null>(null);
  const themePhotoRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
      if (raw) {
        const list = JSON.parse(raw) as CustomTheme[];
        setCustomThemes(list.map(c => ({
          ...c,
          previewUrl: c.photoBase64 && c.photoMimeType ? `data:${c.photoMimeType};base64,${c.photoBase64}` : undefined,
        })));
      }
    } catch {}
  }, []);

  // ── 🎨 Pozadí aplikace — auto podle tématu, nebo ruční rolování ──────────
  const [bgChoice, setBgChoice] = useState("auto");
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BG_KEY);
      if (saved && (saved === "auto" || bgSceneById(saved))) setBgChoice(saved);
    } catch {}
  }, []);
  const autoBg = selectedTheme
    ? (THEME_BG[selectedTheme] ?? (customThemes.some(ct => ct.id === selectedTheme) ? "fantasy" : "night"))
    : "night";
  const activeBg = bgChoice === "auto" ? autoBg : bgChoice;
  const bgUrlCacheRef = useRef<Record<string, string>>({});
  useEffect(() => {
    // Gradient scény naskočí hned (data-bg), ilustrace se přes něj položí,
    // jakmile je stažená (--bg-img). Maluje se jen jednou — server ji cachuje.
    const root = document.documentElement;
    root.dataset.bg = activeBg;
    let dead = false;
    const show = (url: string) => {
      const img = new Image();
      img.onload = () => { if (!dead) root.style.setProperty("--bg-img", `url("${url}")`); };
      img.src = url;
    };
    root.style.removeProperty("--bg-img");
    const cached = bgUrlCacheRef.current[activeBg];
    if (cached) {
      show(cached);
    } else {
      fetch(`/api/bg-image?scene=${activeBg}`, { signal: AbortSignal.timeout(110_000) })
        .then(r => (r.ok ? r.json() : null))
        .then((d: { url?: string } | null) => {
          if (dead || !d?.url) return;
          bgUrlCacheRef.current[activeBg] = d.url;
          show(d.url);
        })
        .catch(() => {});
    }
    return () => { dead = true; };
  }, [activeBg]);
  function cycleBg() {
    const order = ["auto", ...BG_SCENES.map(s => s.id)];
    const next = order[(order.indexOf(bgChoice) + 1) % order.length];
    setBgChoice(next);
    try { localStorage.setItem(BG_KEY, next); } catch {}
  }
  const bgLabel = bgChoice === "auto"
    ? `🎨 ${t.bgAuto}`
    : `${bgSceneById(bgChoice)!.emoji} ${uiLang === "en" ? bgSceneById(bgChoice)!.nameEn : bgSceneById(bgChoice)!.name}`;

  // ── 🎲 Vymysli námět — Claude navrhne námět do textového pole ────────────
  const [ideaLoading, setIdeaLoading] = useState(false);
  async function suggestIdea() {
    setIdeaLoading(true);
    try {
      const names = [
        ...chars.filter(c => selectedIds.includes(c.id)).map(c => (uiLang === "en" && c.nameEn ? c.nameEn : c.name)),
        ...customChars.filter(c => selectedCustomIds.includes(c.id)).map(c => c.name),
      ];
      const res = await fetch("/api/topic-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ language: uiLang, characterNames: names }),
      });
      const d = await safeJson<{ idea?: string }>(res);
      if (res.ok && d.idea) setTopic(d.idea);
    } catch {} finally {
      setIdeaLoading(false);
    }
  }

  // ── Delete a story from history (localStorage + IndexedDB + memory) ──────
  function deleteStory(e: React.MouseEvent, entry: HistoryEntry) {
    e.stopPropagation();
    if (!window.confirm(t.deleteStoryAsk(entry.title))) return;
    try {
      const next = loadHistory().filter(x => x.id !== entry.id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setStoryHistory(next);
      renderedMapRef.current.delete(entry.id);
      evictOldStories(next.map(x => x.id)).catch(() => {});
    } catch {}
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
      isAutoAdvanceRef.current = true; // start narration right away
    }

    // 1. Instant restore from in-memory ref (bg generation continues uninterrupted)
    const memCached = renderedMapRef.current.get(entry.id);
    if (memCached && memCached.length > 0) {
      showCached(memCached);
      return;
    }

    // 2. Try IndexedDB — survives PWA restart (bg generation continues uninterrupted)
    const dbCached = await getCachedStory(entry.id);
    let partial: RenderedScene[] | undefined;
    if (dbCached && dbCached.length > 0) {
      const restored: RenderedScene[] = entry.scenes.map((s, i) => ({
        ...s,
        imageUrl: dbCached[i]?.imageUrl,
        audioUrl: dbCached[i]?.audioUrl,
      }));
      if (restored.every(s => !isPlaceholderImg(s.imageUrl))) {
        renderedMapRef.current.set(entry.id, restored);
        showCached(restored);
        return;
      }
      // Incomplete cache (interrupted generation) — reuse finished scenes,
      // regenerate only the missing ones below
      partial = restored;
    }

    // 3. Cache miss/partial — regeneration only when nothing else is running
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
      const finalScenes = await generateMedia(entry.title, entry.heroDescription, entry.scenes, [], selectedVoiceId, false, entry.id, partial);
      renderedMapRef.current.set(entry.id, finalScenes);
      cacheStory(entry.id, finalScenes).catch(() => {});
      setStatus(t.statusReady);
      setViewMode("reader");
    } catch (err) {
      const msg2 = err instanceof Error ? err.message : t.errReplay;
      setError(msg2 === "Failed to fetch" || msg2.includes("AbortError") ? "FETCH_ABORT" : msg2);
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
  // Persist custom characters — they stay until explicitly deleted (×)
  function saveCustomChars(list: CustomChar[]) {
    try {
      localStorage.setItem(CUSTOM_CHARS_KEY, JSON.stringify(
        list.map(({ previewUrl, ...c }) => c)   // previewUrl is rebuilt from base64
      ));
    } catch {
      // quota exceeded — retry without photos so at least names survive
      try {
        localStorage.setItem(CUSTOM_CHARS_KEY, JSON.stringify(
          list.map(c => ({ id: c.id, name: c.name, description: c.description }))
        ));
      } catch {}
    }
  }

  function addCustomChar() {
    if (!newCharName.trim()) return;
    const id = `custom_${Date.now()}`;
    setCustomChars(p => {
      const next = [...p, {
        id, name: newCharName.trim(),
        description: newCharDesc.trim() || `a character named ${newCharName.trim()}`,
        photoBase64: newCharPhoto?.data, photoMimeType: newCharPhoto?.mimeType, previewUrl: newCharPhoto?.previewUrl,
      }];
      saveCustomChars(next);
      return next;
    });
    setSelectedCustomIds(p => [...p, id]);
    setAddingChar(false); setNewCharName(""); setNewCharDesc(""); setNewCharPhoto(null);
  }
  function removeCustomChar(id: string) {
    setCustomChars(p => {
      const next = p.filter(c => c.id !== id);
      saveCustomChars(next);
      return next;
    });
    setSelectedCustomIds(p => p.filter(x => x !== id));
  }
  async function handleInspImage(file: File) {
    if (inspImages.length >= 3) return;
    const r = await resizeAndEncode(file, 512).catch(() => null);
    if (r) setInspImages(p => [...p, { ...r, name: file.name }]);
  }

  // ── Vlastní svět pohádky (téma podle fotky nebo popisu) ──────────────────
  function saveCustomThemes(list: CustomTheme[]) {
    try {
      localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(list.map(({ previewUrl, ...c }) => c)));
    } catch {
      try {
        localStorage.setItem(CUSTOM_THEMES_KEY, JSON.stringify(list.map(c => ({ id: c.id, name: c.name, prompt: c.prompt }))));
      } catch {}
    }
  }
  async function handleThemePhoto(file: File) {
    const r = await resizeAndEncode(file, 640).catch(() => null);
    if (r) setNewThemePhoto(r);
  }
  function addCustomTheme() {
    if (!newThemeName.trim() && !newThemeDesc.trim()) return;
    const id = `ctheme_${Date.now()}`;
    const name = newThemeName.trim() || (uiLang === "en" ? "My world" : "Můj svět");
    setCustomThemes(p => {
      const next = [...p, {
        id, name,
        prompt: newThemeDesc.trim() || name,
        photoBase64: newThemePhoto?.data, photoMimeType: newThemePhoto?.mimeType, previewUrl: newThemePhoto?.previewUrl,
      }];
      saveCustomThemes(next);
      return next;
    });
    setSelectedTheme(id);
    setAddingTheme(false); setNewThemeName(""); setNewThemeDesc(""); setNewThemePhoto(null);
  }
  function removeCustomTheme(id: string) {
    setCustomThemes(p => { const next = p.filter(c => c.id !== id); saveCustomThemes(next); return next; });
    setSelectedTheme(p => (p === id ? "" : p));
  }
  async function handleInspPdf(file: File) {
    if (file.size > 3.5 * 1024 * 1024) { alert(t.pdfTooBig); return; }
    const b = await fileToBase64(file).catch(() => null);
    if (b) setInspPdf({ base64: b, name: file.name });
  }

  const allSelectedCount = selectedIds.length + selectedCustomIds.length;
  const hasInspiration = !!selectedTheme || !!topic.trim() || inspImages.length > 0 || !!inspPdf || (inspUrlActive && !!inspUrl.trim());
  const current = scenes[page];
  const hasNext = page < scenes.length - 1;
  const hasPrev = page > 0;
  const totalScenes = scenes.length;

  return (
    <div className={readerMode ? "container reader-mode" : "container"}>

      {!readerMode && (
      <>
      <div className="lang-switch">
        <button type="button" className="lang-btn bg-cycle-btn" onClick={cycleBg} title={t.bgTitle}>{bgLabel}</button>
        <button type="button" className={`lang-btn ${uiLang === "cs" ? "lang-on" : ""}`} onClick={() => switchLang("cs")}>🇨🇿 CZ</button>
        <button type="button" className={`lang-btn ${uiLang === "en" ? "lang-on" : ""}`} onClick={() => switchLang("en")}>🇬🇧 EN</button>
      </div>
      <h1>📖 {uiLang === "cs" ? "Nickyho pohádky" : "Nicky's Fairy Tales"} <span className="version-badge">v{APP_VERSION}</span></h1>
      <p className="subtitle">{t.subtitle}</p>

      {/* ── Vrátit se na starší pohádku ── */}

      {/* ── FORM ── */}
      <form className="form" ref={formRef} onSubmit={createStory}>

        {(chars.length > 0 || customChars.length > 0) && (
          <div className="field">
            <label>{t.whoLabel}</label>
            <div className="chips">
              {chars.map(c => (
                <label key={c.id} className={`chip ${selectedIds.includes(c.id) ? "chip-on" : ""}`}>
                  <input type="checkbox" checked={selectedIds.includes(c.id)} onChange={() => toggleChar(c.id)} />
                  {uiLang === "en" && c.nameEn ? c.nameEn : c.name}
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
                {addingChar ? t.cancelChip : t.addCharChip}
              </button>
            </div>
          </div>
        )}

        {addingChar && (
          <div className="add-char-panel">
            <p className="panel-title">{t.newCharTitle}</p>
            <div className="field">
              <label>{t.nameLabel}</label>
              <input type="text" value={newCharName} onChange={e => setNewCharName(e.target.value)} placeholder={t.namePlaceholder} autoFocus />
            </div>
            <div className="field">
              <label>{t.descLabel}</label>
              <textarea value={newCharDesc} onChange={e => setNewCharDesc(e.target.value)} placeholder={t.descPlaceholder} />
            </div>
            <div className="field">
              <label>{t.photoLabel}</label>
              <div className="file-row">
                <button type="button" className="outline-btn" onClick={() => charPhotoRef.current?.click()}>
                  📷 {newCharPhoto ? t.changePhoto : t.uploadPhoto}
                </button>
                {newCharPhoto && <img src={newCharPhoto.previewUrl} alt="náhled" className="mini-preview" />}
              </div>
              <input ref={charPhotoRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleCharPhoto(f); e.target.value = ""; }} />
            </div>
            <div className="file-row">
              <button type="button" onClick={addCustomChar} disabled={!newCharName.trim()}>{t.addCharBtn}</button>
              <button type="button" className="outline-btn" onClick={() => { setAddingChar(false); setNewCharName(""); setNewCharDesc(""); setNewCharPhoto(null); }}>{t.cancel}</button>
            </div>
          </div>
        )}

        {themes.length > 0 && (
          <div className="field">
            <label>{t.worldLabel}</label>
            <div className="chips">
              {themes.map(th => (
                <button type="button" key={th.id} className={`chip chip-btn ${selectedTheme === th.id ? "chip-on" : ""}`}
                  onClick={() => setSelectedTheme(p => p === th.id ? "" : th.id)}>
                  <span>{th.emoji}</span> {uiLang === "en" && th.nameEn ? th.nameEn : th.name}
                </button>
              ))}
              {customThemes.map(ct => (
                <div key={ct.id} className={`chip custom-chip ${selectedTheme === ct.id ? "chip-on" : ""}`}>
                  {ct.previewUrl && <img src={ct.previewUrl} alt={ct.name} className="chip-avatar" />}
                  <span className="chip-label" onClick={() => setSelectedTheme(p => p === ct.id ? "" : ct.id)}>🌍 {ct.name}</span>
                  <button type="button" className="chip-remove" onClick={() => removeCustomTheme(ct.id)}>×</button>
                </div>
              ))}
              <button type="button" className={`chip chip-btn ${addingTheme ? "chip-on" : ""}`} onClick={() => setAddingTheme(p => !p)}>
                {addingTheme ? t.cancelChip : t.addWorldChip}
              </button>
            </div>
            {addingTheme && (
              <div className="add-char-panel">
                <p className="panel-title">{t.newWorldTitle}</p>
                <div className="field">
                  <label>{t.worldNameLabel}</label>
                  <input type="text" value={newThemeName} onChange={e => setNewThemeName(e.target.value)} placeholder={t.worldNamePlaceholder} autoFocus />
                </div>
                <div className="field">
                  <label>{t.worldDescLabel}</label>
                  <textarea value={newThemeDesc} onChange={e => setNewThemeDesc(e.target.value)} placeholder={t.worldDescPlaceholder} />
                </div>
                <div className="field">
                  <label>{t.worldPhotoLabel}</label>
                  <div className="file-row">
                    <button type="button" className="outline-btn" onClick={() => themePhotoRef.current?.click()}>
                      📷 {newThemePhoto ? t.changePhoto : t.uploadPhoto}
                    </button>
                    {newThemePhoto && <img src={newThemePhoto.previewUrl} alt="náhled" className="mini-preview" />}
                  </div>
                  <input ref={themePhotoRef} type="file" accept="image/*" style={{ display: "none" }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleThemePhoto(f); e.target.value = ""; }} />
                </div>
                <div className="panel-actions">
                  <button type="button" onClick={addCustomTheme} disabled={!newThemeName.trim() && !newThemeDesc.trim()}>{t.saveWorld}</button>
                  <button type="button" className="outline-btn" onClick={() => { setAddingTheme(false); setNewThemeName(""); setNewThemeDesc(""); setNewThemePhoto(null); }}>{t.cancel}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {voices.length > 1 && (
          <div className="field">
            <label>{t.voiceLabel}</label>
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
          <label>{t.wishLabel}</label>
          <textarea value={topic} onChange={e => setTopic(e.target.value)} placeholder={t.wishPlaceholder} />
          <div className="insp-row">
            <button type="button" className="insp-btn" onClick={suggestIdea} disabled={ideaLoading}>
              {ideaLoading ? "⏳ " : "🎲 "}{t.ideaBtn}
            </button>
            {topic.trim() !== "" && (
              <button type="button" className="insp-btn" onClick={() => setTopic("")}>
                🧹 {t.clearTextBtn}
              </button>
            )}
            <button type="button" className={`insp-btn ${inspImages.length > 0 ? "chip-on" : ""}`}
              onClick={() => inspImageRef.current?.click()} disabled={inspImages.length >= 3}>
              📷 {t.photoBtn}{inspImages.length > 0 ? ` (${inspImages.length})` : ""}
            </button>
            <button type="button" className={`insp-btn ${inspUrlActive ? "chip-on" : ""}`} onClick={() => setInspUrlActive(p => !p)}>🔗 {t.webBtn}</button>
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
          <label>{t.pagesLabel}</label>
          <div className="stepper">
            <button type="button" className="stepper-btn" onClick={() => setSceneCount(n => Math.max(3, n - 1))}
              disabled={sceneCount <= 3} aria-label="−1">−</button>
            <span className="stepper-value">{sceneCount}</span>
            <button type="button" className="stepper-btn" onClick={() => setSceneCount(n => Math.min(20, n + 1))}
              disabled={sceneCount >= 20} aria-label="+1">+</button>
          </div>
          <p className="gen-step-hint stepper-hint">{t.pagesTime(Math.max(1, Math.round(sceneCount * 0.5)))}</p>
        </div>

        <div className="field">
          <label>{t.musicLabel}</label>
          <label className={`chip ${musicOn ? "chip-on" : ""}`} style={{display:"flex", justifyContent:"center"}}>
            <input type="checkbox" checked={musicOn} onChange={() => setMusicOn(p => !p)} />
            {musicOn ? t.musicOn : t.musicOff}
          </label>
        </div>

        {(() => {
          // Three sources of progress: LOCAL pipeline (loading/bgStatus) and
          // the SERVER job queue (serverJobs) — tapping a segment picks which
          // story the cards preview (default: the newest one)
          const activeJobs = serverJobs.filter(j => j.phase === "writing" || j.phase === "generating");
          const newestJob = activeJobs.find(j => j.jobId === focusJobId) ?? activeJobs[activeJobs.length - 1];
          const localGen = loading || bgStatus === "writing" || bgStatus === "generating";
          const isGenerating = localGen || !!newestJob;
          const bgGen = bgStatus === "generating";
          const jobGen = !localGen && newestJob?.phase === "generating";
          const done = bgGen ? bgProgress.done : jobGen ? newestJob.done : doneCount;
          const total = bgGen ? bgProgress.total : jobGen ? newestJob.total : totalScenes;
          const progressPct = total > 0 ? Math.round((done / total) * 100) : 0;
          // Shimmer („píšu příběh") only while the LOCAL pipeline writes; a
          // queued server job shows its state in the toast rows instead
          const showShimmer = localGen && (bgStatus === "writing" || (bgStatus === "idle" && scenes.length === 0));
          const canQueueMore = !localGen && activeJobs.length > 0 && activeJobs.length < MAX_ACTIVE_JOBS;
          const btnBusy = localGen || activeJobs.length >= MAX_ACTIVE_JOBS;
          const cardScenes: (RenderedScene | null)[] = jobGen
            ? (jobBuffersRef.current.get(newestJob.jobId) ?? Array(newestJob.total || sceneCount).fill(null))
            : bgGen
              ? (bgBufferRef.current.length > 0 ? bgBufferRef.current : Array(total || sceneCount).fill(null))
              : (bgStatus === "idle" && scenes.length > 0 && localGen ? scenes : Array(newestJob ? (newestJob.total || sceneCount) : sceneCount).fill(null));
          return (
            <div ref={progressRef}>
              <button
                type="submit"
                className={`btn-create${localGen ? (showShimmer ? " btn-create-shimmer" : " btn-create-loading") : ""}`}
                disabled={btnBusy || allSelectedCount === 0 || !hasInspiration}
                style={localGen && !showShimmer ? { '--progress-pct': `${progressPct}%` } as React.CSSProperties : undefined}
              >
                {localGen ? (
                  showShimmer
                    ? (
                      <span className="btn-create-label writing-label">
                        <span className="writing-pencil">✍️</span>
                        {t.writingBtn}
                        <span className="writing-dots"><span>.</span><span>.</span><span>.</span></span>
                      </span>
                    )
                    : <span className="btn-create-label">{t.scenesBtn(done, total, progressPct)}</span>
                ) : canQueueMore ? t.createNextBtn : t.createBtn}
              </button>
              {/* Queue segments — the big button "splits" into one part per story */}
              {serverJobs.length > 0 && (
                <div className="job-strip">
                  {serverJobs.map((j, idx) => {
                    const pct = j.phase === "generating" && j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
                    return (
                      <div key={j.jobId}
                        className={`job-seg job-seg-${j.phase}${j.stalled ? " job-seg-stalled" : ""}${newestJob?.jobId === j.jobId && activeJobs.length > 1 ? " job-seg-focus" : ""}`}
                        style={{ "--pct": `${pct}%` } as React.CSSProperties}
                        onClick={j.phase === "done" ? () => openServerJob(j)
                          : j.phase === "error" ? () => removeServerJob(j.jobId)
                          : j.stalled ? () => {
                              const w = stallStateFor(j.jobId);
                              if (w.manualKicks === 0) {
                                if (window.confirm(t.stuckKickAsk)) { w.manualKicks++; w.lastKick = Date.now(); kickContinue(j.jobId); }
                              } else if (window.confirm(t.stuckRemoveAsk)) {
                                stopJobPolling(j.jobId);
                                removeServerJob(j.jobId);
                              } else { w.lastKick = Date.now(); kickContinue(j.jobId); }
                            }
                          : () => setFocusJobId(j.jobId)}
                        role="button"
                        title={j.title || undefined}
                      >
                        <span className="job-seg-fill" />
                        <span className="job-seg-label">
                          {idx + 1}. {j.stalled ? "⚠️ " : ""}{j.phase === "writing" ? t.segWriting
                            : j.phase === "generating" ? `🎨 ${j.done}/${j.total}`
                            : j.phase === "done" ? t.segOpen
                            : t.segError}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {canQueueMore && (
                <p className="gen-step-hint">{t.queueHint(activeJobs.length)}</p>
              )}
              {isGenerating && !canQueueMore && (
                <p className="gen-step-hint">
                  {showShimmer || (!localGen && newestJob?.phase === "writing")
                    ? t.step1Hint
                    : t.step2Hint(Math.min(done + 1, total), total, Math.max(1, Math.ceil((total - done) * 10 / 60)))}
                </p>
              )}
              {newestJob && serverJobs.length > 1 && (
                <p className="gen-step-hint" style={{ marginTop: '0.3rem' }}>
                  {t.cardsLabel2(serverJobs.findIndex(j => j.jobId === newestJob.jobId) + 1)}
                </p>
              )}
              {isGenerating && (
                <div className="gen-cards" style={{ marginTop: '0.25rem' }}>
                  {cardScenes.map((s, i) => {
                    const st = (bgGen || jobGen)
                      ? (!isPlaceholderImg(s?.imageUrl) ? "done" : i === done ? "generating" : "waiting")
                      : (s ? (sceneStatuses[i] ?? "waiting") : "waiting");
                    const showImg = s?.imageUrl && !isPlaceholderImg(s.imageUrl);
                    return (
                      <div key={i} className={`gen-card gen-card-${st}`}>
                        {showImg
                          ? <img src={s!.imageUrl} alt={`Scéna ${i + 1}`} className="gen-card-img" />
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
              )}
            </div>
          );
        })()}
      </form>

      </>
      )}


      {!readerMode && status && !loading && <p className="status">{status}</p>}
      {!readerMode && error && (
        <div className="error-box">
          <button type="button" className="error-dismiss" onClick={() => setError("")} aria-label="Zavřít">✕</button>
          {error === "FETCH_ABORT"
            ? <p className="error">{t.errFetchAbort}</p>
            : <p className="error">⚠️ {error}</p>}
          <button type="button" className="btn-retry" onClick={() => { setError(""); formRef.current?.requestSubmit(); }}>
            {t.retry}
          </button>
        </div>
      )}

      {/* ── BOOK – shown when all scene images are ready (audio may be partial) ── */}
      {bookReady && current && (
        <div className={`book${ctrlsOpen ? " ctrls-open" : ""}`} ref={bookRef}>
          <h2 className="book-title">{title}</h2>

          <div className="book-card" key={slideKey}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
            onClick={() => { if (readerMode) setCtrlsOpen(v => !v); }}
          >
            {current.imageUrl && !isPlaceholderImg(current.imageUrl) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="page-image" src={current.imageUrl} alt={t.sceneAlt(page + 1)}
                ref={pageImgRef}
                onLoad={() => setRollTick(t => t + 1)} />
            ) : current.imageUrl ? (
              <div className="page-image placeholder">
                {fixingScene === page ? (
                  <>
                    <div className="placeholder-spinner" />
                    <span>{t.drawingScene(page + 1)}</span>
                  </>
                ) : (
                  <>
                    <span>{t.imgFailed}</span>
                    <button type="button" className="btn-retry" onClick={() => repairSceneImage(page)}>
                      {t.regenImg}
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="page-image placeholder">
                <div className="placeholder-spinner" />
                <span>{t.genScene(page + 1)}</span>
              </div>
            )}

            <div className="page-body" ref={pageBodyRef}>
              <div className="page-clip" ref={pageClipRef}>
                <p className="page-text">{current.narration}</p>
              </div>
            </div>

            <div className="book-controls" onClick={e => e.stopPropagation()}>
              <div className="ctrl-item">
                <button type="button" className={`ctrl-btn ctrl-play ${!current.audioUrl || regenAudio ? "ctrl-loading" : ""}`}
                  onClick={togglePlay} disabled={!current.audioUrl || regenAudio} aria-label={isPlaying ? t.pause : t.play}>
                  {!current.audioUrl && !regenAudio ? "⏳" : isPlaying ? "⏸" : "▶"}
                </button>
                <span className="ctrl-label">{isPlaying ? t.pause : t.play}</span>
              </div>

              <div className="ctrl-item">
                <span className="ctrl-counter">{page + 1} / {scenes.length}</span>
                <span className="ctrl-label">{t.pageLbl}</span>
              </div>

              <div className="ctrl-item">
                <button type="button" className={`ctrl-btn ctrl-auto ${autoAdvance ? "ctrl-auto-on" : ""}`}
                  onClick={() => setAutoAdvance(p => !p)} title={autoAdvance ? "Auto-přechod zapnut" : "Auto-přechod vypnut"}>
                  {autoAdvance ? "🔁" : "🔂"}
                </button>
                <span className="ctrl-label">{t.auto}</span>
              </div>

              {/* Voice cycle button — only when multiple voices available */}
              {voices.length > 1 && (
                <div className="ctrl-item">
                  <button type="button" className={`ctrl-btn ctrl-auto ${regenAudio ? "ctrl-loading" : "ctrl-auto-on"}`}
                    onClick={() => {
                      const idx = voices.findIndex(v => v.id === selectedVoiceId);
                      const next = voices[(idx + 1) % voices.length];
                      switchVoice(next.id);
                    }}
                    disabled={regenAudio}
                    title={`Hlas: ${voices.find(v => v.id === selectedVoiceId)?.name ?? "?"} — klikni pro přepnutí`}
                  >
                    {voices.find(v => v.id === selectedVoiceId)?.emoji ?? "🎙️"}
                  </button>
                  <span className="ctrl-label">{t.voice}</span>
                </div>
              )}

              <div className="ctrl-item">
                <button type="button" className={`ctrl-btn ctrl-mute ${musicOn ? "ctrl-mute-on" : ""}`}
                  onClick={() => setMusicOn(p => !p)}
                  title={musicOn ? "Vypnout hudbu" : "Zapnout hudbu"}
                  aria-label={musicOn ? "Vypnout hudbu" : "Zapnout hudbu"}
                >
                  {musicOn ? "🎵" : "🔇"}
                </button>
                <span className="ctrl-label">{t.music}</span>
              </div>

              <div className="ctrl-item">
                <button type="button" className={`ctrl-btn ctrl-auto ${forcedLs ? "ctrl-auto-on" : ""}`}
                  onClick={toggleForcedLandscape}
                  title={forcedLs ? "Zpět na výšku" : "Otočit na šířku"}
                  aria-label={forcedLs ? "Zpět na výšku" : "Otočit na šířku"}
                >
                  {forcedLs ? "📱" : "🔄"}
                </button>
                <span className="ctrl-label">{forcedLs ? t.rotateBack : t.rotate}</span>
              </div>

              <div className="ctrl-item">
                <button type="button" className="ctrl-btn ctrl-home"
                  onClick={resetToForm}
                  title="Hlavní stránka"
                  aria-label="Hlavní stránka"
                >
                  🏠
                </button>
                <span className="ctrl-label">{t.home}</span>
              </div>
            </div>
          </div>

          {/* Nav arrows + dots outside the card — no overflow clipping */}
          <div className="book-nav" ref={navRef}>
            <button type="button" className="ctrl-btn ctrl-nav" onClick={() => goToPage(page - 1)} disabled={!hasPrev} aria-label={t.prev}>←</button>
            <div className="page-dots">
              {scenes.map((_, i) => (
                <button key={i} type="button"
                  className={`dot ${i === page ? "dot-active" : ""} ${scenes[i]?.audioUrl ? "dot-ready" : ""}`}
                  onClick={() => goToPage(i)} aria-label={`Strana ${i + 1}`} />
              ))}
            </div>
            <button type="button" className="ctrl-btn ctrl-nav" onClick={() => goToPage(page + 1)} disabled={!hasNext} aria-label={t.next}>→</button>
          </div>

          {current.audioUrl && (
            <audio ref={audioRef} key={current.audioUrl} src={current.audioUrl}
              onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={handleAudioEnded} />
          )}
        </div>
      )}

      {/* ── HISTORY — below the story so it does not distract ── */}
      {/* ── HISTORY ── */}
      {!readerMode && storyHistory.length > 0 && (
        <div className="history-box">
          <button type="button" className="history-toggle" onClick={() => setHistoryOpen(p => !p)}>
            {t.historyTitle(storyHistory.length)} {historyOpen ? "▲" : "▼"}
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
                      <span className="history-badge badge-scenes">{t.scenesBadge(entry.scenes.length)}</span>
                    </div>
                    <span className="history-date">{fmtDate(entry.createdAt)}</span>
                  </div>
                  <span className="history-del" role="button" aria-label={t.deleteStory}
                    onClick={e => deleteStory(e, entry)}>🗑️</span>
                  <span className="history-play-btn">▶</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}


      {/* ── USAGE — real spend overview ── */}
      {!readerMode && (
        <div className="history-box">
          <button type="button" className="history-toggle" onClick={toggleUsage}>
            {t.usageTitle} {usageOpen ? "▲" : "▼"}
          </button>
          {usageOpen && (
            <div className="usage-body">
              {usageErr ? (
                <p>{t.usageError}</p>
              ) : !usage ? (
                <p>{t.usageLoading}</p>
              ) : (
                <>
                  <p>{usage.claude && typeof usage.claude.usd === "number"
                    ? t.usageClaude(
                        usage.claude.usd.toFixed(2),
                        Math.round(usage.claude.usd * (usage.czkRate ?? 23)).toLocaleString("cs-CZ"),
                        usage.claude.days ?? 30)
                    : usage.claude?.error === "admin-key-missing" ? t.usageClaudeMissing : `🤖 Claude: ${usage.claude?.error ?? "?"}`}</p>
                  <p>{usage.elevenlabs && typeof usage.elevenlabs.used === "number" && !usage.elevenlabs.error
                    ? t.usageEleven(usage.elevenlabs.used.toLocaleString("cs-CZ"), (usage.elevenlabs.limit ?? 0).toLocaleString("cs-CZ"))
                    : usage.elevenlabs?.error === "missing-permission"
                      ? t.usageElevenPerm
                      : `🎙️ ElevenLabs: ${usage.elevenlabs?.error ?? "?"}`}</p>
                  <p>{t.usageGemini}</p>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── STALL TOAST — reload resumes the remembered job ── */}
      {stalled && (
        <div className="bg-toast stall-toast">
          <span>{t.stalled}</span>
          <button type="button" className="bg-toast-btn" onClick={() => window.location.reload()}>{t.stallReload}</button>
        </div>
      )}

      {/* ── ROLLING CREDITS ── */}
      {/* ── BACKGROUND GENERATION TOAST — only the legacy local pipeline;
            server-job progress lives in the create-button segments ── */}
      {bgStatus !== "idle" && !readerMode && (
        <div className="bg-toast-stack">
          <div className="bg-toast">
            {bgStatus === "writing" && <span>{t.writingNew}</span>}
            {bgStatus === "generating" && (
              <span>🎨 {bgProgress.done} / {bgProgress.total} scén</span>
            )}
            {bgStatus === "done" && (
              <>
                <span>{bgProgress.done < bgProgress.total ? t.newIncomplete(bgProgress.total - bgProgress.done) : t.newReady}</span>
                <button type="button" className="bg-toast-btn" onClick={switchToBgStory}>{t.openStory}</button>
              </>
            )}
          </div>
        </div>
      )}

      {showCredits && (
        <div className="credits-overlay" onClick={() => setShowCredits(false)}>
          <div className="credits-scroll">
            <div className="credits-content">
              <p className="credits-end">✨ Konec ✨</p>
              <p className="credits-title">{title}</p>

              <p className="credits-section">Příběh</p>
              <p className="credits-item">Anthropic {models?.story ?? "Claude"} — scénář a narace</p>
              <p className="credits-item">Google {models?.image ?? "Gemini"} — ilustrace</p>
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

              <p className="credits-goodnight">🌙 Dobrou noc, Nicolásku a Valentýnko 🌙</p>

              <p className="credits-tap">— klikni pro zavření —</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
