// The referee and his two assistants.
//
// Three more figures, drawn by the same instanced meshes as the players, in black. They
// cost nothing and they are most of the difference between "a football match" and "some
// men on grass": a pitch with nobody officiating it reads as a training exercise.
//
// The assistants are the interesting ones. Each holds the OFFSIDE LINE in his half — the
// deepest outfield defender — which means the flat line a kid can see running up and down
// the touchline is the same line the engine punishes his striker for crossing. Nothing
// else in the game makes that rule visible.
//
// Pure, and derived entirely from MatchState: `src/render/` reads the simulation and never
// writes to it (design §12), and three officials are a read.
//
// THE OFFICIALS MOVE, THEY ARE NOT PLACED. That is the whole shape of this file and the
// previous version got it wrong in a way no screenshot could catch. It solved a target
// position and assigned it, so every official teleported to it: measured over 400 ticks of
// a real match the referee peaked at 149.7 m/s — five hundred and forty kilometres an hour
// — and turned at 31.4 rad/s, a full half-turn inside one tick. The renderer derives a
// figure's running speed and lean from how far he moved since the last tick, so what that
// produced on screen was a black smear with its legs spinning. Every target below is
// therefore a target: `stepToward` walks him there at a human speed, and `turnToward`
// turns his head at a human rate.
//
// Two more things the old version claimed in a comment and did not do:
//
//   - **The diagonal did not exist.** `rx` was assigned the ball's own x, so the referee
//     was welded to the ball's vertical line for the entire match and only ever slid
//     sideways. It also made `facing = atan2(dy, 0)` — exactly ±90°, never anything else.
//   - **The triangle was on one side.** The old diagonal ran (0,0) to (105,68), which puts
//     the referee on the SAME touchline as the assistant covering that half. A referee's
//     diagonal runs to the corners his assistants are not on; ours now goes (0,68) to
//     (105,0), which is what actually boxes the play in on three sides.

import { clamp, wrapAngle } from '../core/math.js';
import { HALF_LENGTH, PITCH_LENGTH, PITCH_WIDTH } from '../sim/match/pitch.js';
import { TICK } from '../sim/match/physics.js';
import { directionOf, type MatchState, type Period } from '../sim/match/types.js';

export interface Official {
  x: number;
  y: number;
  facing: number;
  /**
   * Which period he was last solved in, and whether he has been solved at all.
   *
   * Both exist for the same reason: there are moments where the right answer is to be
   * somewhere else *immediately* rather than to run there. Kick-off is one — he has not
   * been anywhere yet. Half time is the other, and it is the one that matters: the ends
   * swap, so both offside lines jump the length of the pitch at once, and an assistant who
   * honoured his speed limit through that would sprint a hundred metres in front of the
   * camera. `snapOfficials` is what those two moments call.
   */
  period: Period | null;
}

/** How many officials are on the pitch. */
export const OFFICIAL_COUNT = 3;

/** Metres outside the touchline the assistants run. */
const TOUCHLINE_OFFSET = 1.4;
/** How close the referee is willing to get to the ball. */
const REF_STANDOFF = 7.5;

/**
 * Top speeds, in metres per second.
 *
 * A professional referee covers 10-12 km in a match and tops out a little under a fast
 * amateur sprint; an assistant sidesteps and back-pedals along his line and is quicker in
 * short bursts because he is only ever holding a line, not chasing play. These are the
 * numbers that turn a teleport into a run, and they are deliberately below the players'
 * own top speed — a referee who keeps up with a counter-attack is not a referee.
 */
const REF_MAX_SPEED = 6.5;
const ASSIST_MAX_SPEED = 7;

/** How fast the referee turns his shoulders, in radians per second. */
const REF_TURN_RATE = 4.5;

/**
 * How far from the diagonal toward the ball the referee stands, 0 to 1.
 *
 * Zero would keep him rigidly on the line whatever happens; one would put him on the ball.
 * A third of the way over is what makes him read as a man watching the play from an angle
 * rather than as a rail-mounted camera.
 */
const REF_LEAD = 0.35;

export function emptyOfficials(): Official[] {
  return Array.from({ length: OFFICIAL_COUNT }, () => ({
    x: HALF_LENGTH, y: 0, facing: 0, period: null,
  }));
}

/**
 * The deepest outfield defender protecting the goal at `goalX` — the offside line.
 *
 * Outfield only: the keeper is usually the last man, and the law is about the SECOND last,
 * so excluding him turns "deepest remaining" into exactly the right line.
 */
function offsideLine(state: MatchState, goalX: number): number {
  const low = goalX < HALF_LENGTH;
  let best = low ? PITCH_LENGTH : 0;
  let found = false;
  for (const side of ['home', 'away'] as const) {
    const defends = directionOf(side, state.period) > 0 ? 0 : PITCH_LENGTH;
    if (defends !== goalX) continue;
    const team = side === 'home' ? state.home : state.away;
    for (const p of team.players) {
      if (!p.onPitch || p.sentOff || p.role === 'GK') continue;
      best = low ? Math.min(best, p.x) : Math.max(best, p.x);
      found = true;
    }
  }
  return found ? best : HALF_LENGTH;
}

/** Where one official is trying to get to this tick. Position only; facing is separate. */
interface Target {
  x: number;
  y: number;
  facing: number;
}

const TARGETS: Target[] = Array.from({ length: OFFICIAL_COUNT }, () => ({ x: 0, y: 0, facing: 0 }));

/**
 * The referee's target: a point on his diagonal, leaned toward the ball, never on it.
 *
 * The diagonal runs corner to corner from (0, PITCH_WIDTH) to (PITCH_LENGTH, 0) — the two
 * corners neither assistant is standing at. The ball is projected onto it, the result is
 * pulled `REF_LEAD` of the way toward the ball, and then pushed back out along the line
 * joining the two if that brought him inside the standoff.
 */
