// GET /api/characters → seznam dostupných postav pro formulář.
// Vrací id + jména + URL náhledové fotky (roller ukazuje, kdo je kdo).

import { NextResponse } from "next/server";
import { loadCharacters } from "@/lib/characters";

export const runtime = "nodejs";

export async function GET() {
  const characters = loadCharacters().map((c) => ({
    id: c.id,
    name: c.name,
    nameEn: c.nameEn,
    photo: c.referenceFile ? `/api/reference/${c.referenceFile}` : undefined,
  }));
  return NextResponse.json({ characters });
}
