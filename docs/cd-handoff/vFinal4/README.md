# Nickyho pohádky — FINAL IMPLEMENTATION HANDOFF (vFinal4)

Addendum to vFinal3. Read `known-differences-v4.md` first for what's new, then the rest below.

## 1. Final screens
`screenshot-manifest.md` — 13 screens at 390×844, each labeled FINAL/EXPLORATORY/PLACEHOLDER, with notes.

## 2. Home settings
`home-settings.md` — entry point, icon/button spec, the 2 variant pickers (button color × 5, lighting/mood × 6), what each changes, account-synced-with-local-fallback storage, and the 3 captured states.

## 3. Final icons
`icons/` — 25 SVGs total (18 carried from vFinal3 + 7 new: upload, link, research, voice, settings, account, plus `book.svg` reused as the library glyph) + `icons/icons-manifest.md` for stroke/fill/state rules per icon.

## 4. Avatars and characters
`avatars-manifest.md` — every family character and voice-narrator avatar, with id/file/crop/object-position/status. All are FINAL, purpose-built assets — none are catalog art reused as a portrait. Custom/"vlastní postavy" are correctly not static assets (generated per-family).

## 5. Home background
`home-background.md` — the approved default (`bg-log.jpg`) plus its 3 built-in variants and the custom-upload path, distinguished from the separate Home Settings color-grading control.

## 6. Catalog data
`classic-tales.final.json` (34/34 tales) + `focal-points.final.json` (54/54 assets) — unchanged and complete, carried from vFinal3.

## 7. Button behavior
`button-behavior.md` — the 8 required buttons (Poslechnout v originále, Prostudovat, Rozvinout, Pohádka podle mé polohy, Vybrat tento hlas, Vytvořit pohádku, Start nové pohádky, Nastavení) with text/icon/action/target/loading/error/disabled/tooltip/mobile-equivalent for each, plus the universal no-hover-dependency rule.

## 8. Alignment & hit-areas
`hit-areas.md` — sizes, minimum touch targets, icon-text gaps, padding, radii, and press states.

## 9. Responsivity
`responsivity-confirmed.md` (explicit checklist confirmation) + `breakpoints.md` (full spec, unchanged from vFinal3).

## 10. Everything else
`nextjs/`, `prototypes/` (now including `New Screens 11-23.dc.html` with the 2 new screens added), `copy-cz-en.md`, `FONT-USAGE.md`, `style-bible.md`, `navigation-state-map.md`, `known-differences-v4.md`.

## Acceptance
No unlabeled placeholder exists anywhere in this package — every screenshot, asset, and icon carries an explicit status.
