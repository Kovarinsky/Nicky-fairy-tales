// ✉️ Transakční e-maily (zatím jen: heslo při registraci / obnově) přes
// Resend REST API — žádná SDK závislost, jen fetch. Vyžaduje RESEND_API_KEY
// (Vercel env); bez něj sendMail rovnou selže, ať to volající pozná hned.

export async function sendMail(to: string, subject: string, html: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí RESEND_API_KEY.");
  const from = process.env.RESEND_FROM_EMAIL?.trim() || "Nickyho pohádky <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to, subject, html }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${t.slice(0, 200)}`);
  }
}
