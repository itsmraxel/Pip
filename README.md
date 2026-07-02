# Pip 🦜

A living classroom parrot. Pip **talks** with students (Google Gemini via the Vercel AI SDK,
Deepgram Aura voice), **sees and recognizes** them by face (MediaPipe/Human) and optionally by
voice (Picovoice Eagle), shows what it's saying in a speech bubble, has **facial expressions**
and moods, reacts to the cursor, and **remembers** each student — playing favorites (kindly).

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
| Conversation | `GOOGLE_GENERATIVE_AI_API_KEY` | Yes (for real replies) |
| Voice (STT + TTS) | `DEEPGRAM_API_KEY` | Yes (for speaking/listening) |
| Remembering students | `DATABASE_URL` (Postgres) | No — falls back to `.data/students.json` |
| Voice fingerprint | `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` + `eagle_params.pv` | No — face recognition works without it |

Without the AI/voice keys the app still runs with friendly fallbacks so you can see Pip move.

## How it works

- `lib/pipSprites.ts` — procedural scarlet-macaw sprite sheet (directions + expressions).
- `lib/pipEngine.ts` — animation engine; imperative API (`speak`, `setExpression`, `react`,
  `lookAt`, `setSpeaking`). `components/Pip.tsx` wraps it for React.
- `components/PipStage.tsx` — orchestration: webcam vision → look-at/greet, mic → transcript →
  identity → `/api/chat` → expression + `/api/tts` speech, persistence + affinity.
- `lib/vision.ts` (Human), `lib/voice.ts` (Eagle), `lib/identity.ts` (fuse face + voice).
- `lib/personality.ts` — Pip's persona + affinity/mood (with a kindness guardrail).
- `app/api/*` — `chat` (Gemini structured output), `tts`, `stt`, `students`.

## Deploy (Vercel)

Set the env vars in the Vercel project, add a Postgres integration from the Marketplace for
`DATABASE_URL`, and deploy. Camera/mic require HTTPS (Vercel provides it).
