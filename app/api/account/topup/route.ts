// POST /api/account/topup — 🧪 TESTOVACÍ dobití kreditu (žádná platební brána
// zatím není napojená). Přičte pevný počet kreditů přihlášenému účtu, ať si
// lidé mohou vyzkoušet celý koloběh appky (dojdou kredity → dobít → pohádka
// znovu jde vygenerovat) ještě před napojením ostrého placení.
//
// 💳 Skutečná platba (příště): appka nemá vlastní kartový vstup ani
// neukládá platební údaje — nejbližší kandidáti na napojení jsou Stripe
// Checkout (webová appka, jednorázový nákup kreditů) nebo Google Play
// Billing (až appka poběží jako obalená mobilní appka). Tohle tlačítko a
// endpoint zůstávají jako testovací zástupce, dokud se nerozhodne který.

import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE, adjustCredits } from "@/lib/accounts";

export const runtime = "nodejs";
export const maxDuration = 15;

/** Kolik kreditů testovací dobití přidá najednou. Pod novým cenovým modelem
 *  (1 kredit = 1 Kč nákladů + 50% marže, viz lib/pricing.ts) typická
 *  pohádka stojí řádově 50–70 kreditů — 100 pokryje zhruba jednu. */
const TEST_TOPUP_CREDITS = 100;

export async function POST(req: NextRequest) {
  const username = verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!username) return NextResponse.json({ error: "not logged in" }, { status: 401 });
  const credits = await adjustCredits(username, TEST_TOPUP_CREDITS);
  if (credits === null) return NextResponse.json({ error: "account not found" }, { status: 404 });
  return NextResponse.json({ ok: true, credits });
}
