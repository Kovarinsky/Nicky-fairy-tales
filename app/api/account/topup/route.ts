// POST /api/account/topup — 🧪 TESTOVACÍ dobití kreditu (žádná platební brána
// zatím není napojená). Přičte pevný počet kreditů přihlášenému účtu, ať si
// lidé mohou vyzkoušet celý koloběh appky (dojdou kredity → dobít → pohádka
// znovu jde vygenerovat) ještě před napojením ostrého placení.

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, adjustCredits } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Kolik kreditů testovací dobití přidá najednou. */
export const TEST_TOPUP_CREDITS = 5;

export async function POST(req: NextRequest) {
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  const credits = await adjustCredits(username, TEST_TOPUP_CREDITS);
  if (credits === null) return NextResponse.json({ error: "account not found" }, { status: 404 });
  return NextResponse.json({ ok: true, credits });
}
