# Navigation & State Map — Nickyho pohádky

12 screens, their route/state, primary CTA, Back behavior, and presentation mode.

| # | Screen | State / route | Primary CTA | Back button | Loading | Error | Empty | Presentation |
|---|---|---|---|---|---|---|---|---|
| 1 | Home | `/` | "Start nové pohádky" | n/a (root) | n/a | n/a | n/a (always has world bg) | Full-screen |
| 2 | Výběr světa | `/new?step=1` | "Pokračovat" (enabled once a world/tale is selected) | → Home | Katalog thumbnails show skeleton shimmer while fetching | inline retry banner if world list fails to load | "Zatím žádné vlastní pohádky" placeholder in VLASTNÍ POHÁDKY roller when empty | Full-screen |
| 3 | Katalog pohádek | `/new/catalog` (opened from step 1's "Všechny pohádky" tile) | tapping a tile opens Detail | → Výběr světa (closes catalog, does not go to Home) | grid tiles show skeleton shimmer | inline retry banner | "Nic nenalezeno" under search when filter has no matches | Full-screen (opened as an overlay layer over step 1) |
| 4 | Detail pohádky | in-catalog overlay, keyed by tale id | "Vybrat tuto pohádku" (+ "Poslechnout v originále" on classic tales) | → Katalog pohádek (closes detail, catalog stays open) | n/a (art is pre-loaded from catalog) | n/a | n/a | Full-screen overlay within Katalog |
| 5 | Vytvořit vlastní svět | `/new/create-world` (opened from step 1's "＋ Vlastní pohádka" tile) | "Uložit svět" | → Výběr světa (discards unsaved draft after confirm) | "Prostudovat" shows inline spinner while researching | inline error under the failed field (e.g. broken link) | n/a (form always starts empty) | Bottom sheet / full-screen on small viewports |
| 6 | Detaily pohádky | `/new?step=2` | "Vytvořit pohádku" | → Výběr světa | n/a | validation errors inline per field | n/a | Full-screen |
| 7 | Nová postava | `/new/character/new` or `/character/:id/edit` (opened from step 2's character row) | "Přidat postavu" / "Uložit" | → Detaily pohádky (discards unsaved draft after confirm) | photo upload shows inline spinner per slot | inline error under the failed upload | n/a | Bottom sheet / full-screen on small viewports |
| 8 | Výběr hlasu | `/new/voice` | "Vybrat tento hlas" | → Detaily pohádky | n/a (voices are bundled, no fetch) | n/a | n/a | Full-screen |
| 9 | Generation progress | `/story/:id/generating` | n/a (no proceed action; auto-advances to Reader on completion) | "Zrušit" text link → confirm modal → Katalog/Home | the screen itself IS the loading state (3 sequential sub-steps) | full-screen error state ("Něco se nepovedlo") with Retry + "Zpět na úpravu pohádky" | n/a | Full-screen |
| 10 | Reader | `/story/:id/read?page=n` | play/pause (no "next screen" CTA — auto-advances to Konec pohádky after the last page) | → Story Library (or Home if opened directly) | n/a (pages pre-generated before Reader opens) | n/a (a broken page falls back to text-only) | n/a | Full-screen |
| 11 | Konec pohádky | `/story/:id/end` (auto-shown after the last Reader page finishes) | "Poslechnout bonusovou písničku" | orange × (top-right) → Story Library | n/a | n/a | n/a | Full-screen modal card over the story's last illustration |
| 12 | Bonusová písnička | `/story/:id/song` (opened from Konec pohádky's CTA) | play/pause toggle; "Hotovo" to close | "Hotovo" text link → Story Library | spinner + "Skládám písničku…" while generating (only on first open — cached after) | inline error + "Hotovo" to dismiss | n/a | Full-screen |

## Flow diagram (linear + branches)
```
Home ──(Start nové pohádky)──▶ Výběr světa (step 1)
Výběr světa ──(Všechny pohádky tile)──▶ Katalog pohádek ──(tap tile)──▶ Detail pohádky ──(Vybrat)──▶ back to step 1, world set
Výběr světa ──(＋ Vlastní pohádka tile)──▶ Vytvořit vlastní svět ──(Uložit svět)──▶ back to step 1, world set
Výběr světa ──(Pokračovat)──▶ Detaily pohádky (step 2)
Detaily pohádky ──(＋ Přidat / tap avatar)──▶ Nová postava ──(Přidat/Uložit)──▶ back to step 2
Detaily pohádky ──(tap voice row)──▶ Výběr hlasu ──(Vybrat tento hlas)──▶ back to step 2
Detaily pohádky ──(Vytvořit pohádku)──▶ Generation progress ──(auto, ~300s ceiling)──▶ Reader
Reader ──(last page's narration finishes)──▶ Konec pohádky
Konec pohádky ──(Poslechnout bonusovou písničku)──▶ Bonusová písnička ──(Hotovo)──▶ Story Library
Konec pohádky ──(×)──▶ Story Library
```

## Notes
- Screens 3–4 (Katalog/Detail) and 5/7 (Vytvořit svět/Nová postava) are **overlay layers**, not separate top-level routes in the prototype — model them as modal/sheet routes in production (e.g. Next.js parallel/intercepting routes or a client-side modal stack) so the browser Back button closes the overlay instead of leaving the flow.
- "Zpět" inside the 2-step wizard (screens 2, 6) always returns to the previous step, never to Home directly — Home is only reachable via Back from step 1.
