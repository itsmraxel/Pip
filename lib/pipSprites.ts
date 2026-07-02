// Procedural scarlet-macaw parrot sprite sheet.
// Ported from the original vanilla `parrot-sprites.js`. The bird is drawn from
// every angle so it reads correctly while moving: full left/right profiles,
// front (toward viewer), back (away), and the four 3/4 views, plus a bank of
// expression / idle states used by the engine.
//
// Layout: 8 columns × 6 rows of 32px cells (256×192).
//   Row 0/1 = 8 directions, walk frame 0 (wings down) / frame 1 (wings up).
//   Row 2   = idle0, idle1, alert, preen0, preen1, preen2, tired, sleep0.
//   Row 3   = sleep1, peckN0, peckN1, peckS0, peckS1, peckE0, peckE1, peckW0.
//   Row 4   = peckW1, talk0, talk1, happy, love, excited, curious, unimpressed.
//   Row 5   = surprised, sad, sleepy, mischievous.

export const SPRITE_SIZE = 32;
export const SHEET_COLS = 8;
export const SHEET_ROWS = 6;

type Eye = "open" | "closed" | "wide" | "happy" | "heart" | "sad";
type Beak = "closed" | "open" | "smile";
type Crest = "flat" | "raised";
type Foot = "plant" | "hop" | "one" | "walkA" | "walkB";
type Wing = "down" | "up" | "preen";
type View = "R" | "front" | "back" | "frontR" | "backR";

interface ViewOpts {
  hop?: number;
  wing?: Wing;
  eye?: Eye;
  beak?: Beak;
  crest?: Crest;
  foot?: Foot;
  tuck?: boolean;
  blush?: boolean;
}

interface Cell {
  view: View;
  opts: ViewOpts;
  flip?: boolean;
}

let cachedUrl: string | null = null;

