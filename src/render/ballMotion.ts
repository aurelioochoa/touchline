// Where to DRAW the ball, between two simulation ticks.
//
// The engine moves the ball ten times a second. Drawn straight from the state — which is
// what the renderer did — a pass at 15 m/s jumps a metre and a half every tenth of a second:
// a smooth sixty-frame picture of twenty-five interpolated figures, and one ball stepping
// through it like a slideshow. The figures had been interpolated for months; the one object
// every eye on the screen is following had not.
//
// Three things fix it, and this module is all three:
//
// 1. FLIGHT is a cubic Hermite between the last two ticks, using each tick's velocity as
//    its tangent. Hermite reproduces a quadratic exactly, so a ball in the air draws the
//    true parabola between ticks instead of a polyline, and a rolling ball decelerates
//    smoothly instead of in steps.
// 2. A CARRIED ball is not interpolated at all: it is placed off the carrier's own
//    interpolated feet every frame, with a touch rhythm on his stride — knocked ahead,
//    run onto, knocked again — and whatever trick he is doing on top.
// 3. Every change of mode (a pass leaving the foot, a first touch, a tackle) is bridged by
//    a SPRING: the difference between where the ball was drawn and where it now belongs is
//    kept as an offset that decays in a fraction of a second. So nothing snaps — except a
//    genuine teleport (the ball placed for a goal kick), which is exactly when it should.
//
// It also holds a struck ball on the boot until the kick animation reaches it. The engine
// launches the ball on the tick it decides to pass; the animation takes a sixth of a
// second to swing the leg. Without the hold the ball leaves before the foot arrives.
//
// Pure apart from its own memory: no Three.js, so ballMotion.test.ts can drive it.

import { clamp, clamp01, TAU } from '../core/math.js';

/** One tick's worth of the ball. */
export interface BallSnap {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  owner: number;
}

/** What the renderer knows about the player the ball is at, this frame. */
export interface Carrier {
  id: number;
  /** Interpolated position and facing, sim coordinates. */
  x: number;
  y: number;
  facing: number;
  vx: number;
  vy: number;
  /** Stride phase, radians, and which foot he favours (0 | 1). */
  phase: number;
  foot: 0 | 1;
  /** A trick's ball offset, already in sim coordinates (metres), or zeros. */
  trickX: number;
  trickY: number;
  trickZ: number;
  /** 0..1: how much of the dribbling touch rhythm to use. Zero while a kick is winding up. */
  touch: number;
  /**
   * 0..1: how far the ball is drawn in from its running distance to right at his feet. At
   * a sprint the engine carries it a metre ahead, which is right for running with it and
   * wrong for a trick — a stepover a metre behind the ball is a man dancing on his own.
   */
  gather: number;
}

/** What the renderer draws: a position, and the velocity the ball's spin and trail read. */
export interface BallDraw {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

/** Beyond this, a change between ticks is a placement rather than a movement: snap. */
const TELEPORT = 6;
/** Beyond this, a spring offset is not worth easing out — the ball was moved, not played. */
const SPRING_MAX = 5;
/** How fast a mode change is eased out, per second. Faster off the boot than into it. */
const SPRING_RATE = 11;
const RELEASE_RATE = 17;
/** The hold is abandoned if the real ball has already got this far from the boot. */
const HOLD_SLACK = 4;

function snap(): BallSnap {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, owner: -1 };
}

/**
 * Where a carried ball sits, off a carrier. The same `0.45 + 0.075 × speed` the engine
 * glues it at (engine.ts, #ballPhase), so the carried ball and the ball that leaves the
 * foot agree about where it was — plus a stride-locked touch rhythm on top.
 */
