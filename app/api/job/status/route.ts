// GET /api/job/status?id=<jobId> — vrátí aktuální stav serverového jobu
// (čte jobs/<id>/status.json z Vercel Blob, s cache-bustem).

import { NextRequest, NextResponse } from "next/server";
import { head } from "@vercel/blob";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") || "";
  if (!/^[a-z0-9-]{10,}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const h = await head(`jobs/${id}/status.json`);
    const res = await fetch(`${h.url}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`blob fetch ${res.status}`);
    const status = await res.json();
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "not-found" }, { status: 404 });
  }
}
