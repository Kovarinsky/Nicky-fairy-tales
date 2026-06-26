// POST /api/story → vygeneruje scénář pohádky (jen Claude).
// Tělo: { topic, characterIds?: string[], age?, sceneCount?, language? }
// Vrací: StoryScript

import { NextRequest, NextResponse } from "next/server";
import { generateStory } from "@/lib/claude";
import { charactersByIds, loadCharacters } from "@/lib/characters";
import { themeById } from "@/lib/themes";
import type { StoryRequest, Character } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const topic = String(body.topic || "").trim();
    const theme = body.themeId ? themeById(String(body.themeId)) : undefined;

    // Stačí buď zvolené téma, nebo vlastní popis.
    if (!topic && !theme) {
      return NextResponse.json(
        { error: "Vyber téma nebo napiš, o čem má pohádka být." },
        { status: 400 }
      );
    }

    // Postavy: podle vybraných id; fallback na všechny, jinak obecný hrdina.
    const ids: string[] = Array.isArray(body.characterIds) ? body.characterIds : [];
    let characters: Character[] = ids.length ? charactersByIds(ids) : loadCharacters();
    if (characters.length === 0) {
      characters = [
        { id: "hero", name: "Nicolas", description: "a young child", referenceFile: "" },
      ];
    }

    const request: StoryRequest = {
      topic,
      themeName: theme?.name,
      themePrompt: theme?.prompt,
      characters,
      age: Number(body.age) || 4,
      sceneCount: Math.min(Math.max(Number(body.sceneCount) || 6, 1), 12),
      language: String(body.language || "cs"),
    };

    const script = await generateStory(request);
    return NextResponse.json(script);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
