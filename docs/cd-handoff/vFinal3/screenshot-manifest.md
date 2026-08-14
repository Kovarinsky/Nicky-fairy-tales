# Screenshot Reference Manifest — 390×844

All 12 screens, captured live from the approved `.dc.html` design components at the canonical 390×844 mobile size. Each is labeled FINAL / EXPLORATORY / PLACEHOLDER.

| File | Screen | Label | Locked visual properties (must not change on reimplementation) |
|---|---|---|---|
| `01-home.png` | Home | **FINAL** | Night-sky gradient exact 6-stop values (`tokens.css`); moon position top-right; star/firefly animation timing; "Nickyho pohádky" Alegreya 800 title with glow text-shadow; footer CTA pill with sparkle particles; header world-swatch pill + avatar circle positions |
| `02-vyber-svet.png` | Výběr světa (step 1/2) | **FINAL** | Two glass-card rollers (PŘIPRAVENÉ / VLASTNÍ), "Všechny pohádky" tile always first, orange selected-border + glow ring, "Pohádka podle mé polohy" full-width toggle, sticky bottom "Pokračovat" |
| `03-katalog-pohadek.png` | Katalog pohádek | **FINAL** | Search pill, horizontal tab bar, 2-column tile grid, tile bottom-gradient + label overlay |
| `05-detail-pohadky.png` | Detail pohádky | **FINAL** | Top ~54% full-bleed illustration band with top/bottom scrim (not a centered scrim — keeps illustrated characters clear), glass description card, primary CTA + "Poslechnout v originále" secondary on classic tales only |
| `06-detaily-pohadky.png` | Detaily pohádky (step 2/2) | **FINAL** | World summary row, motif card, character avatar row with "＋ Přidat", voice summary row, length slider, child-age numeric field, sticky bottom "Vytvořit pohádku" |
| `07-vytvorit-vlastni-svet.png` | Vytvořit vlastní svět | **FINAL** | Name/description/5-photo-grid/link/Prostudovat form, bottom "Uložit svět" + "Zrušit" |
| `08-vyber-hlasu.png` | Výběr hlasu | **FINAL** | Large avatar hero with dual equalizer bars, "Vypravěči" row (gold ring on active), "Premium hlasy" row (grayscale + lock badge) |
| `09-generation-progress.png` | Generation progress | **EXPLORATORY** — new this round, not yet held against a live build | 3-segment progress bar, spinner, factual+playful copy pairing per step, "Zrušit" text link → confirm modal |
| `10-ctecka.png` | Reader | **FINAL** | Full-bleed page illustration, karaoke word-by-word caption coloring (read/current/pending), floating glass control bar (prev/play/next + scrubber) |
| `11-konec-pohadky.png` | Konec pohádky | **EXPLORATORY** — new this round | Single responsive card, `max-height: 90dvh` scroll-safe, no arrows, orange circular × top-right, bonus-song CTA |
| `12-bonusova-pisnicka.png` | Bonusová písnička | **EXPLORATORY** — new this round | Square cover art, animated equalizer bars, circular play/pause, "Hotovo" text link |
| `13-nova-postava.png` | Nová postava | **FINAL** | Name/description/photo-upload form, "V pohádce" toggle pill in edit mode, bottom "Přidat postavu"/"Uložit" + "Zrušit" |

## Reading the labels
- **FINAL** — matches the last user-approved design direction; treat pixel values as locked.
- **EXPLORATORY** — newly built to satisfy this round's spec (screens 9, 11, 12 didn't exist as visual mockups before); visually consistent with the FINAL screens' design system (same tokens, same component patterns) but has not yet been through an explicit approval round — flag before treating as pixel-locked.
- **PLACEHOLDER** — not used in this set; every screen above has at least a real, system-consistent visual. (If a screen is added later without a mockup, it belongs in this bucket until one exists.)

## What's NOT separately screenshotted
Story Library, Share Sheet, Low Credits, Forgot Password, Permission Primers, Resume Banner — these 7 supporting screens/modals exist as live interactive states in `prototypes/New Screens 11-21.dc.html` (see that file's left-rail navigation) and as props-driven `nextjs/*.tsx` components, but weren't in this round's explicit 12-screen list, so weren't pulled into this static screenshot set. Say so if you want them added — they're a few more `save_screenshot` calls against the existing prototype, not new design work.
