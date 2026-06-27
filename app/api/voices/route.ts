import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

interface VoiceEntry { id: string; name: string; emoji: string; description: string; language: string; }

export async function GET() {
  try {
    const raw = readFileSync(join(process.cwd(), "reference", "voices.json"), "utf-8");
    const voices: VoiceEntry[] = JSON.parse(raw);
    return NextResponse.json({ voices });
  } catch {
    return NextResponse.json({ voices: [] });
  }
}
