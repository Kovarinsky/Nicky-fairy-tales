"use client";
import styles from "./ShareSheet.module.css";

export interface ShareTarget {
  id: string;
  label: string;
  icon: string;
  loading?: boolean;
  hidden?: boolean;
}

export default function ShareSheet({
  open,
  targets,
  copied = false,
  onPick,
  onCancel,
}: {
  open: boolean;
  targets: ShareTarget[];
  copied?: boolean;
  onPick?: (id: string) => void;
  onCancel?: () => void;
}) {
  if (!open) return null;
  return (
    <div className={styles.overlay}>
      <div className={styles.scrim} onClick={onCancel} />
      <div className={styles.sheet}>
        <div className={styles.handle} />
        <h2 className={styles.title}>Sdílet pohádku</h2>
        {targets.filter((t) => !t.hidden).map((t) => (
          <button key={t.id} className={styles.item} onClick={() => onPick?.(t.id)} disabled={t.loading}>
            {t.loading ? <span className={styles.spinner} /> : <span>{t.icon}</span>}
            {t.label}
          </button>
        ))}
        {copied && <div className={styles.toast}>Odkaz zkopírován</div>}
        <button className={styles.textBtn} onClick={onCancel}>Zrušit</button>
      </div>
    </div>
  );
}
