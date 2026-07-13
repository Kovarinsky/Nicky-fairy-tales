// 🪄 Hlas podle popisu — ElevenLabs Voice Design.
// POST {op:"previews", description} → 3 vygenerované ukázky (audio + id)
// POST {op:"save", generatedVoiceId, name, description} → uloží vybraný hlas
//      a přidá ho do voices/designed.json (objeví se ve výběru vypravěče)
// POST {op:"delete", id} → smaže hlas u ElevenLabs i ze seznamu

import { NextRequest, NextResponse } from "next/server";
import { putJson, readJson } from "@/lib/job-runner";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 60;

const DESIGNED_PATH = "voices/designed.json";
export interface DesignedVoice { id: string; name: string; description?: string }

function apiKey(): string {
  return (process.env.ELEVENLABS_API_KEY || "").replace(/[^\x20-\x7E]/g, "").trim();
}

// Ukázkový text ve stylu pohádky (Voice Design chce 100–1000 znaků) —
// jazyk ukázky se řídí jazykem prostředí appky (parametr language)
const SAMPLE_CS =
  "Byl jednou jeden večer, kdy měsíc svítil jako lampička. „Kdo to ťuká na okno?“ zašeptala Valentýnka. Nicolásek se usmál: „To je jen vítr, neboj se.“ A víš, co se stalo pak? Z lesa se ozvalo tichounké… haf haf! Všichni se k sobě přitulili a nechali se unášet do říše snů.";
const SAMPLE_EN =
  "Once upon an evening, the moon glowed like a night light. “Who is knocking on the window?” whispered Valentina. Nicolas smiled: “It is only the wind, don't be afraid.” And do you know what happened next? From the forest came a tiny… woof woof! They all snuggled up close and drifted away to the land of dreams.";

export async function POST(req: NextRequest) {
  if (!apiKey()) return NextResponse.json({ error: "ELEVENLABS_API_KEY chybí" }, { status: 501 });
  try {
    const body = await req.json();
    const op = String(body.op || "");

    if (op === "previews") {
      const description = String(body.description || "").trim().slice(0, 900);
      if (description.length < 20) {
        return NextResponse.json({ error: "Popište hlas aspoň pár slovy (min. 20 znaků)." }, { status: 400 });
      }
      const res = await fetch("https://api.elevenlabs.io/v1/text-to-voice/create-previews", {
        method: "POST",
        headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
        body: JSON.stringify({ voice_description: description, text: body.language === "en" ? SAMPLE_EN : SAMPLE_CS }),
        signal: AbortSignal.timeout(55_000),
      });
      const data = (await res.json().catch(() => ({}))) as {
        previews?: Array<{ audio_base_64?: string; generated_voice_id?: string; media_type?: string }>;
        detail?: { message?: string } | string;
      };
      if (!res.ok || !data.previews?.length) {
        const detail = typeof data.detail === "string" ? data.detail : data.detail?.message || `ElevenLabs ${res.status}`;
        return NextResponse.json({ error: detail.slice(0, 300) }, { status: 502 });
      }
      return NextResponse.json({
        previews: data.previews.slice(0, 3).map(p => ({
          id: p.generated_voice_id,
          audioUrl: `data:${p.media_type || "audio/mpeg"};base64,${p.audio_base_64}`,
        })),
      });
    }

    if (op === "save") {
      if (!blobToken()) return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
      const generatedVoiceId = String(body.generatedVoiceId || "");
      const name = String(body.name || "Vlastní vypravěč").slice(0, 60);
      const description = String(body.description || "").slice(0, 500);
      if (!generatedVoiceId) return NextResponse.json({ error: "chybí id ukázky" }, { status: 400 });
      const res = await fetch("https://api.elevenlabs.io/v1/text-to-voice/create-voice-from-preview", {
        method: "POST",
        headers: { "xi-api-key": apiKey(), "Content-Type": "application/json" },
        body: JSON.stringify({ voice_name: name, voice_description: description || name, generated_voice_id: generatedVoiceId }),
        signal: AbortSignal.timeout(40_000),
      });
      const data = (await res.json().catch(() => ({}))) as { voice_id?: string; detail?: { message?: string } | string };
      if (!res.ok || !data.voice_id) {
        const detail = typeof data.detail === "string" ? data.detail : data.detail?.message || `ElevenLabs ${res.status}`;
        return NextResponse.json({ error: detail.slice(0, 300) }, { status: 502 });
      }
      const list = (await readJson<DesignedVoice[]>(DESIGNED_PATH)) || [];
      list.push({ id: data.voice_id, name, description });
      await putJson(DESIGNED_PATH, list.slice(-8)); // max 8 vlastních hlasů
      return NextResponse.json({ id: data.voice_id, name });
    }

    if (op === "delete") {
      const id = String(body.id || "");
      if (!id) return NextResponse.json({ error: "chybí id" }, { status: 400 });
      await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "xi-api-key": apiKey() },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => {});
      const list = (await readJson<DesignedVoice[]>(DESIGNED_PATH)) || [];
      await putJson(DESIGNED_PATH, list.filter(v => v.id !== id));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "neznámá operace" }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
