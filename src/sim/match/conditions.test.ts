// The weather has to be three things at once: stable for a given fixture, varied across a
// season, and shaped like a year rather than like a random number. Only the first is
// obvious, and the third is the one that makes a season feel like a season.

import { describe, expect, it } from 'vitest';
import { conditionsFor, fairConditions, rollFactor, bounceFactor, touchPenalty, type Conditions } from './conditions.js';
import { TICK, ballTravelTime, passSpeedFor, rollDecayIn, stepBall } from './physics.js';
import type { Ball } from './types.js';

const SEED = 0x51a4b;

describe('conditionsFor', () => {
  it('gives the same fixture the same weather every time', () => {
    for (const round of [0, 7, 19, 37]) {
      const a = conditionsFor(SEED, 3, round);
      const b = conditionsFor(SEED, 3, round);
      expect(b).toEqual(a);
    }
  });

  it('gives different fixtures different weather', () => {
    const seen = new Set<string>();
    for (let round = 0; round < 38; round++) {
      const c = conditionsFor(SEED, 1, round);
      seen.add(`${c.sky}|${c.wetness.toFixed(3)}|${c.timeOfDay.toFixed(3)}`);
    }
    // A season of identical afternoons is the failure this replaces.
    expect(seen.size).toBeGreaterThan(30);
  });

  it('separates seasons and worlds', () => {
    expect(conditionsFor(SEED, 1, 12)).not.toEqual(conditionsFor(SEED, 2, 12));
    expect(conditionsFor(SEED, 1, 12)).not.toEqual(conditionsFor(SEED + 1, 1, 12));
  });

  it('keeps every value inside its stated range', () => {
    for (let seed = 0; seed < 60; seed++) {
      for (let round = 0; round < 38; round++) {
        const c = conditionsFor(seed * 7919, 1, round);
        expect(c.wetness).toBeGreaterThanOrEqual(0);
        expect(c.wetness).toBeLessThanOrEqual(1);
        expect(c.timeOfDay).toBeGreaterThanOrEqual(0);
        expect(c.timeOfDay).toBeLessThanOrEqual(1);
        expect(Math.hypot(c.windX, c.windY)).toBeLessThanOrEqual(2.401);
        expect(['clear', 'overcast', 'rain', 'heavyRain']).toContain(c.sky);
      }
    }
  });

  it('is not raining every week, and not never', () => {
    let wet = 0;
    let total = 0;
    for (let seed = 0; seed < 120; seed++) {
      for (let round = 0; round < 38; round++) {
        const c = conditionsFor(seed * 104729, 2, round);
        if (c.sky === 'rain' || c.sky === 'heavyRain') wet++;
        total++;
      }
    }
    const share = wet / total;
    // Rain often enough to be a thing that happens, rarely enough to still be weather.
    expect(share).toBeGreaterThan(0.1);
    expect(share).toBeLessThan(0.4);
  });

  it('is wetter and darker in midwinter than on the opening day', () => {
    // The claim the cosine exists to make. Averaged over many worlds, because any single
    // fixture is allowed to be a bright day in January.
    const avg = (round: number): { wet: number; dark: number } => {
      let wet = 0;
      let dark = 0;
      const n = 300;
      for (let i = 0; i < n; i++) {
        const c = conditionsFor(i * 2654435761, 1, round);
        wet += c.wetness;
        dark += c.timeOfDay;
      }
      return { wet: wet / n, dark: dark / n };
    };
    const august = avg(1);
    const january = avg(19);
    expect(january.wet).toBeGreaterThan(august.wet * 1.5);
    expect(january.dark).toBeGreaterThan(august.dark * 1.5);
  });

  it('turns the floodlights on when it is dark', () => {
    for (let seed = 0; seed < 200; seed++) {
      const c = conditionsFor(seed * 31337, 1, 19);
      if (c.timeOfDay > 0.42) expect(c.floodlit).toBe(true);
    }
  });
});

describe('what the weather does to the ball', () => {
  it('makes a wet pitch faster, not slower', () => {
    // The counter-intuitive one, and the reason wetness is worth modelling at all: rain
    // does not bog a football down, it skids it on.
    const dry = fairConditions();
    const wet = { ...fairConditions(), wetness: 0.9 };
    expect(rollFactor(wet)).toBeLessThan(rollFactor(dry));
    expect(bounceFactor(wet)).toBeGreaterThan(bounceFactor(dry));
    expect(touchPenalty(wet)).toBeGreaterThan(touchPenalty(dry));
  });

  it('leaves a dry day exactly as the engine was calibrated', () => {
    const dry = fairConditions();
    expect(rollFactor(dry)).toBe(1);
    expect(bounceFactor(dry)).toBe(1);
    expect(touchPenalty(dry)).toBe(0);
  });
});

