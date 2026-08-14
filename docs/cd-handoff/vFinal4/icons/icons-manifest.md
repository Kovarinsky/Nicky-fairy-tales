# Icon & Typography Specification

## Icon set (`icons/*.svg`)
18 flat line/glyph icons, 24×24 viewBox, `currentColor` (inherits text color — no hardcoded fill/stroke color in the files). These are **UI glyphs**, distinct from illustrated imagery — never rendered in the painted storybook style, and never substituted with emoji.

| ID | File | Style | Used on |
|---|---|---|---|
| back-chevron | `back-chevron.svg` | stroke, 2px | header Back button, all screens |
| close-x | `close-x.svg` | stroke, 2px | Konec pohádky × button, modal dismiss |
| chevron-left | `chevron-left.svg` | stroke, 2px | Detail pohádky prev, Reader prev page |
| chevron-right | `chevron-right.svg` | stroke, 2px | Detail pohádky next, Reader next page |
| play | `play.svg` | filled | Reader play, Bonusová písnička play |
| pause | `pause.svg` | filled | Reader pause, Bonusová písnička pause |
| plus | `plus.svg` | stroke, 2px | "＋ Přidat" character tile, "＋ Vlastní pohádka" tile |
| menu-dots | `menu-dots.svg` | filled dots | Story Library card overflow menu |
| lock | `lock.svg` | stroke, 2px | Premium voice lock badge |
| book | `book.svg` | stroke, 2px | Home header library entry point, empty-library state |
| mic | `mic.svg` | stroke, 2px | Microphone permission primer, voice-clone entry point |
| camera | `camera.svg` | stroke, 2px | Camera permission primer, photo upload buttons |
| location-pin | `location-pin.svg` | stroke, 2px | "Pohádka podle mé polohy" toggle, location permission primer |
| checkmark | `checkmark.svg` | stroke, 2px | Character selected badge, permission granted, password reset success |
| coin | `coin.svg` | stroke, 2px | Credits row (AccountModal), Low Credits modal |
| share | `share.svg` | stroke, 2px | ShareSheet trigger, Story Library card menu |
| trash | `trash.svg` | stroke, 2px | Story Library delete, character remove |
| search | `search.svg` | stroke, 2px | Katalog pohádek search field |

### Stroke/fill rules
- Stroke icons: `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`.
- Filled icons (play, pause, menu-dots): `fill="currentColor"`, no stroke.
- Never mix stroke-weight within one icon; never scale below 16×16 rendered size (24×24 is the design size, 20×20 is the minimum shrink for dense rows like AccountModal).

### Interactive states
- **Default:** `color: var(--color-cream)` (on dark surfaces) or `color: var(--color-night-1)` (on light/gold surfaces, e.g. inside a filled CTA).
- **Hover** (desktop pointer only): `opacity: 0.75`, no color shift, 120ms ease.
- **Active/pressed:** `transform: scale(0.9)`, 120ms ease — matches the button press rule in `README.md`.
- **Disabled:** `opacity: 0.35`, `cursor: not-allowed`, no hover/active response.

## Typography
Fully specified in `FONT-USAGE.md` — Alegreya (700/800) for headings, Nunito (600–800) for everything else, loaded via `next/font/google` with the `latin-ext` subset (required for Czech diacritics). No fallback beyond the browser's default serif/sans-serif stack while the web font loads (`display: swap`, so a brief system-font flash on first load is expected and acceptable).
