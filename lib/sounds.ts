// Pip's squawk sound effects. Preloads the two clips and plays them on
// interactions, with a small throttle so overlapping events don't spam.

export type SquawkName = "greet" | "surprise" | "random" | "speak";

const SRC = {
  greet: "/sounds/squawk-1.wav",
  surprise: "/sounds/squawk-2.wav",
} as const;

// squawk-2 is the shortest clip — Pip chirps it as a quick "speaking" flourish
// instead of literally saying the word "squawk" out loud.
const SHORTEST: keyof typeof SRC = "surprise";

class Sounds {
  private buffers: Partial<Record<keyof typeof SRC, HTMLAudioElement>> = {};
  private lastPlay = 0;
  private minGap = 450; // ms — avoid machine-gun squawks
  private enabled = true;

  /** Preload the clips (call once, after a user gesture). */
  init() {
    if (typeof window === "undefined") return;
    for (const [name, src] of Object.entries(SRC) as [keyof typeof SRC, string][]) {
      if (!this.buffers[name]) {
        const a = new Audio(src);
        a.preload = "auto";
        a.volume = 0.7;
        this.buffers[name] = a;
      }
    }
  }

  setEnabled(on: boolean) {
    this.enabled = on;
  }

  play(which: SquawkName = "random") {
    if (!this.enabled || typeof window === "undefined") return;
    const now = Date.now();
    if (now - this.lastPlay < this.minGap) return;
    this.lastPlay = now;

    const key: keyof typeof SRC =
      which === "random"
        ? (Math.random() < 0.5 ? "greet" : "surprise")
        : which === "speak"
        ? SHORTEST
        : which;
    const base = this.buffers[key];
    if (!base) {
      this.init();
      return;
    }
    // Clone so rapid plays don't cut each other off.
    const node = base.cloneNode(true) as HTMLAudioElement;
    node.volume = base.volume;
    void node.play().catch(() => {});
  }
}

export const sounds = new Sounds();
