// POST /api/job/continue { id } — naváže na přerušený serverový job.
// Když funkce /api/job/start narazí na 5min limit Vercelu (dlouhé pohádky),
// klient si při pollování všimne, že se stav dlouho nehýbe, a zavolá tenhle
// endpoint. Ten načte původní zadání z Blobu a runJob dodělá jen chybějící
// scény (napsaný příběh i hotové obrázky se přeskočí).

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { blobToken } from "@/lib/blob-token";
import { runJob, readJson, type JobStatus } from "@/lib/job-runner";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!blobToken()) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const { id } = await req.json();
    if (typeof id !== "string" || !/^[a-z0-9-]{10,}$/i.test(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    const status = await readJson<JobStatus>(`jobs/${id}/status.json`);
    if (status?.phase === "done") {
      return NextResponse.json({ ok: true, alreadyDone: true });
    }
    // Pojistka proti zbytečnému dvojímu běhu: když status před chvílí ožil,
    // původní funkce nejspíš stále běží
    if (status?.updatedAt && Date.now() - status.updatedAt < 60_000) {
      return NextResponse.json({ ok: true, stillRunning: true });
    }
    const body = await readJson<Record<string, unknown>>(`jobs/${id}/request.json`);
    if (!body) {
      return NextResponse.json({ error: "request-not-found" }, { status: 404 });
    }
    const job = runJob(id, body);
    try { waitUntil(job); } catch { /* local dev */ }
    return NextResponse.json({ ok: true, resumed: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
