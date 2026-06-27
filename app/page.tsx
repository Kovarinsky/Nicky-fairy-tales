"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { StoryScript, RenderedScene, Scene } from "@/lib/types";
import { AmbientPlayer } from "@/lib/ambient";

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
  const [showCredits, setShowCredits] = useState(false);
  const [regenAudio, setRegenAudio] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ambientRef = useRef<AmbientPlayer | null>(null);
  const pendingPageRef = useRef<number | null>(null);

  // History
  const [storyHistory, setStoryHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const allScenesReady = scenes.length > 0 && scenes.every(s => s.imageUrl && s.audioUrl);

  // ── Boot ──
  useEffect(() => {
    fetch("/api/characters").then(r => r.json()).then(d => {
      const list: CharOption[] = d.characters || [];
      setChars(list);
      setSelectedIds(list.map(c => c.id));
    }).catch(() => {});
    fetch("/api/themes").then(r => r.json()).then(d => setThemes(d.themes || [])).catch(() => {});
    fetch("/api/voices").then(r => r.json()).then(d => {
      const list: VoiceOption[] = d.voices || [];
      setVoices(list);
      if (list.length > 0) setSelectedVoiceId(list[0].id);
    }).catch(() => {});
    setStoryHistory(loadHistory());
  }, []);

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
    if (!allScenesReady) return;
    ambientRef.current?.setScene(scenes[page]?.soundscape);
  }, [page, allScenesReady, scenes]);

  // Intro fanfare + first soundscape when story first becomes ready
  const introFiredRef = useRef(false);
  useEffect(() => {
    if (!allScenesReady || introFiredRef.current) return;
    introFiredRef.current = true;
    ambientRef.current?.playIntro();
    ambientRef.current?.setScene(scenes[0]?.soundscape);
  }, [allScenesReady, scenes]);

  // Reset intro flag when new story starts
  useEffect(() => {
    if (scenes.length === 0) introFiredRef.current = false;
  }, [scenes.length]);

  // ── Auto-play narration after slide animation ──
  const currentAudioUrl = scenes[page]?.audioUrl;
  useEffect(() => {
    if (!currentAudioUrl || !allScenesReady) return;
    const t = setTimeout(() => audioRef.current?.play().catch(() => {}), 420);
    return () => clearTimeout(t);
  }, [page, currentAudioUrl, allScenesReady]);

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
    voiceId: string
  ) {
    setTitle(scriptTitle);
    setScenes(scriptScenes.map(s => ({ ...s })));
    setPage(0);
    setSlideKey(0);
    setDoneCount(0);
    setSceneStatuses(scriptScenes.map(() => "waiting"));

    const CONCURRENCY = 3;
    let completed = 0;
    setStatus(`🎨 Generuji ${scriptScenes.length} scén...`);

    const tasks = scriptScenes.map((scene, i) => async () => {
      setSceneStatuses(prev => { const n = [...prev]; n[i] = "generating"; return n; });
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
        const media = await safeJson<{ imageUrl?: string; audioUrl?: string; error?: string }>(res);
        if (!res.ok) throw new Error(media.error || `Scéna ${i + 1} selhala.`);
        completed++;
        setDoneCount(completed);
        setScenes(prev => {
          const next = [...prev];
          next[i] = { ...next[i], imageUrl: media.imageUrl, audioUrl: media.audioUrl };
          return next;
        });
        setSceneStatuses(prev => { const n = [...prev]; n[i] = "done"; return n; });
      } catch {
        setSceneStatuses(prev => { const n = [...prev]; n[i] = "error"; return n; });
      }
    });

    let idx = 0;
    async function worker() {
      while (idx < tasks.length) { const i = idx++; await tasks[i](); }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  }

  // ── Create story (full flow) ──────────────────────────────────────────────
  async function createStory(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setScenes([]); setTitle(""); setPage(0); setLoading(true);
    try {
      setStatus("✍️ Claude vymýšlí příběh...");
      const selectedCustomObjs = customChars.filter(c => selectedCustomIds.includes(c.id));

      const storyRes = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      await generateMedia(script.title, script.heroDescription, script.scenes, customImageRefs, selectedVoiceId);
      setStatus("✨ Pohádka je připravena!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Něco se pokazilo.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  // ── Replay from history ───────────────────────────────────────────────────
  async function replayStory(entry: HistoryEntry) {
    setError(""); setLoading(true);
    setHistoryOpen(false);
    try {
      await generateMedia(entry.title, entry.heroDescription, entry.scenes, [], selectedVoiceId);
      setStatus("✨ Pohádka je připravena!");
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

  return (
    <div className="container">
      {/* Fixed mute button — always visible */}
      <button
        type="button"
        className={`mute-fab ${musicOn ? "mute-fab-on" : ""}`}
        onClick={() => setMusicOn(p => !p)}
        title={musicOn ? "Vypnout hudbu" : "Zapnout hudbu"}
        aria-label={musicOn ? "Vypnout hudbu" : "Zapnout hudbu"}
      >
        {musicOn ? "🎵" : "🔇"}
      </button>

      <h1>📖 Nickyho pohádky</h1>
      <p className="subtitle">Vyber postavy, téma a inspiraci – pohádka s obrázky a tatínkovým hlasem.</p>

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
          <input type="range" min={3} max={12} value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))} />
        </div>

        <button type="submit" className="btn-create" disabled={loading || allSelectedCount === 0 || !hasInspiration}>
          {loading ? "Tvořím pohádku..." : "✨ Vytvořit pohádku"}
        </button>
      </form>

      {/* ── HISTORY ── */}
      {storyHistory.length > 0 && !loading && (
        <div className="history-box">
          <button type="button" className="history-toggle" onClick={() => setHistoryOpen(p => !p)}>
            📚 Poslední pohádky ({storyHistory.length}) {historyOpen ? "▲" : "▼"}
          </button>
          {historyOpen && (
            <div className="history-list">
              {storyHistory.map(entry => (
                <div key={entry.id} className="history-item">
                  <div className="history-meta">
                    <span className="history-title">{entry.title}</span>
                    <span className="history-date">{fmtDate(entry.createdAt)}</span>
                    <span className="history-info">{entry.scenes.length} scén</span>
                  </div>
                  <button type="button" className="history-replay" onClick={() => replayStory(entry)} disabled={loading}>
                    ▶ Přehrát znovu
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── GENERATION PROGRESS ── */}
      {loading && scenes.length > 0 && (
        <div className="gen-progress">
          <p className="gen-status">{status}</p>
          <div className="gen-bar-track">
            <div className="gen-bar-fill" style={{ width: `${(doneCount / totalScenes) * 100}%` }} />
          </div>
          <p className="gen-count">{doneCount} / {totalScenes} scén hotovo</p>
          <div className="gen-cards">
            {scenes.map((s, i) => {
              const st = sceneStatuses[i] ?? "waiting";
              return (
                <div key={i} className={`gen-card gen-card-${st}`}>
                  {s.imageUrl
                    ? <img src={s.imageUrl} alt={`Scéna ${i + 1}`} className="gen-card-img" />
                    : <div className="gen-card-placeholder">
                        {st === "generating" && <div className="gen-card-spinner" />}
                        {st === "error" && <span className="gen-card-icon">⚠️</span>}
                        {st === "waiting" && <span className="gen-card-icon">⏳</span>}
                      </div>
                  }
                  <span className="gen-card-label">
                    {st === "generating" ? "🎨" : st === "done" ? "✓" : st === "error" ? "!" : ""} {i + 1}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {status && !loading && <p className="status">{status}</p>}
      {error && <p className="error">⚠️ {error}</p>}

      {/* ── BOOK – shown only when ALL scenes are ready ── */}
      {allScenesReady && current && (
        <div className="book">
          <h2 className="book-title">{title}</h2>

          <div className="book-card" key={slideKey}>
            {current.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="page-image" src={current.imageUrl} alt={`Scéna ${page + 1}`} />
            ) : (
              <div className="page-image placeholder">
                <div className="placeholder-spinner" />
                <span>🎨 Generuji scénu {page + 1}...</span>
              </div>
            )}

            <div className="page-body">
              <p className="page-text">{current.narration}</p>
            </div>

            <div className="book-controls">
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

              <button type="button" className="ctrl-btn ctrl-nav" onClick={() => goToPage(page + 1)} disabled={!hasNext} aria-label="Další">→</button>
            </div>
          </div>

          {current.audioUrl && (
            <audio ref={audioRef} key={current.audioUrl} src={current.audioUrl}
              onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={handleAudioEnded} />
          )}


          {scenes.length > 1 && (
            <div className="page-dots">
              {scenes.map((_, i) => (
                <button key={i} type="button"
                  className={`dot ${i === page ? "dot-active" : ""} ${scenes[i]?.audioUrl ? "dot-ready" : ""}`}
                  onClick={() => goToPage(i)} aria-label={`Strana ${i + 1}`} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── ROLLING CREDITS ── */}
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
