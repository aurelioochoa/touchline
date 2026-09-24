import { describe, expect, it } from 'vitest';
import { BARRA_BPM, FANFARE, RIFF, drumStep } from './barra.js';

describe('the barra band', () => {
  it('lands the bass drum on the downbeat of both bars, which is where the end jumps', () => {
    expect(drumStep(0, false)).toContain('accent');
    expect(drumStep(8, false)).toContain('accent');
    expect(drumStep(0, false)).toContain('cymbal');
  });

  it('repeats every sixteen steps and never plays an empty phrase', () => {
    let hits = 0;
    for (let s = 0; s < 16; s++) {
      expect(drumStep(s, false)).toEqual(drumStep(s + 16, false));
      hits += drumStep(s, false).length;
    }
    expect(hits).toBeGreaterThan(8);
  });

  it('doubles up after a goal', () => {
    const count = (frenzy: boolean) => Array.from({ length: 16 }, (_, s) => drumStep(s, frenzy).length).reduce((a, b) => a + b, 0);
    expect(count(true)).toBeGreaterThan(count(false));
  });

  it('plays phrases that fit whole bars at a terrace tempo', () => {
    expect(BARRA_BPM).toBeGreaterThan(110);
    expect(BARRA_BPM).toBeLessThan(150);
    for (const phrase of [RIFF, FANFARE]) {
      const beats = phrase.reduce((a, [, b]) => a + b, 0);
      expect(beats % 4).toBe(0);
    }
  });
});
