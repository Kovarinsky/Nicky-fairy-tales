# Home Settings

## Entry point
A circular gear icon button (`icons/settings.svg`, 20px glyph in a 44×44 tap target) sits in the Home header, immediately to the **left of the avatar/account button** (top-right cluster: settings → avatar, 8px gap). Not inside the AccountModal — settings is one tap from Home for a logged-in or logged-out user alike.

## Icon & button
- Default: `rgba(255,255,255,.14)` circular background, cream gear glyph, no border.
- Hover (desktop): background lightens to `rgba(255,255,255,.22)`.
- Active/pressed: `transform: scale(0.9)`.
- Opens the Home Settings screen as a full-screen sheet (slides up from bottom, `--ease-sheet`), not a dropdown — it holds two multi-option pickers, too much content for a small popover.

## Variants the user can pick
Two independent swatch pickers, each backed by an existing enum already built into the design system's tweakable props (`tlacitka` and `svetlost` in `2 Vyber pohady.dc.html` / `4 Hlas.dc.html` / `5 Ctecka.dc.html`):

1. **Barva tlačítek** (5 options): Oranžová lesklá (brand default) · Švestková · Ohnivá · Noční obloha · Akvarel. Changes the color/gradient of every primary CTA pill across the whole app (Home's "Start nové pohádky", "Pokračovat", "Vytvořit pohádku", "Vybrat tento hlas", etc.) — a single global re-skin, not a per-screen setting.
2. **Světlost a nálada** (6 options): Bez filtru · Zlatý soumrak (default) · Hluboká noc · Fialový samet · Mléčná pohádka · Smaragdový les. Changes the color-grade filter applied over every background illustration app-wide (world art, catalog art, reader pages) — same mechanism already driving the `svetlost` prop in the existing screens.

Each swatch is a 44×44 circle showing a live preview of that variant's dominant gradient/tone — no text-only option list.

## What changes when you switch a variant
Nothing structural — no layout, copy, or icon changes. Only the CTA color gradient (variant 1) and the background color-grading filter (variant 2) update, instantly, across every screen in the app (not just Home). Both are cosmetic global re-skins layered on top of the same fixed layout and illustration set.

## Storage scope
**Account-level, synced across devices** once the user is logged in (stored alongside the profile — same place as `childAge`). Before login, or if a request fails, it falls back to **local device storage** so the choice still persists on that phone; on next login it syncs up and reconciles to the account value. Not a per-story or per-session setting — it's a standing app-wide preference.

## States captured
`14-home-settings.png` shows: `default` (nothing changed yet), `pickerOpen` is implicit in the swatch row always being visible (no separate expand step), and `saved` (the "✓ Uloženo do účtu" confirmation line appears immediately under the pickers after any tap — no separate save button; changes apply optimistically). All three sub-states are switchable live in `prototypes/New Screens 11-23.dc.html` under "22. Home Settings".
