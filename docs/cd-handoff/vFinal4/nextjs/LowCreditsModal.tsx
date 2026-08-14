"use client";
import styles from "./LowCreditsModal.module.css";

export default function LowCreditsModal({
  open,
  needed,
  have,
  onTopUp,
  onBack,
}: {
  open: boolean;
  needed: number;
  have: number;
  onTopUp?: () => void;
  onBack?: () => void;
}) {
  if (!open) return null;
  return (
    <div className={styles.overlay}>
      <div className={styles.scrim} onClick={onBack} />
      <div className={styles.card}>
        <div className={styles.icon}>🪙</div>
        <h2 className={styles.title}>Nedostatek kreditů</h2>
        <p className={styles.body}>Tato pohádka potřebuje {needed} kreditů, máte {have}.</p>
        <button className={styles.cta} onClick={onTopUp}>Dobít kredity</button>
        <button className={styles.textBtn} onClick={onBack}>Zpět</button>
      </div>
    </div>
  );
}
