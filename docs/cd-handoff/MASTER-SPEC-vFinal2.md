# Nickyho pohádky — MASTER SPEC vFinal2 (implementation-ready addendum)

This supersedes ambiguity in `MASTER-SPEC-vFinal1.md` (kept in this bundle for history) with concrete files and explicit decisions. **No new features, no visual-direction changes** — this pass only removes open questions and delivers the missing implementation artifacts.

## What's new in this package vs. vFinal1
1. `focal-points.final.json` — every one of the 54 assets individually visually reviewed this session (not a heuristic). Includes `objectPosition`, `safeZone`, `coverSafe`, per-device `deviceVariants` where a composition genuinely needs them, and a `textExclusion` note per asset.
2. `classic-tales.final.json` — all 34 tales with confirmed CZ/EN names (corrected against the actual art, not filename guesses), group, descriptions in both languages, age range, WebP paths, `supportsOriginal`, source author, and `publicDomain: true`.
3. `prototypes/New Screens 11-21.dc.html` — one connected interactive prototype covering all 11 new screens (11–21) with a screen switcher (left rail) and a state-chip switcher per screen, covering every state requested: default/loading/success/error/empty/disabled/modal open-closed/permission denied/insufficient credits/song loading-playing-paused-error/share generating-copied/generation interrupted-resumed.
4. `prototypes/Crop Review.dc.html` — interactive focal-point review tool: pick a breakpoint, see a representative sample of assets (safe + problematic compositions) rendered with their real recommended `object-fit`/`object-position`.
5. `prototypes/Responsive Reference.dc.html` + `responsive-reference/responsive-rules-sheet.png` — a rendered reference sheet demonstrating the 3 layout-adaptation patterns from vFinal1 §4 (full-bleed illustration screen, form/wizard screen, grid/catalog screen) at all 4 breakpoints (390×844, 844×390, 768×1024, 1366×768). **Scoping note:** this demonstrates the responsive *rules* on 3 representative screen archetypes rather than bespoke pixel mockups for all 11 new screens individually at all 4 sizes (44 combinations) — every one of the 11 screens maps onto one of these 3 archetypes (see table below), so the rule sheet is the correct generalization. Flag if you need a specific one of the 11 rendered bespoke.

| New screen | Archetype |
|---|---|
| GenerationProgress/Error/Cancel, StoryEndScreen, BonusSongScreen | A — full-bleed illustration |
| ResumeBanner (inline, not full-screen), LowCreditsModal, ShareSheet, ForgotPasswordFlow, PermissionPrimerModal | B — form/modal (centered card, capped width) |
| StoryLibraryScreen | C — grid |

6. `nextjs/` — added `tokens.css` (shared CSS custom properties — colors, gradients, radii, shadows, easing, spacing; every new component's module imports it, none repeat literal values) and 9 new props-driven `"use client"` components: `GenerationProgressScreen`, `StoryLibraryScreen`, `StoryEndScreen`, `BonusSongScreen`, `ShareSheet`, `LowCreditsModal`, `ForgotPasswordFlow`, `PermissionPrimerModal`. Also patched: `StoryCatalogScreen.tsx` (age-filter toggle + two-band full-bleed detail overlay, matching the `.dc.html` fix from the previous session; new `onPickOriginal`/`supportsOriginal` for the "Poslechnout v originále" secondary action), `StoryWorldStep.tsx` (age-filter toggle), `HomeScreen.tsx` (child age-band picker + "Zapomenuté heslo?" link in the login panel). No API keys, no hardcoded content, no localStorage treated as a production auth mechanism anywhere in `nextjs/` — all data in via props.
7. `FONT-USAGE.md` — final font confirmation + `next/font/google` integration instructions with per-screen weight table.

## StoryEndScreen — product decision compliance
Implemented per the explicit decision in this round: content always sits inside one `max-height: 90dvh; overflow: auto` responsive card (never overflows the viewport), no prev/next arrows, a prominent orange circular × close button (top-right, `var(--gradient-cta)`), a bonus-song offer CTA, feeding into `BonusSongScreen` next. See `nextjs/StoryEndScreen.tsx` + `.module.css`.

## ReaderScreen — editing-icon exclusion
Confirmed: `ReaderScreen` (both the `.dc.html` prototype and `nextjs/ReaderScreen.tsx` from the previous package) has never included a pencil/text-edit icon or a paintbrush/image-edit icon during playback — its control bar is exclusively prev/next/play-pause + scrubber, matching this requirement already. No change was needed; noted here as an explicit confirmation rather than a silent no-op.

## Seven decisions — resolved, not left open
1. **Library entry point:** a dedicated icon (open-book glyph) in the Home header, next to the avatar button — not buried in AccountModal. Discoverable, one tap from Home.
2. **Tablet layout for world/tale rollers:** rollers **stay horizontal-scroll** on tablet (do not convert to a static wrapping grid). Rationale: keeping one interaction pattern across all breakpoints is simpler to implement and test than a breakpoint-conditional layout switch, and horizontal rollers already work fine at tablet widths (more tiles simply fit in view at once without scrolling). The *catalog* grid (a different, already-grid-based screen) does still reflow its column count per breakpoint (2→3→4, per vFinal1 §4) — that's a separate, already-a-grid case, not the rollers.
3. **"Stáhnout jako video" (download as video):** **hidden in v1.** Keep native share + copy-link only; the ShareSheet component (`nextjs/ShareSheet.tsx`) accepts a `targets` array with a `hidden` flag specifically so this can be added later without a component change — just stop passing `hidden: true` for that target.
4. **StoryEndScreen background:** uses the **story's last illustration** (reusing existing generated art), not a separate goodnight-specific generated image. Simpler pipeline, no new generation step, and the last page is thematically the natural "closing" image already.
5. **Bonus song generation timing:** **on-demand, triggered by tapping "Poslechnout bonusovou písničku"** — not generated automatically alongside the story. Avoids spending generation budget/time on content the user may not open, keeps the 300s story-generation ceiling honest, and matches the `BonusSongScreen`'s `loading` state existing specifically to cover this on-demand wait.
6. **Microphone permission primer:** **included in v1.** The app supports voice cloning (referenced in `copy-cz-en.md`'s `voice.premiumNote` — "Klon hlasu mámy či táty…"), so the microphone primer is load-bearing, not speculative; `PermissionPrimerModal` ships with all three kinds (`camera`/`microphone`/`location`) as one component.
7. **Desktop ReaderScreen:** **stays single-page in v1.** A two-page spread is explicitly deferred as a future exploration (already flagged this way in vFinal1 §4) — no work needed now beyond the existing single full-bleed-page desktop layout rule.

## Reconciliation note (carried over from vFinal1, still true)
Where `.dc.html` prototypes and `nextjs/*.tsx` disagree, the `.dc.html` wins for visual/interaction fidelity — it was iterated on last. This round's `nextjs/` patches bring `StoryCatalogScreen`, `StoryWorldStep`, and `HomeScreen` back into alignment with their `.dc.html` counterparts; the 9 brand-new components in `nextjs/` have no `.dc.html` equivalent to reconcile against except the interactive states shown in `prototypes/New Screens 11-21.dc.html`, which is their source of truth.

## Everything else
Unchanged from `MASTER-SPEC-vFinal1.md` — component states matrix, full responsive rules (§4), motion/gesture vocabulary (§5), and the licensing/tale-count confirmation (§7, now further detailed per-tale in `classic-tales.final.json`). Read that file for anything not repeated here.
