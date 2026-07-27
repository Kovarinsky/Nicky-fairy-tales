// POST /api/background-custom { photo: { data, mimeType } } → { url }
// "+ VLASTNÍ" pozadí na Home screenu: appka pošle nahranou fotku, Gemini ji
// přemaluje do ilustračního stylu appky (viz generateCustomBackgroundFromPhoto)
// a appka výsledek uloží do Blob pod NÁHODNOU cestou (na rozdíl od
// backgrounds/<scene>-vN.png u vestavěných světů — tohle je osobní fotka,
// žádný sdílený cache klíč podle scény).

import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
import { generateCustomBackgroundFromPhoto } from "@/lib/gemini";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  if (!blobToken()) return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  let body: { photo?: { data?: string; mimeType?: string } };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  const data = body.photo?.data;
  const mimeType = body.photo?.mimeType;
  if (!data || !mimeType) return NextResponse.json({ error: "Chybí fotka." }, { status: 400 });

  try {
    const img = await generateCustomBackgroundFromPhoto(data, mimeType);
    const blob = await put(`custom-backgrounds/${crypto.randomUUID()}.png`, img.buffer, {
      access: "public",
      addRandomSuffix: false,
      contentType: img.mimeType,
      token: blobToken(),
    });
    return NextResponse.json({ url: blob.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
