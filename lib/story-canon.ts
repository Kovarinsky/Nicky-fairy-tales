import type { StoryRequest, StoryScript } from "./types";

const RESERVED_LIBRARY_PATTERNS: Record<string, RegExp> = {
  // JavaScriptové \b zná jen ASCII: v „dřevěná" proto chybně považovalo
  // „evě" za samostatné jméno Eva. Unicode hranice hlídají všechna písmena.
  nicolas: /(?<!\p{L})nicol[aá]s(?:ek|ka|kovi|kem|ku)?(?!\p{L})/iu,
  valentyna: /(?<!\p{L})(?:valent[ýy]n(?:ka|ku|ce|kou|ky)?|váj(?:a|i|u|ou)?)(?!\p{L})/iu,
  jan: /(?<!\p{L})(?:táta\s+)?jan(?:ovi|em)?(?!\p{L})/iu,
  jana: /(?<!\p{L})(?:máma\s+)?jan(?:a|ě|u|ou)(?!\p{L})/iu,
  archie: /(?<!\p{L})archi(?:e|emu|eho|em)(?!\p{L})/iu,
  james: /(?<!\p{L})james(?:e|ovi|em)?(?!\p{L})/iu,
  bella: /(?<!\p{L})bell(?:a|u|e|ou|y)(?!\p{L})/iu,
  eva: /(?<!\p{L})ev(?:a|u|ě|ou|y)(?!\p{L})/iu,
  jakob: /(?<!\p{L})jakob(?:a|ovi|em)?(?!\p{L})/iu,
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

const CZECH_NARRATION_LEAKS: Array<[RegExp, string]> = [
  [/\b(Máma\s+\p{L}+)\s+children\s+přivinula\b/giu, "$1 přivinula děti"],
  [/\bchildren\b/giu, "děti"],
  [/\bchild\b/giu, "dítě"],
  [/\bmother\b/giu, "maminka"],
  [/\bfather\b/giu, "tatínek"],
  [/\btogether\b/giu, "společně"],
];

/** Remove isolated English prompt leakage from Czech narration without another
 * model call. Image prompts intentionally remain English. */
export function repairStoryNarrationLanguage(script: StoryScript, language: string): number {
  if (language !== "cs") return 0;
  const scenes = script.choice ? [...script.scenes, ...script.choice.altScenes] : script.scenes;
  let replacements = 0;
  for (const scene of scenes) {
    for (const [pattern, replacement] of CZECH_NARRATION_LEAKS) {
      const matches = scene.narration.match(pattern);
      if (matches) replacements += matches.length;
      scene.narration = scene.narration.replace(pattern, replacement);
    }
  }
  return replacements;
}

function toddlerSpeechReplacement(speech: string): string {
  const lower = speech.toLocaleLowerCase("cs");
  const semantic: Array<[RegExp, string]> = [
    [/skřít/iu, "Skřítek!"],
    [/mam(?:i|ink)/iu, "Mami!"],
    [/boj/iu, "Bojím se!"],
    [/podívej|koukej/iu, "Podívej!"],
    [/pojď/iu, "Pojď!"],
    [/krás|nádher/iu, "Krásné!"],
    [/děkuj/iu, "Děkuju!"],
    [/našli|našla/iu, "Našli jsme!"],
    [/chci/iu, "Chci taky!"],
  ];
  for (const [pattern, value] of semantic) if (pattern.test(lower)) return value;
  const words = speech.replace(/[!?.,…]/gu, " ").trim().split(/\s+/u).filter(Boolean);
  if (["já", "to", "tam", "tady", "ještě", "moc"].includes(words[0]?.toLocaleLowerCase("cs"))) {
    return `${words.slice(0, 2).join(" ")}!`;
  }
  return `${words[0] || "Jé"}!`;
}

/** Shorten only direct speech attributed to selected two-year-old Valentýna.
 * The completed plot and all other narration remain untouched. */
export function repairToddlerSpeech(script: StoryScript, req: StoryRequest): number {
  if (!selectedLibraryIds(req).has("valentyna")) return 0;
  const scenes = script.choice ? [...script.scenes, ...script.choice.altScenes] : script.scenes;
  const speechVerb = /(?:řekla|zeptala|zašeptala|zvolala|povídala|odpověděla|vykřikla|vyjekla|said|asked|whispered|called|replied)/iu;
  const name = /(?:valent[ýy]n|váj)/iu;
  let repairs = 0;
  for (const scene of scenes) {
    const original = scene.narration;
    const quoteRe = /[„“"]([^„“"]+)[“"]/gu;
    scene.narration = original.replace(quoteRe, (full, speech: string, offset: number) => {
      const before = original.slice(Math.max(0, offset - 100), offset);
      const after = original.slice(offset + full.length, offset + full.length + 100);
      const context = `${before} ${after}`;
      if (!name.test(context) || !speechVerb.test(context)) return full;
      const words = speech.replace(/[!?.,…]/gu, " ").trim().split(/\s+/u).filter(Boolean);
      if (words.length <= 2) return full;
      repairs++;
      return `${full[0]}${toddlerSpeechReplacement(speech)}${full[full.length - 1]}`;
    });
  }
  return repairs;
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

  const customCues = allScenes.flatMap(s => s.sfxCues || []).filter(c => !!c.customPrompt);
  if (customCues.length > 2) {
    // Nezahazuj drahý scénář: přebytečné návrhy se deterministicky vrátí na
    // své povinné knihovní fallbacky.
    customCues.slice(2).forEach(c => { delete c.customPrompt; delete c.customDurationSec; delete c.audioUrl; });
  }

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
