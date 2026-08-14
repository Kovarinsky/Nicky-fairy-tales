"use client";
import { useState } from "react";
import styles from "./CreateWorldScreen.module.css";
import Icon from "./Icon";

/**
 * Nickyho pohádky — Vytvořit vlastní pohádku (custom world sheet).
 * Background: /public/images/bg-motiv.jpg. Fonts: Alegreya 800, Nunito 600–800.
 */

export default function CreateWorldScreen({
  backgroundImage = "/images/bg-motiv.jpg",
  name,
  onNameChange,
  description,
  onDescriptionChange,
  photos,
  onAddPhoto,
  onRemovePhoto,
  maxPhotos = 5,
  link,
  onLinkChange,
  onStudy,
  studyNote,
  onBack,
  onSave,
  onCancel,
}: {
  backgroundImage?: string;
  name: string;
  onNameChange?: (v: string) => void;
  description: string;
  onDescriptionChange?: (v: string) => void;
  photos: string[];
  onAddPhoto?: () => void;
  onRemovePhoto?: (index: number) => void;
  maxPhotos?: number;
  link: string;
  onLinkChange?: (v: string) => void;
  onStudy?: (description: string) => Promise<string> | string | void;
  studyNote?: string | null;
  onBack?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
}) {
  const [linkOpen, setLinkOpen] = useState(!!link);
  const [descEditorOpen, setDescEditorOpen] = useState(false);
  const [studying, setStudying] = useState(false);
  const [note, setNote] = useState<string | null>(studyNote ?? null);

  async function handleStudy() {
    if (!onStudy) return;
    setStudying(true);
    const result = await onStudy(description);
    setNote(typeof result === "string" ? result : "Svět nastudován.");
    setStudying(false);
  }

  return (
    <div className={styles.screen}>
      <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} aria-hidden />

      <div className={styles.headerRow}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">
          <Icon name="back-chevron" size={22} />
        </button>
        <div className={styles.title}>Vytvořit vlastní pohádku</div>
      </div>

      <div className={styles.scroll}>
        <section className={styles.card}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>NÁZEV SVĚTA</span>
            <input className={styles.input} value={name} onChange={(e) => onNameChange?.(e.target.value)} placeholder="Pojmenuj svůj svět…" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>POPIS SVĚTA</span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={description}
              onChange={(e) => onDescriptionChange?.(e.target.value)}
              onClick={() => setDescEditorOpen(true)}
              placeholder="Jak svět vypadá, kdo v něm žije, co se v něm děje…"
            />
          </label>
        </section>

        <section className={styles.card}>
          <span className={styles.fieldLabel}>FOTKY ({photos.length} / {maxPhotos})</span>
          {photos.length > 0 ? (
            <div className={styles.photoGrid}>
              {photos.map((src, i) => (
                <div key={i} className={styles.photoThumb} style={{ backgroundImage: `url(${src})` }}>
                  <button className={styles.photoDelete} onClick={() => onRemovePhoto?.(i)} aria-label="Smazat fotku">
                    <Icon name="close-x" size={18} />
                  </button>
                </div>
              ))}
              {photos.length < maxPhotos && (
                <button className={styles.photoAdd} onClick={onAddPhoto} aria-label="Přidat fotku">
                  <Icon name="plus" size={20} />
                </button>
              )}
            </div>
          ) : (
            <div className={styles.photoGrid}>
              {Array.from({ length: maxPhotos }).map((_, i) => (
                <button key={i} className={styles.photoSlot} onClick={onAddPhoto}>
                  {i + 1}
                </button>
              ))}
            </div>
          )}
          <div className={styles.divider} />
          <div className={styles.row2}>
            <button className={linkOpen ? styles.secondaryBtnOn : styles.secondaryBtn} onClick={() => setLinkOpen((v) => !v)}>
              <span className={styles.discIcon}>
                <Icon name="link" size={14} />
              </span>
              Odkaz
            </button>
            {onStudy && (
              <button className={styles.secondaryBtn} onClick={handleStudy} disabled={studying}>
                <span className={styles.discIcon}>
                  <Icon name="research" size={14} />
                </span>
                {studying ? "Studuji…" : "Prostudovat"}
              </button>
            )}
          </div>
          {linkOpen && <input className={styles.input} value={link} onChange={(e) => onLinkChange?.(e.target.value)} placeholder="https://…" />}
          {note && <div className={styles.note}>{note}</div>}
        </section>
      </div>

      <div className={styles.footer}>
        <button className={styles.cta} onClick={onSave}>
          Uložit svět
        </button>
        <button className={styles.cancelBtn} onClick={onCancel}>
          Zrušit
        </button>
      </div>

      {descEditorOpen && (
        <div className={styles.editorOverlay}>
          <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
          <div className={styles.editorScrim} />
          <div className={styles.editorBody}>
            <div className={styles.headerRow}>
              <button className={styles.backBtn} onClick={() => setDescEditorOpen(false)} aria-label="Zpět">
                <Icon name="back-chevron" size={22} />
              </button>
              <div className={styles.title}>Popis světa</div>
            </div>
            <textarea
              className={styles.bigTextarea}
              autoFocus
              value={description}
              onChange={(e) => onDescriptionChange?.(e.target.value)}
              placeholder="Jak svět vypadá, kdo v něm žije, jaká tam platí pravidla…"
            />
            <button className={styles.cta} onClick={() => setDescEditorOpen(false)}>
              Hotovo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
