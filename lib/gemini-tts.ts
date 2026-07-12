// 🧪 Gemini TTS — testovací vypravěčské hlasy pro porovnání kvality
// s ElevenLabs (~4 Kč vs ~8 Kč na pohádku). Voice id v appce: "gemini:<hlas>",
// např. gemini:Charon (muž), gemini:Aoede (žena). Vrací WAV (Gemini dává PCM).

const TTS_MODEL = (process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts").trim();

function pcmToWav(pcm: Buffer, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** Namluví text hlasem Gemini; vrací WAV buffer. Jazyk pozná z textu,
 *  režie („čti vřele jako pohádku") se přidává podle jazyka. */
export async function narrateWithGemini(text: string, voiceName: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const czech = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/.test(text);
  const style = czech
    ? "Přečti následující text vřele a klidně, jako vypravěč dětské pohádky před spaním — s přirozenými pauzami, otázky tázavě, zvolání živě:"
    : "Read the following text warmly and calmly, like a bedtime-story narrator for children — natural pauses, questions inquisitive, exclamations lively:";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(TTS_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: `${style} ${text}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName } } },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    }
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Gemini TTS ${res.status}: ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
  const part = data.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
  if (!part?.inlineData?.data) throw new Error("Gemini TTS nevrátil audio.");
  const pcm = Buffer.from(part.inlineData.data, "base64");
  // rate z mimeType (audio/L16;codec=pcm;rate=24000)
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType || "")?.[1]) || 24000;
  return { buffer: pcmToWav(pcm, rate), mimeType: "audio/wav" };
}
