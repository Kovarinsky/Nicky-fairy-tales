import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Effective model IDs (env overrides included) — shown in the story credits
export async function GET() {
  return NextResponse.json({
    story: (process.env.ANTHROPIC_MODEL_PRIMARY || "claude-sonnet-5").trim(),
    // Stejná logika jako lib/gemini.ts (v2.81: primární je zpět 3.1)
    image: (process.env.GEMINI_IMAGE_MODEL_PRIMARY || process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image").trim(),
  });
}
