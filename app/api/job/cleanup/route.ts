// POST /api/job/cleanup { keepIds: string[] } — smaže z Vercel Blob data jobů,
// které už vypadly z historie posledních pohádek (úložiště tak neroste donekonečna).
// Bezpečnostní pojistky: maže jen pod prefixem jobs/, nikdy joby mladší 24 h
// (mohou ještě běžet) a nikdy id uvedená v keepIds.

import { NextRequest, NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 60;

// Nemazat čerstvé joby (mohou ještě běžet) — běžící navíc chrání keepIds
const MIN_AGE_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (!blobToken()) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const keep = new Set<string>(
      Array.isArray(body?.keepIds) ? body.keepIds.filter((x: unknown) => typeof x === "string") : []
    );
    // deleteIds = joby ke smazání OKAMŽITĚ (telefon už si pohádku stáhl)
    const deleteNow = new Set<string>(
      Array.isArray(body?.deleteIds) ? body.deleteIds.filter((x: unknown) => typeof x === "string") : []
    );

    // Projít všechny bloby pod jobs/ a posbírat kandidáty na smazání
    const toDelete: string[] = [];
    const jobsSeen = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "jobs/", cursor, limit: 1000, token: blobToken() });
      for (const blob of page.blobs) {
        const m = blob.pathname.match(/^jobs\/([^/]+)\//);
        if (!m) continue;
        const id = m[1];
        jobsSeen.add(id);
        if (deleteNow.has(id)) { toDelete.push(blob.url); continue; }
        if (keep.has(id)) continue;
        if (Date.now() - new Date(blob.uploadedAt).getTime() < MIN_AGE_MS) continue;
        toDelete.push(blob.url);
      }
      cursor = page.cursor;
    } while (cursor);

    // Mazat po dávkách
    for (let i = 0; i < toDelete.length; i += 100) {
      await del(toDelete.slice(i, i + 100), { token: blobToken() });
    }

    return NextResponse.json({ jobsTotal: jobsSeen.size, blobsDeleted: toDelete.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
