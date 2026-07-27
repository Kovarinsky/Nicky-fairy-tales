// POST /api/account/update { email? } | { currentPassword, newPassword }
// Změna e-mailu nebo hesla už přihlášeného účtu (viz AccountModal) — appka
// to dřív uměla nastavit jen PŘI registraci, ne pak dodatečně.

import { NextRequest, NextResponse } from "next/server";
import {
  verifySessionToken, SESSION_COOKIE, readAccount, writeAccount,
  hashPassword, verifyPassword, EMAIL_RE,
} from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 30;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return bad("Nejste přihlášeni.", 401);
  let body: { email?: string; currentPassword?: string; newPassword?: string };
  try {
    body = await req.json();
  } catch {
    return bad("Neplatný požadavek.");
  }
  const acc = await readAccount(username);
  if (!acc) return bad("Účet nenalezen.", 404);

  if (typeof body.newPassword === "string") {
    if (!verifyPassword(String(body.currentPassword || ""), acc.salt, acc.passwordHash)) {
      return bad("Stávající heslo nesedí.");
    }
    if (body.newPassword.length < 6) return bad("Nové heslo musí mít aspoň 6 znaků.");
    const { salt, hash } = hashPassword(body.newPassword);
    acc.salt = salt;
    acc.passwordHash = hash;
  } else if (typeof body.email === "string") {
    const email = body.email.trim();
    if (email && !EMAIL_RE.test(email)) return bad("Neplatný e-mail.");
    acc.email = email || undefined;
  } else {
    return bad("Nic k uložení.");
  }
  acc.updatedAt = Date.now();
  await writeAccount(acc);
  return NextResponse.json({ ok: true, email: acc.email ?? null });
}
