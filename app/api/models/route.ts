import { NextResponse } from "next/server";

export const runtime = "nodejs";

// Effective model IDs (env overrides included) — shown in the story credits
export async function GET() {
  return NextResponse.json({
    story: (process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001").trim(),
    image: (process.env.GEMINI_IMAGE_MODEL || "gemini-2.0-flash-preview-image-generation").trim(),
  });
}
