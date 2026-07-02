// Jarvis's animation engine — an imperative, framework-agnostic controller that
// renders the parrot (a DOM element backed by the procedural sprite sheet),
// runs the animation loop, and exposes methods the React app drives:
//   setCursor / lookAt / setTarget  — where Jarvis looks and hops
//   setExpression / react           — facial expressions + emote overlays
//   setSpeaking / setListening      — talking + attentive poses
//   speak / setBubble / hideBubble  — the on-Jarvis speech text
//
// Movement is direct steering toward a target (no page-obstacle pathfinding —
// Jarvis lives on a full-screen stage now). The 8-direction sprite selection,
// hop cadence, and idle behaviours are carried over from the original oneparrot.

import { SHEET_COLS, SHEET_ROWS, SPRITE_SIZE, createParrotSpriteSheet } from "./jarvisSprites";

export type Expression =
  | "neutral"
  | "happy"
  | "love"
  | "excited"
  | "curious"
  | "unimpressed"
  | "surprised"
  | "sad"
  | "sleepy"
  | "mischievous";

export type EmoteType = "love" | "surprise" | "sleep" | "music" | "annoyed" | "sparkle" | "question" | "happy";

export type Mood = "cheerful" | "neutral" | "grumpy" | "sleepy";

const EMOTE_GLYPH: Record<EmoteType, string> = {
  love: "💗",
  surprise: "❗",
  sleep: "💤",
  music: "🎵",
  annoyed: "💢",
  sparkle: "✨",
  question: "❓",
  happy: "😄",
};

// [col, row] into the sprite sheet (see jarvisSprites.ts for the layout).
const SPRITE_SETS: Record<string, [number, number][]> = {
  E: [[0, 0], [0, 1]],
  SE: [[1, 0], [1, 1]],
  S: [[2, 0], [2, 1]],
  SW: [[3, 0], [3, 1]],
  W: [[4, 0], [4, 1]],
  NW: [[5, 0], [5, 1]],
  N: [[6, 0], [6, 1]],
  NE: [[7, 0], [7, 1]],

  idle: [[0, 2], [1, 2]],
  alert: [[2, 2]],
  preening: [[3, 2], [4, 2], [5, 2]],
  tired: [[6, 2]],
  sleeping: [[7, 2], [0, 3]],

  talk: [[1, 4], [2, 4]],
  happy: [[3, 4]],
  love: [[4, 4]],
  excited: [[5, 4]],
  curious: [[6, 4]],
  unimpressed: [[7, 4]],
  surprised: [[0, 5]],
  sad: [[1, 5]],
  sleepy: [[2, 5]],
  mischievous: [[3, 5]],
  neutral: [[0, 2]],
};

const DIRECTION_BANDS: { min: number; max: number; dir: string }[] = [
  { min: -22.5, max: 22.5, dir: "E" },
  { min: 22.5, max: 67.5, dir: "SE" },
  { min: 67.5, max: 112.5, dir: "S" },
  { min: 112.5, max: 157.5, dir: "SW" },
  { min: -157.5, max: -112.5, dir: "NW" },
  { min: -112.5, max: -67.5, dir: "N" },
  { min: -67.5, max: -22.5, dir: "NE" },
];

function vectorToDirection(dx: number, dy: number): string | null {
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  const deg = (180 / Math.PI) * Math.atan2(dy, dx);
  if (deg >= 157.5 || deg < -157.5) return "W";
  for (const band of DIRECTION_BANDS) {
    if (deg >= band.min && deg < band.max) return band.dir;
  }
  return "E";
}

export interface JarvisOptions {
  scale?: number;
  speed?: number;
  zIndex?: number;
  onPoke?: () => void;
  onHoverStart?: () => void;
}

export class JarvisController {
  private opts: Required<Omit<JarvisOptions, "onPoke" | "onHoverStart">> & Pick<JarvisOptions, "onPoke" | "onHoverStart">;
  private disp: number;
  private half: number;
  private sheetW: number;
  private sheetH: number;

  private el!: HTMLDivElement;
  private bubble!: HTMLDivElement;
  private bubbleText!: HTMLDivElement;
  private emoteLayer!: HTMLDivElement;
  private container: HTMLElement | null = null;

  private rafId = 0;
  private lastTs = 0;
  private frame = 0;

