"use client";
import { useState } from "react";
import styles from "./ForgotPasswordFlow.module.css";

export default function ForgotPasswordFlow({
  stage,
  onSendLink,
  onBackToLogin,
  onSubmitReset,
}: {
  stage: "request" | "sent" | "reset" | "resetSuccess";
  onSendLink?: (email: string) => void;
  onBackToLogin?: () => void;
  onSubmitReset?: (newPassword: string) => void;
}) {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");

  if (stage === "sent") {
    return (
      <main className={styles.screen}>
        <div className={styles.icon}>✉️</div>
        <h1 className={styles.title}>Zkontrolujte e-mail</h1>
        <p className={styles.body}>Poslali jsme vám odkaz na obnovení hesla.</p>
        <button className={styles.secondary} onClick={onBackToLogin}>Zpět na přihlášení</button>
      </main>
    );
  }
  if (stage === "reset") {
    return (
      <main className={styles.screen}>
        <h1 className={styles.title}>Nové heslo</h1>
        <input className={styles.input} type="password" placeholder="NOVÉ HESLO" value={pass} onChange={(e) => setPass(e.target.value)} />
        <input className={styles.input} type="password" placeholder="POTVRDIT HESLO" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <button className={styles.cta} onClick={() => onSubmitReset?.(pass)} disabled={!pass || pass !== confirm}>Nastavit nové heslo</button>
      </main>
    );
  }
  if (stage === "resetSuccess") {
    return (
      <main className={styles.screen}>
        <div className={styles.icon}>✓</div>
        <h1 className={styles.title}>Heslo změněno</h1>
        <button className={styles.cta} onClick={onBackToLogin}>Přihlásit se</button>
      </main>
    );
  }
  return (
    <main className={styles.screen}>
      <h1 className={styles.title}>Zapomenuté heslo</h1>
      <input className={styles.input} placeholder="E-MAIL" value={email} onChange={(e) => setEmail(e.target.value)} />
      <p className={styles.body}>Pošleme vám odkaz na obnovení hesla.</p>
      <button className={styles.cta} onClick={() => onSendLink?.(email)} disabled={!email}>Odeslat odkaz</button>
    </main>
  );
}
