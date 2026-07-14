"use client";

// 📤 Sdílená pohádka — jednoduchá přehrávací stránka pro příjemce odkazu.
// Bez instalace: obrázek, text a namluvené audio, listování šipkami,
// auto-přechod na další stránku po dohrání zvuku. Umí i pohádku se
// dvěma konci (🔀 choice) — po společném ději se objeví výběr.

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { cacheStory } from "@/lib/scene-cache";

interface SharedScene { narration: string; imageUrl: string; audioUrl: string }
interface SharedStory {
  title: string;
  createdAt: string;
  scenes: SharedScene[];
  choice?: { common: number; altFrom: number; options: [string, string] };
  /** ⏱ Délka přípravy (s) — ukáže se u pohádky v historii příjemce */
  prepSec?: number;
  writeSec?: number;
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

  // ⛶ Celá obrazovka: ▶ přehrání i otočení na šířku ji zapnou samy.
  // Maximalizované rozvržení řídí třída .share-max — platí i na šířku bez
  // fullscreen API (iOS Safari ho nemá), takže karta nikdy nepřeteče displej
  const mainRef = useRef<HTMLElement | null>(null);
  const [isFs, setIsFs] = useState(false);
  const [isLs, setIsLs] = useState(false);
  const [fsAvail, setFsAvail] = useState(false);
  useEffect(() => {
    setFsAvail(!!document.documentElement.requestFullscreen);
    const onFs = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    const mq = window.matchMedia("(orientation: landscape)");
    const onMq = () => setIsLs(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      mq.removeEventListener("change", onMq);
    };
  }, []);
  const shareMax = isFs || isLs;

  // 🎞️ Rolující titulky jako ve čtečce appky: v maximalizovaném režimu je
  // text jednořádkový a roluje bílým oknem — synchronně s hlasem, bez hlasu
  // stálou rychlostí
  const clipRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [rollTick, setRollTick] = useState(0);
  useEffect(() => {
    if (isPlaying) setRollTick(t => t + 1);
  }, [isPlaying]);

