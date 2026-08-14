"use client";
import { useState } from "react";
import styles from "./AccountModal.module.css";

/**
 * Nickyho pohádky — account / profile modal (credits, email, password, logout).
 * Meant to be mounted over another screen (e.g. Home). Fonts: Alegreya 700, Nunito 600–800.
 */

export interface AccountUser {
  name: string;
  email?: string;
  credits: number;
}

export default function AccountModal({
  open,
  user,
  onClose,
  onTopUpCredits,
  onSaveEmail,
  onSavePassword,
  onLogout,
}: {
  open: boolean;
  user: AccountUser | null;
  onClose?: () => void;
  onTopUpCredits?: () => void;
  onSaveEmail?: (email: string) => void;
  onSavePassword?: (current: string, next: string) => void;
  onLogout?: () => void;
}) {
  const [mailEdit, setMailEdit] = useState(false);
  const [passEdit, setPassEdit] = useState(false);
  const [mailDraft, setMailDraft] = useState("");
  const [curPass, setCurPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [note, setNote] = useState<string | null>(null);

  if (!open || !user) return null;

  function close() {
    setMailEdit(false);
    setPassEdit(false);
    setNote(null);
    onClose?.();
  }

  return (
    <>
      <div className={styles.scrim} onClick={close} />
      <button className={styles.closeBtn} onClick={close} aria-label="Zavřít">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
      <div className={styles.panel}>
        <div className={styles.identity}>
          <span className={styles.avatarBig}>{user.name.charAt(0).toUpperCase()}</span>
          <div className={styles.identityText}>
            <span className={styles.name}>{user.name}</span>
            <span className={styles.status}>Přihlášen</span>
          </div>
        </div>

        <div className={styles.creditsRow}>
          <div className={styles.creditsLeft}>
            <span className={styles.coin}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="9" />
              </svg>
            </span>
            <div className={styles.creditsText}>
              <span className={styles.creditsLabel}>KREDITY</span>
              <span className={styles.creditsValue}>{user.credits}</span>
            </div>
          </div>
          <button className={styles.smallCta} onClick={onTopUpCredits}>
            Dobít kredit
          </button>
        </div>

        <div className={styles.rows}>
          <button
            className={styles.row}
            onClick={() => {
              setMailEdit((v) => !v);
              setPassEdit(false);
              setMailDraft(user.email || "");
            }}
          >
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>E-MAIL</span>
              <span className={styles.rowValue}>{user.email || "Nezadán — přidat"}</span>
            </span>
            <span className={styles.chevron}>›</span>
          </button>
          <button
            className={styles.row}
            onClick={() => {
              setPassEdit((v) => !v);
              setMailEdit(false);
            }}
          >
            <span className={styles.rowText}>
              <span className={styles.rowLabel}>HESLO</span>
              <span className={styles.rowValue}>Změnit heslo</span>
            </span>
            <span className={styles.chevron}>›</span>
          </button>
        </div>

        {mailEdit && (
          <div className={styles.editRow}>
            <input className={styles.input} value={mailDraft} onChange={(e) => setMailDraft(e.target.value)} placeholder="jan@email.cz" />
            <button
              className={styles.smallCta}
              onClick={() => {
                onSaveEmail?.(mailDraft.trim());
                setMailEdit(false);
                setNote("E-mail uložen.");
              }}
            >
              Uložit
            </button>
          </div>
        )}
        {passEdit && (
          <div className={styles.editStack}>
            <input className={styles.input} type="password" value={curPass} onChange={(e) => setCurPass(e.target.value)} placeholder="Stávající heslo" />
            <input className={styles.input} type="password" value={newPass} onChange={(e) => setNewPass(e.target.value)} placeholder="Nové heslo" />
            <button
              className={styles.smallCta}
              onClick={() => {
                onSavePassword?.(curPass, newPass);
                setPassEdit(false);
                setCurPass("");
                setNewPass("");
                setNote("Heslo změněno.");
              }}
            >
              Změnit heslo
            </button>
          </div>
        )}
        {note && <span className={styles.note}>{note}</span>}

        <button className={styles.logoutBtn} onClick={onLogout}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 5H6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h9" />
            <path d="M18 8l3 4-3 4M21 12h-9" />
          </svg>
          <span>Odhlásit se</span>
        </button>
      </div>
    </>
  );
}
