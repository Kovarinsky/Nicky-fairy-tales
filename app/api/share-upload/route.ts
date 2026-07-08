import { NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { blobToken } from "@/lib/blob-token";

// 📤 Přímé nahrání médií sdílené pohádky z prohlížeče do Blob úložiště.
// Serverová cesta (JSON s base64) narážela na limit velikosti requestu
// 4,5 MB — velké obrázky scén se nenahrály. Tady server jen vydá podepsaný
// token omezený na cestu share/<id>/img|aud-N a prohlížeč nahrává rovnou
// do úložiště (binárně, bez limitu funkce).

export const runtime = "nodejs";
export const maxDuration = 30;

const PATH_RE = /^share\/[a-z0-9-]{10,60}\/(img|aud)-\d{1,2}$/i;

export async function POST(request: Request): Promise<NextResponse> {
  if (!blobToken()) {
    return NextResponse.json({ error: "Sdílení není nastaveno (chybí Blob úložiště)." }, { status: 501 });
  }
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Neplatný požadavek." }, { status: 400 });
  }
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      token: blobToken(),
      onBeforeGenerateToken: async (pathname) => {
        if (!PATH_RE.test(pathname)) throw new Error("Neplatná cesta souboru.");
        return {
          allowedContentTypes: ["image/*", "audio/*"],
          addRandomSuffix: false,
          allowOverwrite: true,
          maximumSizeInBytes: 15 * 1024 * 1024,
        };
      },
      // Média mažeme s celou sdílenou pohádkou (prune v /api/share)
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Nahrání se nepovedlo.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
