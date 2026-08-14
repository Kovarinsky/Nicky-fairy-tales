# Request for final Claude Design handoff

The current implementation contains the CD component layer, but it is not yet a faithful product conversion. Please provide one final source-of-truth package answering the following.

## 1. Screen inventory and navigation

Provide the canonical screen list and transitions for:

- Home screen / landing screen
- Story world selection
- Story catalogue
- Catalogue detail
- Custom world
- Story details
- New character
- Voice selection
- Generation progress
- Reader, story end and bonus song

For every screen include the exact route/state, back behavior, primary CTA, empty/loading/error states and whether it is a full-screen mobile view or a modal/sheet.

## 2. Responsive source of truth

Provide exact layouts for these viewports:

- 360 × 800
- 390 × 844
- 430 × 932
- tablet portrait
- desktop preview

Clarify whether desktop is a centered phone frame, a fluid tablet layout, or a full-width web layout. Include breakpoints, max content width, safe-area rules and scroll ownership. The app must never stretch a mobile composition across a desktop monitor.

## 3. Asset manifest

For every visible image/icon/font provide a manifest with:

- stable asset ID
- exact file path and format
- intended screen/component
- crop/focal point
- light/dark usage
- mobile/desktop variants
- whether the asset is final or placeholder

No generic catalogue thumbnails may be used as character portraits or voice avatars unless explicitly approved.

## 4. Unified Nicky illustration identity

Provide the final style bible for generated artwork:

- character design and canonical reference images
- line, shading, palette and lighting rules
- face/eye/hair proportions
- clothing and accessory continuity
- background/environment treatment
- interaction and gaze rules
- forbidden styles, palettes and photographic/3D elements
- one reusable prompt suffix and negative prompt

The same style rules must apply to story images, portraits, catalogue cards, icons and backgrounds. Character identity anchors must be explicit and versioned.

## 5. Icon and typography system

Provide the icon set as SVG or another final vector source, not emoji substitutes. Include icon IDs, sizes, stroke/fill rules and states. Provide font files or exact production-safe font loading instructions, weights and fallback behavior.

## 6. Acceptance references

For each screen provide one approved reference screenshot at 390 × 844 and a short list of non-negotiable visual properties. Mark each screenshot as final, exploratory or placeholder.

## 7. Delivery format

Please return one zip containing:

- final screen references
- final asset manifest
- tokens and breakpoint specification
- fonts/icons
- prompt/style bible
- navigation/state map
- list of known deviations from the current prototype

The implementation will be accepted only when the supplied references, asset IDs and responsive rules are unambiguous.
