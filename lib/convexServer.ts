import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export const usingConvex = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

export function asStudentId(id: string): Id<"students"> {
  return id as Id<"students">;
}

export async function convexListStudents() {
  return await fetchQuery(api.students.list, {});
}

export async function convexGetStudent(id: string) {
  return await fetchQuery(api.students.get, { id: asStudentId(id) });
}

export async function convexCreateStudent(args: {
  name: string;
  faceEmbedding?: number[] | null;
  voiceProfile?: string | null;
  affinity?: number;
  traits?: string[];
  memory?: string[];
}) {
  return await fetchMutation(api.students.create, args);
}

export async function convexUpdateStudent(
  id: string,
  patch: {
    name?: string;
    faceEmbedding?: number[] | null;
    voiceProfile?: string | null;
    affinity?: number;
    traits?: string[];
    memory?: string[];
    affinityDelta?: number;
    memoryNote?: string | null;
    traitNote?: string | null;
    learnedName?: string | null;
  }
) {
  return await fetchMutation(api.students.update, { id: asStudentId(id), ...patch });
}

export async function convexGetMemoryContext(studentId: string, limit = 12) {
  return await fetchQuery(api.memories.getContext, {
    studentId: asStudentId(studentId),
    limit,
  });
}

export async function convexApplyReflection(
  studentId: string,
  reflection: {
    affinityDelta: number;
    memoryNote: string | null;
    traitNote: string | null;
  }
) {
  await fetchMutation(api.memories.applyReflection, {
    studentId: asStudentId(studentId),
    ...reflection,
  });
}

export async function convexAddMemory(
  studentId: string,
  type: "fact" | "trait" | "reflection" | "session",
  content: string
) {
  return await fetchMutation(api.memories.add, {
    studentId: asStudentId(studentId),
    type,
    content,
  });
}
