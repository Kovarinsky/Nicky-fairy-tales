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

const SAFE_REPLACEMENT_NAMES: Record<string, string> = {
  nicolas: "Filípek",
  valentyna: "Anička",
  jan: "Martin",
  jana: "Klára",
  archie: "Bady",
  james: "Matěj",
  bella: "Rozárka",
  eva: "Amálka",
  jakob: "Tobiáš",
};

export interface CanonPreflightRename {
  libraryId: string;
  replacement: string;
}

function selectedLibraryIds(req: StoryRequest): Set<string> {
  return new Set(req.characters.map(c => c.id));
}

function replaceReservedNames(
  text: string,
  req: StoryRequest,
  extras: { customCharacters?: Array<{ name: string }> } = {}
): { text: string; renames: CanonPreflightRename[] } {
  const selectedIds = selectedLibraryIds(req);
  const selectedCustomNames = (extras.customCharacters || []).map(c => c.name.toLocaleLowerCase("cs"));
  const renames: CanonPreflightRename[] = [];

  for (const [id, pattern] of Object.entries(RESERVED_LIBRARY_PATTERNS)) {
    if (selectedIds.has(id) || selectedCustomNames.some(name => pattern.test(name))) continue;
    if (!pattern.test(text)) continue;
    const replacement = SAFE_REPLACEMENT_NAMES[id];
    const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`);
    text = text.replace(globalPattern, match => {
      const lower = match.toLocaleLowerCase("cs");
      if (id === "jan" && lower.startsWith("táta ")) return `táta ${replacement}`;
      if (id === "jana" && lower.startsWith("máma ")) return `máma ${replacement}`;
      return replacement;
    });
    renames.push({ libraryId: id, replacement });
  }
  return { text, renames };
}

/**
 * Resolve a library-name conflict before any paid model call. A name written
 * in the outline does not implicitly select its library portrait: if its card
 * was not selected, the role keeps its plot function but receives a neutral
 * name unrelated to the library canon.
 */
export function prepareStoryRequestCanon(
  req: StoryRequest,
  extras: { customCharacters?: Array<{ name: string }> } = {}
): { request: StoryRequest; renames: CanonPreflightRename[] } {
  const { text: topic, renames } = replaceReservedNames(req.topic, req, extras);
  return { request: topic === req.topic ? req : { ...req, topic }, renames };
}

/**
 * Final safety net for names invented by the model itself. Unlike validation,
 * this preserves the completed story and changes only the forbidden identity
 * label, so a 12-scene response is never discarded for a deterministic rename.
 */
export function repairStoryCanonNames(
  script: StoryScript,
  req: StoryRequest,
  extras: { customCharacters?: Array<{ name: string }> } = {}
): CanonPreflightRename[] {
  const mappings = new Map<string, CanonPreflightRename>();
  const repair = (value: string | undefined): string | undefined => {
    if (!value) return value;
    const result = replaceReservedNames(value, req, extras);
    result.renames.forEach(rename => mappings.set(rename.libraryId, rename));
    return result.text;
  };

  script.title = repair(script.title) || script.title;
  script.heroDescription = repair(script.heroDescription) || script.heroDescription;
  script.worldNotes = repair(script.worldNotes);
  const scenes = script.choice ? [...script.scenes, ...script.choice.altScenes] : script.scenes;
  for (const scene of scenes) {
    scene.narration = repair(scene.narration) || scene.narration;
    scene.imagePrompt = repair(scene.imagePrompt) || scene.imagePrompt;
  }
  if (script.choice) {
    script.choice.options = [
      repair(script.choice.options[0]) || script.choice.options[0],
      repair(script.choice.options[1]) || script.choice.options[1],
    ];
  }
  return [...mappings.values()];
}

export class StoryCanonError extends Error {
  readonly code: "RESERVED_LIBRARY_NAME" | "TODDLER_SPEECH" | "SOUND_CUES";

  constructor(code: "RESERVED_LIBRARY_NAME" | "TODDLER_SPEECH" | "SOUND_CUES", message: string) {
    super(message);
    this.name = "StoryCanonError";
    this.code = code;
  }
}

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
      throw new StoryCanonError("RESERVED_LIBRARY_NAME", `Scénář použil rezervované jméno nevybrané knihovní postavy (${id}).`);
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
          throw new StoryCanonError("TODDLER_SPEECH", "Valentýnka/Vája promluvila delší než dvouslovnou batolecí replikou.");
        }
      }
    }
  }

  for (const scene of allScenes) {
    const cues = scene.sfxCues || [];
    if (cues.length !== 2 || cues[0].effect === cues[1].effect || cues[1].at - cues[0].at < 0.1) {
      throw new StoryCanonError("SOUND_CUES", `Scéna ${scene.index} nemá dva odlišné, rozumně rozestoupené zvukové cue.`);
    }
  }
}
