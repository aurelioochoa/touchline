// The motion model. Structure is the RoboCup Soccer Server's published one — accelerate,
// move, then decay — with constants replaced by football numbers rather than robot ones:
// RoboCup's `player_speed_max` of 1.05 units per 100ms cycle is 10.5 m/s, which no human
// has ever run.
//
// Everything integrates with a real dt in seconds so the tick length is a tuning knob
// rather than baked into the constants. The engine currently steps at 100ms.

import { clamp, clamp01, dist, len, remap, turnToward, wrapAngle } from '../../core/math.js';
import { attrUnit, type Attributes } from '../ratings/attributes.js';
import { PITCH_LENGTH, PITCH_WIDTH } from './pitch.js';
import { bounceFactor, fairConditions, rollFactor, type Conditions } from './conditions.js';
import type { Ball, MatchPlayer } from './types.js';
import type { Rng } from '../../core/rng.js';

/** Seconds per simulation tick. 10 Hz — the renderer interpolates between them. */
export const TICK = 0.1;

/** A dry, still day. The default everything here was calibrated against. */
const FAIR = fairConditions();

// --- players -------------------------------------------------------------------

/** Slowest and fastest top speeds in the model, m/s. A pro squad spans most of this. */
const SPEED_MIN = 5.8;
const SPEED_MAX = 9.2;
/** Acceleration range, m/s². */
const ACCEL_MIN = 3.4;
const ACCEL_MAX = 8.0;
/** How sharply a player can change direction while moving, radians per second. */
const TURN_MIN = 2.6;
const TURN_MAX = 6.4;

/**
 * Top speed right now: what he has, reduced by how tired he is.
 *
 * The floor and the range are BOTH load-bearing, and they were re-derived when the stamina
 * model was fixed. The old pair was 0.72 + 0.28s, which reads as "tiredness costs 28% at
 * worst" — but under the old stamina bug every player sat at s = 0 from the third minute,
 * so in practice it was a flat 0.72 for everybody, the whole match ran at 72% pace, and
 * the engine's shot and pass volumes were fitted to that. Fixing stamina without touching
 * this made the game 30% faster overnight: sixteen shots a team, and a two-division
 * mismatch finishing 14-0.
 *
 * These numbers restore the pace the rest of the engine is calibrated against, and unlike
 * the old pair they actually deliver the range they claim: a fresh player runs at 0.87 of
 * his top speed and a spent one at 0.68, which is design §4's promise that the substitute
 * is visibly quicker than the man he replaced — a promise the old model never kept,
 * because everyone was already at the floor.
 */
export function maxSpeedOf(p: MatchPlayer): number {
  const base = SPEED_MIN + attrUnit(p.attrs, 'pace') * (SPEED_MAX - SPEED_MIN);
  const tired = 0.55 + 0.32 * clamp01(p.stamina);
  return base * tired * (0.9 + 0.1 * clamp01(p.condition));
}

export function accelOf(p: MatchPlayer): number {
  const base = ACCEL_MIN + attrUnit(p.attrs, 'acceleration') * (ACCEL_MAX - ACCEL_MIN);
  return base * (0.62 + 0.28 * clamp01(p.stamina));
}

export function turnRateOf(p: MatchPlayer): number {
  const agility = (attrUnit(p.attrs, 'agility') + attrUnit(p.attrs, 'balance')) / 2;
  return TURN_MIN + agility * (TURN_MAX - TURN_MIN);
}

/**
 * Move a player one tick toward his target.
 *
 * Football's whole texture is players being *almost* fast enough (design §7a), which comes
 * out of two things being modelled honestly: acceleration is finite, and changing
 * direction at speed is expensive. A player sprinting one way cannot simply start
 * sprinting the other way, and the cost of trying is what makes a good first touch worth
 * something.
 */
