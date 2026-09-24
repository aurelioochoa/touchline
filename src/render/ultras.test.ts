import { describe, expect, it } from 'vitest';
import { FlareShow, flashRate } from './ultras.js';

const run = (show: FlareShow, seconds: number, excite = 0.2) => {
  for (let t = 0; t < seconds; t += 0.1) show.update(0.1, excite);
};

describe('the flares', () => {
  it('go up for the walk-out and are out again within the first minute', () => {
    const show = new FlareShow(12, 7);
    run(show, 3);
    expect(show.burning).toBeGreaterThan(0.3);
    run(show, 45);
    expect(show.burning).toBeLessThan(0.02);
  });

  it('all go up for a home goal, and burn for most of a minute', () => {
    const show = new FlareShow(12, 7);
    run(show, 60);
    show.goal();
    run(show, 3);
    expect(show.burning).toBeGreaterThan(0.9);
    run(show, 20);
    expect(show.burning).toBeGreaterThan(0.5);
    run(show, 60);
    expect(show.burning).toBeLessThan(0.02);
  });

  it('do not light themselves in a quiet ground', () => {
    const show = new FlareShow(12, 7);
    run(show, 600, 0.1);
    expect(show.burning).toBeLessThan(0.02);
  });
});

describe('the cameras', () => {
  it('go off more as the match heats up, and most of all for a goal', () => {
    expect(flashRate(0.5, 0)).toBeGreaterThan(flashRate(0, 0));
    expect(flashRate(1, 1)).toBeGreaterThan(flashRate(1, 0) * 5);
    expect(flashRate(0, 0)).toBeGreaterThan(0);
  });
});

import { crowdDensity } from './tiers.js';
import { seatsIn } from './crowd.js';

describe('the 3D crowd', () => {
  it('fills the ground on ultra and leaves the low tier painted, unless the player says', () => {
    expect(crowdDensity('auto', 3)).toBe(1);
    expect(crowdDensity('auto', 0)).toBe(0);
    expect(crowdDensity('auto', 2)).toBeGreaterThan(crowdDensity('auto', 1));
    expect(crowdDensity('full', 0)).toBe(1);
    expect(crowdDensity('half', 3)).toBe(0.5);
    expect(crowdDensity('off', 3)).toBe(0);
  });

  it('seats about as many people as a real stand of that size holds', () => {
    // A 120m side stand's lower tier: twelve metres of rake, fifteen rows.
    const side = { x: 0, z: 40, rotY: 0, width: 120, z0: 0, y0: 1.5, z1: 12, y1: 6.3 };
    const full = seatsIn([side], 1, 26);
    expect(full).toBeGreaterThan(2500);
    expect(full).toBeLessThan(3600);
    expect(seatsIn([side], 0.5, 26)).toBeLessThan(full * 0.55);
  });
});
