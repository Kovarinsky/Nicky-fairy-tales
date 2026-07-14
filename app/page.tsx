"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { StoryScript, RenderedScene, Scene, StoryChoiceMeta } from "@/lib/types";
import { AmbientPlayer } from "@/lib/ambient";
import { cacheStory, getCachedStory, evictOldStories } from "@/lib/scene-cache";
import { APP_VERSION } from "@/lib/version";
import { UI, UI_LANG_KEY, type UILang } from "@/lib/i18n";
import { BG_SCENES, bgSceneById, THEME_BG } from "@/lib/backgrounds";
import { FOLK_TALES, folkTaleById } from "@/lib/folk-tales";
import { upload as uploadToBlob } from "@vercel/blob/client";
import { buildStoryHtml } from "@/lib/story-export";

// ── Local types ─────────────────────────────────────────────────────────────
interface CharOption { id: string; name: string; nameEn?: string; photo?: string; }
interface ThemeOption { id: string; name: string; nameEn?: string; emoji: string; }
interface VoiceOption { id: string; name: string; nameEn?: string; emoji: string; description: string; language: string; kind?: "clone" | "designed"; }
interface CustomChar {
  id: string; name: string; description: string;
  photoBase64?: string; photoMimeType?: string; previewUrl?: string;
  /** Více fotek postavy (až 5) — photoBase64 zůstává první z nich (zpětná kompatibilita) */
  photos?: Array<{ data: string; mimeType: string }>;
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
  /** 🔀 Dva konce: scenes = společný děj + konec A + konec B */
  choice?: StoryChoiceMeta;
  /** ⏱ Délka přípravy (s) — celkem a z toho psaní */
  prepSec?: number;
  writeSec?: number;
  /** 📋 Deník přípravy (kroky s časy a chybami) — přetrvá i po dokončení */
  log?: Array<{ t: number; m: string }>;
}

const HISTORY_KEY = "nicky-story-history";
const CUSTOM_CHARS_KEY = "nicky-custom-chars";
const CUSTOM_THEMES_KEY = "nicky-custom-themes";
const JOB_KEY = "nicky-pending-job";
const VOICE_PREF_KEY = "nicky-voice-pref";
const AGE_PREF_KEY = "nicky-age-pref";       // ruční věkové pásmo ("auto" = podle vybraných postav)
const SERVER_JOB_KEY = "nicky-server-job";
const HISTORY_MAX = 20; // offline zásoba: posledních 20 pohádek v telefonu
const SETTINGS_KEY = "nicky-settings";
const DRAFT_KEY = "nicky-story-draft";
const TOPIC_DRAFT_KEY = "nicky-topic-draft"; // rozepsané zadání přežije reload i přepnutí jinam
const DEVICE_KEY = "nicky-device-id"; // anonymní ID zařízení pro panel Spotřeba

function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}
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
  selectedCustomIds?: string[];
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

// 🌐 Jazyky vyprávění: čeština a angličtina pevně, testovací jazyky
// (Chorvatština, Dánština, Slovenština) jdou z rolleru odebrat ×
const STORY_LANGS: Array<{ code: string; flag: string; cs: string; en: string; test?: boolean }> = [
  { code: "cs", flag: "🇨🇿", cs: "Čeština", en: "Czech" },
  { code: "en", flag: "🇬🇧", cs: "Angličtina", en: "English" },
  { code: "hr", flag: "🇭🇷", cs: "Chorvatština", en: "Croatian", test: true },
  { code: "da", flag: "🇩🇰", cs: "Dánština", en: "Danish", test: true },
  { code: "sk", flag: "🇸🇰", cs: "Slovenština", en: "Slovak", test: true },
];

// ⏱ m:ss z počtu sekund (badge historie, panel Spotřeba)
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Krátká ukázková věta (test hlasu, dobrou noc) podle jazyka
const SAMPLE_BY_LANG: Record<string, string> = {
  cs: "Dobrou noc, Nicolásku a Valentýnko. Sladké sny!",
  en: "Good night, Nicolas and Valentina. Sweet dreams!",
  hr: "Laku noć, Nicolase i Valentina. Slatki snovi!",
  da: "Godnat, Nicolas og Valentina. Sov godt, søde drømme!",
  sk: "Dobrú noc, Nicolas a Valentínka. Sladké sny!",
};
const isStoryLang = (l?: string) => !!l && STORY_LANGS.some(x => x.code === l);

