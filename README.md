# Pip 🦜

A living classroom parrot. Pip **talks** with students (OpenAI Realtime speech-to-speech for
live voice, plus the Vercel AI SDK with OpenAI for reflection), **sees and recognizes** them by
face (MediaPipe/Human) and optionally by voice (Picovoice Eagle), shows what it's saying in a
speech bubble, has **facial expressions** and moods, reacts to the cursor, and **remembers**
each student — playing favorites (kindly).

Built on **Next.js (App Router)**, **shadcn/ui**, and **AI Elements** (including the voice
components: Speech Input, Transcription, Audio Player, etc.).

## Quick start

```bash
cp .env.example .env.local   # fill in your keys
npm install
npm run dev                  # http://localhost:3000
```

Click **Wake up Pip** and allow camera + microphone.

## Keys

| Feature | Env var | Required? |
|---|---|---|
| Conversation + live voice (STT + LLM + TTS) | `OPENAI_API_KEY` | Yes (for real replies + speaking/listening) |
| Remembering students | `DATABASE_URL` (Postgres) | No — falls back to `.data/students.json` |
| Voice fingerprint | `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` + `eagle_params.pv` | No — face recognition works without it |

The single `OPENAI_API_KEY` powers everything: the browser mints a short-lived Realtime
ephemeral token from `/api/realtime-token` for the live voice loop, and the server routes
(`/api/reflection`, `/api/chat`, `/api/tts`, `/api/stt`) call OpenAI directly.

Optional model overrides: `NEXT_PUBLIC_OPENAI_REALTIME_MODEL` / `OPENAI_REALTIME_MODEL`
(default `gpt-realtime`), `NEXT_PUBLIC_OPENAI_REALTIME_VOICE` (default `coral`), `PIP_MODEL`
(reflection/chat, default `gpt-4o-mini`), `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE`,
`OPENAI_STT_MODEL`, and `OPENAI_REALTIME_TOKEN_TTL_SECONDS`.

Without the OpenAI key the app still runs with friendly fallbacks so you can see Pip move.

## How it works

- `lib/pipSprites.ts` — procedural scarlet-macaw sprite sheet (directions + expressions).
- `lib/pipEngine.ts` — animation engine; imperative API (`speak`, `setExpression`, `react`,
  `lookAt`, `setSpeaking`). `components/Pip.tsx` wraps it for React.
- `components/PipStage.tsx` — orchestration: webcam vision → look-at/greet, OpenAI Realtime live
  voice (speech-to-speech) → transcript → identity → expression, then `/api/reflection` for
  post-turn memory + affinity.
- `lib/vision.ts` (Human), `lib/voice.ts` (Eagle), `lib/identity.ts` (fuse face + voice).
- `lib/personality.ts` — Pip's persona + affinity/mood (with a kindness guardrail).
- `app/api/*` — `realtime-token` (Realtime ephemeral token), `reflection`/`chat` (OpenAI
  structured output), `tts`, `stt`, `students`.

## Deploy (Vercel)

Set the env vars in the Vercel project, add a Postgres integration from the Marketplace for
`DATABASE_URL`, and deploy. Camera/mic require HTTPS (Vercel provides it).
