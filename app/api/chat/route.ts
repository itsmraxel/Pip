// Pip's brain: takes a student's utterance + who they are + presence, and
// returns a structured reply (spoken text + expression + affinity nudge).
// Uses the AI SDK (v7) with Google Gemini underneath.

import { google } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import { z } from "zod";
import { buildSystemPrompt } from "@/lib/personality";
import type { ChatRequest, ChatResponse } from "@/lib/types";

export const maxDuration = 30;

const MODEL = process.env.PIP_MODEL || "gemini-2.5-flash";

const schema = z.object({
  reply: z.string().describe("Pip's spoken reply — 1-3 short sentences, no markdown or emoji."),
  emotion: z
    .enum(["neutral", "happy", "love", "excited", "curious", "unimpressed", "surprised", "sad", "sleepy", "mischievous"])
    .describe("Pip's facial expression for this reply."),
  emote: z
    .enum(["love", "surprise", "sleep", "music", "annoyed", "sparkle", "question", "happy"])
    .nullable()
    .describe("Optional floating emote to pop above Pip, or null."),
  affinityDelta: z.number().min(-10).max(10).describe("How this interaction nudges Pip's feelings toward the student."),
  memoryNote: z.string().nullable().describe("A short new fact worth remembering about the student, or null."),
  traitNote: z.string().nullable().describe("A stable preference, hobby, nickname, or running joke to remember, or null."),
  askName: z.boolean().describe("True if Pip is asking an unknown student for their name."),
  nextMood: z
    .enum(["neutral", "cheerful", "grumpy", "sleepy"])
    .describe("Pip's mood to carry into the next turn."),
  learnedName: z
    .string()
    .nullable()
    .describe("The student's name if an unknown student introduced themselves in this turn, otherwise null."),
});

export async function POST(req: Request) {
  const body = (await req.json()) as ChatRequest;

  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const fallback: ChatResponse = {
      reply: "Squawk! My brain isn't plugged in yet — ask a grown-up to set my Google API key.",
      emotion: "curious",
      emote: "question",
      affinityDelta: 0,
      memoryNote: null,
      traitNote: null,
      askName: false,
      nextMood: "neutral",
      learnedName: null,
    };
    return Response.json(fallback);
  }

  const history = (body.history ?? [])
    .slice(-8)
    .map((t) => `${t.role === "user" ? "Student" : "Pip"}: ${t.text}`)
    .join("\n");

  try {
    const { output } = await generateText({
      model: google(MODEL),
      output: Output.object({ schema }),
      system: buildSystemPrompt(body),
      prompt: [
        history ? `Recent conversation:\n${history}\n` : "",
        `The student just said: "${body.text}"`,
        "Reply as Pip.",
      ].filter(Boolean).join("\n"),
    });
    return Response.json(output satisfies ChatResponse);
  } catch (err) {
    console.error("chat route error", err);
    const fallback: ChatResponse = {
      reply: "Squawk—my thoughts got tangled in my feathers. Say that again?",
      emotion: "surprised",
      emote: "question",
      affinityDelta: 0,
      memoryNote: null,
      traitNote: null,
      askName: false,
      nextMood: "neutral",
      learnedName: null,
    };
    return Response.json(fallback, { status: 200 });
  }
}
