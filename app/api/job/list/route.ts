import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";

// 🩺 Diagnostika: přehled stavů všech jobů (fáze, chyby, restarty) —
// otevřete /api/job/list v prohlížeči, když se něco zasekne.
// Neobsahuje žádná tajemství (jen názvy pohádek a chybové hlášky).

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET() {
  if (!blobToken()) return NextResponse.json({ error: "Blob není nastaven." }, { status: 501 });
  try {
    const { blobs } = await list({ prefix: "jobs/", token: blobToken(), limit: 1000 });
    const statuses = blobs
      .filter(b => b.pathname.endsWith("/status.json"))
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, 12);
    const jobs = await Promise.all(statuses.map(async b => {
      try {
        const r = await fetch(b.url, { cache: "no-store" });
        const st = await r.json();
        return {
          id: b.pathname.split("/")[1],
          title: st.title ?? null,
          phase: st.phase,
          done: st.done ?? 0,
          total: st.total ?? 0,
          restarts: st.restarts ?? 0,
          error: st.error ?? null,
          lastError: st.lastError ?? null,
          imgError: st.imgError ?? null,
          updatedAt: st.updatedAt ? new Date(st.updatedAt).toISOString() : null,
          createdAt: st.createdAt ? new Date(st.createdAt).toISOString() : null,
        };
      } catch {
        return { id: b.pathname.split("/")[1], phase: "unreadable" };
      }
    }));
    return NextResponse.json({ jobs }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "list failed" }, { status: 500 });
  }
}
