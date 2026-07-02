// Text-to-speech: turns Jarvis's reply into spoken audio via OpenAI TTS.
// Returns an MP3 stream the browser plays while the bubble text shows.

import OpenAI from "openai";

export const maxDuration = 30;

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const DEFAULT_TTS_VOICE = process.env.OPENAI_TTS_VOICE || "coral";

const OPENAI_VOICES = new Set([
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
]);

const isValidVoice = (v: unknown): v is string =>
  typeof v === "string" && OPENAI_VOICES.has(v);

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return new Response("OpenAI API key not configured", { status: 501 });

  const { text, voice } = (await req.json()) as { text?: string; voice?: string };
  if (!text?.trim()) return new Response("Missing text", { status: 400 });

  const ttsVoice = isValidVoice(voice) ? voice : DEFAULT_TTS_VOICE;

  try {
    const openai = new OpenAI({ apiKey: key });
    const speech = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: ttsVoice,
      input: text,
      response_format: "mp3",
    });
    if (!speech.body) return new Response("No audio", { status: 502 });
    return new Response(speech.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("tts route error", err);
    return new Response("TTS failed", { status: 502 });
  }
}
