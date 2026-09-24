import { describe, expect, it } from 'vitest';
import { BallMotion, carryPoint, hermite, type BallDraw, type BallSnap, type Carrier } from './ballMotion.js';

const T = 0.1;
const G = 9.81;
const draw = (): BallDraw => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
const snapAt = (x: number, y: number, z: number, vx: number, vy: number, vz: number, owner = -1): BallSnap =>
  ({ x, y, z, vx, vy, vz, owner });
const ball = (x: number, y: number, z: number, vx: number, vy: number, vz: number, ownerId = -1) =>
  ({ x, y, z, vx, vy, vz, ownerId });

function carrier(over: Partial<Carrier> = {}): Carrier {
  return {
    id: 7, x: 50, y: 30, facing: 0, vx: 0, vy: 0, phase: 0, foot: 1,
    trickX: 0, trickY: 0, trickZ: 0, touch: 1, gather: 0, ...over,
  };
}

describe('hermite', () => {
  it('draws a ball in the air on its true parabola between ticks, not a straight line', () => {
    // Exact ballistic motion: z = z0 + vz0 t - g t²/2. Hermite reproduces a quadratic.
    const z0 = 2;
    const vz0 = 3;
    const p = snapAt(0, 0, z0, 10, 0, vz0);
    const q = snapAt(10 * T, 0, z0 + vz0 * T - (G * T * T) / 2, 10, 0, vz0 - G * T);
    const out = draw();
    for (const a of [0.25, 0.5, 0.75]) {
      hermite(out, p, q, a, T);
      const t = a * T;
      expect(out.z).toBeCloseTo(z0 + vz0 * t - (G * t * t) / 2, 6);
      expect(out.x).toBeCloseTo(10 * t, 6);
    }
    // And a straight line would have been wrong by a visible amount at the middle.
    const linear = (p.z + q.z) / 2;
    hermite(out, p, q, 0.5, T);
    expect(Math.abs(out.z - linear)).toBeGreaterThan(0.01);
  });

  it('hits both ends exactly', () => {
    const p = snapAt(1, 2, 0.5, 4, -3, 1);
    const q = snapAt(1.4, 1.7, 0.55, 4, -3, 0.2);
    const out = draw();
    hermite(out, p, q, 0, T);
    expect([out.x, out.y, out.z]).toEqual([1, 2, 0.5]);
    hermite(out, p, q, 1, T);
    expect(out.x).toBeCloseTo(1.4, 9);
    expect(out.y).toBeCloseTo(1.7, 9);
  });

  it('never draws the ball under the grass across a bounce', () => {
    const p = snapAt(0, 0, 0.1, 8, 0, -4);
    const q = snapAt(0.8, 0, 0.08, 8, 0, 2.5);
    const out = draw();
    for (let a = 0; a <= 1; a += 0.05) {
      hermite(out, p, q, a, T);
      expect(out.z).toBeGreaterThanOrEqual(0);
    }
  });

  it('falls back to a straight line when the velocities do not describe the move', () => {
    // A ball placed for a restart carries whatever velocity it had, which has nothing to
    // do with where it was put.
    const p = snapAt(0, 0, 0, 25, 0, 0);
    const q = snapAt(0.2, 0, 0, -25, 0, 0);
    const out = draw();
    hermite(out, p, q, 0.5, T);
    expect(out.x).toBeCloseTo(0.1, 9);
  });
});

