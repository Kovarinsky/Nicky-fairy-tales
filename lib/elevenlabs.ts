// Namluvení textu pomocí ElevenLabs (text-to-speech).
// Český hlas: model eleven_multilingual_v2. Vrací MP3 jako Buffer.

import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { Scene } from "./types";

const MODEL_ID = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

function getClient(): ElevenLabsClient {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Chybí ELEVENLABS_API_KEY. Získej ho na https://elevenlabs.io a dej do .env.local."
    );
  }
  return new ElevenLabsClient({ apiKey });
}

function getVoiceId(): string {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) {
    throw new Error(
      "Chybí ELEVENLABS_VOICE_ID. Vyber český hlas ve Voice Library a vlož jeho ID do .env.local."
    );
  }
  return voiceId;
}

/** Pomocná: přečte stream/iterable do jednoho Bufferu. */
async function streamToBuffer(stream: unknown): Promise<Buffer> {
  const chunks: Uint8Array[] = [];

  // AsyncIterable (Node stream) – zvládneme přes for-await
  if (stream != null && typeof (stream as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === "function") {
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
  } else if (stream != null && typeof (stream as ReadableStream<Uint8Array>).getReader === "function") {
    // Web ReadableStream
    const reader = (stream as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
  } else {
    throw new Error("ElevenLabs vrátil neočekávaný typ audia.");
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}

/** Nahradí unicode znaky > 255 jejich ASCII ekvivalenty (ElevenLabs SDK omezení). */
function sanitizeText(text: string): string {
  return text
    .replace(/…/g, "...")
    .replace(/–/g, "-")
    .replace(/—/g, "--")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    .replace(/«|»/g, '"')
    .replace(/­/g, "")
    .replace(/​/g, "");
}

/** Namluví text jedné scény, vrátí MP3 buffer. */
export async function narrateScene(scene: Scene): Promise<Buffer> {
  const client = getClient();
  const voiceId = getVoiceId();

  const audio = await client.textToSpeech.convert(voiceId, {
    text: sanitizeText(scene.narration),
    modelId: MODEL_ID,
    outputFormat: OUTPUT_FORMAT,
  });

  return streamToBuffer(audio);
}
