// The match engine: one tick of football, repeated 54,000 times.
//
// Contract with every client (design §12): the engine owns MatchState and nothing outside
// this module may write to it. Clients read state and consume the MatchEvent[] returned by
// step(). The renderer interpolates between ticks; it never advances one.
//
// Determinism is the other half of the contract. Given the same seed and the same
// substitutions, `step()` produces byte-identical results — which is what lets a match be
// re-run from its seed instead of stored, and what makes any of this testable.

import { clamp, clamp01, dist, lerp, wrapAngle } from '../../core/math.js';
import { mulberry32, streamOf, type Rng } from '../../core/rng.js';
import { attrUnit } from '../ratings/attributes.js';
import {
  activePlayers,
  decideOnBall,
  invalidateActive,
  effortOf,
  findPlayer,
  positioningPass,
  possessionSide,
  reactionTicks,
  teamOf,
} from './agent.js';
import {
  attackingGoalX,
  betweenPosts,
  defendingGoalX,
  HALF_WIDTH,
  PENALTY_AREA_DEPTH,
  PITCH_LENGTH,
  PITCH_WIDTH,
  clampToPitch,
  inPenaltyArea,
  spotToPitch,
} from './pitch.js';
import { fairConditions, touchPenalty, type Conditions } from './conditions.js';
import {
  BALL_SPEED_MAX,
  CONTROL_RADIUS,
  TICK,
  rollDecayIn,
  canReachBall,
  foulChance,
  ballTravelTime,
  launchBall,
  passSpeedFor,
  stepBall,
  stepPlayer,
  strikeQuality,
  tackleChance,
} from './physics.js';
import { applyCard, cardFor, injuryChance, isOffside, stoppageFor } from './rules.js';
import { setPiecePositioning } from './setpieces.js';
import { feintChance, pickSkill, SKILL_SECONDS, skillRoll } from './skills.js';
import {
  directionOf,
  emptyPlayerStats,
  otherSide,
  type Ball,
  type MatchEvent,
  type MatchPlayer,
  type MatchResult,
  type MatchState,
  type Period,
  type Side,
  type TeamSetup,
} from './types.js';

/** Seconds in a half, before added time. */
export const HALF_SECONDS = 45 * 60;
export const FULL_SECONDS = HALF_SECONDS * 2;

const scratch = { x: 0, y: 0 };

function freshBall(): Ball {
  return {
    x: PITCH_LENGTH / 2, y: HALF_WIDTH, z: 0, vx: 0, vy: 0, vz: 0,
    ownerId: -1, lastTouchId: -1, lastTouchSide: null, loose: 0, intendedReceiverId: -1,
  };
}

export function createMatchState(
  home: TeamSetup,
  away: TeamSetup,
  conditions: Conditions = fairConditions(),
): MatchState {
  return {
    tick: 0,
    conditions,
    rollDecay: rollDecayIn(conditions),
    clock: 0,
    period: 'first',
    stoppage: 0,
    home,
    away,
    ball: freshBall(),
    play: { kind: 'kickoff', side: 'home' },
    restartDelay: 12,
    score: { home: 0, away: 0 },
    possessionTicks: { home: 0, away: 0 },
    shots: { home: 0, away: 0 },
    shotsOnTarget: { home: 0, away: 0 },
    corners: { home: 0, away: 0 },
    fouls: { home: 0, away: 0 },
    momentum: 0,
    pendingOffside: null,
    lastPasserId: -1,
    possessionTicksRun: 0,
    finished: false,
  };
}

export class MatchEngine {
  readonly state: MatchState;
  /** The seed this match was built from, so clients can seed their own streams off it. */
  readonly seed: number;
  readonly #play: Rng;
  readonly #ref: Rng;
  #events: MatchEvent[] = [];
  /**
   * Every goal and every card of the match so far, accumulated as they happen.
   *
   * These used to be collected inside `runToEnd`'s own loop, which meant they only existed
   * for a match `runToEnd` had actually simulated. A WATCHED match is stepped by the match
   * screen instead, so by the time the career layer called `runToEnd` to collect the
   * result the loop had nothing left to run and both arrays came back empty — no goal was
   * ever credited to a scorer and no booking was ever recorded for any match the player
   * watched. Season top-scorers and suspensions worked only for matches nobody saw.
   *
   * Recording them at the single point every event passes through is what makes the result
   * independent of who drove the ticks.
   */
  readonly #scorers: MatchResult['scorers'] = [];
  readonly #cards: MatchResult['cards'] = [];
  #halfStats = { goals: 0, subs: 0, cards: 0, injuries: 0 };
  #kickoffSide: Side;
  /** Whether the ball in flight was struck as a shot — the keeper's stats need to know. */
  #lastStrikeWasShot = false;
  /**
   * Per carrier, the tick before which he will not start another trick. Engine-private
   * rather than on MatchState because a trick changes nothing about the match: it is here
   * only so one duel is one trick, not ten.
   */
  readonly #skillUntil = new Map<number, number>();

