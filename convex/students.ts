import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { appendUnique, clampAffinity, studentToClient } from "./lib/helpers";

const studentValidator = v.object({
  id: v.string(),
  name: v.string(),
  faceEmbedding: v.union(v.array(v.number()), v.null()),
  voiceProfile: v.union(v.string(), v.null()),
  affinity: v.number(),
  traits: v.array(v.string()),
  memory: v.array(v.string()),
  createdAt: v.string(),
  lastSeenAt: v.string(),
});

export const list = query({
  args: {},
  returns: v.array(studentValidator),
  handler: async (ctx) => {
    const students = await ctx.db
      .query("students")
      .withIndex("by_last_seen")
      .order("desc")
      .collect();
    return students.map(studentToClient);
  },
});

export const get = query({
  args: { id: v.id("students") },
  returns: v.union(studentValidator, v.null()),
  handler: async (ctx, args) => {
    const student = await ctx.db.get("students", args.id);
    if (!student) return null;
    return studentToClient(student);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    faceEmbedding: v.optional(v.union(v.array(v.number()), v.null())),
    voiceProfile: v.optional(v.union(v.string(), v.null())),
    affinity: v.optional(v.number()),
    traits: v.optional(v.array(v.string())),
    memory: v.optional(v.array(v.string())),
  },
  returns: studentValidator,
  handler: async (ctx, args) => {
    const now = Date.now();
    const id = await ctx.db.insert("students", {
      name: args.name.trim(),
      faceEmbedding: args.faceEmbedding ?? null,
      voiceProfile: args.voiceProfile ?? null,
      affinity: clampAffinity(args.affinity ?? 0),
      traits: args.traits ?? [],
      memory: args.memory ?? [],
      createdAt: now,
      lastSeenAt: now,
    });
    const student = await ctx.db.get("students", id);
    if (!student) throw new Error("Failed to create student");
    return studentToClient(student);
  },
});

export const update = mutation({
  args: {
    id: v.id("students"),
    name: v.optional(v.string()),
    faceEmbedding: v.optional(v.union(v.array(v.number()), v.null())),
    voiceProfile: v.optional(v.union(v.string(), v.null())),
    affinity: v.optional(v.number()),
    traits: v.optional(v.array(v.string())),
    memory: v.optional(v.array(v.string())),
    affinityDelta: v.optional(v.number()),
    memoryNote: v.optional(v.union(v.string(), v.null())),
    traitNote: v.optional(v.union(v.string(), v.null())),
    learnedName: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.union(studentValidator, v.null()),
  handler: async (ctx, args) => {
    const existing = await ctx.db.get("students", args.id);
    if (!existing) return null;

    const now = Date.now();
    let affinity = existing.affinity;
    if (typeof args.affinity === "number") {
      affinity = clampAffinity(args.affinity);
    } else if (typeof args.affinityDelta === "number") {
      affinity = clampAffinity(existing.affinity + args.affinityDelta);
    }

    const traits =
      args.traitNote !== undefined
        ? appendUnique(existing.traits, args.traitNote)
        : (args.traits ?? existing.traits);

    const memory =
      args.memoryNote !== undefined
        ? appendUnique(existing.memory, args.memoryNote)
        : (args.memory ?? existing.memory);

    const name =
      args.learnedName?.trim() ||
      args.name?.trim() ||
      existing.name;

    if (args.traitNote?.trim()) {
      await ctx.db.insert("memories", {
        studentId: args.id,
        type: "trait",
        content: args.traitNote.trim(),
        createdAt: now,
      });
    }

    if (args.memoryNote?.trim()) {
      await ctx.db.insert("memories", {
        studentId: args.id,
        type: "reflection",
        content: args.memoryNote.trim(),
        createdAt: now,
      });
    }

    await ctx.db.patch("students", args.id, {
      name,
      faceEmbedding:
        args.faceEmbedding !== undefined ? args.faceEmbedding : existing.faceEmbedding,
      voiceProfile:
        args.voiceProfile !== undefined ? args.voiceProfile : existing.voiceProfile,
      affinity,
      traits,
      memory,
      lastSeenAt: now,
    });

    const updated = await ctx.db.get("students", args.id);
    if (!updated) return null;
    return studentToClient(updated);
  },
});
