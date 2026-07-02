// Student persistence. Uses Convex when NEXT_PUBLIC_CONVEX_URL is set,
// Postgres when DATABASE_URL / POSTGRES_URL is set, otherwise falls back to
// an in-memory store (with best-effort local JSON file) for development.

import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Student } from "./types";
import {
  convexCreateStudent,
  convexListStudents,
  convexUpdateStudent,
  usingConvex,
} from "./convexServer";

const CONN = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

// ---------------- Postgres backend ----------------

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
type Sql = any;
let sqlPromise: Promise<Sql> | null = null;

async function getSql(): Promise<Sql> {
  if (!sqlPromise) {
    sqlPromise = (async () => {
      const { default: postgres } = await import("postgres");
      const sql = postgres(CONN, { ssl: "require", max: 3 });
      await sql`
        CREATE TABLE IF NOT EXISTS students (
          id text PRIMARY KEY,
          name text NOT NULL,
          face_embedding jsonb,
          voice_profile text,
          affinity integer NOT NULL DEFAULT 0,
          traits jsonb NOT NULL DEFAULT '[]'::jsonb,
          memory jsonb NOT NULL DEFAULT '[]'::jsonb,
          created_at timestamptz NOT NULL DEFAULT now(),
          last_seen_at timestamptz NOT NULL DEFAULT now()
        )`;
      return sql;
    })();
  }
  return sqlPromise;
}

/* eslint-disable-next-line @typescript-eslint/no-explicit-any */
function rowToStudent(r: any): Student {
  return {
    id: r.id,
    name: r.name,
    faceEmbedding: r.face_embedding ?? null,
    voiceProfile: r.voice_profile ?? null,
    affinity: r.affinity ?? 0,
    traits: r.traits ?? [],
    memory: r.memory ?? [],
    createdAt: new Date(r.created_at).toISOString(),
    lastSeenAt: new Date(r.last_seen_at).toISOString(),
  };
}

// ---------------- In-memory / file backend ----------------

const FILE = path.join(process.cwd(), ".data", "students.json");
const g = globalThis as unknown as { __pipStudents?: Student[] };
let loaded = false;

async function memLoad(): Promise<Student[]> {
  if (!g.__pipStudents) g.__pipStudents = [];
  if (!loaded) {
    loaded = true;
    try {
      const raw = await readFile(FILE, "utf8");
      g.__pipStudents = JSON.parse(raw);
    } catch {
      /* no file yet */
    }
  }
  return g.__pipStudents ?? (g.__pipStudents = []);
}

async function memSave() {
  try {
    await mkdir(path.dirname(FILE), { recursive: true });
    await writeFile(FILE, JSON.stringify(g.__pipStudents ?? [], null, 2));
  } catch {
    /* read-only fs (e.g. serverless) — keep in memory only */
  }
}

// ---------------- Public API ----------------

export const usingPostgres = Boolean(CONN) && !usingConvex;

export async function listStudents(): Promise<Student[]> {
  if (usingConvex) {
    return await convexListStudents();
  }
  if (CONN) {
    const sql = await getSql();
    const rows = await sql`SELECT * FROM students ORDER BY last_seen_at DESC`;
    return rows.map(rowToStudent);
  }
  return [...(await memLoad())];
}

export async function createStudent(
  data: Partial<Student> & { name: string }
): Promise<Student> {
  if (usingConvex) {
    return await convexCreateStudent({
      name: data.name,
      faceEmbedding: data.faceEmbedding ?? null,
      voiceProfile: data.voiceProfile ?? null,
      affinity: data.affinity ?? 0,
      traits: data.traits ?? [],
      memory: data.memory ?? [],
    });
  }

  const now = new Date().toISOString();
  const student: Student = {
    id: randomUUID(),
    name: data.name,
    faceEmbedding: data.faceEmbedding ?? null,
    voiceProfile: data.voiceProfile ?? null,
    affinity: data.affinity ?? 0,
    traits: data.traits ?? [],
    memory: data.memory ?? [],
    createdAt: now,
    lastSeenAt: now,
  };
  if (CONN) {
    const sql = await getSql();
    await sql`
      INSERT INTO students (id, name, face_embedding, voice_profile, affinity, traits, memory, created_at, last_seen_at)
      VALUES (${student.id}, ${student.name}, ${sql.json(student.faceEmbedding)}, ${student.voiceProfile},
              ${student.affinity}, ${sql.json(student.traits)}, ${sql.json(student.memory)}, ${student.createdAt}, ${student.lastSeenAt})`;
    return student;
  }
  const list = await memLoad();
  list.push(student);
  await memSave();
  return student;
}

export async function updateStudent(
  id: string,
  patch: Partial<Omit<Student, "id" | "createdAt">> & {
    affinityDelta?: number;
    memoryNote?: string | null;
    traitNote?: string | null;
    learnedName?: string | null;
  }
): Promise<Student | null> {
  if (usingConvex) {
    return await convexUpdateStudent(id, patch);
  }

  const lastSeenAt = new Date().toISOString();
  if (CONN) {
    const sql = await getSql();
    const [existing] = await sql`SELECT * FROM students WHERE id = ${id}`;
    if (!existing) return null;
    const cur = rowToStudent(existing);
    const next: Student = { ...cur, ...patch, lastSeenAt };
    await sql`
      UPDATE students SET
        name = ${next.name},
        face_embedding = ${sql.json(next.faceEmbedding)},
        voice_profile = ${next.voiceProfile},
        affinity = ${next.affinity},
        traits = ${sql.json(next.traits)},
        memory = ${sql.json(next.memory)},
        last_seen_at = ${lastSeenAt}
      WHERE id = ${id}`;
    return next;
  }
  const list = await memLoad();
  const idx = list.findIndex((s) => s.id === id);
  if (idx === -1) return null;
  list[idx] = { ...list[idx], ...patch, lastSeenAt };
  await memSave();
  return list[idx];
}