  constructor(home: TeamSetup, away: TeamSetup, seed: number, conditions?: Conditions) {
    this.state = createMatchState(home, away, conditions);
    this.seed = seed;
    applyHomeAdvantage(home);
    // Separate streams so adding a referee decision cannot shift every pass in the match
    // (core/rng.ts: two subsystems sharing one stream are coupled).
    this.#play = streamOf(seed, 'play');
    this.#ref = streamOf(seed, 'referee');
    this.#kickoffSide = this.#play() < 0.5 ? 'home' : 'away';
    this.state.play = { kind: 'kickoff', side: this.#kickoffSide };
    resetForKickoff(this.state, this.#kickoffSide);
  }

  /** Advance one tick and return everything that happened in it. */
  step(): MatchEvent[] {
    this.#events = [];
    const s = this.state;
    if (s.finished) return this.#events;

    s.tick++;
    s.clock += TICK;
    invalidateActive();

    if (s.restartDelay > 0) {
      s.restartDelay--;
      // Where everyone walks to while the ball is dead. Without this the branch moved
      // players toward whatever open play last asked for, so a corner was taken with both
      // boxes empty and a free kick had no wall — about a third of a football match spent
      // milling about.
      setPiecePositioning(s);
      // A walk, not a jog. Players stroll to a dead ball — and now that they have somewhere
      // to stroll TO, the difference is real work: at 0.55 the extra distance covered over
      // a season's restarts pushed half the pitch under the amber line by full time, which
      // is the one thing `stamina.test.ts` says the tiredness model must not do.
      this.#movePlayers(0.42);
      if (s.restartDelay === 0) this.#takeRestart();
      this.#clockCheck();
      return this.#events;
    }

    positioningPass(s);
    this.#movePlayers(1);
    this.#ballPhase();
    this.#challengePhase();
    this.#trackPossession();
    this.#clockCheck();
    return this.#events;
  }

  /**
   * Run whatever is left of the match and return the compact result the career layer
   * stores.
   *
   * Safe to call on a match that has already finished — a watched one, stepped to full
   * time by the match screen — because the goals and cards it reports are accumulated by
   * `#emit` as they happen rather than by this loop. That is the whole point: the result
   * of a match must not depend on who advanced its ticks.
   */
  runToEnd(maxTicks = 80_000): MatchResult {
    let guard = 0;
    while (!this.state.finished && guard++ < maxTicks) this.step();
    const scorers = this.#scorers;
    const cards = this.#cards;
    settleRatings(this.state);
    const total = this.state.possessionTicks.home + this.state.possessionTicks.away;
    const ratings = new Map<number, number>();
    for (const t of [this.state.home, this.state.away]) {
      for (const p of [...t.players, ...t.bench]) ratings.set(p.id, p.stats.rating);
    }
    return {
      homeGoals: this.state.score.home,
      awayGoals: this.state.score.away,
      homeShots: this.state.shots.home,
      awayShots: this.state.shots.away,
      homeShotsOnTarget: this.state.shotsOnTarget.home,
      awayShotsOnTarget: this.state.shotsOnTarget.away,
      homePossession: total > 0 ? this.state.possessionTicks.home / total : 0.5,
      scorers,
      cards,
      ratings,
    };
  }

  /**
   * Bring a substitute on. Returns false if it is not allowed — the caller (the UI or the
   * AI manager) is told rather than silently ignored.
   */
  substitute(side: Side, offId: number, onId: number): boolean {
    const team = teamOf(this.state, side);
    if (team.subsUsed >= 5) return false;
    const off = team.players.find((p) => p.id === offId && p.onPitch);
    const onIdx = team.bench.findIndex((p) => p.id === onId);
    if (!off || onIdx < 0) return false;
    const on = team.bench[onIdx] as MatchPlayer;
    const slot = team.players.indexOf(off);
    on.role = off.role;
    on.x = off.x;
    on.y = off.y;
    on.vx = 0;
    on.vy = 0;
    on.facing = off.facing;
    on.onPitch = true;
    on.targetX = off.targetX;
    on.targetY = off.targetY;
    off.onPitch = false;
    team.players[slot] = on;
    team.bench.splice(onIdx, 1, off);
    team.subsUsed++;
    this.#halfStats.subs++;
    invalidateActive();
    if (this.state.ball.ownerId === off.id) this.state.ball.ownerId = -1;
    this.#emit({ type: 'substitution', side, off: offId, on: onId });
    return true;
  }

  #emit(e: MatchEvent): void {
    this.#events.push(e);
    // The match's own record of itself, kept here rather than by whoever is stepping it.
    const minute = Math.floor(this.state.clock / 60) + 1;
    if (e.type === 'goal') {
      this.#scorers.push({ playerId: e.by, side: e.side, minute, ownGoal: e.ownGoal });
    } else if (e.type === 'foul' && e.card !== 'none') {
      this.#cards.push({ playerId: e.by, side: e.side, minute, red: e.card === 'red' });
    }
  }

  #movePlayers(effortScale: number): void {
    const s = this.state;
    for (const team of [s.home, s.away]) {
      for (const p of team.players) {
        if (!p.onPitch || p.sentOff) continue;
        if (p.actionTicks > 0) {
          p.actionTicks--;
          if (p.actionTicks === 0 && p.action !== 'down') p.action = 'idle';
        }
        if (p.action === 'down') {
          p.vx *= 0.5;
          p.vy *= 0.5;
          continue;
        }
        const effort = effortOf(s, p) * effortScale;
        stepPlayer(p, TICK, effort);
        const speed = Math.hypot(p.vx, p.vy);
        if (p.actionTicks === 0) {
          p.action =
            s.ball.ownerId === p.id ? 'dribble' : speed > 5.6 ? 'sprint' : speed > 1.2 ? 'run' : 'idle';
        }
      }
    }
  }

  /** The ball: attached to its owner, or flying, plus whatever the owner decides to do. */
  #ballPhase(): void {
    const s = this.state;
    const owner = findPlayer(s, s.ball.ownerId);

