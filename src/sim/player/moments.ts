// What a frozen key moment offers the kid, as plain data (player-career §10).
//
// Everything here reads the engine's own numbers — `interceptRisk` for a pass lane, the
// engine's shot spread for the aim circle, the same cross and carry rules `decideOnBall`
// uses — so what the overlay shows is what the match will do with the choice.

import { clamp, clamp01, dist, lerp } from '../../core/math.js';
import { attrUnit } from '../ratings/attributes.js';
import { activePlayers, interceptRisk, lastDefenderX, shotValue, teamOf, type BallAction } from '../match/agent.js';
import { passSpeedFor } from '../match/physics.js';
import { HALF_LENGTH, HALF_WIDTH, PITCH_LENGTH, PITCH_WIDTH, attackingGoalX } from '../match/pitch.js';
import { directionOf, otherSide, type MatchPlayer, type MatchState } from '../match/types.js';

export type MomentKind = 'pass' | 'shoot' | 'cross' | 'dribble' | 'auto';

/** One thing the kid can pick, anchored at a pitch point (metres, height in metres). */
export interface MomentOption {
  kind: MomentKind;
  x: number;
  y: number;
  z: number;
  /** 0 safe .. 1 sure to be cut out. Drawn as ring thickness, never colour alone. */
  risk: number;
  action: BallAction;
  /** The team-mate a pass goes to. */
  receiverId?: number;
}

/** The six aim zones across the goal mouth: three across, low row first. */
export const AIM_COLUMNS = [-2.4, 0, 2.4];
export const AIM_ROWS = [0.45, 1.85];

/** How far from the aim point a strike may stray, in metres — the soft circle. */
export function aimSpread(state: MatchState, shooter: MatchPlayer): number {
  const accuracy = clamp01(attrUnit(shooter.attrs, 'finishing') * 0.55 + attrUnit(shooter.attrs, 'technique') * 0.2 + 0.15);
  const goalX = attackingGoalX(directionOf(shooter.side, state.period));
  return lerp(0.11, 0.012, accuracy) * dist(shooter.x, shooter.y, goalX, HALF_WIDTH);
}

/** A shot at one aim zone, with the default's power when the default was a shot. */
export function shotAt(state: MatchState, shooter: MatchPlayer, zone: number, suggested: BallAction): BallAction & { kind: 'shoot' } {
  const dir = directionOf(shooter.side, state.period);
  // Columns are read from the shooter's side of the goal, so "left" is his left.
  const across = (AIM_COLUMNS[zone % 3] ?? 0) * -dir;
  return {
    kind: 'shoot',
    power: suggested.kind === 'shoot' ? suggested.power : 0.82,
    targetY: HALF_WIDTH + across,
    targetZ: AIM_ROWS[Math.floor(zone / 3)] ?? 0.45,
  };
}

/** Whether the goal should be offered at all: inside range and with some of it in view. */
export function canShoot(state: MatchState, shooter: MatchPlayer): boolean {
  const goalX = attackingGoalX(directionOf(shooter.side, state.period));
  return dist(shooter.x, shooter.y, goalX, HALF_WIDTH) < 34 && Math.abs(shooter.x - goalX) > 1.5;
}

/** Every option for this touch, the default last. */
export function momentOptions(state: MatchState, hero: MatchPlayer, suggested: BallAction): MomentOption[] {
  const dir = directionOf(hero.side, state.period);
  const goalX = attackingGoalX(dir);
  const team = teamOf(state, hero.side);
  const options: MomentOption[] = [];

  if (canShoot(state, hero)) {
    options.push({
      kind: 'shoot', x: goalX, y: HALF_WIDTH, z: 1.2,
      risk: 1 - clamp01(shotValue(state, hero) * 4),
      action: shotAt(state, hero, 1, suggested),
    });
  }

  // Up to four team-mates, the most useful first: forward progress minus the lane's risk.
  const offsideX = lastDefenderX(state, hero.side, dir);
  const passes = activePlayers(team)
    .filter((mate) => mate.id !== hero.id && mate.role !== 'GK')
    .map((mate) => {
      const distance = dist(hero.x, hero.y, mate.x, mate.y);
      const beyond = dir > 0 ? mate.x > offsideX + 0.5 : mate.x < offsideX - 0.5;
      const inTheirHalf = dir > 0 ? mate.x > HALF_LENGTH : mate.x < HALF_LENGTH;
      const long = distance > 26;
      const loft = long ? clamp01(0.3 + team.instructions.directness * 0.5) : 0;
      const speed = passSpeedFor(distance, 3.2, state.rollDecay) * lerp(0.85, 1.2, team.instructions.tempo);
      const risk = interceptRisk(state, hero, mate.x, mate.y, speed, loft);
      const gain = (dir > 0 ? mate.x - hero.x : hero.x - mate.x) / PITCH_LENGTH;
      const usable = distance > 4 && distance < 45 && !(beyond && inTheirHalf);
      return { mate, risk, value: gain * 2 - risk, usable, action: { kind: 'pass', to: mate, speed, loft, long } as BallAction };
    })
    .filter((entry) => entry.usable)
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);
  for (const entry of passes) {
    options.push({ kind: 'pass', x: entry.mate.x, y: entry.mate.y, z: 0, risk: entry.risk, action: entry.action, receiverId: entry.mate.id });
  }

  // Crosses from the same wide, final-third ground the engine crosses from.
  const wide = Math.abs(hero.y - HALF_WIDTH) > PITCH_WIDTH * 0.19;
  const finalThird = (dir > 0 ? hero.x : PITCH_LENGTH - hero.x) > PITCH_LENGTH * 0.63;
  if (wide && finalThird) {
    const nearSide = hero.y < HALF_WIDTH ? -1 : 1;
    const speed = lerp(15, 23, attrUnit(hero.attrs, 'crossing'));
    for (const [depth, across] of [[4, nearSide * 2.5], [11, 0], [6, -nearSide * 3.5]] as const) {
      const x = goalX - dir * depth;
      const y = HALF_WIDTH + across;
      options.push({ kind: 'cross', x, y, z: 0, risk: crowdAt(state, hero, x, y), action: { kind: 'cross', x, y, speed } });
    }
  }

  // Three carries: inside, straight on, outside.
  const carry = clamp01(attrUnit(hero.attrs, 'dribbling') * 0.6 + attrUnit(hero.attrs, 'pace') * 0.4);
  const stride = lerp(4.5, 7, carry);
  for (const turn of [-0.6, 0, 0.6]) {
    const heading = (dir > 0 ? 0 : Math.PI) + turn;
    const x = clamp(hero.x + Math.cos(heading) * stride, 1, PITCH_LENGTH - 1);
    const y = clamp(hero.y + Math.sin(heading) * stride, 1, PITCH_WIDTH - 1);
    options.push({ kind: 'dribble', x, y, z: 0, risk: crowdAt(state, hero, x, y), action: { kind: 'dribble', x, y } });
  }

  options.push({ kind: 'auto', x: hero.x, y: hero.y, z: 2.3, risk: 0, action: suggested });
  return options;
}

/** How close the nearest opponent is to a spot: 1 within a stride of it, 0 four metres clear. */
function crowdAt(state: MatchState, hero: MatchPlayer, x: number, y: number): number {
  let nearest = Infinity;
  for (const opponent of activePlayers(teamOf(state, otherSide(hero.side)))) {
    nearest = Math.min(nearest, dist(opponent.x, opponent.y, x, y));
  }
  return clamp01(1 - (nearest - 1.5) / 2.5);
}

