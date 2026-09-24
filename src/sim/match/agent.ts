// What twenty-two players decide to do, ten times a second.
//
// Two very different jobs live here and the split is deliberate:
//
//   * The POSITIONING pass runs for everyone, every tick, and is cheap. It is a handful of
//     vector sums per player: hold the shape, slide with the ball, mark somebody, press.
//   * The ON-BALL decision runs for one player, and only when his reaction timer expires.
//     It is the expensive one — it scores every pass, weighs a shot against it, and
//     considers running with the ball.
//
// That asymmetry is what makes a full 90 minutes affordable. Twenty-two players each
// scoring ten pass options every tick would be twelve million evaluations a match; one
// player doing it three times a second is about fifteen thousand.

import { clamp, clamp01, dist, dist2, invLerp, lerp, remap } from '../../core/math.js';
import { attrUnit } from '../ratings/attributes.js';
import type { Rng } from '../../core/rng.js';
import {
  attackingGoalX,
  distToGoal,
  goalAngle,
  HALF_WIDTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
  inPenaltyArea,
  spotToPitch,
  defendingGoalX,
} from './pitch.js';
import { maxSpeedOf, timeToReach, ballAt, ballTravelTime, passSpeedFor } from './physics.js';
import { slotTarget } from './tactics.js';
import type { Position } from '../ratings/positions.js';
import {
  directionOf,
  type MatchPlayer,
  type MatchState,
  type Side,
  type TeamSetup,
} from './types.js';

/** Roles that hold the touchline rather than tucking in to support the ball. */
const WIDE_ROLES = new Set<Position>(['DL', 'DR', 'WBL', 'WBR', 'ML', 'MR', 'AML', 'AMR']);

const pressRank: number[] = new Array(16).fill(0);
const pressOrderBuf: number[] = [];
const markedBuf = new Set<number>();

const scratchSpot = { along: 0, across: 0 };
const scratchPos = { x: 0, y: 0 };
const scratchBall = { x: 0, y: 0, z: 0 };

// Active-player lists are asked for dozens of times a tick — by the positioning pass, by
// every pressure calculation, by every pass candidate. Rebuilding an array each time was
// measurably the most expensive thing in the engine, so the list is cached per team and
// invalidated once per tick by the engine.
const activeCache = new WeakMap<TeamSetup, { stamp: number; list: MatchPlayer[] }>();
let activeStamp = 0;

/** Called by the engine once per tick, and whenever the eleven changes. */
export function invalidateActive(): void {
  activeStamp++;
}

/** Everyone currently on the pitch for a side. The returned array must not be mutated. */
export function activePlayers(team: TeamSetup): MatchPlayer[] {
  const hit = activeCache.get(team);
  if (hit && hit.stamp === activeStamp) return hit.list;
  const list: MatchPlayer[] = [];
  for (const p of team.players) if (p.onPitch && !p.sentOff) list.push(p);
  activeCache.set(team, { stamp: activeStamp, list });
  return list;
}

export function teamOf(state: MatchState, side: Side): TeamSetup {
  return side === 'home' ? state.home : state.away;
}

export function findPlayer(state: MatchState, id: number): MatchPlayer | null {
  if (id < 0) return null;
  for (const t of [state.home, state.away]) {
    for (const p of t.players) if (p.id === id) return p;
    for (const p of t.bench) if (p.id === id) return p;
  }
  return null;
}

/**
 * How far up the pitch the ball is, from a team's point of view: 0 is on their own goal
 * line, 1 is on the opposition's. Everything about the shape keys off this.
 */
export function attackPhase(state: MatchState, side: Side): number {
  const dir = directionOf(side, state.period);
  const along = dir > 0 ? state.ball.x / PITCH_LENGTH : 1 - state.ball.x / PITCH_LENGTH;
  return clamp01(along);
}

/** The side currently in possession, or null for a genuinely loose ball. */
export function possessionSide(state: MatchState): Side | null {
  if (state.ball.ownerId < 0) return null;
  const p = findPlayer(state, state.ball.ownerId);
  return p ? p.side : null;
}

// --- positioning ---------------------------------------------------------------

/**
 * Set every player's target and effort for this tick.
 *
 * The order matters: base shape first, then the job that overrides it. A player pressing
 * the ball has abandoned his slot on purpose, and a defender marking a runner is somewhere
 * between the two.
 */
