# Alignment & Hit-Area Specification

| Property | Value |
|---|---|
| Primary CTA height | 56–62px (56 standard; 60–62px for hero CTAs like "Start nové pohádky"/"Vytvořit pohádku" which carry an icon badge) |
| Secondary CTA height | 44px |
| Circular icon button (back, settings, play/pause, avatar) | 40–44px diameter; **44×44px minimum tap target** even when the visible circle is smaller — pad transparently to reach 44px, never shrink the tap target to match a smaller glyph |
| Icon size inside a button | 20px (secondary/inline buttons), 24px (primary circular icon buttons), 16–18px (dense rows, e.g. AccountModal credit row) |
| Icon-to-text gap | 8px, fixed — never rely on padding alone to create this gap; use `gap` in a flex row |
| Horizontal padding inside pill CTAs | 24px each side minimum |
| Card padding | 16–20px on mobile, 20–22px on tablet/desktop frame |
| Border-radius — pills/CTAs | 999px |
| Border-radius — cards | 20–26px |
| Border-radius — tiles/thumbnails | 12–18px |
| Centering | Icon + label rows use `display: flex; align-items: center; justify-content: center; gap: 8px` — never manual margin nudging. For optical (not just geometric) centering, icon glyphs with visual weight biased to one side (e.g. play triangle) get a 1–2px nudge via the icon's own viewBox padding, not button-level margin hacks |
| Active/pressed state | `transform: scale(0.97)` for pill/rectangular CTAs, `scale(0.9)`–`scale(0.94)` for circular icon buttons; `transition: transform 120ms ease`; no color change on press beyond the scale |
| Disabled state | `opacity: 0.35–0.4`, `cursor: not-allowed`, pointer-events still register for tooltip/aria purposes but produce no action |

## Optical vs. geometric centering
Text baselines and icon centers must align on the same horizontal axis inside a button — verify by eye at 100% zoom, not just by CSS box math: round glyphs (circles, dots) sit exactly on the text's vertical center; triangular glyphs (play icon) are optically shifted right by ~1px inside their own viewBox to compensate for the triangle's visual left-heaviness, per the standard play-icon convention already baked into `icons/play.svg`.
