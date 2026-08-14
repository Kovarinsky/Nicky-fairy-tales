# Nickyho pohádky — FINAL DESIGN SYSTEM HANDOFF (vFinal3)

Source-of-truth package for pixel-accurate implementation. Start here, then follow the links below in order.

## 1. Screen flow
`navigation-state-map.md` — all 12 screens: route/state, primary CTA, Back behavior, loading/error/empty states, full-screen vs. modal vs. sheet, plus a flow diagram.

## 2. Responsivity
`breakpoints.md` — 360×800 / 390×844 / 430×932 / tablet / desktop. Core rule: **this is a mobile app that renders inside a centered ~430px frame at every breakpoint — it never stretches to fill a desktop monitor.**

## 3. Asset manifest
- `focal-points.final.json` — all 54 world/tale illustrations, manually reviewed: focal point, safe zone, object-position, cover-safety, device variants.
- `classic-tales.final.json` — all 34 classic tales: id, CZ/EN names, group, descriptions, age range, asset paths, `supportsOriginal`, source author, public-domain confirmation.
- `icons/icons-manifest.md` — the 18-icon SVG set: id, file, stroke/fill rule, states, usage.
- `FONT-USAGE.md` — Alegreya/Nunito final confirmation + integration steps.
- Placeholder vs. final status per asset is recorded inline in each JSON/manifest — nothing in this package is an unlabeled placeholder.

## 4. Illustration identity
`style-bible.md` — binding style rules (technique, lineart, shading, palette, light, proportions, hair/clothing, character consistency, gaze direction, environment style, forbidden styles) + the exact Gemini prompt suffix and negative prompt to append to every generation. Character canon itself (heights, eye color, named characters) lives in the project's `CLAUDE.md` — the style bible defers to it.

## 5. Icons & typography
`icons/` (18 `.svg` files) + `icons/icons-manifest.md` + `FONT-USAGE.md`.

## 6. Reference screenshots
`screenshots/` (12 PNGs, 390×844, captured live from the approved design components) + `screenshot-manifest.md` (FINAL/EXPLORATORY label and locked visual properties per screen).

## 7. Everything else
- `nextjs/` — all React components (props-driven, typed, CSS Modules, `tokens.css` shared design tokens).
- `prototypes/` — interactive `.dc.html` tools: the new-screens state gallery, crop-review tool, responsive-rules reference.
- `known-differences.md` — the specific fidelity gaps to check for in the current implementation.
- `copy-cz-en.md` — full CZ/EN string sheet.

## Acceptance
Every screen, asset, breakpoint, and visual rule referenced in the request that prompted this package is defined unambiguously in the files above. `known-differences.md` is the checklist for verifying the current implementation against it.
