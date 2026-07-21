// POST /api/world-study { language, name, description } — Claude nastuduje
// vlastní svět pohádky. Z popisu vytáhne internetové odkazy (max 2), stáhne
// jejich text a sestaví průvodce světem (formát jako THEMES prompty). Když mu
// chybí podstatná informace, vrátí i jednu doplňující otázku pro uživatele.

import { NextRequest, NextResponse } from "next/server";
import { studyWorld } from "@/lib/claude";

export const runtime = "nodejs";
export const maxDuration = 60;

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
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 2500);
  } catch {
    return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const language = String(body.language || "cs") === "en" ? "en" : "cs";
    const name = String(body.name || "").slice(0, 120);
    const description = String(body.description || "").slice(0, 2000);
    if (!name.trim() && !description.trim()) {
      return NextResponse.json({ error: "empty" }, { status: 400 });
    }
    const urls = (description.match(/https?:\/\/[^\s"'<>]+/g) || []).slice(0, 2);
    const urlTexts = await Promise.all(urls.map(fetchUrlText));
    // 📸 Fotky skutečného místa/postav — appka je teď pošle jako obrázky, ať
    // si Claude svět skutečně PROHLÉDNE, ne jen domýšlí z textu
    const photos = Array.isArray(body.photos)
      ? (body.photos as Array<{ data?: unknown; mimeType?: unknown }>)
          .filter(p => typeof p?.data === "string" && typeof p?.mimeType === "string")
          .slice(0, 5)
          .map(p => ({ data: p.data as string, mimeType: p.mimeType as string }))
      : [];
    const result = await studyWorld(language, name, description, urlTexts, photos);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
