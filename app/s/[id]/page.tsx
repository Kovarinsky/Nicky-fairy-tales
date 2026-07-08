"use client";

// 📤 Sdílená pohádka — jednoduchá přehrávací stránka pro příjemce odkazu.
// Bez instalace: obrázek, text a namluvené audio, listování šipkami,
// auto-přechod na další stránku po dohrání zvuku.

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";

interface SharedScene { narration: string; imageUrl: string; audioUrl: string }
interface SharedStory { title: string; createdAt: string; scenes: SharedScene[] }

export default function SharedStoryPage() {
  const { id } = useParams<{ id: string }>();
  const [story, setStory] = useState<SharedStory | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
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

  const scene = story?.scenes[page];

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

  function go(delta: number) {
    if (!story) return;
    const next = page + delta;
    if (next < 0 || next >= story.scenes.length) return;
    setPage(next);
  }

  function onEnded() {
    setIsPlaying(false);
    if (story && page < story.scenes.length - 1) setPage(page + 1);
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
            ? <img className="share-img" src={scene.imageUrl} alt={`Stránka ${page + 1}`} />
            : <div className="share-img share-img-empty">🖼️</div>}
          <p className="share-text">{scene.narration}</p>
          <div className="share-controls">
            <button type="button" className="share-btn" onClick={() => go(-1)} disabled={page === 0} aria-label="Předchozí">←</button>
            <button type="button" className="share-btn share-play" onClick={togglePlay} disabled={!scene.audioUrl}>
              {isPlaying ? "⏸\uFE0E" : "▶\uFE0E"}
            </button>
            <span className="share-pagenum">{page + 1} / {story.scenes.length}</span>
            <button type="button" className="share-btn" onClick={() => go(1)} disabled={page >= story.scenes.length - 1} aria-label="Další">→</button>
          </div>
          <p className="share-footer">✨ Vytvořeno v appce Nickyho pohádky</p>
        </div>
      )}
    </main>
  );
}
