// Speech-to-text: transcribes a recorded audio blob via Deepgram (Nova).
// Used by the SpeechInput voice control's onAudioRecorded callback.

import { createClient } from "@deepgram/sdk";

export const maxDuration = 30;

const STT_MODEL = process.env.DEEPGRAM_STT_MODEL || "nova-3";

export async function POST(req: Request) {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) return Response.json({ transcript: "", error: "no-key" }, { status: 501 });

  try {
    const buf = Buffer.from(await req.arrayBuffer());
    if (buf.byteLength === 0) return Response.json({ transcript: "" });

    const deepgram = createClient(key);
    const { result, error } = await deepgram.listen.prerecorded.transcribeFile(buf, {
      model: STT_MODEL,
      smart_format: true,
      punctuate: true,
    });
    if (error) {
      console.error("stt route deepgram error", error);
      return Response.json({ transcript: "", error: "stt-failed" }, { status: 502 });
    }
    const transcript =
      result?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
    return Response.json({ transcript });
  } catch (err) {
    console.error("stt route error", err);
    return Response.json({ transcript: "", error: "stt-failed" }, { status: 502 });
  }
}
