"use client";
import styles from "./StoryEndScreen.module.css";

/**
 * Per product decision: content always fits one responsive box (no overflow off-screen),
 * no prev/next arrows, prominent orange close (×), bonus-song offer, then hands off to
 * BonusSongScreen. Reuses the story's last illustration as background (see decision #4
 * in MASTER-SPEC-vFinal2.md — no separate goodnight-image generation in v1).
 */
export default function StoryEndScreen({
  backgroundImage,
  onClose,
  onPlayBonusSong,
  onReread,
  onBackToLibrary,
  hasBonusSong = true,
}: {
  backgroundImage: string;
  onClose?: () => void;
  onPlayBonusSong?: () => void;
  onReread?: () => void;
  onBackToLibrary?: () => void;
  hasBonusSong?: boolean;
}) {
  return (
    <main className={styles.screen} style={{ backgroundImage: `linear-gradient(0deg, rgba(20,10,5,.55), rgba(120,70,10,.35)), url(${backgroundImage})` }}>
      <button className={styles.closeBtn} onClick={onClose} aria-label="Zavřít">×</button>
      <div className={styles.card}>
        <div className={styles.sparkle}>✨</div>
        <h1 className={styles.title}>Konec</h1>
        {hasBonusSong && (
          <button className={styles.cta} onClick={onPlayBonusSong}>Poslechnout bonusovou písničku</button>
        )}
        <button className={styles.secondary} onClick={onReread}>Přečíst znovu</button>
        <button className={styles.textBtn} onClick={onBackToLibrary}>Zpět do knihovny</button>
      </div>
    </main>
  );
}
