// GET /api/themes → seznam témat pro formulář (id, name, emoji).

import { NextResponse } from "next/server";
import { THEMES } from "@/lib/themes";

export const runtime = "nodejs";

export async function GET() {
  const themes = THEMES.map((t) => ({ id: t.id, name: t.name, nameEn: t.nameEn, emoji: t.emoji }));
  return NextResponse.json({ themes });
}
