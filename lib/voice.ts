// Voice fingerprinting via Picovoice Eagle (on-device, in-browser).
//   - Enrollment: collect mic audio until a voice profile is complete, export it.
//   - Recognition: score live audio against known profiles to identify a speaker.
//
// This is OPTIONAL. It activates only when NEXT_PUBLIC_PICOVOICE_ACCESS_KEY and
// an Eagle model URL are configured; otherwise identity falls back to face-only.
// Typed loosely + dynamically imported (browser + WASM only).

/* eslint-disable @typescript-eslint/no-explicit-any */

const ACCESS_KEY = process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY || "";
const MODEL_URL =
  process.env.NEXT_PUBLIC_EAGLE_MODEL_URL || "/models/eagle_params.pv";

export const voiceIdAvailable = Boolean(ACCESS_KEY);

export interface RecognizeResult {
  /** index into the profiles array of the best match, or -1. */
  index: number;
  score: number;
}

export class VoiceId {
  private eagle: any = null;
  private profiler: any = null;
  private wvp: any = null;
  private WebVoiceProcessor: any = null;

  /** Build a recognizer over the given base64 profiles (order preserved). */
  async initRecognizer(base64Profiles: string[]) {
    if (!ACCESS_KEY || base64Profiles.length === 0) return false;
    try {
      const { Eagle } = await import("@picovoice/eagle-web");
      const profiles = base64Profiles.map((b) => ({ bytes: base64ToBytes(b) }));
      this.eagle = await Eagle.create(ACCESS_KEY, { publicPath: MODEL_URL }, profiles);
      return true;
    } catch (err) {
      console.warn("VoiceId recognizer init failed", err);
      return false;
    }
  }

  /** Feed one Int16 frame; returns the best-matching profile index + score. */
  process(frame: Int16Array): RecognizeResult {
    if (!this.eagle) return { index: -1, score: 0 };
    try {
      const scores: number[] = this.eagle.process(frame);
      let index = -1;
      let score = 0;
      scores.forEach((s, i) => {
        if (s > score) {
          score = s;
          index = i;
        }
      });
      return { index, score };
    } catch {
      return { index: -1, score: 0 };
    }
  }

  // ---- enrollment ----

  async startEnrollment() {
    if (!ACCESS_KEY) return false;
    const { EagleProfiler } = await import("@picovoice/eagle-web");
    this.profiler = await EagleProfiler.create(ACCESS_KEY, { publicPath: MODEL_URL });
    return true;
  }

  /** Feed Int16 audio; returns 0..100 completeness. Export at 100. */
  async enroll(pcm: Int16Array): Promise<{ percentage: number; feedback: string }> {
    if (!this.profiler) return { percentage: 0, feedback: "NO_PROFILER" };
    const res = await this.profiler.enroll(pcm);
    return { percentage: res.percentage, feedback: String(res.feedback) };
  }

  /** Export the completed profile as base64 for persistence. */
  async exportProfile(): Promise<string | null> {
    if (!this.profiler) return null;
    const profile = await this.profiler.export();
    return bytesToBase64(profile.bytes);
  }

  get minEnrollSamples(): number {
    return this.profiler?.minEnrollSamples ?? 16000;
  }

  async release() {
    try { await this.eagle?.release?.(); } catch { /* ignore */ }
    try { await this.profiler?.release?.(); } catch { /* ignore */ }
    this.eagle = null;
    this.profiler = null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
