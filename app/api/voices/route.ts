// GET /api/voices → vypravěčské hlasy: pevný seznam (reference/voices.json)
// + naklonovaný rodičovský hlas z Blobu (voices/clone.json), pokud existuje.

import { NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { readJson } from "@/lib/job-runner";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";

interface VoiceEntry { id: string; name: string; emoji: string; description: string; language: string; }

export async function GET() {
  let voices: VoiceEntry[] = [];
  try {
    voices = JSON.parse(readFileSync(join(process.cwd(), "reference", "voices.json"), "utf-8"));
  } catch {}
  if (blobToken()) {
    const clone = await readJson<{ id?: string; name?: string }>("voices/clone.json").catch(() => null);
    if (clone?.id) {
      voices = [
        { id: clone.id, name: clone.name || "Rodičovský hlas", emoji: "👨‍👧‍👦", description: "Naklonovaný hlas rodiče (mluví česky i anglicky)", language: "any" },
        ...voices,
      ];
    }
  }
  return NextResponse.json({ voices }, { headers: { "Cache-Control": "no-store" } });
}
