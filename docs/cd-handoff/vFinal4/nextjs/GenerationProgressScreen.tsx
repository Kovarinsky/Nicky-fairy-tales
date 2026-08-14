"use client";
import styles from "./GenerationProgressScreen.module.css";

/**
 * Nickyho pohádky — story generation loading screen (spec §11-13 in MASTER-SPEC-vFinal2.md).
 * Fonts: Alegreya 800, Nunito 600–800. Ceiling: 300s: 0-90s script, 90-240s illustrations, 240-300s narration.
 */

export type GenStep = 1 | 2 | 3;

const STEP_COPY: Record<GenStep, { title: string; subs: string[] }> = {
  1: { title: "Píšu scénář…", subs: ["Vymýšlím, co se stane na první stránce…", "Nicolásek si už obouvá botičky…"] },
  2: { title: "Kreslím ilustrace…", subs: ["Míchám barvy pro kouzelný les…", "Ještě chvilku, obrázky se malují…"] },
  3: { title: "Namlouvám vypravěče…", subs: ["Hlas už zkouší první větu…"] },
};

export default function GenerationProgressScreen({
  step,
  subIndex = 0,
  onCancel,
  cancelConfirmOpen = false,
  onConfirmCancel,
  onKeepWaiting,
  error,
  onRetry,
  onBackToEdit,
  reducedMotion = false,
}: {
  step: GenStep;
  subIndex?: number;
  onCancel?: () => void;
  cancelConfirmOpen?: boolean;
  onConfirmCancel?: () => void;
  onKeepWaiting?: () => void;
  error?: { message?: string } | null;
  onRetry?: () => void;
  onBackToEdit?: () => void;
  reducedMotion?: boolean;
}) {
  if (error) {
    return (
      <main className={styles.screen}>
        <div className={styles.icon}>🕯️</div>
        <h1 className={styles.title}>Něco se nepovedlo</h1>
        <p className={styles.body}>{error.message ?? "Zkuste to prosím znovu."}</p>
        <p className={styles.bodyMuted}>Nic jsme vám nestrhli.</p>
        <div className={styles.actions}>
          <button className={styles.cta} onClick={onRetry}>Zkusit znovu</button>
          <button className={styles.textBtn} onClick={onBackToEdit}>Zpět na úpravu pohádky</button>
        </div>
      </main>
    );
  }

  const copy = STEP_COPY[step];
  return (
    <main className={styles.screen}>
      <div className={reducedMotion ? styles.spinnerStatic : styles.spinner} />
      <h1 className={styles.title}>{copy.title}</h1>
      <p className={styles.body}>{copy.subs[subIndex % copy.subs.length]}</p>
      <div className={styles.progressRow}>
        {[1, 2, 3].map((n) => (
          <div key={n} className={n <= step ? styles.progressSegOn : styles.progressSeg} />
        ))}
      </div>
      <button className={styles.textBtn} onClick={onCancel}>Zrušit</button>

      {cancelConfirmOpen && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmScrim} onClick={onKeepWaiting} />
          <div className={styles.confirmCard}>
            <h2 className={styles.confirmTitle}>Opravdu chcete generování zrušit?</h2>
            <p className={styles.body}>Rozpracovaná pohádka zůstane uložená, budete moci pokračovat později.</p>
            <button className={styles.dangerBtn} onClick={onConfirmCancel}>Zrušit generování</button>
            <button className={styles.cta} onClick={onKeepWaiting}>Pokračovat v čekání</button>
          </div>
        </div>
      )}
    </main>
  );
}
