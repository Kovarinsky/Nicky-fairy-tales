"use client";
import styles from "./HomeScreen.module.css";

/**
 * Nickyho pohádky — home screen.
 * backgroundImage defaults to /bg-intro-v6.png (appka ho už měla z dřívějška,
 * je to i vlastní stylový podklad z Claude Design).
 * Fonts (next/font or <link>): Alegreya 800, Nunito 600–800.
 */

const NAV = [
  { key: "postavy", label: "Postavy", icon: PersonIcon },
  { key: "svety", label: "Světy", icon: TreeIcon },
  { key: "hlas", label: "Hlas", icon: MicIcon },
  { key: "pozadi", label: "Pozadí", icon: PaletteIcon },
] as const;

export default function HomeScreen({
  version = "v4.99.7",
  backgroundImage = "/bg-intro-v6.png",
  onStart,
  onNav,
}: {
  version?: string;
  backgroundImage?: string;
  onStart?: () => void;
  onNav?: (key: (typeof NAV)[number]["key"]) => void;
}) {
  return (
    <main className={styles.screen}>
      <img
        className={styles.bg}
        src={backgroundImage}
        alt=""
        aria-hidden
        draggable={false}
      />
      <div className={styles.scrimTop} aria-hidden />
      <div className={styles.scrimBottom} aria-hidden />

      <header className={styles.header}>
        <h1 className={styles.title}>Nickyho pohádky</h1>
        <span className={styles.version}>{version}</span>
      </header>

      <footer className={styles.footer}>
        <button className={styles.cta} onClick={onStart}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
          </svg>
          Start nové pohádky
        </button>
        <nav className={styles.nav}>
          {NAV.map(({ key, label, icon: Icon }) => (
            <button key={key} className={styles.navBtn} onClick={() => onNav?.(key)}>
              <span className={styles.navCircle}>
                <Icon />
              </span>
              <span className={styles.navLabel}>{label}</span>
            </button>
          ))}
        </nav>
      </footer>
    </main>
  );
}

function iconProps() {
  return {
    width: 26,
    height: 26,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.9,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
}
function PersonIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" />
      <path d="M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5" />
    </svg>
  );
}
function TreeIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3 5 12h3l-3 6h14l-3-6h3L12 3Z" />
      <path d="M12 18v3" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3Z" />
      <path d="M6 11a6 6 0 0 0 12 0" />
      <path d="M12 17v4" />
    </svg>
  );
}
function PaletteIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M12 3a9 9 0 0 0 0 18c1.4 0 2-.9 2-2 0-.6-.3-1-.6-1.4-.3-.4-.6-.8-.6-1.4 0-1.1.9-2 2-2h2.4A4.8 4.8 0 0 0 21 10.5C21 6.4 17 3 12 3Z" />
      <path d="M7.5 10.5h.01" />
      <path d="M11 7h.01" />
      <path d="M15.5 8h.01" />
    </svg>
  );
}
