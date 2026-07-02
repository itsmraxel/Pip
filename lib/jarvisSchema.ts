// Shared Zod schemas for Jarvis's structured LLM outputs (chat + reflection).

import { z } from "zod";

export const jarvisExpressionSchema = z.enum([
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

export const jarvisEmoteSchema = z
  .enum(["love", "surprise", "sleep", "music", "annoyed", "sparkle", "question", "happy"])
  .nullable();

export const jarvisMoodSchema = z.enum(["neutral", "cheerful", "grumpy", "sleepy"]);

export const jarvisMemoryFieldsSchema = z.object({
  emotion: jarvisExpressionSchema.describe("Jarvis's facial expression after this exchange."),
  emote: jarvisEmoteSchema.describe("Optional floating emote above Jarvis, or null."),
  affinityDelta: z
    .number()
    .min(-10)
    .max(10)
    .describe("How this interaction nudges Jarvis's feelings toward the student."),
  memoryNote: z.string().nullable().describe("A short new fact worth remembering, or null."),
  traitNote: z
    .string()
    .nullable()
    .describe("A stable preference, hobby, nickname, or running joke, or null."),
  askName: z.boolean().describe("True if Jarvis should ask an unknown student for their name."),
  nextMood: jarvisMoodSchema.describe("Jarvis's mood to carry into the next turn."),
  learnedName: z
    .string()
    .nullable()
    .describe("Name if an unknown student introduced themselves, otherwise null."),
});

export const chatResponseSchema = jarvisMemoryFieldsSchema.extend({
  reply: z.string().describe("Jarvis's spoken reply — 1-3 short sentences, no markdown or emoji."),
});

export const reflectionResponseSchema = jarvisMemoryFieldsSchema.extend({
  proactiveCue: z
    .string()
    .nullable()
    .describe(
      "Optional short proactive line Jarvis might say next if the room goes quiet (under 12 words), or null."
    ),
});
