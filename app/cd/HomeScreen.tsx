"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import styles from "./HomeScreen.module.css";
import AccountModal, { AccountUser } from "./AccountModal";
import Icon from "./Icon";

/**
 * Nickyho pohádky — home screen.
 * Background illustrations: /public/images/bg-log.jpg, bg-blanket.jpg, bg-tree.jpg, bg-log-v6.jpg (or pass your own list).
 * Fonts (next/font or <link>): Alegreya 700–800, Nunito 600–800.
 */

export interface HomeBackgroundOption {
  id: string;
  name: string;
  /** /images/... thumbnail + full background (same image used for both) */
  image: string;
}

export default function HomeScreen({
  backgroundOptions,
  selectedBackgroundId,
  onSelectBackground,
  customBackground,
  onGenerateCustomBackground,
  version,
  user,
  onLogin,
  onLogout,
  onTopUpCredits,
  onSaveEmail,
  onSavePassword,
  onStart,
}: {
  backgroundOptions: HomeBackgroundOption[];
  selectedBackgroundId?: string;
  onSelectBackground?: (id: string) => void;
  /** URL of a user-generated custom background, if one was already created. */
  customBackground?: string | null;
  /** Given the user's uploaded photo (data URL), returns the final stylized illustration URL. Keep any AI call + API key server-side. */
  onGenerateCustomBackground?: (photoDataUrl: string) => Promise<string>;
  version?: string;
  user?: AccountUser | null;
  onLogin?: (data: { name: string; password: string; email: string; isRegister: boolean }) => void;
  onLogout?: () => void;
  onTopUpCredits?: () => void;
  onSaveEmail?: (email: string) => void;
  onSavePassword?: (current: string, next: string) => void;
  onStart?: () => void;
}) {
  const [localBgId, setLocalBgId] = useState(selectedBackgroundId ?? backgroundOptions[0]?.id);
  const activeBgId = customBackground ? "custom" : selectedBackgroundId ?? localBgId;
  const activeBg =
    activeBgId === "custom" ? customBackground! : backgroundOptions.find((b) => b.id === activeBgId)?.image ?? backgroundOptions[0]?.image;

  const [bgSheetOpen, setBgSheetOpen] = useState(false);
  const [bgAddOpen, setBgAddOpen] = useState(false);
  const [flow, setFlow] = useState<"idle" | "waiting" | "running" | "done">("idle");
  const [flowResult, setFlowResult] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loginOpen, setLoginOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [lgName, setLgName] = useState("");
  const [lgPass, setLgPass] = useState("");
  const [lgMail, setLgMail] = useState("");
  const [lgChildAge, setLgChildAge] = useState<string | null>(null);
  const [forgotOpen, setForgotOpen] = useState(false);

  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [buttonTheme, setButtonTheme] = useState("orange");
  const [moodTheme, setMoodTheme] = useState("dusk");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("nicky-appearance-v1") || "null") as { buttonTheme?: string; moodTheme?: string } | null;
      if (saved?.buttonTheme) setButtonTheme(saved.buttonTheme);
      if (saved?.moodTheme) setMoodTheme(saved.moodTheme);
    } catch { /* corrupted local preference falls back to defaults */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("nicky-appearance-v1", JSON.stringify({ buttonTheme, moodTheme })); } catch { /* storage can be unavailable in private mode */ }
  }, [buttonTheme, moodTheme]);

  const appearanceStyle = {
    "--home-cta-gradient": BUTTON_GRADIENTS[buttonTheme] ?? BUTTON_GRADIENTS.orange,
    "--home-bg-filter": MOOD_FILTERS[moodTheme] ?? MOOD_FILTERS.dusk,
  } as CSSProperties;

  function pickBg(id: string) {
    setLocalBgId(id);
    onSelectBackground?.(id);
    setBgSheetOpen(false);
  }

  function openFilePicker() {
    setBgAddOpen(false);
    setFlow("waiting");
    setFlowResult(null);
    setFlowError(null);
    fileInputRef.current?.click();
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !onGenerateCustomBackground) return;
    setFlow("running");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const out = await onGenerateCustomBackground(reader.result as string);
        setFlowResult(out);
        setFlow("done");
      } catch (err) {
        setFlowError(err instanceof Error ? err.message : "Nepodařilo se vytvořit ilustraci.");
        setFlow("done");
      }
    };
    reader.readAsDataURL(file);
  }

  function cancelFlow() {
    setFlow("idle");
    setFlowResult(null);
    setFlowError(null);
  }

  return (
    <main className={styles.screen} style={appearanceStyle}>
      <span className={styles.moonGlow} aria-hidden />
      <span className={styles.moon} aria-hidden />
      <div className={styles.stars} aria-hidden>
        {STAR_POS.map(([x, y, s, dur, delay], i) => (
          <span key={i} className={styles.star} style={{ left: x, top: y, width: s, height: s, animationDuration: `${dur}s`, animationDelay: `${delay}s` }} />
        ))}
      </div>

      {activeBg && <img className={styles.bg} src={activeBg} alt="" aria-hidden draggable={false} />}
      <div className={styles.fireflies} aria-hidden>
        {FIREFLY_POS.map(([x, y, s, dur, delay], i) => (
          <span key={i} className={styles.firefly} style={{ left: x, top: y, width: s, height: s, animationDuration: `${dur}s`, animationDelay: `${delay}s` }} />
        ))}
      </div>
      <div className={styles.topScrim} aria-hidden />
      <div className={styles.bottomScrim} aria-hidden />

      <header className={styles.header}>
        <button className={styles.bgPill} onClick={() => setBgSheetOpen((v) => !v)} aria-label="Zvolit svět">
          <span className={styles.bgThumb} style={{ backgroundImage: `url(${activeBg})` }} />
          <Icon name="chevron-down" size={11} />
        </button>
        {version && <span className={styles.versionTag}>{version}</span>}
        <button className={styles.settingsBtn} onClick={() => setSettingsOpen(true)} aria-label="Nastavení">
          <Icon name="settings" size={20} />
        </button>
        <h1 className={styles.title}>
          Nickyho
          <br />
          pohádky
        </h1>
        {user && (
          <button className={styles.avatarBtn} onClick={() => setAccountOpen(true)} aria-label="Účet">
            {user.name.charAt(0).toUpperCase()}
          </button>
        )}
      </header>

      <footer className={styles.footer}>
        <button className={styles.cta} onClick={onStart}>
          <span className={styles.sparkles} aria-hidden>
            {SPARK_POS.map((s, i) => (
              <span key={i} style={{ left: s[0], top: s[1], width: s[2], height: s[2], animationDelay: `${s[3]}s`, animationDuration: `${s[4]}s` }} />
            ))}
          </span>
          <span className={styles.discIcon}>
            <Icon name="play" size={15} />
          </span>
          <span>Start nové pohádky</span>
        </button>
        {!user && (
          <button className={styles.loginBtn} onClick={() => setLoginOpen(true)}>
            <Icon name="account" size={17} />
            <span>Přihlásit se</span>
          </button>
        )}
        <div className={styles.homeBar} />
      </footer>

      {bgSheetOpen && (
        <>
          <div className={styles.sheetScrim} onClick={() => setBgSheetOpen(false)} />
          <div className={styles.bgSheet}>
            {backgroundOptions.map((b) => (
              <button key={b.id} className={styles.bgOption} onClick={() => pickBg(b.id)} aria-label={b.name}>
                <span className={activeBgId === b.id ? styles.bgOptionThumbActive : styles.bgOptionThumb} style={{ backgroundImage: `url(${b.image})` }} />
              </button>
            ))}
            <button className={activeBgId === "custom" ? styles.bgCustomTileActive : styles.bgCustomTile} onClick={() => setBgAddOpen(true)} aria-label="Vlastní pozadí z fotky">
              <Icon name="plus" size={18} />
              <span>VLASTNÍ</span>
            </button>
          </div>
          {bgAddOpen && (
            <>
              <div className={styles.sheetScrim} onClick={() => setBgAddOpen(false)} />
              <div className={styles.bgAddMenu}>
                <button onClick={openFilePicker}>
                  <Icon name="upload" size={18} /> Přidat foto z galerie
                </button>
              </div>
            </>
          )}
        </>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleFile} />

      {flow !== "idle" && (
        <div className={styles.flowOverlay}>
          {flow === "waiting" && (
            <>
              <div className={styles.spinner} />
              <div className={styles.flowTitle}>Vyberte fotku</div>
              <div className={styles.flowHint}>Čekám na fotku z galerie — po vybrání ji překreslím do pohádky.</div>
              <button className={styles.flowCta} onClick={openFilePicker}>
                Vybrat fotku
              </button>
              <button className={styles.flowCancel} onClick={cancelFlow}>
                Storno
              </button>
            </>
          )}
          {flow === "running" && (
            <>
              <div className={styles.spinner} />
              <div className={styles.flowTitle}>Překresluji do pohádky…</div>
              <button className={styles.flowCancel} onClick={cancelFlow}>
                Storno
              </button>
            </>
          )}
          {flow === "done" && (
            <>
              <div className={styles.flowTitle}>Nové pozadí</div>
              {flowResult && <img className={styles.flowPreview} src={flowResult} alt="" />}
              {flowError && <div className={styles.flowError}>{flowError}</div>}
              <div className={styles.flowActions}>
                {flowResult && (
                  <button
                    className={styles.flowConfirm}
                    onClick={() => {
                      onSelectBackground?.("custom");
                      cancelFlow();
                    }}
                  >
                    Použít jako pozadí
                  </button>
                )}
                <div className={styles.flowActionsRow}>
                  {flowError && (
                    <button className={styles.flowRetry} onClick={openFilePicker}>
                      Zkusit znovu
                    </button>
                  )}
                  <button className={styles.flowCancelSecondary} onClick={cancelFlow}>
                    Storno
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {loginOpen && (
        <div className={styles.loginOverlay}>
          <div className={styles.loginHeader}>
            <button className={styles.backBtn} onClick={() => setLoginOpen(false)} aria-label="Zavřít">
              <Icon name="back-chevron" size={22} />
            </button>
            <span className={styles.loginKicker}>{isRegister ? "NOVÝ ÚČET" : "PŘIHLÁŠENÍ"}</span>
          </div>
          <div className={styles.loginBody}>
            <h2 className={styles.loginHead}>{isRegister ? "Vytvořit nový účet" : "Vítej zpátky"}</h2>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>JMÉNO</span>
              <input className={styles.input} value={lgName} onChange={(e) => setLgName(e.target.value)} placeholder="např. jan" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>HESLO</span>
              <input className={styles.input} type="password" value={lgPass} onChange={(e) => setLgPass(e.target.value)} placeholder="••••••••" />
            </label>
            {isRegister && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>E-MAIL</span>
                <input className={styles.input} value={lgMail} onChange={(e) => setLgMail(e.target.value)} placeholder="jan@email.cz" />
              </label>
            )}
            {isRegister && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>VĚK DÍTĚTE</span>
                <div style={{ display: "flex", gap: 8 }}>
                  {["2–4", "5–7", "8–10", "11+"].map((band) => (
                    <button
                      key={band}
                      type="button"
                      onClick={() => setLgChildAge(band)}
                      className={lgChildAge === band ? styles.ageBandOn : styles.ageBandOff}
                    >
                      {band}
                    </button>
                  ))}
                </div>
              </label>
            )}
            <button
              className={styles.cta}
              onClick={() => {
                onLogin?.({ name: lgName.trim(), password: lgPass, email: lgMail.trim(), isRegister });
                setLoginOpen(false);
                setLgPass("");
              }}
            >
              {isRegister ? "Vytvořit účet" : "Přihlásit se"}
            </button>
            <button className={styles.loginSwitch} onClick={() => setIsRegister((v) => !v)}>
              {isRegister ? "Už mám svůj pohádkový účet" : "Chci si vytvořit nový účet"}
            </button>
            {!isRegister && (
              <button className={styles.loginSwitch} onClick={() => setForgotOpen(true)}>
                Zapomenuté heslo?
              </button>
            )}
          </div>
        </div>
      )}

      <AccountModal
        open={accountOpen}
        user={user ?? null}
        onClose={() => setAccountOpen(false)}
        onTopUpCredits={onTopUpCredits}
        onSaveEmail={onSaveEmail}
        onSavePassword={onSavePassword}
        onLogout={() => {
          setAccountOpen(false);
          onLogout?.();
        }}
      />
      {settingsOpen && (
        <div className={styles.settingsOverlay} role="dialog" aria-label="Nastavení vzhledu aplikace">
          <button className={styles.settingsScrim} aria-label="Zavřít nastavení" onClick={() => setSettingsOpen(false)} />
          <section className={styles.settingsSheet}>
            <div className={styles.settingsHead}><h2>Nastavení vzhledu</h2><button onClick={() => setSettingsOpen(false)} aria-label="Zavřít"><Icon name="close-x" size={20} /></button></div>
            <h3>Barva tlačítek</h3>
            <div className={styles.swatches}>
              {["orange", "plum", "fire", "night", "water"].map((id) => <button key={id} aria-label={id} className={`${styles.swatch} ${styles[`swatch_${id}`]} ${buttonTheme === id ? styles.swatchActive : ""}`} onClick={() => setButtonTheme(id)} />)}
            </div>
            <h3>Světlost a nálada</h3>
            <div className={styles.swatches}>
              {["none", "dusk", "night", "velvet", "milk", "forest"].map((id) => <button key={id} aria-label={id} className={`${styles.swatch} ${styles[`mood_${id}`]} ${moodTheme === id ? styles.swatchActive : ""}`} onClick={() => setMoodTheme(id)} />)}
            </div>
            <p className={styles.settingsSaved}>✓ Nastavení se použije pro celou aplikaci</p>
          </section>
        </div>
      )}
    </main>
  );
}

const STAR_POS: [number, number, number, number, number][] = [
  [30, 60, 3, 3, 0], [90, 110, 2, 4, 0.6], [150, 40, 3, 5, 1.2], [210, 90, 2, 6, 1.8],
  [262, 140, 3, 3, 2.4], [330, 55, 2, 4, 3], [356, 120, 3, 5, 3.6], [50, 170, 2, 6, 4.2],
  [300, 180, 3, 3, 4.8], [130, 150, 2, 4, 5.4],
].map(([x, y, s, dur, delay]) => [x, y, s, dur, delay]);
const FIREFLY_POS: [number, number, number, number, number][] = [
  [40, 300, 4, 3.2, 0], [110, 360, 3, 4, 0.5], [210, 255, 5, 4.8, 1], [290, 330, 3, 5.6, 1.5],
  [345, 262, 4, 3.2, 2], [70, 430, 3, 4, 2.5], [250, 410, 4, 4.8, 3], [330, 470, 3, 5.6, 3.5],
  [150, 480, 3, 3.2, 4], [30, 540, 4, 4, 4.5], [300, 560, 3, 4.8, 5], [200, 600, 4, 5.6, 5.5],
];
const SPARK_POS: [string, string, string, number, number][] = [
  ["9%", "20%", "5px", 0, 2.1], ["16%", "78%", "4px", 0.5, 2.7], ["23%", "14%", "3px", 1.1, 2.3],
  ["53%", "86%", "4px", 1.3, 2.4], ["73%", "84%", "4px", 0.8, 2.2], ["91%", "64%", "4px", 0.2, 2.8],
];
const BUTTON_GRADIENTS: Record<string, string> = {
  orange: "linear-gradient(90deg,#f59e0b,#f97316)", plum: "linear-gradient(90deg,#8b5cf6,#5b21b6)", fire: "linear-gradient(90deg,#ff7b00,#d62828)", night: "linear-gradient(90deg,#4361ee,#1d3557)", water: "linear-gradient(90deg,#38bdf8,#2563eb)",
};
const MOOD_FILTERS: Record<string, string> = {
  none: "none", dusk: "brightness(1.08) saturate(1.35) sepia(.18) hue-rotate(-14deg) contrast(1.04)", night: "brightness(.72) saturate(1.05) hue-rotate(8deg)", velvet: "brightness(.9) saturate(1.25) hue-rotate(18deg)", milk: "brightness(1.16) saturate(.78) sepia(.12)", forest: "brightness(.9) saturate(1.3) hue-rotate(42deg)",
};