export function stepPlayer(p: MatchPlayer, dt: number, effort: number): void {
  // Computed once and threaded through: maxSpeedOf reads four attributes and was being
  // called twice per player per tick, 2.5 million times a match.
  const top = maxSpeedOf(p);
  const speedCap = top * clamp01(effort);
  const a = accelOf(p);

  const dx = p.targetX - p.x;
  const dy = p.targetY - p.y;
  const d = len(dx, dy);

  // Desired velocity: full tilt toward the target, easing off over the last stride so a
  // player settles on a spot instead of oscillating across it.
  let wantX = 0;
  let wantY = 0;
  if (d > 1e-4) {
    const want = Math.min(speedCap, d / Math.max(dt, 1e-3));
    wantX = (dx / d) * want;
    wantY = (dy / d) * want;
  }

  // Steering, capped by acceleration. Turning costs more than accelerating in a straight
  // line: the component of the change that is across the current heading is charged at a
  // penalty scaled by agility.
  let sx = wantX - p.vx;
  let sy = wantY - p.vy;
  const speed = len(p.vx, p.vy);
  if (speed > 0.5) {
    const hx = p.vx / speed;
    const hy = p.vy / speed;
    const along = sx * hx + sy * hy;
    const acrossX = sx - along * hx;
    const acrossY = sy - along * hy;
    const agility = (attrUnit(p.attrs, 'agility') + attrUnit(p.attrs, 'balance')) / 2;
    // At speed, a nimble player pays 0.75 of the cost of a lateral change; a lumbering
    // one pays 1.35 — which is why wingers beat centre-backs by changing direction.
    const penalty = remap(agility, 0, 1, 1.35, 0.75) * remap(speed, 2, SPEED_MAX, 1, 1.5);
    sx = along * hx + acrossX / penalty;
    sy = along * hy + acrossY / penalty;
  }

  const sm = len(sx, sy);
  const maxStep = a * dt;
  if (sm > maxStep && sm > 1e-9) {
    sx = (sx / sm) * maxStep;
    sy = (sy / sm) * maxStep;
  }
  p.vx += sx;
  p.vy += sy;

  // Hard cap, then move.
  const v = len(p.vx, p.vy);
  if (v > speedCap && v > 1e-9) {
    p.vx = (p.vx / v) * speedCap;
    p.vy = (p.vy / v) * speedCap;
  }
  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Players may drift a little past the touchline chasing a ball, but not into the stands.
  p.x = clamp(p.x, -2, PITCH_LENGTH + 2);
  p.y = clamp(p.y, -2, PITCH_WIDTH + 2);

  // Face the way he is going once he is actually going somewhere; a stationary player
  // keeps his facing so he does not spin on the spot.
  const nv = len(p.vx, p.vy);
  if (nv > 0.35) {
    p.facing = turnToward(p.facing, Math.atan2(p.vy, p.vx), turnRateOf(p) * dt);
  }

  p.stats.distanceM += nv * dt;
  drainStamina(p, nv, top, dt);
}

/**
 * Stamina. Cost rises with the square of the fraction of top speed being used, which is
 * why sprinting is expensive and jogging is nearly free, and why a pressing instruction
 * has a real price by the 70th minute rather than a notional one.
 *
 * **These constants are PER TICK, and a match is 54,000 of them.** That is the whole
 * story of this function, and getting it wrong is not subtle: the first version used
 * 5.8e-4 and 1.9e-3, which are per-tick rates that empty a full stamina bar in about
 * 1,200 ticks. Every player on the pitch was exhausted before the third minute of every
 * match ever played, which quietly destroyed the one decision design §3 promises a new
 * player in their first thirty seconds — "one of your figures is flashing amber, bring on
 * a fresh one" is not a decision when all eleven are flashing and the substitute goes the
 * same way ninety seconds later.
 *
 * The numbers below were tuned against the ENGINE, not against a constant work rate,
 * because real play is bursty and a player's average fraction of top speed is not a thing
 * you can assume — the first attempt at a fix calibrated against a flat 30% and was still
 * wrong by a factor of two once actual matches were run through it. Over four full
 * matches the twenty-two starters finish at min 0.39, p10 0.48, mean 0.66, max 0.98:
 * everybody is tired, a quarter of them are under the 0.55 the strip paints amber, and
 * nobody is empty. That distribution IS the substitution decision.
 *
 * One invariant that is easy to lose while tuning: BURN_BASE must stay below
 * RECOVER_RATE × 1.15, or a player standing still still loses stamina, and a match
 * becomes a slow slide to zero for everyone regardless of how they are used.
 * `stamina.test.ts` holds all of it.
 */
const BURN_BASE = 5.0e-6;
const BURN_SPRINT = 4.0e-5;
const RECOVER_RATE = 5.5e-6;

