# Nickyho pohádky — MASTER SPEC vFinal

Production handoff addendum reconciling the `.dc.html` prototypes with the `nextjs/` React export into one final spec. Read alongside `README.md` (screen-by-screen visual/interaction detail) and `assets-manifest.md` (asset → id mapping). This document adds: the full screen inventory (existing + newly specified), all component states, responsive/breakpoint rules, motion/gesture specs, and licensing confirmation.

## 0. Source-of-truth reconciliation
Where the `.dc.html` prototypes and the `nextjs/*.tsx` export disagree (they were exported at different points in the design session), **the `.dc.html` files win** for visual/interaction detail — they were iterated on last. The `nextjs/` files are the correct **structural** starting point (props-driven, no hardcoded data, `"use client"`, CSS Modules) but a few need visual updates to match:
- `StoryWorldStep.tsx` / `StoryCatalogScreen.tsx`: add the age-filter toggle pill (see README §3) — not yet in the .tsx export, only in `2 Vyber pohady.dc.html`.
- `StoryCatalogScreen.tsx` detail overlay: update to the two-band full-bleed layout (image `flex: 0 0 54%`, `cover`, top/bottom scrim strips carrying the back button and prev/next nav) — the .tsx export still has the older centered-overlay layout that was fixed later in `2 Vyber pohady.dc.html`.
- `1 Home.dc.html`'s login/register panel has the child age-band picker (4 chips); port this into `HomeScreen.tsx`.
- `3 Svety.dc.html` is **deprecated** — do not port; superseded by `StoryWorldStep`.

## 1. Complete screen inventory

### Existing (built + specified in README.md)
1. HomeScreen — world background picker, start CTA, login/register (incl. child age band)
2. AccountModal — credits, email, password, logout
3. StoryWorldStep — world/tale picker, step 1/2, age filter
4. StoryCatalogScreen — search/browse + detail overlay + "poslechnout v originále" toggle
5. CreateWorldScreen — custom world form
6. StoryDetailsStep — motif, characters, voice, length, step 2/2, per-story child age
7. MotifEditorScreen — fullscreen motif text editor
8. NewCharacterScreen — create/edit character
9. VoiceSelectionScreen — narrator voice picker
10. ReaderScreen — page reader with karaoke captions

