// Vision: wraps @vladmandic/human to detect faces from the webcam, produce a
// face embedding (to recognize students on sight), read the student's emotion,
// and locate the nearest face (so Jarvis can look toward whoever's talking).
//
// Human is dynamically imported (it's large + browser-only) and typed loosely
// on purpose — we only touch a small, stable slice of its result shape.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface VisionFrame {
  faces: number;
  /** Nearest face center as a fraction of the video (0..1), or null. */
  nearest: { x: number; y: number } | null;
  /** 128-d embedding of the nearest/largest face, or null. */
  embedding: number[] | null;
  /** Dominant emotion label of the nearest face, or null. */
  emotion: string | null;
}

const MODEL_BASE =
  process.env.NEXT_PUBLIC_HUMAN_MODELS ||
  "https://cdn.jsdelivr.net/gh/vladmandic/human/models/";

export class Vision {
  private human: any = null;
  private running = false;
  private raf = 0;
  private latest: VisionFrame = { faces: 0, nearest: null, embedding: null, emotion: null };
  private onFrame?: (f: VisionFrame) => void;

  async load() {
    if (this.human) return;
    // Browser build resolves via the package's browser/import export conditions
    // (the stage is client-only, so the Node/tfjs-node build is never used).
    const { Human } = await import("@vladmandic/human");
    this.human = new Human({
      modelBasePath: MODEL_BASE,
      backend: "webgl",
      cacheSensitivity: 0.7,
      face: {
        enabled: true,
        detector: { rotation: false, maxDetected: 5 },
        mesh: { enabled: true },
        iris: { enabled: false },
        description: { enabled: true }, // provides the embedding
        emotion: { enabled: true },
        antispoof: { enabled: false },
        liveness: { enabled: false },
      },
      body: { enabled: false },
      hand: { enabled: false },
      object: { enabled: false },
      gesture: { enabled: false },
      filter: { enabled: true, equalization: false },
    });
    await this.human.load();
    await this.human.warmup();
  }

  start(video: HTMLVideoElement, onFrame: (f: VisionFrame) => void) {
    this.onFrame = onFrame;
    this.running = true;
    const loop = async () => {
      if (!this.running) return;
      try {
        if (this.human && video.readyState >= 2) {
          const res = await this.human.detect(video);
          this.latest = summarize(res, video);
          this.onFrame?.(this.latest);
        }
      } catch {
        /* transient detect error — keep looping */
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  get current() {
    return this.latest;
  }

  /** Cosine similarity between two embeddings (Human uses this metric). */
  similarity(a: number[], b: number[]): number {
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

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }
}

function summarize(res: any, video: HTMLVideoElement): VisionFrame {
  const faces: any[] = res?.face ?? [];
  if (!faces.length) return { faces: 0, nearest: null, embedding: null, emotion: null };
  // "nearest" ~= largest face box.
  let best = faces[0];
  let bestArea = 0;
  for (const f of faces) {
    const [, , w, h] = f.box ?? [0, 0, 0, 0];
    const area = w * h;
    if (area > bestArea) {
      bestArea = area;
      best = f;
    }
  }
  const vw = video.videoWidth || 1;
  const vh = video.videoHeight || 1;
  const [bx, by, bw, bh] = best.box ?? [0, 0, 0, 0];
  const cx = (bx + bw / 2) / vw;
  const cy = (by + bh / 2) / vh;
  const emotion =
    Array.isArray(best.emotion) && best.emotion.length
      ? [...best.emotion].sort((a, b) => b.score - a.score)[0]?.emotion ?? null
      : null;
  const embedding = Array.isArray(best.embedding) ? best.embedding : null;
  return { faces: faces.length, nearest: { x: cx, y: cy }, embedding, emotion };
}