// 🌙 Dobrou noc JMENOVITĚ všem postavám aktuální pohádky, v jazyce vyprávění
const GOODNIGHT_BY_LANG: Record<string, { hello: string; tail: string; and: string }> = {
  cs: { hello: "Dobrou noc", tail: "Sladké sny!", and: "a" },
  en: { hello: "Good night", tail: "Sweet dreams!", and: "and" },
  hr: { hello: "Laku noć", tail: "Slatki snovi!", and: "i" },
  da: { hello: "Godnat", tail: "Sov godt, søde drømme!", and: "og" },
  sk: { hello: "Dobrú noc", tail: "Sladké sny!", and: "a" },
};
function goodnightText(lang: string, names: string[]): string {
  const g = GOODNIGHT_BY_LANG[lang] || GOODNIGHT_BY_LANG.cs;
  const who = names.length === 0
    ? ""
    : names.length === 1
      ? `, ${names[0]}`
      : `, ${names.slice(0, -1).join(", ")} ${g.and} ${names[names.length - 1]}`;
  return `${g.hello}${who}. ${g.tail}`;
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
  const [newCharPhotos, setNewCharPhotos] = useState<Array<{ data: string; mimeType: string; previewUrl: string }>>([]);
  const charPhotoRef = useRef<HTMLInputElement>(null);
  const [topic, setTopic] = useState("");
  const [inspImages, setInspImages] = useState<InspImage[]>([]);
  const [inspUrlActive, setInspUrlActive] = useState(false);
  const [inspUrl, setInspUrl] = useState("");
  const [inspPdf, setInspPdf] = useState<{ base64?: string; url?: string; name: string } | null>(null);
  const [pdfUploading, setPdfUploading] = useState(false);
  // Přepínač: PDF zůstává nahrané, ale dá se dočasně vypnout z generování
  const [inspPdfUse, setInspPdfUse] = useState(true);
  const inspImageRef = useRef<HTMLInputElement>(null);
  const inspPdfRef = useRef<HTMLInputElement>(null);
  const [sceneCount, setSceneCount] = useState(6);
  // Výběr postav a nastavení se ukládá PRŮBĚŽNĚ (dřív jen při generování —
  // odškrtnuté postavy se po zavření appky vracely). Ref hlídá, ať se
  // neuloží prázdný stav dřív, než se obnoví ten uložený.
  const settingsReadyRef = useRef(false);
  useEffect(() => {
    if (!settingsReadyRef.current) return;
    saveSettings({ selectedVoiceId, sceneCount, selectedTheme, selectedIds, selectedCustomIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVoiceId, sceneCount, selectedTheme, selectedIds, selectedCustomIds]);

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
  const scenesRef = useRef<RenderedScene[]>([]);
  scenesRef.current = scenes;
  const [page, setPage] = useState(0);
  // 🔀 Dva konce: meta výběru + zvolená větev (null = ještě nevybráno)
  const [storyChoice, setStoryChoice] = useState<StoryChoiceMeta | null>(null);
  const [branch, setBranch] = useState<"A" | "B" | null>(null);
  const [slideKey, setSlideKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [musicOn, setMusicOn] = useState(false); // ambient music/sounds off by default
  const [showCredits, setShowCredits] = useState(false);
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
    own?: { images?: number; sheets?: number; chars?: number; usd?: number; days?: number; stories?: number; devices?: number; prepAvgSec?: number; prepMinSec?: number; prepMaxSec?: number; prepLastSec?: number; prepCount?: number; error?: string };
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
  // ▶ Čtení začíná, jakmile je hotová PRVNÍ scéna — zbytek se dokresluje
  // na pozadí (čtečka na nedokreslené stránky počká)
  const bookReady = scenes.length > 0 && !!scenes[0]?.imageUrl;

  // Reader mode: explicit switch so old story stays in memory when form opens
  const [viewMode, setViewMode] = useState<"form" | "reader">("form");
  const readerMode = viewMode === "reader";

  // UI language (CZ default; EN for Nicolas's foreign friends)
  const [uiLang, setUiLang] = useState<UILang>("cs");
  const t = UI[uiLang];
  function switchLang(l: UILang) {
    setUiLang(l);
    try { localStorage.setItem(UI_LANG_KEY, l); } catch {}
  }
  // 🧹 Úklid duplicitních postav: vlastní postava se stejným jménem jako
  // vestavěná (Eva, Jakob) nebo spojená („Eva & Jakob") je zbytečná —
  // vestavěné mají kanonický popis, portrét z kartotéky a fungují na všech
  // zařízeních. Duplicita se smaže a výběr přejde na vestavěné postavy.
  const dedupedCharsRef = useRef(false);
  useEffect(() => {
    if (dedupedCharsRef.current || chars.length === 0 || customChars.length === 0) return;
    dedupedCharsRef.current = true;
    const canon = new Map<string, string>(); // jméno (lower) → id vestavěné
    for (const c of chars) {
      canon.set(c.name.trim().toLowerCase(), c.id);
      if (c.nameEn) canon.set(c.nameEn.trim().toLowerCase(), c.id);
    }
    const dupTargets = (n: string): string[] | null => {
      const low = n.trim().toLowerCase();
      if (canon.has(low)) return [canon.get(low)!];
      const parts = low.split(/\s*(?:[&+]|\ba\b|\band\b)\s*/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2 && parts.every(p => canon.has(p))) return parts.map(p => canon.get(p)!);
      return null;
    };
    const removed = customChars.filter(c => dupTargets(c.name));
    if (removed.length === 0) return;
    const keep = customChars.filter(c => !dupTargets(c.name));
    const promote = new Set<string>();
    for (const c of removed) {
      if (selectedCustomIds.includes(c.id)) for (const id of dupTargets(c.name)!) promote.add(id);
    }
    console.log(`[dedup] mazu duplicitní vlastní postavy: ${removed.map(c => c.name).join(", ")}`);
    setCustomChars(keep);
    saveCustomChars(keep);
    setSelectedCustomIds(p => p.filter(id => keep.some(c => c.id === id)));
    if (promote.size > 0) setSelectedIds(p => [...new Set([...p, ...promote])]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chars, customChars]);

  // 🎙️ Hlas vypravěče: výchozí AUTOMATIKA podle jazyka prostředí (CZ/EN);
  // v sekci Hlas jde ručně vybrat jiný vypravěč nebo naklonovaný rodičovský hlas
  const [voicePref, setVoicePref] = useState<string>("auto");
  useEffect(() => {
    try { const v = localStorage.getItem(VOICE_PREF_KEY); if (v) setVoicePref(v); } catch {}
  }, []);
  function pickVoice(id: string) {
    setVoicePref(id);
    try { localStorage.setItem(VOICE_PREF_KEY, id); } catch {}
  }

  // 👶🧒👦 Věkové pásmo vyprávění: auto (podle postav) nebo ručně — řídí
  // věkový profil promptu (délka vět, slovník, napětí, hloubka)
  const AGE_BANDS: Array<{ id: string; age: number; label: string }> = [
    { id: "2-3", age: 2, label: "2–3" },
    { id: "4-5", age: 4, label: "4–5" },
    { id: "6-7", age: 6, label: "6–7" },
    { id: "8+", age: 9, label: "8+" },
  ];
  const [agePref, setAgePref] = useState("auto");
  useEffect(() => {
    try { const a = localStorage.getItem(AGE_PREF_KEY); if (a) setAgePref(a); } catch {}
  }, []);
  function pickAge(id: string) {
    setAgePref(id);
    try { localStorage.setItem(AGE_PREF_KEY, id); } catch {}
  }
  useEffect(() => {
    if (voicePref !== "auto") {
      if (voices.some(v => v.id === voicePref)) { setSelectedVoiceId(voicePref); return; }
      if (voices.length > 0) pickVoice("auto"); // vybraný hlas zmizel (smazaný klon)
    }
    const match = voices.find(v => v.language === uiLang);
    if (match) setSelectedVoiceId(match.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voices, uiLang, voicePref]);

  // 🎙️ Klon rodičovského hlasu — nahrání, vytvoření, ukázka, smazání
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [clones, setClones] = useState<Array<{ id: string; name: string }>>([]);
  const [cloneName, setCloneName] = useState("");
  const [recState, setRecState] = useState<"idle" | "ready" | "rec" | "done" | "uploading">("idle");
  const [recSecs, setRecSecs] = useState(0);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  // 🔊 Centrální přehrávač ukázek hlasů: naráz hraje jen JEDNA ukázka,
  // ⏳ ukazuje načítání, opětovné ťuknutí hrající ukázku zastaví (⏹)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewTokenRef = useRef(0);
  const [preview, setPreview] = useState<{ key: string; phase: "loading" | "playing" } | null>(null);
  const stopPreview = useCallback(() => {
    previewTokenRef.current++;
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    setPreview(null);
  }, []);
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const recChunksRef = useRef<Blob[]>([]);
  const recBlobRef = useRef<Blob | null>(null);
  const recTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    fetch("/api/voice-clone").then(r => r.json()).then(d => { if (Array.isArray(d?.clones)) setClones(d.clones); }).catch(() => {});
  }, []);

  async function startRec() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      mediaRecRef.current = rec;
      recChunksRef.current = [];
      rec.ondataavailable = e => { if (e.data.size > 0) recChunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(tr => tr.stop());
        const blob = new Blob(recChunksRef.current, { type: rec.mimeType || "audio/webm" });
        recBlobRef.current = blob;
        setRecUrl(URL.createObjectURL(blob));
        setRecState("done");
      };
      rec.start();
      setRecSecs(0);
      setRecState("rec");
      recTimerRef.current = setInterval(() => {
        setRecSecs(s => {
          if (s + 1 >= 120) stopRec(); // strop 2 minuty
          return s + 1;
        });
      }, 1000);
    } catch {
      await appAlert(t.cloneMicErr);
    }
  }
  function stopRec() {
    if (recTimerRef.current) { clearInterval(recTimerRef.current); recTimerRef.current = null; }
    try { mediaRecRef.current?.stop(); } catch {}
  }
  async function createClone() {
    const blob = recBlobRef.current;
    if (!blob) return;
    setRecState("uploading");
    try {
      const form = new FormData();
      form.append("audio", blob, "voice-sample.webm");
      form.append("name", cloneName.trim() || (uiLang === "en" ? "Family voice" : "Rodinný hlas"));
      const res = await fetch("/api/voice-clone", { method: "POST", body: form, signal: AbortSignal.timeout(60_000) });
      const d = await safeJson<{ id?: string; name?: string; error?: string }>(res);
      if (!res.ok || !d.id) throw new Error(d.error || "clone failed");
      setClones(p => [...p, { id: d.id!, name: d.name || "Hlas" }]);
      setRecState("idle");
      setRecUrl(null);
      setCloneName("");
      await refreshVoices();
      pickVoice(d.id);
      await appAlert(`✓ ${t.voiceAdded}`); // potvrzení, že hlas je uložený
      testVoice(d.id); // ověření: hned přehrát ukázku klonem
    } catch (e) {
      setRecState("done");
      await appAlert(`${t.cloneErr}${e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : ""}`);
    }
  }
  /** Přehraje ukázku (klíč = řádek v UI): ťuknutí na hrající ukázku ji
   *  zastaví, spuštění jiné ukázky tu předchozí utne — nic se nepřekrývá. */
  async function playPreview(key: string, getUrl: () => Promise<string | null>) {
    if (preview?.key === key) { stopPreview(); return; } // ⏹ na téže položce
    stopPreview();
    const token = ++previewTokenRef.current;
    setPreview({ key, phase: "loading" });
    try {
      const url = await getUrl();
      if (previewTokenRef.current !== token) return; // mezitím spuštěna jiná
      if (!url) throw new Error("no audio");
      audioRef.current?.pause(); // ztišit čtečku pohádky
      const a = new Audio(url);
      previewAudioRef.current = a;
      a.onended = () => { if (previewTokenRef.current === token) { previewAudioRef.current = null; setPreview(null); } };
      setPreview({ key, phase: "playing" });
      await a.play();
    } catch {
      if (previewTokenRef.current === token) setPreview(null);
    }
  }
  /** Krátká namluvená ukázka hlasu — text v jazyce hlasu (🇭🇷 chorvatsky),
   *  u vícejazyčných hlasů podle jazyka prostředí */
  async function voiceSampleUrl(id: string): Promise<string | null> {
    const vLang = voices.find(v => v.id === id)?.language;
    const text = SAMPLE_BY_LANG[isStoryLang(vLang) ? vLang! : uiLang] || SAMPLE_BY_LANG.cs;
    const res = await fetch("/api/scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({ scene: { index: 0, narration: text, imagePrompt: "x" }, audioOnly: true, voiceId: id }),
    });
    const d = await safeJson<{ audioUrl?: string }>(res);
    return res.ok && d.audioUrl ? d.audioUrl : null;
  }
  function testVoice(id: string) {
    void playPreview(`voice:${id}`, () => voiceSampleUrl(id));
  }
  /** Znovu načte seznam hlasů ze serveru (zdroj pravdy) vč. seznamu klonů */
  async function refreshVoices() {
    const vs = await fetch("/api/voices").then(r => r.json()).catch(() => null);
    if (Array.isArray(vs?.voices)) {
      setVoices(vs.voices);
      setClones(vs.voices.filter((v: VoiceOption) => v.kind === "clone").map((v: VoiceOption) => ({ id: v.id, name: v.name })));
    }
  }
  async function deleteClone(id: string) {
    if (!(await appConfirm(t.cloneDeleteAsk))) return;
    stopPreview();
    try {
      const res = await fetch("/api/voice-clone", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
        signal: AbortSignal.timeout(30_000),
      });
      const d = await safeJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      setClones(p => p.filter(c => c.id !== id));
      if (voicePref === id) pickVoice("auto");
    } catch (e) {
      await appAlert(`${t.voiceDelErr}${e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : ""}`);
    }
    await refreshVoices();
  }

  // 🪄 Hlas podle popisu (ElevenLabs Voice Design): popis → 3 ukázky → uložit
  const [designDesc, setDesignDesc] = useState("");
  const [designBusy, setDesignBusy] = useState(false);
  const [designSaving, setDesignSaving] = useState(false);
  const [designPreviews, setDesignPreviews] = useState<Array<{ id: string; audioUrl: string }> | null>(null);
  async function designGenerate() {
    if (designBusy || designDesc.trim().length < 10) return;
    setDesignBusy(true);
    setDesignPreviews(null);
    try {
      const res = await fetch("/api/voice-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({ op: "previews", description: designDesc.trim(), language: uiLang }),
      });
      const d = await safeJson<{ previews?: Array<{ id: string; audioUrl: string }>; error?: string }>(res);
      if (!res.ok || !d.previews?.length) throw new Error(d.error || "no previews");
      setDesignPreviews(d.previews);
    } catch (e) {
      await appAlert(`${t.designErr}${e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : ""}`);
    } finally {
      setDesignBusy(false);
    }
  }
  async function designSave(previewId: string) {
    if (designSaving) return;
    setDesignSaving(true);
    try {
      const name = (designDesc.split(/[,.;…]/)[0] || "").trim().slice(0, 40)
        || (uiLang === "en" ? "Custom narrator" : "Vlastní vypravěč");
      const res = await fetch("/api/voice-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(45_000),
        body: JSON.stringify({ op: "save", generatedVoiceId: previewId, name, description: designDesc.trim() }),
      });
      const d = await safeJson<{ id?: string; error?: string }>(res);
      if (!res.ok || !d.id) throw new Error(d.error || "save failed");
      setDesignPreviews(null);
      setDesignDesc("");
      await refreshVoices();
      pickVoice(d.id);
      await appAlert(`✓ ${t.voiceAdded}`); // potvrzení, že hlas je uložený
    } catch (e) {
      await appAlert(`${t.designErr}${e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : ""}`);
    } finally {
      setDesignSaving(false);
    }
  }
  async function deleteDesigned(id: string) {
    if (!(await appConfirm(t.voiceDelAsk))) return;
    stopPreview();
    try {
      const res = await fetch("/api/voice-design", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ op: "delete", id }),
      });
      const d = await safeJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      if (voicePref === id) pickVoice("auto");
    } catch (e) {
      await appAlert(`${t.voiceDelErr}${e instanceof Error && e.message ? ` (${e.message.slice(0, 160)})` : ""}`);
    }
    await refreshVoices();
  }

  // Background generation state (LOCAL in-browser pipeline)
  const [bgStatus, setBgStatus] = useState<"idle" | "writing" | "generating" | "done">("idle");
  const [bgProgress, setBgProgress] = useState({ done: 0, total: 0 });
  const bgBufferRef = useRef<RenderedScene[]>([]);
  const bgTitleRef = useRef<string>("");

  // Server jobs — a QUEUE: several fairy tales can generate on Vercel at once,
  // each gets its own toast row and the newest one drives the gen-cards
  type JobLogEntry = { t: number; m: string };
  type ServerJob = { jobId: string; phase: "writing" | "generating" | "done" | "error"; done: number; total: number; title?: string; error?: string; stalled?: boolean; imgError?: string; restarts?: number; stuckRestarts?: number; lastError?: string; log?: JobLogEntry[] };
  const MAX_ACTIVE_JOBS = 3;
  // 📋 Otevřený deník běhu jobu (overlay) — entries se berou živě z pollů
  // (jobId → entries živě z pollů; entries → snapshot z hotové pohádky v historii)
  const [logView, setLogView] = useState<{ title: string; jobId?: string; entries?: JobLogEntry[] } | null>(null);
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

  // ✕ na dílu tlačítka: zrušit pohádku jedním ťuknutím (z fronty + data na serveru)
  const cancelServerJob = useCallback((jobId: string) => {
    removeServerJob(jobId);
    const keep = serverJobsRef.current.filter(j => j.jobId !== jobId).map(j => j.jobId);
    fetch("/api/job/cleanup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deleteIds: [jobId], keepIds: keep }),
    }).catch(() => {});
  }, [removeServerJob]);

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
      // Uložený PRÁZDNÝ výběr se respektuje (uživatel odškrtal všechny);
      // teprve chybějící/neplatný záznam znamená „vybrat všechny"
      if (Array.isArray(saved.selectedIds)) {
        const validIds = new Set(list.map(c => c.id));
        const filtered = saved.selectedIds.filter(id => validIds.has(id));
        setSelectedIds(saved.selectedIds.length === 0 || filtered.length > 0 ? filtered : list.map(c => c.id));
      } else {
        setSelectedIds(list.map(c => c.id));
      }
      if (Array.isArray(saved.selectedCustomIds)) setSelectedCustomIds(saved.selectedCustomIds);
      settingsReadyRef.current = true; // od teď se změny výběru průběžně ukládají
    }).catch(() => { settingsReadyRef.current = true; });
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

    // 📋 Zpětné doplnění deníku k čerstvě hotovým pohádkám (dokončila je
    // starší verze appky / jiné zařízení) — status.json na serveru žije ~1 h
    (async () => {
      const missing = loadHistory()
        .filter(e => !e.log?.length && Date.now() - new Date(e.createdAt).getTime() < 3600_000)
        .slice(0, 3);
      for (const e of missing) {
        try {
          const r = await fetch(`/api/job/status?id=${e.id}`, { cache: "no-store" });
          if (!r.ok) continue;
          const stj = await r.json();
          if (Array.isArray(stj?.log) && stj.log.length) {
            const all = loadHistory();
            const idx = all.findIndex(x => x.id === e.id);
            if (idx >= 0) {
              all[idx] = { ...all[idx], log: stj.log };
              localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
              setStoryHistory(all);
            }
          }
        } catch {}
      }
    })();

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
    // an image AND the story still exists in history (orphaned draft of a
    // DELETED story used to resurrect forever). The app opens on the MAIN
    // MENU (form); the restored book sits below it.
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      const hist = loadHistory();
      let restored = false;
      if (raw) {
        const draft = JSON.parse(raw);
        const histMatch = draft?.id
          ? hist.find(e => e.id === draft.id)
          : hist.find(e => e.title === draft?.title); // starší draft bez id
        if (draft?.scenes?.length > 0 && draft.title && histMatch
            && draft.scenes.every((s: RenderedScene) => s.imageUrl)) {
          setTitle(draft.title);
          setScenes(draft.scenes);
          setPage(draft.page ?? 0);
          readerEntryIdRef.current = histMatch.id;
          readerHeroRef.current = histMatch.heroDescription || "";
          readerCharIdsRef.current = histMatch.selectedIds || [];
          setStoryChoice(histMatch.choice ?? null);
          restored = true;
        }
        localStorage.removeItem(DRAFT_KEY);
      }
      // Osiřelý (smazaný) nebo žádný draft → na plochu POSLEDNÍ pohádka
      // z historie (média z offline cache)
      if (!restored && hist.length > 0) {
        const newest = hist[0];
        getCachedStory(newest.id).then(cached => {
          if (!cached || cached.length === 0 || !cached[0]?.imageUrl) return;
          const rendered = newest.scenes.map((s, i) => ({ ...s, imageUrl: cached[i]?.imageUrl, audioUrl: cached[i]?.audioUrl }));
          renderedMapRef.current.set(newest.id, rendered);
          readerEntryIdRef.current = newest.id;
          readerHeroRef.current = newest.heroDescription || "";
          readerCharIdsRef.current = newest.selectedIds || [];
          setStoryChoice(newest.choice ?? null);
          setBranch(null);
          setTitle(newest.title);
          setScenes(rendered);
          setPage(0);
        }).catch(() => {});
      }
    } catch {}
  }, []);

  // ── Save draft on window switch (Android background kill) ──
  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden && scenes.length > 0 && scenes.every(s => s.imageUrl)) {
        try {
          // id → po obnovení jde draft spárovat s historií (smazaná pohádka se neobnoví)
          localStorage.setItem(DRAFT_KEY, JSON.stringify({ id: readerEntryIdRef.current, title, scenes, page }));
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
      if (merged.every(s => !isPlaceholderImg(s.imageUrl))) {
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
    // Dobrou noc JMENOVITĚ všem postavám této pohádky, v jazyce vyprávění
    const lang = goodnightLang();
    const text = goodnightText(lang, storyCharNames());
    const key = `${selectedVoiceId}|${lang}|${text}`;
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

  // Klávesnice na tabletu/telefonu zakrývala psané pole. Meta interactive-widget
  // nestačí (Samsung Internet a WebView klávesnicí PŘEKRÝVAJÍ obsah, nezmenší ho),
  // proto se řídíme visualViewport API: změříme, kolik pixelů klávesnice zabírá,
  // o tolik odsadíme spodek stránky (--kb-pad) a psané pole posuneme nad klávesnici.
  useEffect(() => {
    const vv = window.visualViewport;

    function keyboardHeight(): number {
      if (!vv) return 0;
      const h = window.innerHeight - vv.height - vv.offsetTop;
      return h > 80 ? h : 0; // menší rozdíly = lišty prohlížeče, ne klávesnice
    }

    function liftFocusedField() {
      const el = document.activeElement as HTMLElement | null;
      if (!el || (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")) return;
      if ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "file") return;
      // Pole uvnitř pevných modálních oken (velký editor…) neposouvat —
      // rolování stránky pod oknem s ním hýbalo do strany
      if (el.closest(".app-confirm-overlay")) return;
      try {
        const kb = keyboardHeight();
        if (kb > 0 && vv) {
          // Viditelný pruh nad klávesnicí (v souřadnicích layout viewportu)
          const visibleBottom = vv.offsetTop + vv.height;
          const r = el.getBoundingClientRect();
          // Zvedat s rezervou (pole nesmí končit těsně nad klávesnicí) a posadit
          // ho VYSOKO nad ni — do horní pětiny viditelného pruhu
          if (r.bottom > visibleBottom - 90 || r.top < vv.offsetTop) {
            window.scrollBy({ top: r.top - vv.offsetTop - Math.max(12, (vv.height - r.height) / 5), behavior: "smooth" });
          }
        } else {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      } catch {}
    }

    function onViewportChange() {
      // Odsazení dole = výška klávesnice → obsah jde odscrollovat nad ni
      document.documentElement.style.setProperty("--kb-pad", `${keyboardHeight()}px`);
      liftFocusedField();
    }

    function onFocusIn(e: FocusEvent) {
      const el = e.target as HTMLElement | null;
      if (!el || (el.tagName !== "TEXTAREA" && el.tagName !== "INPUT")) return;
      if ((el as HTMLInputElement).type === "checkbox" || (el as HTMLInputElement).type === "file") return;
      // Chvilku počkat, než klávesnice vyjede (a visualViewport se přepočítá)
      setTimeout(liftFocusedField, 400);
    }

    document.addEventListener("focusin", onFocusIn);
    vv?.addEventListener("resize", onViewportChange);
    vv?.addEventListener("scroll", onViewportChange);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      vv?.removeEventListener("resize", onViewportChange);
      vv?.removeEventListener("scroll", onViewportChange);
      document.documentElement.style.removeProperty("--kb-pad");
    };
  }, []);

  // ── Rozepsané zadání pohádky přežije aktualizaci appky i přepnutí jinam ──
  // Text se průběžně ukládá do telefonu a po otevření se vrátí do pole;
  // smaže se jen tlačítkem 🧹 (vyprázdněním pole)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOPIC_DRAFT_KEY);
      if (saved) setTopic(prev => prev || saved);
    } catch {}
  }, []);
  useEffect(() => {
    try {
      if (topic.trim()) localStorage.setItem(TOPIC_DRAFT_KEY, topic);
      else localStorage.removeItem(TOPIC_DRAFT_KEY);
    } catch {}
  }, [topic]);

  // Stylové potvrzovací okno místo ošklivého systémového window.confirm
  const [confirmBox, setConfirmBox] = useState<{ msg: string; resolve: (ok: boolean) => void; alert?: boolean } | null>(null);
  function appConfirm(msg: string): Promise<boolean> {
    return new Promise(resolve => setConfirmBox({ msg, resolve }));
  }
  // Stylová hláška jen s OK (náhrada systémového window.alert)
  function appAlert(msg: string): Promise<boolean> {
    return new Promise(resolve => setConfirmBox({ msg, resolve, alert: true }));
  }
  function answerConfirm(ok: boolean) {
    confirmBox?.resolve(ok);
    setConfirmBox(null);
  }

  // Ducking: při mluveném slově se hudební podkres ztiší, v pauzách a mezi
  // scénami se plynule vrátí — realistický podkres, který neruší vyprávění
  useEffect(() => {
    ambientRef.current?.duck(isPlaying);
  }, [isPlaying]);

  // Ovládací panel se v readeru objeví jen ťuknutím a po 5 s sám zmizí —
  // nesmí zakrývat obrázek během čtení
  useEffect(() => {
    if (!ctrlsOpen || viewMode !== "reader") return;
    const timer = setTimeout(() => setCtrlsOpen(false), 5000);
    return () => clearTimeout(timer);
  }, [ctrlsOpen, viewMode]);

  // Wake Lock: při otevřené čtečce displej nezhasíná / nespoří (pohádka
  // běží dlouhé minuty bez dotyku). Po návratu do appky se zámek obnoví.
  useEffect(() => {
    if (viewMode !== "reader") return;
    type WakeSentinel = { release: () => Promise<void> };
    type WakeLockApi = { request: (type: "screen") => Promise<WakeSentinel> };
    const wl = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
    if (!wl) return; // starší prohlížeč — nic se neděje, jen může zhasnout
    let lock: WakeSentinel | null = null;
    let dead = false;
    const acquire = () => {
      wl.request("screen").then(s => {
        if (dead) { s.release().catch(() => {}); } else { lock = s; }
      }).catch(() => {});
    };
    acquire();
    // Systém zámek uvolní při přepnutí appky — po návratu ho vzít znovu
    const onVis = () => { if (document.visibilityState === "visible" && !dead) acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      dead = true;
      document.removeEventListener("visibilitychange", onVis);
      lock?.release().catch(() => {});
    };
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
    if (dx < 0 && nextVisible !== null) goToPage(nextVisible);
    else if (dx > 0 && prevVisible !== null) goToPage(prevVisible);
  }

  // ── Reset to form (keeps old story in memory for "go back") ──
  function resetToForm() {
    audioRef.current?.pause();
    setIsPlaying(false);
    // Domů VŽDY opustí fullscreen i zámek otočení — jinak by se formulář
    // zobrazil obrovský napříč displejem (fullscreen na šířku)
    try { (screen as Screen & { orientation?: { unlock?: () => void } }).orientation?.unlock?.(); } catch {}
    try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
    setForcedLs(false);
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
  // 🔀 Dva konce: pořadí viditelných stránek podle zvolené větve.
  // Před volbou je vidět jen společný děj; konec A/B se připojí po výběru.
  const visiblePages = useMemo(() => {
    const all = scenes.map((_, i) => i);
    if (!storyChoice) return all;
    const { common, altFrom } = storyChoice;
    if (branch === "A") return all.slice(0, altFrom);
    if (branch === "B") return [...all.slice(0, common), ...all.slice(altFrom)];
    return all.slice(0, common);
  }, [scenes, storyChoice, branch]);
  const pagePos = Math.max(0, visiblePages.indexOf(page));
  const nextVisible = pagePos + 1 < visiblePages.length ? visiblePages[pagePos + 1] : null;
  const prevVisible = pagePos > 0 ? visiblePages[pagePos - 1] : null;

  async function pickBranch(b: "A" | "B") {
    if (!storyChoice) return;
    // 🔀 Líná větev B: obrázky druhého konce se kreslí až TEĎ (poprvé)
    if (b === "B") {
      const ready = await ensureBranchB();
      if (!ready) return; // kreslení selhalo/běží — zůstat na rozcestí
    }
    setBranch(b);
    isAutoAdvanceRef.current = true; // zvolený konec se rovnou přehraje
    goToPage(b === "A" ? storyChoice.common : storyChoice.altFrom);
  }

  const goToPage = useCallback((n: number) => {
    if (n < 0 || n >= scenes.length) return;
    // ▶ Brzké čtení: na stránku, která se ještě kreslí, se nedá přejít ručně
    // (jen u pohádky, jejíž generování stále běží; jinak by blokla větev B)
    if (n > 0 && !scenesRef.current[n]?.imageUrl
        && serverJobsRef.current.some(jb => jb.jobId === readerEntryIdRef.current && jb.phase === "generating")) return;
    audioRef.current?.pause();
    setIsPlaying(false);
    setPage(n);
    setSlideKey(k => k + 1);
  }, [scenes.length]);

  function handleAudioEnded() {
    setIsPlaying(false);
    // 🔀 Konec společného děje — místo otáčení stránky se ukáže výběr konce
    if (storyChoice && branch === null && page === storyChoice.common - 1) return;
    if (!autoAdvance) return;
    const next = nextVisible;
    if (next === null) {
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

  // ── 🎙️ Líný hlas — audio se vyrábí AŽ PŘI ČTENÍ hotové pohádky ───────────
  // Generování pohádky vyrábí jen text a obrázky; namluvení vzniká pro
  // aktuální stránku + 2 následující (a ukládá se do cache, platí se jednou).
  // Nepřehrané pohádky tak hlas vůbec neplatí.
  const readerEntryIdRef = useRef<string | null>(null);
  // Kontext otevřené pohádky pro líné dokreslení větve B (zámek vzhledu + reference)
  const readerHeroRef = useRef<string>("");
  const readerCharIdsRef = useRef<string[]>([]);

  // 🌙 Jména postav AKTUÁLNÍ pohádky (pro titulky a jmenovitou dobrou noc)
  function storyCharNames(): string[] {
    const ids = readerCharIdsRef.current?.length ? readerCharIdsRef.current : selectedIds;
    return [
      ...chars.filter(c => ids.includes(c.id)).map(c => (uiLang === "en" && c.nameEn ? c.nameEn : c.name)),
      ...customChars.filter(c => selectedCustomIds.includes(c.id)).map(c => c.name),
    ];
  }
  // Jazyk dobré noci = jazyk vypravěče s pevným jazykem, jinak jazyk prostředí
  function goodnightLang(): string {
    const vl = voices.find(v => v.id === selectedVoiceId)?.language;
    return isStoryLang(vl) ? vl! : uiLang;
  }

  // Jedna scéna → obrázek přes /api/scene (kotva = 1. obrázek pohádky)
  async function drawSceneImage(
    s: Scene, heroDescription: string, characterIds: string[], anchorUrl?: string
  ): Promise<string | null> {
    try {
      const m = anchorUrl?.match(/^data:(image\/[a-z.+-]+);base64,(.+)$/);
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          scene: { index: s.index, narration: s.narration, imagePrompt: s.imagePrompt, soundscape: s.soundscape },
          heroDescription,
          characterIds,
          noAudio: true,
          deviceId: deviceId(),
          ...(m ? { styleAnchor: { mimeType: m[1], data: m[2] } } : {}),
        }),
      });
      const d = await safeJson<{ imageUrl?: string }>(res);
      return res.ok && d.imageUrl && !isPlaceholderImg(d.imageUrl) ? d.imageUrl : null;
    } catch {
      return null;
    }
  }

  // 🔀 Dokreslení větve B při prvním výběru druhého konce (s progres oknem)
  const branchGenRef = useRef(false);
  const [branchProg, setBranchProg] = useState<{ done: number; total: number } | null>(null);
  async function ensureBranchB(): Promise<boolean> {
    if (!storyChoice) return false;
    const missing = scenes
      .map((s, i) => (i >= storyChoice.altFrom && (!s.imageUrl || isPlaceholderImg(s.imageUrl)) ? i : -1))
      .filter(i => i >= 0);
    if (missing.length === 0) return true;
    if (branchGenRef.current) return false;
    branchGenRef.current = true;
    setBranchProg({ done: 0, total: missing.length });
    let done = 0;
    let okCount = 0;
    let idx = 0;
    const anchorUrl = scenes[0]?.imageUrl;
    const hero = readerHeroRef.current;
    const charIds = readerCharIdsRef.current;
    const worker = async () => {
      while (idx < missing.length) {
        const i = missing[idx++];
        const url = await drawSceneImage(scenes[i], hero, charIds, anchorUrl);
        if (url) {
          okCount += 1;
          setScenes(prev => {
            const next = [...prev];
            if (next[i]) next[i] = { ...next[i], imageUrl: url };
            const eid = readerEntryIdRef.current;
            if (eid) {
              renderedMapRef.current.set(eid, next);
              cacheStory(eid, next).catch(() => {});
            }
            return next;
          });
        }
        done += 1;
        setBranchProg({ done, total: missing.length });
      }
    };
    try {
      await Promise.all([worker(), worker()]);
    } finally {
      branchGenRef.current = false;
      setBranchProg(null);
    }
    if (okCount < missing.length) {
      await appAlert(t.branchDrawErr);
      return false;
    }
    return true;
  }
  // Klíč = pohádka:stránka; po úspěchu se NEMAŽE (state update chodí s malým
  // zpožděním a smazání hned po fetchi vedlo k duplicitnímu — placenému —
  // namluvení stejné stránky)
  const audioFetchRef = useRef<Set<string>>(new Set());
  async function ensureAudio(i: number) {
    const s = scenes[i];
    if (!s || s.audioUrl || !s.narration || isPlaceholderImg(s.imageUrl)) return;
    const fetchKey = `${readerEntryIdRef.current || "x"}:${i}`;
    if (audioFetchRef.current.has(fetchKey)) return;
    audioFetchRef.current.add(fetchKey);
    let ok = false;
    try {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          scene: { index: s.index, narration: s.narration, imagePrompt: s.imagePrompt || "x" },
          audioOnly: true,
          voiceId: selectedVoiceId || undefined,
          deviceId: deviceId(),
        }),
      });
      const d = await safeJson<{ audioUrl?: string }>(res);
      if (!res.ok || !d.audioUrl) return;
      ok = true;
      setScenes(prev => {
        const next = [...prev];
        if (!next[i] || next[i].audioUrl) return prev;
        next[i] = { ...next[i], audioUrl: d.audioUrl };
        const eid = readerEntryIdRef.current;
        if (eid) {
          renderedMapRef.current.set(eid, next);
          cacheStory(eid, next).catch(() => {});
        }
        return next;
      });
    } catch {} finally {
      // Neúspěch → klíč uvolnit (další pokus povolen); úspěch klíč drží
      if (!ok) audioFetchRef.current.delete(fetchKey);
    }
  }
  useEffect(() => {
    if (viewMode !== "reader" || scenes.length === 0) return;
    ensureAudio(page);
    // předvyrobit hlas dalších TŘÍ viditelných stránek (respektuje větev) —
    // při brzkém čtení nesmí čtenář na hlas čekat
    const pos = visiblePages.indexOf(page);
    for (const i of visiblePages.slice(Math.max(0, pos + 1), Math.max(0, pos + 1) + 3)) ensureAudio(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, page, scenes, branch]);

  // Před sdílením/exportem se chybějící namluvení doplní — odeslaná pohádka
  // („hotový odsouhlasený příběh") je vždy kompletní i s hlasem
  async function fillMissingAudio(
    entry: HistoryEntry,
    media: Array<{ imageUrl?: string; audioUrl?: string }>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const missing = entry.scenes.map((s, i) => (!media[i]?.audioUrl && s.narration ? i : -1)).filter(i => i >= 0);
    if (missing.length === 0) return;
    let done = 0;
    let idx = 0;
    const worker = async () => {
      while (idx < missing.length) {
        const i = missing[idx++];
        try {
          const s = entry.scenes[i];
          const res = await fetch("/api/scene", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: AbortSignal.timeout(60_000),
            body: JSON.stringify({
              scene: { index: s.index, narration: s.narration, imagePrompt: s.imagePrompt || "x" },
              audioOnly: true,
              voiceId: selectedVoiceId || undefined,
              deviceId: deviceId(),
            }),
          });
          const d = await safeJson<{ audioUrl?: string }>(res);
          if (res.ok && d.audioUrl) media[i] = { ...(media[i] || {}), audioUrl: d.audioUrl };
        } catch {}
        done += 1;
        onProgress?.(done, missing.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, missing.length) }, worker));
    cacheStory(entry.id, entry.scenes.map((s, i) => ({ ...s, ...(media[i] || {}) })) as RenderedScene[]).catch(() => {});
  }

  // Před sdílením/exportem dokreslit i chybějící obrázky (líná větev B) —
  // odeslaná pohádka musí mít oba konce kompletní
  async function fillMissingImages(
    entry: HistoryEntry,
    media: Array<{ imageUrl?: string; audioUrl?: string }>,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const missing = entry.scenes
      .map((s, i) => (!media[i]?.imageUrl || isPlaceholderImg(media[i]?.imageUrl) ? i : -1))
      .filter(i => i >= 0);
    if (missing.length === 0) return;
    let done = 0;
    let idx = 0;
    const anchorUrl = media[0]?.imageUrl;
    const worker = async () => {
      while (idx < missing.length) {
        const i = missing[idx++];
        const url = await drawSceneImage(entry.scenes[i], entry.heroDescription || "", entry.selectedIds || [], anchorUrl);
        if (url) media[i] = { ...(media[i] || {}), imageUrl: url };
        done += 1;
        onProgress?.(done, missing.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, missing.length) }, worker));
    cacheStory(entry.id, entry.scenes.map((s, i) => ({ ...s, ...(media[i] || {}) })) as RenderedScene[]).catch(() => {});
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
  // Rozhoduje se podle SKUTEČNÉHO stavu fullscreenu (ne podle stavu tlačítka)
  // — když se appka do fullscreenu dostala jinou cestou, jedno ťuknutí ho
  // rovnou opustí (dřív bylo potřeba mačkat 2×).
  async function toggleForcedLandscape() {
    const so = (screen as Screen & { orientation?: { lock?: (o: string) => Promise<void>; unlock?: () => void } }).orientation;
    const inFs = !!document.fullscreenElement;
    if (!inFs) {
      try { await document.documentElement.requestFullscreen?.(); } catch {}
      try { await so?.lock?.("landscape"); } catch {}
      setForcedLs(true);
    } else {
      try { so?.unlock?.(); } catch {}
      try { await document.exitFullscreen(); } catch {}
      setForcedLs(false);
    }
  }

  // Ikona tlačítka sleduje skutečný stav fullscreenu (i systémové gesto zpět)
  useEffect(() => {
    function onFsChange() {
      setForcedLs(!!document.fullscreenElement);
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
    if (!background && entryId) readerEntryIdRef.current = entryId;
    if (!background) {
      readerHeroRef.current = heroDescription;
      readerCharIdsRef.current = selectedIds;
    }
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

    // Hlas je líný (vyrábí se až při čtení) — scéna je hotová s obrázkem
    const sceneNeedsWork = (s: RenderedScene) => isPlaceholderImg(s.imageUrl);
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
            noAudio: true, // hlas líně až při čtení
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
          // kontext OTEVŘENÉ pohádky (i starší z historie), ne posledního generování
          heroDescription: readerHeroRef.current || heroDescRef.current,
          characterIds: readerCharIdsRef.current?.length ? readerCharIdsRef.current : selectedIds,
          customCharacterImages: imageRefsRef.current,
          voiceId: selectedVoiceId || undefined,
          noAudio: true,
          deviceId: deviceId(),
          ...(m ? { styleAnchor: { mimeType: m[1], data: m[2] } } : {}),
        }),
      });
      const media = await safeJson<{ imageUrl?: string; audioUrl?: string; error?: string }>(res);
      if (res.ok && media.imageUrl && !isPlaceholderImg(media.imageUrl)) {
        setScenes(prev => {
          const n = [...prev];
          n[i] = { ...n[i], imageUrl: media.imageUrl, audioUrl: n[i].audioUrl || media.audioUrl };
          // překreslení se ULOŽÍ k pohádce — dřív po reloadu vadný obrázek zůstal
          const eid = readerEntryIdRef.current;
          if (eid) {
            renderedMapRef.current.set(eid, n);
            cacheStory(eid, n).catch(() => {});
          }
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
  // Meta rozpracované pohádky (nadpis, zámek vzhledu, rozcestí) pro brzké čtení
  const jobMetaRef = useRef<Map<string, { title?: string; heroDescription?: string; choice?: StoryChoiceMeta }>>(new Map());
  // Stall watch (per job): when the server function dies on the 5-min limit, kick /continue
  const jobStallRef = useRef<Map<string, { lastChange: number; lastSig: string; lastKick: number; fails404: number; manualKicks: number; autoKicks: number }>>(new Map());

  function stallStateFor(jobId: string) {
    let w = jobStallRef.current.get(jobId);
    if (!w) { w = { lastChange: 0, lastSig: "", lastKick: 0, fails404: 0, manualKicks: 0, autoKicks: 0 }; jobStallRef.current.set(jobId, w); }
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

  async function finalizeServerJob(st: { title?: string; heroDescription?: string; scenesScript?: Scene[]; sceneUrls?: Record<number, string>; total?: number; voiceId?: string; choice?: StoryChoiceMeta; createdAt?: number; wroteAt?: number; finishedAt?: number; log?: JobLogEntry[] }, jobId: string) {
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
      choice: st.choice,
      // ⏱ Tracker přípravy: celkem / z toho psaní (sekundy)
      prepSec: st.createdAt && st.finishedAt ? Math.max(0, Math.round((st.finishedAt - st.createdAt) / 1000)) : undefined,
      writeSec: st.createdAt && st.wroteAt ? Math.max(0, Math.round((st.wroteAt - st.createdAt) / 1000)) : undefined,
      log: st.log, // 📋 deník přípravy zůstává dostupný i po dokončení
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

  // ▶ Brzké čtení: otevřít ROZPRACOVANOU pohádku, jakmile je hotová scéna 1 —
  // zbytek se dokresluje na pozadí a do čtečky přitéká průběžně
  function openRunningJob(jobId: string) {
    const buf = jobBuffersRef.current.get(jobId);
    if (!buf || !buf[0]?.imageUrl) return;
    const meta = jobMetaRef.current.get(jobId);
    audioRef.current?.pause();
    setIsPlaying(false);
    introFiredRef.current = false;
    setTitle(meta?.title || serverJobsRef.current.find(j => j.jobId === jobId)?.title || "Pohádka");
    readerEntryIdRef.current = jobId;
    readerHeroRef.current = meta?.heroDescription || "";
    readerCharIdsRef.current = selectedIds;
    setStoryChoice(meta?.choice ?? null);
    setBranch(null);
    setScenes(buf.map(s => ({ ...s })));
    setPage(0);
    setSlideKey(k => k + 1);
    setViewMode("reader");
    isAutoAdvanceRef.current = true;
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
    readerEntryIdRef.current = job.jobId;
    // 🔀 Dva konce: meta výběru z uložené historie + kontext pro línou větev B
    const hEntry = loadHistory().find(e => e.id === job.jobId);
    readerHeroRef.current = hEntry?.heroDescription || "";
    readerCharIdsRef.current = hEntry?.selectedIds || selectedIds;
    setStoryChoice(hEntry?.choice ?? null);
    setBranch(null);
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
        // ▶ Brzké čtení: čtečka otevřená na rozpracované pohádce dostává
        // dokreslené scény průběžně
        if (readerEntryIdRef.current === jobId) {
          setScenes(prev => {
            if (!b || prev.length !== b.length || !prev[i] || prev[i].imageUrl) return prev;
            const nx = [...prev];
            nx[i] = { ...nx[i], imageUrl: m.imageUrl, audioUrl: m.audioUrl || nx[i].audioUrl };
            return nx;
          });
        }
      }).catch(() => { jm!.fetching.delete(i); });
    }
  }

  // ── ▶ Brzké čtení BEZ ČEKÁNÍ ──────────────────────────────────────────────
  // Tlačítko „Číst" se ukáže teprve, když (1) je hotová 1. stránka VČETNĚ
  // hlasu a (2) odhad říká, že čtenář generování nedožene: zásoba čtení
  // (souvislé hotové stránky od začátku) ≥ odhad zbývajícího generování
  // (měřené tempo scén/s tohoto jobu) s rezervou. Hlas 1.–2. stránky se
  // namlouvá dopředu — po otevření se hraje hned.
  const READ_CHARS_PER_SEC = 13; // ~tempo předčítání
  const PAGE_TURN_SEC = 3;       // prodleva mezi stránkami
  const jobPaceRef = useRef<Map<string, { t0: number; done0: number }>>(new Map());
  const [earlyReadyJobs, setEarlyReadyJobs] = useState<Set<string>>(new Set());

  async function prefetchJobAudio(jobId: string, i: number) {
    const buf = jobBuffersRef.current.get(jobId);
    const s = buf?.[i];
    if (!s || s.audioUrl || !s.narration || !s.imageUrl) return;
    const fetchKey = `${jobId}:${i}`; // stejný klíč jako ensureAudio → žádné dvojí namluvení
    if (audioFetchRef.current.has(fetchKey)) return;
    audioFetchRef.current.add(fetchKey);
    let ok = false;
    try {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          scene: { index: s.index, narration: s.narration, imagePrompt: s.imagePrompt || "x" },
          audioOnly: true,
          voiceId: selectedVoiceId || undefined,
          deviceId: deviceId(),
        }),
      });
      const d = await safeJson<{ audioUrl?: string }>(res);
      if (!res.ok || !d.audioUrl) return;
      ok = true;
      const b = jobBuffersRef.current.get(jobId);
      if (b?.[i]) b[i] = { ...b[i], audioUrl: d.audioUrl };
      const jm = jobMediaRef.current.get(jobId);
      const m = jm?.scenes.get(i);
      if (m) jm!.scenes.set(i, { ...m, audioUrl: d.audioUrl });
      // otevřená čtečka téhle pohádky dostane hlas okamžitě
      if (readerEntryIdRef.current === jobId) {
        setScenes(prev => {
          if (!prev[i] || prev[i].audioUrl) return prev;
          const nx = [...prev];
          nx[i] = { ...nx[i], audioUrl: d.audioUrl };
          return nx;
        });
      }
    } catch {} finally {
      if (!ok) audioFetchRef.current.delete(fetchKey);
    }
  }

  function updateEarlyReady(jobId: string, st: { phase: string; done?: number; total?: number }) {
    const buf = jobBuffersRef.current.get(jobId);
    let ready = false;
    if (st.phase === "generating" && buf?.[0]?.imageUrl) {
      const done = st.done ?? 0;
      const total = st.total || buf.length;
      // Tempo generování měřené od prvního pozorování této fáze — dokud není
      // z čeho měřit, počítá se konzervativně (arch dodá scény skokem)
      let pace = jobPaceRef.current.get(jobId);
      if (!pace) { pace = { t0: Date.now(), done0: done }; jobPaceRef.current.set(jobId, pace); }
      const observed = done - pace.done0;
      const secPerScene = observed >= 1 ? (Date.now() - pace.t0) / 1000 / observed : 40;
      // Zásoba čtení: souvislé hotové stránky od začátku knihy
      let readSec = 0;
      for (const s of buf) {
        if (!s?.imageUrl) break;
        readSec += (s.narration?.length || 0) / READ_CHARS_PER_SEC + PAGE_TURN_SEC;
      }
      const remainingSec = Math.max(0, total - done) * secPerScene;
      ready = done >= total || readSec >= remainingSec * 1.2 + 15;
      if (ready) {
        // Namluvit 1.–2. stránku dopředu; tlačítko čeká, až je hlas 1. stránky doma
        void prefetchJobAudio(jobId, 0);
        void prefetchJobAudio(jobId, 1);
        if (!jobBuffersRef.current.get(jobId)?.[0]?.audioUrl) ready = false;
      }
    }
    setEarlyReadyJobs(prev => {
      if (prev.has(jobId) === ready) return prev;
      const nx = new Set(prev);
      if (ready) nx.add(jobId); else nx.delete(jobId);
      return nx;
    });
  }

  // When done/total stops moving for too long, the server function most
  // likely hit Vercel's 5-minute limit → ask /api/job/continue to resume
  function maybeKickContinue(jobId: string, st: { phase: string; done?: number; total?: number }, stalledNow?: boolean) {
    const w = stallStateFor(jobId);
    const sig = `${st.phase}|${st.done ?? -1}/${st.total ?? -1}`;
    const now = Date.now();
    if (sig !== w.lastSig) {
      w.lastSig = sig; w.lastChange = now;
      w.autoKicks = 0; // posun vpřed → počítadlo oživení se nuluje
      lastProgressRef.current = now; // server progress feeds the local stall watchdog too
      if (stalledNow) updateServerJob(jobId, { stalled: false });
      return;
    }
    // writing has no progress signal → longer patience (Claude can take ~3 min on 20 scenes)
    const limit = st.phase === "writing" ? 240_000 : 150_000;
    if (now - w.lastChange < limit) return;
    if (!stalledNow) updateServerJob(jobId, { stalled: true });
    if (now - w.lastKick < 120_000) return;
    // Pojistka proti pálení kreditu: po 4 automatických oživeních BEZ posunu
    // se job zastaví s chybou — každé oživení překresluje scény (Gemini platby
    // a denní kvóta 1000/den). Dál jde jen ručně: ✕ zrušit, nebo ťuknout ⚠️.
    if (w.autoKicks >= 4) {
      stopJobPolling(jobId);
      updateServerJob(jobId, { phase: "error", error: t.errAutoKicks });
      return;
    }
    w.autoKicks++;
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
          // restarts/lastError: diagnostika, proč se psaní opakuje (viditelná v řádku)
          updateServerJob(jobId, { phase: "writing", restarts: st.restarts || 0, stuckRestarts: st.stuckRestarts || 0, lastError: st.lastError || undefined, log: st.log });
        } else if (st.phase === "generating") {
          jobMetaRef.current.set(jobId, { title: st.title, heroDescription: st.heroDescription, choice: st.choice });
          prefetchJobScenes(jobId, st);
          updateEarlyReady(jobId, st); // ▶ Číst se ukáže, až čtenář nebude muset čekat
          updateServerJob(jobId, { phase: "generating", done: st.done || 0, total: st.total || 0, title: st.title, imgError: st.imgError || undefined, log: st.log });
        } else if (st.phase === "done") {
          stopJobPolling(jobId);
          await finalizeServerJob(st, jobId);
        } else if (st.phase === "error") {
          stopJobPolling(jobId);
          updateServerJob(jobId, { phase: "error", error: String(st.error || t.errGeneric), log: st.log });
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
        if (!(await appConfirm(t.cellularWarn))) return;
        sessionStorage.setItem("nicky-cell-ok", "1");
      }
    } catch {}

    // 🔀 Dva konce se před generováním potvrzují (generuje se ~30 % navíc)
    if (twoEndings && !(await appConfirm(t.twoEndsAsk))) return;

    const selectedCustomObjsForJob = customChars.filter(c => selectedCustomIds.includes(c.id));
    // Vlastní svět nebo klasická pohádka: prompt jde místo themeId, fotka světa jako inspirace
    const activeCustomTheme = customThemes.find(ct => ct.id === selectedTheme);
    const activeFolk = folkTaleById(selectedTheme);
    const themeOverride = activeCustomTheme
      ? { name: activeCustomTheme.name, prompt: activeCustomTheme.prompt }
      : activeFolk ? { name: activeFolk.name, prompt: activeFolk.prompt } : undefined;
    const storyPayload = {
      topic, themeId: themeOverride ? undefined : selectedTheme || undefined,
      customTheme: themeOverride,
      characterIds: selectedIds,
      age: AGE_BANDS.find(b => b.id === agePref)?.age ?? getTargetAge([...selectedIds, ...selectedCustomIds]),
      sceneCount,
      // Jazyk pohádky určuje VYPRAVĚČ (hlas a jazyk jsou jeden výběr):
      // hlas s pevným jazykem (🇨🇿/🇬🇧/🇭🇷/🇩🇰/🇸🇰) píše svým jazykem,
      // vícejazyčné hlasy (klon, vymyšlené, Gemini test) → jazyk prostředí
      language: (() => {
        const vl = voices.find(v => v.id === selectedVoiceId)?.language;
        return isStoryLang(vl) ? vl! : uiLang;
      })(),
      previousStory: sequelOf ? { title: sequelOf.title, text: sequelOf.text } : undefined,
      twoEndings,
      customCharacters: selectedCustomObjsForJob.map(c => ({
        id: c.id, name: c.name,
        description: c.description,
        photoBase64: c.photoBase64,
        photoMimeType: c.photoMimeType,
        photos: c.photos,
      })),
      inspirationUrl: inspUrlActive && inspUrl.trim() ? inspUrl.trim() : undefined,
      inspirationImages: [
        ...inspImages.map(i => ({ data: i.data, mimeType: i.mimeType })),
        // Fotky vlastního světa (nové: pole photos, staré světy: 1 fotka)
        ...(activeCustomTheme?.photos?.length
          ? activeCustomTheme.photos
          : activeCustomTheme?.photoBase64 && activeCustomTheme.photoMimeType
            ? [{ data: activeCustomTheme.photoBase64, mimeType: activeCustomTheme.photoMimeType }] : []),
      ],
      inspirationPdfBase64: inspPdfUse ? inspPdf?.base64 || undefined : undefined,
      inspirationPdfUrl: inspPdfUse ? inspPdf?.url || undefined : undefined,
    };

    // Try the SERVER job first — generation survives app switches & screen off.
    // 2 attempts with a generous timeout (cold start + slow mobile upload);
    // the local in-browser pipeline is only a last resort, it has no queue.
    const jobBody = JSON.stringify({
      ...storyPayload,
      voiceId: selectedVoiceId || "",
      deviceId: deviceId(),
      customCharacterImages: selectedCustomObjsForJob
        .flatMap(c => c.photos?.length
          ? c.photos
          : c.photoBase64 && c.photoMimeType ? [{ data: c.photoBase64, mimeType: c.photoMimeType }] : []),
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
            saveSettings({ selectedVoiceId, sceneCount, selectedTheme, selectedIds, selectedCustomIds });
            addServerJob(jobId);
            setSequelOf(null); // pokračování je zadané — chip zmizí
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
      setStoryChoice(null); setBranch(null);
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

      // 🔀 Dva konce: konec B se generuje hned za koncem A (jeden seznam scén)
      const choiceMeta: StoryChoiceMeta | undefined = script.choice
        ? { common: script.choice.afterScene, altFrom: script.scenes.length, options: script.choice.options }
        : undefined;
      const fullScenes = script.choice ? [...script.scenes, ...script.choice.altScenes] : script.scenes;
      setStoryChoice(choiceMeta ?? null);
      setBranch(null);

      // Save to history immediately (text only, before slow image generation)
      const entry: HistoryEntry = {
        id: crypto.randomUUID(),
        title: script.title,
        heroDescription: script.heroDescription,
        createdAt: new Date().toISOString(),
        scenes: fullScenes,
        selectedIds,
        themeId: selectedTheme,
        topic,
        choice: choiceMeta,
      };
      saveHistory(entry);
      setStoryHistory(loadHistory());
      setSequelOf(null); // pokračování je napsané — chip zmizí

      const customImageRefs = selectedCustomObjs
        .flatMap(c => c.photos?.length
          ? c.photos
          : c.photoBase64 && c.photoMimeType ? [{ data: c.photoBase64, mimeType: c.photoMimeType }] : []);

      saveSettings({ selectedVoiceId, sceneCount, selectedTheme, selectedIds, selectedCustomIds });
      const finalScenes = await generateMedia(script.title, script.heroDescription, fullScenes, customImageRefs, selectedVoiceId, background, entry.id);
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

  // Custom worlds (story themes by description; photos/photoBase64 =
  // zpětná kompatibilita se staršími světy uloženými s fotkami)
  interface CustomTheme { id: string; name: string; prompt: string; photos?: Array<{ data: string; mimeType: string }>; photoBase64?: string; photoMimeType?: string; previewUrl?: string }
  const [customThemes, setCustomThemes] = useState<CustomTheme[]>([]);
  // 🎡 Roller světů — světy i klasické pohádky v JEDNOM válci za tlačítkem
  const [worldOpen, setWorldOpen] = useState(false);
  // 🧒 Výběr postav jako roller se zaškrtávátky (vícero postav najednou)
  const [charOpen, setCharOpen] = useState(false);
  // 💡 Ponaučení pohádky — rolovací výběr; text se předá vypravěči,
  // který ho vplete do děje (bez kázání)
  // 🔀 Dva konce — defaultně vypnuto, před generováním se potvrzuje
  const [twoEndings, setTwoEndings] = useState(false);
  // 📖 Pokračování uložené pohádky: nový díl naváže na minulý děj
  const [sequelOf, setSequelOf] = useState<{ id: string; title: string; text: string } | null>(null);
  const [addingTheme, setAddingTheme] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [newThemeDesc, setNewThemeDesc] = useState("");
  const [newThemePhotos, setNewThemePhotos] = useState<Array<{ data: string; mimeType: string; previewUrl: string }>>([]);
  // 🧠 Nastudování světa: Claude z popisu (i odkazu) sestaví průvodce světem,
  // případně vrátí jednu doplňující otázku — uživatel doplní a nechá znovu
  const [worldStudyLoading, setWorldStudyLoading] = useState(false);
  const [worldQuestion, setWorldQuestion] = useState<string | null>(null);
  const [worldStudyError, setWorldStudyError] = useState(false);
  async function studyNewWorld() {
    if (!newThemeName.trim() && !newThemeDesc.trim()) return;
    setWorldStudyLoading(true);
    setWorldQuestion(null);
    setWorldStudyError(false);
    try {
      const res = await fetch("/api/world-study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(55_000),
        body: JSON.stringify({ language: uiLang, name: newThemeName, description: newThemeDesc }),
      });
      const d = await safeJson<{ prompt?: string; question?: string | null }>(res);
      if (res.ok && d.prompt) {
        setNewThemeDesc(d.prompt);
        setWorldQuestion(d.question || null);
      } else {
        setWorldStudyError(true);
      }
    } catch {
      setWorldStudyError(true);
    } finally {
      setWorldStudyLoading(false);
    }
  }
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CUSTOM_THEMES_KEY);
      if (raw) {
        const list = JSON.parse(raw) as CustomTheme[];
        setCustomThemes(list.map(c => ({
          ...c,
          previewUrl: c.photos?.[0]
            ? `data:${c.photos[0].mimeType};base64,${c.photos[0].data}`
            : c.photoBase64 && c.photoMimeType ? `data:${c.photoMimeType};base64,${c.photoBase64}` : undefined,
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
    ? (THEME_BG[selectedTheme]
        ?? (customThemes.some(ct => ct.id === selectedTheme) || folkTaleById(selectedTheme) ? "fantasy" : "night"))
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
  // Výběr světa pozadí: velké tlačítko otevře rolovací nabídku (jako 📜 pohádky)
  const [bgPickerOpen, setBgPickerOpen] = useState(false);
  // 🔍 Náhled pozadí PODRŽENÍM: po 350 ms se ukáže malá karta s ilustrací,
  // která se pak plynule roztáhne na celý displej; puštění náhled zavře,
  // obyčejné ťuknutí svět vybírá (klik po podržení se potlačí)
  const [bgHold, setBgHold] = useState<{ id: string; url: string | null; full: boolean } | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFullTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFiredRef = useRef(false);

  function beginBgHold(sceneId: string) {
    holdFiredRef.current = false;
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    holdTimerRef.current = setTimeout(async () => {
      holdFiredRef.current = true;
      setBgHold({ id: sceneId, url: bgUrlCacheRef.current[sceneId] ?? null, full: false });
      holdFullTimerRef.current = setTimeout(
        () => setBgHold(p => (p && p.id === sceneId ? { ...p, full: true } : p)),
        700
      );
      if (!bgUrlCacheRef.current[sceneId]) {
        try {
          const r = await fetch(`/api/bg-image?scene=${sceneId}`, { signal: AbortSignal.timeout(110_000) });
          const d = r.ok ? ((await r.json()) as { url?: string }) : null;
          if (d?.url) {
            bgUrlCacheRef.current[sceneId] = d.url;
            setBgHold(p => (p && p.id === sceneId ? { ...p, url: d.url! } : p));
          }
        } catch {}
      }
    }, 350);
  }

  function endBgHold() {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (holdFullTimerRef.current) clearTimeout(holdFullTimerRef.current);
    setBgHold(null);
  }
  function pickBg(id: string) {
    setBgChoice(id);
    try { localStorage.setItem(BG_KEY, id); } catch {}
    setBgPickerOpen(false);
  }
  const bgLabel = bgChoice === "auto"
    ? `🎨 ${t.bgAuto}`
    : `${bgSceneById(bgChoice)!.emoji} ${uiLang === "en" ? bgSceneById(bgChoice)!.nameEn : bgSceneById(bgChoice)!.name}`;

  // 🎬 Úvodní obrazovka — při každém otevření appky jiný pohádkový motiv
  // (vesmír, džungle, moře…), nadpis, verze a slogan; sama zmizí, ťuknutí přeskočí
  const [intro, setIntro] = useState<{ scene: string; url: string | null; closing: boolean } | null>(null);
  useEffect(() => {
    const scene = BG_SCENES[Math.floor(Math.random() * BG_SCENES.length)];
    setIntro({ scene: scene.id, url: bgUrlCacheRef.current[scene.id] ?? null, closing: false });
    let dead = false;
    if (!bgUrlCacheRef.current[scene.id]) {
      fetch(`/api/bg-image?scene=${scene.id}`, { signal: AbortSignal.timeout(15_000) })
        .then(r => (r.ok ? r.json() : null))
        .then((d: { url?: string } | null) => {
          if (dead || !d?.url) return;
          bgUrlCacheRef.current[scene.id] = d.url;
          setIntro(p => (p && p.scene === scene.id && !p.closing ? { ...p, url: d.url! } : p));
        })
        .catch(() => {});
    }
    const t1 = setTimeout(() => setIntro(p => (p ? { ...p, closing: true } : p)), 3300);
    const t2 = setTimeout(() => setIntro(null), 4100);
    return () => { dead = true; clearTimeout(t1); clearTimeout(t2); };
  }, []);

  // 📝 Velký editor přání — ťuknutí do pole otevře okno přes displej,
  // kde je vidět celý text (dlouhé osnovy z 🪄 Rozvinout).
  // ✕ Zrušit vrátí text do podoby před otevřením editoru.
  const [topicEditorOpen, setTopicEditorOpen] = useState(false);
  const topicBeforeEditRef = useRef("");
  function openTopicEditor() {
    topicBeforeEditRef.current = topic;
    setTopicEditorOpen(true);
  }
  // 🌍 Stejný velký editor i pro POPIS VLASTNÍHO SVĚTA
  const [worldEditorOpen, setWorldEditorOpen] = useState(false);
  const worldDescBeforeEditRef = useRef("");
  function openWorldEditor() {
    worldDescBeforeEditRef.current = newThemeDesc;
    setWorldEditorOpen(true);
  }
  const anyBigEditorOpen = topicEditorOpen || worldEditorOpen;
  // Při otevřeném editoru zamknout rolování stránky pod ním — okno jinak
  // s klávesnicí „ujíždělo" do strany
  useEffect(() => {
    if (!anyBigEditorOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [anyBigEditorOpen]);

  // ── 🎲 Vymysli námět — Claude navrhne námět do textového pole ────────────
  const [ideaLoading, setIdeaLoading] = useState(false);
  // 🪄 Rozvinout — z kostry uživatele udělá detailní osnovu (postavy, místa,
  // data, kostýmy); výsledek jde do pole přání a dá se před generováním upravit
  const [expandLoading, setExpandLoading] = useState(false);
  async function expandIdea() {
    if (!topic.trim() || expandLoading) return;
    setExpandLoading(true);
    try {
      const names = [
        ...chars.filter(c => selectedIds.includes(c.id)).map(c => (uiLang === "en" && c.nameEn ? c.nameEn : c.name)),
        ...customChars.filter(c => selectedCustomIds.includes(c.id)).map(c => c.name),
      ];
      const activeCustom = customThemes.find(ct => ct.id === selectedTheme);
      const folk = folkTaleById(selectedTheme);
      const override = activeCustom
        ? { name: activeCustom.name, prompt: activeCustom.prompt }
        : folk ? { name: folk.name, prompt: folk.prompt } : undefined;
      const res = await fetch("/api/topic-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(110_000),
        body: JSON.stringify({
          expand: true,
          language: uiLang,
          characterNames: names,
          themeId: override ? undefined : selectedTheme || undefined,
          customTheme: override,
          hint: topic.trim(),
          // Osnova vychází i z vloženého PDF (když je zapnuté přepínačem)
          inspirationPdfBase64: inspPdfUse ? inspPdf?.base64 || undefined : undefined,
          inspirationPdfUrl: inspPdfUse ? inspPdf?.url || undefined : undefined,
        }),
      });
      const d = await safeJson<{ idea?: string }>(res);
      if (res.ok && d.idea) setTopic(d.idea);
    } catch {} finally {
      setExpandLoading(false);
    }
  }
  async function suggestIdea(locationHint?: string) {
    setIdeaLoading(true);
    try {
      const names = [
        ...chars.filter(c => selectedIds.includes(c.id)).map(c => (uiLang === "en" && c.nameEn ? c.nameEn : c.name)),
        ...customChars.filter(c => selectedCustomIds.includes(c.id)).map(c => c.name),
      ];
      // Námět respektuje vybraný svět pohádky (i klasickou pohádku) a text v poli
      const activeCustom = customThemes.find(ct => ct.id === selectedTheme);
      const folk = folkTaleById(selectedTheme);
      const override = activeCustom
        ? { name: activeCustom.name, prompt: activeCustom.prompt }
        : folk ? { name: folk.name, prompt: folk.prompt } : undefined;
      const res = await fetch("/api/topic-idea", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          language: uiLang,
          characterNames: names,
          themeId: override ? undefined : selectedTheme || undefined,
          customTheme: override,
          locationHint: locationHint || undefined,
          hint: [
            topic.trim(),
            sequelOf
              ? (uiLang === "en" ? `Sequel to the tale “${sequelOf.title}”` : `Pokračování pohádky „${sequelOf.title}“`)
              : "",
          ].filter(Boolean).join(" — ") || undefined,
        }),
      });
      const d = await safeJson<{ idea?: string }>(res);
      if (res.ok && d.idea) setTopic(d.idea);
    } catch {} finally {
      setIdeaLoading(false);
    }
  }

  // 📍 Námět podle místa: poloha → jméno místa (reverse geocode bez klíče,
  // s fallbackem na souřadnice — Claude místo pozná) → návrh pohádky z okolí.
  // Poloha se nikam neukládá, použije se jen pro tento jeden návrh.
  const [gpsLoading, setGpsLoading] = useState(false);
  async function suggestFromLocation() {
    if (gpsLoading || ideaLoading) return;
    if (!navigator.geolocation) { await appAlert(t.gpsErr); return; }
    // Systémové povolovací okno nejde stylovat — před PRVNÍM dotazem se proto
    // ukáže vlastní okno v designu appky, které vysvětlí, co bude následovat
    try {
      const perm = await navigator.permissions?.query?.({ name: "geolocation" as PermissionName });
      if (!perm || perm.state === "prompt") {
        if (!(await appConfirm(t.gpsAsk))) return;
      }
      if (perm?.state === "denied") { await appAlert(t.gpsErr); return; }
    } catch {}
    setGpsLoading(true);
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 12_000, maximumAge: 600_000 })
      );
      const { latitude, longitude } = pos.coords;
      let place = "";
      try {
        const r = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude}&longitude=${longitude}&localityLanguage=${uiLang}`,
          { signal: AbortSignal.timeout(8_000) }
        );
        const g = (await r.json()) as { locality?: string; city?: string; principalSubdivision?: string; countryName?: string };
        place = [g.locality || g.city, g.principalSubdivision, g.countryName].filter(Boolean).join(", ");
      } catch {}
      await suggestIdea(place || `GPS ${latitude.toFixed(3)}, ${longitude.toFixed(3)}`);
    } catch {
      await appAlert(t.gpsErr);
    } finally {
      setGpsLoading(false);
    }
  }

  // ── Delete a story from history (localStorage + IndexedDB + memory) ──────
  // Stylové mazání bez systémového dialogu: ťuknutí na 🗑️ nebo swipe doleva
  // „odjistí" položku (odsune se a ukáže červené Smazat), druhé ťuknutí maže.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  // Ref drží stav synchronně: syntetizovaný click po touchend přijde DŘÍV,
  // než React stihne překreslit — stavová proměnná by byla stará (a klik by
  // omylem spustil přehrávání pohádky)
  const confirmDeleteIdRef = useRef<string | null>(null);
  const delArmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeXRef = useRef<number | null>(null);
  const swipeHandledRef = useRef(false); // právě proběhl swipe → ignorovat syntetizovaný click
  function armDelete(id: string | null) {
    confirmDeleteIdRef.current = id;
    setConfirmDeleteId(id);
    if (delArmTimerRef.current) clearTimeout(delArmTimerRef.current);
    if (id) delArmTimerRef.current = setTimeout(() => { confirmDeleteIdRef.current = null; setConfirmDeleteId(null); }, 5000);
  }
  function deleteStory(e: React.MouseEvent, entry: HistoryEntry) {
    e.stopPropagation();
    try {
      const next = loadHistory().filter(x => x.id !== entry.id);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      setStoryHistory(next);
      renderedMapRef.current.delete(entry.id);
      evictOldStories(next.map(x => x.id)).catch(() => {});
      // Smazaná pohádka nesmí zůstat načtená ve čtečce/na ploše — dřív kniha
      // zmizela z historie, ale dole na stránce visela dál
      if (readerEntryIdRef.current === entry.id) {
        audioRef.current?.pause();
        setIsPlaying(false);
        readerEntryIdRef.current = null;
        setScenes([]);
        setTitle("");
        setStoryChoice(null);
        setBranch(null);
        setPage(0);
        setViewMode("form");
      }
    } catch {}
    armDelete(null);
  }

  // ── 📖 Pokračování uložené pohádky ────────────────────────────────────────
  // Předá minulý děj (text scén) vypravěči a obnoví obsazení + svět z původní
  // pohádky; uživatel může před generováním cokoli změnit
  function startSequel(e: React.MouseEvent, entry: HistoryEntry) {
    e.stopPropagation();
    if (swipeHandledRef.current || confirmDeleteIdRef.current) return;
    const text = entry.scenes.map(s => s.narration).join(" ").slice(0, 3500);
    setSequelOf({ id: entry.id, title: entry.title, text });
    if (entry.selectedIds?.length) setSelectedIds(entry.selectedIds);
    if (entry.themeId) setSelectedTheme(entry.themeId);
    setHistoryOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ── 📤 Poslat pohádku ─────────────────────────────────────────────────────
  // Nahraje obrázky+audio z telefonu do Blob úložiště (po scénách) a pošle
  // odkaz na přehrávací stránku /s/<id> — příjemce nic neinstaluje.
  // Nahrávání ukazuje průběh; hotový odkaz se nabídne ve vlastním okně —
  // sdílecí nabídka prohlížeče vyžaduje ČERSTVÉ ťuknutí (po minutě nahrávání
  // by ji prohlížeč zablokoval)
  const [shareBusyId, setShareBusyId] = useState<string | null>(null);
  const [shareProg, setShareProg] = useState<{ done: number; total: number } | null>(null);
  const [shareResult, setShareResult] = useState<{ url: string; title: string; copied: boolean } | null>(null);
  // Už nahrané soubory se pamatují — po chybě naváže další pokus tam, kde
  // skončil (nezačíná od nuly), a opakované poslání stejné pohádky je hned
  const shareCacheRef = useRef<Map<string, { shareId: string; urls: Map<string, string> }>>(new Map());

  function dataUrlParts(u: string): { mime: string; data: string } | null {
    const m = u.match(/^data:([^;,]+);base64,(.+)$/);
    return m ? { mime: m[1], data: m[2] } : null;
  }

  // Starší uložené pohádky mají obrázky jako velká PNG (~1,5 MB/scéna) —
  // před posláním je telefon zmenší na WebP/JPEG (~5× menší, stejná knížka)
  async function compressForShare(dataUrl: string): Promise<string> {
    if (!dataUrl.startsWith("data:image/")) return dataUrl;
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = dataUrl;
      });
      const scale = Math.min(1, 1600 / (img.naturalWidth || 1600));
      const c = document.createElement("canvas");
      c.width = Math.round((img.naturalWidth || 1600) * scale);
      c.height = Math.round((img.naturalHeight || 900) * scale);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      let out = c.toDataURL("image/webp", 0.8);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", 0.82);
      return out.length < dataUrl.length ? out : dataUrl;
    } catch {
      return dataUrl;
    }
  }

  // Přímé nahrání do Blob úložiště (binárně, bez 4,5MB limitu serverových
  // requestů — velké obrázky scén přes JSON neprošly). 2 pokusy na soubor.
  async function uploadShareAsset(shareId: string, kind: "img" | "aud", index: number, dataUrl: string): Promise<string> {
    const p = dataUrlParts(dataUrl);
    if (!p) return "";
    const bin = atob(p.data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes], { type: p.mime });
    let lastErr: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await uploadToBlob(`share/${shareId}/${kind}-${index}`, blob, {
          access: "public",
          handleUploadUrl: "/api/share-upload",
          contentType: p.mime,
        });
        return res.url;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error("upload failed");
  }

  async function shareStory(e: React.MouseEvent, entry: HistoryEntry) {
    e.stopPropagation();
    if (shareBusyId || swipeHandledRef.current || confirmDeleteIdRef.current) return;
    setShareBusyId(entry.id);
    try {
      // Média pohádky: paměť → IndexedDB cache
      let media: Array<{ imageUrl?: string; audioUrl?: string }> | undefined =
        renderedMapRef.current.get(entry.id);
      if (!media) {
        const cached = await getCachedStory(entry.id);
        if (cached) media = cached;
      }
      if (!media || !media.some(m => m.imageUrl && !isPlaceholderImg(m.imageUrl))) {
        await appConfirm(t.shareNoMedia);
        return;
      }
      let cache = shareCacheRef.current.get(entry.id);
      if (!cache) {
        cache = { shareId: crypto.randomUUID(), urls: new Map() };
        shareCacheRef.current.set(entry.id, cache);
      }
      const shareCache = cache;
      const shareId = shareCache.shareId;
      const total = entry.scenes.length;
      let done = 0;
      setShareProg({ done, total });
      const mediaArr = media;
      // Doplnit chybějící obrázky (líná větev B) a namluvení (líný hlas) —
      // sdílená pohádka je kompletní včetně obou konců
      await fillMissingImages(entry, mediaArr, (d, tot) => setShareProg({ done: d, total: tot }));
      await fillMissingAudio(entry, mediaArr, (d, tot) => setShareProg({ done: d, total: tot }));
      setShareProg({ done: 0, total });
      // Nahrát s pamětí: co už jednou prošlo, se znovu nenahrává
      async function uploadCached(kind: "img" | "aud", i: number, dataUrl: string): Promise<string> {
        const key = `${kind}-${i}`;
        const known = shareCache.urls.get(key);
        if (known) return known;
        if (kind === "img") dataUrl = await compressForShare(dataUrl);
        const url = await uploadShareAsset(shareId, kind, i, dataUrl);
        if (url) shareCache.urls.set(key, url);
        return url;
      }
      // Jedna scéna = obrázek (povinný) + audio (bonus, chyba ho jen vynechá)
      async function uploadScene(i: number): Promise<{ narration: string; imageUrl: string; audioUrl: string }> {
        const m = mediaArr[i] || {};
        let imageUrl = m.imageUrl || "";
        let audioUrl = m.audioUrl || "";
        if (imageUrl.startsWith("data:")) imageUrl = await uploadCached("img", i, imageUrl);
        else if (!/^https:/.test(imageUrl)) imageUrl = "";
        try {
          if (audioUrl.startsWith("data:")) audioUrl = await uploadCached("aud", i, audioUrl);
          else if (!/^https:/.test(audioUrl)) audioUrl = "";
        } catch { audioUrl = ""; }
        done += 1;
        setShareProg({ done, total });
        return { narration: entry.scenes[i]?.narration || "", imageUrl, audioUrl };
      }
      // 3 scény najednou — výrazně rychlejší než jedna po druhé
      const scenes: Array<{ narration: string; imageUrl: string; audioUrl: string }> = new Array(total);
      for (let i = 0; i < total; i += 3) {
        const chunk = await Promise.all(
          Array.from({ length: Math.min(3, total - i) }, (_, j) => uploadScene(i + j))
        );
        chunk.forEach((s, j) => { scenes[i + j] = s; });
      }
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({ op: "publish", id: shareId, title: entry.title, scenes, choice: entry.choice }),
      });
      const d = await safeJson<{ ok?: boolean; error?: string }>(res);
      if (!res.ok || !d.ok) throw new Error(d.error || "publish failed");
      // Hotovo → okno s odkazem; sdílení/kopírování až na čerstvé ťuknutí
      setShareResult({ url: `${location.origin}/s/${shareId}`, title: entry.title, copied: false });
    } catch (err) {
      console.error("[share]", err);
      const detail = err instanceof Error && err.message ? ` (${err.message.slice(0, 140)})` : "";
      await appConfirm(t.shareErr + detail);
    } finally {
      setShareBusyId(null);
      setShareProg(null);
    }
  }

  async function shareResultNative() {
    if (!shareResult) return;
    try {
      await navigator.share({ title: shareResult.title, url: shareResult.url });
      setShareResult(null);
    } catch {} // zrušení nabídky není chyba — okno zůstane otevřené
  }

  async function shareResultCopy() {
    if (!shareResult) return;
    try {
      await navigator.clipboard.writeText(shareResult.url);
      setShareResult(p => (p ? { ...p, copied: true } : p));
    } catch {}
  }

  // ── 💾 Pohádka jako soubor (offline) ─────────────────────────────────────
  // Jeden samostatný HTML soubor s vloženými obrázky, textem i namluvením —
  // jde poslat Quick Share / Bluetooth BEZ internetu a přehraje se offline
  const [exportBusyId, setExportBusyId] = useState<string | null>(null);

  async function exportStory(e: React.MouseEvent, entry: HistoryEntry) {
    e.stopPropagation();
    if (exportBusyId || swipeHandledRef.current || confirmDeleteIdRef.current) return;
    setExportBusyId(entry.id);
    try {
      let media: Array<{ imageUrl?: string; audioUrl?: string }> | undefined =
        renderedMapRef.current.get(entry.id);
      if (!media) {
        const cached = await getCachedStory(entry.id);
        if (cached) media = cached;
      }
      if (!media || !media.some(m => m.imageUrl && !isPlaceholderImg(m.imageUrl))) {
        await appConfirm(t.shareNoMedia);
        return;
      }
      // Doplnit chybějící obrázky (líná větev B) a namluvení — soubor je kompletní
      await fillMissingImages(entry, media);
      await fillMissingAudio(entry, media);
      const scenes = await Promise.all(entry.scenes.map(async (s, i) => {
        const m = media![i] || {};
        let imageUrl = m.imageUrl || "";
        if (imageUrl.startsWith("data:image/")) imageUrl = await compressForShare(imageUrl);
        else if (!imageUrl.startsWith("data:")) imageUrl = "";
        const audioUrl = m.audioUrl?.startsWith("data:") ? m.audioUrl : "";
        return { narration: s.narration || "", imageUrl, audioUrl };
      }));
      const html = buildStoryHtml(entry.title, scenes, entry.choice);
      // Bez diakritiky — jméno s háčky prohlížeč zahodí a stáhne „download"
      const slug = entry.title.normalize("NFD").replace(/[̀-ͯ]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
      const fileName = `pohadka-${slug || "nicky"}.html`;
      const file = new File([html], fileName, { type: "text/html" });
      // Nejdřív rovnou do sdílecí nabídky (Quick Share, Bluetooth…) — soubor,
      // ne odkaz; když to prohlížeč neumí, soubor se stáhne do Stažených
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: entry.title });
          return;
        } catch (err) {
          if ((err as Error)?.name === "AbortError") return;
        }
      }
      const url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      await appConfirm(t.exportDone);
    } catch (err) {
      console.error("[export]", err);
      const detail = err instanceof Error && err.message ? ` (${err.message.slice(0, 140)})` : "";
      await appConfirm(t.shareErr + detail);
    } finally {
      setExportBusyId(null);
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
      readerEntryIdRef.current = entry.id;
      readerHeroRef.current = entry.heroDescription || "";
      readerCharIdsRef.current = entry.selectedIds || selectedIds;
      setStoryChoice(entry.choice ?? null);
      setBranch(null);
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
      // Líná větev B se nepočítá — její obrázky vznikají až při výběru konce
      const needImages = entry.choice ? entry.choice.altFrom : restored.length;
      if (restored.slice(0, needImages).every(s => !isPlaceholderImg(s.imageUrl))) {
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
    setStoryChoice(entry.choice ?? null);
    setBranch(null);
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
  const MAX_CHAR_PHOTOS = 5;
  async function handleCharPhoto(file: File) {
    const r = await resizeAndEncode(file, 800).catch(() => null);
    if (r) setNewCharPhotos(p => (p.length >= MAX_CHAR_PHOTOS ? p : [...p, r]));
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
        photoBase64: newCharPhotos[0]?.data, photoMimeType: newCharPhotos[0]?.mimeType, previewUrl: newCharPhotos[0]?.previewUrl,
        photos: newCharPhotos.map(ph => ({ data: ph.data, mimeType: ph.mimeType })),
      }];
      saveCustomChars(next);
      return next;
    });
    setSelectedCustomIds(p => [...p, id]);
    setAddingChar(false); setNewCharName(""); setNewCharDesc(""); setNewCharPhotos([]);
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
    if (inspImages.length >= 8) return; // inspirace: až 8 fotek (sjednoceno s vlastním světem)
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
  function addCustomTheme() {
    if (!newThemeName.trim() && !newThemeDesc.trim()) return;
    const id = `ctheme_${Date.now()}`;
    const name = newThemeName.trim() || (uiLang === "en" ? "My world" : "Můj svět");
    setCustomThemes(p => {
      const next = [...p, {
        id, name,
        prompt: newThemeDesc.trim() || name,
        photos: newThemePhotos.map(ph => ({ data: ph.data, mimeType: ph.mimeType })),
        previewUrl: newThemePhotos[0]?.previewUrl,
      }];
      saveCustomThemes(next);
      return next;
    });
    setSelectedTheme(id);
    setAddingTheme(false); setNewThemeName(""); setNewThemeDesc(""); setNewThemePhotos([]);
    setWorldQuestion(null); setWorldStudyError(false);
  }
  function removeCustomTheme(id: string) {
    setCustomThemes(p => { const next = p.filter(c => c.id !== id); saveCustomThemes(next); return next; });
    setSelectedTheme(p => (p === id ? "" : p));
  }
  async function handleInspPdf(file: File) {
    if (file.size > 10 * 1024 * 1024) { await appAlert(t.pdfTooBig); return; }
    if (file.size <= 3.5 * 1024 * 1024) {
      const b = await fileToBase64(file).catch(() => null);
      if (b) { setInspPdf({ base64: b, name: file.name }); setInspPdfUse(true); }
      return;
    }
    // Větší PDF se nevejde do requestu na server (limit 4,5 MB) —
    // nahraje se rovnou do úložiště a serveru se pošle jen odkaz
    setPdfUploading(true);
    try {
      const res = await uploadToBlob(`insp/${crypto.randomUUID()}.pdf`, file, {
        access: "public",
        handleUploadUrl: "/api/share-upload",
        contentType: "application/pdf",
      });
      setInspPdf({ url: res.url, name: file.name });
      setInspPdfUse(true);
    } catch (e) {
      console.error("[pdf upload]", e);
      await appAlert(t.pdfUploadErr);
    } finally {
      setPdfUploading(false);
    }
  }

  const allSelectedCount = selectedIds.length + selectedCustomIds.length;
  const hasInspiration = !!selectedTheme || !!topic.trim() || inspImages.length > 0 || (!!inspPdf && inspPdfUse) || (inspUrlActive && !!inspUrl.trim()) || !!sequelOf;
  const current = scenes[page];
  const hasNext = nextVisible !== null;
  const hasPrev = prevVisible !== null;
  const totalScenes = scenes.length;

  return (
    <div className={readerMode ? "container reader-mode" : "container"}>

      {!readerMode && (
      <>
      <div className="lang-switch">
        <button type="button" className={`lang-btn bg-cycle-btn${bgPickerOpen ? " lang-on" : ""}`}
          onClick={() => setBgPickerOpen(p => !p)} title={t.bgTitle}>{bgLabel} ▾</button>
        <button type="button" className={`lang-toggle ${uiLang === "en" ? "lang-en" : ""}`}
          onClick={() => switchLang(uiLang === "cs" ? "en" : "cs")} aria-label="Jazyk / Language">
          <span className="lang-thumb" aria-hidden="true" />
          {/* vlajky jako SVG — emoji vlajky Windows neumí (rozpadly se na „cz CZ") */}
          <span className={`lang-opt ${uiLang === "cs" ? "on" : ""}`}>
            <svg className="lang-flag" viewBox="0 0 18 12" aria-hidden="true">
              <rect width="18" height="6" fill="#fff" /><rect y="6" width="18" height="6" fill="#d7141a" />
              <path d="M0 0 L9 6 L0 12 Z" fill="#11457e" />
            </svg>
            CZ
          </span>
          <span className={`lang-opt ${uiLang === "en" ? "on" : ""}`}>
            <svg className="lang-flag" viewBox="0 0 18 12" aria-hidden="true">
              <rect width="18" height="12" fill="#012169" />
              <path d="M0 0 L18 12 M18 0 L0 12" stroke="#fff" strokeWidth="2.4" />
              <path d="M0 0 L18 12 M18 0 L0 12" stroke="#c8102e" strokeWidth="1.2" />
              <path d="M9 0 V12 M0 6 H18" stroke="#fff" strokeWidth="4" />
              <path d="M9 0 V12 M0 6 H18" stroke="#c8102e" strokeWidth="2.2" />
            </svg>
            EN
          </span>
        </button>
      </div>
      {bgPickerOpen && (
        <div className="bg-picker-panel">
          <div className="panel-title-row">
            <p className="panel-title">🖼️ {t.bgTitle}</p>
            <button type="button" className="panel-close" aria-label={t.cancel}
              onClick={() => setBgPickerOpen(false)}>✕</button>
          </div>
          <div className="folk-list bg-picker">
            {[{ id: "auto", emoji: "🎨", label: `${t.bgAuto} — ${t.bgAutoHint}`, preview: activeBg },
              ...BG_SCENES.map(s => ({ id: s.id, emoji: s.emoji, label: uiLang === "en" ? s.nameEn : s.name, preview: s.id }))].map(row => (
              <button type="button" key={row.id}
                className={`folk-item bg-item ${bgChoice === row.id ? "folk-on" : ""}`}
                onClick={() => {
                  if (holdFiredRef.current) { holdFiredRef.current = false; return; }
                  pickBg(row.id);
                }}
                onPointerDown={() => beginBgHold(row.preview)}
                onPointerUp={endBgHold}
                onPointerLeave={endBgHold}
                onPointerCancel={endBgHold}
                onContextMenu={e => e.preventDefault()}>
                <span className="folk-emoji">{row.emoji}</span>
                <span className="folk-name">{row.label}</span>
              </button>
            ))}
          </div>
          <p className="gen-step-hint">{t.bgHoldHint}</p>
          <button type="button" className="panel-ok" onClick={() => setBgPickerOpen(false)}>✓ {t.okBtn}</button>
        </div>
      )}

      {/* 🔍 Náhled pozadí při podržení: malá karta → plynule celý displej */}
      {bgHold && (
        <div className={`bg-hold-overlay${bgHold.full ? " bg-hold-full" : ""}`}>
          {bgHold.url
            ? <img src={bgHold.url} alt="" className="bg-hold-img" />
            : <div className="bg-hold-img bg-hold-loading">🎨</div>}
        </div>
      )}
      <h1>📖 {uiLang === "cs" ? "Nickyho pohádky" : "Nicky's Fairy Tales"} <span className="version-badge">v{APP_VERSION}</span></h1>
      <p className="subtitle">{t.subtitle}</p>

      {/* ── Vrátit se na starší pohádku ── */}

      {/* ── FORM ── */}
      <form className="form" ref={formRef} onSubmit={createStory}>

        {(chars.length > 0 || customChars.length > 0) && (
          <div className="field">
            <label>{t.whoLabel}</label>
            {/* 🎡 Postavy jako roller se zaškrtávátky — vícero postav najednou;
                + Vlastní postava zůstává jako tlačítko pod ním */}
            <button type="button" className={`chip chip-btn chip-full ${charOpen || selectedIds.length + selectedCustomIds.length > 0 ? "chip-on" : ""}`}
              onClick={() => setCharOpen(p => !p)}>
              {(() => {
                const names = [
                  ...chars.filter(c => selectedIds.includes(c.id)).map(c => (uiLang === "en" && c.nameEn ? c.nameEn : c.name)),
                  ...customChars.filter(c => selectedCustomIds.includes(c.id)).map(c => c.name),
                ];
                if (names.length === 0) return `🧒 ${t.charPick}`;
                return names.length > 3
                  ? `🧒 ${names.slice(0, 2).join(", ")} +${names.length - 2}`
                  : `🧒 ${names.join(", ")}`;
              })()}
            </button>
            {charOpen && (
              <div className="add-char-panel">
                <div className="panel-title-row">
                  <p className="panel-title">🧒 {t.charPick}</p>
                  <button type="button" className="panel-close" aria-label={t.cancel}
                    onClick={() => setCharOpen(false)}>✕</button>
                </div>
                <div className="folk-list world-roller">
                  {chars.map(c => (
                    <button type="button" key={c.id}
                      className={`folk-item ${selectedIds.includes(c.id) ? "folk-on" : ""}`}
                      onClick={() => toggleChar(c.id)}>
                      <span className={`char-check ${selectedIds.includes(c.id) ? "on" : ""}`} aria-hidden="true">✓</span>
                      {c.photo && <img src={c.photo} alt={c.name} className="chip-avatar" loading="lazy" />}
                      <span>{uiLang === "en" && c.nameEn ? c.nameEn : c.name}</span>
                    </button>
                  ))}
                  {customChars.map(c => (
                    <div key={c.id} role="button" tabIndex={0}
                      className={`folk-item ${selectedCustomIds.includes(c.id) ? "folk-on" : ""}`}
                      onClick={() => toggleCustomChar(c.id)}
                      onKeyDown={e => { if (e.key === "Enter" || e.key === " ") toggleCustomChar(c.id); }}>
                      <span className={`char-check ${selectedCustomIds.includes(c.id) ? "on" : ""}`} aria-hidden="true">✓</span>
                      {c.previewUrl && <img src={c.previewUrl} alt={c.name} className="chip-avatar" />}
                      <span>{c.name}</span>
                      <button type="button" className="chip-remove folk-remove" aria-label="Odebrat"
                        onClick={e => { e.stopPropagation(); removeCustomChar(c.id); }}>×</button>
                    </div>
                  ))}
                </div>
                <button type="button" className="panel-ok" onClick={() => setCharOpen(false)}>✓ {t.okBtn}</button>
              </div>
            )}
            <div className="chips">
              <button type="button" className={`chip chip-btn ${addingChar ? "chip-on" : ""}`} onClick={() => setAddingChar(p => !p)}>
                {t.addCharChip}
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
                <button type="button" className="outline-btn" onClick={() => charPhotoRef.current?.click()}
                  disabled={newCharPhotos.length >= MAX_CHAR_PHOTOS}>
                  📷 {t.uploadPhoto} ({newCharPhotos.length}/{MAX_CHAR_PHOTOS})
                </button>
              </div>
              {newCharPhotos.length > 0 && (
                <div className="world-photo-grid">
                  {newCharPhotos.map((ph, i) => (
                    <div key={i} className="world-photo-thumb">
                      <img src={ph.previewUrl} alt={`fotka ${i + 1}`} />
                      <button type="button" className="chip-remove world-photo-x" aria-label="Odebrat"
                        onClick={() => setNewCharPhotos(p => p.filter((_, j) => j !== i))}>×</button>
                    </div>
                  ))}
                </div>
              )}
              <input ref={charPhotoRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={async e => {
                  for (const f of Array.from(e.target.files || []).slice(0, MAX_CHAR_PHOTOS - newCharPhotos.length)) await handleCharPhoto(f);
                  e.target.value = "";
                }} />
            </div>
            <div className="file-row">
              <button type="button" onClick={addCustomChar} disabled={!newCharName.trim()}>{t.addCharBtn}</button>
              <button type="button" className="cancel-btn" onClick={() => { setAddingChar(false); setNewCharName(""); setNewCharDesc(""); setNewCharPhotos([]); }}>✕ {t.cancel}</button>
            </div>
          </div>
        )}

        {themes.length > 0 && (
          <div className="field">
            <label>{t.worldLabel}</label>
            {/* 🎡 Vestavěné světy jako roller v panelu s ✕ (uložené vlastní
                světy a + Vlastní svět zůstávají jako tlačítka pod ním) */}
            <button type="button" className={`chip chip-btn chip-full ${worldOpen || !!selectedTheme ? "chip-on" : ""}`}
              onClick={() => setWorldOpen(p => !p)}>
              {(() => {
                const sel = themes.find(th => th.id === selectedTheme);
                if (sel) return `${sel.emoji} ${uiLang === "en" && sel.nameEn ? sel.nameEn : sel.name}`;
                const folk = folkTaleById(selectedTheme);
                if (folk) return `${folk.emoji} ${uiLang === "en" ? folk.nameEn : folk.name}`;
                const ct = customThemes.find(c => c.id === selectedTheme);
                if (ct) return `🌍 ${ct.name}`;
                return `🌍 ${t.worldPick}`;
              })()}
            </button>
            {worldOpen && (
              <div className="add-char-panel">
                <div className="panel-title-row">
                  <p className="panel-title">🌍 {t.worldPick}</p>
                  <button type="button" className="panel-close" aria-label={t.cancel}
                    onClick={() => setWorldOpen(false)}>✕</button>
                </div>
                {/* Jeden válec se VŠÍM: světy → české a klasické → Andersen
                    (pohádky abecedně v rámci skupiny) */}
                <div className="folk-list world-roller">
                  <button type="button" className={`folk-item ${!selectedTheme ? "folk-on" : ""}`}
                    onClick={() => { setSelectedTheme(""); setWorldOpen(false); }}>
                    <span className="folk-emoji">✨</span>
                    <span>{t.worldNone}</span>
                  </button>
                  <p className="folk-group">🌍 {uiLang === "en" ? "Worlds" : "Světy"}</p>
                  {themes.map(th => (
                    <button type="button" key={th.id} className={`folk-item ${selectedTheme === th.id ? "folk-on" : ""}`}
                      onClick={() => { setSelectedTheme(p => p === th.id ? "" : th.id); setWorldOpen(false); }}>
                      <span className="folk-emoji">{th.emoji}</span>
                      <span>{uiLang === "en" && th.nameEn ? th.nameEn : th.name}</span>
                    </button>
                  ))}
                  <p className="folk-group">📜 {uiLang === "en" ? "Czech & classic tales" : "České a klasické pohádky"}</p>
                  {FOLK_TALES.filter(ft => ft.group !== "dk")
                    .slice().sort((a, b) => (uiLang === "en" ? a.nameEn.localeCompare(b.nameEn, "en") : a.name.localeCompare(b.name, "cs")))
                    .map(ft => (
                    <button type="button" key={ft.id}
                      className={`folk-item ${selectedTheme === ft.id ? "folk-on" : ""}`}
                      onClick={() => { setSelectedTheme(p => p === ft.id ? "" : ft.id); setWorldOpen(false); }}>
                      <span className="folk-emoji">{ft.emoji}</span>
                      <span>{uiLang === "en" ? ft.nameEn : ft.name}</span>
                    </button>
                  ))}
                  <p className="folk-group">🇩🇰 {uiLang === "en" ? "Andersen — Danish tales" : "Andersen — dánské pohádky"}</p>
                  {FOLK_TALES.filter(ft => ft.group === "dk")
                    .slice().sort((a, b) => (uiLang === "en" ? a.nameEn.localeCompare(b.nameEn, "en") : a.name.localeCompare(b.name, "cs")))
                    .map(ft => (
                    <button type="button" key={ft.id}
                      className={`folk-item ${selectedTheme === ft.id ? "folk-on" : ""}`}
                      onClick={() => { setSelectedTheme(p => p === ft.id ? "" : ft.id); setWorldOpen(false); }}>
                      <span className="folk-emoji">{ft.emoji}</span>
                      <span>{uiLang === "en" ? ft.nameEn : ft.name}</span>
                    </button>
                  ))}
                </div>
                <p className="gen-step-hint">{t.folkHint}</p>
                {/* ✓ potvrzení — křížek nahoře jen zavírá, tohle je jasné „hotovo" */}
                <button type="button" className="panel-ok" onClick={() => setWorldOpen(false)}>✓ {t.okBtn}</button>
              </div>
            )}
            <div className="chips">
              {customThemes.map(ct => (
                <div key={ct.id} className={`chip custom-chip ${selectedTheme === ct.id ? "chip-on" : ""}`}>
                  {ct.previewUrl && <img src={ct.previewUrl} alt={ct.name} className="chip-avatar" />}
                  <span className="chip-label" onClick={() => setSelectedTheme(p => p === ct.id ? "" : ct.id)}>🌍 {ct.name}</span>
                  <button type="button" className="chip-remove" onClick={() => removeCustomTheme(ct.id)}>×</button>
                </div>
              ))}
              <button type="button" className={`chip chip-btn ${addingTheme ? "chip-on" : ""}`} onClick={() => setAddingTheme(p => !p)}>
                {t.addWorldChip}
              </button>
            </div>
            {/* 📍 Pohádka podle mé lokality — návrh námětu z okolí */}
            <button type="button" className={`chip chip-btn chip-full ${gpsLoading ? "chip-on" : ""}`}
              onClick={suggestFromLocation} disabled={gpsLoading || ideaLoading} title={t.gpsHint}>
              {gpsLoading ? "⏳ " : "📍 "}{t.gpsBtn}
            </button>
            {addingTheme && (
              <div className="add-char-panel">
                <p className="panel-title">{t.newWorldTitle}</p>
                <div className="field">
                  <label>{t.worldNameLabel}</label>
                  <input type="text" value={newThemeName} onChange={e => setNewThemeName(e.target.value)} placeholder={t.worldNamePlaceholder} autoFocus />
                </div>
                <div className="field">
                  <label>{t.worldDescLabel}</label>
                  {/* Ťuknutí otevře velký editor přes celý displej — stejně jako u zadání pohádky */}
                  {/* ✕ pro smazání textu je NAD polem vpravo — nepřekrývá text */}
                  {newThemeDesc.trim() !== "" && (
                    <div className="ta-toolbar">
                      <button type="button" className="ta-clear" aria-label={t.clearTextBtn}
                        onClick={e => { e.stopPropagation(); setNewThemeDesc(""); }}>✕</button>
                    </div>
                  )}
                  <div className="ta-wrap">
                    <textarea className="ta-accent" value={newThemeDesc} readOnly placeholder={t.worldDescPlaceholder}
                      onClick={openWorldEditor}
                      onFocus={e => { e.target.blur(); openWorldEditor(); }} />
                  </div>
                  <div className="insp-row">
                    <button type="button" className="insp-btn" onClick={studyNewWorld}
                      disabled={worldStudyLoading || (!newThemeName.trim() && !newThemeDesc.trim())}>
                      {worldStudyLoading ? "⏳ " : "🧠 "}{t.studyWorldBtn}
                    </button>
                  </div>
                  {worldQuestion && <p className="gen-step-hint world-question">❓ {worldQuestion} — {t.worldQuestionHint}</p>}
                  {worldStudyError && <p className="gen-step-hint">{t.worldStudyError}</p>}
                </div>
                <div className="panel-actions">
                  <button type="button" onClick={addCustomTheme} disabled={!newThemeName.trim() && !newThemeDesc.trim()}>{t.saveWorld}</button>
                  <button type="button" className="cancel-btn" onClick={() => { setAddingTheme(false); setNewThemeName(""); setNewThemeDesc(""); setNewThemePhotos([]); setWorldQuestion(null); setWorldStudyError(false); }}>✕ {t.cancel}</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* 🎙️ Hlas vypravěče — automatika / knihovna hlasů / klon rodiče */}
        <div className="field">
          <label>{t.voiceLabel}</label>
          <button type="button" className={`chip chip-btn chip-full ${voiceOpen || voicePref !== "auto" ? "chip-on" : ""}`}
            onClick={() => setVoiceOpen(p => !p)}>
            🎙️ {voicePref === "auto"
              ? t.voiceAuto
              : (v => (uiLang === "en" && v?.nameEn ? v.nameEn : v?.name))(voices.find(v => v.id === voicePref)) || t.voiceAuto}
          </button>
          {voiceOpen && (
            <div className="add-char-panel">
              <div className="panel-title-row">
                <p className="panel-title">🎙️ {t.voiceLabel}</p>
                <button type="button" className="panel-close" aria-label={t.cancel}
                  onClick={() => { stopPreview(); setVoiceOpen(false); }}>✕</button>
              </div>
              <div className="folk-list">
                <button type="button" className={`folk-item ${voicePref === "auto" ? "folk-on" : ""}`}
                  onClick={() => { pickVoice("auto"); setVoiceOpen(false); }}>
                  <span className="folk-emoji">✨</span>
                  <span>{t.voiceAuto}</span>
                </button>
                {/* Ťuknutí hlas vybere a pustí/zastaví ukázku (⏳ nahrávám,
                    ⏹ hraje) — panel zůstává otevřený kvůli porovnávání.
                    Hlasy jsou seskupené podle jazyka (jazyk hlasu = jazyk
                    pohádky v automatice); klony a vymyšlené jsou na konci */}
                {(["cs", "en", "hr", "da", "sk", "any"] as const).flatMap(gl => {
                  const group = voices.filter(v => (v.kind ? gl === "any" : (v.language === gl || (gl === "any" && !isStoryLang(v.language)))));
                  if (group.length === 0) return [];
                  const meta = STORY_LANGS.find(x => x.code === gl);
                  const head = meta
                    ? `${meta.flag} ${uiLang === "en" ? meta.en : meta.cs}`
                    : `🌍 ${uiLang === "en" ? "Multilingual & custom" : "Vícejazyčné a vlastní"}`;
                  return [<p key={`vg-${gl}`} className="folk-group">{head}</p>, ...group.map(v => {
                  const pk = `voice:${v.id}`;
                  const playIcon = preview?.key === pk ? (preview.phase === "loading" ? "⏳" : "⏹") : "▶";
                  // název hlasu podle jazyka prostředí (klony/vymyšlené mají jen name)
                  const vName = uiLang === "en" && v.nameEn ? v.nameEn : v.name;
                  return v.kind ? (
                  <div key={v.id} role="button" tabIndex={0}
                    className={`folk-item ${voicePref === v.id ? "folk-on" : ""}`}
                    onClick={() => { pickVoice(v.id); testVoice(v.id); }}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { pickVoice(v.id); testVoice(v.id); } }}>
                    <span className="folk-emoji">{v.emoji}</span>
                    <span>{vName}</span>
                    <span className="voice-play" aria-hidden>{playIcon}</span>
                    <button type="button" className="chip-remove folk-remove" aria-label={t.cloneDelete}
                      onClick={e => { e.stopPropagation(); if (v.kind === "clone") deleteClone(v.id); else deleteDesigned(v.id); }}>×</button>
                  </div>
                ) : (
                  <button type="button" key={v.id} className={`folk-item ${voicePref === v.id ? "folk-on" : ""}`}
                    onClick={() => { pickVoice(v.id); testVoice(v.id); }}>
                    <span className="folk-emoji">{v.emoji}</span>
                    <span>{vName}</span>
                    <span className="voice-play" aria-hidden>{playIcon}</span>
                  </button>
                );})];
                })}
              </div>
              {/* hlas = i jazyk pohádky (sloučený výběr) */}
              <p className="gen-step-hint">{t.langHint}</p>
              {recState === "idle" ? (
                /* 🎙️ Nahrávání klonu je DOČASNĚ schované (na přání) — celý
                   flow zůstává v kódu, stačí tlačítko zase vrátit */
                null
              ) : (
                <div className="field">
                  <input type="text" value={cloneName} onChange={e => setCloneName(e.target.value)}
                    placeholder={t.cloneNamePh} maxLength={40} />
                  <p className="gen-step-hint">{t.cloneScriptHint}</p>
                  <p className="clone-script">{t.cloneScript}</p>
                  {recState === "ready" && (
                    <button type="button" onClick={startRec}>⏺ {t.cloneRec}</button>
                  )}
                  {recState === "rec" && (
                    <button type="button" className="cancel-btn" onClick={stopRec}>⏹ {t.cloneStop} ({recSecs}s)</button>
                  )}
                  {recState === "done" && (
                    <>
                      {recUrl && <audio controls src={recUrl} style={{ width: "100%", marginTop: "0.5rem" }} />}
                      <div className="file-row">
                        <button type="button" onClick={createClone}>✨ {t.cloneCreate}</button>
                        <button type="button" className="outline-btn" onClick={() => { setRecUrl(null); setRecState("ready"); }}>↺ {t.cloneAgain}</button>
                        <button type="button" className="cancel-btn" onClick={() => { setRecUrl(null); setRecState("idle"); }}>✕ {t.cancel}</button>
                      </div>
                    </>
                  )}
                  {recState === "uploading" && <p className="gen-step-hint">⏳ {t.cloneCreating}</p>}
                </div>
              )}
              {/* 🪄 Voice Design je DOČASNĚ schovaný (na přání) — flow zůstává
                  v kódu (designGenerate/designSave), vrací se vložením JSX */}
              <button type="button" className="panel-ok" onClick={() => { stopPreview(); setVoiceOpen(false); }}>✓ {t.okBtn}</button>
            </div>
          )}
        </div>

        {/* 👶🧒👦 Pro jaký věk vyprávět — auto (podle postav) nebo ručně;
            řídí věkový profil: délku vět, slovník, napětí, hloubku emocí */}
        <div className="field">
          <label>{t.ageLabel}</label>
          <div className="chips">
            <button type="button" className={`chip chip-btn ${agePref === "auto" ? "chip-on" : ""}`}
              onClick={() => pickAge("auto")}>
              ✨ {t.ageAuto}
            </button>
            {AGE_BANDS.map(b => (
              <button type="button" key={b.id} className={`chip chip-btn ${agePref === b.id ? "chip-on" : ""}`}
                onClick={() => pickAge(agePref === b.id ? "auto" : b.id)}>
                {b.label}
              </button>
            ))}
          </div>
          {agePref !== "auto" && <p className="gen-step-hint">{t.ageHint}</p>}
        </div>

        <div className="field">
          <label>{t.wishLabel}</label>
          {sequelOf && (
            <>
              <div className="chips">
                <div className="chip custom-chip chip-on">
                  <span className="chip-label">📖 {t.sequelChip(sequelOf.title)}</span>
                  <button type="button" className="chip-remove" aria-label={t.cancel}
                    onClick={() => setSequelOf(null)}>×</button>
                </div>
              </div>
              <p className="gen-step-hint">{t.sequelHint}</p>
            </>
          )}
          {/* Ťuknutí otevře velký editor — celý text viditelný, pohodlné psaní.
              Oranžový ✕ NAD polem vpravo maže text (nepřekrývá ho) */}
          {topic.trim() !== "" && (
            <div className="ta-toolbar">
              <button type="button" className="ta-clear" aria-label={t.clearTextBtn}
                onClick={e => { e.stopPropagation(); setTopic(""); }}>✕</button>
            </div>
          )}
          <div className="ta-wrap">
            <textarea className="ta-accent" value={topic} readOnly placeholder={t.wishPlaceholder}
              onClick={openTopicEditor}
              onFocus={e => { e.target.blur(); openTopicEditor(); }} />
          </div>
          <div className="insp-row">
            <button type="button" className="insp-btn" onClick={() => suggestIdea()} disabled={ideaLoading}>
              {ideaLoading ? "⏳ " : "🎲 "}{t.ideaBtn}
            </button>
            {topic.trim() !== "" && (
              <button type="button" className="insp-btn" onClick={expandIdea} disabled={expandLoading || ideaLoading}>
                {expandLoading ? "⏳ " : "✨ "}{t.expandBtn}
              </button>
            )}
            <button type="button" className={`insp-btn ${inspImages.length > 0 ? "chip-on" : ""}`}
              onClick={() => inspImageRef.current?.click()} disabled={inspImages.length >= 8}>
              📷 {t.photoBtn}{inspImages.length > 0 ? ` (${inspImages.length})` : ""}
            </button>
            <button type="button" className={`insp-btn ${inspUrlActive ? "chip-on" : ""}`} onClick={() => setInspUrlActive(p => !p)}>🔗 {t.webBtn}</button>
            <button type="button" className={`insp-btn ${inspPdf ? "chip-on" : ""}`} onClick={() => inspPdfRef.current?.click()} disabled={pdfUploading}>
              📄 PDF{inspPdf && inspPdfUse ? " ✓" : pdfUploading ? " ⏳" : ""}
            </button>
          </div>
          <input ref={inspImageRef} type="file" accept="image/*" multiple style={{ display: "none" }}
            onChange={async e => { for (const f of Array.from(e.target.files || []).slice(0, 8 - inspImages.length)) await handleInspImage(f); e.target.value = ""; }} />
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
            <div className="pdf-card">
              <span className="pdf-ico">📄</span>
              <div className="pdf-info">
                <span className="pdf-name">{inspPdf.name}</span>
                <span className="pdf-sub">{inspPdfUse ? t.pdfUseOn : t.pdfUseOff}</span>
              </div>
              <button type="button" className={`switch pdf-switch ${inspPdfUse ? "switch-on" : ""}`}
                onClick={() => setInspPdfUse(p => !p)} aria-pressed={inspPdfUse} aria-label={t.pdfUseOn}>
                <span className="switch-track" aria-hidden="true" />
              </button>
              <button type="button" className="pdf-remove" aria-label={t.cancel}
                onClick={() => setInspPdf(null)}>✕</button>
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
          <label>{t.endingLabel}</label>
          {/* Klasický přepínač (jako starý vypínač zleva doprava) */}
          <button type="button" className={`switch ${twoEndings ? "switch-on" : ""}`}
            onClick={() => setTwoEndings(p => !p)} aria-pressed={twoEndings}>
            <span className="switch-label">🔀 {t.twoEndsOff}</span>
            <span className="switch-track" aria-hidden="true" />
          </button>
          {twoEndings && <p className="gen-step-hint">{t.twoEndsHint}</p>}
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
                          : j.stalled ? async () => {
                              const w = stallStateFor(j.jobId);
                              if (w.manualKicks === 0) {
                                if (await appConfirm(t.stuckKickAsk)) { w.manualKicks++; w.lastKick = Date.now(); kickContinue(j.jobId); }
                              } else if (await appConfirm(t.stuckRemoveAsk)) {
                                stopJobPolling(j.jobId);
                                removeServerJob(j.jobId);
                              } else { w.lastKick = Date.now(); kickContinue(j.jobId); }
                            }
                          : () => setFocusJobId(j.jobId)}
                        role="button"
                        title={j.title || undefined}
                      >
                        <span className="job-seg-fill" />
                        {/* ▶ Číst až když čtenář generování nedožene (tempo
                            čtení vs. tempo kreslení) a hlas 1. stránky je hotový */}
                        {j.phase === "generating" && earlyReadyJobs.has(j.jobId) && (
                          <button type="button" className="job-seg-read" title={t.readEarlyHint}
                            onClick={e => { e.stopPropagation(); openRunningJob(j.jobId); }}>
                            ▶︎ {t.readEarly}
                          </button>
                        )}
                        {j.phase !== "done" && (
                          <button type="button" className="job-seg-x" aria-label={t.segCancel} title={t.segCancel}
                            onClick={async e => {
                              e.stopPropagation();
                              // Zaseknutá / chybová: zrušit hned; zdravě běžící: 1× potvrdit
                              if (j.phase === "error" || j.stalled || await appConfirm(t.cancelJobAsk)) {
                                cancelServerJob(j.jobId);
                              }
                            }}>✕</button>
                        )}
                        {/* 📋 deník běhu — co se kdy stalo a jak dlouho to trvalo */}
                        {j.phase !== "done" && (j.log?.length ?? 0) > 0 && (
                          <button type="button" className="job-seg-x job-seg-log" aria-label={t.logTitle} title={t.logTitle}
                            onClick={e => { e.stopPropagation(); setLogView({ jobId: j.jobId, title: j.title || "" }); }}>📋</button>
                        )}
                        <span className="job-seg-label">
                          {/* zdravé navázání po limitu funkce ≠ „pokus" — pokusy
                              se ukazují jen při psaní BEZ pokroku */}
                          {idx + 1}. {j.stalled ? "⚠️ " : ""}{j.phase === "writing" ? `${t.segWriting}${(j.stuckRestarts ?? 0) > 0 ? ` (${(j.restarts ?? 0) + 1}. pokus)` : (j.restarts ?? 0) > 0 ? ` (${t.segWritingResume})` : ""}`
                            : j.phase === "generating" ? `🎨 ${j.done}/${j.total}`
                            : j.phase === "done" ? t.segOpen
                            : t.segError}
                        </span>
                        {/* živý stav: poslední krok z 📋 deníku — ať je vidět,
                            že job pracuje, i když se čísla zrovna nehýbou */}
                        {j.phase === "generating" && j.log?.length ? (
                          <span className="job-live-note">{j.log[j.log.length - 1].m.slice(0, 90)}</span>
                        ) : null}
                        {j.phase === "writing" && j.lastError && (
                          <span className="job-last-error">⚠️ {j.lastError.slice(0, 160)}</span>
                        )}
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
              {newestJob?.imgError && (
                <p className="gen-step-hint world-question">🎨 {t.imgErrHint}: {newestJob.imgError}</p>
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
              <div className="page-image-wrap">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="page-image" src={current.imageUrl} alt={t.sceneAlt(page + 1)}
                  ref={pageImgRef}
                  onLoad={() => setRollTick(t => t + 1)} />
                {/* 🖌 překreslit i HOTOVÝ obrázek (vadný/nekonzistentní) */}
                {fixingScene === page ? (
                  <div className="img-redraw-busy"><div className="placeholder-spinner" /></div>
                ) : (
                  <button type="button" className="img-redraw" aria-label={t.regenImg} title={t.regenImg}
                    onClick={async e => {
                      e.stopPropagation();
                      if (await appConfirm(t.redrawAsk)) repairSceneImage(page);
                    }}>🖌</button>
                )}
              </div>
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

            {/* 4 tlačítka: řada na šířku obrázku (portrét) / sloupec na výšku
                obrázku (fullscreen). Hlas a hudba se nastavují v hlavním menu,
                auto-přechod scén je zapnutý vždy. */}
            <div className="book-controls" onClick={e => e.stopPropagation()}>
              <button type="button" className={`ctrl-cell ctrl-cell-primary${!current.audioUrl || regenAudio ? " ctrl-cell-loading" : ""}`}
                onClick={togglePlay} disabled={!current.audioUrl || regenAudio}>
                <span className="ctrl-ico">{!current.audioUrl && !regenAudio ? "⏳" : isPlaying ? "⏸" : "▶"}</span>
                <span className="ctrl-txt">{isPlaying ? t.pause : t.play}</span>
              </button>

              <div className="ctrl-cell ctrl-cell-info">
                <span className="ctrl-ico">📖</span>
                <span className="ctrl-txt">{pagePos + 1} / {visiblePages.length}{storyChoice && branch === null ? "+" : ""}</span>
              </div>

              <button type="button" className={`ctrl-cell${forcedLs ? " ctrl-cell-on" : ""}`}
                onClick={toggleForcedLandscape}>
                {/* ikona ukazuje CÍLOVOU polohu: ležatý telefon = přepni na šířku */}
                <span className={`ctrl-ico${forcedLs ? "" : " ico-rot"}`}>📱</span>
                <span className="ctrl-txt">{forcedLs ? t.rotateBack : t.rotate}</span>
              </button>

              <button type="button" className="ctrl-cell ctrl-cell-home" onClick={resetToForm}>
                <span className="ctrl-ico">🏠</span>
                <span className="ctrl-txt">{t.home}</span>
              </button>
            </div>
          </div>

          {/* Nav arrows + dots outside the card — no overflow clipping */}
          <div className="book-nav" ref={navRef}>
            <button type="button" className="ctrl-btn ctrl-nav" onClick={() => prevVisible !== null && goToPage(prevVisible)} disabled={!hasPrev} aria-label={t.prev}>←</button>
            <div className="page-dots">
              {visiblePages.map((i, pos) => (
                <button key={i} type="button"
                  className={`dot ${i === page ? "dot-active" : ""} ${scenes[i]?.audioUrl ? "dot-ready" : ""}`}
                  onClick={() => goToPage(i)} aria-label={`Strana ${pos + 1}`} />
              ))}
            </div>
            <button type="button" className="ctrl-btn ctrl-nav" onClick={() => nextVisible !== null && goToPage(nextVisible)} disabled={!hasNext} aria-label={t.next}>→</button>
          </div>

          {/* 🔀 Návrat k rozbočce — vyzkoušet druhou variantu konce */}
          {viewMode === "reader" && storyChoice && branch !== null && (
            <button type="button" className="choice-return"
              onClick={() => {
                audioRef.current?.pause();
                setIsPlaying(false);
                setBranch(null);
                isAutoAdvanceRef.current = false;
                goToPage(storyChoice.common - 1);
                setShowCredits(false);
              }}>
              🔀 {t.choiceReturn}
            </button>
          )}

          {/* 🔀 Výběr konce — po dovyprávění poslední společné scény.
              Dvě grafické karty: obrázek první scény dané cesty + popisek.
              JEN ve čtečce — jinak plaval nad formulářem */}
          {viewMode === "reader" && storyChoice && branch === null && page === storyChoice.common - 1 && !isPlaying && (
            <div className="choice-panel">
              <p className="choice-title">🔀 {t.choiceTitle}</p>
              <div className="choice-cards">
                {(["A", "B"] as const).map((b, bi) => {
                  const idx = b === "A" ? storyChoice.common : storyChoice.altFrom;
                  const img = scenes[idx]?.imageUrl;
                  return (
                    <button key={b} type="button" className="choice-card" onClick={() => pickBranch(b)}>
                      {img && !isPlaceholderImg(img)
                        ? <img src={img} alt={storyChoice.options[bi]} />
                        : <span className="choice-card-emoji">{bi === 0 ? "🌟" : "🌙"}</span>}
                      <span className="choice-card-label">{bi === 0 ? "1️⃣" : "2️⃣"} {storyChoice.options[bi]}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

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
            <p className="gen-step-hint" style={{ margin: "0.15rem 0 0.4rem" }}>{t.swipeHint}</p>
          )}
          {historyOpen && (
            <div className="history-list">
              {storyHistory.map(entry => (
                <div key={entry.id} className={`history-wrap${confirmDeleteId === entry.id ? " del-armed" : ""}`}>
                  <button type="button" className="history-item"
                    onClick={() => {
                      // Swipe za sebou nechává syntetizovaný click — ignorovat
                      if (swipeHandledRef.current) { swipeHandledRef.current = false; return; }
                      if (confirmDeleteIdRef.current) { armDelete(null); return; }
                      replayStory(entry);
                    }}
                    onTouchStart={e => { swipeXRef.current = e.touches[0].clientX; }}
                    onTouchEnd={e => {
                      const x0 = swipeXRef.current; swipeXRef.current = null;
                      if (x0 === null) return;
                      const dx = e.changedTouches[0].clientX - x0;
                      if (dx < -50) { swipeHandledRef.current = true; armDelete(entry.id); }        // swipe doleva = odjistit
                      else if (dx > 50 && confirmDeleteIdRef.current === entry.id) { swipeHandledRef.current = true; armDelete(null); } // swipe zpět
                    }}
                    disabled={loading && bgStatus === "idle"}>
                    <div className="history-item-body">
                      <span className="history-title-clip">
                        <span className={`history-title${entry.title.length > 24 ? " title-roll" : ""}`}>{entry.title}</span>
                      </span>
                      <div className="history-badges">
                        <span className="history-badge badge-offline">📥 offline</span>
                        <span className="history-badge badge-size">{estimateStorySize(entry.scenes.length)}</span>
                        <span className="history-badge badge-scenes">{t.scenesBadge(entry.scenes.length)}</span>
                        {entry.prepSec !== undefined && (
                          /* ťuknutí otevře 📋 deník přípravy (když ho pohádka má) */
                          <span className={`history-badge badge-size${entry.log?.length ? " badge-log" : ""}`}
                            role={entry.log?.length ? "button" : undefined}
                            title={entry.writeSec !== undefined ? `✍️ psaní ${fmtDur(entry.writeSec)}` : undefined}
                            onClick={entry.log?.length ? (e => { e.stopPropagation(); setLogView({ title: entry.title, entries: entry.log }); }) : undefined}>
                            ⏱ {fmtDur(entry.prepSec)}{entry.log?.length ? " 📋" : ""}
                          </span>
                        )}
                        <span className="history-badge badge-sequel" role="button"
                          onClick={e => startSequel(e, entry)}>✨ {t.sequelBtn}</span>
                        <span className="history-badge badge-share" role="button"
                          onClick={e => shareStory(e, entry)}>
                          {shareBusyId === entry.id
                            ? `⏳ ${shareProg ? `${shareProg.done}/${shareProg.total}` : ""}`
                            : `📤 ${t.shareBtn}`}
                        </span>
                        <span className="history-badge badge-export" role="button"
                          onClick={e => exportStory(e, entry)}>
                          {exportBusyId === entry.id ? "⏳" : `💾 ${t.exportBtn}`}
                        </span>
                      </div>
                      <span className="history-date">{fmtDate(entry.createdAt)}</span>
                    </div>
                    <span className="history-del" role="button" aria-label={t.deleteStory}
                      onClick={e => { e.stopPropagation(); armDelete(confirmDeleteId === entry.id ? null : entry.id); }}>🗑️</span>
                    <span className="history-play-btn">▶</span>
                  </button>
                  <button type="button" className="history-del-action" onClick={e => deleteStory(e, entry)}>
                    🗑️ {t.delBtnShort}
                  </button>
                </div>
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
                  {usage.own && typeof usage.own.images === "number" ? (
                    <div className="usage-grid">
                      <div className="usage-stat">
                        <span className="usage-num">📚 {(usage.own.stories ?? 0).toLocaleString("cs-CZ")}</span>
                        <span className="usage-lbl">{t.statStories(usage.own.days ?? 30)}</span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-num">📱 {(usage.own.devices ?? 0).toLocaleString("cs-CZ")}</span>
                        <span className="usage-lbl">{t.statDevices}</span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-num">🎨 {(usage.own.images + (usage.own.sheets ?? 0)).toLocaleString("cs-CZ")}</span>
                        <span className="usage-lbl">{t.statImages(Math.round((usage.own.usd ?? 0) * (usage.czkRate ?? 23)).toLocaleString("cs-CZ"))}</span>
                      </div>
                      <div className="usage-stat">
                        <span className="usage-num">🎙️ {(usage.own.chars ?? 0).toLocaleString("cs-CZ")}</span>
                        <span className="usage-lbl">{t.statVoice}</span>
                      </div>
                      {/* ⏱ příprava POSLEDNÍ pohádky + průměr (z -p záznamů) */}
                      {(usage.own.prepCount ?? 0) > 0 && (
                        <div className="usage-stat">
                          <span className="usage-num">⏱ {fmtDur(usage.own.prepLastSec || usage.own.prepAvgSec || 0)}</span>
                          <span className="usage-lbl">{t.statPrep(fmtDur(usage.own.prepAvgSec ?? 0), fmtDur(usage.own.prepMinSec ?? 0), fmtDur(usage.own.prepMaxSec ?? 0))}</span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <p>{t.usageGemini}</p>
                  )}
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

              {/* Bez technologií (know-how) — titulky patří hrdinům */}
              <p className="credits-section">{uiLang === "en" ? "Heroes" : "Hrdinové"}</p>
              {storyCharNames().map(n => (
                <p key={n} className="credits-item">{n}</p>
              ))}

              <p className="credits-section">{uiLang === "en" ? "Made with love" : "Vytvořeno s láskou"}</p>
              <p className="credits-item">{uiLang === "en" ? "for Nicky's Fairy Tales" : "pro Nickyho pohádky"}</p>
              <p className="credits-item">© {new Date().getFullYear()}</p>

              {/* 🌙 dobrou noc jmenovitě všem postavám pohádky */}
              <p className="credits-goodnight">🌙 {goodnightText(goodnightLang(), storyCharNames())} 🌙</p>

              <p className="credits-tap">— klikni pro zavření —</p>
            </div>
          </div>
        </div>
      )}

      {/* 📝 Velký editor přání & inspirace — celý text viditelný */}
      {topicEditorOpen && (
        <div className="app-confirm-overlay" onClick={() => setTopicEditorOpen(false)}>
          <div className="app-confirm topic-editor" onClick={e => e.stopPropagation()}>
            <p className="app-confirm-msg">📝 {t.wishLabel}</p>
            {topic.trim() !== "" && (
              <div className="ta-toolbar">
                <button type="button" className="ta-clear" aria-label={t.clearTextBtn}
                  onClick={() => setTopic("")}>✕</button>
              </div>
            )}
            <div className="ta-wrap">
              <textarea className="topic-editor-ta" value={topic} autoFocus
                onChange={e => setTopic(e.target.value)} placeholder={t.wishPlaceholder} />
            </div>
            <div className="app-confirm-btns topic-editor-btns">
              <button type="button" className="outline-btn" disabled={!topic.trim() || expandLoading || ideaLoading}
                onClick={expandIdea}>{expandLoading ? "⏳" : "✨"} {t.expandBtn}</button>
              <button type="button" className="cancel-btn"
                onClick={() => { setTopic(topicBeforeEditRef.current); setTopicEditorOpen(false); }}>
                ✕ {t.cancel}
              </button>
              <button type="button" className="btn-span2" onClick={() => setTopicEditorOpen(false)}>✓ OK</button>
            </div>
          </div>
        </div>
      )}

      {/* 🌍 Velký editor popisu vlastního světa — stejné okno jako u přání */}
      {worldEditorOpen && (
        <div className="app-confirm-overlay" onClick={() => setWorldEditorOpen(false)}>
          <div className="app-confirm topic-editor" onClick={e => e.stopPropagation()}>
            <p className="app-confirm-msg">🌍 {t.worldDescLabel}</p>
            {newThemeDesc.trim() !== "" && (
              <div className="ta-toolbar">
                <button type="button" className="ta-clear" aria-label={t.clearTextBtn}
                  onClick={() => setNewThemeDesc("")}>✕</button>
              </div>
            )}
            <div className="ta-wrap">
              <textarea className="topic-editor-ta" value={newThemeDesc} autoFocus
                onChange={e => setNewThemeDesc(e.target.value)} placeholder={t.worldDescPlaceholder} />
            </div>
            <div className="app-confirm-btns topic-editor-btns">
              <button type="button" className="cancel-btn"
                onClick={() => { setNewThemeDesc(worldDescBeforeEditRef.current); setWorldEditorOpen(false); }}>
                ✕ {t.cancel}
              </button>
              <button type="button" onClick={() => setWorldEditorOpen(false)}>✓ OK</button>
            </div>
          </div>
        </div>
      )}

      {/* 📋 Deník běhu pohádky — kroky přípravy s časy a chybami (živě z pollů) */}
      {logView && (
        <div className="app-confirm-overlay" onClick={() => setLogView(null)}>
          <div className="app-confirm job-log" onClick={e => e.stopPropagation()}>
            <p className="app-confirm-msg">📋 {t.logTitle}{logView.title ? ` — ${logView.title}` : ""}</p>
            <div className="job-log-list">
              {(() => {
                const entries = logView.entries ?? (serverJobs.find(j => j.jobId === logView.jobId)?.log || []);
                if (entries.length === 0) return <p>{t.logEmpty}</p>;
                const t0 = entries[0].t;
                return entries.map((en, i) => (
                  <p key={i}>
                    <span className="job-log-t">+{fmtDur((en.t - t0) / 1000)}</span> {en.m}
                  </p>
                ));
              })()}
            </div>
            <div className="app-confirm-btns">
              <button type="button" onClick={() => setLogView(null)}>✓ OK</button>
            </div>
          </div>
        </div>
      )}

      {/* 🎬 Úvodní obrazovka — náhodný pohádkový motiv, nadpis, verze a slogan */}
      {intro && (
        <div className={`intro-splash${intro.closing ? " closing" : ""}`}
          style={intro.url ? { backgroundImage: `linear-gradient(rgba(12, 9, 38, 0.32), rgba(12, 9, 38, 0.58)), url("${intro.url}")` } : undefined}
          onClick={() => setIntro(null)}>
          <h1 className="intro-title">📖 {uiLang === "cs" ? "Nickyho pohádky" : "Nicky's Fairy Tales"}</h1>
          <p className="intro-version">v{APP_VERSION}</p>
          <p className="intro-tag">{t.introTag}</p>
        </div>
      )}

      {/* 🔀 Kreslení druhého konce po jeho výběru (líná větev B) */}
      {branchProg && (
        <div className="app-confirm-overlay">
          <div className="app-confirm">
            <p className="app-confirm-msg">🎨 {t.branchDrawing} {branchProg.done}/{branchProg.total}</p>
            <p className="gen-step-hint">{t.branchDrawingHint}</p>
          </div>
        </div>
      )}

      {/* 📤 Hotový odkaz na sdílenou pohádku — sdílení/kopie na čerstvé ťuknutí */}
      {shareResult && (
        <div className="app-confirm-overlay" onClick={() => setShareResult(null)}>
          <div className="app-confirm" onClick={e => e.stopPropagation()}>
            <p className="app-confirm-msg">📤 {t.shareReadyTitle}</p>
            <p className="share-link-box">{shareResult.url}</p>
            <div className="app-confirm-btns">
              <button type="button" className="outline-btn" onClick={shareResultCopy}>
                {shareResult.copied ? `✓ ${t.shareCopiedShort}` : `📋 ${t.shareCopyBtn}`}
              </button>
              {typeof navigator !== "undefined" && !!navigator.share && (
                <button type="button" onClick={shareResultNative}>📤 {t.shareNativeBtn}</button>
              )}
            </div>
            <div className="app-confirm-btns">
              <button type="button" className="cancel-btn" onClick={() => setShareResult(null)}>✕ {t.cancel}</button>
            </div>
            <p className="gen-step-hint">{t.shareReadyHint}</p>
          </div>
        </div>
      )}

      {/* Stylové potvrzovací okno (náhrada systémového confirm) */}
      {confirmBox && (
        <div className="app-confirm-overlay" onClick={() => answerConfirm(false)}>
          <div className="app-confirm" onClick={e => e.stopPropagation()}>
            <p className="app-confirm-msg">{confirmBox.msg}</p>
            <div className="app-confirm-btns">
              {!confirmBox.alert && (
                <button type="button" className="cancel-btn" onClick={() => answerConfirm(false)}>✕ {t.cancel}</button>
              )}
              <button type="button" onClick={() => answerConfirm(true)}>OK</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
