"use client";
import { useState } from "react";
import styles from "./BonusSongScreen.module.css";

export default function BonusSongScreen({
  coverImage,
  title,
  status,
  progress = 0,
  onTogglePlay,
  onDone,
}: {
  coverImage: string;
  title: string;
  status: "loading" | "playing" | "paused" | "error";
  progress?: number;
  onTogglePlay?: () => void;
  onDone?: () => void;
}) {
  return (
    <main className={styles.screen}>
      {status === "loading" && (
        <>
          <div className={styles.spinner} />
          <h1 className={styles.title}>Skládám písničku…</h1>
        </>
      )}
      {status === "error" && (
        <>
          <div className={styles.icon}>🎵</div>
          <p className={styles.body}>Písnička teď není k dispozici</p>
          <button className={styles.textBtn} onClick={onDone}>Hotovo</button>
        </>
      )}
      {(status === "playing" || status === "paused") && (
        <>
          <div className={styles.cover} style={{ backgroundImage: `url(${coverImage})` }} />
          <h1 className={styles.title}>{title}</h1>
          <div className={styles.bars}>
            {[14, 24, 34, 24, 14].map((h, i) => (
              <span key={i} className={status === "playing" ? styles.barPlaying : styles.barPaused} style={{ height: h, animationDelay: `${i * 0.12}s` }} />
            ))}
          </div>
          <button className={styles.playBtn} onClick={onTogglePlay} aria-label="Přehrát / pozastavit">
            {status === "playing" ? "❚❚" : "►"}
          </button>
          <button className={styles.textBtn} onClick={onDone}>Hotovo</button>
        </>
      )}
    </main>
  );
}