export function carryPoint(out: BallDraw, c: Carrier): BallDraw {
  const speed = Math.hypot(c.vx, c.vy);
  const ahead = lerpN(0.45 + speed * 0.075, 0.3, clamp01(c.gather));
  // One touch per stride cycle, on the favoured foot's swing. The shape is a quick knock
  // forward and a long roll back as he runs onto it; its mean is zero, so on average the
  // ball is exactly where the engine thinks it is.
  const amp = clamp((speed - 1) * 0.08, 0, 0.5) * clamp01(c.touch);
  const u0 = c.foot === 0 ? 0.55 : 0.05;
  let v = c.phase / TAU - u0;
  v -= Math.floor(v);
  const g = v < 0.14 ? smoothUnit(v / 0.14) : 1 - smoothUnit((v - 0.14) / 0.86);
  const fwd = ahead + amp * (g - 0.5);
  // A little toward the dribbling foot: nobody carries a ball on their centre line.
  const side = (c.foot === 0 ? -1 : 1) * 0.07 * clamp01(speed / 3);
  const cf = Math.cos(c.facing);
  const sf = Math.sin(c.facing);
  out.x = c.x + cf * fwd + sf * side + c.trickX;
  out.y = c.y + sf * fwd - cf * side + c.trickY;
  out.z = Math.max(0, c.trickZ);
  // The rhythm's own speed is left out on purpose: it is a few tenths of a metre a second,
  // and the trail reading it would flicker on every touch.
  out.vx = c.vx;
  out.vy = c.vy;
  out.vz = 0;
  return out;
}

/**
 * Cubic Hermite between two ticks, `a` in 0..1, `T` the tick length. Falls back to a
 * straight line when a tangent disagrees wildly with the chord — which is what a bounce, a
 * deflection or a placement looks like from the outside.
 */
export function hermite(out: BallDraw, p: BallSnap, q: BallSnap, a: number, T: number): BallDraw {
  const t = clamp01(a);
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const chord = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z);
  const m0 = Math.hypot(p.vx, p.vy, p.vz) * T;
  const m1 = Math.hypot(q.vx, q.vy, q.vz) * T;
  const sane = m0 <= chord * 2.2 + 0.25 && m1 <= chord * 2.2 + 0.25;
  if (!sane) {
    out.x = p.x + (q.x - p.x) * t;
    out.y = p.y + (q.y - p.y) * t;
    out.z = Math.max(0, p.z + (q.z - p.z) * t);
    out.vx = (q.x - p.x) / T;
    out.vy = (q.y - p.y) / T;
    out.vz = (q.z - p.z) / T;
    return out;
  }
  out.x = h00 * p.x + h10 * p.vx * T + h01 * q.x + h11 * q.vx * T;
  out.y = h00 * p.y + h10 * p.vy * T + h01 * q.y + h11 * q.vy * T;
  // Clamped: across a bounce the two tangents point opposite ways and the curve dips just
  // under the grass for an instant. The clamp is that instant spent on the ground.
  out.z = Math.max(0, h00 * p.z + h10 * p.vz * T + h01 * q.z + h11 * q.vz * T);
  // The derivative, for the ball's spin and its trail.
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  const d11 = 3 * t2 - 2 * t;
  out.vx = (d00 * p.x + d01 * q.x) / T + d10 * p.vx + d11 * q.vx;
  out.vy = (d00 * p.y + d01 * q.y) / T + d10 * p.vy + d11 * q.vy;
  out.vz = (d00 * p.z + d01 * q.z) / T + d10 * p.vz + d11 * q.vz;
  return out;
}

type Mode = { kind: 'free' } | { kind: 'carried'; id: number };

export class BallMotion {
  readonly prev: BallSnap = snap();
  readonly curr: BallSnap = snap();
  readonly #T: number;
  #primed = false;
  /** The spring: drawn position minus where the ball belongs. Decays to zero. */
  #offX = 0;
  #offY = 0;
  #offZ = 0;
  #rate = SPRING_RATE;
  #mode: Mode = { kind: 'free' };
  #holdId = -1;
  #holdT = 0;
  readonly #last: BallDraw = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  readonly #target: BallDraw = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  readonly #free: BallDraw = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
  #drawn = false;
  /**
   * Ticks captured since the last frame was drawn. A match left running behind the club
   * screen captures thousands with no frame between them, and the spring must not then
   * ease the ball across the pitch from wherever it was last seen.
   */
  #unseen = 0;

  constructor(tickSeconds: number) {
    this.#T = tickSeconds;
  }

