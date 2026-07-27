"use client";
import { useState } from "react";
import styles from "./WorldsScreen.module.css";

/**
 * Nickyho pohádky — world picker screen.
 * Drop /public/images/<world>.jpg illustrations (portrait, ~840×1410) per world.
 * Fonts (next/font or <link>): Alegreya 700–800, Nunito 600–800.
 */

export interface WorldItem {
  id: string;
  name: string;
  image?: string;
}

export default function WorldsScreen({
  backgroundImage = "/images/bg-tree.jpg",
  worlds,
  selectedId,
  onSelectId,
  onBack,
  onConfirm,
  onCreateWorld,
  onStudyWorld,
}: {
  backgroundImage?: string;
  worlds: WorldItem[];
  selectedId?: string;
  onSelectId?: (id: string) => void;
  onBack?: () => void;
  onConfirm?: (world: WorldItem) => void;
  onCreateWorld?: (data: { name: string; description: string }) => void;
  onStudyWorld?: (description: string) => Promise<string> | string | void;
}) {
  const [localIdx, setLocalIdx] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [studying, setStudying] = useState(false);

  const idx = selectedId
    ? Math.max(0, worlds.findIndex((w) => w.id === selectedId))
    : localIdx;
  const world = worlds[idx];
  const n = worlds.length;

  function setIdx(i: number) {
    if (n === 0) return;
    const wrapped = ((i % n) + n) % n;
    setLocalIdx(wrapped);
    onSelectId?.(worlds[wrapped].id);
  }

  async function handleStudy() {
    if (!onStudyWorld) return;
    setStudying(true);
    const result = await onStudyWorld(desc);
    setNote(typeof result === "string" ? result : "Svět nastudován.");
    setStudying(false);
  }

  function closeSheet() {
    setSheetOpen(false);
    setName("");
    setDesc("");
    setNote(null);
  }

  return (
    <main className={styles.screen}>
      <img className={styles.bg} src={backgroundImage} alt="" aria-hidden draggable={false} />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">
          ‹
        </button>
        <h1 className={styles.title}>Výběr světa</h1>
      </header>

      {world && (
        <section className={styles.carousel}>
          <button className={styles.navBtn} onClick={() => setIdx(idx - 1)} aria-label="Předchozí">
            <ChevronIcon dir="l" />
          </button>
          <div className={styles.card} style={{ background: world.image ? undefined : FALLBACK_GRADIENT }}>
            {world.image && <img className={styles.cardImg} src={world.image} alt="" />}
            <div className={styles.cardCaption}>
              <div className={styles.cardName}>{world.name}</div>
            </div>
          </div>
          <button className={styles.navBtn} onClick={() => setIdx(idx + 1)} aria-label="Další">
            <ChevronIcon dir="r" />
          </button>
        </section>
      )}

      <div className={styles.dots}>
        {worlds.map((w, j) => (
          <button
            key={w.id}
            className={j === idx ? styles.dotActive : styles.dot}
            aria-label={w.name}
            onClick={() => setIdx(j)}
          />
        ))}
      </div>

      <footer className={styles.footer}>
        <button className={styles.cta} onClick={() => world && onConfirm?.(world)}>
          Vybrat tento svět
        </button>
        <button className={styles.createLink} onClick={() => setSheetOpen(true)}>
          + Vytvořit vlastní svět
        </button>
      </footer>

      {sheetOpen && (
        <div className={styles.sheetOverlay}>
          <div className={styles.sheetBackdrop} onClick={closeSheet} />
          <div className={styles.sheet}>
            <div className={styles.sheetTitle}>Vlastní svět</div>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>NÁZEV SVĚTA *</span>
              <input
                className={styles.input}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="např. Babiččina chalupa, Vesmírná školka…"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>POPIS SVĚTA</span>
              <textarea
                className={styles.textarea}
                rows={4}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Jak svět vypadá, kdo v něm žije a co se v něm děje…"
              />
            </label>
            {onStudyWorld && (
              <button className={styles.secondaryBtn} onClick={handleStudy} disabled={studying}>
                🔮 {studying ? "Studuji…" : "Nastuduj svět"}
              </button>
            )}
            {note && <div className={styles.note}>✨ {note}</div>}
            <div className={styles.sheetActions}>
              <button
                className={styles.cta}
                onClick={() => {
                  if (name.trim()) onCreateWorld?.({ name: name.trim(), description: desc.trim() });
                  closeSheet();
                }}
              >
                Uložit svět
              </button>
              <button className={styles.cancelBtn} onClick={closeSheet}>
                Zrušit
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

const FALLBACK_GRADIENT = "linear-gradient(160deg,#5a4a7a,#2e2245)";

function ChevronIcon({ dir }: { dir: "l" | "r" }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={dir === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
