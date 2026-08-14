# Nickyho pohádky — current handoff

## Objective

Convert the Claude Design mobile product flow into the existing Next.js app while preserving the current story-generation, canon, audio and reader logic.

## Current state

- Repository: `main`, remote `Kovarinsky/nicky-fairy-tales`.
- Existing CD preview route: `/cd-preview` (isolated; main production wizard is not replaced).
- Preview now includes Home, world selection, catalogue/detail, custom world, story details, new character, voice selection and generation progress.
- New CD package vFinal3 has been inspected and stored under `docs/cd-handoff/vFinal3/`.
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
- Add Reader/end/song reference checks and connect those screens to the existing reader state.
- Request explicit approval before any production deployment of the integrated main flow.
