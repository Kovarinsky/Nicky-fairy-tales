// Sdílené typy pro celou pipeline pohádky

/** Vstup od uživatele z formuláře */
export interface StoryRequest {
  /** Téma / zápletka, např. "Nicolas a draci na hradě" */
  topic: string;
  /** Jméno hrdiny (default Nicolas) */
  heroName: string;
  /** Věk dítěte – ovlivňuje slovník a délku */
  age: number;
  /** Kolik scén (stránek) má pohádka mít */
  sceneCount: number;
  /** Jazyk (zatím "cs") */
  language: string;
}

/** Jedna scéna = jedna stránka knížky */
export interface Scene {
  /** Pořadí scény od 1 */
  index: number;
  /** Text k namluvení (to, co slyší dítě) */
  narration: string;
  /** Anglický prompt pro generování ilustrace (Nano Banana) */
  imagePrompt: string;
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
