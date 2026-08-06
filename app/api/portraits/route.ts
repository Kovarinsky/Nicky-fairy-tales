// GET /api/portraits — náhled portrétové kartotéky postav.
// Zajistí, že každá vestavěná postava má namalovaný kanonický portrét
// (chybějící se namalují teď), a vrátí jejich URL k prohlédnutí.
// GET /api/portraits?redraw=<id> — portrét dané postavy namaluje ZNOVU
// (když se nepovedl) a přepíše ho pro všechny další pohádky.
// GET /api/portraits?anchor=1 — zajistí i skupinovou kotvu celé rodiny
// (ECONOMY-PLAN.md Fáze 2, lib/portraits.ts getFamilyGroupAnchor) a vrátí
// její URL; ?anchor=redraw ji namaluje znovu i když už existuje.
// GET /api/portraits?anchor=candidates[&n=3] — vygeneruje N (default 3)
// KANDIDÁTNÍCH variant skupinové kotvy (různá prostředí) na DOČASNÉ cesty,
// appka je zatím nepoužívá jako referenci — jen k ručnímu výběru.
// GET /api/portraits?anchor=promote&pick=<index> — vybraného kandidáta
// povýší na finální kotvu (kopie bajtů, žádné nové placené generování).
// Obě anchor=candidates/promote NEprocházejí portrétovou smyčku výš (ať
// se vedlejším efektem znovu nepokusí dokreslit chybějící sólo portréty).
// GET /api/portraits?scale=1 — zajistí i celorodinný výškový list
// (getFamilyScaleSheet) a vrátí jeho URL; ?scale=redraw ho namaluje znovu.

import { NextRequest, NextResponse } from "next/server";
import { loadCharacters } from "@/lib/characters";
import {
  getCharacterPortrait, portraitUrl,
  getFamilyGroupAnchor, familyGroupAnchorUrl,
  generateFamilyGroupAnchorCandidates, promoteFamilyGroupAnchorCandidate,
  getFamilyScaleSheet, familyScaleSheetUrl,
} from "@/lib/portraits";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const redraw = req.nextUrl.searchParams.get("redraw") || "";
  const anchorParam = req.nextUrl.searchParams.get("anchor") || "";
  const scaleParam = req.nextUrl.searchParams.get("scale") || "";

  if (scaleParam) {
    // 🩺 2026-08-06: getFamilyScaleSheet() dřív neuměla přijmout force vůbec
    // — i tady spočítané forceScale se nikam nepředávalo, takže "?scale=redraw"
    // tiše vrátilo starý cachovaný obrázek (appka to zjistila živě: runtime
    // logy neukázaly žádné nové generování, i když endpoint hlásil drawn:true).
    const forceScale = scaleParam === "redraw";
    const existingScaleUrl = forceScale ? null : await familyScaleSheetUrl();
    const scaleSheet = existingScaleUrl
      ? { url: existingScaleUrl, drawn: false }
      : await getFamilyScaleSheet(forceScale).then(async s => ({ url: s ? await familyScaleSheetUrl() : null, drawn: !!s }));
    return NextResponse.json({ scaleSheet }, { headers: { "Cache-Control": "no-store" } });
  }

  if (anchorParam === "candidates") {
    const n = Math.max(1, Math.min(3, Number(req.nextUrl.searchParams.get("n")) || 3));
    const settingParam = req.nextUrl.searchParams.get("setting");
    const settingIndex = settingParam != null && settingParam !== "" ? Number(settingParam) : undefined;
    const candidates = await generateFamilyGroupAnchorCandidates(n, settingIndex);
    return NextResponse.json(
      { candidates, hint: "?anchor=promote&pick=<index> povýší vybraného kandidáta na finální kotvu" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  if (anchorParam === "promote") {
    const pick = Number(req.nextUrl.searchParams.get("pick"));
    const url = pick ? await promoteFamilyGroupAnchorCandidate(pick) : null;
    return NextResponse.json({ promoted: !!url, url }, { headers: { "Cache-Control": "no-store" } });
  }

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
    // 🩺 stejná díra jako u scale výš — force se dřív nepředávalo dál.
    const forceAnchor = anchorParam === "redraw";
    const existingAnchorUrl = forceAnchor ? null : await familyGroupAnchorUrl();
    if (existingAnchorUrl) {
      groupAnchor = { url: existingAnchorUrl, drawn: false };
    } else {
      const a = await getFamilyGroupAnchor(forceAnchor);
      groupAnchor = { url: a ? await familyGroupAnchorUrl() : null, drawn: !!a };
    }
  }

  return NextResponse.json(
    { portraits: out, groupAnchor, hint: "?redraw=<id> namaluje portrét znovu, ?anchor=1 zajistí/namaluje skupinovou kotvu (?anchor=redraw ji vynutí znovu)" },
    { headers: { "Cache-Control": "no-store" } }
  );
}