/** Build (once) the parrot sprite sheet and return it as a data URL. */
export function createParrotSpriteSheet(): string {
  if (cachedUrl) return cachedUrl;

  const SPRITE = SPRITE_SIZE;
  const COLS = SHEET_COLS;
  const ROWS = SHEET_ROWS;
  const canvas = document.createElement("canvas");
  canvas.width = SPRITE * COLS;
  canvas.height = SPRITE * ROWS;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.imageSmoothingEnabled = false;

  // Scarlet-macaw palette — warm red body, cream face patch, green+gold wing.
  const C = {
    red: "#d8502b",
    redD: "#b23c1d",
    redL: "#f07a3f",
    cream: "#f3e6c8",
    creamD: "#d9c59a",
    beak: "#eab945",
    beakL: "#f7d97a",
    beakD: "#c28a1f",
    green: "#4ea043",
    greenD: "#2f7a33",
    greenL: "#79c257",
    gold: "#e6b23c",
    goldD: "#c58f26",
    foot: "#e0a92e",
    footD: "#a9781c",
    eye: "#1a1a1a",
    shine: "#ffffff",
    heart: "#ff5a7a",
    blush: "#ff9aa8",
  };

  let FLIP = false;
  function px(x: number, y: number, color: string) {
    const fx = FLIP ? SPRITE - 1 - x : x;
    ctx!.fillStyle = color;
    ctx!.fillRect(fx, y, 1, 1);
  }
  function rect(x: number, y: number, w: number, h: number, color: string) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) px(x + dx, y + dy, color);
    }
  }

  // ---- Wing states (side profile, bird facing right) ----
  function wingFoldedR(y0: number) {
    rect(8, 12 + y0, 8, 4, C.green);
    rect(8, 12 + y0, 8, 1, C.greenL);
    rect(8, 15 + y0, 8, 1, C.greenD);
    rect(8, 16 + y0, 9, 5, C.gold);
    rect(9, 20 + y0, 7, 1, C.goldD);
    for (const fx of [11, 14]) {
      px(fx, 17 + y0, C.goldD);
      px(fx, 18 + y0, C.goldD);
      px(fx, 19 + y0, C.goldD);
    }
  }
  function wingUpR(y0: number) {
    rect(9, 6 + y0, 8, 4, C.green);
    rect(9, 6 + y0, 8, 1, C.greenL);
    rect(9, 9 + y0, 8, 1, C.greenD);
    rect(10, 10 + y0, 6, 2, C.gold);
    px(9, 10 + y0, C.goldD);
    px(16, 10 + y0, C.goldD);
  }

  // ---- Head detail (side profile, facing right) ----
  function headR(y0: number, opts: { eye?: Eye; beak?: Beak; crest?: Crest; blush?: boolean } = {}) {
    const { eye = "open", beak = "closed", crest = "flat", blush = false } = opts;
    rect(13, 3 + y0, 8, 2, C.red);
    rect(12, 5 + y0, 10, 3, C.red);
    rect(12, 8 + y0, 11, 4, C.red);
    rect(13, 3 + y0, 6, 1, C.redL);
    rect(12, 5 + y0, 1, 6, C.redD);

    if (crest === "raised") {
      px(14, 1 + y0, C.red);
      px(15, 1 + y0, C.redL);
      px(16, 2 + y0, C.red);
    }

    // cream face patch
    rect(17, 5 + y0, 5, 6, C.cream);
    px(16, 6 + y0, C.cream);
    px(16, 7 + y0, C.cream);
    px(21, 5 + y0, C.creamD);
    px(21, 10 + y0, C.creamD);

    if (blush) {
      px(17, 9 + y0, C.blush);
      px(18, 9 + y0, C.blush);
    }

    // eye
    if (eye === "closed") {
      rect(18, 8 + y0, 3, 1, C.eye);
    } else if (eye === "happy") {
      // upward-curved "^" happy eye
      px(18, 8 + y0, C.eye);
      px(19, 7 + y0, C.eye);
      px(20, 8 + y0, C.eye);
    } else if (eye === "heart") {
      px(18, 7 + y0, C.heart);
      px(20, 7 + y0, C.heart);
      rect(18, 8 + y0, 3, 1, C.heart);
      px(19, 9 + y0, C.heart);
    } else if (eye === "sad") {
      rect(18, 8 + y0, 3, 2, C.eye);
      px(18, 7 + y0, C.eye); // downcast brow
    } else {
      const ey = eye === "wide" ? 6 + y0 : 7 + y0;
      const eh = eye === "wide" ? 3 : 2;
      rect(18, ey, 3, eh, C.eye);
      px(20, ey, C.shine);
      if (eye === "wide") px(20, ey + 1, C.shine);
    }

    // beak (hooked, pointing right)
    rect(22, 6 + y0, 4, 2, C.beakL);
    rect(22, 8 + y0, 4, 2, C.beak);
    px(23, 7 + y0, C.beakD);
    if (beak === "open") {
      px(25, 10 + y0, C.beakD);
      rect(22, 12 + y0, 4, 1, C.beakD);
      px(25, 13 + y0, C.beakD);
    } else if (beak === "smile") {
      px(25, 10 + y0, C.beakD);
      rect(22, 10 + y0, 4, 1, C.beakD);
      px(21, 11 + y0, C.beakD); // slight upturn
    } else {
      px(25, 10 + y0, C.beakD);
      rect(22, 10 + y0, 3, 1, C.beakD);
    }
  }

  // ---- Feet ----
  function feet(y0: number, mode: Foot = "plant") {
    if (mode === "one") {
      px(13, 23 + y0, C.footD);
      rect(12, 24 + y0, 3, 1, C.foot);
      px(11, 25 + y0, C.footD);
      px(14, 25 + y0, C.footD);
      return;
    }
    // Two grounded contact poses that swap which leg is planted vs lifted,
    // so the legs visibly alternate while walking (a parrot waddle).
    if (mode === "walkA") {
      // near (left) leg planted forward
      px(11, 23 + y0, C.footD);
      rect(10, 24 + y0, 3, 1, C.foot);
      px(10, 25 + y0, C.footD);
      px(12, 25 + y0, C.footD);
      // far (right) leg lifted, swinging back
      px(16, 22 + y0, C.footD);
      rect(16, 23 + y0, 2, 1, C.foot);
      return;
    }
    if (mode === "walkB") {
      // near (left) leg lifted, swinging forward
      px(11, 22 + y0, C.footD);
      rect(10, 23 + y0, 2, 1, C.foot);
      // far (right) leg planted forward
      px(16, 23 + y0, C.footD);
      rect(15, 24 + y0, 3, 1, C.foot);
      px(15, 25 + y0, C.footD);
      px(17, 25 + y0, C.footD);
      return;
    }
    if (mode === "hop") {
      px(13, 23 + y0, C.footD);
      px(14, 23 + y0, C.footD);
      rect(12, 24 + y0, 4, 1, C.foot);
      px(12, 25 + y0, C.footD);
      px(15, 25 + y0, C.footD);
      return;
    }
    px(11, 23 + y0, C.footD);
    px(16, 23 + y0, C.footD);
    rect(10, 24 + y0, 3, 1, C.foot);
    rect(15, 24 + y0, 3, 1, C.foot);
    px(10, 25 + y0, C.footD);
    px(12, 25 + y0, C.footD);
    px(15, 25 + y0, C.footD);
    px(17, 25 + y0, C.footD);
  }

  function feetFront(y0: number, mode: Foot = "plant") {
    if (mode === "walkA") {
      // left leg planted
      px(12, 23 + y0, C.footD);
      rect(11, 24 + y0, 3, 1, C.foot);
      px(11, 25 + y0, C.footD);
      px(13, 25 + y0, C.footD);
      // right leg lifted
      px(19, 22 + y0, C.footD);
      rect(18, 23 + y0, 3, 1, C.foot);
      return;
    }
    if (mode === "walkB") {
      // left leg lifted
      px(12, 22 + y0, C.footD);
      rect(11, 23 + y0, 3, 1, C.foot);
      // right leg planted
      px(19, 23 + y0, C.footD);
      rect(18, 24 + y0, 3, 1, C.foot);
      px(18, 25 + y0, C.footD);
      px(20, 25 + y0, C.footD);
      return;
    }
    if (mode === "hop") {
      px(14, 23 + y0, C.footD);
      px(17, 23 + y0, C.footD);
      rect(13, 24 + y0, 2, 1, C.foot);
      rect(16, 24 + y0, 2, 1, C.foot);
      px(13, 25 + y0, C.footD);
      px(17, 25 + y0, C.footD);
      return;
    }
    px(12, 23 + y0, C.footD);
    px(19, 23 + y0, C.footD);
    rect(11, 24 + y0, 3, 1, C.foot);
    rect(18, 24 + y0, 3, 1, C.foot);
    px(11, 25 + y0, C.footD);
    px(13, 25 + y0, C.footD);
    px(18, 25 + y0, C.footD);
    px(20, 25 + y0, C.footD);
  }

  // =============== VIEWS ===============

  function viewR(o: ViewOpts = {}) {
    const y0 = o.hop || 0;
    const { wing = "down", eye = "open", beak = "closed", crest = "flat", foot = "plant", tuck = false, blush = false } = o;

    rect(4, 19 + y0, 5, 2, C.redD);
    rect(2, 20 + y0, 5, 2, C.green);
    px(1, 21 + y0, C.greenD);
    px(2, 22 + y0, C.greenD);

    rect(9, 11 + y0, 11, 10, C.red);
    rect(8, 13 + y0, 12, 6, C.red);
    rect(10, 21 + y0, 8, 2, C.red);
    rect(8, 13 + y0, 1, 6, C.redD);
    rect(15, 13 + y0, 5, 8, C.redL);
    rect(14, 20 + y0, 4, 2, C.redL);

    feet(y0, foot);

    if (wing === "up") wingUpR(y0);
    else wingFoldedR(y0);

    if (tuck) {
      rect(11, 8 + y0, 9, 4, C.red);
      rect(11, 8 + y0, 8, 1, C.redL);
      rect(13, 10 + y0, 4, 1, C.cream);
      rect(13, 10 + y0, 3, 1, C.eye);
    } else {
      headR(y0, { eye, beak, crest, blush });
    }

    if (wing === "preen") {
      px(13, 16 + y0, C.beakD);
      px(12, 17 + y0, C.beakD);
    }
  }

  function viewFront(o: ViewOpts = {}) {
    const y0 = o.hop || 0;
    const { wing = "down", beak = "closed", foot = "plant" } = o;

    rect(13, 22 + y0, 6, 2, C.redD);
    px(12, 23 + y0, C.green);
    px(19, 23 + y0, C.green);

    rect(9, 12 + y0, 14, 10, C.red);
    rect(10, 11 + y0, 12, 1, C.red);
    rect(6, 12 + y0, 4, 6, C.green);
    rect(22, 12 + y0, 4, 6, C.green);
    rect(6, 16 + y0, 4, 4, C.gold);
    rect(22, 16 + y0, 4, 4, C.gold);
    rect(6, 12 + y0, 4, 1, C.greenL);
    rect(22, 12 + y0, 4, 1, C.greenL);
    if (wing === "up") {
      rect(4, 9 + y0, 4, 4, C.green);
      rect(24, 9 + y0, 4, 4, C.green);
    }
    rect(12, 14 + y0, 8, 7, C.redL);

    rect(11, 4 + y0, 10, 8, C.red);
    rect(12, 3 + y0, 8, 1, C.red);
    rect(12, 4 + y0, 8, 1, C.redL);
    rect(11, 6 + y0, 3, 4, C.cream);
    rect(18, 6 + y0, 3, 4, C.cream);
    rect(12, 7 + y0, 2, 2, C.eye);
    rect(18, 7 + y0, 2, 2, C.eye);
    px(13, 7 + y0, C.shine);
    px(19, 7 + y0, C.shine);
    rect(15, 9 + y0, 2, 2, C.beakL);
    rect(15, 11 + y0, 2, 1, C.beak);
    px(15, 12 + y0, C.beakD);
    if (beak === "open") rect(15, 12 + y0, 2, 1, C.beakD);

    feetFront(y0, foot);
  }

  function viewBack(o: ViewOpts = {}) {
    const y0 = o.hop || 0;
    const { wing = "down", foot = "plant" } = o;

    rect(9, 12 + y0, 14, 10, C.red);
    rect(10, 11 + y0, 12, 1, C.red);
    rect(11, 13 + y0, 10, 7, C.redD);

    rect(7, 12 + y0, 5, 7, C.green);
    rect(20, 12 + y0, 5, 7, C.green);
    rect(7, 12 + y0, 5, 1, C.greenL);
    rect(20, 12 + y0, 5, 1, C.greenL);
    rect(7, 18 + y0, 5, 2, C.gold);
    rect(20, 18 + y0, 5, 2, C.gold);
    if (wing === "up") {
      rect(4, 9 + y0, 5, 4, C.green);
      rect(23, 9 + y0, 5, 4, C.green);
    }

    rect(13, 21 + y0, 6, 4, C.red);
    rect(14, 24 + y0, 4, 2, C.redD);
    px(15, 25 + y0, C.green);
    px(16, 25 + y0, C.green);

    rect(11, 4 + y0, 10, 8, C.red);
    rect(12, 3 + y0, 8, 1, C.red);
    rect(12, 5 + y0, 8, 2, C.redD);

    feetFront(y0, foot);
  }

  function viewFrontR(o: ViewOpts = {}) {
    const y0 = o.hop || 0;
    const { wing = "down", beak = "closed", foot = "plant" } = o;

    rect(6, 20 + y0, 5, 2, C.redD);
    rect(4, 21 + y0, 4, 1, C.green);

    rect(8, 12 + y0, 14, 10, C.red);
    rect(9, 11 + y0, 12, 1, C.red);
    rect(15, 13 + y0, 7, 8, C.redL);

    rect(6, 12 + y0, 4, 5, C.green);
    rect(6, 16 + y0, 4, 3, C.gold);
    rect(6, 12 + y0, 4, 1, C.greenL);
    if (wing === "up") rect(4, 9 + y0, 4, 4, C.green);

    rect(12, 4 + y0, 10, 8, C.red);
    rect(13, 3 + y0, 7, 1, C.red);
    rect(13, 4 + y0, 7, 1, C.redL);
    rect(18, 6 + y0, 3, 4, C.cream);
    rect(13, 6 + y0, 2, 4, C.cream); // far cheek patch (foreshortened by the head turn)
    rect(18, 7 + y0, 3, 2, C.eye);
    px(20, 7 + y0, C.shine);
    // far eye: smaller from perspective, but a real eye — row-aligned with the
    // near one and given its own catch-light so the face doesn't read lopsided.
    rect(13, 7 + y0, 2, 2, C.eye);
    px(14, 7 + y0, C.shine);
    rect(20, 9 + y0, 3, 2, C.beakL);
    rect(21, 11 + y0, 2, 1, C.beak);
    px(22, 12 + y0, C.beakD);
    if (beak === "open") rect(21, 12 + y0, 2, 1, C.beakD);

    feetFront(y0, foot);
  }

  function viewBackR(o: ViewOpts = {}) {
    const y0 = o.hop || 0;
    const { wing = "down", foot = "plant" } = o;

    rect(8, 12 + y0, 14, 10, C.red);
    rect(9, 11 + y0, 12, 1, C.red);
    rect(10, 13 + y0, 9, 7, C.redD);

    rect(6, 12 + y0, 5, 7, C.green);
    rect(19, 12 + y0, 4, 6, C.green);
    rect(6, 18 + y0, 5, 2, C.gold);
    rect(19, 17 + y0, 4, 2, C.gold);
    rect(6, 12 + y0, 5, 1, C.greenL);
    if (wing === "up") rect(3, 9 + y0, 5, 4, C.green);

    rect(9, 21 + y0, 5, 3, C.red);
    rect(8, 23 + y0, 4, 2, C.redD);
    px(9, 24 + y0, C.green);

    rect(12, 4 + y0, 10, 8, C.red);
    rect(13, 3 + y0, 7, 1, C.red);
    rect(12, 5 + y0, 7, 2, C.redD);
    px(21, 8 + y0, C.cream);
    px(22, 9 + y0, C.beak);

    feetFront(y0, foot);
  }

  function draw(view: View, opts: ViewOpts = {}, flip = false) {
    FLIP = flip;
    switch (view) {
      case "R": return viewR(opts);
      case "front": return viewFront(opts);
      case "back": return viewBack(opts);
      case "frontR": return viewFrontR(opts);
      case "backR": return viewBackR(opts);
      default: return viewR(opts);
    }
  }

  const cells: Record<string, Cell> = {
    // direction, walk frame 0 — left leg planted, right leg lifted
    "0,0": { view: "R", opts: { wing: "down", foot: "walkA" } }, // E
    "1,0": { view: "frontR", opts: { wing: "down", foot: "walkA" } }, // SE
    "2,0": { view: "front", opts: { wing: "down", foot: "walkA" } }, // S
    "3,0": { view: "frontR", opts: { wing: "down", foot: "walkA" }, flip: true }, // SW
    "4,0": { view: "R", opts: { wing: "down", foot: "walkA" }, flip: true }, // W
    "5,0": { view: "backR", opts: { wing: "down", foot: "walkA" }, flip: true }, // NW
    "6,0": { view: "back", opts: { wing: "down", foot: "walkA" } }, // N
    "7,0": { view: "backR", opts: { wing: "down", foot: "walkA" } }, // NE

    // direction, walk frame 1 — legs swap (right planted, left lifted); body
    // stays grounded (no hop bounce) so it reads as a waddle, not a hop.
    "0,1": { view: "R", opts: { wing: "down", foot: "walkB" } },
    "1,1": { view: "frontR", opts: { wing: "down", foot: "walkB" } },
    "2,1": { view: "front", opts: { wing: "down", foot: "walkB" } },
    "3,1": { view: "frontR", opts: { wing: "down", foot: "walkB" }, flip: true },
    "4,1": { view: "R", opts: { wing: "down", foot: "walkB" }, flip: true },
    "5,1": { view: "backR", opts: { wing: "down", foot: "walkB" }, flip: true },
    "6,1": { view: "back", opts: { wing: "down", foot: "walkB" } },
    "7,1": { view: "backR", opts: { wing: "down", foot: "walkB" } },

    // idle / states
    "0,2": { view: "R", opts: { wing: "down" } }, // idle0
    "1,2": { view: "R", opts: { wing: "down", eye: "closed" } }, // idle1 (blink)
    "2,2": { view: "R", opts: { wing: "down", crest: "raised", eye: "wide" } }, // alert
    "3,2": { view: "R", opts: { wing: "preen" } }, // preen0
    "4,2": { view: "R", opts: { wing: "preen", eye: "closed", hop: 1 } }, // preen1
    "5,2": { view: "R", opts: { wing: "preen" } }, // preen2
    "6,2": { view: "R", opts: { wing: "down", foot: "one", eye: "closed" } }, // tired
    "7,2": { view: "R", opts: { wing: "down", tuck: true } }, // sleep0

    "0,3": { view: "R", opts: { wing: "down", tuck: true, hop: 1 } }, // sleep1
    "1,3": { view: "back", opts: { wing: "down" } }, // peckN0
    "2,3": { view: "back", opts: { wing: "up", hop: 1, foot: "hop" } }, // peckN1
    "3,3": { view: "front", opts: { wing: "down", beak: "open" } }, // peckS0
    "4,3": { view: "front", opts: { wing: "down", beak: "open", hop: 1, foot: "hop" } }, // peckS1
    "5,3": { view: "R", opts: { wing: "down", beak: "open" } }, // peckE0
    "6,3": { view: "R", opts: { wing: "down", beak: "open", hop: 1, foot: "hop" } }, // peckE1
    "7,3": { view: "R", opts: { wing: "down", beak: "open" }, flip: true }, // peckW0

    "0,4": { view: "R", opts: { wing: "down", beak: "open", hop: 1, foot: "hop" }, flip: true }, // peckW1

    // ---- expression bank (side profile) ----
    "1,4": { view: "R", opts: { wing: "down", beak: "open" } }, // talk0 (beak open)
    "2,4": { view: "R", opts: { wing: "down", beak: "closed", hop: 1 } }, // talk1 (beak closed, bob)
    "3,4": { view: "R", opts: { wing: "down", eye: "happy", beak: "smile" } }, // happy
    "4,4": { view: "R", opts: { wing: "down", eye: "heart", beak: "smile", blush: true } }, // love
    "5,4": { view: "R", opts: { wing: "up", eye: "wide", beak: "open", crest: "raised", hop: 2 } }, // excited
    "6,4": { view: "R", opts: { wing: "down", eye: "wide", crest: "raised" } }, // curious
    "7,4": { view: "R", opts: { wing: "down", eye: "closed", beak: "closed" } }, // unimpressed

    "0,5": { view: "R", opts: { wing: "up", eye: "wide", beak: "open", crest: "raised" } }, // surprised
    "1,5": { view: "R", opts: { wing: "down", eye: "sad", beak: "closed" } }, // sad
    "2,5": { view: "R", opts: { wing: "down", eye: "closed", foot: "one" } }, // sleepy
    "3,5": { view: "R", opts: { wing: "down", eye: "happy", beak: "open" } }, // mischievous
  };

  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cell = cells[`${col},${row}`];
      if (!cell) continue;
      ctx.save();
      ctx.translate(col * SPRITE, row * SPRITE);
      ctx.clearRect(0, 0, SPRITE, SPRITE);
      draw(cell.view, cell.opts, cell.flip ?? false);
      ctx.restore();
    }
  }

  cachedUrl = canvas.toDataURL("image/png");
  return cachedUrl;
}
