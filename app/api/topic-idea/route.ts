// POST /api/topic-idea { language, characterNames[], themeId?, customTheme?, hint? }
// — Claude vymyslí jeden hravý námět na pohádku (1–2 věty). Když je vybraný
// svět pohádky, námět se odehrává v něm; hint je text, který už má uživatel
// napsaný v poli přání (námět na něm staví).

import { NextRequest, NextResponse } from "next/server";
import { suggestTopicIdea } from "@/lib/claude";
import { themeById } from "@/lib/themes";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const language = String(body.language || "cs") === "en" ? "en" : "cs";
    const names: string[] = Array.isArray(body.characterNames)
      ? body.characterNames.filter((x: unknown) => typeof x === "string").slice(0, 10)
      : [];
    const theme = body.themeId ? themeById(String(body.themeId)) : undefined;
    const customTheme = body.customTheme && typeof body.customTheme.prompt === "string"
      ? { name: String(body.customTheme.name || "Vlastní svět"), prompt: String(body.customTheme.prompt).slice(0, 1200) }
      : undefined;
    const idea = await suggestTopicIdea(language, names, {
      themeName: customTheme?.name ?? theme?.name,
      themePrompt: customTheme?.prompt ?? theme?.prompt,
      userHint: typeof body.hint === "string" && body.hint.trim() ? body.hint.trim() : undefined,
    });
    return NextResponse.json({ idea });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
