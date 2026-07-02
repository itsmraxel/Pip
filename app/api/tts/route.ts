// Text-to-speech: turns Jarvis's reply into spoken audio via Deepgram Aura.
// Returns an MP3 stream the browser plays while the bubble text shows.

import { createClient } from "@deepgram/sdk";

export const maxDuration = 30;

// A global override wins if set; otherwise the caller (a personality) picks
// the voice, falling back to a sensible default.
const TTS_MODEL_OVERRIDE = process.env.DEEPGRAM_TTS_MODEL || null;
const DEFAULT_TTS_MODEL = "aura-2-aurora-en";
// Only allow Aura voice model ids through, so a request can't point us at
// something unexpected.
const isValidVoice = (v: unknown): v is string =>
  typeof v === "string" && /^aura(-2)?-[a-z]+-[a-z]{2}$/.test(v);

export async function POST(req: Request) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return new Response("Deepgram API key not configured", { status: 501 });

  const { text, voice } = (await req.json()) as { text?: string; voice?: string };
  if (!text?.trim()) return new Response("Missing text", { status: 400 });

  const model = TTS_MODEL_OVERRIDE ?? (isValidVoice(voice) ? voice : DEFAULT_TTS_MODEL);

  try {
    const deepgram = createClient(key);
    const res = await deepgram.speak.request({ text }, { model });
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
