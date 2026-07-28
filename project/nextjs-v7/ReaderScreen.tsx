"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./ReaderScreen.module.css";

/**
 * Nickyho pohádky — čtečka pohádky (reader / playback).
 * Background: /public/images/bg-blanket.jpg. Fonts: Alegreya 800, Nunito 600–800.
 */

export default function ReaderScreen({
  backgroundImage = "/images/bg-blanket.jpg",
  sentences,
  playing,
  onPlayToggle,
  page,
  pageCount,
  onPageChange,
  onPrevPage,
  onNextPage,
  wordIntervalMs = 340,
}: {
  backgroundImage?: string;
  /** Current page's story text, split into sentences (read one at a time, word-by-word). */
  sentences: string[];
  /** Controlled playback (e.g. tied to real TTS audio). Omit to let the reader drive its own demo timer. */
  playing?: boolean;
  onPlayToggle?: () => void;
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  onPrevPage?: () => void;
  onNextPage?: () => void;
  wordIntervalMs?: number;
}) {
  const [localPlaying, setLocalPlaying] = useState(false);
  const isPlaying = playing ?? localPlaying;
  const [uiVisible, setUiVisible] = useState(true);
  const [sentIdx, setSentIdx] = useState(0);
  const [wordIdx, setWordIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setSentIdx(0);
    setWordIdx(0);
  }, [sentences]);

  useEffect(() => {
    function loop() {
      timer.current = setTimeout(() => {
        if (isPlaying && sentences.length) {
          setWordIdx((wi) => {
            const words = (sentences[sentIdx] ?? "").split(" ").length;
            if (wi < words) return wi + 1;
            setSentIdx((s) => (s + 1) % sentences.length);
            return 0;
          });
        }
        loop();
      }, wordIntervalMs);
    }
    loop();
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, sentIdx, sentences, wordIntervalMs]);

  const words = (sentences[sentIdx] ?? "").split(" ");

  function toggleUi() {
    setUiVisible((v) => !v);
  }
  function stop(e: React.MouseEvent) {
    e.stopPropagation();
  }
  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();
    if (playing === undefined) setLocalPlaying((p) => !p);
    onPlayToggle?.();
  }

  return (
    <main className={styles.screen} onClick={toggleUi}>
      <img className={styles.bg} src={backgroundImage} alt="" aria-hidden draggable={false} />
      <div className={styles.bottomFade} aria-hidden />

      <div className={styles.caption} style={{ bottom: uiVisible ? 130 : 34 }}>
        <p className={styles.captionText}>
          {words.map((w, i) => (
            <span key={i} className={!isPlaying || i < wordIdx ? styles.wordRead : i === wordIdx ? styles.wordActive : styles.wordPending}>
              {w}{" "}
            </span>
          ))}
        </p>
      </div>

      <div className={styles.panel} style={{ opacity: uiVisible ? 1 : 0, pointerEvents: uiVisible ? "auto" : "none" }}>
        <div className={styles.panelFade}>
          <div className={styles.controls} onClick={stop}>
            <div className={styles.transport}>
              <button
                className={styles.navBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onPrevPage?.();
                }}
                aria-label="Předchozí strana"
              >
                <ChevronIcon dir="l" />
              </button>
              <button className={styles.playBtn} onClick={togglePlay} aria-label="Přehrát / pozastavit">
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </button>
              <button
                className={styles.navBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onNextPage?.();
                }}
                aria-label="Další strana"
              >
                <ChevronIcon dir="r" />
              </button>
            </div>
            <div className={styles.scrubRow}>
              <input
                className={styles.range}
                type="range"
                min={0}
                max={pageCount}
                value={page}
                onChange={(e) => onPageChange?.(+e.target.value)}
                aria-label="Strana pohádky"
              />
              <span className={styles.pageLabel}>
                {page} / {pageCount}
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function ChevronIcon({ dir }: { dir: "l" | "r" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" style={{ marginLeft: 3 }} aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#fff" aria-hidden>
      <rect x="6" y="4" width="4" height="16" rx="1.5" />
      <rect x="14" y="4" width="4" height="16" rx="1.5" />
    </svg>
  );
}
