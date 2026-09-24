// The TV director's cutting rules. What matters is not which angle it picks for a throw-in
// but that it never cuts faster than a viewer can follow, and never at all for a viewer
// who asked for less motion.

import { describe, expect, it } from 'vitest';
import { Director, FAST, MIN_HOLD, type DirectorInput } from './director.js';

const open = (danger = 0, pace = 1): DirectorInput => ({ play: 'open', danger, pace, reducedMotion: false });
const at = (play: DirectorInput['play'], danger = 0, pace = 1): DirectorInput => ({ play, danger, pace, reducedMotion: false });

/** Run the director for `seconds` at 60fps, counting cuts. */
function run(d: Director, input: DirectorInput, seconds: number): number {
  let cuts = 0;
  for (let t = 0; t < seconds; t += 1 / 60) if (d.update(input, 1 / 60)) cuts++;
  return cuts;
}

describe('the TV director', () => {
  it('stays on the main camera through calm open play', () => {
    const d = new Director();
    expect(run(d, open(0.1), 30)).toBe(0);
    expect(d.shot).toBe('broadcast');
  });

  it('goes tight on a sustained attack, and lets go once it is over', () => {
    const d = new Director();
    run(d, open(0.8), 0.5);
    expect(d.shot).toBe('broadcast');
    run(d, open(0.8), 1);
    expect(d.shot).toBe('follow');
    run(d, open(0.1), MIN_HOLD + 2);
    expect(d.shot).toBe('broadcast');
  });

  it('cuts to behind the goal for a penalty at once, even inside the hold', () => {
    const d = new Director();
    run(d, open(0.8), 1.6);
    expect(d.shot).toBe('follow');
    expect(d.update(at('penalty', 0.9), 1 / 60)).toBe(true);
    expect(d.shot).toBe('behindGoal');
  });

  it('closes up on the taker of a throw-in, and holds it into the throw', () => {
    const d = new Director();
    run(d, at('throwIn'), 1);
    expect(d.shot).toBe('player');
    run(d, open(0.1), 0.5);
    expect(d.shot).toBe('player');
    run(d, open(0.1), MIN_HOLD);
    expect(d.shot).toBe('broadcast');
  });

  it('never cuts more often than the minimum hold, however the play flickers', () => {
    const d = new Director();
    let cuts = 0;
    const seconds = 60;
    const kinds: DirectorInput['play'][] = ['throwIn', 'open', 'corner', 'open', 'goalKick', 'freeKick'];
    for (let i = 0; i < seconds * 60; i++) {
      const play = kinds[Math.floor(i / 20) % kinds.length] ?? 'open';
      if (d.update(at(play, (i % 90) / 90), 1 / 60)) cuts++;
    }
    expect(cuts).toBeLessThanOrEqual(Math.ceil(seconds / MIN_HOLD));
  });

  it('keeps the wide camera for everyday restarts at high speed', () => {
    const d = new Director();
    run(d, at('throwIn', 0, FAST * 3), 3);
    run(d, at('corner', 0.6, FAST * 3), 3);
    expect(d.shot).toBe('broadcast');
    run(d, at('penalty', 0.9, FAST * 3), 0.1);
    expect(d.shot).toBe('behindGoal');
  });

  it('does not cut at all under reduced motion', () => {
    const d = new Director();
    const calm = (play: DirectorInput['play'], danger: number): DirectorInput => ({ play, danger, pace: 1, reducedMotion: true });
    let cuts = 0;
    for (const play of ['throwIn', 'penalty', 'corner', 'open'] as const) {
      for (let t = 0; t < 4; t += 1 / 60) if (d.update(calm(play, 0.9), 1 / 60)) cuts++;
    }
    expect(cuts).toBe(0);
    expect(d.shot).toBe('broadcast');
  });
});
