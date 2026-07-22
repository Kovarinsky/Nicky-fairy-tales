// GET /api/admin/accounts — developerský přehled: kdo appku používá, kolik
// kreditů má, kolik pohádek dokončil. Chráněno jednoduchým heslem v env
// (ADMIN_PASSWORD) posílaným v hlavičce X-Admin-Password — žádný další účet
// navíc netřeba. Nikdy nevrací salt/passwordHash.

import { NextRequest, NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";
import type { AccountRecord } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: "ADMIN_PASSWORD není nastavené." }, { status: 501 });
  }
  if (req.headers.get("x-admin-password") !== adminPassword) {
    return NextResponse.json({ error: "Neplatné heslo." }, { status: 401 });
  }
  if (!blobToken()) {
    return NextResponse.json({ error: "Blob úložiště není nastavené." }, { status: 501 });
  }

  const accounts: Array<Pick<AccountRecord, "username" | "email" | "credits" | "storiesCompleted" | "createdAt" | "updatedAt">> = [];
  let cursor: string | undefined;
  let hasMore = true;
  while (hasMore) {
    const page = await list({ prefix: "accounts/", cursor, token: blobToken(), limit: 200 });
    for (const b of page.blobs) {
      try {
        const res = await fetch(`${b.url}?t=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) continue;
        const acc = (await res.json()) as AccountRecord;
        accounts.push({
          username: acc.username,
          email: acc.email,
          credits: acc.credits ?? 0,
          storiesCompleted: acc.storiesCompleted ?? 0,
          createdAt: acc.createdAt,
          updatedAt: acc.updatedAt,
        });
      } catch { /* přeskočit poškozený záznam */ }
    }
    hasMore = page.hasMore;
    cursor = page.cursor;
  }

  accounts.sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
  return NextResponse.json({ accounts });
}
