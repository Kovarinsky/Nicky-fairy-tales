"use client";
import styles from "./StoryLibraryScreen.module.css";

export interface LibraryStory {
  id: string;
  title: string;
  cover: string;
  relativeDate: string;
}

export default function StoryLibraryScreen({
  stories,
  loading = false,
  error,
  onBack,
  onPlay,
  onShare,
  onDeleteRequest,
  onCreateFirst,
  resumeBanner,
}: {
  stories: LibraryStory[];
  loading?: boolean;
  error?: string | null;
  onBack?: () => void;
  onPlay?: (id: string) => void;
  onShare?: (id: string) => void;
  onDeleteRequest?: (id: string) => void;
  onCreateFirst?: () => void;
  resumeBanner?: { title: string; onResume: () => void; onDismiss: () => void } | null;
}) {
  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <button className={styles.backBtn} onClick={onBack} aria-label="Zpět">‹</button>
        <h1 className={styles.title}>Moje pohádky</h1>
      </header>

      {resumeBanner && (
        <div className={styles.resumeBanner}>
          <span className={styles.resumeIcon}>⏳</span>
          <div className={styles.resumeText}>
            <span className={styles.resumeLabel}>MÁTE ROZPRACOVANOU POHÁDKU</span>
            <span className={styles.resumeTitle}>{resumeBanner.title}</span>
          </div>
          <button className={styles.resumeCta} onClick={resumeBanner.onResume}>Pokračovat</button>
          <button className={styles.resumeDismiss} onClick={resumeBanner.onDismiss} aria-label="Zavřít">×</button>
        </div>
      )}

      {error && <div className={styles.errorBanner}>{error}</div>}

      {loading ? (
        <div className={styles.grid}>
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className={styles.skeleton} />)}
        </div>
      ) : stories.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📖</div>
          <h2 className={styles.emptyTitle}>Zatím žádné pohádky</h2>
          <p className={styles.emptyBody}>Vytvořte první pohádku a objeví se tady.</p>
          <button className={styles.cta} onClick={onCreateFirst}>Vytvořit první pohádku</button>
        </div>
      ) : (
        <div className={styles.grid}>
          {stories.map((s) => (
            <div key={s.id} className={styles.card} style={{ backgroundImage: `linear-gradient(180deg,rgba(16,8,36,0) 40%,rgba(16,8,36,.85)), url(${s.cover})` }}>
              <button className={styles.cardBody} onClick={() => onPlay?.(s.id)} aria-label={`Přehrát ${s.title}`}>
                <span className={styles.cardLabel}>{s.title}</span>
                <span className={styles.cardDate}>{s.relativeDate}</span>
              </button>
              <div className={styles.cardMenu}>
                <button className={styles.menuDot} onClick={() => onShare?.(s.id)} aria-label="Sdílet">⤴</button>
                <button className={styles.menuDot} onClick={() => onDeleteRequest?.(s.id)} aria-label="Smazat">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
