// 🎙️ Rodičovský hlas — klon přes ElevenLabs Instant Voice Cloning.
// POST  multipart {audio, name?} → (smaže starý klon) → /v1/voices/add → uloží
//       voices/clone.json do Blobu a vrátí {id}
// GET   → {id?, name?, createdAt?} — existující klon
// DELETE → smaže klon u ElevenLabs (vzorky vč. nahrávky drží jen ElevenLabs,
//       appka nahrávku nikam neukládá) i záznam v Blobu
// Vyžaduje ElevenLabs tarif Starter a vyšší.

import { NextRequest, NextResponse } from "next/server";
import { putJson, readJson } from "@/lib/job-runner";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 60;

const CLONE_PATH = "voices/clone.json";

interface CloneRecord { id?: string; name?: string; createdAt?: number }

function apiKey(): string {
  return (process.env.ELEVENLABS_API_KEY || "").replace(/[^\x20-\x7E]/g, "").trim();
}

async function deleteAtElevenLabs(id: string): Promise<void> {
  await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey() },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {});
}

export async function GET() {
  if (!blobToken()) return NextResponse.json({});
  const rec = await readJson<CloneRecord>(CLONE_PATH);
  return NextResponse.json(rec?.id ? rec : {}, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (!apiKey()) return NextResponse.json({ error: "ELEVENLABS_API_KEY chybí" }, { status: 501 });
  if (!blobToken()) return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof File) || audio.size < 20_000) {
      return NextResponse.json({ error: "Nahrávka je příliš krátká — nahrajte alespoň ~30 s čtení." }, { status: 400 });
    }
    if (audio.size > 9 * 1024 * 1024) {
      return NextResponse.json({ error: "Nahrávka je příliš velká." }, { status: 400 });
    }
    const name = String(form.get("name") || "Rodičovský hlas").slice(0, 60);

    // Starý klon nahradit novým (vylepšení = nová nahrávka)
    const prev = await readJson<CloneRecord>(CLONE_PATH);
    if (prev?.id) await deleteAtElevenLabs(prev.id);

    const out = new FormData();
    out.append("name", name);
    out.append("files", audio, audio.name || "voice-sample.webm");
    out.append("remove_background_noise", "true");
    const res = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: { "xi-api-key": apiKey() },
      body: out,
      signal: AbortSignal.timeout(50_000),
    });
    const data = (await res.json().catch(() => ({}))) as { voice_id?: string; detail?: { message?: string } | string };
    if (!res.ok || !data.voice_id) {
      const detail = typeof data.detail === "string" ? data.detail : data.detail?.message || `ElevenLabs ${res.status}`;
      // typicky: tarif Free klonování nepodporuje
      return NextResponse.json({ error: detail.slice(0, 300) }, { status: 502 });
    }
    const rec: CloneRecord = { id: data.voice_id, name, createdAt: Date.now() };
    await putJson(CLONE_PATH, rec);
    return NextResponse.json(rec);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE() {
  if (!blobToken()) return NextResponse.json({ ok: true });
  const rec = await readJson<CloneRecord>(CLONE_PATH);
  if (rec?.id) await deleteAtElevenLabs(rec.id);
  await putJson(CLONE_PATH, {});
  return NextResponse.json({ ok: true });
}
