"use client";

// 🩺 Pojistka proti "modré obrazovce bez úniku": dřív appka neměla ŽÁDNÝ
// error boundary, takže jakákoli neodchycená chyba při vykreslování skončila
// jako holá stránka Next.js ("Application error: a client-side exception…")
// bez jediného tlačítka — čtenář se z ní nedostal jinak než zabitím appky/karty
// (nahlášeno jako "skočil mi tam modrý screen, ze kterého se nemůžu dostat").
// Tahle stránka chybu odchytí a vždycky nabídne cestu ven.

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app error boundary]", error);
  }, [error]);

  return (
    <main className="share-main">
      <div className="share-card" style={{ textAlign: "center" }}>
        <h1 className="share-title">😵 Jejda, něco se pokazilo</h1>
        <p style={{ opacity: 0.85, lineHeight: 1.55, margin: "0 0 1.2rem" }}>
          Appka narazila na neočekávanou chybu. Zkuste to prosím znovu — pokud
          se to bude opakovat, zkuste appku otevřít z hlavní stránky.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
          <button type="button" className="chip chip-btn chip-full chip-gps" onClick={() => reset()}>
            🔄 Zkusit znovu
          </button>
          <button type="button" className="chip chip-btn chip-full"
            onClick={() => { window.location.href = "/"; }}>
            🏠 Domů (obnovit appku)
          </button>
        </div>
      </div>
    </main>
  );
}
