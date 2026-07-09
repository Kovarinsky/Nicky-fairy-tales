"use client";

// 📤 Sdílená pohádka — jednoduchá přehrávací stránka pro příjemce odkazu.
// Bez instalace: obrázek, text a namluvené audio, listování šipkami,
// auto-přechod na další stránku po dohrání zvuku. Umí i pohádku se
// dvěma konci (🔀 choice) — po společném ději se objeví výběr.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

interface SharedScene { narration: string; imageUrl: string; audioUrl: string }
interface SharedStory {
  title: string;
  createdAt: string;
  scenes: SharedScene[];
  choice?: { common: number; altFrom: number; options: [string, string] };
}

export default function SharedStoryPage() {
  const { id } = useParams<{ id: string }>();
  const [story, setStory] = useState<SharedStory | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const [branch, setBranch] = useState<"A" | "B" | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isAutoRef = useRef(false); // po prvním ručním ▶ přehrává další stránky sám

  useEffect(() => {
    if (!id) return;
    fetch(`/api/share?id=${encodeURIComponent(id)}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d?.error || "Pohádku se nepodařilo načíst.");
        setStory(d as SharedStory);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Pohádku se nepodařilo načíst."));
  }, [id]);

  // 🔀 Viditelné stránky podle zvolené větve
  const visible = useMemo(() => {
    if (!story) return [] as number[];
    const all = story.scenes.map((_, i) => i);
    const c = story.choice;
    if (!c) return all;
    if (branch === "A") return all.slice(0, c.altFrom);
    if (branch === "B") return [...all.slice(0, c.common), ...all.slice(c.altFrom)];
    return all.slice(0, c.common);
  }, [story, branch]);
  const pos = Math.max(0, visible.indexOf(page));
  const nextIdx = pos + 1 < visible.length ? visible[pos + 1] : null;
  const prevIdx = pos > 0 ? visible[pos - 1] : null;
  const scene = story?.scenes[page];
  const choicePending = !!story?.choice && branch === null && page === story.choice.common - 1;

  // Přehrát aktuální stránku; po dohrání sám otočí na další
  useEffect(() => {
    const a = audioRef.current;
    if (!a || !scene) return;
    a.pause();
    setIsPlaying(false);
    if (!scene.audioUrl) return;
    a.src = scene.audioUrl;
    if (isAutoRef.current) {
      a.play().then(() => setIsPlaying(true)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, story]);

  function togglePlay() {
    const a = audioRef.current;
    if (!a || !scene?.audioUrl) return;
    if (isPlaying) {
      a.pause();
      setIsPlaying(false);
      isAutoRef.current = false;
    } else {
      isAutoRef.current = true;
      a.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  }

  function go(idx: number | null) {
    if (idx === null) return;
    setPage(idx);
  }

  function pick(b: "A" | "B") {
    if (!story?.choice) return;
    setBranch(b);
    isAutoRef.current = true;
    setPage(b === "A" ? story.choice.common : story.choice.altFrom);
  }

  function onEnded() {
    setIsPlaying(false);
    if (choicePending) return; // čeká se na výběr konce
    if (nextIdx !== null) setPage(nextIdx);
    else isAutoRef.current = false;
  }

  return (
    <main className="share-main">
      <audio ref={audioRef} onEnded={onEnded} />
      {error && (
        <div className="share-card">
          <h1 className="share-title">📖 Nickyho pohádky</h1>
          <p className="share-error">{error}</p>
        </div>
      )}
      {!error && !story && (
        <div className="share-card"><p className="share-loading">⏳ Načítám pohádku…</p></div>
      )}
      {story && scene && (
        <div className="share-card">
          <h1 className="share-title">{story.title}</h1>
          {scene.imageUrl
            ? <img className="share-img" src={scene.imageUrl} alt={`Stránka ${pos + 1}`} />
            : <div className="share-img share-img-empty">🖼️</div>}
          <p className="share-text">{scene.narration}</p>
          {choicePending && !isPlaying ? (
            <div className="choice-cards" style={{ margin: "0.4rem 0 0.6rem" }}>
              {(["A", "B"] as const).map((b, bi) => {
                const idx = b === "A" ? story.choice!.common : story.choice!.altFrom;
                const img = story.scenes[idx]?.imageUrl;
                return (
                  <button key={b} type="button" className="choice-card" onClick={() => pick(b)}>
                    {img
                      ? <img src={img} alt={story.choice!.options[bi]} />
                      : <span className="choice-card-emoji">{bi === 0 ? "🌟" : "🌙"}</span>}
                    <span className="choice-card-label">{bi === 0 ? "1️⃣" : "2️⃣"} {story.choice!.options[bi]}</span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="share-controls">
              <button type="button" className="share-btn" onClick={() => go(prevIdx)} disabled={prevIdx === null} aria-label="Předchozí">←</button>
              <button type="button" className="share-btn share-play" onClick={togglePlay} disabled={!scene.audioUrl}>
                {isPlaying ? "⏸︎" : "▶︎"}
              </button>
              <span className="share-pagenum">{pos + 1} / {visible.length}{story.choice && branch === null ? "+" : ""}</span>
              <button type="button" className="share-btn" onClick={() => go(nextIdx)} disabled={nextIdx === null} aria-label="Další">→</button>
            </div>
          )}
          <p className="share-footer">✨ Vytvořeno v appce Nickyho pohádky</p>
        </div>
      )}
    </main>
  );
}
