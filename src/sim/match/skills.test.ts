import { describe, expect, it } from 'vitest';
import { feintChance, pickSkill, showmanship, SKILL_MOVES } from './skills.js';
import type { MatchPlayer } from './types.js';

function player(level: number, id = 3): MatchPlayer {
  const attrs = new Proxy({}, { get: () => level }) as MatchPlayer['attrs'];
  return { id, attrs } as MatchPlayer;
}

describe('skills', () => {
  it('lets the showy player reach for the showy tricks, and keeps the stopper plain', () => {
    const plain = new Set<string>();
    const showy = new Set<string>();
    for (let tick = 0; tick < 400; tick++) {
      plain.add(pickSkill(player(3), tick, true, true));
      showy.add(pickSkill(player(20), tick, true, true));
    }
    expect(showy.has('elastico') && showy.has('flick')).toBe(true);
    expect(plain.has('elastico') || plain.has('flick') || plain.has('roulette')).toBe(false);
    expect(showy.size).toBeGreaterThan(plain.size);
  });

  it('only nutmegs a man who went in and is square in front', () => {
    for (let tick = 0; tick < 300; tick++) {
      expect(pickSkill(player(20), tick, false, true)).not.toBe('nutmeg');
      expect(pickSkill(player(20), tick, true, false)).not.toBe('nutmeg');
    }
  });

  it('is a pure function of its inputs — no hidden randomness', () => {
    for (let tick = 0; tick < 50; tick++) {
      expect(pickSkill(player(14), tick, true, true)).toBe(pickSkill(player(14), tick, true, true));
    }
  });

  it('tries more feints the more flair he has, and never many', () => {
    expect(feintChance(player(20))).toBeGreaterThan(feintChance(player(3)));
    expect(feintChance(player(20))).toBeLessThan(0.05);
    expect(showmanship(player(20))).toBeLessThanOrEqual(1);
    expect(SKILL_MOVES.length).toBe(8);
  });
});
