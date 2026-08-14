"use client";
import styles from "./PermissionPrimerModal.module.css";
import Icon, { type IconName } from "./Icon";

export type PermissionKind = "camera" | "microphone" | "location";

const COPY: Record<PermissionKind, { icon: IconName; body: string }> = {
  camera: { icon: "camera", body: "Potřebujeme přístup k fotoaparátu, abyste mohli vyfotit postavu nebo místo pro pohádku." },
  microphone: { icon: "mic", body: "Potřebujeme přístup k mikrofonu, abychom mohli nahrát váš hlas pro vypravěče." },
  location: { icon: "location-pin", body: "Potřebujeme vaši polohu, abychom mohli pohádku zasadit do vašeho okolí. Polohu nikam neukládáme trvale." },
};

export default function PermissionPrimerModal({
  open,
  kind,
  denied = false,
  onAllow,
  onNotNow,
  onOpenSettings,
}: {
  open: boolean;
  kind: PermissionKind;
  denied?: boolean;
  onAllow?: () => void;
  onNotNow?: () => void;
  onOpenSettings?: () => void;
}) {
  if (!open) return null;
  const copy = COPY[kind];
  return (
    <div className={styles.overlay}>
      <div className={styles.scrim} onClick={onNotNow} />
      <div className={styles.card}>
        <div className={styles.icon}><Icon name={copy.icon} size={34} /></div>
        {denied ? (
          <>
            <h2 className={styles.title}>Povolení bylo odmítnuto</h2>
            <p className={styles.body}>Povolení jste dříve odmítli — zapněte ho v Nastavení telefonu.</p>
            <button className={styles.cta} onClick={onOpenSettings}>Otevřít Nastavení</button>
          </>
        ) : (
          <>
            <p className={styles.body}>{copy.body}</p>
            <button className={styles.cta} onClick={onAllow}>Povolit</button>
            <button className={styles.textBtn} onClick={onNotNow}>Teď ne</button>
          </>
        )}
      </div>
    </div>
  );
}