function drainStamina(p: MatchPlayer, speed: number, cap: number, dt: number): void {
  const frac = cap > 0 ? clamp01(speed / cap) : 0;
  const enduranceUnit = (attrUnit(p.attrs, 'stamina') * 2 + attrUnit(p.attrs, 'naturalFitness')) / 3;
  p.stamina = clamp01(p.stamina + staminaDelta(enduranceUnit, frac) * (dt / TICK));
}

/**
 * Change in stamina per tick — negative is drain. Shared by the live model and the
 * projection below so the test cannot pin something the match does not do.
 *
 * Endurance scales the SPRINT cost and the recovery, and deliberately not the base cost.
 * Standing on a football pitch costs everybody about the same; it is the running that
 * separates them. Scaling the base by fitness as well is how an unfit player ended up
 * losing stamina while stationary, which no amount of substituting can fix.
 */
function staminaDelta(enduranceUnit: number, frac: number): number {
  const burn = BURN_BASE + BURN_SPRINT * frac * frac * remap(enduranceUnit, 0, 1, 1.35, 0.72);
  const recover = RECOVER_RATE * (1 - frac) * remap(enduranceUnit, 0, 1, 1.0, 1.6);
  return recover - burn;
}

/**
 * Stamina after `ticks` at a constant fraction of top speed. Exported for the test that
 * pins the calibration above; the engine itself never calls it.
 */
export function projectStamina(
  attrs: MatchPlayer['attrs'],
  frac: number,
  ticks: number,
  from = 1,
): number {
  const enduranceUnit = (attrUnit(attrs, 'stamina') * 2 + attrUnit(attrs, 'naturalFitness')) / 3;
  return clamp01(from + staminaDelta(enduranceUnit, frac) * ticks);
}

/** Straight-line time for this player to reach a point from a standing-ish start. */
export function timeToReach(p: MatchPlayer, x: number, y: number): number {
  const d = dist(p.x, p.y, x, y);
  const v = maxSpeedOf(p);
  const a = accelOf(p);
  const rampDist = (v * v) / (2 * a);
  if (d <= rampDist) return Math.sqrt((2 * d) / a);
  return v / a + (d - rampDist) / v;
}

// --- the ball ------------------------------------------------------------------

/** Fastest a struck ball travels, m/s. A hard shot is around 30. */
export const BALL_SPEED_MAX = 38;
/** Rolling resistance on grass, as an exponential rate per second. */
const ROLL_DECAY = 0.42;
/** Air drag on a ball in flight. */
const AIR_DECAY = 0.07;
const GRAVITY = 9.81;
/** Vertical restitution on bounce; a football keeps a bit over half its height. */
const BOUNCE = 0.55;
/** Horizontal loss on bounce — grass grabs the ball. */
const BOUNCE_FRICTION = 0.76;

/**
 * The rolling resistance of a pitch in these conditions.
 *
 * THE ONE THING TO GET RIGHT HERE. `ballTravelTime`, `passSpeedFor` and `ballRestPoint`
 * are analytic inversions of this number, and the agent uses them to decide whether a pass
 * can be intercepted. Change what the ball actually does without changing all four and the
 * AI's model of the ball silently stops matching the ball — every pass goes straight to an
 * opponent, which is exactly the failure `ballTravelTime`'s own comment records. So the
 * effective decay is computed once, kept on MatchState, and passed in explicitly rather
 * than read from a module constant that only one of the four would remember to consult.
 */
export function rollDecayIn(c: Conditions): number {
  return ROLL_DECAY * rollFactor(c);
}

export function stepBall(ball: Ball, dt: number, c: Conditions = FAIR): void {
  if (ball.loose > 0) ball.loose -= 1;

  if (ball.z > 0.01 || ball.vz > 0.01) {
    // In flight. Wind acts here and nowhere else: it pushes a ball in the air and does
    // nothing measurable to one rolling through grass.
    ball.vz -= GRAVITY * dt;
    ball.vx += c.windX * dt;
    ball.vy += c.windY * dt;
    const drag = Math.exp(-AIR_DECAY * dt);
    ball.vx *= drag;
    ball.vy *= drag;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    ball.z += ball.vz * dt;
    if (ball.z <= 0) {
      ball.z = 0;
      if (Math.abs(ball.vz) > 0.6) {
        ball.vz = -ball.vz * BOUNCE;
        // Wet grass grabs less, so the ball skids off the bounce instead of sitting up.
        const grip = Math.min(BOUNCE_FRICTION * bounceFactor(c), 0.97);
        ball.vx *= grip;
        ball.vy *= grip;
      } else {
        ball.vz = 0;
      }
    }
  } else {
    ball.z = 0;
    ball.vz = 0;
    const decay = Math.exp(-rollDecayIn(c) * dt);
    ball.vx *= decay;
    ball.vy *= decay;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;
    if (len(ball.vx, ball.vy) < 0.12) {
      ball.vx = 0;
      ball.vy = 0;
    }
  }
}

