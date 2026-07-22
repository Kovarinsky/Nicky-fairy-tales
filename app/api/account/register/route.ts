// POST /api/account/register { username, email, data? }
// Založí nový účet. Heslo appka VYGENERUJE sama a pošle e-mailem (žádné
// heslo od klienta) — e-mail tak zároveň slouží jako tracking, kdo appku
// používá, a jako jediný způsob, jak se uživatel k heslu vůbec dostane.
// Když appka pošle `data` (aktuální stav na tomhle zařízení — historie,
// postavy, světy, nastavení), rovnou se stane prvotním obsahem účtu.

import { NextRequest, NextResponse } from "next/server";
import { blobToken } from "@/lib/blob-token";
import {
  normalizeUsername, hashPassword, createSessionToken, readAccount, writeAccount,
  SESSION_COOKIE, SIGNUP_FREE_CREDITS, generateTempPassword, EMAIL_RE,
} from "@/lib/accounts";
import { sendMail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 30;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(req: NextRequest) {
  if (!blobToken()) return bad("Účty nejsou nastaveny (chybí Blob úložiště).", 501);
  if (!process.env.RESEND_API_KEY) return bad("Odesílání hesla e-mailem není zatím nastaveno (chybí RESEND_API_KEY).", 501);
  let body: { username?: string; email?: string; data?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Neplatný požadavek.");
  }
  const username = normalizeUsername(String(body.username || ""));
  if (!username) return bad("Jméno smí mít 3–30 znaků: písmena, čísla, _ a -.");
  const email = String(body.email || "").trim();
  if (!EMAIL_RE.test(email)) return bad("Zadejte platný e-mail — pošleme na něj heslo.");

  const existing = await readAccount(username);
  if (existing) return bad("Tohle jméno je už zabrané.", 409);

  const password = generateTempPassword();
  const { salt, hash } = hashPassword(password);
  await writeAccount({
    username,
    email,
    salt,
    passwordHash: hash,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: body.data ?? null,
    credits: SIGNUP_FREE_CREDITS, // 💳 2 kredity na vyzkoušení zdarma
  });

  try {
    await sendMail(
      email,
      "Vaše heslo do Nickyho pohádky",
      `<p>Ahoj <b>${username}</b>,</p>
       <p>vítej v Nickyho pohádkách! Tvoje přihlašovací heslo je:</p>
       <p style="font-size:22px;font-weight:bold;letter-spacing:1px;">${password}</p>
       <p>Přihlas se jménem <b>${username}</b> a tímto heslem. Na start máš ${SIGNUP_FREE_CREDITS} kredity zdarma na vyzkoušení.</p>`
    );
  } catch (e) {
    // Účet se vytvořil, ale bez doručeného hesla se uživatel nemá jak
    // přihlásit — jasně to říct, ať zkusí "Zapomenuté heslo" o chvíli později
    console.error(`[register] sendMail selhalo pro ${username}:`, e);
    return NextResponse.json(
      { error: "Účet je vytvořen, ale heslo se nepodařilo odeslat e-mailem. Zkuste prosím za chvíli 'Zapomenuté heslo'." },
      { status: 502 }
    );
  }

  const res = NextResponse.json({ ok: true, username, credits: SIGNUP_FREE_CREDITS });
  res.cookies.set(SESSION_COOKIE, createSessionToken(username), {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 180 * 24 * 3600,
  });
  return res;
}
