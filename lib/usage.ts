// 📊 Appčino VLASTNÍ sledování útraty za Gemini obrázky (Google žádné API na
// skutečnou útratu nevydává, viz komentář u ownUsage níž) — sdíleno mezi
// GET /api/usage (přehled pro admina) a job-runner/job/start (spend-cap
// pojistka, viz monthToDateGeminiUsd). Dřív žilo jen v app/api/usage/route.ts,
// vytaženo sem, aby to job/start mohl importovat bez závislosti na route.ts.

import { list, del } from "@vercel/blob";
import { blobToken } from "./blob-token";

// Ceny za 1 vygenerovaný obrázek (USD): 1K sólo a 4K arch (nese až 9 scén)
const IMAGE_PRICES: Record<string, number> = {
  "gemini-3.1-flash-image": 0.067,
  "gemini-2.5-flash-image": 0.039,
};
const SHEET_PRICE_4K = 0.151;

export type OwnUsage = {
  images: number; sheets: number; chars: number; usd: number; days: number;
  stories: number; devices: number; prepAvgSec: number; prepMinSec: number;
  prepMaxSec: number; prepLastSec: number; prepCount: number;
};

// Vlastní počítadlo Gemini + hlasu: sečte záznamy
// usage/u<ts>-i<1K obrázky>-c<znaky>[-s<4K archy>][-t1][-d<zařízení>].json
// (data jsou v názvu souboru — stačí výpis, nic se nestahuje; -t1 značí
// záznam celé pohádky). Záznamy starší 90 dní se rovnou promažou.
// ⚠️ `usd` počítá JEN Gemini (obrázky/archy) — hlas (ElevenLabs, jiný
// dodavatel/jiný účet) se vrací zvlášť v `chars`, ne přičtený do `usd`.
// To je záměr: monthToDateGeminiUsd níž potřebuje číslo srovnatelné
// PŘÍMO s Googleovým měsíčním stropem, ne směs dvou různých účtů.
export async function ownUsage(days: number): Promise<OwnUsage | { error: string }> {
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

// 🛑 SPEND-CAP POJISTKA (2026-08-09): appka narazila na Googlein měsíční
// strop automatického navyšování zůstatku ("Dosáhli jste měsíčního limitu"
// — GCP účet 01B33D-DEEC68-5E789A) — appka sama do té doby neměla ŽÁDNÝ
// mechanismus, který by ji zastavil PŘED tím, než na strop narazí Google.
// Tahle funkce vrátí, kolik appka OPRAVDU utratila za Gemini obrázky od
// začátku aktuálního kalendářního měsíce (UTC) — volající (job/start) ji
// porovná s volitelným env MONTHLY_SPEND_CAP_USD a nový job odmítne, když
// je strop dosažený, MÍSTO aby appka nechala Google useknout celý účet
// uprostřed měsíce bez varování.
// null = nejde zjistit (Blob nenakonfigurován / chyba čtení) — volající
// MUSÍ v tom případě job pustit dál (fail-open, ne fail-closed): appka
// nesmí kvůli výpadku vlastního měření odmítat placené pohádky, které by
// jinak prošly.
export async function monthToDateGeminiUsd(): Promise<number | null> {
  const now = new Date();
  const startOfMonthUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  const daysSinceMonthStart = Math.max(1, Math.ceil((now.getTime() - startOfMonthUtc) / 86_400_000));
  const u = await ownUsage(daysSinceMonthStart);
  return "error" in u ? null : u.usd;
}
