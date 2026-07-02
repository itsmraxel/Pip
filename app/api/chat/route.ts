// Pip's brain: takes a student's utterance + who they are + presence, and
// returns a structured reply (spoken text + expression + affinity nudge).
// Uses the AI SDK (v7) with OpenAI underneath.

import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { enrichStudentFromMemory, persistReflectionMemory } from "@/lib/memory";
import { buildSystemPrompt } from "@/lib/personality";
import { chatResponseSchema } from "@/lib/pipSchema";
import type { ChatRequest, ChatResponse } from "@/lib/types";

export const maxDuration = 30;

const MODEL = process.env.PIP_MODEL || "gpt-4o-mini";

const fallbackReply = (): ChatResponse => ({
  reply: "Squawk—my thoughts got tangled in my feathers. Say that again?",
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

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({
      ...fallbackReply(),
      reply: "Squawk! My brain isn't plugged in yet — ask a grown-up to set my OpenAI API key.",
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

  const history = (body.history ?? [])
    .slice(-8)
    .map((t) => `${t.role === "user" ? "Student" : "Pip"}: ${t.text}`)
    .join("\n");

  try {
    const { output } = await generateText({
      model: openai(MODEL),
      output: Output.object({ schema: chatResponseSchema }),
      system: buildSystemPrompt(chatContext),
      prompt: [
        history ? `Recent conversation:\n${history}\n` : "",
        `The student just said: "${body.text}"`,
        "Reply as Pip.",
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
