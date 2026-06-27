"use client";

import { useState, useRef, useEffect } from "react";
import type { StoryScript, RenderedScene } from "@/lib/types";

interface CharOption { id: string; name: string; }
interface ThemeOption { id: string; name: string; emoji: string; }

interface CustomChar {
  id: string;
  name: string;
  description: string;
  photoBase64?: string;
  photoMimeType?: string;
  previewUrl?: string;
}

interface InspImage {
  data: string;
  mimeType: string;
  previewUrl: string;
  name: string;
}

// Resize + encode image to JPEG base64 (max 800px for chars, 512px for inspiration)
async function resizeAndEncode(
  file: File,
  maxPx = 800
): Promise<{ data: string; mimeType: string; previewUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
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

function getTargetAge(selectedIds: string[]): number {
  const hasNicky = selectedIds.includes("nicolas");
  const hasValentyna = selectedIds.includes("valentyna");
  if (hasNicky && hasValentyna) return 4;
  if (hasValentyna) return 2;
  if (hasNicky) return 6;
  return 6;
}

export default function Home() {
  // ── Existing characters & themes ──
  const [chars, setChars] = useState<CharOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");

  // ── Custom characters ──
  const [customChars, setCustomChars] = useState<CustomChar[]>([]);
  const [selectedCustomIds, setSelectedCustomIds] = useState<string[]>([]);
  const [addingChar, setAddingChar] = useState(false);
  const [newCharName, setNewCharName] = useState("");
  const [newCharDesc, setNewCharDesc] = useState("");
  const [newCharPhoto, setNewCharPhoto] = useState<{ data: string; mimeType: string; previewUrl: string } | null>(null);
  const charPhotoRef = useRef<HTMLInputElement>(null);

  // ── Inspiration ──
  const [topic, setTopic] = useState("");
  const [inspImages, setInspImages] = useState<InspImage[]>([]);
  const [inspUrlActive, setInspUrlActive] = useState(false);
  const [inspUrl, setInspUrl] = useState("");
  const [inspPdf, setInspPdf] = useState<{ base64: string; name: string } | null>(null);
  const inspImageRef = useRef<HTMLInputElement>(null);
  const inspPdfRef = useRef<HTMLInputElement>(null);

  const [sceneCount, setSceneCount] = useState(6);

  // ── Story state ──
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState<RenderedScene[]>([]);
  const [page, setPage] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => {
        const list: CharOption[] = d.characters || [];
        setChars(list);
        setSelectedIds(list.map((c) => c.id));
      })
      .catch(() => {});

    fetch("/api/themes")
      .then((r) => r.json())
      .then((d) => setThemes(d.themes || []))
      .catch(() => {});
  }, []);

  // ── Handlers ──
  function toggleChar(id: string) {
    setSelectedIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  function toggleCustomChar(id: string) {
    setSelectedCustomIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function handleCharPhoto(file: File) {
    const result = await resizeAndEncode(file, 800).catch(() => null);
    if (result) setNewCharPhoto(result);
  }

  function addCustomChar() {
    if (!newCharName.trim()) return;
    const id = `custom_${Date.now()}`;
    setCustomChars((p) => [
      ...p,
      {
        id,
        name: newCharName.trim(),
        description: newCharDesc.trim() || `a character named ${newCharName.trim()}`,
        photoBase64: newCharPhoto?.data,
        photoMimeType: newCharPhoto?.mimeType,
        previewUrl: newCharPhoto?.previewUrl,
      },
    ]);
    setSelectedCustomIds((p) => [...p, id]);
    setAddingChar(false);
    setNewCharName("");
    setNewCharDesc("");
    setNewCharPhoto(null);
  }

  function removeCustomChar(id: string) {
    setCustomChars((p) => p.filter((c) => c.id !== id));
    setSelectedCustomIds((p) => p.filter((x) => x !== id));
  }

  async function handleInspImage(file: File) {
    if (inspImages.length >= 3) return;
    const result = await resizeAndEncode(file, 512).catch(() => null);
    if (result) setInspImages((p) => [...p, { ...result, name: file.name }]);
  }

  async function handleInspPdf(file: File) {
    if (file.size > 3.5 * 1024 * 1024) {
      alert("PDF je příliš velké (max 3.5 MB). Použij menší soubor.");
      return;
    }
    const base64 = await fileToBase64(file).catch(() => null);
    if (base64) setInspPdf({ base64, name: file.name });
  }

  // ── Create story ──
  const allSelectedCount = selectedIds.length + selectedCustomIds.length;
  const hasInspiration =
    !!selectedTheme ||
    !!topic.trim() ||
    inspImages.length > 0 ||
    !!inspPdf ||
    (inspUrlActive && !!inspUrl.trim());

  async function createStory(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setScenes([]);
    setTitle("");
    setPage(0);
    setLoading(true);

    try {
      setStatus("✍️ Claude vymýšlí příběh...");

      const selectedCustomObjs = customChars.filter((c) => selectedCustomIds.includes(c.id));

      const storyRes = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          themeId: selectedTheme || undefined,
          characterIds: selectedIds,
          age: getTargetAge([...selectedIds, ...selectedCustomIds]),
          sceneCount,
          customCharacters: selectedCustomObjs.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            photoBase64: c.photoBase64,
            photoMimeType: c.photoMimeType,
          })),
          inspirationUrl: inspUrlActive && inspUrl.trim() ? inspUrl.trim() : undefined,
          inspirationImages: inspImages.map((i) => ({ data: i.data, mimeType: i.mimeType })),
          inspirationPdfBase64: inspPdf?.base64 || undefined,
        }),
      });

      const script: StoryScript & { error?: string } = await storyRes.json();
      if (!storyRes.ok) throw new Error(script.error || "Nepodařilo se vytvořit příběh.");

      setTitle(script.title);
      setScenes(script.scenes.map((s) => ({ ...s })));

      const customImageRefs = selectedCustomObjs
        .filter((c) => c.photoBase64 && c.photoMimeType)
        .map((c) => ({ data: c.photoBase64!, mimeType: c.photoMimeType! }));

      for (let i = 0; i < script.scenes.length; i++) {
        setStatus(`🎨 Kreslím a namlouvám scénu ${i + 1}/${script.scenes.length}...`);
        const sceneRes = await fetch("/api/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scene: script.scenes[i],
            heroDescription: script.heroDescription,
            characterIds: selectedIds,
            customCharacterImages: customImageRefs,
          }),
        });

        const media = await sceneRes.json();
        if (!sceneRes.ok) throw new Error(media.error || `Scéna ${i + 1} selhala.`);

        setScenes((prev) => {
          const next = [...prev];
          next[i] = { ...next[i], imageUrl: media.imageUrl, audioUrl: media.audioUrl };
          return next;
        });
      }

      setStatus("✨ Hotovo!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Něco se pokazilo.");
      setStatus("");
    } finally {
      setLoading(false);
    }
  }

  const current = scenes[page];

  return (
    <div className="container">
      <h1>📖 Nickyho pohádky</h1>
      <p className="subtitle">Vyber postavy, téma a inspiraci – pohádka s obrázky a tatínkovým hlasem.</p>

      <form className="form" onSubmit={createStory}>

        {/* ── Postavy ── */}
        {(chars.length > 0 || customChars.length > 0) && (
          <div className="field">
            <label>Kdo v pohádce vystupuje?</label>
            <div className="chips">
              {chars.map((c) => (
                <label key={c.id} className={`chip ${selectedIds.includes(c.id) ? "chip-on" : ""}`}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(c.id)}
                    onChange={() => toggleChar(c.id)}
                  />
                  {c.name}
                </label>
              ))}

              {customChars.map((c) => (
                <div
                  key={c.id}
                  className={`chip custom-chip ${selectedCustomIds.includes(c.id) ? "chip-on" : ""}`}
                >
                  {c.previewUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.previewUrl} alt={c.name} className="chip-avatar" />
                  )}
                  <span className="chip-label" onClick={() => toggleCustomChar(c.id)}>
                    {c.name}
                  </span>
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeCustomChar(c.id)}
                    title="Odebrat"
                  >
                    ×
                  </button>
                </div>
              ))}

              <button
                type="button"
                className={`chip chip-btn ${addingChar ? "chip-on" : ""}`}
                onClick={() => setAddingChar((p) => !p)}
              >
                {addingChar ? "✕ Zrušit" : "+ Vlastní postava"}
              </button>
            </div>
          </div>
        )}

        {/* ── Přidat vlastní postavu ── */}
        {addingChar && (
          <div className="add-char-panel">
            <p className="panel-title">Nová postava</p>
            <div className="field">
              <label>Jméno *</label>
              <input
                type="text"
                value={newCharName}
                onChange={(e) => setNewCharName(e.target.value)}
                placeholder="Kubík, Pohádková víla, Dráček..."
                autoFocus
              />
            </div>
            <div className="field">
              <label>Popis (nepovinné)</label>
              <textarea
                value={newCharDesc}
                onChange={(e) => setNewCharDesc(e.target.value)}
                placeholder="Malý hnědý medvídek s červenou mašlí..."
              />
            </div>
            <div className="field">
              <label>Fotka postavy (nepovinné – pro konzistenci obrázků)</label>
              <div className="file-row">
                <button
                  type="button"
                  className="outline-btn"
                  onClick={() => charPhotoRef.current?.click()}
                >
                  📷 {newCharPhoto ? "Změnit" : "Nahrát fotku"}
                </button>
                {newCharPhoto && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={newCharPhoto.previewUrl} alt="náhled" className="mini-preview" />
                )}
              </div>
              <input
                ref={charPhotoRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCharPhoto(f);
                  e.target.value = "";
                }}
              />
            </div>
            <div className="file-row">
              <button type="button" onClick={addCustomChar} disabled={!newCharName.trim()}>
                Přidat postavu
              </button>
              <button
                type="button"
                className="outline-btn"
                onClick={() => {
                  setAddingChar(false);
                  setNewCharName("");
                  setNewCharDesc("");
                  setNewCharPhoto(null);
                }}
              >
                Zrušit
              </button>
            </div>
          </div>
        )}

        {/* ── Témata ── */}
        {themes.length > 0 && (
          <div className="field">
            <label>Svět pohádky</label>
            <div className="chips">
              {themes.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`chip chip-btn ${selectedTheme === t.id ? "chip-on" : ""}`}
                  onClick={() => setSelectedTheme((p) => (p === t.id ? "" : t.id))}
                >
                  <span>{t.emoji}</span> {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Přání & Inspirace ── */}
        <div className="field">
          <label>Přání & inspirace</label>
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Vlastní zápletka nebo přání (nepovinné)..."
          />

          {/* Tlačítka pro přidání inspirace */}
          <div className="insp-row">
            <button
              type="button"
              className={`insp-btn ${inspImages.length > 0 ? "chip-on" : ""}`}
              onClick={() => inspImageRef.current?.click()}
              disabled={inspImages.length >= 3}
              title={inspImages.length >= 3 ? "Maximum 3 fotky" : "Přidat foto jako inspiraci"}
            >
              📷 Foto{inspImages.length > 0 ? ` (${inspImages.length})` : ""}
            </button>

            <button
              type="button"
              className={`insp-btn ${inspUrlActive ? "chip-on" : ""}`}
              onClick={() => setInspUrlActive((p) => !p)}
              title="Přidat odkaz na web jako inspiraci"
            >
              🔗 Web odkaz
            </button>

            <button
              type="button"
              className={`insp-btn ${inspPdf ? "chip-on" : ""}`}
              onClick={() => inspPdfRef.current?.click()}
              title="Přidat PDF jako inspiraci"
            >
              📄 PDF{inspPdf ? " ✓" : ""}
            </button>
          </div>

          <input
            ref={inspImageRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: "none" }}
            onChange={async (e) => {
              const files = Array.from(e.target.files || []);
              for (const f of files.slice(0, 3 - inspImages.length)) {
                await handleInspImage(f);
              }
              e.target.value = "";
            }}
          />
          <input
            ref={inspPdfRef}
            type="file"
            accept=".pdf,application/pdf"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleInspPdf(f);
              e.target.value = "";
            }}
          />

          {/* URL input */}
          {inspUrlActive && (
            <input
              type="url"
              value={inspUrl}
              onChange={(e) => setInspUrl(e.target.value)}
              placeholder="https://cs.wikipedia.org/wiki/Krteček"
              className="url-input"
            />
          )}

          {/* Náhledy fotek */}
          {inspImages.length > 0 && (
            <div className="insp-previews">
              {inspImages.map((img, i) => (
                <div key={i} className="preview-item">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.previewUrl} alt={img.name} className="preview-thumb" />
                  <button
                    type="button"
                    className="preview-remove"
                    onClick={() => setInspImages((p) => p.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* PDF indikátor */}
          {inspPdf && (
            <div className="insp-pdf-row">
              <span>📄 {inspPdf.name}</span>
              <button
                type="button"
                className="preview-remove-inline"
                onClick={() => setInspPdf(null)}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* ── Počet stránek ── */}
        <div className="field">
          <label>Počet stránek: {sceneCount}</label>
          <input
            type="range"
            min={3}
            max={10}
            value={sceneCount}
            onChange={(e) => setSceneCount(Number(e.target.value))}
          />
        </div>

        <button
          type="submit"
          className="btn-create"
          disabled={loading || allSelectedCount === 0 || !hasInspiration}
        >
          {loading ? "Tvořím pohádku..." : "✨ Vytvořit pohádku"}
        </button>
      </form>

      {status && <p className="status">{status}</p>}
      {error && <p className="error">⚠️ {error}</p>}

      {/* ── Knížka ── */}
      {current && (
        <div className="book">
          <h2 className="book-title">{title}</h2>
          <div className="page">
            {current.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="page-image"
                src={current.imageUrl}
                alt={`Scéna ${page + 1}`}
              />
            ) : (
              <div className="page-image placeholder">🎨 obrázek se kreslí...</div>
            )}
            <div className="page-body">
              <p className="page-text">{current.narration}</p>
              <div className="page-controls">
                {current.audioUrl ? (
                  <>
                    <button type="button" onClick={() => audioRef.current?.play()}>
                      ▶️ Přehrát
                    </button>
                    <audio
                      ref={audioRef}
                      key={current.audioUrl}
                      src={current.audioUrl}
                      controls
                    />
                  </>
                ) : (
                  <span className="page-counter">🔊 hlas se připravuje...</span>
                )}
              </div>
            </div>
          </div>

          <div className="nav">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              ← Zpět
            </button>
            <span className="page-counter">
              {page + 1} / {scenes.length}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(scenes.length - 1, p + 1))}
              disabled={page >= scenes.length - 1}
            >
              Další →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