    if (owner && owner.onPitch && !owner.sentOff) {
      // Glued a stride in front of the carrier. A heavy touch is the one thing that can
      // shake it loose, and how often depends on how well he can actually control it.
      const ahead = 0.45 + Math.hypot(owner.vx, owner.vy) * 0.075;
      s.ball.x = owner.x + Math.cos(owner.facing) * ahead;
      s.ball.y = owner.y + Math.sin(owner.facing) * ahead;
      s.ball.z = 0;
      s.ball.vx = owner.vx;
      s.ball.vy = owner.vy;
      s.ball.vz = 0;
      // Keep a carried ball on the pitch. Without this a keeper facing his own goal line
      // walks the ball over it and scores an own goal by standing still.
      clampToPitch(s.ball);

      const control = clamp01(
        attrUnit(owner.attrs, 'dribbling') * 0.45 +
          attrUnit(owner.attrs, 'firstTouch') * 0.3 +
          attrUnit(owner.attrs, 'technique') * 0.25,
      );
      const speedFrac = clamp01(Math.hypot(owner.vx, owner.vy) / 9);
      if (this.#play() < (1 - control) * 0.012 * (0.4 + speedFrac)) {
        launchBall(s.ball, s.ball.x, s.ball.y, s.ball.x + owner.vx, s.ball.y + owner.vy, 5 + this.#play() * 4, 0, 0.5, this.#play);
        s.ball.lastTouchId = owner.id;
        s.ball.lastTouchSide = owner.side;
      } else if (owner.decisionTicks > 0) {
        owner.decisionTicks--;
      } else {
        this.#resolveOnBall(owner);
      }
    } else {
      if (s.ball.ownerId >= 0) s.ball.ownerId = -1;
      const beforeX = s.ball.x;
      const beforeY = s.ball.y;
      stepBall(s.ball, TICK, s.conditions);
      // Out of play is decided the moment the ball crosses the line, BEFORE anybody is
      // allowed to touch it. Checked at the end of the tick instead, a player standing a
      // metre outside the touchline simply collects it and plays on — which is why this
      // engine was managing six throw-ins a match instead of forty, and why the ball was
      // in play for ninety-four minutes of a ninety-eight minute game.
      if (this.#boundaryPhase()) return;
      this.#blockPhase(beforeX, beforeY);
      this.#keeperPhase();
      this.#collectPhase();
    }
  }

  #resolveOnBall(p: MatchPlayer): void {
    const s = this.state;
    const dir = directionOf(p.side, s.period);
    const action = decideOnBall(s, p, this.#play);
    p.decisionTicks = reactionTicks(p, this.#play);

    if (action.kind === 'hold') return;

    if (action.kind === 'dribble') {
      p.targetX = action.x;
      p.targetY = action.y;
      p.action = 'dribble';
      return;
    }

    if (action.kind === 'clear') {
      const q = strikeQuality(p, s.ball, Math.atan2(action.y - p.y, action.x - p.x), touchPenalty(s.conditions));
      launchBall(s.ball, s.ball.x, s.ball.y, action.x, action.y, lerp(16, 26, q), 0.42, 0.18, this.#play);
      this.#afterStrike(p, 'pass');
      s.lastPasserId = -1;
      s.pendingOffside = null;
      return;
    }

    if (action.kind === 'cross') {
      const angle = Math.atan2(action.y - p.y, action.x - p.x);
      const q = strikeQuality(p, s.ball, angle, touchPenalty(s.conditions));
      const exec = clamp01(attrUnit(p.attrs, 'crossing') * 0.7 + attrUnit(p.attrs, 'technique') * 0.3);
      launchBall(
        s.ball, s.ball.x, s.ball.y, action.x, action.y,
        action.speed * lerp(0.85, 1.05, q), 0.5, lerp(0.14, 0.035, exec * 0.7 + q * 0.3), this.#play,
      );
      p.stats.passes++;
      this.#afterStrike(p, 'pass');
      s.lastPasserId = p.id;
      s.pendingOffside = null;
      this.#emit({ type: 'pass', from: p.id, to: -1, side: p.side, long: true });
      return;
    }

    if (action.kind === 'pass') {
      const target = action.to;
      const angle = Math.atan2(target.y - p.y, target.x - p.x);
      const q = strikeQuality(p, s.ball, angle, touchPenalty(s.conditions));
      const exec = clamp01(
        attrUnit(p.attrs, 'passing') * 0.5 + attrUnit(p.attrs, 'technique') * 0.3 + attrUnit(p.attrs, 'vision') * 0.2,
      );
      // Lead the receiver — pass to where he will be, not where he is. The flight time has
      // to account for the ball slowing down, or every pass is played behind the runner.
      const passDist = dist(p.x, p.y, target.x, target.y);
      const rawFlight = action.loft > 0.25
        ? passDist / Math.max(action.speed, 1)
        : ballTravelTime(passDist, action.speed, s.rollDecay);
      const flight = Number.isFinite(rawFlight) ? rawFlight : passDist / Math.max(action.speed, 1);
      const leadX = target.x + target.vx * flight * 0.7;
      const leadY = target.y + target.vy * flight * 0.7;
      const spread = lerp(0.105, 0.01, exec * 0.7 + q * 0.3) * (action.long ? 1.7 : 1);
      launchBall(s.ball, s.ball.x, s.ball.y, leadX, leadY, action.speed * lerp(0.82, 1.05, q), action.loft, spread, this.#play);

      p.stats.passes++;
      this.#afterStrike(p, 'pass');
      s.ball.intendedReceiverId = target.id;
      s.lastPasserId = p.id;
      this.#emit({ type: 'pass', from: p.id, to: target.id, side: p.side, long: action.long });

      // Offside is judged now, at the moment the ball is played, and remembered.
      const opponents = activePlayers(teamOf(s, otherSide(p.side)));
      s.pendingOffside = isOffside(target, s.ball.x, opponents, dir)
        ? { playerId: target.id, side: p.side }
        : null;
      return;
    }

    // A shot.
    const goalX = attackingGoalX(dir);
    const angle = Math.atan2(action.targetY - p.y, goalX - p.x);
    const q = strikeQuality(p, s.ball, angle, touchPenalty(s.conditions));
    const power = lerp(17, BALL_SPEED_MAX * 0.88, action.power) * lerp(0.72, 1.05, q);
    const d = dist(p.x, p.y, goalX, HALF_WIDTH);
    const acc = clamp01(attrUnit(p.attrs, 'finishing') * 0.55 + attrUnit(p.attrs, 'technique') * 0.2 + q * 0.25);
    const spread = lerp(0.11, 0.012, acc);
    const loft = clamp01(action.targetZ / Math.max(d, 1) * 1.6);
    launchBall(s.ball, s.ball.x, s.ball.y, goalX, action.targetY, power, loft, spread, this.#play);

    p.stats.shots++;
    s.shots[p.side]++;
    this.#afterStrike(p, 'shoot');
    s.lastPasserId = s.lastPasserId >= 0 ? s.lastPasserId : -1;
    s.pendingOffside = null;
    this.#emit({ type: 'shot', by: p.id, side: p.side, onTarget: false, distance: d });
    this.#emit({ type: 'chance', side: p.side, quality: clamp01(1 - d / 40) });
    s.momentum = clamp(s.momentum + (p.side === 'home' ? 0.12 : -0.12), -1, 1);
  }

  #afterStrike(p: MatchPlayer, action: 'pass' | 'shoot'): void {
    const s = this.state;
    this.#lastStrikeWasShot = action === 'shoot';
    s.ball.ownerId = -1;
    s.ball.lastTouchId = p.id;
    s.ball.lastTouchSide = p.side;
    s.ball.intendedReceiverId = -1;
    p.action = action === 'shoot' ? 'shoot' : 'pass';
    p.actionTicks = action === 'shoot' ? 4 : 2;
    p.decisionTicks = Math.max(p.decisionTicks, 3);
  }

  /**
   * Bodies in the way. Around a quarter of shots in real football never reach the keeper,
   * and without this the engine has no blocked shots at all — which shows up twice over,
   * as too many goals and as almost no corners, because a deflection out of play is where
   * most corners actually come from.
   *
   * Takes the ball's position before the step as well as after, because at 30 m/s the ball
   * covers three metres in a tick and a point test would miss every defender it passed
   * clean through.
   */
  #blockPhase(fromX: number, fromY: number): void {
    const s = this.state;
    const b = s.ball;
    const speed = Math.hypot(b.vx, b.vy);
    if (speed < 11 || b.z > 1.9 || !b.lastTouchSide) return;
    const defenders = teamOf(s, otherSide(b.lastTouchSide));
    const segX = b.x - fromX;
    const segY = b.y - fromY;
    const segLen = Math.hypot(segX, segY) || 1;

    for (const d of activePlayers(defenders)) {
      if (d.id === b.lastTouchId) continue;
      // Distance from the defender to the segment the ball just travelled.
      const t = clamp(((d.x - fromX) * segX + (d.y - fromY) * segY) / (segLen * segLen), 0, 1);
      const px = fromX + segX * t;
      const py = fromY + segY * t;
      const off = dist(d.x, d.y, px, py);
      if (off > 1.15) continue;

      const brave = clamp01(
        attrUnit(d.attrs, 'bravery') * 0.4 + attrUnit(d.attrs, 'positioning') * 0.35 + attrUnit(d.attrs, 'anticipation') * 0.25,
      );
      if (this.#play() > clamp01(0.35 + brave * 0.5) * clamp01(1 - off / 1.15 + 0.35)) continue;

      // Deflected, not controlled: it comes off him at a fraction of the pace and at an
      // angle he did not choose.
      // Two outcomes, because a block is not one thing. Most come back off the defender
      // and go anywhere; a good number carry on roughly where they were going, and it is
      // that second kind that ends up behind for a corner — which is where most corners in
      // real football actually come from.
      const heading = Math.atan2(b.vy, b.vx);
      const onward = this.#play() < 0.42;
      const away = heading + (this.#play() * 2 - 1) * (onward ? 0.55 : 2.4);
      const keep = onward ? 0.5 + this.#play() * 0.4 : 0.2 + this.#play() * 0.35;
      launchBall(b, px, py, px + Math.cos(away), py + Math.sin(away), speed * keep, 0.3, 0.25, this.#play);
      b.lastTouchId = d.id;
      b.lastTouchSide = d.side;
      b.intendedReceiverId = -1;
      s.lastPasserId = -1;
      s.pendingOffside = null;
      this.#lastStrikeWasShot = false;
      d.action = 'tackle';
      d.actionTicks = 3;
      return;
    }
  }

  /** The keeper's chance to do something about a ball heading for his goal. */
  #keeperPhase(): void {
    const s = this.state;
    const speed = Math.hypot(s.ball.vx, s.ball.vy);
    if (speed < 5) return;
    const wasShot = this.#lastStrikeWasShot;
    for (const side of ['home', 'away'] as const) {
      const team = teamOf(s, side);
      const gk = activePlayers(team).find((p) => p.role === 'GK');
      if (!gk) continue;
      const dir = directionOf(side, s.period);
      const goalX = defendingGoalX(dir);
      // Only when the ball is actually coming at his goal.
      const closing = dir > 0 ? s.ball.vx < -2 : s.ball.vx > 2;
      if (!closing) continue;
      if (Math.abs(s.ball.x - goalX) > PENALTY_AREA_DEPTH + 4) continue;

      // Closest the ball will pass to him over the next third of a second.
      let closest = Infinity;
      for (let t = 0; t <= 0.35; t += 0.05) {
        const bx = s.ball.x + s.ball.vx * t;
        const by = s.ball.y + s.ball.vy * t;
        const bz = Math.max(0, s.ball.z + s.ball.vz * t - 4.9 * t * t);
        if (bz > 2.6) continue;
        closest = Math.min(closest, dist(gk.x, gk.y, bx, by));
      }
      const reach =
        1.05 + attrUnit(gk.attrs, 'agility') * 1.5 + attrUnit(gk.attrs, 'reflexes') * 1.5 + attrUnit(gk.attrs, 'aerialReach') * 0.8;
      if (closest > reach) continue;

      const ease = clamp01(1 - closest / Math.max(reach, 0.01));
      const power = clamp01(speed / BALL_SPEED_MAX);
      const skill = clamp01(attrUnit(gk.attrs, 'reflexes') * 0.5 + attrUnit(gk.attrs, 'handling') * 0.3 + attrUnit(gk.attrs, 'positioning') * 0.2);
      // Calibrated against the real save rate for shots on target (~70%). The engine gets
      // more than one attempt at a fast shot as it crosses the box, so the per-attempt
      // number sits below the match-level one.
      // The RANGE here matters more than the midpoint. A wide range compounds with
      // everything else that favours the better side — more shots, better placed, against
      // a worse keeper — and a two-division mismatch comes out 8-0 instead of 3-0. Real
      // football is far more compressed than the sum of its advantages suggests, because
      // a poor keeper still saves most of what he reaches.
      const pSave = clamp01(ease * lerp(0.21, 0.37, skill) * (1 - power * 0.42));
      if (this.#play() >= pSave) continue;

      // Only a shot can be saved. Gathering a cross or a hopeful clearance is neither a
      // save nor a shot on target, and counting it as both put the save percentage above
      // one, which is not a thing.
      if (wasShot) {
        gk.stats.saves++;
        s.shotsOnTarget[otherSide(side)]++;
      }
      gk.action = 'dive';
      gk.actionTicks = 6;
      const spectacular = closest > reach * 0.6 && power > 0.6;
      this.#emit({ type: 'save', by: gk.id, side, spectacular });

      // Held or parried. A good handler keeps hold of it; a hard shot is pushed away.
      const hold = clamp01(attrUnit(gk.attrs, 'handling') * 1.1 - power * 0.7);
      if (this.#play() < hold) {
        s.ball.ownerId = gk.id;
        s.ball.vx = 0;
        s.ball.vy = 0;
        s.ball.vz = 0;
        s.ball.z = 0;
        gk.decisionTicks = 14;
      } else if (this.#play() < 0.38) {
        // Pushed behind. A keeper who can only ever parry back into play never concedes a
        // corner, and the match ends up with almost none.
        const behind = dir > 0 ? -1 : 1;
        launchBall(s.ball, gk.x, gk.y, gk.x + behind * 8, gk.y + (this.#play() * 2 - 1) * 9, 8 + this.#play() * 5, 0.3, 0.3, this.#play);
      } else {
        const away = dir > 0 ? 1 : -1;
        launchBall(s.ball, gk.x + away * 0.6, gk.y, gk.x + away * 12, gk.y + (this.#play() * 2 - 1) * 16, 9 + this.#play() * 6, 0.25, 0.5, this.#play);
      }
      s.ball.lastTouchId = gk.id;
      s.ball.lastTouchSide = side;
      s.ball.intendedReceiverId = -1;
      s.lastPasserId = -1;
      s.pendingOffside = null;
      return;
    }
  }

  /** Whoever can reach a loose ball takes control of it. */
  #collectPhase(): void {
    const s = this.state;
    if (s.ball.ownerId >= 0 || s.ball.loose > 0) return;

    let best: MatchPlayer | null = null;
    let bestD = Infinity;
    let receiver: MatchPlayer | null = null;
    let receiverD = Infinity;
    for (const team of [s.home, s.away]) {
      for (const p of activePlayers(team)) {
        if (!canReachBall(p, s.ball)) continue;
        const d = dist(p.x, p.y, s.ball.x, s.ball.y);
        if (p.id === s.ball.intendedReceiverId) {
          receiver = p;
          receiverD = d;
        }
        if (d < bestD) {
          bestD = d;
          best = p;
        }
      }
    }
    if (!best) return;

    // The man it was played to gets the benefit of knowing where it was going. A defender
    // takes it off him only by reading it — by being clearly first, not marginally nearer.
    if (receiver && best.side !== receiver.side) {
      const read = attrUnit(best.attrs, 'anticipation') * 0.6 + attrUnit(best.attrs, 'positioning') * 0.4;
      const margin = lerp(1.25, 0.35, read);
      if (receiverD - bestD < margin) {
        best = receiver;
        bestD = receiverD;
      }
    }

    // Controlling a moving ball is not free. A poor first touch bounces off him.
    const speed = Math.hypot(s.ball.vx, s.ball.vy);
    const touch = clamp01(attrUnit(best.attrs, 'firstTouch') * 0.6 + attrUnit(best.attrs, 'technique') * 0.4);
    const difficulty = clamp01(speed / 22) * (s.ball.z > 0.8 ? 1.35 : 1);
    if (this.#play() > clamp01(0.99 - difficulty * (1 - touch) * 0.55)) {
      // Bobbles away from him rather than sticking.
      launchBall(s.ball, s.ball.x, s.ball.y, s.ball.x + (this.#play() * 2 - 1) * 6, s.ball.y + (this.#play() * 2 - 1) * 6, 4 + this.#play() * 4, 0, 0.6, this.#play);
      s.ball.lastTouchId = best.id;
      s.ball.lastTouchSide = best.side;
      return;
    }

    // Offside, if it was flagged when the ball was played.
    if (s.pendingOffside && s.pendingOffside.playerId === best.id) {
      const off = s.pendingOffside;
      s.pendingOffside = null;
      this.#emit({ type: 'offside', by: off.playerId, side: off.side });
      this.#setRestart({ kind: 'freeKick', side: otherSide(off.side), x: best.x, y: best.y }, 160);
      return;
    }

    const previous = s.ball.lastTouchSide;
    const wasPass = s.lastPasserId >= 0 && s.lastPasserId !== best.id;
    if (previous === best.side && wasPass) {
      const passer = findPlayer(s, s.lastPasserId);
      if (passer) passer.stats.passesCompleted++;
      this.#emit({ type: 'passComplete', from: s.lastPasserId, to: best.id, side: best.side });
    } else if (previous && previous !== best.side) {
      best.stats.interceptions++;
      if (wasPass) this.#emit({ type: 'passIntercepted', from: s.lastPasserId, by: best.id, side: best.side });
      s.lastPasserId = -1;
      s.pendingOffside = null;
    }

    s.ball.ownerId = best.id;
    s.ball.lastTouchId = best.id;
    s.ball.lastTouchSide = best.side;
    best.decisionTicks = reactionTicks(best, this.#play);
    if (previous !== best.side) s.possessionTicksRun = 0;
  }

  /** Tackles and challenges on the man in possession. */
  #challengePhase(): void {
    const s = this.state;
    const carrier = findPlayer(s, s.ball.ownerId);
    if (!carrier || !carrier.onPitch) return;
    const opp = teamOf(s, otherSide(carrier.side));
    this.#maybeFeint(carrier, opp.players);

    for (const t of activePlayers(opp)) {
      if (t.actionTicks > 0 || t.action === 'down') continue;
      if (dist(t.x, t.y, s.ball.x, s.ball.y) > 2.0) continue;
      // Only a defender actually closing on the ball goes in for it. Without this, a
      // covering defender running alongside the carrier attempts a tackle every tick.
      const toBall = Math.atan2(s.ball.y - t.y, s.ball.x - t.x);
      const moving = Math.hypot(t.vx, t.vy);
      if (moving > 0.6 && Math.abs(wrapAngle(Math.atan2(t.vy, t.vx) - toBall)) > 1.1) continue;
      // He only goes in when he thinks it is on — aggression and bravery decide how often
      // that is, which is what makes an aggressive side foul more.
      // He only commits when he thinks it is on. The multiplier is low because this runs
      // every tick a defender is within two metres — at 0.55 a covering defender attempts
      // a tackle five times a second and the match becomes a series of fouls.
      const willingness = clamp01(0.25 + attrUnit(t.attrs, 'aggression') * 0.45 + attrUnit(t.attrs, 'bravery') * 0.3);
      if (this.#play() > willingness * 0.068) continue;

      const clean = tackleChance(t, carrier, s.ball);
      t.action = 'tackle';
      // Committed, and out of the game for over a second whether it came off or not.
      // A defender who can challenge again on the next tick is not playing football.
      t.actionTicks = 14;
      t.stats.tackles++;
      const won = this.#play() < clean;

      if (won) {
        t.stats.tacklesWon++;
        this.#emit({ type: 'tackle', by: t.id, on: carrier.id, side: t.side, won: true });
        s.ball.ownerId = t.id;
        s.ball.lastTouchId = t.id;
        s.ball.lastTouchSide = t.side;
        s.lastPasserId = -1;
        s.pendingOffside = null;
        t.decisionTicks = reactionTicks(t, this.#play);
        carrier.action = 'idle';
        s.momentum = clamp(s.momentum + (t.side === 'home' ? 0.06 : -0.06), -1, 1);
        return;
      }

      // Missed. Did he take the man with him?
      const severity = 1 - clean;
      if (this.#play() < foulChance(t, clean)) {
        this.#awardFoul(t, carrier, severity);
        return;
      }
      this.#emit({ type: 'tackle', by: t.id, on: carrier.id, side: t.side, won: false });

      // A challenge that neither wins the ball nor fouls the man still usually hits the
      // ball. Without this the engine has no ball knocked out of play in a tackle at all,
      // which is why it was playing a match with eight throw-ins in it instead of forty,
      // and almost no corners.
      if (this.#play() < 0.45) {
        const away = this.#play() * Math.PI * 2;
        launchBall(
          s.ball, s.ball.x, s.ball.y,
          s.ball.x + Math.cos(away), s.ball.y + Math.sin(away),
          4 + this.#play() * 11, 0.15, 0.4, this.#play,
        );
        s.ball.lastTouchId = t.id;
        s.ball.lastTouchSide = t.side;
        s.ball.intendedReceiverId = -1;
        s.lastPasserId = -1;
        s.pendingOffside = null;
        carrier.action = 'idle';
      } else {
        // He went in, missed the ball and missed the man: the carrier did something to
        // him. Show what. No roll is drawn — the duel was already decided above.
        this.#skill(carrier, t, true);
      }
      return;
    }
  }

  /**
   * A feint before the defender commits: a man closing in front of the carrier gets shown
   * something, sometimes, by a carrier with the flair to try it.
   */
  #maybeFeint(carrier: MatchPlayer, defenders: readonly MatchPlayer[]): void {
    const s = this.state;
    if ((this.#skillUntil.get(carrier.id) ?? 0) > s.tick) return;
    if (carrier.actionTicks > 0 || s.play.kind !== 'open') return;
    let best: MatchPlayer | null = null;
    let bestD = 3.6;
    for (const d of defenders) {
      if (!d.onPitch || d.sentOff || d.action === 'down') continue;
      const dd = dist(d.x, d.y, carrier.x, carrier.y);
      if (dd >= bestD || dd < 0.9) continue;
      // In front of him, give or take seventy degrees: a man behind him is not the one
      // being feinted.
      const bearing = Math.atan2(d.y - carrier.y, d.x - carrier.x);
      if (Math.abs(wrapAngle(bearing - carrier.facing)) > 1.2) continue;
      best = d;
      bestD = dd;
    }
    if (!best) return;
    if (skillRoll(s.tick, carrier.id, best.id) > feintChance(carrier)) return;
    this.#skill(carrier, best, false);
  }

  #skill(carrier: MatchPlayer, defender: MatchPlayer, beat: boolean): void {
    const s = this.state;
    if ((this.#skillUntil.get(carrier.id) ?? 0) > s.tick) return;
    const bearing = Math.atan2(defender.y - carrier.y, defender.x - carrier.x);
    const inFront = Math.abs(wrapAngle(bearing - carrier.facing)) < 0.6;
    const move = pickSkill(carrier, s.tick, beat, inFront);
    this.#skillUntil.set(carrier.id, s.tick + Math.ceil(SKILL_SECONDS[move] / TICK) + 12);
    this.#emit({ type: 'skill', by: carrier.id, on: defender.id, side: carrier.side, move, beat });
  }

  #awardFoul(offender: MatchPlayer, victim: MatchPlayer, severity: number): void {
    const s = this.state;
    offender.stats.fouls++;
    s.fouls[offender.side]++;
    this.#halfStats.cards++;

    const dir = directionOf(offender.side, s.period);
    const ownGoalX = defendingGoalX(dir);
    const penalty = inPenaltyArea(s.ball.x, s.ball.y, ownGoalX);

    // Last man: nobody but the keeper between the victim and the goal.
    const defenders = activePlayers(teamOf(s, offender.side)).filter((p) => p.role !== 'GK' && p.id !== offender.id);
    const victimDir = directionOf(victim.side, s.period);
    const behind = defenders.filter((d) => (victimDir > 0 ? d.x > victim.x : d.x < victim.x));
    const lastMan = behind.length === 0 && severity > 0.4;

    // Roughly one foul in six is a booking in real football; the leniency term is what
    // holds that, and a reputable side gets a shade more of the doubt.
    const leniency = 0.62 + teamOf(s, offender.side).reputation * 0.12;
    const card = applyCard(offender, cardFor(offender, severity, lastMan, leniency, this.#ref));
    if (card === 'red') invalidateActive();
    this.#emit({ type: 'foul', by: offender.id, on: victim.id, side: offender.side, card });

    if (this.#ref() < injuryChance(victim, severity)) {
      victim.injured = true;
      victim.action = 'down';
      victim.actionTicks = 30;
      this.#halfStats.injuries++;
      this.#emit({ type: 'injury', playerId: victim.id, side: victim.side });
    }

    if (penalty) {
      this.#emit({ type: 'penaltyAwarded', side: victim.side });
      this.#setRestart({ kind: 'penalty', side: victim.side }, 300);
    } else {
      const distGoal = dist(s.ball.x, s.ball.y, attackingGoalX(victimDir), HALF_WIDTH);
      this.#emit({ type: 'freeKick', side: victim.side, dangerous: distGoal < 30 });
      this.#setRestart({ kind: 'freeKick', side: victim.side, x: s.ball.x, y: s.ball.y }, 210);
    }
  }

  /** Ball out of play, and goals. Returns true when play has stopped. */
  #boundaryPhase(): boolean {
    const s = this.state;
    const b = s.ball;
    if (b.ownerId >= 0) return false;

    if (b.x < 0 || b.x > PITCH_LENGTH) {
      const goalX = b.x < 0 ? 0 : PITCH_LENGTH;
      if (betweenPosts(b.y, b.z)) {
        this.#scoreGoal(goalX);
        return true;
      }
      // Which side defends this line?
      const defending: Side = defendingGoalX(directionOf('home', s.period)) === goalX ? 'home' : 'away';
      const toucher = b.lastTouchSide;
      if (toucher === defending) {
        s.corners[otherSide(defending)]++;
        this.#emit({ type: 'corner', side: otherSide(defending) });
        this.#setRestart(
          { kind: 'corner', side: otherSide(defending), x: goalX, y: b.y < HALF_WIDTH ? 0 : PITCH_WIDTH },
          140,
        );
      } else {
        this.#emit({ type: 'goalKick', side: defending });
        this.#setRestart({ kind: 'goalKick', side: defending }, 145);
      }
      return true;
    }

    if (b.y < 0 || b.y > PITCH_WIDTH) {
      const to = b.lastTouchSide ? otherSide(b.lastTouchSide) : 'home';
      this.#emit({ type: 'throwIn', side: to });
      this.#setRestart({ kind: 'throwIn', side: to, x: clamp(b.x, 1, PITCH_LENGTH - 1), y: b.y < 0 ? 0 : PITCH_WIDTH }, 115);
      return true;
    }
    return false;
  }

  #scoreGoal(goalX: number): void {
    const s = this.state;
    const defending: Side = defendingGoalX(directionOf('home', s.period)) === goalX ? 'home' : 'away';
    const scoringSide = otherSide(defending);
    const scorer = findPlayer(s, s.ball.lastTouchId);
    const ownGoal = scorer ? scorer.side === defending : false;
    const credited: Side = ownGoal ? scoringSide : (scorer?.side ?? scoringSide);

    s.score[credited]++;
    this.#halfStats.goals++;
    if (scorer && !ownGoal) {
      scorer.stats.goals++;
      scorer.stats.shotsOnTarget++;
      s.shotsOnTarget[credited]++;
    }
    let assist: number | null = null;
    if (!ownGoal && s.lastPasserId >= 0 && s.lastPasserId !== scorer?.id) {
      const a = findPlayer(s, s.lastPasserId);
      if (a && a.side === credited) {
        a.stats.assists++;
        assist = a.id;
      }
    }
    this.#emit({ type: 'goal', by: scorer?.id ?? -1, side: credited, assist, ownGoal });
    s.momentum = credited === 'home' ? 0.75 : -0.75;
    if (scorer && !ownGoal) {
      scorer.action = 'celebrate';
      scorer.actionTicks = 35;
    }
    this.#setRestart({ kind: 'kickoff', side: defending }, 420);
  }

  #setRestart(play: MatchState['play'], delay: number): void {
    const s = this.state;
    s.play = play;
    s.restartDelay = delay;
    s.ball.ownerId = -1;
    s.ball.vx = 0;
    s.ball.vy = 0;
    s.ball.vz = 0;
    s.ball.z = 0;
    s.lastPasserId = -1;
    s.pendingOffside = null;

    switch (play.kind) {
      case 'kickoff':
        resetForKickoff(s, play.side);
        break;
      case 'throwIn':
        s.ball.x = play.x;
        s.ball.y = play.y;
        break;
      case 'corner':
        s.ball.x = play.x === 0 ? 0.4 : PITCH_LENGTH - 0.4;
        s.ball.y = play.y === 0 ? 0.4 : PITCH_WIDTH - 0.4;
        break;
      case 'goalKick': {
        const dir = directionOf(play.side, s.period);
        const gx = defendingGoalX(dir);
        s.ball.x = gx + (dir > 0 ? 5.5 : -5.5);
        s.ball.y = HALF_WIDTH;
        break;
      }
      case 'freeKick':
        s.ball.x = clamp(play.x, 1, PITCH_LENGTH - 1);
        s.ball.y = clamp(play.y, 1, PITCH_WIDTH - 1);
        break;
      case 'penalty': {
        const dir = directionOf(play.side, s.period);
        const gx = attackingGoalX(dir);
        s.ball.x = gx + (dir > 0 ? -11 : 11);
        s.ball.y = HALF_WIDTH;
        break;
      }
      default:
        break;
    }
    clampToPitch(s.ball);
  }

  /** The restart is actually taken: someone is given the ball and play resumes. */
  #takeRestart(): void {
    const s = this.state;
    const play = s.play;
    if (play.kind === 'halfTime' || play.kind === 'fullTime' || play.kind === 'open') return;

    const side: Side = play.side;
    const team = teamOf(s, side);
    const dir = directionOf(side, s.period);

    if (play.kind === 'penalty') {
      // The best finisher on the pitch takes it.
      const taker = activePlayers(team)
        .filter((p) => p.role !== 'GK')
        .sort((a, b) => attrUnit(b.attrs, 'penaltyTaking') - attrUnit(a.attrs, 'penaltyTaking'))[0];
      if (taker) {
        taker.x = s.ball.x - dir * 2;
        taker.y = HALF_WIDTH;
        taker.facing = dir > 0 ? 0 : Math.PI;
        s.ball.ownerId = taker.id;
        taker.decisionTicks = 2;
      }
      s.play = { kind: 'open' };
      // No `kickoff` event here. It used to fire one to mean "the restart has been taken",
      // which nothing consumed and which is a lie: a penalty is not a kick-off. The first
      // client to actually read the event — the commentator — duly announced "the referee
      // starts the match" every time a penalty was awarded.
      return;
    }

    // Nearest team-mate to the ball takes everything else, except a goal kick, which is
    // the keeper's.
    const candidates = activePlayers(team).filter((p) =>
      play.kind === 'goalKick' ? p.role === 'GK' : p.role !== 'GK',
    );
    const pool = candidates.length > 0 ? candidates : activePlayers(team);
    let taker: MatchPlayer | null = null;
    let bestD = Infinity;
    for (const p of pool) {
      const d = dist(p.x, p.y, s.ball.x, s.ball.y);
      if (d < bestD) {
        bestD = d;
        taker = p;
      }
    }
    if (taker) {
      taker.x = s.ball.x - Math.cos(taker.facing) * 0.7;
      taker.y = s.ball.y - Math.sin(taker.facing) * 0.7;
      taker.facing = Math.atan2(HALF_WIDTH - taker.y, attackingGoalX(dir) - taker.x);
      taker.vx = 0;
      taker.vy = 0;
      s.ball.ownerId = taker.id;
      taker.decisionTicks = 3;
    }
    if (play.kind === 'kickoff') this.#emit({ type: 'kickoff', side, period: s.period });
    s.play = { kind: 'open' };
  }

  #trackPossession(): void {
    const s = this.state;
    const side = possessionSide(s);
    if (side) {
      s.possessionTicks[side]++;
      s.possessionTicksRun++;
    }
    // Momentum decays back to level; a goal spikes it and the game absorbs it.
    s.momentum *= 0.9985;
  }

  #clockCheck(): void {
    const s = this.state;
    if (s.period === 'first' && s.clock >= HALF_SECONDS + s.stoppage) {
      if (s.stoppage === 0) {
        s.stoppage = stoppageFor(this.#halfStats.goals, this.#halfStats.subs, this.#halfStats.cards, this.#halfStats.injuries, this.#ref);
        return;
      }
      // Announce the half BEFORE winding the clock back to 45:00 for the restart, or every
      // client that stamps an event with the current minute dates half time to the minute
      // the second half starts and the match log reads 46, 47, 45.
      this.#emit({ type: 'halfTime' });
      s.period = 'second';
      s.clock = HALF_SECONDS;
      s.stoppage = 0;
      this.#halfStats = { goals: 0, subs: 0, cards: 0, injuries: 0 };
      // Ends swap; everyone goes back to their own half and the other side kicks off.
      this.#setRestart({ kind: 'kickoff', side: otherSide(this.#kickoffSide) }, 20);
      return;
    }
    if (s.period === 'second' && s.clock >= FULL_SECONDS + s.stoppage) {
      if (s.stoppage === 0) {
        s.stoppage = stoppageFor(this.#halfStats.goals, this.#halfStats.subs, this.#halfStats.cards, this.#halfStats.injuries, this.#ref);
        return;
      }
      s.period = 'over';
      s.finished = true;
      s.play = { kind: 'fullTime' };
      this.#emit({ type: 'fullTime' });
    }
  }
}

/**
 * How much better the home side plays. See `strikeQuality` for where it is applied and why
 * it is not applied to speed.
 *
 * FITTED, not picked. Over 160 even matches, against the quick engine's own home win share
 * of 0.412:
 *
 *   edge    home W    goal margin    gap to the quick engine
 *   1.000   0.344     -0.07          0.069
 *   1.030   0.381     +0.02          0.031   <-- chosen
 *   1.060   0.350     +0.04          0.063
 *
 * 1.03 is where the two engines agree most closely, and 1.06 is past the peak rather than
 * further along it. Worth stating plainly: the full engine's home margin of +0.02 is still
 * short of real football's +0.35, so home advantage here is real but weak. What it is no
 * longer is ZERO, which is what it was for the whole of the game's first life.
 */
const HOME_EDGE = 1.03;

/**
 * The home side plays a little better. Applied as its own multiplier rather than to
 * attributes, so it never pollutes the career-side view of how good a player is — see
 * `MatchPlayer.homeEdge` for why the previous home for it silently did nothing.
 */
export function applyHomeAdvantage(home: TeamSetup): void {
  for (const p of [...home.players, ...home.bench]) p.homeEdge = HOME_EDGE;
}

/** Put everyone in their own half for a kickoff, with the taking side on the ball. */
export function resetForKickoff(s: MatchState, taking: Side): void {
  s.ball.x = PITCH_LENGTH / 2;
  s.ball.y = HALF_WIDTH;
  s.ball.z = 0;
  s.ball.vx = 0;
  s.ball.vy = 0;
  s.ball.vz = 0;
  s.ball.ownerId = -1;
  s.ball.loose = 0;

  for (const side of ['home', 'away'] as const) {
    const team = teamOf(s, side);
    const dir = directionOf(side, s.period);
    const kicking = side === taking;
    team.players.forEach((p, i) => {
      if (!p.onPitch || p.sentOff) return;
      const slot = team.formation.slots[i];
      if (!slot) return;
      // Squeeze everyone into their own half; the kicking side gets two players up.
      const along = kicking && slot.along > 0.55 ? 0.49 : Math.min(slot.along, 0.47);
      spotToPitch(scratch, along, slot.across, dir);
      p.x = scratch.x;
      p.y = scratch.y;
      p.vx = 0;
      p.vy = 0;
      p.targetX = scratch.x;
      p.targetY = scratch.y;
      p.facing = dir > 0 ? 0 : Math.PI;
      p.action = 'idle';
      p.actionTicks = 0;
      p.decisionTicks = 2;
    });
  }
}

/**
 * Match ratings. Deliberately simple and legible rather than clever: a rating a player
 * cannot explain to himself is worse than a rough one he can.
 */
export function settleRatings(s: MatchState): void {
  for (const side of ['home', 'away'] as const) {
    const team = teamOf(s, side);
    const conceded = side === 'home' ? s.score.away : s.score.home;
    for (const p of [...team.players, ...team.bench]) {
      const st = p.stats;
      let r = 6.0;
      r += st.goals * 1.15;
      r += st.assists * 0.75;
      const passAcc = st.passes > 0 ? st.passesCompleted / st.passes : 0.7;
      r += (passAcc - 0.72) * 2.2;
      r += st.tacklesWon * 0.11 - (st.tackles - st.tacklesWon) * 0.05;
      r += st.interceptions * 0.07;
      r += st.saves * 0.16;
      r -= st.fouls * 0.06;
      if (p.sentOff) r -= 2.2;
      else if (p.yellow > 0) r -= 0.25;
      if (p.role === 'GK') r += conceded === 0 ? 0.6 : -conceded * 0.22;
      st.rating = Math.round(clamp(r, 1, 10) * 10) / 10;
    }
  }
}

/** Build a match-ready player from career data. */
export function makeMatchPlayer(init: {
  id: number;
  side: Side;
  shirt: number;
  name: string;
  role: MatchPlayer['role'];
  familiarity: number;
  attrs: MatchPlayer['attrs'];
  condition: number;
  onPitch: boolean;
}): MatchPlayer {
  return {
    id: init.id,
    side: init.side,
    shirt: init.shirt,
    name: init.name,
    role: init.role,
    familiarity: init.familiarity,
    // Everyone is level until `applyHomeAdvantage` says otherwise.
    homeEdge: 1,
    attrs: init.attrs,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 0,
    stamina: 1,
    condition: init.condition,
    action: 'idle',
    actionTicks: 0,
    decisionTicks: 0,
    targetX: 0,
    targetY: 0,
    yellow: 0,
    sentOff: false,
    injured: false,
    onPitch: init.onPitch,
    stats: emptyPlayerStats(),
  };
}

/** Deterministic seed for a fixture, so the same match always plays out the same way. */
export function matchSeed(saveSeed: number, season: number, round: number, homeId: number, awayId: number): number {
  return mulberry32(saveSeed ^ (season * 7919) ^ (round * 104729) ^ (homeId * 31) ^ (awayId * 131))() * 0xffffffff | 0;
}

export { TICK, CONTROL_RADIUS, passSpeedFor };
