"use client";
import styles from "./MotifEditorScreen.module.css";

/**
 * Nickyho pohádky — Motiv pohádky (fullscreen text editor).
 * Background: /public/images/bg-motiv.jpg. Fonts: Alegreya 800, Nunito 600–800.
 */

export default function MotifEditorScreen({
  backgroundImage = "/images/bg-motiv.jpg",
  value,
  onChange,
  onGenerate,
  onExpand,
  onDone,
  placeholder = "O čem by pohádka měla být? Popiš svět, postavy, dobrodružství… ✏️",
}: {
  backgroundImage?: string;
  value: string;
  onChange?: (v: string) => void;
  /** "Vymysli námět" — ask the backend for a fresh motif suggestion. */
  onGenerate?: () => void;
  /** "Rozvinout" — ask the backend to expand the current text. */
  onExpand?: () => void;
  onDone?: () => void;
  placeholder?: string;
}) {
  return (
    <div className={styles.screen}>
      <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} aria-hidden />
      <div className={styles.body}>
        <div className={styles.headerRow}>
          <button className={styles.backBtn} onClick={onDone} aria-label="Zpět">
            ‹
          </button>
          <div className={styles.title}>Motiv pohádky</div>
        </div>
        <textarea
          className={styles.textarea}
          autoFocus
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          placeholder={placeholder}
        />
        <div className={styles.row}>
          <button className={styles.secondaryBtn} onClick={onGenerate}>
            <span className={styles.discIcon}>
              <SparkleIcon />
            </span>
            Vymysli námět
          </button>
          <button className={styles.secondaryBtn} onClick={onExpand}>
            <span className={styles.discIcon}>
              <WandIcon />
            </span>
            Rozvinout
          </button>
        </div>
        <button className={styles.cta} onClick={onDone}>
          Hotovo
        </button>
      </div>
    </div>
  );
}

function SparkleIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 3l1.8 4.9L18 9l-4.2 1.9L12 16l-1.8-5L6 9l4.2-1.1L12 3Z" />
    </svg>
  );
}
function WandIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 19L15 9" />
      <path d="M15.5 3.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </svg>
  );
}
