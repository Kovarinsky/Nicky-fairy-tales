// GET /api/usage — přehled skutečné útraty za AI služby.
// Claude: přes Admin API (vyžaduje ANTHROPIC_ADMIN_KEY ve Vercelu) — součet
// nákladů za posledních N dní za CELOU organizaci (všechny aplikace účtu).
// ElevenLabs: stav kreditů předplatného (běžný ELEVENLABS_API_KEY stačí).
// Gemini: Google útratu přes API klíč nevydává — v UI jen odkaz na konzoli.

import { NextRequest, NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { blobToken } from "@/lib/blob-token";

export const runtime = "nodejs";
export const maxDuration = 30;

// Ceny za 1 vygenerovaný obrázek (USD): 1K sólo a 4K arch (nese až 9 scén)
const IMAGE_PRICES: Record<string, number> = {
  "gemini-3.1-flash-image": 0.067,
  "gemini-2.5-flash-image": 0.039,
};
const SHEET_PRICE_4K = 0.151;

// Vlastní počítadlo Gemini + hlasu: sečte záznamy
// usage/u<ts>-i<1K obrázky>-c<znaky>[-s<4K archy>][-t1][-d<zařízení>].json
// (data jsou v názvu souboru — stačí výpis, nic se nestahuje; -t1 značí
// záznam celé pohádky). Záznamy starší 90 dní se rovnou promažou.
async function ownUsage(days: number): Promise<{ images: number; sheets: number; chars: number; usd: number; days: number; stories: number; devices: number; prepAvgSec: number; prepMinSec: number; prepMaxSec: number; prepLastSec: number; prepCount: number } | { error: string }> {
  if (!blobToken()) return { error: "blob-not-configured" };
  const cutoff = Date.now() - days * 86_400_000;
  const pruneBefore = Date.now() - 90 * 86_400_000;
  const model = (process.env.GEMINI_IMAGE_MODEL_PRIMARY || process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image").trim();
  const price = IMAGE_PRICES[model] ?? 0.05;
  let images = 0, sheets = 0, chars = 0, stories = 0;
  // ⏱ trvání přípravy pohádek (-p<s> jen u záznamů celých pohádek);
  // "last" = nejnovější záznam podle časového razítka v názvu
  let prepSum = 0, prepCount = 0, prepMin = Infinity, prepMax = 0, prepLastTs = 0, prepLast = 0;
  const devices = new Set<string>();
  const stale: string[] = [];
  try {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix: "usage/", cursor, limit: 1000, token: blobToken() });
      for (const b of page.blobs) {
        const m = b.pathname.match(/^usage\/u(\d+)-i(\d+)-c(\d+)(?:-s(\d+))?(-t1)?(?:-p(\d+))?(?:-d([a-z0-9]{1,16}))?\.json$/i);
        if (!m) continue;
        const ts = Number(m[1]);
        if (ts < pruneBefore) { stale.push(b.url); continue; }
        if (ts >= cutoff) {
          images += Number(m[2]);
          chars += Number(m[3]);
          sheets += m[4] ? Number(m[4]) : 0;
          // Pohádka = záznam s -t1; starší formát (před značkou): záznam
          // s obrázky i hlasem najednou byl vždy celý job
          if (m[5] || (Number(m[2]) > 0 && Number(m[3]) > 0)) stories += 1;
          if (m[6]) {
            const sec = Number(m[6]);
            prepSum += sec; prepCount += 1;
            prepMin = Math.min(prepMin, sec); prepMax = Math.max(prepMax, sec);
            if (ts > prepLastTs) { prepLastTs = ts; prepLast = sec; }
          }
          if (m[7]) devices.add(m[7].toLowerCase());
        }
      }
      cursor = page.cursor;
    } while (cursor);
    if (stale.length) del(stale, { token: blobToken() }).catch(() => {});
    return {
      images, sheets, chars,
      usd: Math.round((images * price + sheets * SHEET_PRICE_4K) * 100) / 100,
      days, stories, devices: devices.size,
      prepAvgSec: prepCount > 0 ? Math.round(prepSum / prepCount) : 0,
      prepMinSec: prepCount > 0 ? prepMin : 0,
      prepMaxSec: prepMax,
      prepLastSec: prepLast,
      prepCount,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "fetch failed" };
  }
}

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
  const [claude, elevenlabs, czkRate, own] = await Promise.all([
    claudeCost(days), elevenLabsCredits(), usdToCzkRate(), ownUsage(days),
  ]);
  return NextResponse.json({ claude, elevenlabs, czkRate, own }, { headers: { "Cache-Control": "no-store" } });
}
