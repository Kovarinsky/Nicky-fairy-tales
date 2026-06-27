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
  const model = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-2.0-flash-preview-image-generation";

  if (!apiKey) return NextResponse.json({ error: "GEMINI_API_KEY not set" }, { status: 500 });

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
    return NextResponse.json({ status, model, error: rawBody.slice(0, 800) });
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ status, model, parseError: "JSON parse failed", bodyStart: rawBody.slice(0, 500) });
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
    hasImage,
    finishReasons,
    safetyRatings,
    promptFeedback,
    textFromGemini: textParts,
    candidateCount: candidates.length,
  });
}
