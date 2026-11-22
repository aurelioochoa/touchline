// The three drills and the trial, as pure rules (design player-career §3, §A).
//
// A drill is a tiny pitch — a MatchState with a handful of figures — so the same
// `momentOptions` the match uses can offer its choices, the same `interceptRisk` rings can
// rate its lanes, and the match renderer can draw it. What happens when the kid chooses is
// decided here, with a seeded stream, so a session can be tested without a browser.

import { lerp } from '../../core/math.js';
import { gauss, type Rng } from '../../core/rng.js';
import { attrUnit } from '../ratings/attributes.js';
import { createMatchState, makeMatchPlayer } from '../match/engine.js';
import { fairConditions, type Conditions } from '../match/conditions.js';
import { buildTeam } from '../match/quickTeam.js';
import { GOAL_HEIGHT, GOAL_WIDTH, HALF_WIDTH } from '../match/pitch.js';
import type { MatchPlayer, MatchState } from '../match/types.js';
import type { Attributes } from '../ratings/attributes.js';
import type { DrillKind, HeroPosition } from './hero.js';

/** How many turns each drill lasts. */
export const DRILL_TURNS: Record<DrillKind, number> = { hoops: 5, rondo: 8, gap: 3 };
/** Score thresholds for one, two and three stars. */
const STAR_STEPS: Record<DrillKind, [number, number, number]> = { hoops: [2, 5, 8], rondo: [3, 5, 8], gap: [1, 2, 3] };
/** What "Let the coach run it" earns, and the floor under a session actually played. */
export const COACH_RUN_STARS = 1;

export function drillStars(kind: DrillKind, score: number): number {
  return STAR_STEPS[kind].filter((step) => score >= step).length;
}

/** Trying is never worse than skipping (§A). */
export function sessionStars(kind: DrillKind, score: number): number {
  return Math.max(COACH_RUN_STARS, drillStars(kind, score));
}

/** A dusk session on an empty training ground. */
export function duskConditions(): Conditions {
  return { ...fairConditions(), timeOfDay: 0.72 };
}

export interface StageLayout {
  hero: [number, number];
  mates: [number, number][];
  /** Mannequins and defenders. The keeper, when there is one, is extra. */
  opponents: [number, number][];
  keeper: boolean;
}

/** Hero first in the home side, the keeper first in the away side. */
export function stageState(rng: Rng, heroAttrs: Attributes, shirt: number, layout: StageLayout): MatchState {
  const spec = { strength: 70, kitSecondary: 0xffffff } as const;
  const home = buildTeam(rng, { ...spec, side: 'home', clubId: -2, name: 'Trial', shortName: 'TRI', kitPrimary: 0xff6b1a });
  const away = buildTeam(rng, { ...spec, side: 'away', clubId: -3, name: 'Bibs', shortName: 'BIB', kitPrimary: 0x8a94a6 });
  const place = (player: MatchPlayer, [x, y]: [number, number]): MatchPlayer => {
    player.x = player.targetX = x;
    player.y = player.targetY = y;
    player.facing = 0;
    return player;
  };
  const heroFigure = place(makeMatchPlayer({
    id: 9000, side: 'home', shirt, name: '', role: 'ST', familiarity: 1, attrs: heroAttrs, condition: 1, onPitch: true,
  }), layout.hero);
  home.players = [heroFigure, ...layout.mates.map((spot, index) => place(home.players[1 + index] as MatchPlayer, spot))];
  const keeper = away.players[0] as MatchPlayer;
  away.players = [
    ...(layout.keeper ? [place(keeper, [104, HALF_WIDTH])] : []),
    ...layout.opponents.map((spot, index) => place(away.players[1 + index] as MatchPlayer, spot)),
  ];
  for (const player of away.players) player.facing = Math.PI;
  const state = createMatchState(home, away, duskConditions());
  state.play = { kind: 'open' };
  state.restartDelay = 0;
  state.ball.ownerId = heroFigure.id;
  state.ball.x = heroFigure.x + 0.5;
  state.ball.y = heroFigure.y;
  return state;
}

