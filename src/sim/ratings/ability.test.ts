import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/rng.js';
import { attr, attrUnit, ATTR_KEYS } from './attributes.js';
import { caOf, generateAttributes, potentialBand, rollPotential, scaleToCa, stars } from './ability.js';
import { POSITIONS, type Position } from './positions.js';

describe('caOf', () => {
  it('is monotonic — raising every attribute cannot lower CA', () => {
    const rng = mulberry32(1);
    const a = generateAttributes(rng, 'MC', 100);
    const before = caOf(a, 'MC');
    for (const k of ATTR_KEYS) a[ATTR_KEYS.indexOf(k)] = Math.min(20, (a[ATTR_KEYS.indexOf(k)] ?? 1) + 1);
    expect(caOf(a, 'MC')).toBeGreaterThanOrEqual(before);
  });

  it('rates the same attributes differently by position', () => {
    const rng = mulberry32(7);
    const striker = generateAttributes(rng, 'ST', 140);
    // A striker's attribute set is worth less to a centre-back's job than to his own.
    expect(caOf(striker, 'ST')).toBeGreaterThan(caOf(striker, 'DC'));
  });
});

describe('generateAttributes', () => {
  it('hits the requested CA within tolerance across the whole range and every position', () => {
    const rng = mulberry32(99);
    for (const pos of POSITIONS) {
      for (const target of [30, 60, 90, 120, 150, 180]) {
        const a = generateAttributes(rng, pos as Position, target);
        expect(Math.abs(caOf(a, pos as Position) - target)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('gives a player a shape — key attributes outrank irrelevant ones', () => {
    const rng = mulberry32(4);
    // Averaged over many strikers, finishing must beat tackling comfortably.
    let fin = 0;
    let tac = 0;
    for (let i = 0; i < 60; i++) {
      const a = generateAttributes(rng, 'ST', 130);
      fin += attr(a, 'finishing');
      tac += attr(a, 'tackling');
    }
    expect(fin / 60).toBeGreaterThan(tac / 60 + 4);
  });

  it('keeps every attribute inside the 1-20 scale', () => {
    const rng = mulberry32(21);
    for (let i = 0; i < 50; i++) {
      const a = generateAttributes(rng, 'AMC', 5 + i * 3);
      for (const k of ATTR_KEYS) {
        expect(attr(a, k)).toBeGreaterThanOrEqual(1);
        expect(attr(a, k)).toBeLessThanOrEqual(20);
      }
    }
  });

  it('is deterministic for a given seed', () => {
    const a = generateAttributes(mulberry32(1234), 'DC', 110);
    const b = generateAttributes(mulberry32(1234), 'DC', 110);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('leaves hidden attributes uncorrelated with ability', () => {
    const rng = mulberry32(55);
    let lowPro = 0;
    let highPro = 0;
    for (let i = 0; i < 80; i++) {
      lowPro += attr(generateAttributes(rng, 'MC', 40), 'professionalism');
      highPro += attr(generateAttributes(rng, 'MC', 170), 'professionalism');
    }
    expect(Math.abs(lowPro / 80 - highPro / 80)).toBeLessThan(2);
  });
});

describe('scaleToCa', () => {
  it('preserves relative shape while moving the level', () => {
    const rng = mulberry32(8);
    const a = generateAttributes(rng, 'ST', 90);
    const finBefore = attrUnit(a, 'finishing');
    const tacBefore = attrUnit(a, 'tackling');
    scaleToCa(a, 'ST', 150);
    expect(caOf(a, 'ST')).toBeGreaterThan(140);
    // Finishing was ahead of tackling and still is.
    expect(attrUnit(a, 'finishing') - attrUnit(a, 'tackling')).toBeGreaterThan(
      (finBefore - tacBefore) * 0.5,
    );
  });
});

describe('rollPotential', () => {
  it('never returns potential below current ability', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const ca = 20 + (i % 150);
      const age = 16 + (i % 20);
      expect(rollPotential(rng, ca, age)).toBeGreaterThanOrEqual(ca);
    }
  });

  it('leaves a 30-year-old almost no room and a 16-year-old plenty', () => {
    const rng = mulberry32(11);
    let young = 0;
    let old = 0;
    for (let i = 0; i < 200; i++) {
      young += rollPotential(rng, 90, 16) - 90;
      old += rollPotential(rng, 90, 30) - 90;
    }
    expect(young / 200).toBeGreaterThan(30);
    expect(old / 200).toBeLessThan(12);
  });
});

describe('potentialBand', () => {
  it('always contains the true value, and narrows as knowledge grows', () => {
    const wide = potentialBand(140, 0);
    const narrow = potentialBand(140, 1);
    expect(wide.lo).toBeLessThanOrEqual(140);
    expect(wide.hi).toBeGreaterThanOrEqual(140);
    expect(narrow.lo).toBeLessThanOrEqual(140);
    expect(narrow.hi).toBeGreaterThanOrEqual(140);
    expect(narrow.hi - narrow.lo).toBeLessThan(wide.hi - wide.lo);
  });
});

describe('stars', () => {
  it('is relative to the division, so five stars means "great here"', () => {
    expect(stars(90, 60)).toBeGreaterThan(stars(90, 140));
    expect(stars(200, 60)).toBeLessThanOrEqual(5);
    expect(stars(1, 200)).toBeGreaterThanOrEqual(0.5);
  });
});