function refereeTarget(state: MatchState, out: Target): void {
  const b = state.ball;

  // Project the ball onto the diagonal. A = (0, W), B = (L, 0).
  const dx = PITCH_LENGTH;
  const dy = -PITCH_WIDTH;
  const len2 = dx * dx + dy * dy;
  const t = clamp(((b.x - 0) * dx + (b.y - PITCH_WIDTH) * dy) / len2, 0, 1);
  const px = t * dx;
  const py = PITCH_WIDTH + t * dy;

  // Lean toward the play.
  let rx = px + (b.x - px) * REF_LEAD;
  let ry = py + (b.y - py) * REF_LEAD;

  // And back off it. Both axes, which is what the previous version only claimed to do:
  // with `rx` no longer pinned to the ball's own x, the vector joining them is a real
  // direction and pushing along it moves him in x as well as y.
  const vx = rx - b.x;
  const vy = ry - b.y;
  const d = Math.hypot(vx, vy);
  if (d < REF_STANDOFF) {
    // The one case with no direction to push along is the ball sitting exactly where he
    // wants to stand, which happens whenever the ball is on the diagonal. Step off it
    // perpendicular rather than picking an axis at random.
    const nx = d < 1e-3 ? -dy / Math.sqrt(len2) : vx / d;
    const ny = d < 1e-3 ? dx / Math.sqrt(len2) : vy / d;
    rx = b.x + nx * REF_STANDOFF;
    ry = b.y + ny * REF_STANDOFF;
  }

  out.x = clamp(rx, 2, PITCH_LENGTH - 2);
  out.y = clamp(ry, 2, PITCH_WIDTH - 2);
  out.facing = Math.atan2(b.y - out.y, b.x - out.x);
}

/**
 * One assistant's target: level with the offside line in his half, or with the ball if the
 * ball is nearer his goal line than the last defender is — which is the instruction they
 * actually work to.
 */
function assistantTarget(out: Target, state: MatchState, goalX: number, y: number): void {
  const low = goalX < HALF_LENGTH;
  const line = offsideLine(state, goalX);
  const x = low ? Math.min(line, state.ball.x) : Math.max(line, state.ball.x);
  // He owns his half and does not stray past the halfway line into his colleague's.
  out.x = low ? clamp(x, 0.5, HALF_LENGTH + 1) : clamp(x, HALF_LENGTH - 1, PITCH_LENGTH - 0.5);
  out.y = y;
  // Facing across the pitch, the way a linesman stands: square to the field, watching the
  // line rather than running along staring at his own feet. Constant, so it is assigned
  // rather than turned toward — there is nothing to rate-limit.
  out.facing = y < 0 ? Math.PI / 2 : -Math.PI / 2;
}

/** Fill `TARGETS` from the state. Shared by the stepping path and the snapping one. */
function targetsFor(state: MatchState): void {
  refereeTarget(state, TARGETS[0] as Target);
  assistantTarget(TARGETS[1] as Target, state, 0, -TOUCHLINE_OFFSET);
  assistantTarget(TARGETS[2] as Target, state, PITCH_LENGTH, PITCH_WIDTH + TOUCHLINE_OFFSET);
}

/** Move `o` toward (`x`, `y`) by at most `maxStep` metres. */
function stepToward(o: Official, x: number, y: number, maxStep: number): void {
  const dx = x - o.x;
  const dy = y - o.y;
  const d = Math.hypot(dx, dy);
  if (d <= maxStep || d < 1e-6) {
    o.x = x;
    o.y = y;
    return;
  }
  o.x += (dx / d) * maxStep;
  o.y += (dy / d) * maxStep;
}

/** Turn `o` toward `facing` by at most `maxTurn` radians, the short way round. */
function turnToward(o: Official, facing: number, maxTurn: number): void {
  const delta = wrapAngle(facing - o.facing);
  o.facing = wrapAngle(o.facing + clamp(delta, -maxTurn, maxTurn));
}

/**
 * Put the officials exactly where they belong, with no travel.
 *
 * For kick-off, and for the two moments a step would be a hundred-metre sprint: the ends
 * swapping at half time, and the first solve of a match.
 */
export function snapOfficials(state: MatchState, out: Official[]): void {
  targetsFor(state);
  for (let i = 0; i < OFFICIAL_COUNT; i++) {
    const o = out[i] as Official;
    const t = TARGETS[i] as Target;
    o.x = t.x;
    o.y = t.y;
    o.facing = t.facing;
    o.period = state.period;
  }
}

/**
 * Where the three officials are this tick.
 *
 * `out` is written in place — this runs every simulation tick and allocating three objects
 * a tick for ninety minutes is 54,000 objects for nothing. It is also the officials' only
 * memory: they move FROM where `out` says they were, so passing a fresh array every tick
 * would restore exactly the teleporting this function exists to stop.
 */
export function officialsFor(state: MatchState, out: Official[], dt: number = TICK): void {
  const first = out[0] as Official;
  if (first.period === null || first.period !== state.period) {
    snapOfficials(state, out);
    return;
  }

  targetsFor(state);
  const ref = out[0] as Official;
  const refTarget = TARGETS[0] as Target;
  stepToward(ref, refTarget.x, refTarget.y, REF_MAX_SPEED * dt);
  turnToward(ref, refTarget.facing, REF_TURN_RATE * dt);
  ref.period = state.period;

  for (let i = 1; i < OFFICIAL_COUNT; i++) {
    const o = out[i] as Official;
    const t = TARGETS[i] as Target;
    stepToward(o, t.x, t.y, ASSIST_MAX_SPEED * dt);
    o.facing = t.facing;
    o.period = state.period;
  }
}
