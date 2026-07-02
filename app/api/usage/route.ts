// GET /api/usage — přehled skutečné útraty za AI služby.
// Claude: přes Admin API (vyžaduje ANTHROPIC_ADMIN_KEY ve Vercelu) — součet
// nákladů za posledních N dní za CELOU organizaci (všechny aplikace účtu).
// ElevenLabs: stav kreditů předplatného (běžný ELEVENLABS_API_KEY stačí).
// Gemini: Google útratu přes API klíč nevydává — v UI jen odkaz na konzoli.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

function sanitizeKey(key: string | undefined): string {
  return (key || "").replace(/[^\x20-\x7E]/g, "").trim();
}

// Kurz USD→CZK z ČNB (denní kurzovní lístek); fallback 23 Kč při výpadku
async function usdToCzkRate(): Promise<number> {
  try {
    const res = await fetch(
      "https://www.cnb.cz/cs/financni-trhy/devizovy-trh/kurzy-devizoveho-trhu/kurzy-devizoveho-trhu/denni_kurz.txt",
      { signal: AbortSignal.timeout(8000), next: { revalidate: 43200 } }
    );
    if (!res.ok) return 23;
    const line = (await res.text()).split("\n").find(l => l.includes("|USD|"));
    const rate = line ? parseFloat(line.split("|")[4]?.replace(",", ".")) : NaN;
    return Number.isFinite(rate) && rate > 5 && rate < 60 ? rate : 23;
  } catch {
    return 23;
  }
}

async function claudeCost(days: number): Promise<{ usd: number; days: number } | { error: string }> {
  const adminKey = sanitizeKey(process.env.ANTHROPIC_ADMIN_KEY);
  if (!adminKey) return { error: "admin-key-missing" };
  const since = new Date(Date.now() - days * 86_400_000);
  since.setUTCHours(0, 0, 0, 0);
  let usd = 0;
  let page: string | null = null;
  try {
    for (let i = 0; i < 10; i++) {
      const url = new URL("https://api.anthropic.com/v1/organizations/cost_report");
      url.searchParams.set("starting_at", since.toISOString());
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.set("limit", "31");
      if (page) url.searchParams.set("page", page);
      const res = await fetch(url, {
        headers: { "x-api-key": adminKey, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        const txt = await res.text();
        return { error: `Anthropic ${res.status}: ${txt.slice(0, 160)}` };
      }
      const data = await res.json();
      for (const bucket of data.data || []) {
        for (const r of bucket.results || []) {
          // amount je v NEJNIŽŠÍCH jednotkách měny (centech!) jako decimal string
          const cents = typeof r.amount === "string" ? parseFloat(r.amount) : Number(r.amount);
          if (Number.isFinite(cents)) usd += cents / 100;
        }
      }
      if (!data.has_more || !data.next_page) break;
      page = data.next_page;
    }
    return { usd: Math.round(usd * 100) / 100, days };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "fetch failed" };
  }
}

async function elevenLabsCredits(): Promise<
  { used: number; limit: number; tier: string; resetAt: number | null } | { error: string }
> {
  const key = sanitizeKey(process.env.ELEVENLABS_API_KEY);
  if (!key) return { error: "key-missing" };
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/user/subscription", {
      headers: { "xi-api-key": key },
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) return { error: "missing-permission" };
    if (!res.ok) return { error: `ElevenLabs ${res.status}` };
    const d = await res.json();
    return {
      used: d.character_count ?? 0,
      limit: d.character_limit ?? 0,
      tier: d.tier ?? "?",
      resetAt: d.next_character_count_reset_unix ?? null,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "fetch failed" };
  }
}

export async function GET(req: NextRequest) {
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 30, 1), 365);
  const [claude, elevenlabs, czkRate] = await Promise.all([claudeCost(days), elevenLabsCredits(), usdToCzkRate()]);
  return NextResponse.json({ claude, elevenlabs, czkRate }, { headers: { "Cache-Control": "no-store" } });
}