  private posX = 0;
  private posY = 0;
  private velX = 0;
  private velY = 0;

  private cursor: { x: number; y: number } | null = null;
  private gaze: { x: number; y: number } | null = null;
  private target: { x: number; y: number } | null = null;
  private followCursor = false;
  /** A person to track with body + gaze (container-local coords). */
  private follow: { x: number; y: number } | null = null;

  private idleTime = 0;
  private idleAnimation: string | null = null;
  private idleAnimationFrame = 0;
  // Distance-accumulator for the walk gait so foot pose follows ground travel
  // (not the wall clock), and which of the two contact poses is showing.
  private stride = 0;
  private walkStep = 0;

  private expression: Expression | null = null;
  private expressionUntil = 0;
  private speaking = false;
  private listening = false;
  private thinking = false;
  private speakPulse = 0;
  private mood: Mood = "cheerful";

  private bubbleVisible = false;
  private wasHovering = false;
  private lastPokeTs = 0;

  constructor(options: JarvisOptions = {}) {
    const scale = options.scale ?? 2.5;
    this.opts = {
      scale,
      speed: options.speed ?? 9,
      zIndex: options.zIndex ?? 40,
      onPoke: options.onPoke,
      onHoverStart: options.onHoverStart,
    };
    this.disp = Math.round(SPRITE_SIZE * scale);
    this.half = this.disp / 2;
    this.sheetW = SPRITE_SIZE * SHEET_COLS * scale;
    this.sheetH = SPRITE_SIZE * SHEET_ROWS * scale;
  }

  mount(container: HTMLElement) {
    this.container = container;
    const spriteUrl = createParrotSpriteSheet();

    const rect = container.getBoundingClientRect();
    this.posX = rect.width / 2;
    this.posY = rect.height / 2;

    const el = document.createElement("div");
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = [
      `width:${this.disp}px`,
      `height:${this.disp}px`,
      "position:absolute",
      "pointer-events:none",
      "image-rendering:pixelated",
      `left:${this.posX - this.half}px`,
      `top:${this.posY - this.half}px`,
      `z-index:${this.opts.zIndex}`,
      `background-image:url(${spriteUrl})`,
      `background-size:${this.sheetW}px ${this.sheetH}px`,
      "background-repeat:no-repeat",
      "will-change:left,top,transform",
      "transition:transform 0.1s ease-out",
    ].join(";");
    this.el = el;

    const bubble = document.createElement("div");
    bubble.style.cssText = `position:absolute;pointer-events:none;z-index:${this.opts.zIndex + 1};opacity:0;transition:opacity .25s ease;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center`;
    const bubbleText = document.createElement("div");
    bubbleText.style.cssText =
      "padding:8px 13px;border-radius:14px;font-size:15px;line-height:1.4;font-family:var(--font-geist-sans),ui-sans-serif,system-ui,sans-serif;color:#1a1a1a;background:#fff;border:2px solid #1a1a1a;max-width:280px;width:max-content;white-space:normal;word-break:break-word;box-shadow:0 4px 14px rgba(0,0,0,.25)";
    const tail = document.createElement("div");
    tail.style.cssText =
      "width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:9px solid #1a1a1a;margin-top:-1px";
    bubble.append(bubbleText, tail);
    this.bubble = bubble;
    this.bubbleText = bubbleText;

    const emoteLayer = document.createElement("div");
    emoteLayer.style.cssText = `position:absolute;inset:0;pointer-events:none;z-index:${this.opts.zIndex + 2};overflow:hidden`;
    this.emoteLayer = emoteLayer;

    container.append(el, bubble, emoteLayer);
    this.setSprite("idle", 0);

    document.addEventListener("click", this.onDocClick);
    this.rafId = requestAnimationFrame(this.tick);
  }

  destroy() {
    document.removeEventListener("click", this.onDocClick);
    cancelAnimationFrame(this.rafId);
    this.el?.remove();
    this.bubble?.remove();
    this.emoteLayer?.remove();
  }

  // ---- public control API ----

  /** Cursor position in container-local coordinates (or null when off-stage). */
  setCursor(x: number | null, y = 0) {
    this.cursor = x === null ? null : { x, y };
  }

  setFollowCursor(on: boolean) {
    this.followCursor = on;
  }

