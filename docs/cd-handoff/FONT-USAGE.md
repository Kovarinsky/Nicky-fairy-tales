# FONT-USAGE.md

## Final confirmed type system
- **Alegreya** — weights **700 (bold)** and **800 (extrabold)** only. Serif, used exclusively for headings/titles/screen names across all 21 screens (storybook warmth). Never used for body copy, inputs, or buttons.
- **Nunito** — weights **600 (semibold)**, **700 (bold)**, **800 (extrabold)**. Sans-serif, used for everything else: body copy, buttons/CTAs, labels, captions, form fields.

No other family or weight is part of the system. Do not substitute Inter/Roboto/system-ui as a "close enough" fallback in production — bundle the two families above.

## Recommended integration: `next/font/google`
No WOFF2 files are bundled in this handoff (Google Fonts' license terms are fine for `next/font/google`'s self-hosting proxy, which is the standard, licensing-safe path for a Next.js app — there's no reason to hand-manage font files separately). Add to the root layout:

```ts
import { Alegreya, Nunito } from "next/font/google";

const alegreya = Alegreya({
  subsets: ["latin-ext"], // latin-ext required for Czech diacritics (á č ď é ě í ň ó ř š ť ú ů ý ž)
  weight: ["700", "800"],
  variable: "--font-serif",
  display: "swap",
});

const nunito = Nunito({
  subsets: ["latin-ext"],
  weight: ["600", "700", "800"],
  variable: "--font-body",
  display: "swap",
});
```

Apply both variable classes to `<html>` or `<body>` in the root layout, then reference `var(--font-serif)` / `var(--font-body)` from `tokens.css` (already wired that way in `nextjs/tokens.css`) — every component's CSS Module already points at those two custom properties, so no per-component font-family changes are needed once the variables are set at the root.

**Critical: use the `latin-ext` subset, not `latin`.** The default `latin` subset from Google Fonts drops Czech diacritics (ě, š, č, ř, ž, ý, á, í, é, ú, ů, ď, ť, ň) — Nunito/Alegreya would silently fall back to a system font for every Czech string in the app if this is missed.

## Per-screen weight usage (for reference/QA)
| Screen | Alegreya | Nunito |
|---|---|---|
| Home | 800 (title, 42px) | 600–800 (all UI, incl. age-band chips) |
| AccountModal | 700 (name) | 600–800 |
| StoryWorldStep / StoryCatalogScreen | 800 (titles, 26–30px) | 600–800 |
| CreateWorldScreen / NewCharacterScreen | 800 (titles) | 600–800 |
| StoryDetailsStep / MotifEditorScreen | 800 (titles) | 600–800 |
| VoiceSelectionScreen | 800 (voice name) | 600–800 |
| ReaderScreen | 800 (karaoke caption text — yes, captions are serif, matching the storybook page feel) | 600–800 (controls only) |
| GenerationProgress/Error/Cancel | 800 (status headline) | 600–800 |
| StoryLibraryScreen | 800 (title, empty-state headline) | 600–800 |
| StoryEndScreen | 800 ("Konec", 32px) | 600–800 |
| BonusSongScreen | 800 (song title) | 600–800 |
| ShareSheet / LowCreditsModal / ForgotPasswordFlow / PermissionPrimerModal | 800 (titles) | 600–800 |

## Confirmation
This is the **final** type system — no additional families/weights are pending review.
