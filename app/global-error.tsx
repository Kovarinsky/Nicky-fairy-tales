"use client";

// 🩺 Poslední záchranná síť — chytá chyby i ze SAMOTNÉHO root layoutu, kam
// se běžný app/error.tsx nedostane (Next.js vyžaduje, aby si tahle stránka
// vykreslila VLASTNÍ <html>/<body>, protože nahrazuje layout úplně).

import { useEffect } from "react";

export default function GlobalErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app global error boundary]", error);
  }, [error]);

  return (
    <html lang="cs">
      <body style={{
        margin: 0,
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1rem",
        background: "#0a0520",
        color: "#f3efff",
        fontFamily: "system-ui, sans-serif",
      }}>
        <div style={{
          width: "min(420px, 100%)",
          textAlign: "center",
          background: "rgba(13, 19, 64, 0.88)",
          border: "1px solid rgba(255, 255, 255, 0.18)",
          borderRadius: "22px",
          padding: "1.4rem 1.2rem",
        }}>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 900, marginBottom: "0.75rem" }}>😵 Jejda, něco se pokazilo</h1>
          <p style={{ opacity: 0.85, lineHeight: 1.55, margin: "0 0 1.2rem" }}>
            Appka narazila na neočekávanou chybu. Zkuste to prosím znovu.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <button type="button" onClick={() => reset()} style={{
              padding: "0.9rem", borderRadius: "14px", border: "none", fontWeight: 800, fontSize: "1rem",
              background: "linear-gradient(135deg, #f59e0b 0%, #f97316 100%)", color: "#fff", cursor: "pointer",
            }}>
              🔄 Zkusit znovu
            </button>
            <button type="button" onClick={() => { window.location.href = "/"; }} style={{
              padding: "0.9rem", borderRadius: "14px", border: "1.5px solid rgba(255,255,255,0.3)", fontWeight: 800, fontSize: "1rem",
              background: "rgba(255,255,255,0.1)", color: "#fff", cursor: "pointer",
            }}>
              🏠 Domů (obnovit appku)
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
