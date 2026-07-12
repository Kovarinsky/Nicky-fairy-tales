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
    // Klony: nový formát (pole) s migrací ze starého jednoklonového záznamu
    let clones = (await readJson<Array<{ id: string; name: string }>>("voices/clones.json").catch(() => null)) || null;
    if (!Array.isArray(clones)) {
      const legacy = await readJson<{ id?: string; name?: string }>("voices/clone.json").catch(() => null);
      clones = legacy?.id ? [{ id: legacy.id, name: legacy.name || "Rodičovský hlas" }] : [];
    }
    const designed = (await readJson<Array<{ id: string; name: string }>>("voices/designed.json").catch(() => null)) || [];
    const extra: Array<VoiceEntry & { kind?: string }> = [];
    for (const c of clones) {
      extra.push({ id: c.id, name: c.name, emoji: "👨‍👧‍👦", description: "Naklonovaný rodinný hlas (mluví česky i anglicky)", language: "any", kind: "clone" });
    }
    for (const d of designed) {
      extra.push({ id: d.id, name: d.name, emoji: "🪄", description: "Hlas vymyšlený podle popisu", language: "any", kind: "designed" });
    }
    voices = [...extra, ...voices];
  }
  return NextResponse.json({ voices }, { headers: { "Cache-Control": "no-store" } });
}