### New — specified below (§2), not yet built as interactive prototypes
11. GenerationProgressScreen — story generation loading/progress
12. GenerationErrorScreen (state of #11) — failure + retry/cancel
13. GenerationCancelConfirm (modal, over #11) — confirm cancel
14. GenerationResumeBanner (state, on Home/Library) — resume an interrupted generation
15. StoryLibraryScreen — saved/past stories list
16. StoryEndScreen — end-of-story celebration + actions
17. BonusSongScreen — end-of-story bonus song player
18. ShareSheet — share a finished story
19. LowCreditsModal — insufficient credits blocker
20. ForgotPasswordFlow (2 screens: request + reset) 
21. PermissionPrimerModals (3 variants: camera, microphone, location)

## 2. New screen specs

### 11. GenerationProgressScreen
**Purpose:** shown immediately after "Vytvořit pohádku" / "Poslechnout v originále"; occupies the screen for up to the 5-minute (300s) generation ceiling.
**Layout:** full-bleed soft-blurred world-background (same background family as Home, `blur(18px)` + dark scrim `rgba(16,8,36,.55)`), centered content column: a looping illustrated animation (candle/firefly motif consistent with brand — reuse firefly/star particle system from Home), a large serif status headline, a slim progress bar (indeterminate-to-determinate hybrid: fills in 3 discrete steps, not a smooth 0–100%, so it never looks "stuck"), and a rotating caption line beneath it.
**Copy sequence (CZ, 3 steps mapped to elapsed-time bands within the 300s ceiling — real progress should drive step transitions, this is the fallback pacing):**
1. 0–90s: "Píšu scénář…" / rotating sub-lines: "Vymýšlím, co se stane na první stránce…", "Nicolásek si už obouvá botičky…"
2. 90–240s: "Kreslím ilustrace…" / "Míchám barvy pro kouzelný les…", "Ještě chvilku, obrázky se malují…"
3. 240–300s: "Namlouvám vypravěče…" / "Hlas už zkouší první větu…"
**States:** default (above) → success (auto-navigates to ReaderScreen, no interstitial) → error (§12) → user-initiated cancel (§13).
**Controls:** a single "Zrušit" text button, bottom, always available (opens §13 confirm, does not cancel immediately).
**Motion:** step transitions crossfade text (200ms ease), progress bar segment fill `width` transition 600ms ease-out per step; background particles loop continuously, `prefers-reduced-motion` → replace particle motion + progress fill animation with a static state + a simple pulsing opacity (1.5s ease-in-out) on the status text only.

### 12. GenerationErrorScreen (state)
Same background/frame as §11; illustration swaps to a gentle "sad firefly" static state (dimmed, no animation); headline "Něco se nepovedlo" (Alegreya 800, 22px); body: plain-language reason if known ("Vypravěč teď neodpovídá.") else generic ("Zkuste to prosím znovu."); two stacked buttons: primary "Zkusit znovu" (re-run with the same draft, no re-entering the form) and secondary text button "Zpět na úpravu pohádky" (returns to StoryDetailsStep with the draft preserved). No credit is charged on a failed generation — state this explicitly in copy: "Nic jsme vám nestrhli."

### 13. GenerationCancelConfirm (modal)
Small centered glass card over the dimmed progress screen. "Opravdu chcete generování zrušit?" + body "Rozpracovaná pohádka zůstane uložená, budete moci pokračovat později." Two buttons: destructive-styled "Zrušit generování" (outline, coral/red text `#fca5a5`) and primary "Pokračovat v čekání" (default CTA gradient, visually primary since continuing is the recommended path). Confirming cancel returns to StoryDetailsStep (draft intact) or Home.

### 14. GenerationResumeBanner (state)
A persistent slim banner card (not full screen) appearing at the top of Home (below header) and atop StoryLibraryScreen if a generation was interrupted (app closed, cancelled mid-way, or errored and not retried): icon (hourglass/candle), text "Máte rozpracovanou pohádku" + tale name, a "Pokračovat" pill button. Dismissible with a small × (dismissing does not delete the draft, only hides the banner for that session).

### 15. StoryLibraryScreen
**Purpose:** browse previously generated stories.
**Layout:** header "Moje pohádky" (Alegreya 800) + back button; a 2-column grid of story cards (cover illustration from the story's first page, bottom gradient + title + child's name + relative date "před 3 dny"); each card has a small overflow (⋯) menu: "Přehrát", "Sdílet" (§18), "Smazat" (confirm dialog, destructive).
**States:** empty ("Zatím žádné pohádky — vytvořte první!" + CTA linking to StoryWorldStep, with a friendly open-book illustration), loading (skeleton cards — pulsing gradient placeholder, `1.4s ease-in-out infinite`), populated (grid), error (inline retry banner at top, cards from cache if any still shown below).
**Entry point:** new persistent tab/icon in Home header (next to avatar) or an item inside AccountModal — recommend a header icon (open-book glyph) for discoverability.

### 16. StoryEndScreen
**Purpose:** shown after the last page of ReaderScreen finishes narrating (auto-triggered, not a manual "next" past the last page).
**Layout:** full-bleed final illustration (or a dedicated "The End" illustration if generated) dimmed under a warm gold-tinted scrim; centered serif "Konec" headline with a small sparkle-particle burst (one-shot, reuses Home's sparkle system, ~1.2s, plays once on mount); three stacked actions: primary "Poslechnout bonusovou písničku" (if available, §17), secondary "Přečíst znovu" (restarts ReaderScreen at page 1), tertiary text link "Zpět do knihovny" (§15).
**Motion:** sparkle burst on mount (`opacity`+`scale` keyframes, staggered per-particle delay 0–400ms), headline scales in from `0.9→1` with a soft overshoot ease (`cubic-bezier(0.34,1.56,0.64,1)`, 500ms). `prefers-reduced-motion`: skip the burst and overshoot, plain fade-in 200ms.

### 17. BonusSongScreen
**Purpose:** a short original song related to the story's world/characters, offered as a reward at story end.
**Layout:** similar chrome to VoiceSelectionScreen — centered album-art-style illustration (square, story-world themed) with the same equalizer-bar motif animating while playing, song title + one-line description, a large central play/pause button, a slim scrubber with elapsed/total time, and a "Hotovo" text button to return to StoryEndScreen/Library.
**States:** loading (song being generated/fetched — spinner + "Skládám písničku…"), ready/playing, paused, error (inline "Písnička teď není k dispozici" + dismiss, non-blocking — bonus content should never block the core flow).

### 18. ShareSheet
**Purpose:** share a finished story (link or exported video/audio) — triggered from StoryLibraryScreen's card menu or StoryEndScreen.
**Layout:** bottom sheet (slides up, rounded top corners `28px`, drag handle bar), title "Sdílet pohádku", a row of share-target chips (native share sheet trigger as the primary/first option, plus explicit "Kopírovat odkaz", "Stáhnout jako video" if applicable), each with icon + label; a "Zrušit" text button at the bottom or dismiss via scrim tap/swipe-down.
**States:** default, generating-share-asset (spinner replacing the relevant chip's icon, e.g. while a video export renders), copied-confirmation (brief toast "Odkaz zkopírován" — 2s auto-dismiss, slides up from bottom above the sheet/tab bar).

### 19. LowCreditsModal
**Purpose:** blocks starting generation when the account lacks sufficient credits.
**Layout:** centered glass modal (not full screen — the underlying StoryDetailsStep stays dimmed behind it), coin icon, headline "Nedostatek kreditů", body stating the shortfall in plain terms ("Tato pohádka potřebuje 3 kredity, máte 1."), primary CTA "Dobít kredity" (opens the account credit top-up flow — reuse AccountModal's "Dobít kredit" destination), secondary text button "Zpět".
**Trigger point:** checked on tapping "Vytvořit pohádku" in StoryDetailsStep, before entering GenerationProgressScreen — never mid-generation.

### 20. ForgotPasswordFlow
Two screens, same chrome as the existing login overlay (slide-in panel over the Home background):
- **20a. Request:** back button, headline "Zapomenuté heslo", email input, primary CTA "Odeslat odkaz", helper text below the input ("Pošleme vám odkaz na obnovení hesla."). On submit: transitions to a confirmation state *within the same screen* (headline changes to "Zkontrolujte e-mail", icon changes to an envelope, CTA changes to secondary "Zpět na přihlášení") rather than navigating away — avoids a dead-end screen.
- **20b. Reset:** (reached via emailed link, so likely a separate web view rather than in-app, but spec for completeness) new-password input + confirm-password input, inline validation (see §3 Component States → Input), primary CTA "Nastavit nové heslo", success state replaces the form with a checkmark + "Heslo změněno" + CTA "Přihlásit se".
Entry point: add a "Zapomenuté heslo?" text link beneath the password field in the existing login overlay in `HomeScreen`.

### 21. PermissionPrimerModals
Three content variants of the same modal shape (centered glass card, icon, headline, one-sentence plain-language reason, two buttons: primary "Povolit" — triggers the OS permission prompt, secondary text "Teď ne"):
- **Camera** (triggered from NewCharacterScreen's "Vyfotit" / CreateWorldScreen's photo upload): "Potřebujeme přístup k fotoaparátu, abyste mohli vyfotit postavu nebo místo pro pohádku."
- **Microphone** (only if the app adds voice-cloning/recording for a parent/child's own voice — flag as conditional; include only if that feature exists): "Potřebujeme přístup k mikrofonu, abychom mohli nahrát váš hlas pro vypravěče."
- **Location** (triggered from StoryWorldStep's "Pohádka podle mé polohy" toggle): "Potřebujeme vaši polohu, abychom mohli pohádku zasadit do vašeho okolí. Polohu nikam neukládáme trvale."
**Denied state:** if the OS-level permission was previously denied, "Povolit" instead opens a small inline tip ("Povolení jste dříve odmítli — zapněte ho v Nastavení telefonu.") rather than re-prompting silently (the OS won't re-show its own dialog after a denial).

## 3. Component states matrix
Apply to every interactive component across all 21 screens; anything not listed inherits the base style already documented in README.md's Design Tokens.

| Component | Default | Selected/Active | Disabled | Loading | Error |
|---|---|---|---|---|---|
| Primary CTA (pill) | orange gradient `#f59e0b→#f97316`, white text | `transform: scale(.97)` on press | `opacity:.4`, `cursor:not-allowed`, gradient desaturated to flat `#8a7454` | label replaced by a small inline spinner (18px), width unchanged (no layout shift) | not applicable at button level — errors surface via the screen/modal, not the button itself |
| Secondary/outline button | `1.5px solid rgba(253,224,138,.4)`, transparent fill | orange-tinted fill `rgba(253,224,138,.16)` | `opacity:.4` | spinner replaces icon | — |
| Text input | `1.5px solid rgba(253,224,138,.4)` | focus: border `#fcd34d` + `0 0 0 3px rgba(253,224,138,.18)` ring | `opacity:.5`, background flattened | — | border `#f87171`, helper text below in `#fca5a5`, 12px |
| World/tale tile | plain, dim gradient overlay | `2.5px solid #f97316` + glow ring | `filter: grayscale(55%)`, `opacity:.55` (matches the excluded-IP treatment already used in Asset Review) | shimmer skeleton (gradient sweep, 1.4s) in place of image | broken-image fallback: solid `#150a30` tile with a small book glyph, label still shown |
| Avatar (character/voice) | plain circle, `rgba(255,255,255,.4)` border | gold ring + glow, checkmark badge (characters) | `opacity:.4`, no pointer | pulsing ring in place of border | fallback initial-letter avatar on image-load failure |
| Slider (length/age/scrubber) | gold accent-color fill | — | track flattened to `rgba(255,255,255,.15)`, thumb hidden | — | — |
| Toggle pill (age filter, location) | outline | filled gradient + glow ring | `opacity:.4` | — | — |
| Card/tile grid (library, catalog) | populated | — | — | skeleton grid (see §15) | inline retry banner, cached content still shown if any |

## 4. Responsive reference variants

All screens are designed **mobile-portrait-first** (390×844 reference, iPhone-class). Apply the following adaptations for other form factors — none of the 21 screens change their information architecture across breakpoints, only layout density and chrome.

### Mobile portrait (360–430px width) — reference/default
As documented per-screen in README.md. Full-bleed backgrounds, single-column stacks, bottom sheets for secondary flows, sticky bottom CTA bars.

### Mobile landscape (≤430px height, e.g. phone rotated)
- Reader/GenerationProgress/StoryEnd (full-bleed illustration screens): illustration remains full-bleed; caption/control panels that were bottom-anchored become a **translucent right-edge rail** (30–35% width) instead of a bottom bar, to avoid eating vertical space on a short viewport — scrubber becomes vertical or stays horizontal but compressed.
- Form screens (StoryDetailsStep, CreateWorldScreen, NewCharacterScreen): switch the single scrolling column to **two columns side-by-side** where content allows (e.g., character avatar row + form fields), sticky bottom CTA becomes a sticky **right-edge CTA column** to keep it thumb-reachable.
- Modals/sheets: cap width at ~420px and center rather than stretching full-width.

### Tablet (768–1024px, portrait or landscape)
- Full-bleed illustration screens: illustration is bleed-cropped/pillarboxed depending on orientation rather than naively stretched (respect focal-point metadata from `focal-points.json` — center the focal point, crop equally from both sides).
- Grid screens (StoryCatalogScreen, StoryLibraryScreen): 3→4/5 columns depending on width; StoryWorldStep's horizontal rollers may switch to a static wrapping grid if there's enough width to show all tiles without scrolling (design judgment call, not required).
- Detail overlays (catalog tale detail): move from full-screen stacked layout to a **centered modal card** (image left ~45%, text/CTA right ~55%) rather than image-on-top/text-below — mirrors the two-column pattern already used in `Asset Review.dc.html`'s lightbox.
- Wizard steps keep single-column form width capped at ~480px, centered, with the illustrated background filling the remaining canvas either side.

### Desktop (≥1280px)
- All screens: cap content column width (480–560px for forms/reader captions, 960–1100px for grids) and center; illustrated backgrounds extend full-bleed behind.
- Hover states become meaningful (mouse input): tiles/cards get a subtle `translateY(-2px)` + shadow lift on `:hover` (120ms ease) in addition to the existing active/selected states — active/selected states unchanged.
- Bottom sheets (ShareSheet, background picker) become centered modals instead of edge-anchored sheets.
- Reader: consider a two-page spread option (design judgment call — not required for v1, flag for future iteration) instead of single full-bleed page.

### Safe areas
All screens must respect `env(safe-area-inset-*)` — already present in the existing CSS (`calc(env(safe-area-inset-bottom, 12px) + Npx)` pattern used throughout). Apply consistently to newly-specified screens: GenerationProgress's cancel button, StoryLibrary's grid bottom padding, BonusSong's controls, all bottom sheets.

### Reduced motion
Global rule: wrap every keyframe animation and JS-driven interval-based animation (sparkles, fireflies, karaoke word-advance timer, progress step transitions, sparkle bursts, equalizer bars) in a `prefers-reduced-motion: reduce` media query / JS check that:
- Removes decorative looping animation entirely (stars/fireflies become static, equalizer bars freeze at a mid-height resting frame).
- Replaces scale/slide entrance transitions with a plain opacity crossfade ≤150ms.
- **Never removes functionally-load-bearing motion silently** — the karaoke word-highlight must still indicate progress (switch to an instant per-word color swap, no animated glow) and the generation progress bar must still show step advancement (instant fill, no animated transition).

## 5. Motion & gesture specification

### Timing/easing vocabulary (use these exact values everywhere; do not invent new ones per-screen)
- **Micro (press feedback):** `transform: scale(0.97)` (large CTAs) / `scale(0.94)` (circular icon buttons), `transition: transform 120ms ease`.
- **Standard transition (crossfade, color change, sheet reveal):** `200ms ease`.
- **Emphasis entrance (modals, story-end burst):** `500ms cubic-bezier(0.34, 1.56, 0.64, 1)` (soft overshoot) for scale/opacity combined entrances; plain content fades use `250ms ease-out`.
- **Ambient/looping (stars, fireflies, equalizer bars, sparkles):** durations vary per-element (already randomized 3–6s for stars/fireflies per the existing Home implementation) — keep per-element randomization, don't synchronize, it reads as more organic.
- **Sheet/overlay slide:** `320ms cubic-bezier(0.32, 0.72, 0, 1)` (standard "sheet" ease — decelerating), translate along the sheet's anchored edge (bottom sheets translate Y, side panels translate X).

### Gesture inventory
| Gesture | Screen(s) | Behavior |
|---|---|---|
| Tap | universal | primary interaction; 44×44px minimum hit target everywhere, including icon-only buttons |
| Swipe left/right | ReaderScreen | page turn (next/prev); also available as an explicit alternative to the existing arrow buttons — do not remove the buttons, gesture is additive |
| Swipe down | Bottom sheets (ShareSheet, background picker, world-picker sheet) | dismiss; must have a visible drag-handle affordance (small pill bar, top-center of sheet) even though tap-scrim-to-dismiss also works |
| Swipe up (from bottom edge) | none currently — do not add, conflicts with OS home-indicator gestures on iOS |
| Long-press | StoryLibraryScreen card | opens the same overflow (⋯) menu as tapping the explicit menu icon — an accelerator, not a replacement |
| Drag-to-reorder | not in scope for v1 | explicitly excluded — flag if requested later |
| Pinch-to-zoom | ReaderScreen illustration | optional nice-to-have, not required; if added, must not conflict with swipe page-turn (require a two-finger gesture, single-finger stays reserved for swipe) |

### Auto-advance behavior (ReaderScreen)
When the current page's narration audio completes (its last karaoke word reaches "read" state), auto-advance to the next page after a **600ms pause** (long enough to let the illustration register before the transition, short enough not to feel laggy) using the same page-turn transition as a manual swipe/arrow-tap. On the last page, do not auto-advance past it — instead trigger StoryEndScreen (§16) directly. Auto-advance must be interruptible: any manual swipe/tap/scrub during the pause window cancels the pending auto-advance.

## 6. CZ/EN copy
See `copy-cz-en.md` in this bundle for the full string table (all screens, all states, both languages). Czech is the shipping language; English strings are provided for future localization scaffolding and are not yet used in any shipped screen.

## 7. Licensing & classic-tale count — final confirmation
- **34 classic tales confirmed as final** (10 Andersen + 24 Czech folk tales) — see `assets-manifest.md`. No additions pending; do not expand this list without a new content-sourcing pass.
- **Confirmed excluded, must not ship without a signed license:** Krteček (Zdeněk Miler estate / Bavaria Film), Tlapková patrola / PAW Patrol (Spin Master / Nickelodeon), Mickey Mouse (Disney), Pokémon (Nintendo / Game Freak / The Pokémon Company), Sonic the Hedgehog (Sega). Reference art for these exists only in `Asset Review.dc.html` as a record of the exclusion decision — do not copy it into production asset pipelines, `lib/themes.ts`, or any generation prompt.
- **Cleared for production use:** Krkonošské pohádky (Krakonoš — Czech folklore, public domain), Dinosauři, Vesmír, Autíčka (generic/original concepts, not tied to any franchise), all 8 bonus worlds (Kouzelný les, Podmořský svět, Džungle, Piráti, Stroje, Zima, Historie, Zvířátka — original concepts), and all 34 classic tales (Andersen d.1875 and traditional Czech tales — public domain source material; the *illustrations* are original artwork commissioned for this app, not scans of any historical illustrator's copyrighted work).
