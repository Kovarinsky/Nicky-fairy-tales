"use client";
import { useState } from "react";
import styles from "./WorldsScreen.module.css";

/**
 * Nickyho pohádky — world picker screen.
 * Rozšířeno oproti CD návrhu o kategorie (skupiny světů) a správu vlastních
 * světů (editace/mazání) — appka tohle dřív měla ve dvou samostatných
 * panelech, nový design je slučuje do jednoho karuselu + sheetu.
 */

export interface WorldItem {
  id: string;
  name: string;
  image?: string;
  emoji?: string;
  /** Popisek skupiny nad názvem karty (např. "Svět", "Klasická pohádka", "Vlastní svět"). */
  group?: string;
  /** Vlastní (uživatelem vytvořený) svět — dostane v kartě i v sheetu tlačítka ✏️/×. */
  custom?: boolean;
  /** Jen u vlastních světů — pro předvyplnění při editaci. */
  description?: string;
}

export default function WorldsScreen({
  backgroundImage = "/images/bg-tree.jpg",
  worlds,
  selectedId,
  onSelectId,
  onBack,
  onConfirm,
  onCreateWorld,
  onEditWorld,
  onRemoveWorld,
  onStudyWorld,
}: {
  backgroundImage?: string;
  worlds: WorldItem[];
  selectedId?: string;
  onSelectId?: (id: string) => void;
  onBack?: () => void;
  onConfirm?: (world: WorldItem) => void;
  onCreateWorld?: (data: { name: string; description: string }) => void;
  onEditWorld?: (data: { id: string; name: string; description: string }) => void;
  onRemoveWorld?: (id: string) => void;
  onStudyWorld?: (description: string) => Promise<string> | string | void;
}) {
  const [localIdx, setLocalIdx] = useState(0);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
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
    // 🩺 Výsledek NAHRAZUJE popis (appka ho reálně rozšíří o nastudovaná
    // fakta), ne jen zobrazí jako oznámení — jinak by se nastudovaný text
    // nikam neuložil.
    if (typeof result === "string" && result.trim()) {
      setDesc(result);
      setNote("Svět nastudován ✨");
    } else {
      setNote("Svět nastudován.");
    }
    setStudying(false);
  }

  function openCreateSheet() {
    setEditingId(null);
    setName("");
    setDesc("");
    setNote(null);
    setSheetOpen(true);
  }

  function openEditSheet(w: WorldItem) {
    setEditingId(w.id);
    setName(w.name);
    setDesc(w.description || "");
    setNote(null);
    setSheetOpen(true);
  }

  function closeSheet() {
    setSheetOpen(false);
    setEditingId(null);
    setName("");
    setDesc("");
    setNote(null);
  }

  const customWorlds = worlds.filter((w) => w.custom);

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
              {world.group && <div className={styles.cardGroup}>{world.group}</div>}
              <div className={styles.cardName}>
                {world.emoji ? `${world.emoji} ` : ""}
                {world.name}
              </div>
            </div>
            {world.custom && (
              <button
                className={styles.cardEditBtn}
                aria-label="Upravit vlastní svět"
                onClick={(e) => {
                  e.stopPropagation();
                  openEditSheet(world);
                }}
              >
                ✏️
              </button>
            )}
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
        <button className={styles.createLink} onClick={openCreateSheet}>
          + Vytvořit vlastní svět
        </button>
      </footer>

      {sheetOpen && (
        <div className={styles.sheetOverlay}>
          <div className={styles.sheetBackdrop} onClick={closeSheet} />
          <div className={styles.sheet}>
            <div className={styles.sheetTitle}>{editingId ? "Upravit vlastní svět" : "Vlastní svět"}</div>

            {/* Seznam už uložených vlastních světů — jen v režimu založení
                nového (při editaci se rovnou skáče na formulář dole). */}
            {!editingId && customWorlds.length > 0 && (
              <div className={styles.customList}>
                {customWorlds.map((w) => (
                  <div key={w.id} className={styles.customRow}>
                    <span className={styles.customRowName}>🌍 {w.name}</span>
                    <button
                      className={styles.customRowBtn}
                      aria-label="Upravit"
                      onClick={() => openEditSheet(w)}
                    >
                      ✏️
                    </button>
                    <button
                      className={styles.customRowBtn}
                      aria-label="Smazat"
                      onClick={() => onRemoveWorld?.(w.id)}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

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
                  if (name.trim()) {
                    if (editingId) onEditWorld?.({ id: editingId, name: name.trim(), description: desc.trim() });
                    else onCreateWorld?.({ name: name.trim(), description: desc.trim() });
                  }
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
