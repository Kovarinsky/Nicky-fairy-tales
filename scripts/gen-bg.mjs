// Generates pixel-art background from reference photos via Gemini
// Usage: node scripts/gen-bg.mjs
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { request } from "https";

const apiKey = process.env.GEMINI_API_KEY?.trim();
if (!apiKey) { console.error("Set GEMINI_API_KEY"); process.exit(1); }

const model = process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3.1-flash-image";

function toBase64(path) {
  return readFileSync(path).toString("base64");
}

const nicolasB64  = toBase64("reference/nicolas.jpg");
const valentynaB64 = toBase64("reference/valentyna.jpg");

const prompt = [
  "These are reference photos of two real children: a cheerful 6-year-old boy named Nicolas with light blond hair (left photo), and an almost-2-year-old toddler girl named Valentýnka with blond hair (right photo).",
  "Create a single wide (landscape) pixel art illustration of BOTH children together.",
  "Style: vibrant retro pixel art / comic book style, 16-bit SNES era look, bold outlines, saturated happy colors.",
  "The scene: Nicolas and Valentýnka standing side by side, smiling, in a magical fairy-tale setting with stars and a glowing night sky background.",
  "Nicolas should be clearly taller. Valentýnka should look like a cute tiny toddler.",
  "Fill the ENTIRE image — make it a full-bleed illustration suitable as a desktop wallpaper.",
  "No text or letters anywhere in the image.",
  "Keep the characters recognizable based on the reference photos but stylized as pixel art.",
].join(" ");

const parts = [
  { inlineData: { data: nicolasB64,   mimeType: "image/jpeg" } },
  { inlineData: { data: valentynaB64, mimeType: "image/jpeg" } },
  { text: prompt },
];

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
