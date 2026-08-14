# Illustration Style Bible — Nickyho pohádky

Binding for every generated image: story illustrations, character portraits, catalog cards, avatars, icons-as-imagery, backgrounds. One illustrator, one day, one style — no exceptions per screen or content type.

## Technique
Warm painted children's-book illustration (modern illustrated storybook / Pixar-adjacent concept art). **Not** flat vector/sticker art, **not** glossy 3D render, **not** photorealism, **not** crayon/pastelkový look with a wobbly outline.

## Lineart
Soft edges. Shapes are defined by color and shading, not by a thick black contour or crisp vector outlines. No visible linework separate from the paint.

## Shading
Soft, painterly gradients — light wraps around forms gently. No hard cel-shading, no specular "billiard ball" highlights, no flat single-tone fills.

## Color palette
Warm golden-amber light (candles, fireflies, magical glow) against deep indigo-violet night tones. Daytime scenes use soft, saturated warm pastels. Brand accent gradient `#f59e0b → #f97316` (orange) may appear in UI-adjacent imagery (e.g. glow accents) but is not the dominant palette of story scenes — night gradient (`#241447` → `#3a2344` family, see `nextjs/tokens.css`) is.

## Light
A soft glow halo surrounds every light source (candle, firefly, moon, magic effect). Light is always warm-directional, never flat/ambient-only — every scene should read "lit by something," not evenly floodlit.

## Character proportions
Big expressive eyes, soft rounded childlike proportions, pink/rosy cheeks, friendly simple expressions. Match the app's canon reference characters exactly (see CLAUDE.md at the project root and `assets/postavy/*.png`) — never redesign a named character's face shape, eye color, hair, or proportions between illustrations.

## Hair & clothing
Hair follows each character's canon description exactly (see CLAUDE.md). Clothing is **free per scene** — dress for the story's context (pajamas, winter coat, swimwear) — but hairstyle, hair color, eye color, and body proportions never change between illustrations of the same character.

## Character consistency rules
- Every scene featuring a named family character must visually reference that character's canon crop from `assets/postavy/*.png` — never regenerate a character's face from a text description alone.
- Nicolásek wears his beige cap in every scene unless the scene is nighttime/sleep (no cap).
- Multi-character scenes must respect the canon height/proportion ratios in `assets/postavy-lineup-v3.jpg`.

## Interaction & gaze direction
Characters look toward each other or toward the scene's point of interest — never straight at camera with a static "posed" gaze, except in single-subject avatar/portrait crops where a warm, friendly camera-facing gaze is correct (avatars are the one deliberate exception to the "never straight at camera" rule).

## Environment & background style
Same painted technique as characters — soft atmospheric perspective (distant elements gently softer/hazier), no photographic backgrounds, no flat gradient-only backgrounds standing in for an illustrated environment. Backgrounds carry as much illustrative care as character subjects; they are never a lower-effort placeholder layer.

## Forbidden styles (previously tried, rejected — do not repeat)
- Glossy 3D icons with a specular "billiard ball" highlight.
- Flat sticker/vector illustration with a white die-cut outline.
- Hand-drawn crayon/coloring-book style with a wobbly outline.
- Dark, "epic," or frightening treatments of any subject — no red glows, dark silhouettes, or dramatic action framing, even for adult-coded themes (sci-fi, corporate, history) — everything is retold as a warm children's story visually, regardless of subject matter.

## Applies uniformly to
Story page illustrations · character portraits · world/catalog thumbnail + full-size cards · voice-narrator avatars · any icon rendered as illustrated imagery (not the UI glyph icon set, which is flat SVG per `icons/`) · all background art.

## Gemini prompt suffix (append to every generation prompt)
```
, in the style of a warm painted children's storybook illustration (modern illustrated picture book, Pixar-adjacent concept art), soft painterly shading with no hard cel-shading or specular highlights, soft rounded lineless edges, warm golden-amber glowing light against deep indigo-violet tones for night scenes or soft saturated warm pastels for day scenes, big expressive eyes and gentle rounded childlike proportions, soft atmospheric perspective with distant elements gently softened, bright and friendly and never dark or frightening, no text or watermarks
```

## Gemini negative prompt (apply to every generation)
```
flat vector illustration, sticker style, white die-cut outline, thick black outline, glossy 3D render, specular highlight, plastic sheen, crayon drawing, coloring book line art, wobbly hand-drawn outline, photorealistic, photograph, dark and moody lighting, horror, scary, red glow, dramatic action pose, dark silhouette, low quality, blurry, extra limbs, deformed hands, text, watermark, signature
```

## Canonical character references
Versioned canonical crops live in `assets/postavy/*.png` (nicolasek, valentynka, jan, jana, james, bella, eva, jakob, archie), sourced from the approved lineup sheet `assets/postavy-lineup-v3.jpg`. Any new generation of a named character must be prompted with the matching crop attached as a reference image — never from text description alone. See CLAUDE.md for the full canon (heights, eye color, hair, Archie's markings, etc.) — that file is the single source of truth for character canon and takes precedence over any restatement here.
