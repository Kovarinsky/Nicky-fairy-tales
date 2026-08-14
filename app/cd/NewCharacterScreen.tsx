"use client";
import { useState } from "react";
import styles from "./NewCharacterScreen.module.css";
import Icon from "./Icon";

/**
 * Nickyho pohádky — Nová postava (create) / Detail postavy (edit).
 * Background: /public/images/bg-motiv.jpg. Fonts: Alegreya 800, Nunito 600–800.
 */

export default function NewCharacterScreen({
  backgroundImage = "/images/bg-motiv.jpg",
  mode = "new",
  avatar,
  name,
  onNameChange,
  description,
  onDescriptionChange,
  subtitle,
  selected,
  onToggleSelected,
  photoCount = 0,
  maxPhotos = 5,
  onAddPhoto,
  onTakePhoto,
  onBack,
  onSave,
  onCancel,
}: {
  backgroundImage?: string;
  mode?: "new" | "edit";
  avatar?: string;
  name: string;
  onNameChange?: (v: string) => void;
  description: string;
  onDescriptionChange?: (v: string) => void;
  subtitle?: string;
  selected?: boolean;
  onToggleSelected?: () => void;
  photoCount?: number;
  maxPhotos?: number;
  onAddPhoto?: () => void;
  onTakePhoto?: () => void;
  onBack?: () => void;
  onSave?: () => void;
  onCancel?: () => void;
}) {
  const [descEditorOpen, setDescEditorOpen] = useState(false);
  const isEdit = mode === "edit";

  return (
    <div className={styles.screen}>
      <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} aria-hidden />

      <div className={styles.headerRow}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">
          <Icon name="back-chevron" size={22} />
        </button>
        {isEdit && (
          <span className={styles.avatar} style={{ backgroundImage: avatar ? `url(${avatar})` : undefined }} />
        )}
        {!isEdit && <span className={styles.avatarNew} />}
        <div className={styles.headerText}>
          <div className={styles.title}>{isEdit ? name : "Nová postava"}</div>
          <div className={styles.subtitle}>{isEdit ? subtitle : "Vlastní postava do pohádek"}</div>
        </div>
        {isEdit && (
          <button className={selected ? styles.selBtnOn : styles.selBtnOff} onClick={onToggleSelected}>
            {selected ? "✓ V pohádce" : "Přidat do pohádky"}
          </button>
        )}
      </div>

      <div className={styles.scroll}>
        <section className={styles.card}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>JMÉNO *</span>
            <input className={styles.input} value={name} onChange={(e) => onNameChange?.(e.target.value)} placeholder="Kubík, Pohádková víla, Dráček…" />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>POPIS (NEPOVINNÉ)</span>
            <textarea
              className={styles.textarea}
              rows={4}
              value={description}
              onChange={(e) => onDescriptionChange?.(e.target.value)}
              onClick={() => setDescEditorOpen(true)}
              placeholder="Malý hnědý medvídek s červenou mašlí…"
            />
          </label>
        </section>

        <section className={styles.card}>
          <span className={styles.fieldLabel}>FOTKA POSTAVY (NEPOVINNÉ)</span>
          <div className={styles.row2}>
            <button className={styles.secondaryBtn} onClick={onAddPhoto}>
              <span className={styles.discIcon}>
                <Icon name="upload" size={14} />
              </span>
              Nahrát fotku ({photoCount}/{maxPhotos})
            </button>
            <button className={styles.secondaryBtn} onClick={onTakePhoto}>
              <span className={styles.discIcon}>
                <Icon name="camera" size={14} />
              </span>
              Vyfotit
            </button>
          </div>
        </section>
      </div>

      <div className={styles.footer}>
        <button className={styles.cta} onClick={onSave}>
          {isEdit ? "Uložit" : "Přidat postavu"}
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
            <div className={styles.headerRow} style={{ padding: "54px 0 0" }}>
              <button className={styles.backBtn} onClick={() => setDescEditorOpen(false)} aria-label="Zpět">
                <Icon name="back-chevron" size={22} />
              </button>
              <div className={styles.title}>Popis postavy</div>
            </div>
            <textarea
              className={styles.bigTextarea}
              autoFocus
              value={description}
              onChange={(e) => onDescriptionChange?.(e.target.value)}
              placeholder="Jak postava vypadá, jakou má povahu, co má ráda…"
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
