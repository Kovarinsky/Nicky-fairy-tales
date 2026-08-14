# Home Background

## Default (shown in the approved `01-home.png` screenshot)
| ID | File | Label | Crop | object-position |
|---|---|---|---|---|
| bg-log | `assets/bg-log.jpg` | "Na kládě" | full-bleed, safe for cover at all breakpoints | `50% 42%` |

This is the Home screen's default background art, layered under the night-sky gradient + scrims (see `README.md`'s Home section for the full layering: gradient → this image at `brightness(1.08) saturate(1.35) sepia(.18) hue-rotate(-14deg) contrast(1.04)` → top/bottom scrims).

## Other variants (user-switchable via the Home header's background picker, not Home Settings)
| ID | File | Label | object-position |
|---|---|---|---|
| bg-blanket | `assets/bg-blanket.jpg` | "Na dece pod stromem" | `50% 38%` |
| bg-tree | `assets/bg-tree.jpg` | "V dutině stromu" | `50% 42%` |
| bg-log-v6 | `assets/bg-log-v6.jpg` | "Na kládě (postavy dole)" | `50% 46%` — characters sit lower in this variant, safe zone shifts down |
| custom | user-uploaded photo → AI-illustrated | "Vlastní" | `50% 42%` (default; re-check per upload) |

All four are **FINAL** — pre-existing, already wired into `1 Home.dc.html`'s background-swatch picker sheet, not new assets. This picker is distinct from **Home Settings** (§`home-settings.md`): the background picker chooses *which scene* is behind the Home content (a per-user preference, saved the same way — account-synced, local fallback), while Home Settings' "Světlost a nálada" control changes the *color-grading filter* applied on top of whichever background is chosen. The two stack: pick a background, then optionally grade it.
