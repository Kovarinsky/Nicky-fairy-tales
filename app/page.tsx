"use client";

import { useState, useRef } from "react";
import type { StoryScript, RenderedScene } from "@/lib/types";

export default function Home() {
  const [topic, setTopic] = useState("");
  const [heroName, setHeroName] = useState("Nicolas");
  const [age, setAge] = useState(4);
  const [sceneCount, setSceneCount] = useState(6);

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
        body: JSON.stringify({ topic, heroName, age, sceneCount }),
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
        <div className="field">
          <label htmlFor="topic">O čem má pohádka být?</label>
          <textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Např. Nicolas a kouzelný drak, který se bál létat"
            required
          />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="hero">Jméno hrdiny</label>
            <input id="hero" value={heroName} onChange={(e) => setHeroName(e.target.value)} />
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
        <button type="submit" disabled={loading}>
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
