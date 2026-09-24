// Commentary has two properties worth asserting and neither is about the prose.
//
// It must be deterministic, because the engine is and a client that is not turns a
// reproducible match into an unreproducible one. And every key it can emit must exist in
// BOTH string tables — a generator that can reach a missing key does not throw, it renders
// the key itself, so a kid gets "cm.goalMine.2" on the screen at the best moment of the
// match and no test would have said a word.

import { describe, expect, it } from 'vitest';
import { EN } from '../data/strings.en.js';
import { ES } from '../data/strings.es.js';
import { mulberry32 } from '../core/rng.js';
import { MatchEngine } from '../sim/match/engine.js';
import { buildTeam, resetPlayerIds } from '../sim/match/quickTeam.js';
import type { MatchEvent, TeamSetup } from '../sim/match/types.js';
import { Commentator, everyCommentaryKey, type Line } from './commentary.js';

function teams(seed: number): [TeamSetup, TeamSetup] {
  resetPlayerIds(1);
  const rng = mulberry32(seed);
  return [
    buildTeam(rng, {
      side: 'home', clubId: 1, name: 'Home', shortName: 'HOM',
      strength: 110, kitPrimary: 0xd42b2b, kitSecondary: 0xffffff,
    }),
    buildTeam(rng, {
      side: 'away', clubId: 2, name: 'Away', shortName: 'AWY',
      strength: 110, kitPrimary: 0x2b4bd4, kitSecondary: 0xffffff,
    }),
  ];
}

/**
 * Commentate a whole match, exactly the way `MatchScreen` does: everything above the floor
 * goes in the log, and only some of it reaches the ticker.
 */
function commentate(seed: number): { log: Line[]; shown: Line[] } {
  const [h, a] = teams(seed);
  const engine = new MatchEngine(h, a, seed);
  const c = new Commentator(engine.seed, 'home');
  const log: Line[] = [];
  const shown: Line[] = [];
  let guard = 0;
  while (!engine.state.finished && guard++ < 80_000) {
    const events: MatchEvent[] = [...engine.step()];
    // A real frame's worth of clock, so the rate limiter behaves as it does in the game.
    c.tick(1 / 60);
    const line = c.feed(engine.state, events);
    if (!line) continue;
    log.push(line);
    if (c.worthShowing(line)) shown.push(line);
  }
  return { log, shown };
}

describe('Commentator', () => {
  it('says the same things about the same match twice', () => {
    const a = commentate(4242).log;
    const b = commentate(4242).log;
    expect(b.map((l) => `${l.minute}:${l.key}`)).toEqual(a.map((l) => `${l.minute}:${l.key}`));
  });

  it('says different things about a different match', () => {
    const a = commentate(4242).log.map((l) => l.key);
    const b = commentate(99).log.map((l) => l.key);
    expect(b).not.toEqual(a);
  });

  it('only ever emits keys that exist in both languages', () => {
    for (const key of everyCommentaryKey()) {
      expect(EN, `missing in EN: ${key}`).toHaveProperty(key);
      expect(ES, `missing in ES: ${key}`).toHaveProperty(key);
    }
  });

  it('actually reaches the keys it declares, across a season of matches', () => {
    // The other half: a key that exists but is unreachable is dead weight, and a base name
    // whose variant count is wrong here silently narrows the commentary to variant 0.
    const seen = new Set<string>();
    for (let seed = 0; seed < 12; seed++) {
      for (const line of commentate(1000 + seed * 7).log) seen.add(line.key);
    }
    // Not every line is reachable in twelve matches — a red card is rare — so this asserts
    // breadth rather than completeness.
    expect(seen.size).toBeGreaterThan(20);
  });

  it('narrates the whole match rather than the first ten minutes', () => {
    const { log, shown } = commentate(777);
    expect(log.length).toBeGreaterThan(30);
    expect(shown.length).toBeGreaterThan(10);
    const last = log[log.length - 1];
    expect(last?.minute).toBeGreaterThan(80);
  });

  it('never lets the log run backwards in time', () => {
    // The engine winds its clock back to 45:00 to restart the second half, so a raw
    // reading of it produces a report that lists 47' above 45'. Twice over: the half-time
    // whistle itself used to be announced after the rewind.
    for (const seed of [4242, 777, 31337]) {
      const { log } = commentate(seed);
      for (let i = 1; i < log.length; i++) {
        expect(log[i]?.minute, `seed ${seed} at ${i}`).toBeGreaterThanOrEqual(log[i - 1]?.minute ?? 0);
      }
    }
  });

  it('does not announce a kick-off when a penalty is awarded', () => {
    // The engine used to emit a `kickoff` event to mean "the restart has been taken", so
    // every penalty was introduced with "the referee starts the match".
    for (const seed of [4242, 777, 31337, 99]) {
      const { log } = commentate(seed);
      const kickoffs = log.filter((l) => l.kind === 'whistle' && l.key.startsWith('cm.kickoff'));
      // Exactly one: the first whistle of the match.
      expect(kickoffs.length, `seed ${seed}`).toBeLessThanOrEqual(1);
      for (const k of kickoffs) expect(k.minute, `seed ${seed}`).toBeLessThan(2);
    }
  });

  it('drops small talk from the ticker that the log still keeps', () => {
    // The whole point of the split. The log is a record; the ticker is what there is time
    // to read while the match runs, so it has to be the shorter of the two.
    const { log, shown } = commentate(31337);
    expect(shown.length).toBeLessThan(log.length);
  });

  it('keeps the log to a match report rather than a record of the ball', () => {
    // The failure the floor exists for: 192 rows for one match on the first attempt, most
    // of them the ball changing feet. A report is corners upward.
    for (const seed of [31337, 4242, 777]) {
      const { log } = commentate(seed);
      expect(log.length, `seed ${seed}`).toBeGreaterThan(20);
      expect(log.length, `seed ${seed}`).toBeLessThan(90);
      for (const line of log) expect(line.priority).toBeGreaterThanOrEqual(30);
    }
  });

  it('always finds room for a goal', () => {
    // Priority is the whole point of the rate limiter: the passing gets dropped, the goals
    // never do. Count the goals the engine scored and the goals the commentator mentioned.
    for (const seed of [4242, 777, 31337]) {
      const [h, a] = teams(seed);
      const engine = new MatchEngine(h, a, seed);
      const c = new Commentator(engine.seed, 'home');
      let goals = 0;
      let called = 0;
      let guard = 0;
      while (!engine.state.finished && guard++ < 80_000) {
        const events: MatchEvent[] = [...engine.step()];
        goals += events.filter((e) => e.type === 'goal').length;
        c.tick(1 / 60);
        const line = c.feed(engine.state, events);
        if (line?.kind === 'goal') called++;
        if (line) c.worthShowing(line);
      }
      expect(called, `seed ${seed}`).toBe(goals);
    }
  });
});
