import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const ALLOWED = new Set(["nicolas.jpg", "valentyna.jpg"]);

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  if (!ALLOWED.has(name)) return new NextResponse(null, { status: 404 });
  const filePath = path.join(process.cwd(), "reference", name);
  if (!existsSync(filePath)) return new NextResponse(null, { status: 404 });
  const buf = readFileSync(filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}