  /** Where Jarvis should look (e.g. the nearest face), in container-local coords. */
  lookAt(x: number | null, y = 0) {
    this.gaze = x === null ? null : { x, y };
  }

  /**
   * The person Jarvis should actively follow (container-local coords). Jarvis hops to
   * track their horizontal position and keeps facing the viewer, leaning toward
   * whichever side they're on. Pass null when no one is visible.
   */
  setFollow(x: number | null, y = 0) {
    if (x === null) {
      this.follow = null;
      return;
    }
    this.follow = { x, y };
    this.idleAnimation = null;
    this.idleTime = 0;
  }

  /** Where Jarvis should hop toward, in container-local coords. */
  setTarget(x: number | null, y = 0) {
    this.target = x === null ? null : { x, y };
  }

  /** Small room-scanning movement for no-face ambient behavior. */
  lookAround() {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    this.follow = null;
    this.target = {
      x: rect.width * (0.25 + Math.random() * 0.5),
      y: rect.height * (0.45 + Math.random() * 0.25),
    };
    this.gaze = {
      x: rect.width * (0.15 + Math.random() * 0.7),
      y: rect.height * (0.2 + Math.random() * 0.35),
    };
    this.idleAnimation = Math.random() < 0.45 ? "preening" : null;
    this.idleAnimationFrame = 0;
    this.idleTime = 0;
  }

  /** Let Jarvis settle into a sleepy visible idle when the room is empty. */
  nap() {
    this.follow = null;
    this.target = null;
    this.gaze = null;
    this.mood = "sleepy";
    this.idleAnimation = "sleeping";
    this.idleAnimationFrame = 0;
    this.setExpression("sleepy", 5000);
  }

  setExpression(expr: Expression | null, ms = 2600) {
    this.expression = expr;
    this.expressionUntil = expr ? performance.now() + ms : 0;
    if (expr && expr !== "sleepy" && expr !== "sad") {
      this.idleAnimation = null;
      this.idleTime = 0;
    }
  }

  setSpeaking(on: boolean) {
    this.speaking = on;
    if (on) {
      this.idleAnimation = null;
      this.idleTime = 0;
      this.thinking = false;
    } else {
      this.speakPulse = 0;
    }
  }

  setListening(on: boolean) {
    this.listening = on;
    if (on) {
      this.idleAnimation = null;
      this.idleTime = 0;
      this.thinking = false;
    }
  }

  setThinking(on: boolean) {
    this.thinking = on;
    if (on) {
      this.idleAnimation = null;
      this.idleTime = 0;
    }
  }

  /** Bump beak animation on each audio chunk for livelier speech. */
  speakingPulse() {
    if (this.speaking) this.speakPulse += 1;
  }

  setMood(mood: Mood) {
    this.mood = mood;
  }

  /** Fire a quick reaction: floating emote (+ optional expression + little hop). */
  react(emote: EmoteType, expr?: Expression, ms = 2200) {
    this.spawnEmote(emote);
    if (expr) this.setExpression(expr, ms);
    // small excited hop
    this.el.style.transform = "translateY(-6px)";
    window.setTimeout(() => {
      if (this.el) this.el.style.transform = "";
    }, 140);
  }

  setBubble(text: string) {
    if (!text) {
      this.hideBubble();
      return;
    }
    this.bubbleText.textContent = text;
    this.bubbleVisible = true;
    this.bubble.style.opacity = "1";
  }

  /** Convenience: show text + talk animation for its duration handled by caller. */
  speak(text: string) {
    this.setBubble(text);
  }

  hideBubble() {
    this.bubbleVisible = false;
    this.bubble.style.opacity = "0";
  }

  // ---- internals ----

  private setSprite(name: string, frame: number) {
    const set = SPRITE_SETS[name];
    if (!set?.length) return;
    const [col, row] = set[frame % set.length];
    this.el.style.backgroundPosition = `${-col * this.disp}px ${-row * this.disp}px`;
  }

  private spawnEmote(type: EmoteType) {
    const glyph = document.createElement("div");
    glyph.textContent = EMOTE_GLYPH[type];
    const startLeft = this.posX + (Math.random() * 20 - 10);
    const startTop = this.posY - this.half - 4;
    glyph.style.cssText = [
      "position:absolute",
      `left:${startLeft}px`,
      `top:${startTop}px`,
      "font-size:22px",
      "transform:translate(-50%,-50%)",
      "transition:transform 1.1s ease-out, opacity 1.1s ease-out",
      "opacity:1",
    ].join(";");
    this.emoteLayer.append(glyph);
    requestAnimationFrame(() => {
      glyph.style.transform = `translate(-50%,-50%) translateY(-46px) rotate(${Math.random() * 30 - 15}deg)`;
      glyph.style.opacity = "0";
    });
    window.setTimeout(() => glyph.remove(), 1200);
  }

