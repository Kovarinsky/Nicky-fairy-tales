// GET /api/reference/<soubor> — náhledové fotky postav z reference/
// (jen bezpečné názvy souborů, existující v adresáři reference)

import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const NAME_RE = /^[a-z0-9-]+\.(jpg|jpeg|png)$/i;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!NAME_RE.test(name)) return new NextResponse(null, { status: 404 });
  const filePath = path.join(process.cwd(), "reference", name);
  if (!existsSync(filePath)) return new NextResponse(null, { status: 404 });
  const buf = readFileSync(filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": name.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
