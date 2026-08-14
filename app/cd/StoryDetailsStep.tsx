"use client";
import { useState } from "react";
import styles from "./StoryDetailsStep.module.css";
import Icon from "./Icon";

/**
 * Nickyho pohádky — Výběr pohádky, krok 2/2 (Pohádka).
 * Background: /public/images/bg-zrozeni.jpg. Fonts: Alegreya 800, Nunito 600–800.
 */

export interface CharacterSummary {
  id: string;
  name: string;
  avatar: string;
  selected?: boolean;
}
export interface VoiceSummary {
  id: string;
  name: string;
  subtitle?: string;
  image: string;
}

export default function StoryDetailsStep({
  backgroundImage = "/images/bg-zrozeni.jpg",
  worldName,
  worldImage,
  onBackToWorld,
  motif,
  onMotifChange,
  onOpenMotifEditor,
  onGenerateMotif,
  characters,
  onOpenCharacter,
  onAddCharacter,
  voice,
  onOpenVoice,
  length,
  onLengthChange,
  onBack,
  onSubmit,
}: {
  backgroundImage?: string;
  worldName?: string;
  worldImage?: string;
  onBackToWorld?: () => void;
  motif: string;
  onMotifChange?: (v: string) => void;
  onOpenMotifEditor?: () => void;
  onGenerateMotif?: () => void;
  characters: CharacterSummary[];
  onOpenCharacter?: (id: string) => void;
  onAddCharacter?: () => void;
  voice?: VoiceSummary;
  onOpenVoice?: () => void;
  length: number;
  onLengthChange?: (n: number) => void;
  onBack?: () => void;
  onSubmit?: () => void;
}) {
  const [localMotif, setLocalMotif] = useState(motif);
  const value = motif ?? localMotif;

  return (
    <main className={styles.screen}>
      <div className={styles.bgLayer} style={{ backgroundImage: `url(${backgroundImage})` }} />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">
          <Icon name="back-chevron" size={22} />
        </button>
        <h1 className={styles.title}>Výběr pohádky</h1>
        <div className={styles.stepLabel}>KROK 2 ZE 2 · POHÁDKA</div>
      </header>

      <div className={styles.scroll}>
        <div className={styles.stack}>
          <button className={styles.summaryRow} onClick={onBackToWorld}>
            <span className={styles.summaryThumb} style={worldImage ? { backgroundImage: `url(${worldImage})` } : undefined} />
            <span className={styles.summaryText}>
              <span className={styles.summaryLabel}>SVĚT POHÁDKY</span>
              <span className={styles.summaryValue}>{worldName ?? "Nevybráno"}</span>
            </span>
            <span className={styles.chevron}><Icon name="chevron-right" size={20} /></span>
          </button>

          <section className={styles.card}>
            <div className={styles.cardTitle}>Motiv pohádky</div>
            <textarea
              className={styles.textarea}
              rows={2}
              value={value}
              onChange={(e) => {
                setLocalMotif(e.target.value);
                onMotifChange?.(e.target.value);
              }}
              onClick={onOpenMotifEditor}
              placeholder="O čem by pohádka měla být…"
            />
            <div className={styles.row2}>
              <button className={styles.secondaryBtn} onClick={onGenerateMotif}>
                <span className={styles.discIcon}>
                  <Icon name="sparkle" size={15} />
                </span>
                Vymysli námět
              </button>
              <button className={styles.secondaryBtn} onClick={onOpenMotifEditor}>
                <span className={styles.discIcon}>
                  <Icon name="wand" size={15} />
                </span>
                Rozvinout
              </button>
            </div>
          </section>

          <section className={styles.card}>
            <div className={styles.cardTitle}>Kdo v pohádce vystupuje</div>
            <div className={styles.avatarRow}>
              {characters.map((c) => (
                <button key={c.id} className={styles.avatarBtn} onClick={() => onOpenCharacter?.(c.id)} aria-label={c.name}>
                  <span className={styles.avatarWrap}>
                    <span className={c.selected ? styles.avatarActive : styles.avatarImg} style={{ backgroundImage: `url(${c.avatar})` }} />
                    {c.selected && <span className={styles.selBadge}><Icon name="checkmark" size={13} /></span>}
                  </span>
                  <span className={styles.avatarName}>{c.name}</span>
                </button>
              ))}
              <button className={styles.avatarBtn} onClick={onAddCharacter} aria-label="Přidat postavu">
                <span className={styles.avatarAdd}>
                  <Icon name="plus" size={20} />
                </span>
                <span className={styles.avatarName}>Přidat</span>
              </button>
            </div>
          </section>

          <button className={styles.summaryRow} onClick={onOpenVoice}>
            {voice && <span className={styles.summaryThumbRound} style={{ backgroundImage: `url(${voice.image})` }} />}
            <span className={styles.summaryText}>
              <span className={styles.summaryLabel}>VYPRÁVÍ</span>
              <span className={styles.summaryValue}>{voice?.name ?? "Nevybráno"}</span>
              {voice?.subtitle && <span className={styles.summarySub}>{voice.subtitle}</span>}
            </span>
            <span className={styles.chevron}><Icon name="chevron-right" size={20} /></span>
          </button>

          <section className={styles.card}>
            <div className={styles.cardTitle}>Délka pohádky</div>
            <div className={styles.sliderRow}>
              <input className={styles.range} type="range" min={2} max={18} value={length} onChange={(e) => onLengthChange?.(+e.target.value)} />
              <span className={styles.sliderValue}>{length} scén</span>
            </div>
          </section>
        </div>
      </div>

      <div className={styles.footer}>
        <button className={styles.cta} onClick={onSubmit}>
          <span className={styles.discIcon}>
            <Icon name="play" size={15} />
          </span>
          Vytvořit pohádku
        </button>
      </div>
    </main>
  );
}