  private updateBubblePosition() {
    const bubbleH = (this.bubbleText.offsetHeight || 32) + 12;
    const flipBelow = this.posY - this.half - bubbleH < 6;
    const top = flipBelow ? this.posY + this.half + 8 : this.posY - this.half - bubbleH;
    this.bubble.style.left = `${Math.round(this.posX)}px`;
    this.bubble.style.top = `${Math.round(top)}px`;
  }

  private onDocClick = (e: MouseEvent) => {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (Math.hypot(x - this.posX, y - this.posY) < this.half + 6) {
      const now = performance.now();
      if (now - this.lastPokeTs > 400) {
        this.lastPokeTs = now;
        this.opts.onPoke?.();
      }
    }
  };

  private applyPosition() {
    this.el.style.left = `${Math.round(this.posX - this.half)}px`;
    this.el.style.top = `${Math.round(this.posY - this.half)}px`;
  }

  private moveToward(tx: number, ty: number) {
    const dx = tx - this.posX;
    const dy = ty - this.posY;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) {
      this.velX *= 0.5;
      this.velY *= 0.5;
      this.stride = 0;
      return false;
    }
    const maxSpeed = this.opts.speed;
    this.velX += ((dx / dist) * maxSpeed - this.velX) * 0.3;
    this.velY += ((dy / dist) * maxSpeed - this.velY) * 0.3;
    const vel = Math.hypot(this.velX, this.velY);
    const cap = maxSpeed * 1.5;
    if (vel > cap) {
      this.velX = (this.velX / vel) * cap;
      this.velY = (this.velY / vel) * cap;
    }
    const prevX = this.posX;
    const prevY = this.posY;
    this.posX += this.velX;
    this.posY += this.velY;
    this.clampToStage();
    this.applyPosition();
    // Take one step (swap the planted leg) every STRIDE_PX of ground covered,
    // so the gait speeds up/slows down with Jarvis and the feet don't slide or
    // freeze. No injected idle frame, no body hop.
    const moved = Math.hypot(this.posX - prevX, this.posY - prevY);
    this.stride += moved;
    const STRIDE_PX = 8;
    if (this.stride >= STRIDE_PX) {
      this.stride -= STRIDE_PX;
      this.walkStep ^= 1;
    }
    const dir = vectorToDirection(this.velX, this.velY) ?? "S";
    this.setSprite(dir, this.walkStep);
    return true;
  }

  private clampToStage() {
    if (!this.container) return;
    const rect = this.container.getBoundingClientRect();
    this.posX = Math.max(this.half, Math.min(rect.width - this.half, this.posX));
    this.posY = Math.max(this.half, Math.min(rect.height - this.half, this.posY));
  }

  private faceGaze() {
    const point = this.gaze ?? this.cursor;
    if (!point) {
      this.setSprite("idle", this.frame);
      return;
    }
    const dir = vectorToDirection(point.x - this.posX, point.y - this.posY);
    this.setSprite(dir ?? "idle", 0);
  }

  private maybeStartIdle() {
    if (this.idleAnimation != null || this.idleTime < 24 || Math.random() >= 0.1) return;
    this.idleAnimationFrame = 0;
    if (this.mood === "sleepy" || this.idleTime > 120) {
      this.idleAnimation = "sleeping";
      return;
    }
    const options = this.mood === "grumpy" ? ["tired", "preening"] : ["preening", "tired"];
    this.idleAnimation = options[Math.floor(Math.random() * options.length)];
  }

  private playIdle(): boolean {
    if (!this.idleAnimation) return false;
    const set = SPRITE_SETS[this.idleAnimation];
    const durations: Record<string, number> = { sleeping: 80, preening: 24, tired: 40 };
    const duration = durations[this.idleAnimation] ?? (set ? set.length * 8 : 8);
    const frameLen = Math.max(1, Math.floor(duration / (set?.length || 1)));
    this.setSprite(this.idleAnimation, Math.floor(this.idleAnimationFrame / frameLen));
    this.idleAnimationFrame += 1;
    if (this.idleAnimationFrame >= duration && this.idleAnimation !== "sleeping") {
      this.idleAnimation = null;
      this.idleAnimationFrame = 0;
    }
    return true;
  }

  /**
   * Track the followed person: hop to line up horizontally, then settle facing
   * the viewer, leaning toward the side they're on so eyes + body follow them.
   */
  private doFollow(): boolean {
    if (!this.follow || !this.container) return false;
    const height = this.container.getBoundingClientRect().height;
    const perchY = height * 0.62; // a comfortable perch line; body stays front-on
    const fx = this.follow.x;
    const dx = fx - this.posX;
    const dy = perchY - this.posY;

    // Far off — hop to catch up (movement sprite faces travel direction).
    if (Math.abs(dx) > 80 || Math.abs(dy) > 70) {
      this.moveToward(fx, perchY);
      return true;
    }

    // Settled — ease onto the perch line and face the viewer, leaning toward them.
    this.velX *= 0.5;
    this.velY *= 0.5;
    this.posY += dy * 0.12;
    this.applyPosition();
    if (this.frame % 30 === 0) {
      this.setSprite("idle", 1); // occasional blink
    } else {
      const lean = dx < -22 ? "SW" : dx > 22 ? "SE" : "S";
      this.setSprite(lean, 0);
    }
    return true;
  }

  private detectHover() {
    const point = this.cursor;
    if (!point) {
      this.wasHovering = false;
      return;
    }
    const hovering = Math.hypot(point.x - this.posX, point.y - this.posY) < this.half + 10;
    if (hovering && !this.wasHovering) {
      this.wasHovering = true;
      this.opts.onHoverStart?.();
    } else if (!hovering) {
      this.wasHovering = false;
    }
  }

  private tick = (ts: number) => {
    this.rafId = requestAnimationFrame(this.tick);
    if (!this.lastTs) this.lastTs = ts;
    if (ts - this.lastTs < 90) return;
    this.lastTs = ts;
    this.frame += 1;

    this.detectHover();
    this.updateBubblePosition();

    // Priority 1: talking wins the beak animation, keeps a face if set.
    if (this.speaking) {
      if (this.expression && this.frame % 4 === 0) {
        this.setSprite(this.expression, 0);
      } else {
        this.setSprite("talk", this.speakPulse + this.frame);
      }
      this.idleTime = 0;
      return;
    }

    // Priority 2: thinking — curious blink while the brain works.
    if (this.thinking) {
      if (this.frame % 4 === 0) {
        this.setSprite("curious", 0);
      } else if (this.frame % 8 === 2) {
        this.setSprite("idle", 1);
      } else {
        this.setSprite("alert", 0);
      }
      this.idleTime = 0;
      return;
    }

    // Priority 3: an explicit expression is showing.
    if (this.expression && performance.now() < this.expressionUntil) {
      this.setSprite(this.expression, this.frame);
      this.idleTime = 0;
      return;
    } else if (this.expression && performance.now() >= this.expressionUntil) {
      this.expression = null;
    }

    // Priority 3: actively follow the person the camera sees.
    if (this.follow) {
      this.idleTime = 0;
      this.doFollow();
      return;
    }

    // Priority 4: move toward an explicit target, else follow cursor if enabled.
    const moveTarget = this.target ?? (this.followCursor ? this.cursor : null);
    if (moveTarget) {
      const dist = Math.hypot(moveTarget.x - this.posX, moveTarget.y - this.posY);
      if (dist > 48) {
        this.idleTime = 0;
        this.moveToward(moveTarget.x, moveTarget.y);
        return;
      }
      // arrived — clear one-shot target
      if (this.target && dist <= 48) this.target = null;
    }

    // Priority 4: attentive listening — crest up, lean toward the speaker.
    if (this.listening) {
      if (this.frame % 6 === 0) {
        this.setSprite("alert", 0);
      } else {
        this.faceGaze();
      }
      this.idleTime = 0;
      return;
    }

    // Priority 5: idle life — gaze around, blink, occasionally preen/nap.
    this.idleTime += 1;
    if (this.playIdle()) return;
    this.maybeStartIdle();
    this.faceGaze();
  };
}
