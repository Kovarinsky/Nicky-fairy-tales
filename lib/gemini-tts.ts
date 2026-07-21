// 🧪 Gemini TTS — testovací vypravěčské hlasy pro porovnání kvality
// s ElevenLabs (~4 Kč vs ~8 Kč na pohádku). Voice id v appce: "gemini:<hlas>",
// např. gemini:Charon (muž), gemini:Aoede (žena). Vrací WAV (Gemini dává PCM).

const TTS_MODEL = (process.env.GEMINI_TTS_MODEL || "gemini-2.5-flash-preview-tts").trim();

// 💰 Výchozí hlas "Automaticky" (žádný ručně vybraný voiceId) — na výslovné
// přání appka teď defaultně namlouvá Gemini hlasem (~4 Kč/pohádka), ne
// pevným ElevenLabs hlasem (~8 Kč/pohádka) přes ELEVENLABS_VOICE_ID.
const DEFAULT_GEMINI_VOICE_BY_LANG: Record<string, string> = {
  cs: "Sulafat:cs",
  en: "Sulafat:en",
  hr: "Sulafat:hr",
  da: "Sulafat:da",
  sk: "Sulafat:sk",
};
export function defaultAutoVoiceId(language?: string): string {
  const lang = (language || "cs").trim();
  return `gemini:${DEFAULT_GEMINI_VOICE_BY_LANG[lang] || DEFAULT_GEMINI_VOICE_BY_LANG.cs}`;
}

function pcmToWav(pcm: Buffer, rate = 24000): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// Režie přednesu podle jazyka — psaná v cílovém jazyce, ať Gemini drží
// správnou výslovnost a přízvuk (chorvatský hlas = chorvatská režie)
const STYLE_BY_LANG: Record<string, string> = {
  cs: "Přečti následující text vřele a klidně, jako vypravěč dětské pohádky před spaním — s přirozenými pauzami, otázky tázavě, zvolání živě:",
  en: "Read the following text warmly and calmly, like a bedtime-story narrator for children — natural pauses, questions inquisitive, exclamations lively:",
  hr: "Pročitaj sljedeći tekst toplo i smireno, kao pripovjedač dječje priče za laku noć — s prirodnim stankama, pitanja upitno, uzvike živahno. Govori standardnim hrvatskim izgovorom:",
  da: "Læs følgende tekst varmt og roligt, som en fortæller af en godnathistorie for børn — med naturlige pauser, spørgsmål spørgende, udbrud levende. Tal med standard dansk udtale:",
  sk: "Prečítaj nasledujúci text vrelo a pokojne, ako rozprávač detskej rozprávky pred spaním — s prirodzenými pauzami, otázky opytovacie, zvolania živo. Hovor spisovnou slovenčinou:",
};

// 🎬🌊 Stylové režie přednesu (přípona v id hlasu, např. „Algenib:movie")
const EXTRA_STYLES: Record<string, Record<string, string>> = {
  // hollywoodský trailer — hluboce, dramaticky, velkolepé pauzy
  movie: {
    cs: "Namluv následující text jako epický filmový vypravěč z hollywoodského traileru — hluboce, dramaticky, s velkolepými pauzami a narůstajícím napětím, přesto vřele a srozumitelně pro děti:",
    en: "Narrate the following text like an epic Hollywood movie-trailer narrator — deep, dramatic, suspenseful pacing with grand pauses, yet warm and child-friendly:",
  },
  // dobrodružný animák (Vaiana/Moana vibe) — mladistvě, energicky, s vtipem
  adventure: {
    cs: "Namluv následující text mladistvě, energicky a hravě, jako charismatický vypravěč dobrodružného animovaného filmu — se švihem, humorem a nakažlivým nadšením, jako kamarád, který právě zažil velké dobrodružství na moři; zvolání živě, napětí se špetkou legrace:",
    en: "Narrate the following text youthfully, energetically and playfully, like a charismatic narrator of an animated adventure movie — with swagger, humor and infectious enthusiasm, like a friend who just lived through a great ocean adventure; lively exclamations, suspense with a wink:",
  },
};

/** Namluví text hlasem Gemini; vrací WAV buffer. Jméno hlasu smí nést
 *  přípony („Sulafat:hr" → chorvatská režie, „Algenib:movie" → filmový
 *  přednes); bez jazykové přípony se jazyk pozná z textu. */
export async function narrateWithGemini(text: string, voiceName: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("Chybí GEMINI_API_KEY.");
  const segs = voiceName.split(":");
  const name = segs[0];
  const styleKey = segs.find(s => EXTRA_STYLES[s]);
  const langHint = segs.find(s => STYLE_BY_LANG[s]);
  const czech = /[ěščřžýáíéůúťďňĚŠČŘŽÝÁÍÉŮÚŤĎŇ]/.test(text);
  const lang = langHint || (czech ? "cs" : "en");
  const style = styleKey
    ? (EXTRA_STYLES[styleKey][lang] || EXTRA_STYLES[styleKey].en)
    : (STYLE_BY_LANG[lang] || STYLE_BY_LANG.en);
  voiceName = name;
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
