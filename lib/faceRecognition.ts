// Face recognition helpers focused on *consistent* identification of someone
// seen before. The core ideas:
//   - Match against a person's stored embedding, but require a confidence
//     margin over the runner-up so near-ties don't flip identity.
//   - Hysteresis: once anchored to a person, keep them unless another clearly
//     wins — this stops frame-to-frame flicker.
//   - Temporal smoothing: callers average recent embeddings before matching.
//   - Adaptive enrollment: blend a person's stored embedding toward fresh,
//     confident sightings so it tracks lighting/pose over time instead of being
//     frozen to a single snapshot.

import type { Student } from "./types";

// Cosine similarity thresholds for the Human face descriptor (env-tunable).
export const FACE_ACCEPT = Number(process.env.NEXT_PUBLIC_FACE_THRESHOLD || 0.5);
// Lower bar to *stay* on the currently anchored person (hysteresis).
export const FACE_KEEP = Number(process.env.NEXT_PUBLIC_FACE_KEEP_THRESHOLD || 0.42);
// Required lead of the top match over the runner-up to accept/switch.
export const FACE_MARGIN = Number(process.env.NEXT_PUBLIC_FACE_MARGIN || 0.06);
// EMA weight for blending a fresh embedding into the stored one (0..1).
export const FACE_BLEND_ALPHA = Number(process.env.NEXT_PUBLIC_FACE_BLEND_ALPHA || 0.2);
// Temporal smoothing window: average recent embeddings before matching.
export const FACE_WINDOW_MS = Number(process.env.NEXT_PUBLIC_FACE_WINDOW_MS || 1500);
export const FACE_WINDOW_N = Number(process.env.NEXT_PUBLIC_FACE_WINDOW_N || 8);

export function cosine(a: number[], b: number[]): number {
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

/** Component-wise mean of several embeddings (magnitude is irrelevant to cosine). */
export function averageEmbedding(list: (number[] | null | undefined)[]): number[] | null {
  const valid = list.filter((e): e is number[] => Array.isArray(e) && e.length > 0);
  if (!valid.length) return null;
  const len = valid[0].length;
  const out = new Array<number>(len).fill(0);
  let used = 0;
  for (const e of valid) {
    if (e.length !== len) continue;
    for (let i = 0; i < len; i++) out[i] += e[i];
    used++;
  }
  if (!used) return null;
  for (let i = 0; i < len; i++) out[i] /= used;
  return out;
}

/**
 * Blend a fresh embedding into the stored one (exponential moving average) so a
 * person's reference tracks their appearance over time. Returns whichever is
 * available if only one exists.
 */
export function blendEmbedding(
  stored: number[] | null | undefined,
  fresh: number[] | null | undefined,
  alpha: number = FACE_BLEND_ALPHA
): number[] | null {
  if (!stored?.length) return fresh?.length ? [...fresh] : null;
  if (!fresh?.length || fresh.length !== stored.length) return [...stored];
  const out = new Array<number>(stored.length);
  for (let i = 0; i < stored.length; i++) out[i] = stored[i] * (1 - alpha) + fresh[i] * alpha;
  return out;
}

export interface ScoredStudent {
  student: Student;
  score: number;
}

/** All students with an embedding, scored against `embedding`, best first. */
export function rankByFace(embedding: number[] | null, students: Student[]): ScoredStudent[] {
  if (!embedding?.length) return [];
  const scored: ScoredStudent[] = [];
  for (const student of students) {
    if (!student.faceEmbedding?.length) continue;
    scored.push({ student, score: cosine(embedding, student.faceEmbedding) });
  }
  return scored.sort((a, b) => b.score - a.score);
}

export interface FaceResolution {
  student: Student | null;
  score: number;
  /** A candidate cleared the accept bar but too close to the runner-up to trust. */
  ambiguous: boolean;
}

/**
 * Resolve who a face belongs to with a confidence margin and hysteresis.
 *  - If already anchored to `currentId` and they still score >= FACE_KEEP, stay
 *    with them unless someone else clearly wins (>= accept, and ahead by margin).
 *  - Otherwise accept the top match only if it clears FACE_ACCEPT and leads the
 *    runner-up by FACE_MARGIN; a strong-but-ambiguous top match returns
 *    `ambiguous` so callers can decline to guess.
 */
export function resolveFace(
  embedding: number[] | null,
  students: Student[],
  currentId: string | null
): FaceResolution {
  const ranked = rankByFace(embedding, students);
  if (!ranked.length) return { student: null, score: 0, ambiguous: false };

  const top1 = ranked[0];
  const top2 = ranked[1];
  const margin = top2 ? top1.score - top2.score : Infinity;

  if (currentId) {
    const current = ranked.find((r) => r.student.id === currentId);
    if (current && current.score >= FACE_KEEP) {
      const clearlyBetter =
        top1.student.id !== currentId &&
        top1.score >= FACE_ACCEPT &&
        margin >= FACE_MARGIN &&
        top1.score - current.score >= FACE_MARGIN;
      return clearlyBetter
        ? { student: top1.student, score: top1.score, ambiguous: false }
        : { student: current.student, score: current.score, ambiguous: false };
    }
  }

  if (top1.score >= FACE_ACCEPT && margin >= FACE_MARGIN) {
    return { student: top1.student, score: top1.score, ambiguous: false };
  }
  // Confident-looking but too close to another person to commit.
  if (top1.score >= FACE_ACCEPT) {
    return { student: null, score: top1.score, ambiguous: true };
  }
  return { student: null, score: top1.score, ambiguous: false };
}