describe('the ball and the weather agree with each other', () => {
  const still = (wetness: number): Conditions => ({
    ...fairConditions(), wetness, windX: 0, windY: 0,
  });

  function rolled(c: Conditions, v0: number): { distance: number; time: number } {
    const ball: Ball = {
      x: 0, y: 34, z: 0, vx: v0, vy: 0, vz: 0,
      ownerId: -1, lastTouchId: -1, lastTouchSide: null, loose: 0, intendedReceiverId: -1,
    };
    let t = 0;
    for (let i = 0; i < 2000 && Math.hypot(ball.vx, ball.vy) > 0.13; i++) {
      stepBall(ball, TICK, c);
      t += TICK;
    }
    return { distance: ball.x, time: t };
  }

  /** How long the real integrator takes to roll `distance`, against the analytic answer. */
  function agreement(c: Conditions, distance: number): { predicted: number; real: number } {
    const decay = rollDecayIn(c);
    const v0 = passSpeedFor(distance, 3.2, decay);
    const predicted = ballTravelTime(distance, v0, decay);
    const ball: Ball = {
      x: 0, y: 34, z: 0, vx: v0, vy: 0, vz: 0,
      ownerId: -1, lastTouchId: -1, lastTouchSide: null, loose: 0, intendedReceiverId: -1,
    };
    let real = 0;
    while (ball.x < distance && real < 30) {
      stepBall(ball, TICK, c);
      real += TICK;
    }
    return { predicted, real };
  }

  it('keeps ballTravelTime in step with what stepBall actually does', () => {
    // THE assertion this whole thread of work needed. The agent decides whether a pass can
    // be cut out by inverting the rolling decay analytically; if the ball's real
    // deceleration and that inversion drift apart, every pass is mistimed and the engine
    // plays the ball to the opposition all afternoon. Weather changes the decay, so it is
    // exactly the change that could split them.
    //
    // The bound is RELATIVE and not tight, on purpose. The two have always disagreed by a
    // few percent and always will: the closed form integrates continuously while the
    // engine steps at 100ms and advances position with the post-decay velocity. That gap
    // is a property of the tick, not of the weather, and pretending otherwise would make
    // this a test of the integrator's step size.
    for (const wetness of [0, 0.35, 0.7, 1]) {
      const c = still(wetness);
      for (const distance of [8, 18, 30, 45]) {
        const { predicted, real } = agreement(c, distance);
        expect(Number.isFinite(predicted), `w=${wetness} d=${distance}`).toBe(true);
        const rel = Math.abs(real - predicted) / predicted;
        expect(rel, `w=${wetness} d=${distance}`).toBeLessThan(0.12);
      }
    }
  });

  it('does not let the weather widen the gap between them', () => {
    // The half that actually guards against the trap: a dry pitch is allowed to disagree
    // by the tick's worth it has always disagreed by, but a wet one must not disagree by
    // MORE — that would mean the agent's model of the ball and the ball had come apart in
    // the rain, and the symptom would be an engine that passes to the opposition every
    // time it rains and plays fine when it does not.
    for (const distance of [8, 18, 30, 45]) {
      const dry = agreement(still(0), distance);
      const wet = agreement(still(1), distance);
      const dryRel = Math.abs(dry.real - dry.predicted) / dry.predicted;
      const wetRel = Math.abs(wet.real - wet.predicted) / wet.predicted;
      expect(wetRel, `d=${distance}`).toBeLessThan(dryRel + 0.02);
    }
  });

  it('runs the ball further on a wet pitch for the same strike', () => {
    const dry = rolled(still(0), 18);
    const wet = rolled(still(0.9), 18);
    expect(wet.distance).toBeGreaterThan(dry.distance * 1.2);
  });

  it('bends a ball in the air with the wind, and leaves a rolling one alone', () => {
    const windy: Conditions = { ...fairConditions(), windX: 0, windY: 2.2 };
    const make = (vz: number): Ball => ({
      x: 0, y: 34, z: vz > 0 ? 0.2 : 0, vx: 20, vy: 0, vz,
      ownerId: -1, lastTouchId: -1, lastTouchSide: null, loose: 0, intendedReceiverId: -1,
    });
    const lofted = make(9);
    for (let i = 0; i < 18; i++) stepBall(lofted, TICK, windy);
    // A ball in the air is pushed across; a ball on the grass is not.
    expect(Math.abs(lofted.y - 34)).toBeGreaterThan(0.4);

    const rolling = make(0);
    for (let i = 0; i < 18; i++) stepBall(rolling, TICK, windy);
    expect(Math.abs(rolling.y - 34)).toBeLessThan(0.01);
  });

  it('leaves a dry, still day bit-identical to no conditions at all', () => {
    // The regression that matters most: every number in the engine was calibrated on a
    // fair day, so a fair day has to still be the day it was calibrated on.
    const a = rolled(fairConditions(), 22);
    const b = rolled(still(0), 22);
    expect(a).toEqual(b);
  });
});
