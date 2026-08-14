"use client";
import { useState } from "react";
import styles from "./VoiceSelectionScreen.module.css";
import Icon from "./Icon";

/**
 * Nickyho pohádky — Výběr hlasu.
 * Background: /public/images/bg-log.jpg. Fonts: Alegreya 800, Nunito 600–800.
 */

export interface VoiceItem {
  id: string;
  name: string;
  image: string;
}

export default function VoiceSelectionScreen({
  backgroundImage = "/images/bg-log.jpg",
  voices,
  premiumVoices = [],
  selectedVoiceId,
  onSelectVoice,
  onPlaySample,
  onUpgrade,
  onBack,
  onConfirm,
}: {
  backgroundImage?: string;
  voices: VoiceItem[];
  premiumVoices?: VoiceItem[];
  selectedVoiceId?: string;
  onSelectVoice?: (id: string) => void;
  onPlaySample?: (id: string) => void;
  onUpgrade?: () => void;
  onBack?: () => void;
  onConfirm?: (id: string) => void;
}) {
  const [localId, setLocalId] = useState(voices[0]?.id);
  const activeId = selectedVoiceId ?? localId;
  const active = voices.find((v) => v.id === activeId) ?? voices[0];

  function pick(id: string) {
    setLocalId(id);
    onSelectVoice?.(id);
  }

  return (
    <main className={styles.screen}>
      <img className={styles.bg} src={backgroundImage} alt="" aria-hidden draggable={false} />
      <div className={styles.scrim} aria-hidden />

      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">
          <Icon name="back-chevron" size={22} />
        </button>
        <h1 className={styles.title}>Výběr hlasu</h1>
      </header>

      <section className={styles.hero}>
        {active && (
          <>
            <Bars />
            <span className={styles.heroAvatar} style={{ backgroundImage: `url(${active.image})` }} />
            <Bars />
          </>
        )}
      </section>
      {active && (
        <div className={styles.heroText}>
          <div className={styles.heroName}>{active.name}</div>
          <div className={styles.heroSub}>Google Gemini TTS</div>
        </div>
      )}
      <div className={styles.sampleWrap}>
        <button className={styles.sampleBtn} onClick={() => active && onPlaySample?.(active.id)} aria-label="Přehrát ukázku">
          <PlayIcon />
        </button>
        <div className={styles.sampleLabel}>Přehrát ukázku</div>
      </div>

      <div className={styles.list}>
        <div className={styles.sectionLabel}>Vypravěči</div>
        <div className={styles.row}>
          {voices.map((v) => (
            <button key={v.id} className={styles.voiceBtn} onClick={() => pick(v.id)} aria-label={v.name}>
              <span className={v.id === activeId ? styles.avatarActive : styles.avatar} style={{ backgroundImage: `url(${v.image})` }} />
              <span className={styles.voiceName}>{v.name}</span>
            </button>
          ))}
        </div>

        {premiumVoices.length > 0 && (
          <>
            <div className={styles.premiumHeader}>
              <span className={styles.sectionLabel}>Premium hlasy</span>
              <span className={styles.premiumBadge}>★ PREMIUM</span>
            </div>
            <div className={styles.rowSpread}>
              {premiumVoices.map((v) => (
                <button key={v.id} className={styles.premiumBtn} onClick={onUpgrade} aria-label={v.name}>
                  <span className={styles.premiumAvatarWrap}>
                    <span className={styles.premiumAvatar} style={{ backgroundImage: `url(${v.image})` }} />
                    <span className={styles.lockBadge}><Icon name="lock" size={14} /></span>
                  </span>
                  <span className={styles.premiumName}>{v.name}</span>
                </button>
              ))}
            </div>
            <div className={styles.premiumNote}>Klon hlasu mámy či táty a další hlasy odemknete v Premium.</div>
          </>
        )}
      </div>

      <footer className={styles.footer}>
        <button className={styles.cta} onClick={() => active && onConfirm?.(active.id)}>
          <span className={styles.discIcon}>
            <CheckIcon />
          </span>
          Vybrat tento hlas
        </button>
      </footer>
    </main>
  );
}

function Bars() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {[14, 24, 34, 24, 14].map((h, i) => (
        <span
          key={i}
          style={{
            display: "block",
            width: 4,
            height: h,
            borderRadius: 2,
            background: "linear-gradient(180deg,#fcd34d,#f59e0b)",
            animation: `wave ${0.9 + i * 0.15}s ease-in-out ${i * 0.12}s infinite`,
          }}
        />
      ))}
    </span>
  );
}
function PlayIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="#5a3a00" style={{ marginLeft: 3 }} aria-hidden>
      <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}