export function positioningPass(state: MatchState): void {
  const owner = possessionSide(state);
  for (const side of ['home', 'away'] as const) {
    const team = teamOf(state, side);
    const dir = directionOf(side, state.period);
    const phase = attackPhase(state, side);
    const inst = team.instructions;
    const attacking = owner === side;
    const players = activePlayers(team);
    const opponents = activePlayers(teamOf(state, side === 'home' ? 'away' : 'home'));

    // Base shape for everyone.
    for (let i = 0; i < players.length; i++) {
      const p = players[i] as MatchPlayer;
      const slot = team.formation.slots[team.players.indexOf(p)] ?? team.formation.slots[i];
      if (!slot) continue;
      slotTarget(scratchSpot, slot, inst, phase);
      spotToPitch(scratchPos, scratchSpot.along, scratchSpot.across, dir);
      p.targetX = scratchPos.x;
      p.targetY = scratchPos.y;
    }

    if (attacking) applyAttackingRuns(state, team, dir, phase);
    else applyDefensiveJobs(state, team, opponents, dir, phase);

    positionKeeper(state, team, dir);
  }

  // A loose ball is chased by whoever can actually get there, on both sides.
  if (owner === null) assignLooseBallChase(state);
}

/**
 * Off the ball, in possession: give the carrier somewhere to pass to. Players ahead of the
 * ball push on, players behind offer a safe angle, and everyone stays roughly onside —
 * modelled as "do not run beyond the last defender until the ball is going forward", which
 * is what a striker actually does.
 */
function applyAttackingRuns(
  state: MatchState,
  team: TeamSetup,
  dir: 1 | -1,
  phase: number,
): void {
  const goalX = attackingGoalX(dir);
  const carrier = findPlayer(state, state.ball.ownerId);
  const offsideX = lastDefenderX(state, team.side, dir);

  for (const p of activePlayers(team)) {
    if (p.role === 'GK') continue;
    if (carrier && p.id === carrier.id) continue;

    const ahead = dir > 0 ? p.x > state.ball.x : p.x < state.ball.x;
    const offTheBall = attrUnit(p.attrs, 'offTheBall');
    const workRate = attrUnit(p.attrs, 'workRate');

    if (ahead) {
      // Push toward the space between the ball and the goal, but respect the last man.
      const push = (0.35 + 0.55 * offTheBall) * lerp(4, 11, phase);
      p.targetX += dir * push;
      if (dir > 0) p.targetX = Math.min(p.targetX, offsideX + 0.6);
      else p.targetX = Math.max(p.targetX, offsideX - 0.6);
      // Drift off the marker rather than standing next to him.
      const marker = nearestOpponent(state, p);
      if (marker && dist(p.x, p.y, marker.x, marker.y) < 6) {
        const away = Math.sign(p.y - marker.y) || 1;
        p.targetY = clamp(p.targetY + away * (2 + 3 * offTheBall), 1, PITCH_WIDTH - 1);
      }
    } else if (state.ball.ownerId >= 0) {
      // Behind the ball: shorten the angle so there is always a way out backwards.
      //
      // Wide players tuck in only part of the way. Exempting them entirely was tried and
      // is much worse than it sounds: a winger who never comes inside is a winger who is
      // never an option, the man on the ball runs out of people to pass to, and the team
      // stops reaching the final third at all. Shots per side fell from eleven to four.
      const support = 2 + 4 * workRate;
      const toBallY = Math.sign(state.ball.y - p.y) || 0;
      p.targetY += toBallY * support * (WIDE_ROLES.has(p.role) ? 0.22 : 0.4);
      p.targetX += dir * support * 0.3;
    }

    // Nobody crowds the goalmouth from thirty yards; keep some width in the final third.
    if (Math.abs(p.targetX - goalX) < 18) {
      const spread = Math.sign(p.targetY - HALF_WIDTH) || 1;
      p.targetY = clamp(p.targetY + spread * 1.5, 2, PITCH_WIDTH - 2);
    }
    p.targetX = clamp(p.targetX, 1, PITCH_LENGTH - 1);
    p.targetY = clamp(p.targetY, 1, PITCH_WIDTH - 1);
  }
}

/**
 * Out of possession: two or three players go to the ball and everybody else holds a shape
 * between the ball and their own goal, marking whoever is nearest their zone.
 *
 * Pressing intensity decides how many go and how far up they start — the lever a player
 * pulls in §5c and sees answered within seconds.
 */
