// POST /api/account/register { username, password, data? }
// Založí nový účet. Když appka pošle `data` (aktuální stav na tomhle
// zařízení — historie, postavy, světy, nastavení), rovnou se stane
// prvotním obsahem účtu, ať se při zakládání nic neztratí.

import { NextRequest, NextResponse } from "next/server";
import { blobToken } from "@/lib/blob-token";
import { normalizeUsername, hashPassword, createSessionToken, readAccount, writeAccount, SESSION_COOKIE } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 30;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  if (!blobToken()) return bad("Účty nejsou nastaveny (chybí Blob úložiště).", 501);
  let body: { username?: string; password?: string; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Neplatný požadavek.");
  }
  const username = normalizeUsername(String(body.username || ""));
  if (!username) return bad("Jméno smí mít 3–30 znaků: písmena, čísla, _ a -.");
  const password = String(body.password || "");
  if (password.length < 6) return bad("Heslo musí mít aspoň 6 znaků.");

  const existing = await readAccount(username);
  if (existing) return bad("Tohle jméno je už zabrané.", 409);

  const { salt, hash } = hashPassword(password);
  await writeAccount({
    username,
    salt,
    passwordHash: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: body.data ?? null,
  });

  const res = NextResponse.json({ ok: true, username });
  res.cookies.set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 180 * 24 * 3600,
  });
  return res;
}
