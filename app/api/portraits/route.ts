// GET /api/portraits — náhled portrétové kartotéky postav.
// Zajistí, že každá vestavěná postava má namalovaný kanonický portrét
// (chybějící se namalují teď), a vrátí jejich URL k prohlédnutí.
// GET /api/portraits?redraw=<id> — portrét dané postavy namaluje ZNOVU
// (když se nepovedl) a přepíše ho pro všechny další pohádky.
// GET /api/portraits?anchor=1 — zajistí i skupinovou kotvu celé rodiny
// (ECONOMY-PLAN.md Fáze 2, lib/portraits.ts getFamilyGroupAnchor) a vrátí
// její URL; ?anchor=redraw ji namaluje znovu i když už existuje.

import { NextRequest, NextResponse } from "next/server";
import { loadCharacters } from "@/lib/characters";
import { getCharacterPortrait, portraitUrl, getFamilyGroupAnchor, familyGroupAnchorUrl } from "@/lib/portraits";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const redraw = req.nextUrl.searchParams.get("redraw") || "";
  const anchorParam = req.nextUrl.searchParams.get("anchor") || "";
  const chars = loadCharacters();
  const out: Array<{ id: string; name: string; url: string | null; drawn: boolean }> = [];
  for (const c of chars) {
    const force = redraw === c.id;
    // Portrét, co už existuje a nenutíme překreslení: stačí 1 head() na URL —
    // getCharacterPortrait by navíc zbytečně stáhl celý obrázek jen kvůli
    // in-memory cache, kterou tenhle přehledový endpoint vůbec nepotřebuje.
    const existingUrl = force ? null : await portraitUrl(c);
    if (existingUrl) {
      out.push({ id: c.id, name: c.name, url: existingUrl, drawn: false });
      continue;
    }
    const p = await getCharacterPortrait(c, force);
    out.push({
      id: c.id,
      name: c.name,
      url: p ? await portraitUrl(c) : null,
      drawn: !!p,
    });
  }

  let groupAnchor: { url: string | null; drawn: boolean } | undefined;
  if (anchorParam) {
    const forceAnchor = anchorParam === "redraw";
    const existingAnchorUrl = forceAnchor ? null : await familyGroupAnchorUrl();
    if (existingAnchorUrl) {
      groupAnchor = { url: existingAnchorUrl, drawn: false };
    } else {
      const a = await getFamilyGroupAnchor();
      groupAnchor = { url: a ? await familyGroupAnchorUrl() : null, drawn: !!a };
    }
  }

  return NextResponse.json(
    { portraits: out, groupAnchor, hint: "?redraw=<id> namaluje portrét znovu, ?anchor=1 zajistí/namaluje skupinovou kotvu (?anchor=redraw ji vynutí znovu)" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
