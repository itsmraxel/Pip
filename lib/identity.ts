// Identity: turn raw recognition signals (a face embedding + an optional voice
// match) into "which student is this?" with a confidence. Face is the on-sight
// signal; voice confirms/strengthens it. Conservative thresholds mean Jarvis asks
// rather than guessing wrong.

import type { Student } from "./types";

const FACE_THRESHOLD = Number(process.env.NEXT_PUBLIC_FACE_THRESHOLD || 0.5);
const VOICE_THRESHOLD = Number(process.env.NEXT_PUBLIC_VOICE_THRESHOLD || 0.5);

function cosine(a: number[], b: number[]): number {
  if (!a?.length || a.length !== b?.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface Match {
  student: Student | null;
  confidence: number;
  via: "face" | "voice" | "face+voice" | "none";
}

// #region agent log
/** DEBUG: best raw cosine (ignoring threshold) for diagnosing over-matching. */
export function debugBestFaceScore(
  embedding: number[] | null,
  students: Student[]
): { name: string | null; id: string | null; score: number; threshold: number; enrolled: number } {
  const enrolled = students.filter((s) => s.faceEmbedding).length;
  if (!embedding) return { name: null, id: null, score: 0, threshold: FACE_THRESHOLD, enrolled };
  let best: Student | null = null;
  let bestScore = 0;
  for (const s of students) {
    if (!s.faceEmbedding) continue;
    const score = cosine(embedding, s.faceEmbedding);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return { name: best?.name ?? null, id: best?.id ?? null, score: bestScore, threshold: FACE_THRESHOLD, enrolled };
}

/** DEBUG: top-1 and top-2 matches + margin, to diagnose separation/over-matching. */
export function debugTopTwoFaceScores(
  embedding: number[] | null,
  students: Student[]
): {
  top1: { name: string | null; id: string | null; score: number } | null;
  top2: { name: string | null; id: string | null; score: number } | null;
  margin: number;
  threshold: number;
  enrolled: number;
} {
  const enrolled = students.filter((s) => s.faceEmbedding).length;
  const scored = students
    .filter((s) => s.faceEmbedding)
    .map((s) => ({ name: s.name, id: s.id, score: cosine(embedding ?? [], s.faceEmbedding as number[]) }))
    .sort((a, b) => b.score - a.score);
  const top1 = scored[0] ?? null;
  const top2 = scored[1] ?? null;
  const margin = top1 && top2 ? top1.score - top2.score : top1 ? top1.score : 0;
  return { top1, top2, margin, threshold: FACE_THRESHOLD, enrolled };
}
// #endregion

/** Best face match among students with a stored embedding. */
export function matchByFace(embedding: number[] | null, students: Student[]): { student: Student; score: number } | null {
  if (!embedding) return null;
  let best: Student | null = null;
  let bestScore = 0;
  for (const s of students) {
    if (!s.faceEmbedding) continue;
    const score = cosine(embedding, s.faceEmbedding);
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best && bestScore >= FACE_THRESHOLD ? { student: best, score: bestScore } : null;
}

/**
 * Find a student by their (case-insensitive) name. A spoken self-introduction
 * is a far more reliable identity signal than a noisy face embedding, so this
 * is used as the authoritative match when a name is known.
 */
export function matchByName(name: string | null | undefined, students: Student[]): Student | null {
  const clean = name?.trim().toLowerCase();
  if (!clean) return null;
  return students.find((s) => s.name.trim().toLowerCase() === clean) ?? null;
}

/**
 * Fuse a face match with a voice match. `voiceStudent` is the student the Eagle
 * recognizer picked (via profile order) with `voiceScore`.
 */
export function resolveIdentity(
  faceMatch: { student: Student; score: number } | null,
  voiceStudent: Student | null,
  voiceScore: number
): Match {
  const voiceOk = voiceStudent && voiceScore >= VOICE_THRESHOLD;

  if (faceMatch && voiceOk && faceMatch.student.id === voiceStudent!.id) {
    return { student: faceMatch.student, confidence: Math.min(1, (faceMatch.score + voiceScore) / 1.5), via: "face+voice" };
  }
  if (faceMatch) {
    return { student: faceMatch.student, confidence: faceMatch.score, via: "face" };
  }
  if (voiceOk) {
    return { student: voiceStudent!, confidence: voiceScore, via: "voice" };
  }
  return { student: null, confidence: 0, via: "none" };
}
