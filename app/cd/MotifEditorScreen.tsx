"use client";
import styles from "./MotifEditorScreen.module.css";
import Icon from "./Icon";

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
  placeholder = "O čem by pohádka měla být? Popiš svět, postavy, dobrodružství…",
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
            <Icon name="back-chevron" size={22} />
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
              <Icon name="sparkle" size={15} />
            </span>
            Vymysli námět
          </button>
          <button className={styles.secondaryBtn} onClick={onExpand}>
            <span className={styles.discIcon}>
              <Icon name="wand" size={15} />
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