  // Titulkový pruh drží ŠÍŘKU OBRÁZKU (v max režimu je obrázek letterboxovaný
  // užší než karta — pruh přes celou kartu vypadal rozbitě)
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const img = imgRef.current;
    const iw = img?.getBoundingClientRect().width || 0;
    if (shareMax && iw > 0) {
      body.style.width = `${Math.round(iw)}px`;
      body.style.marginLeft = "auto";
      body.style.marginRight = "auto";
    } else {
      body.style.width = "";
      body.style.marginLeft = "";
      body.style.marginRight = "";
    }
  }, [shareMax, page, story, rollTick, isLs, isFs]);

  // 💾 Zaslaná pohádka se uloží do HISTORIE appky (localStorage + offline
  // cache médií) — příjemce ji pak najde v hlavním menu jako každou jinou
  useEffect(() => {
    if (!story || !id) return;
    try {
      const KEY = "nicky-story-history";
      const all = JSON.parse(localStorage.getItem(KEY) || "[]") as Array<{ id?: string; title?: string }>;
      if (!Array.isArray(all)) return;
      const hid = `shared-${id}`;
      // už uložená (nebo je to odesílatelova vlastní pohádka se stejným názvem) → nic
      if (all.some(e => e?.id === hid || e?.title === story.title)) return;
      all.unshift({
        id: hid,
        title: story.title,
        heroDescription: "",
        createdAt: story.createdAt || new Date().toISOString(),
        scenes: story.scenes.map((s, i) => ({ index: i + 1, narration: s.narration, imagePrompt: "" })),
        selectedIds: [],
        themeId: "",
        topic: "",
        ...(story.choice ? { choice: story.choice } : {}),
        ...(typeof story.prepSec === "number" ? { prepSec: story.prepSec } : {}),
        ...(typeof story.writeSec === "number" ? { writeSec: story.writeSec } : {}),
      } as never);
      localStorage.setItem(KEY, JSON.stringify(all.slice(0, 20)));
      cacheStory(hid, story.scenes.map((s, i) => ({
        index: i + 1, narration: s.narration, imagePrompt: "",
        imageUrl: s.imageUrl, audioUrl: s.audioUrl,
      }))).catch(() => {});
    } catch {}
  }, [story, id]);
  useEffect(() => {
    const clip = clipRef.current;
    if (!clip) return;
    clip.scrollLeft = 0;
    if (!shareMax) return;
    const overflow = clip.scrollWidth - clip.clientWidth;
    if (overflow <= 0) return;
    const a = audioRef.current;
    const DELAY_MS = 2200;
    const SPEED = 40; // px/s fallback bez hlasu
    const fallbackDur = (overflow / SPEED) * 1000;
    let raf = 0;
    const start = performance.now();
    const tick = (t: number) => {
      const dur = a && Number.isFinite(a.duration) ? a.duration : 0;
      const active = a && dur > 3 && (a.currentTime > 0.05 || !a.paused);
      const p = active
        ? Math.min(1, Math.max(0, (a!.currentTime - 1.2) / Math.max(1, dur - 3.2)))
        : Math.min(1, Math.max(0, (t - start - DELAY_MS) / fallbackDur));
      clip.scrollLeft = p * overflow;
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [page, branch, shareMax, rollTick, story]);

  function enterFs() {
    if (!document.fullscreenElement) mainRef.current?.requestFullscreen?.().catch(() => {});
  }
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else enterFs();
  }

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
      enterFs(); // ▶ rovnou do celé obrazovky — ťuknutí je platné gesto
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
    <main className={`share-main${shareMax ? " share-max" : ""}`} ref={mainRef}>
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
            ? <img className="share-img" src={scene.imageUrl} alt={`Stránka ${pos + 1}`}
                ref={imgRef} onLoad={() => setRollTick(t => t + 1)} />
            : <div className="share-img share-img-empty">🖼️</div>}
          {/* bílý titulkový pruh jako ve čtečce; v max režimu jednořádkový rolující */}
          <div className="share-body" ref={bodyRef}>
            <div className="share-clip" ref={clipRef}>
              <p className="share-text">{scene.narration}</p>
            </div>
          </div>
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
              {story.choice && branch !== null && (
                <button type="button" className="share-btn" aria-label="Zpět k rozbočce"
                  onClick={() => { audioRef.current?.pause(); setIsPlaying(false); isAutoRef.current = false; setBranch(null); setPage(story.choice!.common - 1); }}>
                  🔀
                </button>
              )}
              <button type="button" className="share-btn" onClick={() => go(prevIdx)} disabled={prevIdx === null} aria-label="Předchozí">←</button>
              <button type="button" className="share-btn share-play" onClick={togglePlay} disabled={!scene.audioUrl}>
                {isPlaying ? "⏸︎" : "▶︎"}
              </button>
              <span className="share-pagenum">{pos + 1} / {visible.length}{story.choice && branch === null ? "+" : ""}</span>
              <button type="button" className="share-btn" onClick={() => go(nextIdx)} disabled={nextIdx === null} aria-label="Další">→</button>
              {fsAvail && (
                <button type="button" className="share-btn" onClick={toggleFs}
                  aria-label={isFs ? "Ukončit celou obrazovku" : "Celá obrazovka"}>
                  {isFs ? "🗗" : "⛶"}
                </button>
              )}
              <button type="button" className="share-btn share-home" aria-label="Domů — hlavní menu"
                onClick={() => {
                  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
                  audioRef.current?.pause();
                  window.location.href = "/";
                }}>🏠</button>
            </div>
          )}
          <p className="share-footer">✨ Vytvořeno v appce Nickyho pohádky</p>
        </div>
      )}
    </main>
  );
}
