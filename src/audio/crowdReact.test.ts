import { describe, expect, it } from 'vitest';
import { crowdReaction, standLift, type CrowdContext } from './crowdReact.js';

const ctx = (over: Partial<CrowdContext> = {}): CrowdContext => ({
  home: 'home', danger: 0.2, score: { home: 0, away: 0 }, recentShot: null, ...over,
});
const calls = (xs: { call: string }[]) => xs.map((x) => x.call);

describe('crowdReaction', () => {
  it('takes sides: an olé for our trick, a gasp for theirs', () => {
    const ours = crowdReaction({ type: 'skill', by: 1, on: 2, side: 'home', move: 'stepover', beat: true }, ctx());
    const theirs = crowdReaction({ type: 'skill', by: 2, on: 1, side: 'away', move: 'stepover', beat: true }, ctx());
    expect(calls(ours)).toEqual(['ole']);
    expect(calls(theirs)).toEqual(['gasp']);
  });

  it('boos the referee for our card and cheers theirs', () => {
    expect(calls(crowdReaction({ type: 'foul', by: 1, on: 2, side: 'home', card: 'yellow' }, ctx()))).toContain('boo');
    expect(calls(crowdReaction({ type: 'foul', by: 2, on: 1, side: 'away', card: 'yellow' }, ctx()))).toContain('cheer');
  });

  it('knows whose ground it is', () => {
    const e = { type: 'offside', by: 1, side: 'home' } as const;
    expect(calls(crowdReaction(e, ctx()))).toEqual(['groan']);
    expect(calls(crowdReaction(e, ctx({ home: 'away' })))).toEqual(['cheer']);
  });

  it('hears a miss only when it resolves, as the goal kick after our shot', () => {
    expect(calls(crowdReaction({ type: 'shot', by: 1, side: 'home', onTarget: false, distance: 12 }, ctx()))).toEqual(['anticipate']);
    expect(crowdReaction({ type: 'goalKick', side: 'away' }, ctx())).toEqual([]);
    expect(calls(crowdReaction({ type: 'goalKick', side: 'away' }, ctx({ recentShot: 'home' })))).toEqual(['ooh']);
  });

  it('ignores a midfield tackle and cheers one that stops a chance', () => {
    const e = { type: 'tackle', by: 1, on: 2, side: 'home', won: true } as const;
    expect(calls(crowdReaction(e, ctx({ danger: 0.1 })))).toEqual(['applause']);
    expect(calls(crowdReaction(e, ctx({ danger: 0.7 })))).toContain('cheer');
  });

  it('sends the home side off to cheers or boos by the score', () => {
    expect(calls(crowdReaction({ type: 'fullTime' }, ctx({ score: { home: 2, away: 0 } })))).toContain('roar');
    expect(calls(crowdReaction({ type: 'fullTime' }, ctx({ score: { home: 0, away: 2 } })))).toContain('boo');
  });

  it('reacts to far more of the match than goals', () => {
    const reacted = [
      crowdReaction({ type: 'corner', side: 'home' }, ctx()),
      crowdReaction({ type: 'freeKick', side: 'home', dangerous: true }, ctx()),
      crowdReaction({ type: 'penaltyAwarded', side: 'away' }, ctx()),
      crowdReaction({ type: 'save', by: 1, side: 'home', spectacular: true }, ctx()),
      crowdReaction({ type: 'injury', playerId: 1, side: 'away' }, ctx()),
      crowdReaction({ type: 'substitution', side: 'home', off: 1, on: 2 }, ctx()),
      crowdReaction({ type: 'kickoff', side: 'home', period: 'first' }, ctx()),
      crowdReaction({ type: 'halfTime' }, ctx()),
    ];
    for (const r of reacted) expect(r.length).toBeGreaterThan(0);
  });

  it('lifts the stands for a roar and not for a hush', () => {
    expect(standLift({ call: 'roar', level: 1 })).toBe(1);
    expect(standLift({ call: 'hush', level: 1 })).toBe(0);
  });
});
