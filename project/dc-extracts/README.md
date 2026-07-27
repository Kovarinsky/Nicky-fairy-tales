# DC canvas extracts (design-bundle-v6)

Raw HTML/CSS/text markup extracted directly from the `.dc.html` design canvases in the
newest CD/Canva handoff zip (`Nickyho pohádky home screen-handoff (1).zip`, exported
2026-07-27 01:31). These are **not** React components — they're verbatim excerpts of the
interactive canvas source (inline styles, `{{ }}` template bindings, `sc-if`/`sc-for`
control blocks), kept exactly as authored so the real markup/CSS/copy is available even
where no `.tsx` handoff exists yet.

## Key finding: yes, the .dc.html canvases and the .tsx exports differ

Both came from the **same export** (identical file sizes/timestamps in the zip — there is
no newer canvas revision), so the differences are not staleness, they're gaps introduced
during the React handoff:

1. **Home screen bottom nav bar** — the canvas (`1 Home.dc.html`) defines only **3** icons:
   `Postavy`, `Světy`, `Hlas`. `HomeScreen.tsx` has **4** — it adds a `Pozadí` (PaletteIcon)
   button that does not exist in the canvas at all.
2. **Vyber pohady — krok 1/2 (Svět) layout** — the canvas has two separate horizontal-scroll
   sections, `PŘIPRAVENÉ POHÁDKY` and `VLASTNÍ POHÁDKY` (confirmed at lines 36 and 50 of
   `2 Vyber pohady.dc.html`). `WorldsScreen.tsx` instead renders a single
   `<section className={styles.carousel}>` with one combined `worlds.map()` list — the
   two-section split is missing there. (`StorySelectionScreen.tsx` does have an equivalent
   two-section split, but labeled `PŘIPRAVENÉ SVĚTY` / `VLASTNÍ SVĚTY` — different wording
   than the canvas.)

## File map (9 requested screens + 1 supplementary)

| File | Screen | Source | Lines |
|---|---|---|---|
| `01-home-screen.dc-extract.html` | 1. Home screen | `1 Home.dc.html` | 1-69 |
| `02-account-profile-modal.dc-extract.html` | 2. Account/profil modal | `1 Home.dc.html` | 73-157 |
| `03-vyber-svet-krok1.dc-extract.html` | 3. Výběr pohádky — krok 1/2 (Svět) | `2 Vyber pohady.dc.html` | 1-73 |
| `04-katalog-vyhledavani.dc-extract.html` | 4. Katalog/vyhledávání (template) | `2 Vyber pohady.dc.html` | 74-91 |
| `04b-katalog-tab-labels.dc-extract.txt` | 4b. Katalog — real tab/grid text values | `2 Vyber pohady.dc.html` | 711-737 |
| `05-vytvorit-vlastni-pohadku.dc-extract.html` | 5. Vytvořit vlastní pohádku | `2 Vyber pohady.dc.html` | 295-379 |
| `06-vyber-pohadky-krok2.dc-extract.html` | 6. Výběr pohádky — krok 2/2 (Pohádka), main view | `2 Vyber pohady.dc.html` | 92-153 |
| `06b-pohadka-sheet-detail.dc-extract.html` | 6b. Pohádka detail sheet (název/žánr/atmosféra) | `2 Vyber pohady.dc.html` | 380-447 |
| `07-motiv-pohadky.dc-extract.html` | 7. Motiv pohádky (velký editor textu) | `2 Vyber pohady.dc.html` | 448-465 |
| `08-nova-postava.dc-extract.html` | 8. Nová postava | `2 Vyber pohady.dc.html` | 234-280 |
| `09-vyber-hlasu.dc-extract.html` | 9. Výběr hlasu | `4 Hlas.dc.html` | 1-131 (whole file) |

Note: screens 4, 5, 6/6b, 7 and 8 all live inside the single `2 Vyber pohady.dc.html`
canvas as different `sc-if`-gated views of one multi-step component — that file alone
covers 6 of the 9 requested screens.
