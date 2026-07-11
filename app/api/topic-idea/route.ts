// POST /api/topic-idea { language, characterNames[], themeId?, customTheme?, hint? }
// — Claude vymyslí jeden hravý námět na pohádku (1–2 věty). Když je vybraný
// svět pohádky, námět se odehrává v něm; hint je text, který už má uživatel
// napsaný v poli přání (námět na něm staví).

import { NextRequest, NextResponse } from "next/server";
import { suggestTopicIdea, expandTopicIdea } from "@/lib/claude";
import { themeById } from "@/lib/themes";

export const runtime = "nodejs";
export const maxDuration = 120; // rozvinutí s PDF potřebuje čas na přečtení dokumentu

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
    const ctx = {
      themeName: customTheme?.name ?? theme?.name,
      themePrompt: customTheme?.prompt ?? theme?.prompt,
      userHint: typeof body.hint === "string" && body.hint.trim() ? body.hint.trim() : undefined,
    };
    // ✨ expand: rozvinout kostru uživatele do detailní osnovy (vyžaduje hint).
    // Vychází i z vloženého PDF — malé přijde base64, velké odkazem do Blobu.
    let pdfBase64: string | undefined = typeof body.inspirationPdfBase64 === "string" ? body.inspirationPdfBase64 : undefined;
    if (!pdfBase64 && typeof body.inspirationPdfUrl === "string") {
      try {
        const u = new URL(body.inspirationPdfUrl);
        if (u.protocol === "https:" && u.hostname.endsWith(".blob.vercel-storage.com")) {
          const r = await fetch(u, { signal: AbortSignal.timeout(30_000) });
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length <= 11 * 1024 * 1024) pdfBase64 = buf.toString("base64");
          }
        }
      } catch {}
    }
    const idea = body.expand && ctx.userHint
      ? await expandTopicIdea(language, names, ctx, pdfBase64)
      : await suggestTopicIdea(language, names, ctx);
    return NextResponse.json({ idea });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
