# Known Differences vs. vFinal3

1. **Home Settings screen added.** Did not exist as a named screen in vFinal3; now specified end-to-end in `home-settings.md` with entry point, variants, storage scope, and screenshot (`14-home-settings.png`, EXPLORATORY).
2. **"Výběr postav" replaces "Nová postava" as the primary character screen in this round's list.** It's a new dedicated multi-select grid screen (`15-vyber-postav.png`, EXPLORATORY) — distinct from the add/edit single-character form ("Nová postava," still present, carried over from vFinal2/vFinal3 unchanged).
3. **"Výběr vypravěče" is a rename, not a redesign.** It is the same screen documented as "Výběr hlasu" in vFinal2/vFinal3 (`4 Hlas.dc.html`) — `16-vyber-vypravece.png` is a direct copy of vFinal3's `08-vyber-hlasu.png`, no visual change.
4. **Icon set expanded from 18 to 25.** Added: `upload`, `link`, `research`, `voice`, `settings`, `account` (6 new). `library` is intentionally an alias of the existing `book.svg`, not a new file — same glyph, two use-cases.
5. **Avatar audit completed.** All family-character and voice-narrator avatars already existed as dedicated, purpose-built assets (never catalog art) — see `avatars-manifest.md`. The only gap found: `jan`/`jana`/`eva`/`jakob`/`archie` have full-body canon source art but no circular UI-avatar crop yet, since no current flow needs one.
6. **Home background formally documented as its own artifact**, separate from the world/tale catalog — `home-background.md` — clarifying it's a pre-existing, already-wired asset set (`bg-log.jpg` + 3 variants + custom), not something new.
7. **Button behavior and hit-area specs formalized** as dedicated files (`button-behavior.md`, `hit-areas.md`) — this detail existed implicitly in component code before, now written down explicitly per the 8 named buttons and the universal sizing/spacing/press-state rules.
8. **Responsivity re-confirmed line-by-line** against the exact checklist requested this round (`responsivity-confirmed.md`) — no rule changed from vFinal3, this is a confirmation pass, not a revision.

Nothing from vFinal3 was removed or contradicted; this package is additive.
