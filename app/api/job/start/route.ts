// POST /api/job/start — spustí generování celé pohádky NA SERVERU.
// Telefon může okamžitě odejít; průběh a hotové scény se ukládají do
// Vercel Blob a klient si je stáhne přes /api/job/status.
// Zadání se uloží do jobs/<id>/request.json, takže /api/job/continue umí
// navázat, když funkce narazí na časový limit.
// Vyžaduje BLOB_READ_WRITE_TOKEN (Vercel → Storage → Blob) — bez něj vrací 501
// a klient spadne zpět na generování v prohlížeči.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { blobToken } from "@/lib/blob-token";
import { runJob, putJson, estimateStoryCostCredits } from "@/lib/job-runner";
import { SESSION_COOKIE, verifySessionToken, readAccount } from "@/lib/accounts";
import { monthToDateGeminiUsd } from "@/lib/usage";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  if (!blobToken()) {
    return NextResponse.json({ error: "blob-not-configured" }, { status: 501 });
  }
  try {
    const body = await req.json();
    // 🔐 Přihlášení je POVINNÉ (appka potřebuje sledovat aktivitu/kredity
    // účtu) — appka to hlídá i na klientovi (Home screen, createStory), ale
    // tenhle server endpoint je AUTORITATIVNÍ místo: bez platné session se
    // sem vůbec nedostane, ať klient obejde cokoliv jinde.
    // 🧪 Preview-only benchmark hook pro ONE_SHEET_STORY. Je neaktivní na
    // production targetu i bez feature flagu. Umožní automatický benchmark
    // bez kopírování uživatelského session cookie do skriptů, ale jen pokud
    // má konkrétní preview deployment neveřejný dostatečně dlouhý token.
    const prototypeToken = process.env.PROTOTYPE_BENCHMARK_TOKEN;
    const prototypeBenchmark = process.env.VERCEL_ENV !== "production" &&
      /^(1|true|on)$/i.test(process.env.ONE_SHEET_STORY || "") &&
      typeof prototypeToken === "string" && prototypeToken.length >= 24 &&
      req.headers.get("x-prototype-benchmark-token") === prototypeToken;
    const username = prototypeBenchmark
      ? (process.env.NEXT_PUBLIC_ADMIN_USERNAME || "jan")
      : verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value);
    if (!username) {
      return NextResponse.json({ error: "Pro vytvoření pohádky se prosím přihlaste." }, { status: 401 });
    }
    if (!prototypeBenchmark) {
      const acc = await readAccount(username);
      if (!acc) {
        return NextResponse.json({ error: "Účet nenalezen." }, { status: 402 });
      }
      // 🛠️ Vývojářský účet (isAdmin) kredity vůbec nekontroluje ani neplatí —
      // viz lib/accounts.ts chargeForCompletedStory, souměřené s tímhle místem.
      if (!acc.isAdmin) {
        const cost = estimateStoryCostCredits(body);
        if ((acc.credits ?? 0) < cost) {
          return NextResponse.json(
            { error: `Nedostatek kreditů (odhad ${cost}, máte ${acc.credits ?? 0}). Dobijte kredit v účtu.` },
            { status: 402 }
          );
        }
      }
    }
    // Benchmark nemá sahat na kredit žádného skutečného účtu; jobId a usage
    // se přesto normálně zapíší pro měření provider nákladů.
    if (!prototypeBenchmark) body.username = username;
    // 🛑 MĚSÍČNÍ SPEND-CAP POJISTKA (2026-08-09): appka narazila na Googlein
    // strop automatického navyšování zůstatku ("Dosáhli jste měsíčního
    // limitu…", GCP účet 01B33D-DEEC68-5E789A) — appka do teď neměla ŽÁDNOU
    // vlastní pojistku, jen kreditní systém PER ÚČET, který negarantuje nic
    // o CELKOVÉ útratě napříč všemi účty za měsíc. Volitelné (env nenastaven
    // = beze změny chování, appka jede jako dřív): MONTHLY_SPEND_CAP_USD ve
    // Vercelu nastaví strop v USD pro appčinu VLASTNÍ (Gemini-only, viz
    // lib/usage.ts) útratu od začátku kalendářního měsíce. Fail-open: když
    // se vlastní útrata nedá zjistit (výpadek Blobu), job se PUSTÍ dál —
    // appka nesmí kvůli chybě vlastního měření odmítat placené pohádky.
    {
      const capUsd = Number(process.env.MONTHLY_SPEND_CAP_USD);
      if (Number.isFinite(capUsd) && capUsd > 0) {
        const spentUsd = await monthToDateGeminiUsd();
        if (spentUsd !== null && spentUsd >= capUsd) {
          console.warn(`[job/start] MONTHLY_SPEND_CAP_USD dosažen: utraceno $${spentUsd.toFixed(2)} / strop $${capUsd.toFixed(2)}`);
          return NextResponse.json(
            {
              error: `Appka tento měsíc dosáhla nastaveného rozpočtového stropu za ilustrace ($${spentUsd.toFixed(2)} / $${capUsd.toFixed(2)}). ` +
                `Nové pohádky se dočasně negenerují, ať appka nenarazí na Googlein měsíční limit navyšování zůstatku. ` +
                `Strop lze zvednout přes MONTHLY_SPEND_CAP_USD ve Vercelu.`,
            },
            { status: 429 }
          );
        }
      }
    }
    const id = crypto.randomUUID();
    // Úvodní zápis stavu SYNCHRONNĚ — když Blob nefunguje (plné úložiště,
    // špatný token), vrátíme chybu hned místo „zombie" jobu, který nikdy
    // nezapíše stav a klient na něj marně čeká
    try {
      await putJson(`jobs/${id}/status.json`, { phase: "writing", createdAt: Date.now(), voiceId: String(body.voiceId || "") });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "blob write failed";
      console.error(`[job ${id}] initial status write failed:`, msg);
      return NextResponse.json({ error: `blob-write-failed: ${msg.slice(0, 160)}` }, { status: 500 });
    }
    // Zadání (pro /api/job/continue) + samotný job — už po odeslání odpovědi
    const work = putJson(`jobs/${id}/request.json`, body)
      .catch(e => console.error(`[job ${id}] request.json write failed:`, e))
      .then(() => runJob(id, body));
    // Preview benchmark musí držet HTTP invokaci otevřenou. Reálný test
    // ukázal, že fire-and-forget waitUntil ve Preview skončil už po ~17 s
    // uprostřed Claude streamu, i když maxDuration je 300 s. Produkce dál
    // používá okamžitou odpověď a waitUntil beze změny.
    if (prototypeBenchmark) {
      await work;
      return NextResponse.json({ jobId: id, benchmarkAwaited: true });
    }
    try { waitUntil(work); } catch { /* local dev — the promise runs in-process */ }
    return NextResponse.json({ jobId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Neznámá chyba";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
