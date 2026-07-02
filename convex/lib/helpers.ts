import type { Doc } from "../_generated/dataModel";

const MAX_BULLETS = 24;

export function appendUnique(list: string[], note: string | null | undefined): string[] {
  const clean = note?.trim();
  if (!clean) return list;
  const exists = list.some((item) => item.trim().toLowerCase() === clean.toLowerCase());
  return exists ? list : [...list, clean].slice(-MAX_BULLETS);
}

export function studentToClient(student: Doc<"students">) {
  return {
    id: student._id,
    name: student.name,
    faceEmbedding: student.faceEmbedding,
    voiceProfile: student.voiceProfile,
    affinity: student.affinity,
    traits: student.traits,
    memory: student.memory,
    createdAt: new Date(student.createdAt).toISOString(),
    lastSeenAt: new Date(student.lastSeenAt).toISOString(),
  };
}

export function clampAffinity(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)));
}
