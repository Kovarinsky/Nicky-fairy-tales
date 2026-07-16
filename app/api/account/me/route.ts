// GET /api/account/me → { username } když je appka přihlášená, jinak 401.
// Voláno při startu appky, ať ví, jestli má nabídnout přihlášení, nebo
// rovnou ukázat jméno účtu.

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/accounts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  return NextResponse.json({ username });
}
