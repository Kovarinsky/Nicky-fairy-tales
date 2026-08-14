# Nickyho pohádky — current handoff

## Objective

Convert the Claude Design mobile product flow into the existing Next.js app while preserving the current story-generation, canon, audio and reader logic.

## Current state

- Repository: `main`, remote `Kovarinsky/nicky-fairy-tales`.
- Existing CD preview route: `/cd-preview` (isolated; main production wizard is not replaced).
- Preview now includes Home, world selection, catalogue/detail, custom world, story details, dedicated character selection, new character, narrator selection, generation progress, reader, end, bonus song and library.
- New CD package vFinal3 has been inspected and stored under `docs/cd-handoff/vFinal3/`.
- New CD package vFinal4 has been inspected and stored under `docs/cd-handoff/vFinal4/`.
- vFinal4 adds the formal Home Settings spec, 25-icon manifest, dedicated avatar assets, button behavior/tooltip rules, hit-area alignment rules, and explicit responsive confirmation.
- vFinal4 assets are also available under `public/cd-assets-v4/`; the seven added SVG icons are in `public/cd-icons/`.
- CD preview now loads the vFinal4 34-tale JSON catalogue and Home exposes a first-pass Settings sheet with button/mood swatches.
- CD preview now has a complete demo route through progress → reader → end → bonus song → library; this is preview-state wiring only, not yet the production job/audio integration.
- Character selection is now a dedicated responsive screen with persistent selection state in the preview flow; adding a new character still uses demo-local form state and is not account-synced.
- Reader controls start hidden, appear only after tapping the canvas, hide again when playback starts, and no longer reappear on page changes. The TTS caption is a single-line scrolling/highlight strip, and the scrubber exposes the end/outro as its final position.
- Story-world spacing no longer derives from the outer desktop viewport: the 430px preview frame keeps the same mobile card/tile geometry on desktop.
- Shared SVG icons now cover all `app/cd` screens, including Home and account internals; no inline SVG or emoji UI substitutes remain in that component tree.
- The preview now exercises deterministic, no-cost interactions for motif generation/expansion, world-study feedback and the location permission primer. These prove UI state transitions only and deliberately do not call paid AI/provider APIs.
- Primary back/close/settings controls were normalized to at least 44×44px touch targets, with centered mask icons.
- Remaining text/emoji navigation glyphs were replaced with shared `/cd-icons` SVG masks across the main CD forms, library, voice and end screens; a second icon pass is still needed for inline SVG helpers and non-manifest decorative glyphs.
- Preview now uses dedicated vFinal4 character/voice avatars instead of catalogue art. "Poslechnout v originále" has its specified book icon, desktop tooltip, mobile-visible explanation and a working preview route into generation.
- Home appearance choices affect the Home CTA/background grade, persist locally under `nicky-appearance-v1`, and the chosen button gradient now propagates through the CD flow via a root CSS variable. Account sync and app-wide background mood propagation remain pending.
- Old story-generation flow: `sanitizeJson` now repairs unescaped quotes/control newlines inside Claude JSON strings before parsing, preventing complete stories from being discarded and rewritten after the observed `Expected ',' or '}'` failure.
- vFinal4's `home-background.md` references `bg-log.jpg` and three variants, but those background files are not present in the ZIP; current app backgrounds remain the fallback until CD supplies/approves the exact files.
- vFinal3 supplies the source-of-truth responsive rules, navigation/state map, style bible, final icon manifest, 12 reference screenshots and known-differences list.
- The 18 final SVG UI icons are copied to `public/cd-icons/`.
- The same 160 illustration assets remain available under `public/cd-assets/`.

## Verification

- `npm run build` passed on 2026-08-15 (Next.js compile, lint/type check and 41-page static generation).
- `npm test -- --runInBand` passed on 2026-08-15: 13/13 tests.
- `node scripts/check-cd-preview.mjs` passed against a local production build on both 390×844 and 1920×1080. It exercises Home → world → catalogue → details → characters → narrator → progress → reader → end → song → library and writes reference screenshots to `test-results/`.
- The app-frame rule is implemented in the CD preview: max-width 430px, centered on tablet/desktop.

## Important decisions

- vFinal4 is now the design source of truth, with vFinal3 `known-differences.md` retained as the acceptance checklist where vFinal4 does not supersede it.
- Home must be the first preview state; the previous preview incorrectly started at world selection.
- Mobile layout must never stretch across a desktop monitor.
- Generic catalogue art must not be used as canonical character or narrator portraits.
- Do not merge CD flow into the production root wizard until the screen-by-screen visual acceptance pass is complete.

## Unresolved / next action

- Use the 390×844 vFinal3 screenshots for a visual diff pass against every preview state.
- Replace remaining emoji/inline icon substitutes with `/public/cd-icons/*.svg`.
- Wire final vFinal3 asset IDs/focal points into catalogue, world and detail data.
- Apply vFinal4 additions: full 34-tale catalogue, dedicated avatars, Home Settings sheet, button/tooltips/hit-area rules, and final asset paths.
- Connect the preview state machine to the production job/audio/account persistence without replacing the current root wizard until visual acceptance.
- Replace the deterministic preview handlers for `Vymysli námět`, `Rozvinout`, `Prostudovat` and location with the existing authenticated production endpoints during integration.
- Complete app-wide/account-synced appearance settings; current Home settings are local-only.
- Re-render catalogue/world artwork into the approved Nicky visual identity only after a six-image pilot is approved; image generation is a paid action and was intentionally not started.
- Request explicit approval before any production deployment of the integrated main flow.
- Before deployment, run a real 12-scene generation against the current deployment and verify the repair path in the job log.