function applyDefensiveJobs(
  state: MatchState,
  team: TeamSetup,
  opponents: MatchPlayer[],
  dir: 1 | -1,
  phase: number,
): void {
  const inst = team.instructions;
  const ownGoalX = defendingGoalX(dir);
  const players = activePlayers(team).filter((p) => p.role !== 'GK');

  // Who presses: the nearest, plus a second if the instruction is aggressive enough, and
  // only if the ball is far enough up the pitch to be worth chasing.
  //
  // Rank rather than sort. Only the first three positions are ever read, and copying and
  // sorting a ten-element array twice a tick is 1.2 million allocations a match.
  const byDist = players;
  const ranked = pressRank;
  for (let i = 0; i < players.length; i++) {
    ranked[i] = dist2((players[i] as MatchPlayer).x, (players[i] as MatchPlayer).y, state.ball.x, state.ball.y);
  }
  const pressOrder = pressOrderBuf;
  pressOrder.length = 0;
  for (let k = 0; k < 3 && k < players.length; k++) {
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < players.length; i++) {
      if (pressOrder.includes(i)) continue;
      const d = ranked[i] as number;
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI >= 0) pressOrder.push(bestI);
  }
  const pressReach = lerp(28, 75, inst.pressing);
  const pressers = 1 + (inst.pressing > 0.55 ? 1 : 0) + (inst.pressing > 0.82 ? 1 : 0);

  const marked = markedBuf;
  marked.clear();
  for (let i = 0; i < byDist.length; i++) {
    const p = byDist[i] as MatchPlayer;
    const pressIndex = pressOrder.indexOf(i);
    const distToBall = dist(p.x, p.y, state.ball.x, state.ball.y);
    // Distance from OUR goal line. Getting this the wrong way round inverts the whole
    // pressing model — the team drops off in the opposition half and swarms its own box.
    const ballDepth = dir > 0 ? state.ball.x : PITCH_LENGTH - state.ball.x;
    const worthChasing = ballDepth < pressReach || distToBall < 12;

    if (pressIndex >= 0 && pressIndex < pressers && worthChasing) {
      // Close the ball down, arriving a fraction goal-side of it rather than square on —
      // a presser who runs straight at the ball gets turned every time.
      p.targetX = state.ball.x + (ownGoalX - state.ball.x) * 0.06;
      p.targetY = state.ball.y + (HALF_WIDTH - state.ball.y) * 0.06;
      continue;
    }

    // Mark the nearest unclaimed opponent who is actually a threat.
    //
    // The radius matters more than it looks. At 22 metres every defender picks up a man,
    // every attacker is marked, and the player on the ball has no safe outlet anywhere on
    // the pitch — so he plays a risky one and a third of all passes get cut out. Real
    // defending is a compact block: near the ball it is tight, and away from it players
    // hold shape and leave people spare.
    const ballDist = dist(p.x, p.y, state.ball.x, state.ball.y);
    let best: MatchPlayer | null = null;
    let bestScore = Infinity;
    if (ballDist < 34) {
      for (const o of opponents) {
        if (o.role === 'GK' || marked.has(o.id)) continue;
        const d = dist(p.targetX, p.targetY, o.x, o.y);
        if (d > 13) continue;
        if (d < bestScore) {
          bestScore = d;
          best = o;
        }
      }
    }
    if (best) {
      marked.add(best.id);
      const tightness = clamp01(0.3 + 0.5 * attrUnit(p.attrs, 'marking') + 0.25 * inst.pressing);
      // Goal-side of the man, by a metre or two.
      const gx = ownGoalX;
      const gy = HALF_WIDTH;
      const dx = gx - best.x;
      const dy = gy - best.y;
      const dl = Math.hypot(dx, dy) || 1;
      const offset = lerp(4.6, 2.1, tightness);
      const markX = best.x + (dx / dl) * offset;
      const markY = best.y + (dy / dl) * offset;
      p.targetX = lerp(p.targetX, markX, tightness);
      p.targetY = lerp(p.targetY, markY, tightness);
    }

    // The block slides toward the ball's side of the pitch — a defence does not stay
    // evenly spread while the ball is in a corner.
    const slide = lerp(0.1, 0.3, 1 - phase);
    p.targetY = lerp(p.targetY, state.ball.y, slide * 0.6);
    p.targetX = clamp(p.targetX, 1, PITCH_LENGTH - 1);
    p.targetY = clamp(p.targetY, 1, PITCH_WIDTH - 1);
  }
}

