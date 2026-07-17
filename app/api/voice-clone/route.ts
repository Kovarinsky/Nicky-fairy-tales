// 🎙️ Klonované hlasy (ElevenLabs Instant Voice Cloning) — až 4 pojmenované
// hlasy rodiny (Tatínek, Nicolásek…). Vylepšení = smazat a nahrát znovu
// (delší a čistší nahrávka). Nahrávky drží jen ElevenLabs, appka je neukládá.
// GET → {clones:[{id,name,createdAt}]}
// POST multipart {audio, name} → přidá hlas (strop 4)
// DELETE {id} → smaže hlas u ElevenLabs i ze seznamu

import { NextRequest, NextResponse } from "next/server";
import { putJson, readJson } from "@/lib/job-runner";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 60;

const CLONES_PATH = "voices/clones.json";
interface CloneRecord { id: string; name: string; createdAt: number; consentAt?: number }

function apiKey(): string {
  return (process.env.ELEVENLABS_API_KEY || "").replace(/[^\x20-\x7E]/g, "").trim();
}

async function loadClones(): Promise<CloneRecord[]> {
  const list = await readJson<CloneRecord[]>(CLONES_PATH);
  if (Array.isArray(list)) return list;
  // migrace ze starého jednoklonového formátu
  const legacy = await readJson<{ id?: string; name?: string; createdAt?: number }>("voices/clone.json");
  return legacy?.id ? [{ id: legacy.id, name: legacy.name || "Rodičovský hlas", createdAt: legacy.createdAt || Date.now() }] : [];
}

async function deleteAtElevenLabs(id: string): Promise<void> {
  await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "xi-api-key": apiKey() },
    signal: AbortSignal.timeout(20_000),
  }).catch(() => {});
}

export async function GET() {
  if (!blobToken()) return NextResponse.json({ clones: [] });
  return NextResponse.json({ clones: await loadClones() }, { headers: { "Cache-Control": "no-store" } });
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
    // 🔒 Hlasová nahrávka je biometrický údaj (i u dítěte) — appka klonování
    // nesmí provést bez odsouhlaseného souhlasu. Klient posílá časové
    // razítko z appConfirm() dialogu; nevěříme jen tomu, že přišlo (mohl by
    // je poslat i přímý dotaz na API bez proběhlého dialogu), ale bez NĚJAKÉ
    // hodnoty požadavek rovnou odmítneme — obrana do hloubky vedle UI brány.
    const consentAt = Number(form.get("consentAt"));
    if (!Number.isFinite(consentAt) || consentAt <= 0) {
      return NextResponse.json({ error: "Chybí potvrzený souhlas se zpracováním hlasové nahrávky — zkuste to prosím znovu z appky." }, { status: 400 });
    }
    const name = String(form.get("name") || "Rodinný hlas").trim().slice(0, 40) || "Rodinný hlas";
    const clones = await loadClones();
    if (clones.length >= 4) {
      return NextResponse.json({ error: "Máte už 4 klonované hlasy — nejdřív nějaký smažte (×)." }, { status: 400 });
    }

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
      return NextResponse.json({ error: detail.slice(0, 300) }, { status: 502 });
    }
    const rec: CloneRecord = { id: data.voice_id, name, createdAt: Date.now(), consentAt };
    await putJson(CLONES_PATH, [...clones, rec]);
    await putJson("voices/clone.json", {}); // starý formát vyprázdnit
    return NextResponse.json(rec);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!blobToken()) return NextResponse.json({ ok: true });
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || "");
  const clones = await loadClones();
  if (id) {
    await deleteAtElevenLabs(id);
    await putJson(CLONES_PATH, clones.filter(c => c.id !== id));
  }
  await putJson("voices/clone.json", {});
  return NextResponse.json({ ok: true });
}