/** Distance at which a player can act on the ball. */
export const CONTROL_RADIUS = 1.35;
/** Above this height the ball can only be headed, not controlled with a foot. */
export const HEADER_HEIGHT = 1.5;

export function canReachBall(p: MatchPlayer, ball: Ball): boolean {
  if (!p.onPitch || p.sentOff || p.action === 'down') return false;
  if (ball.z > 2.6) return false;
  // A ball that has left the field of play is nobody's to take, whatever they are
  // standing next to.
  if (ball.x < 0 || ball.x > PITCH_LENGTH || ball.y < 0 || ball.y > PITCH_WIDTH) return false;
  return dist(p.x, p.y, ball.x, ball.y) <= CONTROL_RADIUS;
}

/**
 * Effective striking power, following RoboCup's shape: a kick is worth less the further
 * the ball is from the striking foot and the further the target is from where the player
 * is already facing. A player who has to reach across his body, or turn, loses power and
 * accuracy — which is the whole reason first touch and body shape matter in football.
 */
export function strikeQuality(
  p: MatchPlayer,
  ball: Ball,
  targetAngle: number,
  /** How much the surface is taking off the touch, 0..1. From `touchPenalty`. */
  slip = 0,
): number {
  const d = dist(p.x, p.y, ball.x, ball.y);
  const reach = clamp01(1 - d / CONTROL_RADIUS);
  const off = Math.abs(wrapAngle(targetAngle - p.facing));
  const facing = clamp01(1 - off / Math.PI);
  const balance = attrUnit(p.attrs, 'balance');
  // Being off balance hurts less if you have balance; being unable to see the target
  // hurts everyone.
  //
  // `homeEdge` rides here rather than on top speed. Speed was tried first and measured
  // inert: over 160 even matches a 3% quicker home side finished on a WORSE goal margin
  // than a level one (-0.16 against -0.07), because a faster team closes down as well as
  // it breaks, and the two cancel inside the same match. Striking quality does not cancel
  // — it is the number every pass and every shot is graded against — which is also the
  // honest reading of what playing at home is worth: not fresher legs, but a side that
  // executes a little better in front of its own crowd.
  // A wet ball skids off the boot, and a heavy touch is a worse one. Scaled by balance
  // so the players who can handle it are the ones who do.
  const wet = slip * (1 - balance * 0.45);
  return clamp01((0.25 + 0.35 * reach + 0.4 * (facing * 0.7 + 0.3 * balance)) * p.homeEdge * (1 - wet));
}

/**
 * Send the ball toward a point at a given speed, with `spread` radians of error and an
 * optional loft. Returns the actual launch speed so callers can record how hard it was hit.
 */
export function launchBall(
  ball: Ball,
  fromX: number,
  fromY: number,
  targetX: number,
  targetY: number,
  speed: number,
  loftFraction: number,
  spread: number,
  rng: Rng,
): number {
  const base = Math.atan2(targetY - fromY, targetX - fromX);
  const angle = base + (rng() * 2 - 1) * spread;
  const s = clamp(speed * (0.92 + rng() * 0.16), 1, BALL_SPEED_MAX);
  const loft = clamp01(loftFraction);
  const horizontal = s * Math.cos(loft * (Math.PI / 2) * 0.72);
  ball.x = fromX;
  ball.y = fromY;
  ball.vx = Math.cos(angle) * horizontal;
  ball.vy = Math.sin(angle) * horizontal;
  ball.vz = s * Math.sin(loft * (Math.PI / 2) * 0.72);
  if (ball.vz > 0.05) ball.z = Math.max(ball.z, 0.15);
  ball.ownerId = -1;
  // Nobody may take control for a moment, or the striker instantly recollects his own pass.
  ball.loose = 3;
  return s;
}

/**
 * Speed needed to roll a ball `distance` metres and arrive with a little pace on it.
 * Inverted from the rolling decay, so a 30-metre pass is actually struck like one.
 */
