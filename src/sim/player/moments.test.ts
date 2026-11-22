import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../core/rng.js';
import { MatchEngine, type MomentControl } from '../match/engine.js';
import { buildTeam, resetPlayerIds } from '../match/quickTeam.js';
import { HALF_WIDTH } from '../match/pitch.js';
import type { MatchResult, TeamSetup } from '../match/types.js';
import type { Position } from '../ratings/positions.js';
import { momentOptions } from './moments.js';

function teams(seed: number, homeStrength = 110, awayStrength = 110): [TeamSetup, TeamSetup] {
  resetPlayerIds(1);
  const rng = mulberry32(seed);
  const home = buildTeam(rng, { side: 'home', clubId: 1, name: 'Home', shortName: 'HOM', strength: homeStrength, kitPrimary: 0xd42b2b, kitSecondary: 0xffffff });
  const away = buildTeam(rng, { side: 'away', clubId: 2, name: 'Away', shortName: 'AWY', strength: awayStrength, kitPrimary: 0x2b4bd4, kitSecondary: 0xffffff });
  return [home, away];
}

const control = (playerId: number, extra: Partial<MomentControl> = {}): MomentControl =>
  ({ playerId, budget: 8, enterAt: Infinity, takesPenalties: false, ...extra });

/** Play a match out, answering every moment with `choose`; returns the result and the inputs. */
function play(engine: MatchEngine, choose: (index: number, count: number) => number) {
  const inputs: [number, number][] = [];
  while (!engine.state.finished) {
    engine.step();
    const pending = engine.awaiting;
    if (!pending) continue;
    const options = momentOptions(engine.state, pending.player, pending.suggested);
    const pick = choose(inputs.length, options.length) % options.length;
    inputs.push([engine.state.tick, pick]);
    if (!engine.resolveMoment(options[pick]!.action)) throw new Error('a listed option was refused');
  }
  return { result: engine.runToEnd(), inputs };
}

const summary = (r: MatchResult) => [r.homeGoals, r.awayGoals, r.homeShots, r.awayShots, JSON.stringify(r.scorers), JSON.stringify(r.cards)];

describe('key moments in the engine', () => {
  it('letting him play every moment is the match that would have happened', () => {
    const [home, away] = teams(7);
    const free = new MatchEngine(home, away, 7).runToEnd();
    const [home2, away2] = teams(7);
    const hero = home2.players[9]!;
    const engine = new MatchEngine(home2, away2, 7, undefined, control(hero.id));
    // "auto" is always the last option: the default the engine had already chosen.
    const { result, inputs } = play(engine, (_index, count) => count - 1);
    expect(inputs.length).toBeGreaterThan(0);
    expect(summary(result)).toEqual(summary(free));
  });

  it('replays the same match from the same seed and the same (tick, choice) inputs', () => {
    const run = (choices: (index: number, count: number) => number) => {
      const [home, away] = teams(31);
      return play(new MatchEngine(home, away, 31, undefined, control(home.players[9]!.id)), choices);
    };
    const first = run((index) => index * 3 + 1);
    const recorded = new Map(first.inputs);
    const replay = run(() => 0);
    // Different choices, different match — which is what makes the replay worth checking.
    expect(summary(replay.result)).not.toEqual(summary(first.result));
    const [home, away] = teams(31);
    const engine = new MatchEngine(home, away, 31, undefined, control(home.players[9]!.id));
    const again = play(engine, () => recorded.get(engine.state.tick) ?? 0);
    expect(again.inputs).toEqual(first.inputs);
    expect(summary(again.result)).toEqual(summary(first.result));
  });

  it('refuses a pass to an opponent and an aim wide of the goal, and says so', () => {
    const [home, away] = teams(5);
    const engine = new MatchEngine(home, away, 5, undefined, control(home.players[9]!.id));
    while (!engine.awaiting && !engine.state.finished) engine.step();
    const pending = engine.awaiting!;
    const opponent = away.players[3]!;
    expect(engine.resolveMoment({ kind: 'pass', to: opponent, speed: 12, loft: 0, long: false })).toBeNull();
    expect(engine.resolveMoment({ kind: 'shoot', power: 0.8, targetY: HALF_WIDTH + 12, targetZ: 1 })).toBeNull();
    expect(engine.awaiting).toBe(pending);
    expect(engine.step()).toEqual([]);
    expect(engine.resolveMoment(pending.suggested)).not.toBeNull();
    expect(engine.awaiting).toBeNull();
  });

  it('gives a starter 6-10 moments across a ladder of positions and strengths', () => {
    const ladder: [Position, number, number][] = [
      ['ST', 90, 130], ['ST', 130, 90], ['AML', 110, 110], ['AMR', 90, 130],
      ['AMC', 130, 90], ['AMC', 110, 110], ['MC', 90, 130], ['MC', 130, 90],
    ];
    for (const [role, homeStrength, awayStrength] of ladder) {
      const [home, away] = teams(3, homeStrength, awayStrength);
      const hero = home.players[9]!;
      hero.role = role;
      const { inputs } = play(new MatchEngine(home, away, 3, undefined, control(hero.id)), (_index, count) => count - 1);
      expect(inputs.length, `${role} ${homeStrength}-${awayStrength}`).toBeGreaterThanOrEqual(6);
      expect(inputs.length, `${role} ${homeStrength}-${awayStrength}`).toBeLessThanOrEqual(10);
    }
  });

  it('brings a benched hero on by his minute, and the bench still has moments', () => {
    const [home, away] = teams(12);
    const hero = home.bench.find((player) => player.role === 'ST')!;
    const engine = new MatchEngine(home, away, 12, undefined, control(hero.id, { budget: 3, enterAt: 75 * 60 }));
    let enteredAt = -1;
    let moments = 0;
    while (!engine.state.finished) {
      for (const event of engine.step()) if (event.type === 'substitution' && event.on === hero.id) enteredAt = engine.state.clock;
      if (engine.awaiting) {
        moments++;
        engine.resolveMoment(engine.awaiting.suggested);
      }
    }
    expect(enteredAt).toBeGreaterThanOrEqual(75 * 60);
    expect(enteredAt).toBeLessThan(80 * 60);
    expect(moments).toBeGreaterThanOrEqual(2);
    expect(moments).toBeLessThanOrEqual(5);
  });
});
