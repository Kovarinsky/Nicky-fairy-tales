// GET  /api/account/sync → vrátí uložený stav účtu (historie, postavy,
//      světy, nastavení) — appka ho po přihlášení stáhne a sloučí.
// POST /api/account/sync { data } → přepíše stav účtu (appka volá po každé
//      změně, s prodlevou, ať se nezapisuje při každém úhozu).

import { NextRequest, NextResponse } from "next/server";
import { blobToken } from "@/lib/blob-token";
import { verifySessionToken, readAccount, writeAccount, SESSION_COOKIE } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_DATA_BYTES = 8 * 1024 * 1024; // 8 MB — jen text (žádné obrázky/audio)

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function GET(req: NextRequest) {
  if (!blobToken()) return bad("Účty nejsou nastaveny (chybí Blob úložiště).", 501);
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return bad("Nepřihlášeno.", 401);
  const account = await readAccount(username);
  if (!account) return bad("Účet nenalezen.", 404);
  return NextResponse.json({ data: account.data ?? null });
}

export async function POST(req: NextRequest) {
  if (!blobToken()) return bad("Účty nejsou nastaveny (chybí Blob úložiště).", 501);
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return bad("Nepřihlášeno.", 401);
  let body: { data?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Neplatný požadavek.");
  }
  const json = JSON.stringify(body.data ?? null);
  if (Buffer.byteLength(json, "utf8") > MAX_DATA_BYTES) return bad("Data na sync jsou moc velká.", 413);
  const account = await readAccount(username);
  if (!account) return bad("Účet nenalezen.", 404);
  await writeAccount({ ...account, data: body.data ?? null, updatedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
