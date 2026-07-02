import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { memoryTypeValidator } from "./schema";
import { appendUnique } from "./lib/helpers";

const memoryRecordValidator = v.object({
  id: v.string(),
  studentId: v.string(),
  type: memoryTypeValidator,
  content: v.string(),
  createdAt: v.number(),
  sessionId: v.optional(v.string()),
});

export const listForStudent = query({
  args: {
    studentId: v.id("students"),
    limit: v.optional(v.number()),
  },
  returns: v.array(memoryRecordValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 24;
    const memories = await ctx.db
      .query("memories")
      .withIndex("by_student_and_created", (q) => q.eq("studentId", args.studentId))
      .order("desc")
      .take(limit);

    return memories.map((memory) => ({
      id: memory._id,
      studentId: memory.studentId,
      type: memory.type,
      content: memory.content,
      createdAt: memory.createdAt,
      sessionId: memory.sessionId,
    }));
  },
});

export const getContext = query({
  args: {
    studentId: v.id("students"),
    limit: v.optional(v.number()),
  },
  returns: v.object({
    traits: v.array(v.string()),
    memory: v.array(v.string()),
    recentMemories: v.array(memoryRecordValidator),
  }),
  handler: async (ctx, args) => {
    const student = await ctx.db.get("students", args.studentId);
    if (!student) {
      return { traits: [], memory: [], recentMemories: [] };
    }

    const limit = args.limit ?? 12;
    const recentMemories = await ctx.db
      .query("memories")
      .withIndex("by_student_and_created", (q) => q.eq("studentId", args.studentId))
      .order("desc")
      .take(limit);

    return {
      traits: student.traits,
      memory: student.memory,
      recentMemories: recentMemories.map((memory) => ({
        id: memory._id,
        studentId: memory.studentId,
        type: memory.type,
        content: memory.content,
        createdAt: memory.createdAt,
        sessionId: memory.sessionId,
      })),
    };
  },
});

export const add = mutation({
  args: {
    studentId: v.id("students"),
    type: memoryTypeValidator,
    content: v.string(),
    sessionId: v.optional(v.id("sessions")),
  },
  returns: v.string(),
  handler: async (ctx, args) => {
    const clean = args.content.trim();
    if (!clean) throw new Error("Memory content is required");

    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new Error("Student not found");

    const now = Date.now();
    const memoryId = await ctx.db.insert("memories", {
      studentId: args.studentId,
      type: args.type,
      content: clean,
      createdAt: now,
      sessionId: args.sessionId,
    });

    const patch: { traits?: string[]; memory?: string[]; lastSeenAt: number } = {
      lastSeenAt: now,
    };

    if (args.type === "trait") {
      patch.traits = appendUnique(student.traits, clean);
    } else {
      patch.memory = appendUnique(student.memory, clean);
    }

    await ctx.db.patch("students", args.studentId, patch);
    return memoryId;
  },
});

export const applyReflection = mutation({
  args: {
    studentId: v.id("students"),
    affinityDelta: v.number(),
    memoryNote: v.union(v.string(), v.null()),
    traitNote: v.union(v.string(), v.null()),
    sessionId: v.optional(v.id("sessions")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new Error("Student not found");

    const now = Date.now();
    const affinity = Math.max(-100, Math.min(100, Math.round(student.affinity + args.affinityDelta)));
    let traits = student.traits;
    let memory = student.memory;

    if (args.traitNote?.trim()) {
      traits = appendUnique(traits, args.traitNote);
      await ctx.db.insert("memories", {
        studentId: args.studentId,
        type: "trait",
        content: args.traitNote.trim(),
        createdAt: now,
        sessionId: args.sessionId,
      });
    }

    if (args.memoryNote?.trim()) {
      memory = appendUnique(memory, args.memoryNote);
      await ctx.db.insert("memories", {
        studentId: args.studentId,
        type: "reflection",
        content: args.memoryNote.trim(),
        createdAt: now,
        sessionId: args.sessionId,
      });
    }

    await ctx.db.patch("students", args.studentId, {
      affinity,
      traits,
      memory,
      lastSeenAt: now,
    });

    return null;
  },
});
