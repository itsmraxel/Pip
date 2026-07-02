// Student identity + memory store.
//   GET  -> all known students (face embeddings + voice profiles + affinity)
//   POST -> create a new student, or update an existing one by id.

import { createStudent, listStudents, updateStudent } from "@/lib/db";
import { usingConvex } from "@/lib/convexServer";
import { applyAffinity } from "@/lib/personality";
import type { Student } from "@/lib/types";

// #region agent log
function debugLog(hypothesisId: string, message: string, data: unknown) {
  fetch('http://127.0.0.1:7869/ingest/1322e9a3-526c-4f7e-837c-345fe456b255', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': '87d609' },
    body: JSON.stringify({ sessionId: '87d609', runId: 'postfix', hypothesisId, location: 'app/api/students/route.ts', message, data, timestamp: Date.now() }),
  }).catch(() => {});
}
// #endregion

type StudentWriteRequest = Partial<Student> & {
  id?: string;
  affinityDelta?: number;
  memoryNote?: string | null;
  traitNote?: string | null;
  learnedName?: string | null;
};

function appendUnique(list: string[] | undefined, note: string | null | undefined): string[] {
  const clean = note?.trim();
  const base = list ?? [];
  if (!clean) return base;
  const exists = base.some((item) => item.trim().toLowerCase() === clean.toLowerCase());
  return exists ? base : [...base, clean].slice(-24);
}

function patchFromReflection(existing: Student, body: StudentWriteRequest): Partial<Omit<Student, "id" | "createdAt">> {
  const hasAffinityDelta = typeof body.affinityDelta === "number";
  return {
    name: body.name?.trim() || existing.name,
    faceEmbedding: body.faceEmbedding !== undefined ? body.faceEmbedding : existing.faceEmbedding,
    voiceProfile: body.voiceProfile !== undefined ? body.voiceProfile : existing.voiceProfile,
    affinity: hasAffinityDelta ? applyAffinity(existing.affinity, body.affinityDelta ?? 0) : body.affinity ?? existing.affinity,
    traits: body.traitNote ? appendUnique(existing.traits, body.traitNote) : body.traits ?? existing.traits,
    memory: body.memoryNote ? appendUnique(existing.memory, body.memoryNote) : body.memory ?? existing.memory,
  };
}

export async function GET() {
  try {
    const students = await listStudents();
    // #region agent log
    debugLog('C', 'GET listStudents ok', { usingConvex, convexUrlSet: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL), convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? null, count: students.length, names: students.map((s) => s.name) });
    // #endregion
    return Response.json({ students });
  } catch (err) {
    // #region agent log
    debugLog('C', 'GET listStudents THREW', { usingConvex, convexUrlSet: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL), convexUrl: process.env.NEXT_PUBLIC_CONVEX_URL ?? null, error: err instanceof Error ? err.message : String(err) });
    // #endregion
    console.error("students GET error", err);
    return Response.json({ students: [] as Student[], error: "db-failed" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as StudentWriteRequest;
  try {
    if (body.id) {
      const existing = (await listStudents()).find((student) => student.id === body.id);
      if (!existing) return Response.json({ error: "not-found" }, { status: 404 });

      const hasReflectionDeltas =
        typeof body.affinityDelta === "number" ||
        body.memoryNote != null ||
        body.traitNote != null;

      const patch = hasReflectionDeltas
        ? {
            name: body.name?.trim() || existing.name,
            faceEmbedding:
              body.faceEmbedding !== undefined ? body.faceEmbedding : existing.faceEmbedding,
            voiceProfile:
              body.voiceProfile !== undefined ? body.voiceProfile : existing.voiceProfile,
            affinityDelta: body.affinityDelta,
            memoryNote: body.memoryNote,
            traitNote: body.traitNote,
            learnedName: body.learnedName,
          }
        : patchFromReflection(existing, body);

      const updated = await updateStudent(body.id, patch);
      // #region agent log
      debugLog('C', 'POST update result', { usingConvex, id: body.id, ok: Boolean(updated), resultId: updated?.id ?? null, resultName: updated?.name ?? null, memoryCount: updated?.memory.length ?? null });
      // #endregion
      if (!updated) return Response.json({ error: "not-found" }, { status: 404 });
      return Response.json({ student: updated });
    }
    const name = body.learnedName?.trim() || body.name?.trim();
    if (!name) return Response.json({ error: "name-required" }, { status: 400 });
    const affinity = typeof body.affinityDelta === "number" ? applyAffinity(body.affinity ?? 0, body.affinityDelta) : body.affinity ?? 0;
    const created = await createStudent({
      name,
      faceEmbedding: body.faceEmbedding ?? null,
      voiceProfile: body.voiceProfile ?? null,
      affinity,
      traits: appendUnique(body.traits, body.traitNote),
      memory: appendUnique(body.memory, body.memoryNote),
    });
    // #region agent log
    debugLog('C', 'POST create result', { usingConvex, name, createdId: created.id });
    // #endregion
    return Response.json({ student: created });
  } catch (err) {
    // #region agent log
    debugLog('C', 'POST THREW', { usingConvex, hasId: Boolean(body.id), error: err instanceof Error ? err.message : String(err) });
    // #endregion
    console.error("students POST error", err);
    return Response.json({ error: "db-failed" }, { status: 500 });
  }
}
