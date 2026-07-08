// Sdílené typy pro celou pipeline pohádky

/** Postava, kterou lze do pohádky obsadit (s referenční fotkou pro konzistenci) */
export interface Character {
  /** Stabilní id, např. "nicolas" */
  id: string;
  /** Jméno, jak má vystupovat v příběhu, např. "Nicolásek" */
  name: string;
  /** Popis vzhledu (anglicky, pro image prompt), např. "a 5-year-old boy with blond hair" */
  description: string;
  /** Název souboru s referenční fotkou ve složce reference/ (volitelné) */
  referenceFile?: string;
  /** Další referenční fotky (např. detail obličeje) */
  referenceFiles?: string[];
  /** Anglická podoba jména (pro EN rozhraní i vyprávění) */
  nameEn?: string;
}

/** Vstup od uživatele z formuláře */
export interface StoryRequest {
  /** Volný popis / zápletka, např. "ztratili klíček od domečku" (může být prázdné) */
  topic: string;
  /** Volitelné téma/svět (Krteček, Tlapková patrola, …) – nápověda pro vypravěče */
  themePrompt?: string;
  /** Název tématu pro kontext (např. "Krkonošské pohádky") */
  themeName?: string;
  /** Postavy obsazené do pohádky (alespoň jedna) */
  characters: Character[];
  /** Věk cílového dítěte – ovlivňuje slovník a délku */
  age: number;
  /** Kolik scén (stránek) má pohádka mít */
  sceneCount: number;
  /** Jazyk (zatím "cs") */
  language: string;
  /** Ponaučení, které má pohádka přirozeně předat (volitelné) */
  moral?: string;
  /** Pokračování dřívější pohádky: název + shrnutí minulého děje */
  previousStory?: { title: string; text: string };
}

/** Zvukový svět scény – řídí procedurální ambient hudbu */
export type Soundscape = "magic" | "forest" | "night" | "adventure" | "cozy";

/** Jedna scéna = jedna stránka knížky */
export interface Scene {
  /** Pořadí scény od 1 */
  index: number;
  /** Text k namluvení (to, co slyší dítě) */
  narration: string;
  /** Anglický prompt pro generování ilustrace (Nano Banana) */
  imagePrompt: string;
  /** Ambient sound world for this scene */
  soundscape?: Soundscape;
}

/** Výstup Claude – hotový scénář */
export interface StoryScript {
  title: string;
  /** Krátký popis vzhledu hrdiny pro konzistenci napříč obrázky */
  heroDescription: string;
  scenes: Scene[];
}

/** Scéna obohacená o vygenerovaná média */
export interface RenderedScene extends Scene {
  /** Cesta/URL k obrázku (nebo data URL) */
  imageUrl?: string;
  /** Cesta/URL k audio souboru */
  audioUrl?: string;
}

/** Kompletní vyrenderovaná pohádka */
export interface RenderedStory {
  id: string;
  title: string;
  createdAt: string;
  scenes: RenderedScene[];
}
