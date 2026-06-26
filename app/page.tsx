"use client";

import { useState, useRef, useEffect } from "react";
import type { StoryScript, RenderedScene } from "@/lib/types";

interface CharacterOption {
  id: string;
  name: string;
}

interface ThemeOption {
  id: string;
  name: string;
  emoji: string;
}

export default function Home() {
  const [topic, setTopic] = useState("");
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [themes, setThemes] = useState<ThemeOption[]>([]);
  const [selectedTheme, setSelectedTheme] = useState<string>("");
  const [age, setAge] = useState(4);
  const [sceneCount, setSceneCount] = useState(6);

  // načti postavy a témata
  useEffect(() => {
    fetch("/api/characters")
      .then((r) => r.json())
      .then((d) => {
        const list: CharacterOption[] = d.characters || [];
        setCharacters(list);
        setSelectedIds(list.map((c) => c.id)); // defaultně všechny
      })
      .catch(() => setCharacters([]));

    fetch("/api/themes")
      .then((r) => r.json())
      .then((d) => setThemes(d.themes || []))
      .catch(() => setThemes([]));
  }, []);

  function toggleCharacter(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function pickTheme(id: string) {
    setSelectedTheme((prev) => (prev === id ? "" : id)); // druhý klik zruší
  }

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const [title, setTitle] = useState("");
  const [scenes, setScenes] = useState<RenderedScene[]>([]);
  const [page, setPage] = useState(0);

  const audioRef = useRef<HTMLAudioElement>(null);

  async function createStory(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setScenes([]);
    setTitle("");
    setPage(0);
    setLoading(true);

    try {
      // 1) Claude napíše scénář
      setStatus("✍️ Claude vymýšlí příběh…");
      const storyRes = await fetch("/api/story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          themeId: selectedTheme,
          characterIds: selectedIds,
          age,
          sceneCount,
        }),
      });
      const script: StoryScript & { error?: string } = await storyRes.json();
      if (!storyRes.ok) throw new Error(script.error || "Nepodařilo se vytvořit příběh.");

      setTitle(script.title);
      // ukaž text hned, média se doplní postupně
      setScenes(script.scenes.map((s) => ({ ...s })));

      // 2) Pro každou scénu obrázek + hlas
      for (let i = 0; i < script.scenes.length; i++) {
        setStatus(`🎨 Kreslím a namlouvám scénu ${i + 1}/${script.scenes.length}…`);
        const sceneRes = await fetch("/api/scene", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scene: script.scenes[i],
            heroDescription: script.heroDescription,
            characterIds: selectedIds,
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

  function play() {
    audioRef.current?.play();
  }

  return (
    <div className="container">
      <h1>📖 Nickyho pohádky</h1>
      <p className="subtitle">Vymysli téma a necháme vykouzlit pohádku s obrázky a hlasem.</p>

      <form className="form" onSubmit={createStory}>
        {characters.length > 0 && (
          <div className="field">
            <label>Kdo v pohádce vystupuje?</label>
            <div className="chips">
              {characters.map((c) => (
                <label
                  key={c.id}
                  className={`chip ${selectedIds.includes(c.id) ? "chip-on" : ""}`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(c.id)}
                    onChange={() => toggleCharacter(c.id)}
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}

        {themes.length > 0 && (
          <div className="field">
            <label>Vyber téma (svět pohádky)</label>
            <div className="chips">
              {themes.map((t) => (
                <button
                  type="button"
                  key={t.id}
                  className={`chip chip-btn ${selectedTheme === t.id ? "chip-on" : ""}`}
                  onClick={() => pickTheme(t.id)}
                >
                  <span>{t.emoji}</span> {t.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="topic">Vlastní přání (nepovinné)</label>
          <textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Např. ať najdou ztracené koťátko a pomůže jim hodný drak"
          />
        </div>

        <div className="field">
          <label htmlFor="age">Věk dítěte</label>
          <input
            id="age"
            type="number"
            min={1}
            max={12}
            value={age}
            onChange={(e) => setAge(Number(e.target.value))}
          />
        </div>
        <div className="field">
          <label htmlFor="scenes">Počet stránek: {sceneCount}</label>
          <input
            id="scenes"
            type="range"
            min={3}
            max={12}
            value={sceneCount}
            onChange={(e) => setSceneCount(Number(e.target.value))}
          />
        </div>
        <button
          type="submit"
          disabled={
            loading ||
            (characters.length > 0 && selectedIds.length === 0) ||
            (!selectedTheme && !topic.trim())
          }
        >
          {loading ? "Tvořím pohádku…" : "✨ Vytvořit pohádku"}
        </button>
      </form>

      {status && <p className="status">{status}</p>}
      {error && <p className="error">⚠️ {error}</p>}

      {current && (
        <div className="book">
          <h2 className="book-title">{title}</h2>
          <div className="page">
            {current.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="page-image" src={current.imageUrl} alt={`Scéna ${page + 1}`} />
            ) : (
              <div className="page-image placeholder">🎨 obrázek se kreslí…</div>
            )}
            <div className="page-body">
              <p className="page-text">{current.narration}</p>
              <div className="page-controls">
                {current.audioUrl ? (
                  <>
                    <button type="button" onClick={play}>
                      ▶️ Přehrát
                    </button>
                    <audio ref={audioRef} key={current.audioUrl} src={current.audioUrl} controls />
                  </>
                ) : (
                  <span className="page-counter">🔊 hlas se připravuje…</span>
                )}
              </div>
            </div>
          </div>

          <div className="nav">
            <button type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
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
