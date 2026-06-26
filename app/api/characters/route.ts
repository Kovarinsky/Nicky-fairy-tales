// GET /api/characters → seznam dostupných postav pro formulář.
// Vrací jen id + name (bez fotek a popisů), aby si je UI mohlo nabídnout.

import { NextResponse } from "next/server";
import { loadCharacters } from "@/lib/characters";

export const runtime = "nodejs";

export async function GET() {
  const characters = loadCharacters().map((c) => ({ id: c.id, name: c.name }));
  return NextResponse.json({ characters });
}
