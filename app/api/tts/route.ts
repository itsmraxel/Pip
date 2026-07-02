// Text-to-speech: turns Pip's reply into spoken audio via Deepgram Aura.
// Returns an MP3 stream the browser plays while the bubble text shows.

import { createClient } from "@deepgram/sdk";

export const maxDuration = 30;

const TTS_MODEL = process.env.DEEPGRAM_TTS_MODEL || "aura-2-aurora-en";

export async function POST(req: Request) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return new Response("Deepgram API key not configured", { status: 501 });

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("Missing text", { status: 400 });

  try {
    const deepgram = createClient(key);
    const res = await deepgram.speak.request({ text }, { model: TTS_MODEL });
    const stream = await res.getStream();
    if (!stream) return new Response("No audio", { status: 502 });
    return new Response(stream, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("tts route error", err);
    return new Response("TTS failed", { status: 502 });
  }
}
