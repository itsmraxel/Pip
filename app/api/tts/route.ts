// Text-to-speech: turns Pip's reply into spoken audio via OpenAI TTS.
// Returns an MP3 stream the browser plays while the bubble text shows.

import OpenAI from "openai";

export const maxDuration = 30;

const TTS_MODEL = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const TTS_VOICE = process.env.OPENAI_TTS_VOICE || "coral";

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return new Response("OpenAI API key not configured", { status: 501 });

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim()) return new Response("Missing text", { status: 400 });

  try {
    const openai = new OpenAI({ apiKey: key });
    const speech = await openai.audio.speech.create({
      model: TTS_MODEL,
      voice: TTS_VOICE,
      input: text,
      response_format: "mp3",
    });
    return new Response(speech.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("tts route error", err);
    return new Response("TTS failed", { status: 502 });
  }
}
