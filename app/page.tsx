"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { StoryScript, RenderedScene, Scene } from "@/lib/types";

// ── Local types ─────────────────────────────────────────────────────────────
interface CharOption { id: string; name: string; }
interface ThemeOption { id: string; name: string; emoji: string; }
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
  const [error, setError] = useState("");

  // Story / reader state
  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState<RenderedScene[]>([]);
  const [page, setPage] = useState(0);
  const [slideKey, setSlideKey] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [musicOn, setMusicOn] = useState(true);
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
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
    setStoryHistory(loadHistory());
  }, []);

  // ── Music ducking ──
  useEffect(() => {
    const m = musicRef.current; if (!m) return;
    m.volume = isPlaying ? 0.05 : 0.22;
  }, [isPlaying]);

  useEffect(() => {
    const m = musicRef.current; if (!m) return;
    musicOn ? m.play().catch(() => {}) : m.pause();
  }, [musicOn]);

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
    if (next >= scenes.length) return;
    if (scenes[next]?.imageUrl && scenes[next]?.audioUrl) {
      setTimeout(() => goToPage(next), 1200);
    } else {
      pendingPageRef.current = next; // wait for generation
    }
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
    customImageRefs: Array<{ data: string; mimeType: string }>
  ) {
    setTitle(scriptTitle);
    setScenes(scriptScenes.map(s => ({ ...s })));
    setPage(0);
    setSlideKey(0);
    setDoneCount(0);

    let completed = 0;
    setStatus(`🎨 Generuji ${scriptScenes.length} scén paralelně...`);

    const promises = scriptScenes.map(async (scene, i) => {
      const res = await fetch("/api/scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scene,
          heroDescription,
          characterIds: selectedIds,
          customCharacterImages: customImageRefs,
        }),
      });
      const media = await res.json();
      if (!res.ok) throw new Error(media.error || `Scéna ${i + 1} selhala.`);
      completed++;
      setDoneCount(completed);
      setScenes(prev => {
        const next = [...prev];
        next[i] = { ...next[i], imageUrl: media.imageUrl, audioUrl: media.audioUrl };
        return next;
      });
    });

    await Promise.all(promises);
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
      const script: StoryScript & { error?: string } = await storyRes.json();
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

      await generateMedia(script.title, script.heroDescription, script.scenes, customImageRefs);
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
      await generateMedia(entry.title, entry.heroDescription, entry.scenes, []);
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
          <input type="range" min={3} max={10} value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))} />
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
          <div className="gen-dots">
            {scenes.map((s, i) => (
              <div key={i} className={`gen-dot ${s.imageUrl ? "gen-dot-done" : "gen-dot-wait"}`} title={`Scéna ${i + 1}`} />
            ))}
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

              <button type="button" className={`ctrl-btn ctrl-play ${!current.audioUrl ? "ctrl-loading" : ""}`}
                onClick={togglePlay} disabled={!current.audioUrl} aria-label={isPlaying ? "Pauza" : "Přehrát"}>
                {!current.audioUrl ? "⏳" : isPlaying ? "⏸" : "▶"}
              </button>

              <span className="ctrl-counter">{page + 1} / {scenes.length}</span>

              <button type="button" className={`ctrl-btn ctrl-auto ${autoAdvance ? "ctrl-auto-on" : ""}`}
                onClick={() => setAutoAdvance(p => !p)} title={autoAdvance ? "Auto-přechod zapnut" : "Auto-přechod vypnut"}>
                {autoAdvance ? "🔁" : "🔂"}
              </button>

              <button type="button" className={`ctrl-btn ctrl-auto ${musicOn ? "ctrl-auto-on" : ""}`}
                onClick={() => setMusicOn(p => !p)} title={musicOn ? "Hudba zapnuta" : "Hudba vypnuta"}>
                {musicOn ? "🎵" : "🔇"}
              </button>

              <button type="button" className="ctrl-btn ctrl-nav" onClick={() => goToPage(page + 1)} disabled={!hasNext} aria-label="Další">→</button>
            </div>
          </div>

          {current.audioUrl && (
            <audio ref={audioRef} key={current.audioUrl} src={current.audioUrl}
              onPlay={() => setIsPlaying(true)} onPause={() => setIsPlaying(false)} onEnded={handleAudioEnded} />
          )}

          <audio ref={musicRef} src="/music/fairy-bg.mp3" loop preload="none" style={{ display: "none" }} />

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
    </div>
  );
}
