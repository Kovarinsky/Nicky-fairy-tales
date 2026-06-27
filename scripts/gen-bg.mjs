// Generates bg-characters.png — Nicky LEFT, Vaja RIGHT, center empty
// Usage: GEMINI_API_KEY=xxx node scripts/gen-bg.mjs
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { request } from "https";

// Read key from env or .env.local fallback
let apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) {
  try {
    const env = readFileSync(".env.local", "utf-8");
    const m = env.match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
    if (m) apiKey = m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
}
if (!apiKey) { console.error("GEMINI_API_KEY not found in env or .env.local"); process.exit(1); }

const model = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";

const prompt = [
  "Wide fairy tale landscape background illustration, 16:9 aspect ratio.",
  "On the FAR LEFT edge: a tall boy with light blond hair and a bright smile, wearing a blue adventure jacket, standing proud, looking toward the center.",
  "On the FAR RIGHT edge: a very small toddler girl with blond hair and a pink bow, wearing a pink dress, standing cute, looking toward the center.",
  "The CENTER of the image is COMPLETELY EMPTY — just the magical background scenery (no characters in the middle).",
  "Setting: enchanted glowing forest at dusk, fireflies, soft purple and golden sky, giant glowing mushrooms, ancient trees.",
  "Painterly children's book illustration, warm cinematic lighting, rich saturated colors, dreamlike atmosphere. No text.",
].join(" ");

const parts = [{ text: prompt }];

const body = JSON.stringify({
  contents: [{ role: "user", parts }],
  generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
});
const bodyBuf = Buffer.from(body, "utf-8");

console.log(`Sending to Gemini (${model})...`);

const req = request({
  hostname: "generativelanguage.googleapis.com",
  path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Content-Length": bodyBuf.length,
  },
}, (res) => {
  const chunks = [];
  res.on("data", c => chunks.push(c));
  res.on("end", () => {
    const text = Buffer.concat(chunks).toString("utf-8");
    if (res.statusCode >= 400) {
      console.error("Gemini error", res.statusCode, text.slice(0, 400));
      process.exit(1);
    }
    let data;
    try { data = JSON.parse(text); } catch {
      console.error("JSON parse error:", text.slice(0, 200)); process.exit(1);
    }
    for (const cand of data.candidates || []) {
      for (const part of cand.content?.parts || []) {
        if (part.inlineData?.data) {
          mkdirSync("public", { recursive: true });
          const ext = part.inlineData.mimeType?.includes("png") ? "png" : "jpg";
          const outPath = `public/bg-characters.${ext}`;
          writeFileSync(outPath, Buffer.from(part.inlineData.data, "base64"));
          console.log(`✅ Saved: ${outPath}`);
          // Rename to .png if it came out as jpg so CSS picks it up
          if (ext === "jpg") {
            renameSync(outPath, "public/bg-characters.png");
            console.log("   → renamed to bg-characters.png");
          }
          return;
        }
      }
    }
    console.error("No image in response:", JSON.stringify(data).slice(0, 400));
    process.exit(1);
  });
});

req.on("error", e => { console.error(e); process.exit(1); });
req.write(bodyBuf);
req.end();
