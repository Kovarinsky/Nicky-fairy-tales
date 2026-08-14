"use client";
import { useState } from "react";
import styles from "./StoryCatalogScreen.module.css";
import Icon from "./Icon";

/**
 * Nickyho pohádky — Výběr pohádky: katalog / vyhledávání + detail.
 * Background: /public/images/bg-zrozeni.jpg. Fonts: Alegreya 800, Nunito 600–800.
 */

export interface CatalogStory {
  id: string;
  name: string;
  group: string;
  image: string;
  bigImage?: string;
  description?: string;
  minAge?: number;
  maxAge?: number;
  supportsOriginal?: boolean;
}

export default function StoryCatalogScreen({
  backgroundImage = "/images/bg-zrozeni.jpg",
  stories,
  childAgeNumber,
  onBack,
  onPick,
  onPickOriginal,
}: {
  backgroundImage?: string;
  stories: CatalogStory[];
  /** Representative age number derived from the account's age band (2–4→3, 5–7→6, 8–10→9, 11+→12). Omit to hide the age filter entirely. */
  childAgeNumber?: number;
  onBack?: () => void;
  onPick?: (story: CatalogStory) => void;
  /** Classic-tale-only secondary action: generate with the tale's traditional cast instead of the family's characters. */
  onPickOriginal?: (story: CatalogStory) => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("Vše");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [ageFilterOn, setAgeFilterOn] = useState(childAgeNumber != null);
  const groups = ["Vše", ...Array.from(new Set(stories.map((s) => s.group)))];
  const q = query.trim().toLowerCase();
  const ageOk = (s: CatalogStory) => !ageFilterOn || childAgeNumber == null || ((s.minAge ?? 0) <= childAgeNumber && childAgeNumber <= (s.maxAge ?? 99));
  const filtered = stories.filter((s) => (tab === "Vše" || s.group === tab) && (!q || s.name.toLowerCase().includes(q)) && ageOk(s));
  const detail = stories.find((s) => s.id === detailId) ?? null;

  function step(dir: 1 | -1) {
    const i = filtered.findIndex((s) => s.id === detailId);
    if (i >= 0) setDetailId(filtered[(i + dir + filtered.length) % filtered.length].id);
  }

  return (
    <main className={styles.screen}>
      <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">
          <Icon name="back-chevron" size={22} />
        </button>
        <h1 className={styles.title}>Výběr pohádky</h1>
        <div className={styles.stepLabel}>VŠECHNY POHÁDKY · {stories.length}</div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.stack}>
          <input className={styles.searchInput} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat pohádku…" />
          {childAgeNumber != null && (
            <button className={styles.ageToggle} onClick={() => setAgeFilterOn((v) => !v)}>
              {ageFilterOn ? `Podle věku (${childAgeNumber} let)` : "Zobrazit vše"}
            </button>
          )}
          <div className={styles.tabs}>
            {groups.map((g) => (
              <button key={g} className={tab === g ? styles.tabOn : styles.tabOff} onClick={() => setTab(g)}>
                {g}
              </button>
            ))}
          </div>
          <div className={styles.grid}>
            {filtered.map((s) => (
              <button
                key={s.id}
                className={styles.gridTile}
                style={{ backgroundImage: `linear-gradient(180deg,rgba(16,8,36,0) 40%,rgba(16,8,36,.84)),url(${s.image})` }}
                onClick={() => setDetailId(s.id)}
              >
                <span className={styles.gridTileLabel}>{s.name}</span>
              </button>
            ))}
          </div>
          <div className={styles.count}>
            {filtered.length} {filtered.length === 1 ? "pohádka" : filtered.length < 5 ? "pohádky" : "pohádek"}
          </div>
        </div>
      </div>

      {detail && (
        <div className={styles.detailOverlay}>
          <div className={styles.detailImageBand}>
            <div className={styles.detailBg} style={{ backgroundImage: `url(${detail.bigImage ?? detail.image})` }} />
            <div className={styles.detailTopScrim} />
            <div className={styles.detailBottomScrim} />
            <div className={styles.detailHeader}>
              <button className={styles.detailBack} onClick={() => setDetailId(null)} aria-label="Zpět">
                <Icon name="chevron-left" size={22} />
              </button>
              <span className={styles.detailGroup}>{detail.group.toUpperCase()}</span>
            </div>
            <button className={styles.navLeft} onClick={() => step(-1)} aria-label="Předchozí pohádka">
              <Icon name="chevron-left" size={22} />
            </button>
            <button className={styles.navRight} onClick={() => step(1)} aria-label="Další pohádka">
              <Icon name="chevron-right" size={22} />
            </button>
          </div>
          <div className={styles.detailCardWrap}>
            <div className={styles.detailCard}>
              <h2 className={styles.detailName}>{detail.name}</h2>
              {detail.description && <p className={styles.detailDesc}>{detail.description}</p>}
            </div>
            <button className={styles.cta} onClick={() => onPick?.(detail)}>
              Vybrat tuto pohádku
            </button>
            {detail.supportsOriginal && (
              <button className={styles.ctaSecondary} onClick={() => onPickOriginal?.(detail)}>
                Poslechnout v originále
              </button>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
