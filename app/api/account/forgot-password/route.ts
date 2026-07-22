// POST /api/account/forgot-password { username } → vygeneruje NOVÉ heslo
// a pošle ho na e-mail uložený u účtu. Odpověď je vždy stejná (ať účet
// existuje, nebo ne) — nedávat útočníkovi najevo, jestli jméno existuje.

import { NextRequest, NextResponse } from "next/server";
import { blobToken } from "@/lib/blob-token";
import { normalizeUsername, hashPassword, readAccount, writeAccount, generateTempPassword } from "@/lib/accounts";
import { sendMail } from "@/lib/email";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  if (!blobToken() || !process.env.RESEND_API_KEY) {
    return NextResponse.json({ error: "Obnova hesla e-mailem není zatím nastavena." }, { status: 501 });
  }
  let body: { username?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const username = normalizeUsername(String(body.username || ""));
  if (username) {
    const acc = await readAccount(username);
    if (acc?.email) {
      const password = generateTempPassword();
      const { salt, hash } = hashPassword(password);
      acc.salt = salt;
      acc.passwordHash = hash;
      acc.updatedAt = Date.now();
      await writeAccount(acc);
      await sendMail(
        acc.email,
        "Nové heslo do Nickyho pohádky",
        `<p>Ahoj <b>${username}</b>,</p>
         <p>tady je tvoje nové přihlašovací heslo:</p>
         <p style="font-size:22px;font-weight:bold;letter-spacing:1px;">${password}</p>
         <p>Staré heslo už neplatí.</p>`
      ).catch(e => console.error(`[forgot-password] sendMail selhalo pro ${username}:`, e));
    }
  }
  // Stejná odpověď vždy — i pro neexistující jméno
  return NextResponse.json({ ok: true });
}
