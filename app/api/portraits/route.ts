// GET /api/portraits — náhled portrétové kartotéky postav.
// Zajistí, že každá vestavěná postava má namalovaný kanonický portrét
// (chybějící se namalují teď), a vrátí jejich URL k prohlédnutí.
// GET /api/portraits?redraw=<id> — portrét dané postavy namaluje ZNOVU
// (když se nepovedl) a přepíše ho pro všechny další pohádky.

import { NextRequest, NextResponse } from "next/server";
import { loadCharacters } from "@/lib/characters";
import { getCharacterPortrait, portraitUrl } from "@/lib/portraits";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const redraw = req.nextUrl.searchParams.get("redraw") || "";
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
  return NextResponse.json(
    { portraits: out, hint: "?redraw=<id> namaluje portrét znovu" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
