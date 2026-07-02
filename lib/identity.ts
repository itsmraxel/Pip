// Identity: turn raw recognition signals (a face embedding + an optional voice
// match) into "which student is this?" with a confidence. Face is the on-sight
// signal; voice confirms/strengthens it. Conservative thresholds mean Jarvis asks
// rather than guessing wrong.

import type { Student } from "./types";
import { resolveFace } from "./faceRecognition";

const VOICE_THRESHOLD = Number(process.env.NEXT_PUBLIC_VOICE_THRESHOLD || 0.5);

export interface Match {
  student: Student | null;
  confidence: number;
  via: "face" | "voice" | "face+voice" | "none";
}

/**
 * Best face match among students with a stored embedding, requiring both a
 * confidence threshold and a margin over the runner-up (via resolveFace) so
 * near-ties return null rather than a coin-flip guess.
 */
export function matchByFace(embedding: number[] | null, students: Student[]): { student: Student; score: number } | null {
  const r = resolveFace(embedding, students, null);
  return r.student ? { student: r.student, score: r.score } : null;
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
