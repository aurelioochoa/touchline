// Deterministic seeded PRNG (mulberry32). Worldgen, the match engine's noise and every
// test that needs "randomness" run through this, so a given seed always produces the
// same world and the same match. Determinism is not a nicety here: a match is replayed
// from its seed and its input log rather than stored frame by frame (§C).

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive an independent stream from a seed and a label. Two subsystems drawing from one
 * Rng are coupled: adding a die roll to the crowd noise would silently change every match
 * result. Each subsystem takes its own stream instead.
 */
export function streamOf(seed: number, label: string): Rng {
  let h = seed >>> 0;
  for (let i = 0; i < label.length; i++) {
    h = Math.imul(h ^ label.charCodeAt(i), 0x01000193) >>> 0;
  }
  return mulberry32(h);
}

/** Float in [lo, hi). */
export function range(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Integer in [lo, hi] inclusive. */
export function int(rng: Rng, lo: number, hi: number): number {
  return Math.floor(range(rng, lo, hi + 1));
}

/** True with probability p. */
export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const i = int(rng, 0, items.length - 1);
  const v = items[i];
  if (v === undefined) throw new Error('pick() on empty array');
  return v;
}

/**
 * Standard normal, via the polar form of Box-Muller. Attribute generation wants a bell
 * rather than a flat spread — a division full of uniformly random players has no shape,
 * and "most players are ordinary, a few are not" is the thing being modelled.
 */
export function gauss(rng: Rng): number {
  let u = 0;
  let v = 0;
  let s = 0;
  do {
    u = rng() * 2 - 1;
    v = rng() * 2 - 1;
    s = u * u + v * v;
  } while (s === 0 || s >= 1);
  return u * Math.sqrt((-2 * Math.log(s)) / s);
}

/** Fisher-Yates, in place, through the given stream. */
export function shuffle<T>(rng: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = int(rng, 0, i);
    const a = items[i] as T;
    const b = items[j] as T;
    items[i] = b;
    items[j] = a;
  }
  return items;
}

/** Weighted pick. Weights need not sum to 1; non-positive weights are skipped. */
export function weighted<T>(rng: Rng, items: readonly T[], weightOf: (item: T) => number): T {
  let total = 0;
  for (const it of items) {
    const w = weightOf(it);
    if (w > 0) total += w;
  }
  if (total <= 0) return pick(rng, items);
  let r = rng() * total;
  for (const it of items) {
    const w = weightOf(it);
    if (w <= 0) continue;
    r -= w;
    if (r <= 0) return it;
  }
  return items[items.length - 1] as T;
}
