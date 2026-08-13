# CD implementation acceptance loop

The CD layer is accepted only after both functional and visual checks pass.

## Every iteration

1. Run `npm test` and `npm run build`.
2. Run `node scripts/check-cd-preview.mjs` against local or deployed `/cd-preview`.
3. Capture the mobile (390×844) and desktop (1920×1080) screenshots produced in `test-results/`.
4. Compare spacing, hierarchy, card proportions, typography, controls and image crops against the CD handoff screenshots/spec.
5. Fix the smallest scoped component/CSS change, then repeat from step 1.
6. Push only after the loop is green; confirm Vercel is `Ready` and rerun the deployed URL check.

## Functional gates

- World selection changes the active tile.
- Continue opens details with the selected world and motif.
- Back returns without losing selection or motif.
- Catalog opens and a story pick moves to details.
- No CD preview change may alter the existing root wizard until its adapter is explicitly enabled.

## Visual gates

- Desktop uses the CD breathing room and large tiles, not a scaled mobile layout.
- Mobile remains scrollable and keeps the primary CTA reachable.
- Background crops preserve the focal subject.
- Text remains readable over the artwork and controls remain touch-sized.
