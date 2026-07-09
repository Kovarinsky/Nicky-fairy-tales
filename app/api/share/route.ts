import { NextRequest, NextResponse } from "next/server";
import { put, head, list, del } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";

// 📤 Posílání pohádky: telefon nahraje obrázky+audio hotové pohádky
// (op:"asset" po scénách, ať se vejdeme do limitu velikosti requestu),
// pak zveřejní přehrávací JSON (op:"publish") → odkaz /s/<id>.
// Odkazy jsou neuhodnutelné (UUID); staré sdílené pohádky se promazávají.

export const runtime = "nodejs";
export const maxDuration = 60;

const ID_RE = /^[a-z0-9-]{10,60}$/i;
const MAX_SCENES = 25;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const SHARE_TTL_DAYS = 90;

function bad(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

// Sdílená média smí odkazovat jen na vlastní Blob úložiště
function isBlobUrl(u: string): boolean {
  try {
    const { protocol, hostname } = new URL(u);
    return protocol === "https:" && hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

async function pruneOldShares(): Promise<void> {
  try {
    const { blobs } = await list({ prefix: "share/", token: blobToken(), limit: 1000 });
    const cutoff = Date.now() - SHARE_TTL_DAYS * 24 * 3600 * 1000;
    const old = blobs.filter(b => new Date(b.uploadedAt).getTime() < cutoff).map(b => b.url);
    if (old.length) await del(old, { token: blobToken() });
  } catch {}
}

export async function POST(req: NextRequest) {
  if (!blobToken()) return bad("Sdílení není nastaveno (chybí Blob úložiště).", 501);
  let body: {
    op?: string; id?: string; kind?: string; index?: number; mimeType?: string; data?: string;
    title?: string; scenes?: Array<{ narration?: string; imageUrl?: string; audioUrl?: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return bad("Neplatný požadavek.");
  }
  const id = String(body.id || "");
  if (!ID_RE.test(id)) return bad("Neplatné id.");

  if (body.op === "asset") {
    const kind = body.kind === "aud" ? "aud" : "img";
    const index = Math.min(Math.max(Number(body.index) || 0, 0), MAX_SCENES - 1);
    const mimeType = String(body.mimeType || "");
    if (!/^(image|audio)\/[a-z0-9.+-]+$/i.test(mimeType)) return bad("Neplatný typ souboru.");
    let buf: Buffer;
    try {
      buf = Buffer.from(String(body.data || ""), "base64");
    } catch {
      return bad("Neplatná data.");
    }
    if (!buf.length || buf.length > MAX_ASSET_BYTES) return bad("Soubor je prázdný nebo příliš velký.");
    const { url } = await put(`share/${id}/${kind}-${index}`, buf, {
      access: "public",
      contentType: mimeType,
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken(),
    });
    return NextResponse.json({ url });
  }

  if (body.op === "publish") {
    const title = String(body.title || "Pohádka").slice(0, 200);
    const rawScenes = Array.isArray(body.scenes) ? body.scenes.slice(0, MAX_SCENES) : [];
    if (!rawScenes.length) return bad("Pohádka nemá žádné stránky.");
    const scenes = rawScenes.map(s => ({
      narration: String(s?.narration || "").slice(0, 2000),
      imageUrl: s?.imageUrl && isBlobUrl(String(s.imageUrl)) ? String(s.imageUrl) : "",
      audioUrl: s?.audioUrl && isBlobUrl(String(s.audioUrl)) ? String(s.audioUrl) : "",
    }));
    // 🔀 Dva konce — meta výběru pro přehrávací stránku
    const rawChoice = (body as { choice?: { common?: unknown; altFrom?: unknown; options?: unknown } }).choice;
    let choice: { common: number; altFrom: number; options: [string, string] } | undefined;
    if (rawChoice && Array.isArray(rawChoice.options) && rawChoice.options.length === 2) {
      const common = Math.floor(Number(rawChoice.common));
      const altFrom = Math.floor(Number(rawChoice.altFrom));
      if (Number.isFinite(common) && Number.isFinite(altFrom) && common > 0 && altFrom > common && altFrom < scenes.length) {
        choice = { common, altFrom, options: [String(rawChoice.options[0]).slice(0, 60), String(rawChoice.options[1]).slice(0, 60)] };
      }
    }
    const doc = { title, createdAt: new Date().toISOString(), scenes, ...(choice ? { choice } : {}) };
    await put(`share/${id}.json`, JSON.stringify(doc), {
      access: "public",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
      token: blobToken(),
    });
    pruneOldShares().catch(() => {});
    return NextResponse.json({ ok: true });
  }

  return bad("Neznámá operace.");
}

export async function GET(req: NextRequest) {
  if (!blobToken()) return bad("Sdílení není nastaveno.", 501);
  const id = String(req.nextUrl.searchParams.get("id") || "");
  if (!ID_RE.test(id)) return bad("Neplatné id.");
  try {
    const h = await head(`share/${id}.json`, { token: blobToken() });
    const res = await fetch(h.url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = await res.json();
    return NextResponse.json(doc, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    return bad("Pohádka nenalezena — odkaz je neplatný nebo už vypršel.", 404);
  }
}
