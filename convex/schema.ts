import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const memoryTypeValidator = v.union(
  v.literal("fact"),
  v.literal("trait"),
  v.literal("reflection"),
  v.literal("session"),
);

export default defineSchema({
  students: defineTable({
    name: v.string(),
    faceEmbedding: v.union(v.array(v.number()), v.null()),
    voiceProfile: v.union(v.string(), v.null()),
    affinity: v.number(),
    traits: v.array(v.string()),
    memory: v.array(v.string()),
    createdAt: v.number(),
    lastSeenAt: v.number(),
  }).index("by_last_seen", ["lastSeenAt"]),

  memories: defineTable({
    studentId: v.id("students"),
    type: memoryTypeValidator,
    content: v.string(),
    createdAt: v.number(),
    sessionId: v.optional(v.id("sessions")),
  })
    .index("by_student", ["studentId"])
    .index("by_student_and_type", ["studentId", "type"])
    .index("by_student_and_created", ["studentId", "createdAt"]),

  sessions: defineTable({
    studentId: v.id("students"),
    startedAt: v.number(),
    endedAt: v.optional(v.number()),
    summary: v.optional(v.string()),
  }).index("by_student", ["studentId"]),
});