  /** Record a tick. The first one fills both ends, so the first frame has nothing to span. */
  capture(b: { x: number; y: number; z: number; vx: number; vy: number; vz: number; ownerId: number }): void {
    if (this.#primed) Object.assign(this.prev, this.curr);
    this.#unseen++;
    this.curr.x = b.x;
    this.curr.y = b.y;
    this.curr.z = b.z;
    this.curr.vx = b.vx;
    this.curr.vy = b.vy;
    this.curr.vz = b.vz;
    this.curr.owner = b.ownerId;
    if (!this.#primed) {
      Object.assign(this.prev, this.curr);
      this.#primed = true;
    }
  }

  /**
   * Keep the ball on `playerId`'s boot for `seconds`: the wind-up of the kick that has
   * just, as far as the engine is concerned, already happened.
   */
  hold(playerId: number, seconds: number): void {
    this.#holdId = playerId;
    this.#holdT = seconds;
  }

  /** Who the ball is drawn at this frame, if anyone: the holder first, then the owner. */
  get carrierId(): number {
    if (this.#holdT > 0 && this.#holdId >= 0) return this.#holdId;
    return this.curr.owner;
  }

  /** Forget everything in flight — a cut, a kickoff, a new match. */
  reset(): void {
    this.#offX = this.#offY = this.#offZ = 0;
    this.#holdT = 0;
    this.#holdId = -1;
    this.#drawn = false;
    this.#primed = false;
  }

  /**
   * The ball this frame. `carrier` is the figure at `carrierId`, or null if it has none (or
   * it is not on the pitch, in which case the ball flies free).
   */
  evaluate(out: BallDraw, alpha: number, dt: number, carrier: Carrier | null): BallDraw {
    const jumped = Math.hypot(this.curr.x - this.prev.x, this.curr.y - this.prev.y, this.curr.z - this.prev.z) > TELEPORT;
    if (jumped) {
      // Placed, not played: draw where it is now and forget the spring.
      this.#free.x = this.curr.x;
      this.#free.y = this.curr.y;
      this.#free.z = this.curr.z;
      this.#free.vx = this.#free.vy = this.#free.vz = 0;
    } else {
      hermite(this.#free, this.prev, this.curr, alpha, this.#T);
    }

    let mode: Mode = { kind: 'free' };
    const holding = this.#holdT > 0 && carrier !== null && carrier.id === this.#holdId;
    if (holding) {
      this.#holdT -= dt;
      carryPoint(this.#target, carrier);
      // A hold may not outrun the ball: at high match speed the engine's ball is metres
      // away before the leg has swung, and waiting would turn a pass into a teleport.
      const slack = Math.hypot(this.#free.x - this.#target.x, this.#free.y - this.#target.y, this.#free.z - this.#target.z);
      if (slack > HOLD_SLACK) this.#holdT = 0;
      mode = { kind: 'carried', id: carrier.id };
    } else if (carrier !== null && this.curr.owner === carrier.id) {
      carryPoint(this.#target, carrier);
      mode = { kind: 'carried', id: carrier.id };
    } else {
      Object.assign(this.#target, this.#free);
    }
    if (this.#holdT <= 0) this.#holdId = -1;

    const changed = this.#mode.kind !== mode.kind || (mode.kind === 'carried' && this.#mode.kind === 'carried' && mode.id !== this.#mode.id);
    const stale = this.#unseen > 2;
    this.#unseen = 0;
    if (!this.#drawn || jumped || stale) {
      this.#offX = this.#offY = this.#offZ = 0;
    } else if (changed) {
      // Leaving the boot eases out fast, like a strike; everything else a little slower.
      this.#rate = this.#mode.kind === 'carried' && mode.kind === 'free' ? RELEASE_RATE : SPRING_RATE;
      this.#offX = this.#last.x - this.#target.x;
      this.#offY = this.#last.y - this.#target.y;
      this.#offZ = this.#last.z - this.#target.z;
      if (Math.hypot(this.#offX, this.#offY, this.#offZ) > SPRING_MAX) this.#offX = this.#offY = this.#offZ = 0;
    }
    this.#mode = mode;

    const decay = Math.exp(-this.#rate * Math.max(dt, 0));
    this.#offX *= decay;
    this.#offY *= decay;
    this.#offZ *= decay;

    out.x = this.#target.x + this.#offX;
    out.y = this.#target.y + this.#offY;
    out.z = Math.max(0, this.#target.z + this.#offZ);
    out.vx = this.#target.vx;
    out.vy = this.#target.vy;
    out.vz = this.#target.vz;
    Object.assign(this.#last, out);
    this.#drawn = true;
    return out;
  }
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function smoothUnit(x: number): number {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
}
