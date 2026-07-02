import type { Student } from "./types";
import {
  convexApplyReflection,
  convexCreateStudent,
  convexGetMemoryContext,
  convexListStudents,
  convexUpdateStudent,
  usingConvex,
} from "./convexServer";

export { usingConvex };

export async function getMemoryContextForStudent(studentId: string) {
  if (!usingConvex) return null;
  return await convexGetMemoryContext(studentId);
}

export async function persistReflectionMemory(
  studentId: string,
  reflection: {
    affinityDelta: number;
    memoryNote: string | null;
    traitNote: string | null;
  }
) {
  if (!usingConvex) return;
  await convexApplyReflection(studentId, reflection);
}

export async function enrichStudentFromMemory(
  student: Pick<Student, "name" | "affinity" | "traits" | "memory"> & { id?: string }
): Promise<Pick<Student, "name" | "affinity" | "traits" | "memory">> {
  if (!student.id || !usingConvex) {
    return {
      name: student.name,
      affinity: student.affinity,
      traits: student.traits,
      memory: student.memory,
    };
  }

  const context = await convexGetMemoryContext(student.id);
  return {
    name: student.name,
    affinity: student.affinity,
    traits: context.traits.length ? context.traits : student.traits,
    memory: context.memory.length ? context.memory : student.memory,
  };
}

export {
  convexListStudents,
  convexCreateStudent,
  convexUpdateStudent,
};
