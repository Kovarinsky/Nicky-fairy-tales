// POST /api/account/login { username, password } → nastaví přihlašovací
// cookie a vrátí uložený stav účtu (appka si ho na zařízení sloučí/obnoví).

import { NextRequest, NextResponse } from "next/server";
import { blobToken } from "@/lib/blob-token";
import { normalizeUsername, verifyPassword, createSessionToken, readAccount, SESSION_COOKIE } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 30;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  if (!blobToken()) return bad("Účty nejsou nastaveny (chybí Blob úložiště).", 501);
  let body: { username?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return bad("Neplatný požadavek.");
  }
  const username = normalizeUsername(String(body.username || ""));
  const password = String(body.password || "");
  if (!username || !password) return bad("Zadejte jméno i heslo.");

  const account = await readAccount(username);
  // Stejná chyba pro „neexistuje" i „špatné heslo" — nedávat útočníkovi
  // najevo, jestli jméno existuje
  if (!account || !verifyPassword(password, account.salt, account.passwordHash)) {
    return bad("Špatné jméno nebo heslo.", 401);
  }

  const res = NextResponse.json({ ok: true, username, data: account.data ?? null, credits: account.credits ?? 0 });
  res.cookies.set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 180 * 24 * 3600,
  });
  return res;
}
