// Jarvis's brain: takes a student's utterance + who they are + presence, and
// returns a structured reply (spoken text + expression + affinity nudge).
// Uses the AI SDK (v7) with Google Gemini underneath.

import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { enrichStudentFromMemory, persistReflectionMemory } from "@/lib/memory";
import { buildSystemPrompt } from "@/lib/personality";
import { getPersonality } from "@/lib/personalities";
import { chatResponseSchema } from "@/lib/jarvisSchema";
import type { ChatRequest, ChatResponse } from "@/lib/types";

export const maxDuration = 30;

const MODEL = process.env.JARVIS_MODEL || "gemini-2.5-flash";

const fallbackReply = (): ChatResponse => ({
  reply: "Hmm, my train of thought slipped away for a second — say that again?",
  emotion: "surprised",
  emote: "question",
  affinityDelta: 0,
  memoryNote: null,
  traitNote: null,
  askName: false,
  nextMood: "neutral",
  learnedName: null,
});

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return Response.json({
      ...fallbackReply(),
      reply: "My brain isn't plugged in yet — someone needs to set the Google API key.",
      emotion: "curious",
    } satisfies ChatResponse);
  }

  const enrichedStudent = body.student
    ? await enrichStudentFromMemory(body.student)
    : null;

  const chatContext: ChatRequest = {
    ...body,
    student: enrichedStudent,
  };

  const personaName = getPersonality(body.personality).name;
  const history = (body.history ?? [])
    .slice(-8)
    .map((t) => `${t.role === "user" ? "Person" : personaName}: ${t.text}`)
    .join("\n");

  try {
    const { output } = await generateText({
      model: google(MODEL),
      output: Output.object({ schema: chatResponseSchema }),
      system: buildSystemPrompt(chatContext),
      prompt: [
        history ? `Recent conversation:\n${history}\n` : "",
        `The person just said: "${body.text}"`,
        `Reply as ${personaName}.`,
      ].filter(Boolean).join("\n"),
    });

    const studentId = body.student?.id;
    if (studentId && (output.memoryNote || output.traitNote || output.affinityDelta)) {
      await persistReflectionMemory(studentId, {
        affinityDelta: output.affinityDelta,
        memoryNote: output.memoryNote,
        traitNote: output.traitNote,
      });
    }

    return Response.json(output satisfies ChatResponse);
  } catch (err) {
    console.error("chat route error", err);
    return Response.json(fallbackReply());
  }
}
