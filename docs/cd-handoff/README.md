# Handoff: Nickyho pohádky — vFinal2 (implementation-ready addendum)

**Start here:** `MASTER-SPEC-vFinal2.md` — summarizes what's new in this package and the 7 previously-open decisions, all now resolved. It links out to everything else.

## Contents
- `MASTER-SPEC-vFinal2.md` — read first.
- `MASTER-SPEC-vFinal1.md` — prior round's full spec (screen inventory, component states, responsive rules, motion/gesture spec) — still the base reference for anything not restated in vFinal2.
- `classic-tales.final.json` — all 34 classic tales, machine-readable, final CZ/EN names.
- `focal-points.final.json` — all 54 assets, manually reviewed focal points/safe zones/object-position/coverSafe.
- `copy-cz-en.md` — full CZ/EN string sheet (carried over, still current).
- `FONT-USAGE.md` — final Alegreya/Nunito confirmation + `next/font/google` setup.
- `prototypes/` — 3 new interactive `.dc.html` tools:
  - `New Screens 11-21.dc.html` — all 11 newly-specified screens, live, with every required state switchable.
  - `Crop Review.dc.html` — focal-point/object-position visual review across 4 breakpoints.
  - `Responsive Reference.dc.html` — the 3 layout-archetype responsive rules, live.
- `responsive-reference/responsive-rules-sheet.png` — a static rendered capture of the above for pixel reference without needing to run the prototype.
- `screens/` — the 4 original `.dc.html` screens (Home, Vyber pohady, Hlas, Ctecka) + `Asset Review.dc.html`, carried over unchanged from the prior package.
- `nextjs/` — all React components: the original 10 (with 3 patched: `StoryCatalogScreen`, `StoryWorldStep`, `HomeScreen`) plus 9 new ones for screens 11–21, plus `tokens.css` (shared design tokens, imported by every module).
- `assets/` — WebP thumbnails + full-size images (from the prior package, unchanged).
- `progress-notes-2026-07-29.md` — original session notes, unchanged, kept for history.

## Fidelity
High-fidelity for the 10 originally-built screens (unchanged). The 11 newly-specified screens (11–21) are now high-fidelity **interactive prototypes** (not just prose) in `prototypes/New Screens 11-21.dc.html`, and have matching props-driven React components in `nextjs/`.

## What NOT to do
Do not treat this as a redesign invitation — no new features or visual-direction changes were introduced in this pass; it only resolves ambiguity and adds missing implementation artifacts (data files, prototypes, decisions, fonts) on top of the same visual system documented in vFinal1.
