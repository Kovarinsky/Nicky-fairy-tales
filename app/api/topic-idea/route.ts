// POST /api/topic-idea { language, characterNames[] } — Claude vymyslí jeden
// hravý námět na pohádku (1–2 věty), který si uživatel může upravit.

import { NextRequest, NextResponse } from "next/server";
import { suggestTopicIdea } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const language = String(body.language || "cs") === "en" ? "en" : "cs";
    const names: string[] = Array.isArray(body.characterNames)
      ? body.characterNames.filter((x: unknown) => typeof x === "string").slice(0, 10)
      : [];
    const idea = await suggestTopicIdea(language, names);
    return NextResponse.json({ idea });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
