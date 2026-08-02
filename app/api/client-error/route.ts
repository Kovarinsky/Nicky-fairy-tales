// POST /api/client-error — appka sem posílá KAŽDOU chybu odchycenou error
// boundary (app/error.tsx, app/global-error.tsx). Dřív šla chyba jen do
// konzole prohlížeče, kterou v terénu nikdo nevidí — ladění byl odhad podle
// screenshotů. Každý report je vlastní soubor (žádný read-modify-write
// závod), GET pro přehled je chráněné stejně jako /api/admin/accounts.
import { NextRequest, NextResponse } from "next/server";
import { put, list } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function POST(req: NextRequest) {
  const token = blobToken();
  if (!token) return NextResponse.json({ ok: false }, { status: 501 });
  try {
    const body = await req.json();
    const record = {
      message: String(body?.message || "").slice(0, 2000),
      digest: body?.digest ? String(body.digest).slice(0, 200) : undefined,
      stack: body?.stack ? String(body.stack).slice(0, 4000) : undefined,
      url: body?.url ? String(body.url).slice(0, 500) : undefined,
      userAgent: body?.userAgent ? String(body.userAgent).slice(0, 300) : undefined,
      boundary: body?.boundary === "global" ? "global" : "error",
      ts: new Date().toISOString(),
    };
    const key = `logs/client-errors/${record.ts.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}.json`;
    await put(key, JSON.stringify(record), {
      access: "public",
      contentType: "application/json",
      token,
      addRandomSuffix: false,
    });
  } catch {
    // logování nikdy nesmí appce přidat DALŠÍ chybu — tichý fallback
  }
  return NextResponse.json({ ok: true });
}

/** Přehled posledních chyb — chráněno stejně jako /api/admin/accounts. */
export async function GET(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return NextResponse.json({ error: "ADMIN_PASSWORD není nastavené." }, { status: 501 });
  if (req.headers.get("x-admin-password") !== adminPassword) {
    return NextResponse.json({ error: "Neplatné heslo." }, { status: 401 });
  }
  const token = blobToken();
  if (!token) return NextResponse.json({ error: "Blob úložiště není nastavené." }, { status: 501 });

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit")) || 100, 500);
  const items: unknown[] = [];
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore && items.length < limit) {
    const page = await list({ prefix: "logs/client-errors/", cursor, token, limit: 200 });
    for (const b of page.blobs) {
      try {
        const res = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" });
        if (res.ok) items.push(await res.json());
      } catch {}
    }
    cursor = page.cursor;
    hasMore = page.hasMore;
  }
  items.sort((a, b) => String((b as { ts?: string }).ts || "").localeCompare(String((a as { ts?: string }).ts || "")));
  return NextResponse.json({ errors: items.slice(0, limit) });
}
