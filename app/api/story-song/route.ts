import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/accounts";
import { generateCustomSound, generateStoryOutro, generateStorySong } from "@/lib/elevenlabs-creative";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const prototypeToken = process.env.PROTOTYPE_BENCHMARK_TOKEN;
    const previewE2e = process.env.VERCEL_ENV !== "production" &&
      typeof prototypeToken === "string" && prototypeToken.length >= 24 &&
      req.headers.get("x-prototype-benchmark-token") === prototypeToken;
    const username = previewE2e ? "benchmark" : verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (!username) return NextResponse.json({ error: "Pro vytvoření písničky se přihlaste." }, { status: 401 });
    const body = await req.json();
    if (previewE2e && body.kind === "sfx") {
      const audioUrl = await generateCustomSound(String(body.prompt || "").slice(0, 450), Number(body.durationSec) || 1.5);
      return NextResponse.json({ audioUrl, kind: "sfx" });
    }
    if (body.kind === "outro") {
      const audioUrl = await generateStoryOutro({
        mood: String(body.mood || "gentle magic"),
        theme: String(body.theme || "storybook"),
        durationSec: 14,
      });
      return NextResponse.json({ audioUrl, kind: "outro" });
    }
    const title = String(body.title || "Pohádka").trim().slice(0, 160);
    const scenes = Array.isArray(body.scenes) ? body.scenes.slice(0, 20) : [];
    const synopsis = scenes.map((s: { narration?: unknown }) => String(s?.narration || "").slice(0, 280)).join(" ").slice(0, 1400);
    if (!synopsis) return NextResponse.json({ error: "Pohádka nemá text pro písničku." }, { status: 400 });
    const audioUrl = await generateStorySong({ title, synopsis, language: body.language === "en" ? "en" : "cs", durationSec: 18 });
    return NextResponse.json({ audioUrl });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Písničku se nepodařilo vytvořit." }, { status: 500 });
  }
}
