// Postavy s referenčními fotkami.
//
// SOUKROMÍ: fotky dětí ani reference/characters.json se NEcommitují (jsou v .gitignore).
// V repu je jen reference/characters.example.json jako vzor.
//
// Lokální nastavení:
//   1) zkopíruj reference/characters.example.json → reference/characters.json
//   2) dej do reference/ fotky (např. nicolas.jpg, valentyna.jpg) a uprav characters.json

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Character } from "./types";

const REFERENCE_DIR = path.join(process.cwd(), "reference");
const CONFIG_PATH = path.join(REFERENCE_DIR, "characters.json");

/** Načte definice postav z reference/characters.json (prázdné pole, když chybí). */
export function loadCharacters(): Character[] {
  if (!existsSync(CONFIG_PATH)) return [];
  try {
    const raw = readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Character[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Najde postavy podle id (zachová pořadí z configu). */
export function charactersByIds(ids: string[]): Character[] {
  const all = loadCharacters();
  return all.filter((c) => ids.includes(c.id));
}

export interface ReferenceImage {
  data: string; // base64
  mimeType: string;
  /** Jméno postavy na fotce (pro instrukci v promptu) */
  name?: string;
  /** Volitelný vlastní instrukční text místo výchozího "Reference photo of ..." */
  label?: string;
}

function mimeFromExt(file: string): string {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/** Načte referenční fotky daných postav jako base64 (přeskočí chybějící soubory). */
export function loadReferenceImages(characters: Character[]): ReferenceImage[] {
  const images: ReferenceImage[] = [];
  for (const c of characters) {
    if (!c.referenceFile) continue;
    const filePath = path.join(REFERENCE_DIR, c.referenceFile);
    if (!existsSync(filePath)) continue;
    images.push({
      data: readFileSync(filePath).toString("base64"),
      mimeType: mimeFromExt(c.referenceFile),
      name: c.name,
    });
  }
  return images;
}
