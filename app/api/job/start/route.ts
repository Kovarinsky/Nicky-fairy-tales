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
import { runJob, putJson } from "@/lib/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!blobToken()) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const body = await req.json();
    const id = crypto.randomUUID();
    // Zadání stranou (pro /api/job/continue) + samotný job — obojí až PO
    // odeslání odpovědi, aby start nikdy nečekal na Blob a klient nespadl
    // do lokálního generování kvůli pomalé odpovědi
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
