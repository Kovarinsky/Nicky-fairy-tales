// POST /api/job/start — spustí generování celé pohádky NA SERVERU.
// Telefon může okamžitě odejít; průběh a hotové scény se ukládají do
// Vercel Blob a klient si je stáhne přes /api/job/status.
// Zadání se uloží do jobs/<id>/request.json, takže /api/job/continue umí
// navázat, když funkce narazí na časový limit.
// Vyžaduje BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob) — bez něj vrací 501
// a klient spadne zpět na generování v prohlížeči.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { blobToken } from "@/lib/blob-token";
import { runJob, putJson, storyCreditCost } from "@/lib/job-runner";
import { SESSION_COOKIE, verifySessionToken, readAccount } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!blobToken()) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const body = await req.json();
    // 💳 Kreditní systém (návrh „na čisto"): jen pro přihlášené účty — anonymní/
    // rodinné použití v prohlížeči zůstává bez omezení, dokud se nerozhodne jinak.
    const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (username) {
      const cost = storyCreditCost(body);
      const acc = await readAccount(username);
      if (!acc || (acc.credits ?? 0) < cost) {
        return NextResponse.json(
          { error: `Nedostatek kreditů (potřeba ${cost}, máte ${acc?.credits ?? 0}). Dobijte kredit v účtu.` },
          { status: 402 }
        );
      }
      body.username = username; // ← job-runner podle něj po dokončení odečte kredit
    }
    const id = crypto.randomUUID();
    // Úvodní zápis stavu SYNCHRONNĚ — když Blob nefunguje (plné úložiště,
    // špatný token), vrátíme chybu hned místo „zombie" jobu, který nikdy
    // nezapíše stav a klient na něj marně čeká
    try {
      await putJson(`jobs/${id}/status.json`, { phase: "writing", createdAt: Date.now(), voiceId: String(body.voiceId || "") });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "blob write failed";
      console.error(`[job ${id}] initial status write failed:`, msg);
      return NextResponse.json({ error: `blob-write-failed: ${msg.slice(0, 160)}` }, { status: 500 });
    }
    // Zadání (pro /api/job/continue) + samotný job — už po odeslání odpovědi
    const work = putJson(`jobs/${id}/request.json`, body)
      .catch(e => console.error(`[job ${id}] request.json write failed:`, e))
      .then(() => runJob(id, body));
    try { waitUntil(work); } catch { /* local dev — the promise runs in-process */ }
    return NextResponse.json({ jobId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
