import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Effective model IDs (env overrides included) — shown in the story credits
export async function GET() {
  return NextResponse.json({
    story: (process.env.ANTHROPIC_MODEL_PRIMARY || "claude-sonnet-5").trim(),
    // Stejná logika jako lib/gemini.ts: primární je levný model, GEMINI_IMAGE_MODEL je záloha
    image: (process.env.GEMINI_IMAGE_MODEL_PRIMARY || "gemini-2.5-flash-image").trim(),
  });
}