/** The keeper: on the arc between the ball and the middle of his goal, sweeping when high. */
function positionKeeper(state: MatchState, team: TeamSetup, dir: 1 | -1): void {
  const gk = activePlayers(team).find((p) => p.role === 'GK');
  if (!gk) return;
  const goalX = defendingGoalX(dir);
  const dx = state.ball.x - goalX;
  const dy = state.ball.y - HALF_WIDTH;
  const d = Math.hypot(dx, dy) || 1;

  // How far off his line: close for a distant ball, further for a ball near the box, and
  // a long way if the ball is loose in behind and he is quicker to it.
  const danger = clamp01(1 - d / 40);
  const sweep = lerp(0.6, 5.5, danger) + attrUnit(gk.attrs, 'rushingOut') * 3.5 * danger;
  gk.targetX = goalX + (dx / d) * sweep;
  gk.targetY = HALF_WIDTH + (dy / d) * Math.min(Math.abs(dy), 5.5) * 0.9;

  // Come and claim a loose ball in the six-yard area rather than watching it.
  if (
    state.ball.ownerId < 0 &&
    inPenaltyArea(state.ball.x, state.ball.y, goalX) &&
    dist(gk.x, gk.y, state.ball.x, state.ball.y) < 14
  ) {
    gk.targetX = state.ball.x;
    gk.targetY = state.ball.y;
  }
  gk.targetX = clamp(gk.targetX, 0.4, PITCH_LENGTH - 0.4);
  gk.targetY = clamp(gk.targetY, 2, PITCH_WIDTH - 2);
}

/** x of the deepest outfield defender of the side defending against `side`. */
export function lastDefenderX(state: MatchState, side: Side, dir: 1 | -1): number {
  const opp = teamOf(state, side === 'home' ? 'away' : 'home');
  const xs = activePlayers(opp)
    .filter((p) => p.role !== 'GK')
    .map((p) => p.x);
  if (xs.length === 0) return dir > 0 ? PITCH_LENGTH : 0;
  // The offside line is the SECOND-last defender, the keeper usually being the last.
  return dir > 0 ? Math.max(...xs) : Math.min(...xs);
}

