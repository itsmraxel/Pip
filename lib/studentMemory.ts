// Helpers for merging reflection output into persisted student records.

import { applyAffinity } from "./personality";
import type { ReflectionResponse, Student } from "./types";

/** Append a note if it is new (case-insensitive), keeping a bounded list. */
export function appendUnique(items: string[], note: string | null, max = 24): string[] {
  if (!note?.trim()) return items;
  const trimmed = note.trim();
  if (items.some((item) => item.toLowerCase() === trimmed.toLowerCase())) return items;
  return [...items, trimmed].slice(-max);
}

/** Build a PATCH payload for an existing student from reflection output. */
export function buildStudentPatch(
  student: Student,
  reflection: Pick<ReflectionResponse, "affinityDelta" | "memoryNote" | "traitNote">,
  faceEmbedding?: number[] | null
): Partial<Student> {
  const resolvedEmbedding = student.faceEmbedding ?? faceEmbedding ?? null;
  // #region agent log
  // H-A: is the stored embedding frozen (old kept while a fresh one is discarded)?
  fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'ccbd32'},body:JSON.stringify({sessionId:'ccbd32',runId:'diagnose',hypothesisId:'A',location:'lib/studentMemory.ts:buildStudentPatch',message:'embedding update decision',data:{studentId:student.id,studentName:student.name,hadStoredEmbedding:!!student.faceEmbedding,receivedFreshEmbedding:!!faceEmbedding,keptFrozen:!!student.faceEmbedding&&!!faceEmbedding,resultIsStored:resolvedEmbedding===student.faceEmbedding},timestamp:Date.now()})}).catch(()=>{});
  // #endregion
  return {
    affinity: applyAffinity(student.affinity, reflection.affinityDelta),
    memory: appendUnique(student.memory, reflection.memoryNote),
    traits: appendUnique(student.traits, reflection.traitNote, 16),
    faceEmbedding: resolvedEmbedding,
  };
}

/** Merge a freshly loaded/created student back into the in-memory roster. */
export function upsertStudentRoster(students: Student[], updated: Student): Student[] {
  const idx = students.findIndex((s) => s.id === updated.id);
  if (idx === -1) return [updated, ...students];
  const next = [...students];
  next[idx] = updated;
  return next;
}
