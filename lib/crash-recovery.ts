"use client";

// 🩺 Sdíleno mezi app/error.tsx a app/global-error.tsx — po pádu appka má
// VŽDY skončit na výšku, mimo fullscreen, na hlavní obrazovce, ne zpátky v
// rozečtené (možná právě PROTO padlé) pohádce. "Zkusit znovu" dřív jen
// remountoval React strom (žádný skutečný reload) — orientation lock a
// fullscreen z čtečky tak mohly appce zůstat viset i po pádu. A appka po
// pádu/reloadu sama obnovuje rozečtenou pohádku (viz DRAFT_KEY v
// app/page.tsx) — žádoucí po normálním přepnutí pryč z appky, ale NE po
// pádu, kde by čtenáře vrátila přesně tam, kde appka spadla.
const DRAFT_KEY = "nicky-story-draft";

export function recoverToHome() {
  try { (screen as Screen & { orientation?: { unlock?: () => void } }).orientation?.unlock?.(); } catch {}
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch {}
  try { localStorage.removeItem(DRAFT_KEY); } catch {}
}

export function logClientError(error: Error & { digest?: string }, boundary: "error" | "global") {
  try {
    void fetch("/api/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error?.message,
        digest: error?.digest,
        stack: error?.stack,
        url: typeof location !== "undefined" ? location.href : undefined,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
        boundary,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}