export function nearestOpponent(state: MatchState, p: MatchPlayer): MatchPlayer | null {
  const opp = teamOf(state, p.side === 'home' ? 'away' : 'home');
  let best: MatchPlayer | null = null;
  let bestD = Infinity;
  for (const o of activePlayers(opp)) {
    const d = dist(p.x, p.y, o.x, o.y);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

/** How hard this player is being closed down, 0 (free) to 1 (smothered). */
export function pressureOn(state: MatchState, p: MatchPlayer): number {
  const opp = teamOf(state, p.side === 'home' ? 'away' : 'home');
  let acc = 0;
  for (const o of activePlayers(opp)) {
    const d2 = dist2(p.x, p.y, o.x, o.y);
    if (d2 >= 81) continue;
    const f = 1 - Math.sqrt(d2) / 9;
    acc += f * f;
  }
  return clamp01(acc);
}

/**
 * Nobody owns the ball: everyone who can plausibly get there goes, and everyone else keeps
 * their shape. Without the second half of that sentence, a loose ball drags all twenty-two
 * players into a heap.
 */
const chaseBuf: { p: MatchPlayer; t: number }[] = [];

function assignLooseBallChase(state: MatchState): void {
  // Reused rather than reallocated: this runs on roughly half of all 58,000 ticks.
  const arrivals = chaseBuf;
  arrivals.length = 0;
  for (const team of [state.home, state.away]) {
    for (const p of activePlayers(team)) {
      // Nobody covers forty-five metres inside the four and a half seconds this looks
      // ahead, so the expensive walk along the ball's path is not worth starting.
      if (dist2(p.x, p.y, state.ball.x, state.ball.y) > 2025) continue;
      const t = interceptTime(p, state);
      if (t < 4.5) arrivals.push({ p, t });
    }
  }
  arrivals.sort((a, b) => a.t - b.t);
  // The two quickest from each side actually chase; the rest hold. Without the second
  // half of that sentence a loose ball drags all twenty-two players into a heap.
  const taken: Record<Side, number> = { home: 0, away: 0 };
  for (const { p, t } of arrivals) {
    const limit = p.role === 'GK' ? 1 : 2;
    if (taken[p.side] >= limit && p.role !== 'GK') continue;
    taken[p.side]++;
    ballAt(state.ball, t, scratchBall, state.rollDecay);
    p.targetX = scratchBall.x;
    p.targetY = scratchBall.y;
  }
}

/**
 * Earliest time this player can meet the ball, found by walking forward through the ball's
 * own path rather than aiming at where it is now. Chasing the ball's current position is
 * how a simulated player ends up permanently three metres behind it.
 */
export function interceptTime(p: MatchPlayer, state: MatchState): number {
  const speed = maxSpeedOf(p);
  for (let t = 0.15; t <= 4.5; t += 0.3) {
    ballAt(state.ball, t, scratchBall, state.rollDecay);
    if (scratchBall.z > 2.6) continue;
    // Cheap lower bound before the real one: he cannot beat straight-line distance over
    // top speed, so if that alone exceeds t there is no point computing the ramp-up.
    if (dist(p.x, p.y, scratchBall.x, scratchBall.y) > speed * t) continue;
    if (timeToReach(p, scratchBall.x, scratchBall.y) <= t) return t;
  }
  return Infinity;
}

// --- on-ball decisions ---------------------------------------------------------

export type BallAction =
  | { kind: 'hold' }
  | { kind: 'dribble'; x: number; y: number }
  | { kind: 'pass'; to: MatchPlayer; speed: number; loft: number; long: boolean }
  | { kind: 'cross'; x: number; y: number; speed: number }
  | { kind: 'shoot'; power: number; targetY: number; targetZ: number }
  | { kind: 'clear'; x: number; y: number };

/**
 * Risk that a pass along this lane is cut out: sample the ball's path and ask whether any
 * opponent can be at that point before the ball is. Sampling the lane rather than testing
 * a corridor width is what lets a lofted ball over a defender be a different proposition
 * from a drilled one through him.
 */
export function interceptRisk(
  state: MatchState,
  from: MatchPlayer,
  toX: number,
  toY: number,
  speed: number,
  loft: number,
): number {
  const opp = activePlayers(teamOf(state, from.side === 'home' ? 'away' : 'home'));
  const d = dist(from.x, from.y, toX, toY);
  let worst = 0;
  const steps = 4;
  for (let i = 1; i <= steps; i++) {
    const f = i / steps;
    const px = lerp(from.x, toX, f);
    const py = lerp(from.y, toY, f);
    // Time to THIS point, not a fraction of the total: the ball is slowing down, so the
    // last third of a pass takes far longer than the first.
    const t = loft > 0.25 ? (d * f) / Math.max(speed, 1) : ballTravelTime(d * f, speed, state.rollDecay);
    if (!Number.isFinite(t)) break;
    // A lofted ball is over their heads for the middle of its journey.
    const height = loft * 4.2 * Math.sin(Math.PI * f);
    if (height > 2.3) continue;
    for (const o of opp) {
      if (o.role === 'GK') continue;
      // Cheap reject before the expensive one: nobody covers 25 metres inside a pass.
      const dx = o.x - px;
      const dy = o.y - py;
      if (dx * dx + dy * dy > 625) continue;
      const reach = timeToReach(o, px, py);
      if (reach < t - 0.05) worst = Math.max(worst, clamp01(1 - reach / Math.max(t, 0.01)));
    }
  }
  return worst;
}

/**
 * The expected value of shooting from here: geometry first, then the shooter, then who is
 * in the way. `goalAngle` doing the geometric work is what stops a shot from the byline
 * looking good just because it is close.
 */
export function shotValue(state: MatchState, p: MatchPlayer): number {
  const dir = directionOf(p.side, state.period);
  const goalX = attackingGoalX(dir);
  const d = distToGoal(p.x, p.y, goalX);
  const angle = goalAngle(p.x, p.y, goalX);
  if (angle < 0.05) return 0;

  const range = clamp01(1 - invLerp(4, 34, d));
  const finishing = attrUnit(p.attrs, 'finishing');
  const longShots = attrUnit(p.attrs, 'longShots');
  const technique = attrUnit(p.attrs, 'technique');
  const composure = attrUnit(p.attrs, 'composure');

  const skill = d > 20 ? lerp(finishing, longShots, 0.75) : finishing;
  const press = pressureOn(state, p);
  const blocked = blockedFraction(state, p, goalX);

  const base = angle * angle * range;
  return clamp01(
    base * lerp(0.58, 1.12, skill * 0.6 + technique * 0.2 + composure * 0.2) * (1 - blocked * 0.75) * (1 - press * 0.35),
  );
}

/** How much of the shooting lane is occupied by bodies, 0..1. */
function blockedFraction(state: MatchState, p: MatchPlayer, goalX: number): number {
  const opp = teamOf(state, p.side === 'home' ? 'away' : 'home');
  const dx = goalX - p.x;
  const dy = HALF_WIDTH - p.y;
  const laneLen = Math.hypot(dx, dy) || 1;
  const ux = dx / laneLen;
  const uy = dy / laneLen;
  let acc = 0;
  for (const o of activePlayers(opp)) {
    const rx = o.x - p.x;
    const ry = o.y - p.y;
    const along = rx * ux + ry * uy;
    if (along < 0.5 || along > laneLen) continue;
    const across = Math.abs(rx * -uy + ry * ux);
    if (across < 1.6) acc += (1 - across / 1.6) * (o.role === 'GK' ? 0.35 : 0.55);
  }
  return clamp01(acc);
}

/**
 * Decide what the man on the ball does. Everything is scored on the same 0..1 scale so a
 * shot, a pass and a run can genuinely be compared, and the player's own attributes decide
 * how well he sees the options in the first place — a low-Vision player considers fewer
 * of them, which is a more honest model of a bad decision than adding noise to a good one.
 */
export function decideOnBall(state: MatchState, p: MatchPlayer, rng: Rng): BallAction {
  const dir = directionOf(p.side, state.period);
  const goalX = attackingGoalX(dir);
  const ownGoalX = defendingGoalX(dir);
  const team = teamOf(state, p.side);
  const inst = team.instructions;
  const press = pressureOn(state, p);

  // A defender under real pressure with nothing on does the boring thing, and should.
  // Widened from "in his own penalty area" to "in his own third", because a centre-back
  // hemmed in on the edge of his box does not attempt to dribble out of it either.
  const inOwnThird = (dir > 0 ? p.x : PITCH_LENGTH - p.x) < PITCH_LENGTH * 0.32;
  if (
    (inPenaltyArea(p.x, p.y, ownGoalX) || inOwnThird) &&
    press > 0.55 &&
    attrUnit(p.attrs, 'composure') < 0.6 + rng() * 0.35
  ) {
    return {
      kind: 'clear',
      x: p.x + dir * 45,
      y: p.y < HALF_WIDTH ? 2 : PITCH_WIDTH - 2,
    };
  }

  const shoot = shotValue(state, p);

  // A cross. Football's other way of getting the ball into the box, and until now the
  // engine had no such action at all — which is why `crossing` was an attribute nothing
  // ever read, and why the ball almost never went out of play. Crosses miss constantly,
  // and a miss is a goal kick or a throw, which is most of a real match's dead time.
  const fromWing = Math.abs(p.y - HALF_WIDTH) > PITCH_WIDTH * 0.19;
  const inFinalThird = (dir > 0 ? p.x : PITCH_LENGTH - p.x) > PITCH_LENGTH * 0.63;
  let crossScore = 0;
  if (fromWing && inFinalThird) {
    const targets = activePlayers(team).filter(
      (m) => m.id !== p.id && Math.abs(m.y - HALF_WIDTH) < 16 && Math.abs(m.x - goalX) < 24,
    );
    const crossing = attrUnit(p.attrs, 'crossing');
    crossScore = targets.length === 0 ? 0 : clamp01(
      (0.22 + targets.length * 0.11) * lerp(0.5, 1.35, crossing) * (1 - press * 0.5),
    );
  }

  // Pass options. Vision and Decisions set how many candidates he even looks at.
  const vision = attrUnit(p.attrs, 'vision');
  const decisions = attrUnit(p.attrs, 'decisions');
  const considered = Math.max(3, Math.round(lerp(3, 10, vision * 0.65 + decisions * 0.35)));
  const mates = activePlayers(team)
    .filter((m) => m.id !== p.id)
    .map((m) => ({ m, d: dist(p.x, p.y, m.x, m.y) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, considered);

  let bestPass: { to: MatchPlayer; speed: number; loft: number; long: boolean; score: number } | null =
    null;
  const offsideX = lastDefenderX(state, p.side, dir);

  for (const { m, d } of mates) {
    if (d < 3 || d > 62) continue;
    // Do not play a team-mate offside. Modelled as a hard filter because a pass that is
    // always given offside is not a pass a footballer would make.
    const beyond = dir > 0 ? m.x > offsideX + 0.5 : m.x < offsideX - 0.5;
    const inOppHalf = dir > 0 ? m.x > PITCH_LENGTH / 2 : m.x < PITCH_LENGTH / 2;
    if (beyond && inOppHalf) continue;

    const long = d > 26;
    const loft = long ? clamp01(0.3 + inst.directness * 0.5) : clamp01((inst.directness - 0.55) * 0.6);
    const speed = passSpeedFor(d, 3.2, state.rollDecay) * lerp(0.85, 1.2, inst.tempo);
    const risk = interceptRisk(state, p, m.x, m.y, speed, loft);

    // Progress toward goal, normalised on the length of the pitch.
    const gain = ((dir > 0 ? m.x - p.x : p.x - m.x) / PITCH_LENGTH) * 2.4;
    const receiverSpace = 1 - pressureOn(state, m);
    // How dangerous the receiver's position actually is: how much of the goal he can see
    // from it, and how close he is. Both halves are load-bearing. Distance to the goal
    // CENTRE alone makes every pass drift infield until the match is played down a
    // twenty-metre corridor; distance to the goal LINE alone rates the corner flag as
    // highly as the six-yard box, and the team works the ball to the byline and stops.
    const receiverThreat =
      goalAngle(m.x, m.y, goalX) * clamp01(1 - distToGoal(m.x, m.y, goalX) / 48);
    // Width has its own value: moving the ball away from where the defence has gathered is
    // how a team gets out of a crowd, and it is most of what a switch of play is for.
    const crowdY = state.ball.y;
    const switchGain = clamp01(Math.abs(m.y - crowdY) / (PITCH_WIDTH * 0.55));

    // Executing it is a separate question from choosing it.
    const exec = clamp01(
      attrUnit(p.attrs, 'passing') * 0.55 +
        attrUnit(p.attrs, 'technique') * 0.25 +
        attrUnit(p.attrs, 'vision') * 0.2,
    );
    const difficulty = clamp01(d / 62) * (long ? 1.1 : 0.7);

    // The balance here is the whole character of the engine. Weighted too far toward
    // `gain`, every player hammers it forward into a crowd and half the passes are cut
    // out; weighted too far toward safety, two teams pass sideways for ninety minutes.
    // Real football is about a quarter sideways or backwards, which is what `gain` being
    // worth less than `receiverSpace` buys.
    let score =
      0.35 +
      gain * lerp(0.55, 1.35, inst.directness) +
      receiverSpace * 0.7 +
      receiverThreat * 0.62 +
      switchGain * lerp(0.08, 0.22, inst.width) -
      risk * lerp(1.6, 2.5, 1 - inst.directness) -
      difficulty * (1 - exec) * 1.2;

    // Under pressure, the safe short ball gains value and the ambitious one loses it.
    if (press > 0.45) score += (receiverSpace - difficulty) * press * 0.8;
    // Going backwards is a decision, not a failure. Only a direct side really dislikes it.
    if (gain < 0) score -= inst.directness * 0.3;

    if (!bestPass || score > bestPass.score) {
      bestPass = { to: m, speed, loft, long, score: clamp01(score) };
    }
  }

  // Running with it: worth it when there is grass ahead and he can carry it.
  const spaceAhead = spaceInFront(state, p, dir);
  const carry = clamp01(
    attrUnit(p.attrs, 'dribbling') * 0.5 +
      attrUnit(p.attrs, 'pace') * 0.2 +
      attrUnit(p.attrs, 'agility') * 0.15 +
      attrUnit(p.attrs, 'flair') * 0.15,
  );
  // Held down deliberately relative to passing: running with the ball is what you do when
  // there is no better option, not the default. Left higher, one player simply carries it
  // from his own box to theirs and the game has no passing in it at all.
  const dribbleScore = clamp01(spaceAhead * lerp(0.26, 0.92, carry) * (1 - press * 0.9));

  // Shooting is compared on the same scale, with a nudge for players who fancy it.
  const shootScore = shoot * lerp(0.92, 1.34, attrUnit(p.attrs, 'flair') * 0.4 + 0.3);
  const passScore = bestPass?.score ?? 0;

  const best = Math.max(shootScore, passScore, dribbleScore, crossScore);
  if (best <= 0.02) return { kind: 'hold' };

  if (best === crossScore && crossScore > 0) {
    // Aimed at the six-yard area, with the wide spread a cross deserves — plenty sail
    // over everybody and out for a goal kick, which is exactly what happens on a Saturday.
    const crossing = attrUnit(p.attrs, 'crossing');
    const spread = lerp(11, 3.5, crossing) * (0.6 + press * 0.7);
    return {
      kind: 'cross',
      x: goalX - dir * (6 + rng() * 7),
      y: clamp(HALF_WIDTH + (rng() * 2 - 1) * spread, -8, PITCH_WIDTH + 8),
      speed: lerp(15, 23, crossing) * (0.85 + rng() * 0.3),
    };
  }

  if (best === shootScore && shoot > 0.062) {
    const acc = clamp01(attrUnit(p.attrs, 'finishing') * 0.6 + attrUnit(p.attrs, 'composure') * 0.4);
    // The goal is 7.32m wide; aiming inside a 2m band puts nearly every shot on target,
    // about twice what real football manages. The aim point genuinely strays outside the
    // posts, and more so under pressure and from distance.
    const dGoal = distToGoal(p.x, p.y, goalX);
    const stretch = 0.7 + press * 0.9 + clamp01(dGoal / 30) * 0.6;
    const spreadY = lerp(6.8, 3.4, acc) * stretch;
    return {
      kind: 'shoot',
      power: clamp01(0.55 + rng() * 0.45),
      targetY: HALF_WIDTH + (rng() * 2 - 1) * spreadY,
      targetZ: clamp(0.2 + rng() * 2.4 + (1 - acc) * rng() * 3.0 * stretch, 0.05, 6),
    };
  }
  if (best === passScore && bestPass) {
    return { kind: 'pass', to: bestPass.to, speed: bestPass.speed, loft: bestPass.loft, long: bestPass.long };
  }

  // Carry it into the space ahead.
  const stride = lerp(3.5, 6.5, carry);
  return {
    kind: 'dribble',
    x: clamp(p.x + dir * stride, 1, PITCH_LENGTH - 1),
    y: clamp(p.y + (rng() * 2 - 1) * 1.6, 1, PITCH_WIDTH - 1),
  };
}

/** How much clear grass is ahead of this player, 0..1, out to about 15 metres. */
function spaceInFront(state: MatchState, p: MatchPlayer, dir: 1 | -1): number {
  const opp = teamOf(state, p.side === 'home' ? 'away' : 'home');
  let nearest = 15;
  for (const o of activePlayers(opp)) {
    const ahead = dir > 0 ? o.x - p.x : p.x - o.x;
    if (ahead < -1 || ahead > 15) continue;
    if (Math.abs(o.y - p.y) > 5.5) continue;
    nearest = Math.min(nearest, Math.max(0, ahead));
  }
  return clamp01(nearest / 15);
}

/** Reaction time in ticks before this player will reconsider. Sharper players think faster. */
export function reactionTicks(p: MatchPlayer, rng: Rng): number {
  const sharp = clamp01(
    attrUnit(p.attrs, 'decisions') * 0.4 + attrUnit(p.attrs, 'anticipation') * 0.3 + attrUnit(p.attrs, 'agility') * 0.3,
  );
  const tired = 1 + (1 - p.stamina) * 0.5;
  // Two to five ticks is a decision every quarter of a second, which produced roughly
  // three times the passes of a real match. A footballer holds the ball for a second or
  // two before he does something with it, even a quick one.
  //
  // The 24/9 was 16/6, and the difference is a bug's ghost. `tired` multiplies think-time
  // by up to 1.5, and under the old stamina model every player on the pitch was at zero
  // stamina from the third minute — so the engine was calibrated with a permanent 1.5x
  // applied to everybody, and the base looked like 16/6 while the match ran at 24/9.
  // Fixing the stamina model removed that multiplier and, with it, restored the decision
  // rate the pass and shot counts had been fitted against: 656 passes a team against a
  // real 450, and fifty-four shots in a mismatch.
  return Math.max(2, Math.round(remap(sharp, 0, 1, 24, 9) * tired * (0.7 + rng() * 0.6)));
}

/** Effort 0..1 — how hard this player is running right now. Drives the stamina model. */
export function effortOf(state: MatchState, p: MatchPlayer): number {
  const d = dist(p.x, p.y, p.targetX, p.targetY);
  const workRate = attrUnit(p.attrs, 'workRate');
  const base = clamp01(invLerp(0.4, 6, d));
  const ballUrgency = clamp01(1 - dist(p.x, p.y, state.ball.x, state.ball.y) / 25);
  return clamp(lerp(0.32, 1, base) * lerp(0.82, 1.05, workRate) + ballUrgency * 0.12, 0.2, 1);
}

/** Effective top speed the engine should let him use given how much he cares right now. */
export function speedCapFor(state: MatchState, p: MatchPlayer): number {
  return maxSpeedOf(p) * effortOf(state, p);
}
