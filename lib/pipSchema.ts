// Shared Zod schemas for Pip's structured LLM outputs (chat + reflection).

import { z } from "zod";

export const pipExpressionSchema = z.enum([
  "neutral",
  "happy",
  "love",
  "excited",
  "curious",
  "unimpressed",
  "surprised",
  "sad",
  "sleepy",
  "mischievous",
]);

export const pipEmoteSchema = z
  .enum(["love", "surprise", "sleep", "music", "annoyed", "sparkle", "question", "happy"])
  .nullable();

export const pipMoodSchema = z.enum(["neutral", "cheerful", "grumpy", "sleepy"]);

export const pipMemoryFieldsSchema = z.object({
  emotion: pipExpressionSchema.describe("Pip's facial expression after this exchange."),
  emote: pipEmoteSchema.describe("Optional floating emote above Pip, or null."),
  affinityDelta: z
    .number()
    .min(-10)
    .max(10)
    .describe("How this interaction nudges Pip's feelings toward the student."),
  memoryNote: z.string().nullable().describe("A short new fact worth remembering, or null."),
  traitNote: z
    .string()
    .nullable()
    .describe("A stable preference, hobby, nickname, or running joke, or null."),
  askName: z.boolean().describe("True if Pip should ask an unknown student for their name."),
  nextMood: pipMoodSchema.describe("Pip's mood to carry into the next turn."),
  learnedName: z
    .string()
    .nullable()
    .describe("Name if an unknown student introduced themselves, otherwise null."),
});

export const chatResponseSchema = pipMemoryFieldsSchema.extend({
  reply: z.string().describe("Pip's spoken reply — 1-3 short sentences, no markdown or emoji."),
});

export const reflectionResponseSchema = pipMemoryFieldsSchema.extend({
  proactiveCue: z
    .string()
    .nullable()
    .describe(
      "Optional short proactive line Pip might say next if the room goes quiet (under 12 words), or null."
    ),
});