/** The trial's three moments: a shot, a pass then a shot, a dribble then a shot (§3). */
export const TRIAL_LAYOUTS: StageLayout[] = [
  { hero: [88, HALF_WIDTH], mates: [], opponents: [], keeper: true },
  { hero: [80, 30], mates: [[91, 21], [91, 44]], opponents: [[86, 37.5]], keeper: true },
  { hero: [78, HALF_WIDTH], mates: [], opponents: [[83, 31], [83.6, 35]], keeper: true },
];

export const DRILL_LAYOUTS: Record<DrillKind, StageLayout> = {
  hoops: { hero: [89, HALF_WIDTH], mates: [], opponents: [], keeper: true },
  rondo: { hero: [60, HALF_WIDTH], mates: [[60, 24], [70, HALF_WIDTH], [60, 44], [50, HALF_WIDTH]], opponents: [[63, 31], [57, 37]], keeper: false },
  gap: { hero: [70, HALF_WIDTH], mates: [], opponents: [[76, 31], [76.5, 37.5]], keeper: true },
};

/** Where the two defenders stand for each row of the gap run, always leaving one way through. */
export function gapRow(rng: Rng, row: number): [number, number][] {
  const x = 76 + row * 7;
  const open = Math.floor(rng() * 3);
  const lanes = [HALF_WIDTH - 3.4, HALF_WIDTH, HALF_WIDTH + 3.4];
  return lanes.filter((_lane, index) => index !== open).map((y) => [x + rng() * 0.8, y + (rng() - 0.5)]);
}

/** Rondo defenders step after every pass, to a fresh pair of spots inside the circle. */
export function rondoStep(rng: Rng): [number, number][] {
  const spot = (): [number, number] => [60 + (rng() - 0.5) * 9, HALF_WIDTH + (rng() - 0.5) * 9];
  return [spot(), spot()];
}

/** A pass along a lane rated `risk` either arrives or is cut out. */
export function passArrives(rng: Rng, risk: number): boolean {
  return rng() >= risk * 0.85;
}

/** A carry into ground rated `risk` beats the defender or is tackled. */
export function dribbleBeats(rng: Rng, risk: number, dribbler: MatchPlayer): boolean {
  return rng() >= risk * lerp(0.95, 0.55, attrUnit(dribbler.attrs, 'dribbling'));
}

export interface ShotOutcome {
  goal: boolean;
  /** Where the ball crosses the line, for the animation. */
  y: number;
  z: number;
  /** In one of the four corner hoops. */
  hoop: boolean;
}

/**
 * A strike at an aim point. It strays by up to the aim circle, and the keeper covers what
 * is near him — so the skill is placing it away from him, exactly as in a match.
 */
export function shotOutcome(rng: Rng, aimY: number, aimZ: number, spread: number, keeperY: number): ShotOutcome {
  const y = aimY + gauss(rng) * spread * 0.45;
  const z = Math.max(0.1, aimZ + gauss(rng) * spread * 0.25);
  const inFrame = Math.abs(y - HALF_WIDTH) < GOAL_WIDTH / 2 && z < GOAL_HEIGHT;
  const reach = 1.15 + (z < 1 ? 0.45 : 0);
  const saved = Math.abs(y - keeperY) < reach;
  const hoop = inFrame && Math.abs(y - HALF_WIDTH) > 2 && (z > 1.5 || z < 0.7);
  return { goal: inFrame && !saved, y, z, hoop };
}

/** Points for a hoops shot: a goal is one, a goal through a corner hoop is two. */
export function hoopPoints(outcome: ShotOutcome): number {
  return outcome.goal ? (outcome.hoop ? 2 : 1) : 0;
}

/** The keeper's slide across his line in Hoops, by turn time. */
export function keeperSlide(seconds: number): number {
  return HALF_WIDTH + Math.sin(seconds * 1.3) * 2.2;
}

/** The trial reads a position from what the kid did: shot most, passed most, or ran most. */
export function trialPosition(counts: { shoot: number; pass: number; dribble: number }): HeroPosition {
  if (counts.pass > counts.shoot && counts.pass >= counts.dribble) return 'MC';
  if (counts.dribble > counts.shoot && counts.dribble > counts.pass) return 'AML';
  return 'ST';
}
