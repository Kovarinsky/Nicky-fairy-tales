# Avatar & Character Assets

All character-representing imagery — family characters and voice-narrator personas — must use these dedicated assets. Catalog/world illustrations (`assets/katalog/`, `assets/svety/`) must never stand in for a character portrait or voice avatar.

## Family characters
| ID | File | Crop | object-position | Light/dark use | Status |
|---|---|---|---|---|---|
| nicolasek | `assets/postavy/avatar-nicolasek.png` | circular head-and-shoulders | `50% 38%` | works on both light card and dark glass backgrounds (has its own neutral backdrop) | **FINAL** |
| valentynka (Vaju) | `assets/postavy/avatar-valentynka.png` | circular head-and-shoulders | `50% 40%` | same as above | **FINAL** |
| james | `assets/postavy/avatar-james.png` | circular head-and-shoulders | `50% 38%` | same as above | **FINAL** |
| bella | `assets/postavy/avatar-bella.png` | circular head-and-shoulders | `50% 36%` | same as above | **FINAL** |
| jan (táta) | `assets/postavy/jan.png` | full lineup crop, needs re-crop to circular avatar for UI use | n/a — source crop only | — | **FINAL** (source), avatar crop **PLACEHOLDER** (not yet cut to a circular UI avatar; not needed until a "táta" character tile appears in a flow) |
| jana (máma) | `assets/postavy/jana.png` | same as jan | n/a | — | same as jan |
| eva / jakob | `assets/postavy/eva.png` / `jakob.png` | same as jan | n/a | — | same as jan |
| archie (pes) | `assets/postavy/archie-kanon.jpg` | full-body canon crop | n/a | — | **FINAL** (source); no circular avatar crop exists yet |

## Voice narrator personas
| ID | File | Crop | object-position | Status |
|---|---|---|---|---|
| vypravěč (muž) | `assets/hlasy/vypravec.png` | circular head-and-shoulders, front-facing | `50% 42%` | **FINAL** |
| vypravěčka (žena) | `assets/hlasy/vypravecka.png` | circular head-and-shoulders, front-facing | `50% 42%` | **FINAL** |
| dětský hlas | `assets/hlasy/vesely.png` | circular head-and-shoulders | `50% 42%` | **FINAL** |
| premium — Klon máma | `assets/hlasy/filmova.png` | circular, grayscale+dimmed applied in UI (`filter: grayscale(.5) brightness(.75)`) until unlocked | `50% 42%` | **FINAL** |
| premium — Klon táta | `assets/hlasy/filmovy.png` | same treatment | `50% 42%` | **FINAL** |
| premium — Hollywoodský herec | `assets/hlasy/dobrodruzny.png` | same treatment | `50% 42%` | **FINAL** |
| premium — Hollywoodská herečka | `assets/hlasy/dobrodruzna.png` | same treatment | `50% 42%` | **FINAL** |
| unused in current voice list (available for future voices) | `assets/hlasy/{dite,jemny,muz,pohodovy,pratelsky,sova,zena,zivy}.png` | circular | `50% 42%` | **FINAL** (generated, not yet wired into `4 Hlas.dc.html`'s voice list) |

All voice-persona portraits already exist as dedicated, purpose-generated assets — none of them are catalog art repurposed as a portrait, satisfying this round's requirement directly.

## Vlastní postavy (custom characters)
Not a static asset by nature — each is a user-uploaded photo or user-described character, generated per-family at creation time via `NewCharacterScreen`. Nothing to ship here; the empty "＋ Nová postava" tile (see `15-vyber-postav.png`) is the correct placeholder UI for "not yet created," not a missing asset.

## Note on generation
This response cannot generate new images. Every asset marked **FINAL** above already existed in the project before this task; nothing above was newly generated to fill a gap. The only flagged gap (jan/jana/eva/jakob/archie circular avatar crops) is a crop/packaging task against existing source art, not a new-generation task — happy to prepare those crops if/when a flow needs them.
