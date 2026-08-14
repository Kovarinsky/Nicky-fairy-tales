"use client";
import { useState } from "react";
import styles from "./StoryWorldStep.module.css";
import Icon from "./Icon";

/**
 * Nickyho pohádky — Výběr pohádky, krok 1/2 (Svět).
 * Background: /public/images/bg-zrozeni.jpg (or your own). Fonts: Alegreya 800, Nunito 600–800.
 */

export interface WorldTile {
  id: string;
  name: string;
  image?: string;
  minAge?: number;
  maxAge?: number;
}

export default function StoryWorldStep({
  backgroundImage = "/images/bg-zrozeni.jpg",
  readyWorlds,
  ownWorlds,
  selectedId,
  onSelect,
  onOpenCatalog,
  onCreateNew,
  localEnabled = false,
  onToggleLocal,
  childAgeNumber,
  onBack,
  onContinue,
  mobilePreview = false,
}: {
  backgroundImage?: string;
  readyWorlds: WorldTile[];
  ownWorlds: WorldTile[];
  selectedId?: string;
  onSelect?: (id: string) => void;
  onOpenCatalog?: () => void;
  onCreateNew?: () => void;
  localEnabled?: boolean;
  onToggleLocal?: () => void;
  /** Representative age from the account's age band; omit to hide the age filter. */
  childAgeNumber?: number;
  onBack?: () => void;
  onContinue?: () => void;
  mobilePreview?: boolean;
}) {
  const [ageFilterOn, setAgeFilterOn] = useState(childAgeNumber != null);
  const ageOk = (w: WorldTile) => !ageFilterOn || childAgeNumber == null || w.minAge == null || ((w.minAge ?? 0) <= childAgeNumber && childAgeNumber <= (w.maxAge ?? 99));
  const visibleReady = readyWorlds.filter(ageOk);
  return (
    <main className={`${styles.screen} ${mobilePreview ? styles.mobilePreview : ""}`}>
      <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">
          <Icon name="back-chevron" size={22} />
        </button>
        <h1 className={styles.title}>Výběr pohádky</h1>
        <div className={styles.stepLabel}>KROK 1 ZE 2 · SVĚT</div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.stack}>
          <section className={styles.card}>
            <div className={styles.cardLabel}>PŘIPRAVENÉ POHÁDKY</div>
            {childAgeNumber != null && (
              <button className={styles.ageToggle} onClick={() => setAgeFilterOn((v) => !v)}>
                {ageFilterOn ? `Podle věku (${childAgeNumber} let)` : "Zobrazit vše"}
              </button>
            )}
            <div className={styles.roller}>
              <button className={styles.tileAll} onClick={onOpenCatalog}>
                <span className={styles.pulseBadge}>+</span>
                <span className={styles.tileLabel}>Všechny pohádky</span>
              </button>
              {visibleReady.map((w) => (
                <button
                  key={w.id}
                  className={selectedId === w.id ? styles.tileActive : styles.tile}
                  style={w.image ? { backgroundImage: `linear-gradient(180deg,rgba(16,8,36,0) 44%,rgba(16,8,36,.8)),url(${w.image})` } : undefined}
                  onClick={() => onSelect?.(w.id)}
                >
                  <span className={styles.tileLabel}>{w.name}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardLabel}>VLASTNÍ POHÁDKY</div>
            <div className={styles.roller}>
              {ownWorlds.map((w) => (
                <button
                  key={w.id}
                  className={selectedId === w.id ? styles.tileActive : styles.tile}
                  style={w.image ? { backgroundImage: `linear-gradient(180deg,rgba(16,8,36,0) 44%,rgba(16,8,36,.8)),url(${w.image})` } : undefined}
                  onClick={() => onSelect?.(w.id)}
                >
                  <span className={styles.tileLabel}>{w.name}</span>
                </button>
              ))}
              <button className={styles.tileDashed} onClick={onCreateNew}>
                ＋<span className={styles.tileLabel}>Vlastní pohádka</span>
              </button>
            </div>
          </section>

          <section className={styles.card}>
            <button className={localEnabled ? styles.pillOn : styles.pillOff} onClick={onToggleLocal}>
              <span className={styles.discIcon}>
                <PinIcon />
              </span>
              <span>Pohádka podle mé polohy</span>
            </button>
            <div className={styles.hint}>
              {localEnabled
                ? "Pohádka se propojí s vaším okolím i s vybraným světem výše."
                : "Můžete zapnout i společně s vybraným světem — děj se pak odehraje ve vašem okolí."}
            </div>
          </section>
        </div>
      </div>

      <div className={styles.footer}>
        <button className={styles.cta} onClick={onContinue}>
          Pokračovat
        </button>
      </div>
    </main>
  );
}

function PinIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}
