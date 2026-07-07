import { NextResponse } from "next/server";
import { request } from "https";

export const runtime = "nodejs";
export const maxDuration = 30;

function callRaw(apiKey: string, model: string): Promise<{ status: number; body: string }> {
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Draw a simple cartoon sun in a blue sky. Landscape orientation, storybook style." }] }],
    generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
  });
  const buf = Buffer.from(body, "utf-8");
  return new Promise((resolve, reject) => {
    const req = request({
      hostname: "generativelanguage.googleapis.com",
      path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": buf.length },
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(buf);
    req.end();
  });
}

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  // Stejná logika jako lib/gemini.ts: primární je levný model, GEMINI_IMAGE_MODEL je záloha
  const model = process.env.GEMINI_IMAGE_MODEL_PRIMARY?.trim() || "gemini-2.5-flash-image";

  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

  // Diagnostika: poslední 4 znaky klíče (bezpečné) — ověření, který klíč
  // produkce skutečně používá (…KM5Q = správný, …WdJw = starý vyčerpaný)
  const keyEnd = `…${apiKey.slice(-4)}`;

  let status = 0;
  let rawBody = "";
  try {
    const result = await callRaw(apiKey, model);
    status = result.status;
    rawBody = result.body;
  } catch (e) {
    return NextResponse.json({ error: `Network error: ${String(e)}` }, { status: 500 });
  }

  if (status >= 400) {
    return NextResponse.json({ status, model, keyEnd, error: rawBody.slice(0, 800) });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status, model, keyEnd, parseError: "JSON parse failed", bodyStart: rawBody.slice(0, 500) });
  }

  type Part = { inlineData?: { mimeType?: string; data?: string }; text?: string };
  type Candidate = { content?: { parts?: Part[] }; finishReason?: string; safetyRatings?: unknown[] };
  const candidates = (parsed.candidates ?? []) as Candidate[];

  const hasImage = candidates.some(c => c.content?.parts?.some(p => p.inlineData?.data));
  const textParts = candidates.flatMap(c => (c.content?.parts ?? []).filter(p => p.text).map(p => p.text));
  const finishReasons = candidates.map(c => c.finishReason);
  const safetyRatings = candidates.flatMap(c => c.safetyRatings ?? []);
  const promptFeedback = parsed.promptFeedback;

  return NextResponse.json({
    status,
    model,
    keyEnd,
    hasImage,
    finishReasons,
    safetyRatings,
    promptFeedback,
    textFromGemini: textParts,
    candidateCount: candidates.length,
  });
}
