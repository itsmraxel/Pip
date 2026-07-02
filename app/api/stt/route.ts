// Speech-to-text: transcribes a recorded audio blob via OpenAI transcription.
// Used by the SpeechInput voice control's onAudioRecorded callback.

import OpenAI, { toFile } from "openai";

export const maxDuration = 30;

const STT_MODEL = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";

export async function POST(req: Request) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ transcript: "", error: "no-key" }, { status: 501 });

  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength === 0) return Response.json({ transcript: "" });

    const openai = new OpenAI({ apiKey: key });
    const file = await toFile(buf, "audio.webm", { type: "audio/webm" });
    const result = await openai.audio.transcriptions.create({
      model: STT_MODEL,
      file,
    });
    return Response.json({ transcript: result.text ?? "" });
  } catch (err) {
    console.error("stt route error", err);
    return Response.json({ transcript: "", error: "stt-failed" }, { status: 502 });
  }
}
