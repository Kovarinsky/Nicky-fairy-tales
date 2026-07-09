import { NextRequest, NextResponse } from "next/server";
import { generateStory, type StoryExtras } from "@/lib/claude";
import { charactersByIds, loadCharacters } from "@/lib/characters";
import { themeById } from "@/lib/themes";
import type { StoryRequest, Character } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

async function fetchUrlText(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(7000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NickyFairyBot/1.0)" },
    });
    if (!res.ok) return "";
    const html = await res.text();
    return html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#\d+;/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const topic = String(body.topic || "").trim();
    const theme = body.themeId ? themeById(String(body.themeId)) : undefined;

    const hasInspiration =
      topic ||
      theme ||
      (Array.isArray(body.inspirationImages) && body.inspirationImages.length > 0) ||
      body.inspirationPdfBase64 ||
      body.inspirationUrl ||
      body.previousStory?.title; // pokračování dřívější pohádky je samo o sobě zadání

    if (!hasInspiration) {
      return NextResponse.json(
        { error: "Vyber téma, napiš přání nebo přilož inspiraci." },
        { status: 400 }
      );
    }

    // Existing characters from disk
    const ids: string[] = Array.isArray(body.characterIds) ? body.characterIds : [];
    let characters: Character[] = ids.length ? charactersByIds(ids) : loadCharacters();
    if (characters.length === 0) {
      characters = [{ id: "hero", name: "Hrdina", description: "a young child" }];
    }

    // Custom characters sent from browser
    const rawCustom: Array<{ id: string; name: string; description?: string }> =
      Array.isArray(body.customCharacters) ? body.customCharacters : [];
    const customCharacters: StoryExtras["customCharacters"] = rawCustom.map((cc) => ({
      id: cc.id,
      name: cc.name,
      description: cc.description || `a character named ${cc.name}`,
      photoBase64: body.customCharacters?.find((c: { id: string }) => c.id === cc.id)?.photoBase64,
      photoMimeType: body.customCharacters?.find((c: { id: string }) => c.id === cc.id)?.photoMimeType,
    }));

    // Fetch URL content
    const urlText = body.inspirationUrl ? await fetchUrlText(String(body.inspirationUrl)) : "";

    const language = String(body.language || "cs") === "en" ? "en" : "cs";

    // Vlastní svět (téma podle fotky/popisu) má přednost před předdefinovaným
    const customTheme = body.customTheme && typeof body.customTheme.prompt === "string"
      ? { name: String(body.customTheme.name || "Vlastní svět"), prompt: String(body.customTheme.prompt).slice(0, 1200) }
      : undefined;

    const storyReq: StoryRequest = {
      topic,
      themeName: customTheme?.name ?? theme?.name,
      themePrompt: customTheme?.prompt ?? theme?.prompt,
      characters,
      age: Number(body.age) || 4,
      sceneCount: Math.min(Math.max(Number(body.sceneCount) || 6, 1), 20),
      language,
      twoEndings: !!body.twoEndings,
      moral: body.moral ? String(body.moral).slice(0, 300) : undefined,
      previousStory: body.previousStory?.title
        ? {
            title: String(body.previousStory.title).slice(0, 200),
            text: String(body.previousStory.text || "").slice(0, 4000),
          }
        : undefined,
    };

    const extras: StoryExtras = {
      customCharacters,
      inspirationImages: Array.isArray(body.inspirationImages) ? body.inspirationImages : [],
      inspirationPdfBase64: body.inspirationPdfBase64 || undefined,
      inspirationUrlText: urlText || undefined,
    };

    const script = await generateStory(storyReq, extras);
    return NextResponse.json(script);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
