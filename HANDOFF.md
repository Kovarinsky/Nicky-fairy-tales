# Nickyho pohádky — current handoff

## Objective

Convert the Claude Design mobile product flow into the existing Next.js app while preserving the current story-generation, canon, audio and reader logic.

## Current state

- Repository: `main`, remote `Kovarinsky/nicky-fairy-tales`.
- Existing CD preview route: `/cd-preview` (isolated; main production wizard is not replaced).
- Preview now includes Home, world selection, catalogue/detail, custom world, story details, new character, voice selection and generation progress.
- New CD package vFinal3 has been inspected and stored under `docs/cd-handoff/vFinal3/`.
- New CD package vFinal4 has been inspected and stored under `docs/cd-handoff/vFinal4/`.
- vFinal4 adds the formal Home Settings spec, 25-icon manifest, dedicated avatar assets, button behavior/tooltip rules, hit-area alignment rules, and explicit responsive confirmation.
- vFinal4 assets are also available under `public/cd-assets-v4/`; the seven added SVG icons are in `public/cd-icons/`.
- CD preview now loads the vFinal4 34-tale JSON catalogue and Home exposes a first-pass Settings sheet with button/mood swatches.
- CD preview now has a complete demo route through progress → reader → end → bonus song → library; this is preview-state wiring only, not yet the production job/audio integration.
- Remaining text/emoji navigation glyphs were replaced with shared `/cd-icons` SVG masks across the main CD forms, library, voice and end screens; a second icon pass is still needed for inline SVG helpers and non-manifest decorative glyphs.
- Old story-generation flow: `sanitizeJson` now repairs unescaped quotes/control newlines inside Claude JSON strings before parsing, preventing complete stories from being discarded and rewritten after the observed `Expected ',' or '}'` failure.
- vFinal4's `home-background.md` references `bg-log.jpg` and three variants, but those background files are not present in the ZIP; current app backgrounds remain the fallback until CD supplies/approves the exact files.
- vFinal3 supplies the source-of-truth responsive rules, navigation/state map, style bible, final icon manifest, 12 reference screenshots and known-differences list.
- The 18 final SVG UI icons are copied to `public/cd-icons/`.
- The same 160 illustration assets remain available under `public/cd-assets/`.

## Verification

- `npm run build` passed on 2026-08-14.
- `npm test -- --runInBand` passed: 13 tests.
- The app-frame rule is implemented in the CD preview: max-width 430px, centered on tablet/desktop.

## Important decisions

- vFinal3 is now the design source of truth; `known-differences.md` is the acceptance checklist.
- Home must be the first preview state; the previous preview incorrectly started at world selection.
- Mobile layout must never stretch across a desktop monitor.
- Generic catalogue art must not be used as canonical character or narrator portraits.
- Do not merge CD flow into the production root wizard until the screen-by-screen visual acceptance pass is complete.

## Unresolved / next action

- Use the 390×844 vFinal3 screenshots for a visual diff pass against every preview state.
- Replace remaining emoji/inline icon substitutes with `/public/cd-icons/*.svg`.
- Wire final vFinal3 asset IDs/focal points into catalogue, world and detail data.
- Apply vFinal4 additions: full 34-tale catalogue, dedicated avatars, Home Settings sheet, button/tooltips/hit-area rules, and final asset paths.
- Add Reader/end/song reference checks and connect those screens to the existing reader state.
- Request explicit approval before any production deployment of the integrated main flow.
- Before deployment, run a real 12-scene generation against the current deployment and verify the repair path in the job log.