export function passSpeedFor(distance: number, arrivalSpeed = 3.2, decay = ROLL_DECAY): number {
  // v(t) = v0 * e^(-k t) and x(t) = v0 (1 - e^(-k t)) / k  =>  v0 = k x + vArrive
  return clamp(decay * distance + arrivalSpeed, 4, BALL_SPEED_MAX);
}

/**
 * How long a ball struck at `v0` takes to roll `distance` metres.
 *
 * Not `distance / v0`. The ball is decelerating the whole way, so the naive form
 * understates the flight of a 30-metre pass by about a third — which makes every pass look
 * faster than it is, makes every interception look impossible, and is exactly how an
 * engine ends up playing passes straight to the opposition all afternoon.
 *
 * From x(t) = v0 (1 - e^(-k t)) / k, inverted. Returns Infinity when the ball cannot
 * physically get that far.
 */
export function ballTravelTime(distance: number, v0: number, decay = ROLL_DECAY): number {
  if (v0 <= 0.01) return Infinity;
  const reach = 1 - (decay * distance) / v0;
  if (reach <= 1e-4) return Infinity; // it stops short
  return -Math.log(reach) / decay;
}

/** Where a rolling ball will end up if nobody touches it. */
export function ballRestPoint(ball: Ball, out: { x: number; y: number }, decay = ROLL_DECAY): void {
  const v = len(ball.vx, ball.vy);
  if (v < 0.15) {
    out.x = ball.x;
    out.y = ball.y;
    return;
  }
  const travel = v / decay;
  out.x = ball.x + (ball.vx / v) * travel;
  out.y = ball.y + (ball.vy / v) * travel;
}

/**
 * Where the ball will be in `t` seconds, ignoring collisions. The interception logic runs
 * this for a spread of t and asks who can be there first.
 */
export function ballAt(
  ball: Ball,
  t: number,
  out: { x: number; y: number; z: number },
  decay = ROLL_DECAY,
): void {
  if (ball.z > 0.01 || ball.vz > 0.01) {
    out.x = ball.x + ball.vx * t;
    out.y = ball.y + ball.vy * t;
    out.z = Math.max(0, ball.z + ball.vz * t - 0.5 * GRAVITY * t * t);
    return;
  }
  const k = decay;
  const f = (1 - Math.exp(-k * t)) / k;
  out.x = ball.x + ball.vx * f;
  out.y = ball.y + ball.vy * f;
  out.z = 0;
}

/**
 * Tackle success, following RoboCup's positional model: the further the ball is from the
 * tackler in either axis, the more likely he misses. On top of that sits the football
 * part — his tackling against the carrier's ability to keep it away from him.
 */
export function tackleChance(
  tackler: MatchPlayer,
  carrier: MatchPlayer,
  ball: Ball,
): number {
  const dx = Math.abs(ball.x - tackler.x);
  const dy = Math.abs(ball.y - tackler.y);
  const TACKLE_DIST = 2.2;
  const TACKLE_WIDTH = 1.4;
  const fail =
    Math.pow(clamp01(dx / TACKLE_DIST), 6) + Math.pow(clamp01(dy / TACKLE_WIDTH), 6);
  const positional = clamp01(1 - fail);

  const skill =
    attrUnit(tackler.attrs, 'tackling') * 0.5 +
    attrUnit(tackler.attrs, 'anticipation') * 0.25 +
    attrUnit(tackler.attrs, 'aggression') * 0.1 +
    attrUnit(tackler.attrs, 'strength') * 0.15;
  const evade =
    attrUnit(carrier.attrs, 'dribbling') * 0.4 +
    attrUnit(carrier.attrs, 'agility') * 0.2 +
    attrUnit(carrier.attrs, 'balance') * 0.2 +
    attrUnit(carrier.attrs, 'strength') * 0.2;

  return clamp01(positional * clamp01(0.45 + (skill - evade) * 0.75));
}

/** Chance a tackle attempt is a foul, given how far it was from winning the ball cleanly. */
export function foulChance(tackler: MatchPlayer, cleanChance: number): number {
  const rash = 1 - cleanChance;
  const discipline =
    attrUnit(tackler.attrs, 'sportsmanship') * 0.4 + (1 - attrUnit(tackler.attrs, 'dirtiness')) * 0.6;
  return clamp01(rash * rash * remap(discipline, 0, 1, 0.85, 0.3));
}
