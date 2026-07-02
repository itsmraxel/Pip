import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const sessionValidator = v.object({
  id: v.string(),
  studentId: v.string(),
  startedAt: v.number(),
  endedAt: v.optional(v.number()),
  summary: v.optional(v.string()),
});

export const start = mutation({
  args: { studentId: v.id("students") },
  returns: v.string(),
  handler: async (ctx, args) => {
    const student = await ctx.db.get("students", args.studentId);
    if (!student) throw new Error("Student not found");

    return await ctx.db.insert("sessions", {
      studentId: args.studentId,
      startedAt: Date.now(),
    });
  },
});

export const end = mutation({
  args: {
    sessionId: v.id("sessions"),
    summary: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const session = await ctx.db.get("sessions", args.sessionId);
    if (!session) throw new Error("Session not found");

    await ctx.db.patch("sessions", args.sessionId, {
      endedAt: Date.now(),
      summary: args.summary?.trim() || session.summary,
    });

    return null;
  },
});

export const listForStudent = query({
  args: {
    studentId: v.id("students"),
    limit: v.optional(v.number()),
  },
  returns: v.array(sessionValidator),
  handler: async (ctx, args) => {
    const limit = args.limit ?? 10;
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_student", (q) => q.eq("studentId", args.studentId))
      .order("desc")
      .take(limit);

    return sessions.map((session) => ({
      id: session._id,
      studentId: session.studentId,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      summary: session.summary,
    }));
  },
});
