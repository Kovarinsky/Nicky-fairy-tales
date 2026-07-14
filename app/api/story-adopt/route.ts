// POST /api/story-adopt { title, narration, images:[{data,mimeType}] }
// „Adoptuje" zkopírovanou (poslanou/přijatou) pohádku: appka ji nezná z
// knihovny postav, takže nemá heroDescription/worldNotes. Z hotových
// obrázků + textu vypravování si Gemini zpětně sestaví kanonický popis
// postav a světa — od té chvíle jde pohádka upravovat jako běžná
// (✨ Pokračování se zámkem vzhledu, 🖌 překreslení s kontrolou konzistence).

import { NextRequest, NextResponse } from "next/server";
import { describeStoryCast } from "@/lib/gemini";
import type { ReferenceImage } from "@/lib/characters";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) return NextResponse.json({ error: "Chybí GEMINI_API_KEY." }, { status: 500 });
    const body = await req.json().catch(() => ({}));
    const title = String(body.title || "").slice(0, 200);
    const narration = String(body.narration || "").slice(0, 4000);
    const rawImages = Array.isArray(body.images) ? body.images : [];
    const images: ReferenceImage[] = rawImages
      .filter((i: unknown): i is { data?: string; mimeType?: string } => !!i && typeof i === "object")
      .map((i: { data?: string; mimeType?: string }) => ({ data: String(i.data || ""), mimeType: String(i.mimeType || "image/jpeg") }))
      .filter((i: ReferenceImage) => i.data.length > 100)
      .slice(0, 4);
    if (!narration.trim() || images.length === 0) {
      return NextResponse.json({ error: "Chybí text nebo obrázky pohádky." }, { status: 400 });
    }
    const result = await describeStoryCast(apiKey, title, narration, images);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
