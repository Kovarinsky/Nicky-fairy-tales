"use client";
import { useRef, useState } from "react";
import styles from "./HomeScreen.module.css";
import AccountModal, { AccountUser } from "./AccountModal";

/**
 * Nickyho pohádky — home screen.
 * Background illustrations: /public/images/bg-log.jpg, bg-blanket.jpg, bg-tree.jpg, bg-log-v6.jpg (or pass your own list).
 * Fonts (next/font or <link>): Alegreya 700–800, Nunito 600–800.
 */

/** Zmenší obrázek (data URL) na max. rozměr na delší straně a přebalí jako
 *  JPEG dané kvality — viz handleFile, proč je to nutné před uploadem. */
function downscaleImage(dataUrl: string, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("Fotku se nepodařilo zpracovat."));
    img.src = dataUrl;
  });
}

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
  accountChecked = true,
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
  /** false, dokud appka ještě neověřila session cookie (/api/account/me) —
   *  dokud appka neví jistě, jestli je uživatel přihlášený, radši nezobrazí
   *  ani "Přihlásit se", ani odznak účtu (viz onStart), ať se u někoho, kdo
   *  JE přihlášený z dřívějška, na okamžik nemihne špatný (odhlášený) stav. */
  accountChecked?: boolean;
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
  // 🖱️ 2026-08-09: nahlášeno "mezi světy nejde rollovat, není vidět možnost
  // přidat vlastní pozadí" — kolečko myši/scrollbar sice appka řešila dřív
  // (onWheel remap), ale appka na tom pořád stavěla jen na jednom gestu
  // (kolečko/dotykový swipe). Viditelné šipky fungují VŽDY, nezávisle na
  // vstupním zařízení, a hlavně dávají najevo, že lišta NENÍ statická —
  // "VLASTNÍ" dlaždice je poslední v řadě, šipka doprava ji spolehlivě odkryje.
  const bgSheetRef = useRef<HTMLDivElement>(null);
  function scrollBgSheet(dir: 1 | -1) {
    bgSheetRef.current?.scrollBy({ left: dir * 160, behavior: "smooth" });
  }
  const [flow, setFlow] = useState<"idle" | "waiting" | "running" | "done">("idle");
  const [flowResult, setFlowResult] = useState<string | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loginOpen, setLoginOpen] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [lgName, setLgName] = useState("");
  const [lgPass, setLgPass] = useState("");
  const [lgMail, setLgMail] = useState("");

  const [accountOpen, setAccountOpen] = useState(false);

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
        // 🩺 Fotky přímo z mobilu (typicky 3–8 MB) v base64 snadno přerostou
        // limit payloadu serverové funkce (HTTP 413 "Request Entity Too
        // Large / FUNCTION_PAYLOAD_TOO_LARGE") — appka tak vlastní pozadí
        // nedokázala nahrát vůbec. Zmenšení na klientovi PŘED odesláním
        // (1600px na delší straně stačí i pro AI referenci) tenhle limit
        // spolehlivě obchází.
        const downscaled = await downscaleImage(reader.result as string, 1600, 0.85);
        const out = await onGenerateCustomBackground(downscaled);
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
    <main className={styles.screen}>
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
          <ChevronDown />
        </button>
        {version && <span className={styles.versionTag}>{version}</span>}
        <h1 className={styles.title}>
          Nickyho
          <br />
          pohádky
        </h1>
        {accountChecked && user && (
          <button className={styles.avatarBtn} onClick={() => setAccountOpen(true)} aria-label="Účet">
            {user.name.charAt(0).toUpperCase()}
          </button>
        )}
      </header>

      <footer className={styles.footer}>
        {/* 🔐 Přihlášení je teď POVINNÉ před vytvořením pohádky (appka
            potřebuje sledovat aktivitu/kredity účtu) — proto je nahoře,
            stejně velké a stejně "jiskřivé" jako Start, ne drobný vedlejší
            odkaz pod ním jako dřív.
            🩺 accountChecked hlídá i to, aby appka "Přihlásit se" nemihla
            při KAŽDÉM startu ještě předtím, než se stihne ověřit session
            cookie (/api/account/me) — nahlášeno jako "appka mě ukazuje
            odhlášeného, i když jsem přihlášený" (self-healing do zlomku
            vteřiny, ale u někoho přihlášeného z dřívějška je to matoucí i
            tak krátce). */}
        {accountChecked && !user && (
          <button className={styles.loginBtn} onClick={() => setLoginOpen(true)}>
            <span className={styles.sparkles} aria-hidden>
              {SPARK_POS.map((s, i) => (
                <span key={i} style={{ left: s[0], top: s[1], width: s[2], height: s[2], animationDelay: `${s[3]}s`, animationDuration: `${s[4]}s` }} />
              ))}
            </span>
            <span className={styles.loginIcon}>
              <UserIcon />
            </span>
            <span>Přihlásit se</span>
          </button>
        )}
        <button className={styles.cta} onClick={() => { if (!accountChecked) return; if (!user) { setLoginOpen(true); return; } onStart?.(); }}>
          <span className={styles.sparkles} aria-hidden>
            {SPARK_POS.map((s, i) => (
              <span key={i} style={{ left: s[0], top: s[1], width: s[2], height: s[2], animationDelay: `${s[3]}s`, animationDuration: `${s[4]}s` }} />
            ))}
          </span>
          <span className={styles.discIcon}>
            <PlayIcon />
          </span>
          <span>Start nové pohádky</span>
        </button>
        <div className={styles.homeBar} />
      </footer>

      {bgSheetOpen && (
        <>
          <div className={styles.sheetScrim} onClick={() => setBgSheetOpen(false)} />
          <div className={styles.bgSheetWrap}>
            {/* 🖱️ 2026-08-09: viditelné šipky vedle scrollovací lišty — fungují
                nezávisle na tom, jestli appka dostane kolečko/swipe/drag, a
                zároveň VIZUÁLNĚ ukazují, že za okrajem je další obsah (dřív
                to vypadalo jako statický, uzavřený výběr). */}
            {/* 🩺 2026-08-10: "šipka vpravo se stále hýbe při posunu vpravo" —
                tlačítko standardně PŘEBÍRÁ FOKUS při doteku a mobilní
                prohlížeč umí sám doscrollovat/posunout stránku, ať je
                fokusovaný prvek vidět (i když je už vidět) — na tenhle druh
                jitteru je nejčastější příčina přesně tohle. onMouseDown/
                onTouchStart s preventDefault zabrání tlačítku fokus vůbec
                převzít, jen provede onClick akci. */}
            <button type="button" className={styles.bgSheetNav} style={{ left: -6 }}
              onMouseDown={e => e.preventDefault()} onTouchStart={e => e.preventDefault()}
              onClick={() => scrollBgSheet(-1)} aria-label="Předchozí světy">
              <ChevronSide dir="l" />
            </button>
            <div
              ref={bgSheetRef}
              className={styles.bgSheet}
              onWheel={(e) => {
                // 🖱️ 2026-08-05: nahlášeno "mezi světy nejde listovat" — ověřeno
                // živě (Playwright): scrollbar je schválně skrytý a čistě svislé
                // kolečko myši (bez trackpadu/dotykové obrazovky) samo o sobě
                // vodorovný overflow-x:auto nerolovalo, ani click-drag nefungoval
                // — na PC s obyčejnou myší nebyla ŽÁDNÁ cesta k dlaždicím za
                // okrajem (dotykem/trackpadem to fungovalo nativně). Svislý
                // scroll delta se teď přemapuje na vodorovný posun.
                if (e.deltaY === 0) return;
                e.currentTarget.scrollLeft += e.deltaY;
              }}
            >
              {/* 🏷️ Dřív byl u dlaždice jen kroužek s obrázkem — jméno světa
                  šlo poznat jen z aria-label (screen reader), vizuálně nebylo
                  jasné, co se vlastně vybírá. Teď je pod kroužkem i čitelný
                  popisek písmem appky (Nunito). */}
              {backgroundOptions.map((b) => (
                <button key={b.id} className={styles.bgOption} onClick={() => pickBg(b.id)} aria-label={b.name}>
                  <span className={activeBgId === b.id ? styles.bgOptionThumbActive : styles.bgOptionThumb} style={{ backgroundImage: `url(${b.image})` }} />
                  <span className={styles.bgOptionLabel}>{b.name}</span>
                </button>
              ))}
              <button className={activeBgId === "custom" ? styles.bgCustomTileActive : styles.bgCustomTile} onClick={() => setBgAddOpen(true)} aria-label="Vlastní pozadí z fotky">
                <PlusIcon />
                <span>VLASTNÍ</span>
              </button>
            </div>
            <button type="button" className={styles.bgSheetNav} style={{ right: -6 }}
              onMouseDown={e => e.preventDefault()} onTouchStart={e => e.preventDefault()}
              onClick={() => scrollBgSheet(1)} aria-label="Další světy">
              <ChevronSide dir="r" />
            </button>
          </div>
          {bgAddOpen && (
            <>
              <div className={styles.sheetScrim} onClick={() => setBgAddOpen(false)} />
              <div className={styles.bgAddMenu}>
                <button onClick={openFilePicker}>
                  <PhotoIcon /> Přidat foto z galerie
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
              ‹
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

function ChevronDown({ style }: { style?: React.CSSProperties } = {}) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.75, ...style }}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
// 🖱️ 2026-08-09: šipka u výběru světa se "hýbala dolů" — příčina: appka dřív
// natáčela ChevronDown (dolů) o ±90° přes CSS transform, ale SVG rotace se
// dělá kolem (0,0) ne kolem středu ikony, takže se vizuálně vychýlila mimo
// tlačítko. Vlastní PŘÍMÁ ikona vlevo/vpravo (bez rotace) tohle nemá jak udělat.
function ChevronSide({ dir }: { dir: "l" | "r" }) {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.85 }}>
      <path d={dir === "l" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
function PlayIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 2 }}>
      <path d="M7 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" />
    </svg>
  );
}
function UserIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20c.9-3.7 3.8-5.6 7.2-5.6s6.3 1.9 7.2 5.6" />
    </svg>
  );
}
function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
function PhotoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fde68a" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="16" rx="3" />
      <path d="M3 16l5-4 4 3 3-2 6 5" />
      <circle cx="8.5" cy="9" r="1.4" fill="#fde68a" stroke="none" />
    </svg>
  );
}
