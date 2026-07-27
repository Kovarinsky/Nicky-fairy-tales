"use client";
import { useState } from "react";
import styles from "./StoryCatalogScreen.module.css";

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
}

export default function StoryCatalogScreen({
  backgroundImage = "/images/bg-zrozeni.jpg",
  stories,
  onBack,
  onPick,
}: {
  backgroundImage?: string;
  stories: CatalogStory[];
  onBack?: () => void;
  onPick?: (story: CatalogStory) => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("Vše");
  const [detailId, setDetailId] = useState<string | null>(null);
  const groups = ["Vše", ...Array.from(new Set(stories.map((s) => s.group)))];
  const q = query.trim().toLowerCase();
  const filtered = stories.filter((s) => (tab === "Vše" || s.group === tab) && (!q || s.name.toLowerCase().includes(q)));
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
          ‹
        </button>
        <h1 className={styles.title}>Výběr pohádky</h1>
        <div className={styles.stepLabel}>VŠECHNY POHÁDKY · {stories.length}</div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.stack}>
          <input className={styles.searchInput} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hledat pohádku…" />
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
          <div className={styles.detailBg} style={{ backgroundImage: `url(${detail.bigImage ?? detail.image})` }} />
          <div className={styles.detailScrim} />
          <div className={styles.detailHeader}>
            <button className={styles.detailBack} onClick={() => setDetailId(null)} aria-label="Zpět">
              ‹
            </button>
            <span className={styles.detailGroup}>{detail.group.toUpperCase()}</span>
          </div>
          <button className={styles.navLeft} onClick={() => step(-1)} aria-label="Předchozí pohádka">
            ‹
          </button>
          <button className={styles.navRight} onClick={() => step(1)} aria-label="Další pohádka">
            ›
          </button>
          <div className={styles.detailCardWrap}>
            <div className={styles.detailCard}>
              <h2 className={styles.detailName}>{detail.name}</h2>
              {detail.description && <p className={styles.detailDesc}>{detail.description}</p>}
            </div>
            <button className={styles.cta} onClick={() => onPick?.(detail)}>
              Vybrat tuto pohádku
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
