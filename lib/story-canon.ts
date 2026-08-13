import type { StoryRequest, StoryScript } from "./types";

const RESERVED_LIBRARY_PATTERNS: Record<string, RegExp> = {
  nicolas: /\bnicol[aá]s(?:ek|ka|kovi|kem|ku)?\b/iu,
  valentyna: /\b(?:valent[ýy]n(?:ka|ku|ce|kou|ky)?|váj(?:a|i|u|ou)?)\b/iu,
  jan: /\b(?:táta\s+)?jan(?:ovi|em)?\b/iu,
  jana: /\b(?:máma\s+)?jan(?:a|ě|u|ou)\b/iu,
  archie: /\barchi(?:e|emu|eho|em)\b/iu,
  james: /\bjames(?:e|ovi|em)?\b/iu,
  bella: /\bbell(?:a|u|e|ou|y)\b/iu,
  eva: /\bev(?:a|u|ě|ou|y)\b/iu,
  jakob: /\bjakob(?:a|ovi|em)?\b/iu,
};

/** Deterministická pojistka za promptem: pravidla identity a dětské řeči
 * nesmí záviset jen na tom, zda si jich model při dlouhém scénáři všiml. */
export function validateStoryCanon(
  script: StoryScript,
  req: StoryRequest,
  extras: { customCharacters?: Array<{ name: string }> } = {}
): void {
  const allScenes = script.choice ? [...script.scenes, ...script.choice.altScenes] : script.scenes;
  const selectedIds = new Set(req.characters.map(c => c.id));
  const selectedCustomNames = (extras.customCharacters || []).map(c => c.name.toLocaleLowerCase("cs"));
  const narration = allScenes.map(s => s.narration).join("\n");

  for (const [id, pattern] of Object.entries(RESERVED_LIBRARY_PATTERNS)) {
    if (selectedIds.has(id)) continue;
    if (selectedCustomNames.some(n => pattern.test(n))) continue;
    if (pattern.test(narration)) {
      throw new Error(`Scénář použil rezervované jméno nevybrané knihovní postavy (${id}).`);
    }
  }

  if (selectedIds.has("valentyna")) {
    const speechVerb = /(?:řekla|zeptala|zašeptala|zvolala|povídala|odpověděla|said|asked|whispered|called|replied)/iu;
    const name = /(?:valent[ýy]n|váj)/iu;
    for (const scene of allScenes) {
      const quoteRe = /[„“"]([^„“"]+)[“"]/gu;
      for (const match of scene.narration.matchAll(quoteRe)) {
        const before = scene.narration.slice(Math.max(0, (match.index || 0) - 90), match.index);
        const afterStart = (match.index || 0) + match[0].length;
        const after = scene.narration.slice(afterStart, afterStart + 90);
        const context = `${before} ${after}`;
        if (!name.test(context) || !speechVerb.test(context)) continue;
        const words = match[1].replace(/[!?.,…]/g, " ").trim().split(/\s+/u).filter(Boolean);
        if (words.length > 2) {
          throw new Error("Valentýnka/Vája promluvila delší než dvouslovnou batolecí replikou.");
        }
      }
    }
  }

  for (const scene of allScenes) {
    const cues = scene.sfxCues || [];
    if (cues.length !== 2 || cues[0].effect === cues[1].effect || cues[1].at - cues[0].at < 0.1) {
      throw new Error(`Scéna ${scene.index} nemá dva odlišné, rozumně rozestoupené zvukové cue.`);
    }
  }
}