describe('carryPoint', () => {
  it('sits where the engine glues the ball on average, so leaving the foot is seamless', () => {
    // engine.ts #ballPhase: 0.45 + 0.075 × speed in front of the carrier.
    const speed = 6;
    const out = draw();
    let sum = 0;
    const n = 400;
    for (let i = 0; i < n; i++) {
      carryPoint(out, carrier({ vx: speed, phase: (i / n) * Math.PI * 2 }));
      sum += out.x - 50;
    }
    expect(sum / n).toBeCloseTo(0.45 + 0.075 * speed, 2);
  });

  it('knocks the ball ahead and runs onto it — the touch has a rhythm when dribbling', () => {
    const out = draw();
    const xs: number[] = [];
    for (let i = 0; i < 40; i++) {
      carryPoint(out, carrier({ vx: 6, phase: (i / 40) * Math.PI * 2 }));
      xs.push(out.x);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(0.25);
  });

  it('keeps the ball still at the feet of a man standing on it', () => {
    const out = draw();
    const xs: number[] = [];
    for (let i = 0; i < 20; i++) {
      carryPoint(out, carrier({ phase: i * 0.3 }));
      xs.push(out.x);
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(1e-9);
  });

  it('gathers the ball in to his feet for a trick, whatever speed he is running at', () => {
    const out = draw();
    carryPoint(out, carrier({ vx: 8, touch: 0, gather: 1 }));
    expect(out.x - 50).toBeCloseTo(0.3, 6);
  });

  it('adds a trick on top, including the height of a flick', () => {
    const out = draw();
    carryPoint(out, carrier({ trickX: 0.3, trickY: -0.2, trickZ: 1.5, touch: 0 }));
    expect(out.x).toBeCloseTo(50 + 0.45 + 0.3, 6);
    expect(out.z).toBeCloseTo(1.5, 6);
  });
});

describe('BallMotion', () => {
  it('moves a rolling ball a little every frame instead of a lot every tick', () => {
    const m = new BallMotion(T);
    m.capture(ball(10, 30, 0, 15, 0, 0));
    m.capture(ball(11.5, 30, 0, 15, 0, 0));
    const out = draw();
    const xs: number[] = [];
    for (let f = 0; f <= 6; f++) xs.push(m.evaluate(out, f / 6, 1 / 60, null).x);
    for (let i = 1; i < xs.length; i++) {
      const step = (xs[i] as number) - (xs[i - 1] as number);
      expect(step).toBeGreaterThan(0.2);
      expect(step).toBeLessThan(0.3);
    }
  });

  it('eases a change of hands instead of snapping to the new carrier', () => {
    const m = new BallMotion(T);
    const out = draw();
    m.capture(ball(40, 30, 0, 10, 0, 0));
    m.capture(ball(41, 30, 0, 10, 0, 0));
    const before = m.evaluate(out, 1, 1 / 60, null).x;
    // Collected: the engine now glues it in front of a receiver a metre further on.
    m.capture(ball(42.4, 30, 0, 0, 0, 0, 7));
    const c = carrier({ x: 42, y: 30 });
    const first = m.evaluate(out, 0, 1 / 60, c).x;
    // One frame closes a fraction of the gap — about ball speed — never the whole of it.
    const gap = 42.45 - before;
    expect(first - before).toBeGreaterThan(0);
    expect(first - before).toBeLessThan(gap * 0.25);
    let x = first;
    for (let f = 0; f < 60; f++) x = m.evaluate(out, 1, 1 / 60, c).x;
    expect(x).toBeCloseTo(42 + 0.45, 2);
  });

  it('snaps a ball that was placed rather than played', () => {
    const m = new BallMotion(T);
    const out = draw();
    m.capture(ball(40, 30, 0, 0, 0, 0));
    m.capture(ball(40, 30, 0, 0, 0, 0));
    m.evaluate(out, 1, 1 / 60, null);
    m.capture(ball(99, 5, 0, 0, 0, 0));
    expect(m.evaluate(out, 0, 1 / 60, null).x).toBe(99);
  });

  it('holds a struck ball on the boot until the swing reaches it, then lets it go', () => {
    const m = new BallMotion(T);
    const out = draw();
    const c = carrier({ x: 50, y: 30 });
    m.capture(ball(50.45, 30, 0, 0, 0, 0, 7));
    m.capture(ball(50.45, 30, 0, 0, 0, 0, 7));
    m.evaluate(out, 1, 1 / 60, c);
    // Passed: the engine has already launched it at 12 m/s.
    m.capture(ball(50.45, 30, 0, 12, 0, 0));
    m.hold(7, 0.1);
    expect(m.carrierId).toBe(7);
    expect(m.evaluate(out, 0.3, 1 / 60, c).x).toBeCloseTo(50.45, 3);
    for (let f = 0; f < 8; f++) m.evaluate(out, 0.3, 1 / 60, c);
    expect(m.carrierId).toBe(-1);
    // The engine moves it on the next tick, and from the boot it goes.
    m.capture(ball(51.65, 30, 0, 12, 0, 0));
    expect(m.evaluate(out, 0.1, 1 / 60, c).x).toBeCloseTo(50.45 + 1.2 * 0.1, 2);
  });

  it('does not ease the ball across the pitch after a spell of nobody watching', () => {
    const m = new BallMotion(T);
    const out = draw();
    m.capture(ball(40, 30, 0, 0, 0, 0));
    m.evaluate(out, 1, 1 / 60, null);
    // Detached: the match plays on, a few metres at a time, with no frames drawn.
    for (let i = 1; i <= 40; i++) m.capture(ball(40 + i * 0.1, 30, 0, 1, 0, 0));
    expect(m.evaluate(out, 1, 1 / 60, null).x).toBeCloseTo(44, 6);
  });

  it('gives up a hold that the real ball has already outrun', () => {
    const m = new BallMotion(T);
    const out = draw();
    const c = carrier({ x: 50, y: 30 });
    m.capture(ball(50.45, 30, 0, 0, 0, 0, 7));
    m.capture(ball(55.5, 30, 0, 30, 0, 0));
    m.hold(7, 0.2);
    m.evaluate(out, 1, 1 / 60, c);
    expect(m.carrierId).toBe(-1);
  });
});
