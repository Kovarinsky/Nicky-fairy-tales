# Breakpoint & Responsive Specification

## Breakpoints
| Name | Width | Notes |
|---|---|---|
| Mobile S | 360×800 | Android baseline (Galaxy A-series etc.) |
| Mobile M | 390×844 | iPhone 12/13/14 baseline — **this is the canonical reference size** for all screenshots/mockups in this handoff |
| Mobile L | 430×932 | iPhone Pro Max class |
| Tablet portrait | 768×1024 | iPad baseline |
| Desktop | ≥1024 | Any wider viewport, including ultra-wide monitors |

CSS breakpoint values: `@media (min-width: 600px)` = tablet-and-up styling kicks in; `@media (min-width: 1024px)` = desktop frame kicks in. Everything below 600px shares one mobile layout (360–430 is fluid, not stepped — see "Fluid range" below).

## The core rule: mobile app, never a stretched mobile page
**Nickyho pohádky is a mobile app experience.** On tablet and desktop, the app renders inside a **centered mobile-proportioned frame** (max-width 430px, full device height), not as a stretched full-width responsive web layout. This matches the product's actual shape (phone-only interaction model: swipe gestures, bottom sheets, thumb-reach CTAs) and avoids the explicit anti-pattern flagged by the design team: *"Mobilní obrazovka se nesmí roztahovat přes celý desktop monitor."*

- **Mobile (360–430px):** the frame IS the viewport. Fluid within this range — no internal breakpoint step; layout uses relative units (%, rem, clamp()) so 360 and 430 both render correctly off ONE layout, not two designs.
- **Tablet portrait (768×1024):** center the same mobile frame (max-width 430px) in the viewport. Fill the surrounding space with the app's night-gradient background (blurred/darkened continuation of the in-app gradient) so the frame doesn't float on a blank canvas — think "phone held up in a dark room," not "letterboxed video." No layout changes inside the frame vs. mobile.
- **Desktop (≥1024px):** identical centered-frame treatment as tablet. The frame never exceeds 430px content width regardless of monitor size. This applies to every one of the 12 screens without exception — including Reader, which explicitly stays single-page (no two-page desktop spread) per the vFinal2 decision log.

## Content width / max-width rules
- App frame content max-width: **430px** at all breakpoints ≥430px.
- Inside the frame, horizontal padding: **16px** (mobile S/M), **20px** (mobile L / tablet+ frame — slightly more breathing room since the frame itself has headroom).
- Cards/tiles never exceed the frame's inner content width; horizontal rollers scroll within it, they don't break out to viewport width.

## Safe-area rules
- Respect `env(safe-area-inset-*)` on all four edges — required for iPhone notch/home-indicator and Android gesture-nav bars.
- Bottom sticky CTAs and bottom sheets: `padding-bottom: calc(16px + env(safe-area-inset-bottom))`.
- Top header content (back button, title): `padding-top: calc(16px + env(safe-area-inset-top))`.
- Full-bleed illustration screens (Reader, Generation Progress, Konec pohádky, Bonusová písnička): the illustration itself can run under the status bar / home indicator, but all interactive controls stay within the safe area.

## Card & button sizing (unchanged across breakpoints — this is a mobile app, not a scaling web layout)
- Primary CTA height: **56px**, full content width, `border-radius: 999px` (pill).
- Secondary CTA height: **44px**.
- Circular icon buttons (back, play/pause, avatar): **≥44×44px** hit target minimum (WCAG/mobile touch-target floor), even where the visible glyph is smaller.
- Catalog grid tiles: 2 columns on mobile, always — the frame is never wide enough to warrant 3+ columns at any breakpoint (see "Tablet layout" decision in vFinal2 — rollers/grids don't reflow column count with frame width, because frame width doesn't change).
- Horizontal rollers (world/tale carousels): tile width ~120–140px, unaffected by breakpoint since the frame width is constant.

## Who owns scroll
- The **outer viewport never scrolls** — `body { overflow: hidden }` on tablet/desktop wrapper.
- The **app frame's content area** owns vertical scroll for any screen taller than 844px of content (e.g. a long catalog grid).
- Horizontal rollers own their own horizontal scroll (`overflow-x: auto`, `overflow-y: hidden`), nested inside a vertically-scrolling parent.
- Modals/sheets (Detail pohádky, Nová postava, ShareSheet, etc.) own their own internal scroll when content exceeds the sheet's `max-height`, per `StoryEndScreen`'s `max-height: 90dvh; overflow: auto` pattern — this pattern is the template for every modal in the system, not just StoryEndScreen.

## Implementation sketch
```css
.app-frame {
  width: 100%;
  max-width: 430px;
  height: 100dvh;
  margin: 0 auto;
  overflow: hidden;
  position: relative;
  background: var(--gradient-night);
}
@media (min-width: 600px) {
  body { background: #0a0416; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .app-frame { height: min(932px, 100dvh); border-radius: 32px; box-shadow: 0 40px 100px rgba(0,0,0,.6); }
}
```

## Known gap
This spec is written as general rules + one implementation sketch, not as 12×5 = 60 individual bespoke mockups. Every one of the 12 screens follows the SAME frame rule with no per-screen exception, so a single rule set is the correct and complete deliverable — flag if a specific screen needs a bespoke tablet/desktop screenshot beyond this rule.
