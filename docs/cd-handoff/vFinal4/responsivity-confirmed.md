# Responsivity — Confirmed Rules (vFinal4)

Full detail lives in `breakpoints.md` (carried over unchanged from vFinal3). This file is the explicit line-by-line confirmation requested for this round.

| Rule | Confirmed |
|---|---|
| App frame has `max-width: 430px` | ✅ — see `breakpoints.md` §"Content width / max-width rules" |
| Always centered on tablet and desktop | ✅ — see `breakpoints.md` §"The core rule" |
| Never stretches across the full monitor | ✅ — explicit anti-pattern call-out preserved from vFinal3 |
| `body` has no scroll of its own | ✅ — `body { overflow: hidden }` on tablet/desktop wrapper, stated in the implementation sketch |
| The app's own content area owns scroll | ✅ — see `breakpoints.md` §"Who owns scroll" |
| Horizontal catalog rollers scroll independently | ✅ — `overflow-x: auto; overflow-y: hidden`, nested inside the vertically-scrolling parent |
| CTAs respect safe-area | ✅ — `env(safe-area-inset-*)` rules for top header and bottom sticky CTAs, see `breakpoints.md` §"Safe-area rules" |

Breakpoints covered: 360×800, 390×844 (canonical), 430×932, tablet portrait 768×1024, desktop ≥1024 — all five use the identical centered-frame rule; there is no per-breakpoint layout variant beyond frame-vs-no-frame, because the in-frame layout itself never changes shape (see `breakpoints.md` for why this is correct rather than a shortcut: rollers and grids inside a fixed-width frame have nothing to reflow against).
