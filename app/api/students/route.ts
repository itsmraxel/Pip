// Student identity + memory store.
//   GET  -> all known students (face embeddings + voice profiles + affinity)
//   POST -> create a new student, or update an existing one by id.

import { createStudent, listStudents, updateStudent } from "@/lib/db";
import type { Student } from "@/lib/types";

export async function GET() {
  try {
    const students = await listStudents();
    return Response.json({ students });
  } catch (err) {
    console.error("students GET error", err);
    return Response.json({ students: [] as Student[], error: "db-failed" }, { status: 200 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Student> & { id?: string };
  try {
    if (body.id) {
      const updated = await updateStudent(body.id, body);
      if (!updated) return Response.json({ error: "not-found" }, { status: 404 });
      return Response.json({ student: updated });
    }
    if (!body.name?.trim()) return Response.json({ error: "name-required" }, { status: 400 });
    const created = await createStudent({ ...body, name: body.name });
    return Response.json({ student: created });
  } catch (err) {
    console.error("students POST error", err);
    return Response.json({ error: "db-failed" }, { status: 500 });
  }
}
