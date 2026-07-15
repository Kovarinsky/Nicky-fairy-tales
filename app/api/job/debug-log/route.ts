// GET /api/job/debug-log?id=<jobId> — přečte TRVALÝ diagnostický záznam běhu
// (debug-logs/<id>.json). Na rozdíl od /api/job/status funguje i pro
// zrušenou/dávno hotovou pohádku — appka ho zapisuje při KAŽDÉM kroku a
// úklid (job/cleanup) ho nemaže spolu s obrázky (jen po 30 dnech).

import { NextRequest, NextResponse } from "next/server";
import { head } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[a-z0-9-]{10,}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!blobToken()) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const h = await head(`debug-logs/${id}.json`, { token: blobToken() });
    const res = await fetch(`${h.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`blob fetch ${res.status}`);
    const record = await res.json();
    return NextResponse.json(record, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
