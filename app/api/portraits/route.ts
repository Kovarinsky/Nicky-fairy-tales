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
// GET /api/portraits?goodnight=id1,id2 — zajistí (nebo namaluje) závěrečný
// "dobrou noc" obrázek titulky NA MÍRU danému obsazení (getGoodnightScene) —
// appka volá živě z čtečky s ID postav TÉTO konkrétní pohádky. &force=1
// přeskočí cache a namaluje znovu.

import { NextRequest, NextResponse } from "next/server";
import { loadCharacters, charactersByIds } from "@/lib/characters";
import {
  getCharacterPortrait, portraitUrl,
  getFamilyGroupAnchor, familyGroupAnchorUrl,
  generateFamilyGroupAnchorCandidates, promoteFamilyGroupAnchorCandidate,
  generateCharacterPortraitCandidates, promoteCharacterPortraitCandidate,
  getFamilyScaleSheet, familyScaleSheetUrl,
  getGoodnightScene, goodnightSceneUrl,
} from "@/lib/portraits";

export const runtime = "nodejs";
export const maxDuration = 300;

// 🎨 2026-08-10: "táta Jan se mi ještě nelíbí, chci aby se víc podobal mě —
// připrav 3 varianty" — 3 popisné varianty odvozené z nové fotky
// (jan-face4.jpg, horská bouda) proti dosavadnímu textu v characters.json.
// Jen data pro ?portraitCandidates=jan — žádnou z nich appka nepoužívá,
// dokud se ručně nepromuje (viz generateCharacterPortraitCandidates výš).
const PORTRAIT_VARIANTS: Record<string, Array<{ label: string; description: string }>> = {
  jan: [
    {
      label: "A — upřesněný pramen (widow's peak) místo rovné hranice",
      description: "Jan: adult man with a NOTICEABLY HIGH, RECEDED HAIRLINE — hair recedes MORE at the temples on both sides, leaving a distinct central point/peak of hair (a soft widow's peak) at the front-center of the scalp, NOT a straight uniform line across the whole forehead. Short medium-brown hair (not jet-black), slightly tousled/textured, not perfectly neat. Thin, straight, NOT bushy eyebrows. Deep-set warm dark-brown eyes with visible fine character lines/creases at the outer corners, a slight furrow between the brows even at rest. A straight, moderate-width nose. A LEAN, NARROW, slightly angular jawline and chin — NOT a wide or heavy/strong jaw. Visible smile lines (nasolabial folds) framing the mouth. Clean-shaven, NO beard, moustache or stubble. Fair light skin with a light tan, warm smile, navy-blue polo shirt with white horizontal stripes, navy shorts, white sneakers, tall lean-athletic build.",
    },
    {
      label: "B — jako A, ale s lehkým strniskem (na všech fotkách viditelné)",
      description: "Jan: adult man with a NOTICEABLY HIGH, RECEDED HAIRLINE — hair recedes MORE at the temples on both sides, leaving a distinct central point/peak of hair (a soft widow's peak) at the front-center of the scalp, NOT a straight uniform line across the whole forehead. Short medium-brown hair (not jet-black), slightly tousled/textured, not perfectly neat. Thin, straight, NOT bushy eyebrows. Deep-set warm dark-brown eyes with visible fine character lines/creases at the outer corners, a slight furrow between the brows even at rest. A straight, moderate-width nose. A LEAN, NARROW, slightly angular jawline and chin — NOT a wide or heavy/strong jaw, framed by a SHORT LIGHT STUBBLE BEARD (a few days' growth, not a full beard, not clean-shaven) — this stubble is a KEY recognizable feature, always present. Visible smile lines (nasolabial folds) framing the mouth. Fair light skin with a light tan, warm smile, navy-blue polo shirt with white horizontal stripes, navy shorts, white sneakers, tall lean-athletic build.",
    },
    {
      label: "C — kompletně přepsáno přímo z nové fotky (horská bouda)",
      description: "Jan: a fit, athletic adult man in his 40s. RECEDING HAIRLINE with a soft widow's-peak point at the center-front and bare skin visible higher up at both temples — short, slightly messy medium-brown hair (a few strands falling loosely over the forehead), not neat/combed. SHORT LIGHT STUBBLE BEARD covering the jaw and upper lip (a few days' growth, always present, never clean-shaven). Deep-set brown eyes under a slight, natural brow furrow (an alert, focused expression even when smiling), thin straight eyebrows, a straight moderate nose, and a lean angular jaw. Fair skin with a light outdoor tan. Big genuine smile showing teeth, faint smile-lines around the mouth. Navy-blue polo shirt with white horizontal stripes, navy shorts, white sneakers, tall lean-athletic build with visible toned shoulders/arms.",
    },
  ],
};

export async function GET(req: NextRequest) {
  const redraw = req.nextUrl.searchParams.get("redraw") || "";
  const anchorParam = req.nextUrl.searchParams.get("anchor") || "";
  const scaleParam = req.nextUrl.searchParams.get("scale") || "";
  const goodnightParam = req.nextUrl.searchParams.get("goodnight") || "";
  const portraitCandidatesParam = req.nextUrl.searchParams.get("portraitCandidates") || "";
  const promotePortraitParam = req.nextUrl.searchParams.get("promotePortrait") || "";

  if (portraitCandidatesParam) {
    const variants = PORTRAIT_VARIANTS[portraitCandidatesParam];
    const [baseChar] = charactersByIds([portraitCandidatesParam]);
    if (!variants || !baseChar) {
      return NextResponse.json({ error: `Žádné varianty definované pro "${portraitCandidatesParam}".` }, { status: 400 });
    }
    const candidates = await generateCharacterPortraitCandidates(baseChar, variants);
    return NextResponse.json(
      { candidates, hint: "?promotePortrait=<id>&pick=<index> povýší vybraného kandidáta na finální portrét (popis v characters.json je nutné upravit ručně na text té varianty)" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
  if (promotePortraitParam) {
    const pick = Number(req.nextUrl.searchParams.get("pick"));
    const url = pick ? await promoteCharacterPortraitCandidate(promotePortraitParam, pick) : null;
    return NextResponse.json({ promoted: !!url, url }, { headers: { "Cache-Control": "no-store" } });
  }

  if (goodnightParam) {
    const ids = goodnightParam.split(",").map(s => s.trim()).filter(Boolean);
    const force = req.nextUrl.searchParams.get("force") === "1";
    const existingUrl = force ? null : await goodnightSceneUrl(ids);
    const goodnight = existingUrl
      ? { url: existingUrl, drawn: false }
      : await getGoodnightScene(ids, force).then(async r => ({ url: r ? await goodnightSceneUrl(ids) : null, drawn: !!r }));
    return NextResponse.json({ goodnight }, { headers: { "Cache-Control": "no-store" } });
  }

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
