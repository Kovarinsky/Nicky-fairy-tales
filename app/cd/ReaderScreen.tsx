"use client";
import { useEffect, useRef, useState } from "react";
import styles from "./ReaderScreen.module.css";
import Icon from "./Icon";

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
  includeOutro = false,
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
  /** Include the end/outro as the last scrubber position. */
  includeOutro?: boolean;
  wordIntervalMs?: number;
}) {
  const [localPlaying, setLocalPlaying] = useState(false);
  const isPlaying = playing ?? localPlaying;
  const [uiVisible, setUiVisible] = useState(false);
  const [sentIdx, setSentIdx] = useState(0);
  const [wordIdx, setWordIdx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const captionRef = useRef<HTMLDivElement | null>(null);
  const activeWordRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    setSentIdx(0);
    setWordIdx(0);
  }, [sentences]);

  useEffect(() => {
    if (isPlaying) setUiVisible(false);
  }, [isPlaying]);

  useEffect(() => {
    const strip = captionRef.current;
    const activeWord = activeWordRef.current;
    if (!strip || !activeWord) return;
    const target = activeWord.offsetLeft + activeWord.offsetWidth / 2 - strip.clientWidth / 2;
    strip.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [sentIdx, wordIdx]);

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
    return () => { if (timer.current !== null) clearTimeout(timer.current); };
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

      <div ref={captionRef} className={styles.caption} style={{ bottom: uiVisible ? 130 : 18 }}>
        <p className={styles.captionText}>
          {words.map((w, i) => (
            <span ref={i === wordIdx ? activeWordRef : undefined} key={i} className={!isPlaying || i < wordIdx ? styles.wordRead : i === wordIdx ? styles.wordActive : styles.wordPending}>
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
                <Icon name="chevron-left" size={20} />
              </button>
              <button className={styles.playBtn} onClick={togglePlay} aria-label="Přehrát / pozastavit">
                <Icon name={isPlaying ? "pause" : "play"} size={22} />
              </button>
              <button
                className={styles.navBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  onNextPage?.();
                }}
                aria-label="Další strana"
              >
                <Icon name="chevron-right" size={20} />
              </button>
            </div>
            <div className={styles.scrubRow}>
              <input
                className={styles.range}
                type="range"
                min={1}
                max={pageCount + (includeOutro ? 1 : 0)}
                value={page}
                onChange={(e) => {
                  const target = +e.target.value;
                  if (includeOutro && target > pageCount) onNextPage?.();
                  else onPageChange?.(target);
                }}
                aria-label="Strana pohádky"
              />
              <span className={styles.pageLabel}>
                {page} / {pageCount + (includeOutro ? 1 : 0)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
