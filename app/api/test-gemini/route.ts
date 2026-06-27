import { NextResponse } from "next/server";
import { request } from "https";

export const runtime = "nodejs";
export const maxDuration = 30;

function callRaw(apiKey: string, model: string): Promise<{ status: number; body: string }> {
  const body = JSON.stringify({
    contents: [{ role: "user", parts: [{ text: "Draw a simple cartoon sun. Landscape orientation." }] }],
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
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8").slice(0, 2000) }));
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

  try {
    const { status, body } = await callRaw(apiKey, model);
    const parsed = JSON.parse(body);
    const candidates = parsed.candidates ?? [];
    const hasImage = candidates.some((c: { content?: { parts?: Array<{ inlineData?: unknown }> } }) =>
      c.content?.parts?.some((p) => p.inlineData)
    );
    const textParts = candidates.flatMap((c: { content?: { parts?: Array<{ text?: string }> } }) =>
      (c.content?.parts ?? []).filter((p) => p.text).map((p) => p.text)
    );
    return NextResponse.json({ status, model, hasImage, textParts, rawSlice: body.slice(0, 500) });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
