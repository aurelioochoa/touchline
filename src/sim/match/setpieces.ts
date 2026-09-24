// Where twenty-two players stand while the ball is not in play.
//
// Before this file the answer was "wherever open play last told them to", because
// `positioningPass` never looked at `state.play.kind` and the engine's restart branch set
// no targets at all. So a corner was taken with both boxes empty, a free kick had no wall,
// and a kickoff had both teams strolling wherever they had drifted. Restarts are about a
// third of a football match; getting them wrong is not a detail.
//
// Everything here is a pure function of MatchState — no RNG, no engine state, no
// Three.js — which is what lets `setpieces.test.ts` assert the laws of the game directly:
// a wall really is 9.15m from the ball, a kickoff really does have both teams in their own
// half, a penalty really does have nobody but the taker and the keeper inside the area.
//
// ROLE ASSIGNMENT IS BY FORMATION DEPTH, NOT BY DISTANCE. Sorting by "who is nearest"
// looks obvious and churns: two players swap places, swap jobs, and set off toward each
// other's targets for the rest of the restart. A player's slot in the shape does not
// change while the ball is dead, so it is the key that keeps a job with one man.

import { clamp } from '../../core/math.js';
import {
  CENTRE_CIRCLE_RADIUS,
  GOAL_WIDTH,
  HALF_WIDTH,
  PENALTY_AREA_DEPTH,
  PENALTY_AREA_WIDTH,
  PENALTY_SPOT_DIST,
  PITCH_LENGTH,
  PITCH_WIDTH,
  attackingGoalX,
  defendingGoalX,
  spotToPitch,
  type Direction,
} from './pitch.js';
import { directionOf, otherSide, type MatchPlayer, type MatchState, type Side } from './types.js';

/**
 * The distance every opponent must retreat at a free kick, a corner and a kickoff, and the
 * radius of the centre circle and the D. One number, one law, three places it shows up —
 * which is why the centre circle is the size it is.
 */
export const RESTART_CLEARANCE = 9.15;

/** A player together with the shape slot he is filling. */
interface Slotted {
  p: MatchPlayer;
  along: number;
  across: number;
}

const scratch = { x: 0, y: 0 };

/** The active eleven with their formation slots, deepest first. Stable for a whole restart. */
function slotted(state: MatchState, side: Side): Slotted[] {
  const team = side === 'home' ? state.home : state.away;
  const out: Slotted[] = [];
  for (let i = 0; i < team.players.length; i++) {
    const p = team.players[i] as MatchPlayer;
    if (!p.onPitch || p.sentOff) continue;
    const slot = team.formation.slots[i] ?? team.formation.slots[out.length];
    out.push({ p, along: slot?.along ?? 0.5, across: slot?.across ?? 0.5 });
  }
  out.sort((a, b) => (a.along !== b.along ? a.along - b.along : a.p.id - b.p.id));
  return out;
}

/**
 * The nth player from the front of the shape, or undefined.
 *
 * Every pick in this file goes through it. A team down to nine men has fewer players than
 * a corner routine wants, and indexing past the end used to throw inside the engine's
 * hot loop — a crash that only showed up in the matches where somebody was sent off.
 */
function at(list: Slotted[], index: number): Slotted | undefined {
  return index >= 0 && index < list.length ? list[index] : undefined;
}

/** Counting back from the most advanced player. */
function fromFront(list: Slotted[], back: number): Slotted | undefined {
  return at(list, list.length - 1 - back);
}

function put(p: MatchPlayer, x: number, y: number): void {
  p.targetX = clamp(x, -1.5, PITCH_LENGTH + 1.5);
  p.targetY = clamp(y, -1.5, PITCH_WIDTH + 1.5);
}

/** Face the point you are about to kick toward, or the ball if you are not taking it. */
function faceBall(p: MatchPlayer, state: MatchState): void {
  p.facing = Math.atan2(state.ball.y - p.y, state.ball.x - p.x);
}

/**
 * Everyone to their own shape, squeezed into a band of the pitch.
 *
 * `along` is measured from the team's OWN goal — 0 is their goal line, 1 is the
 * opposition's — which is the convention `spotToPitch` uses and the one it is easy to get
 * backwards. Clamping a side that is defending a corner to `0.62..0.95` does not pack them
 * into their box, it marches them the length of the pitch away from it.
 */
function baseShape(rows: Slotted[], dir: Direction, minAlong: number, maxAlong: number): void {
  for (const s of rows) {
    spotToPitch(scratch, clamp(s.along, minAlong, maxAlong), s.across, dir);
    put(s.p, scratch.x, scratch.y);
  }
}

/**
 * Push a player out to `RESTART_CLEARANCE` from the ball if he is inside it.
 *
 * The law every restart shares, and the one that makes a set piece look like a set piece:
 * a ring of daylight round the ball that nobody stands in.
 */
function clearOf(p: MatchPlayer, ballX: number, ballY: number, radius = RESTART_CLEARANCE): void {
  const dx = p.targetX - ballX;
  const dy = p.targetY - ballY;
  const d = Math.hypot(dx, dy);
  if (d >= radius) return;
  if (d < 1e-3) {
    put(p, ballX, ballY + radius);
    return;
  }
  put(p, ballX + (dx / d) * radius, ballY + (dy / d) * radius);
}

/**
 * Set every active player's target for a dead ball.
 *
 * Returns false for open play, so the caller can fall through to the normal shape.
 */
export function setPiecePositioning(state: MatchState): boolean {
  const play = state.play;
  if (play.kind === 'open' || play.kind === 'halfTime' || play.kind === 'fullTime') return false;

  const taking = play.side;
  const defending = otherSide(taking);
  const attack = slotted(state, taking);
  const defence = slotted(state, defending);
  const dirA = directionOf(taking, state.period);
  const dirD = directionOf(defending, state.period);

  switch (play.kind) {
    case 'kickoff':
      kickoff(state, attack, defence, dirA, dirD);
      break;
    case 'corner':
      corner(state, attack, defence, dirA, dirD);
      break;
    case 'freeKick':
      freeKick(state, attack, defence, dirA, dirD);
      break;
    case 'throwIn':
      throwIn(state, attack, defence, dirA, dirD);
      break;
    case 'goalKick':
      goalKick(state, attack, defence, dirA, dirD);
      break;
    case 'penalty':
      penalty(state, attack, defence, dirA, dirD);
      break;
  }

  for (const s of [...attack, ...defence]) faceBall(s.p, state);
  return true;
}

// ---- the six restarts -----------------------------------------------------------

/**
 * Kickoff. Both teams wholly in their own half — the one restart where that is a law
 * rather than a habit — and only the side kicking off may be inside the circle.
 */
function kickoff(
  state: MatchState,
  attack: Slotted[],
  defence: Slotted[],
  dirA: Direction,
  dirD: Direction,
): void {
  baseShape(attack, dirA, 0.03, 0.46);
  baseShape(defence, dirD, 0.03, 0.44);

  // Two forwards over the ball; everyone else out of the circle.
  const takers = attack.slice(-2);
  const bx = state.ball.x;
  const by = state.ball.y;
  takers.forEach((s, i) => put(s.p, bx - dirA * (i === 0 ? 1.1 : 2.4), by + (i === 0 ? -0.9 : 2.6)));
  for (const s of attack) {
    if (takers.includes(s)) continue;
    clearOf(s.p, bx, by, CENTRE_CIRCLE_RADIUS + 0.4);
  }
  for (const s of defence) clearOf(s.p, bx, by, CENTRE_CIRCLE_RADIUS + 0.4);
}

/**
 * A corner. The attacking box fills up, the defending one fills up around it, and two
 * defenders take the posts — which is the picture a corner has and the reason a corner is
 * worth watching rather than a throw-in with a longer run-up.
 */
function corner(
  state: MatchState,
  attack: Slotted[],
  defence: Slotted[],
  dirA: Direction,
  dirD: Direction,
): void {
  const bx = state.ball.x;
  const by = state.ball.y;
  const goalX = attackingGoalX(dirA);
  const nearSide = by < HALF_WIDTH ? -1 : 1;
  /** Into the pitch from the goal line, on the attacking side's axis. */
  const depth = (m: number): number => goalX + (dirA > 0 ? -m : m);

  baseShape(attack, dirA, 0.3, 0.9);
  baseShape(defence, dirD, 0.02, 0.35);

  // Taker at the flag, and one short option a few metres up the touchline.
  const taker = fromFront(attack, 0);
  if (taker) put(taker.p, bx + (dirA > 0 ? -0.9 : 0.9), by - nearSide * 0.9);
  const shortOption = fromFront(attack, 1);
  if (shortOption) put(shortOption.p, depth(9), by - nearSide * 5.5);

  // The box: four in an arc from the near post to the penalty spot.
  //
  // Four and not five, and the difference is worth a paragraph. Committing seven men to a
  // corner reversed home advantage on its own: the side that wins more corners is the side
  // on top, so a routine that leaves four men against a counter punishes exactly whoever
  // is playing well. Measured over 40 even matches it took the home margin from +0.33 to
  // -0.40. A corner is supposed to be worth having.
  const inBox = attack.slice(-6, -2);
  inBox.forEach((s, i) => {
    const t = inBox.length > 1 ? i / (inBox.length - 1) : 0.5;
    put(s.p, depth(5.5 + t * 8), HALF_WIDTH + nearSide * (5.2 - t * 9.4));
  });
  // The deepest two hold the halfway line against the counter — the reason a corner is
  // not simply "send everyone".
  for (const s of attack.slice(0, attack.length - 6)) {
    spotToPitch(scratch, 0.44, s.across, dirA);
    put(s.p, scratch.x, scratch.y);
  }

  // Keeper off his line by a metre, favouring the near post.
  const keeper = defence.find((s) => s.p.role === 'GK');
  if (keeper) put(keeper.p, depth(1.4), HALF_WIDTH + nearSide * 0.8);
  const outfield = defence.filter((s) => s !== keeper);

  // Two on the posts. Nothing else in football puts a player exactly there.
  const posts = outfield.slice(0, 2);
  posts.forEach((s, i) => put(s.p, depth(0.4), HALF_WIDTH + (i === 0 ? -1 : 1) * (GOAL_WIDTH / 2 - 0.2)));
  // Everyone else goal-side of the attackers, plus one on the edge of the area.
  const markers = outfield.slice(2, 8);
  markers.forEach((s, i) => {
    const t = markers.length > 1 ? i / (markers.length - 1) : 0.5;
    put(s.p, depth(4.4 + t * 8.4), HALF_WIDTH + nearSide * (6.6 - t * 10.5));
  });
  for (const s of outfield.slice(8)) put(s.p, depth(PENALTY_AREA_DEPTH + 2), HALF_WIDTH - nearSide * 6);
}

/**
 * A free kick. Whether it gets a wall is a question about the goal, not about the pitch:
 * close enough to shoot and central enough to be worth blocking.
 */
function freeKick(
  state: MatchState,
  attack: Slotted[],
  defence: Slotted[],
  dirA: Direction,
  dirD: Direction,
): void {
  const bx = state.ball.x;
  const by = state.ball.y;
  const goalX = attackingGoalX(dirA);
  const toGoal = Math.hypot(goalX - bx, HALF_WIDTH - by);
  const dangerous = toGoal < 32;

  baseShape(attack, dirA, dangerous ? 0.55 : 0.15, dangerous ? 0.9 : 0.75);
  baseShape(defence, dirD, 0.03, dangerous ? 0.28 : 0.9);

  // The taker stands off the ball, in line with where he means to hit it.
  const taker = fromFront(attack, 0);
  const ux = (goalX - bx) / (toGoal || 1);
  const uy = (HALF_WIDTH - by) / (toGoal || 1);
  if (taker) put(taker.p, bx - ux * 2.4, by - uy * 2.4);

  const keeper = defence.find((s) => s.p.role === 'GK');
  if (keeper) {
    const guardY = HALF_WIDTH + clamp((by - HALF_WIDTH) * 0.35, -GOAL_WIDTH / 2, GOAL_WIDTH / 2);
    put(keeper.p, goalX + (dirA > 0 ? -0.9 : 0.9), guardY);
  }
  const outfield = defence.filter((s) => s !== keeper);

  if (dangerous) {
    // A wall, on the ball-to-goal line at exactly the distance the law gives, and offset
    // toward the near post because that is the half of the goal a wall is for.
    const size = toGoal < 20 ? 4 : toGoal < 26 ? 3 : 2;
    const wallX = bx + ux * RESTART_CLEARANCE;
    const wallY = by + uy * RESTART_CLEARANCE;
    // Along the wall, perpendicular to the shooting line.
    const px = -uy;
    const py = ux;
    const nearPost = by < HALF_WIDTH ? -1 : 1;
    const wall = outfield.slice(-size);
    wall.forEach((s, i) => {
      const offset = (i - (size - 1) / 2) * 0.55 - nearPost * (size * 0.28);
      put(s.p, wallX + px * offset, wallY + py * offset);
    });
    // The rest mark in the box.
    const rest = outfield.slice(0, outfield.length - size);
    rest.forEach((s, i) => {
      const t = rest.length > 1 ? i / (rest.length - 1) : 0.5;
      const depth = goalX + (dirA > 0 ? -1 : 1) * (5 + t * 9);
      put(s.p, depth, HALF_WIDTH + (t - 0.5) * PENALTY_AREA_WIDTH * 0.72);
    });
    // Attackers gamble on the second ball.
    const runners = attack.slice(-5, -1);
    runners.forEach((s, i) => {
      const t = runners.length > 1 ? i / (runners.length - 1) : 0.5;
      const depth = goalX + (dirA > 0 ? -1 : 1) * (7 + t * 8);
      put(s.p, depth, HALF_WIDTH + (t - 0.5) * PENALTY_AREA_WIDTH * 0.6);
    });
  }

  // Nobody but the taker inside the ring, whichever side they are on.
  for (const s of [...attack, ...defence]) {
    if (s === taker) continue;
    clearOf(s.p, bx, by);
  }
}

/**
 * A throw-in. The thrower is the only player in football who is meant to be off the pitch,
 * and two team-mates peel off him — one down the line, one inside.
 */
function throwIn(
  state: MatchState,
  attack: Slotted[],
  defence: Slotted[],
  dirA: Direction,
  dirD: Direction,
): void {
  const bx = state.ball.x;
  const by = state.ball.y;
  const outward = by < HALF_WIDTH ? -1 : 1;
  const along = dirA > 0 ? 1 : -1;

  baseShape(attack, dirA, 0.12, 0.82);
  baseShape(defence, dirD, 0.08, 0.9);

  // Off the pitch, behind the line, which is where the law says his feet have to be.
  const thrower = fromFront(attack, 0);
  if (thrower) put(thrower.p, bx, by + outward * 1.1);

  // Three options: down the line, inside, and one gambling ahead.
  const options: Slotted[] = [];
  const offsets: [number, number][] = [
    [along * 7, -outward * 1.4],
    [-along * 3.5, -outward * 8],
    [along * 11, -outward * 9],
  ];
  for (let i = 0; i < offsets.length; i++) {
    const s = fromFront(attack, i + 1);
    if (!s) break;
    const [ox, oy] = offsets[i] as [number, number];
    put(s.p, bx + ox, by + oy);
    options.push(s);
  }

  // One marker on each option, and one stepping up to the thrower.
  const markers = defence.filter((s) => s.p.role !== 'GK').slice(-(options.length + 1));
  markers.forEach((s, i) => {
    const t = options[i];
    if (t) put(s.p, t.p.targetX - along * 1.6, t.p.targetY + outward * 1.2);
    else put(s.p, bx + along * 1.6, by - outward * 2.6);
  });
}

/**
 * A goal kick. The keeper takes it, the defence spreads to the corners of the box to
 * receive it, everyone else pushes up to halfway — and the opposition has to be outside
 * the penalty area, which is a real law and a very legible picture.
 */
function goalKick(
  state: MatchState,
  attack: Slotted[],
  defence: Slotted[],
  dirA: Direction,
  dirD: Direction,
): void {
  const goalX = defendingGoalX(dirA);
  const into = (m: number): number => goalX + (dirA > 0 ? m : -m);

  // Both sides shuffle up; neither abandons its shape. Pressing the goal kick with the
  // whole team (`0.35` as the floor here) cost the pressing side just as dearly as an
  // over-committed corner did — -0.47 on the home margin over 40 even matches — because
  // the team doing the pressing is the team on top, and a long clearance went straight
  // through where its defenders had been standing.
  baseShape(attack, dirA, 0.1, 0.62);
  baseShape(defence, dirD, 0.22, 0.9);

  const keeper = attack.find((s) => s.p.role === 'GK');
  if (keeper) put(keeper.p, state.ball.x, state.ball.y);

  // The two deepest outfielders wide, in the corners of the area.
  const wide = attack.filter((s) => s !== keeper).slice(0, 2);
  wide.forEach((s, i) =>
    put(s.p, into(PENALTY_AREA_DEPTH - 0.5), HALF_WIDTH + (i === 0 ? -1 : 1) * (PENALTY_AREA_WIDTH / 2 - 1.5)),
  );

  // Everyone else, both sides, out of the penalty area. The attackers are kept out by law;
  // the defenders are up the pitch because that is the point of the restart.
  for (const s of attack.slice(3)) {
    spotToPitch(scratch, clamp(s.along + 0.08, 0.3, 0.62), s.across, dirA);
    put(s.p, scratch.x, scratch.y);
  }
  for (const s of defence) {
    const depth = Math.abs(s.p.targetX - goalX);
    if (depth < PENALTY_AREA_DEPTH + 1.5 && Math.abs(s.p.targetY - HALF_WIDTH) < PENALTY_AREA_WIDTH / 2 + 1.5) {
      put(s.p, into(PENALTY_AREA_DEPTH + 2.5), s.p.targetY);
    }
  }
}

/**
 * A penalty. Everyone but the taker and the keeper outside the area, outside the D, and
 * behind the ball — three conditions at once, and the D exists precisely because the
 * penalty area alone does not give the third.
 */
function penalty(
  state: MatchState,
  attack: Slotted[],
  defence: Slotted[],
  dirA: Direction,
  dirD: Direction,
): void {
  const goalX = attackingGoalX(dirA);
  const spotX = goalX + (dirA > 0 ? -PENALTY_SPOT_DIST : PENALTY_SPOT_DIST);
  const edge = goalX + (dirA > 0 ? -1 : 1) * PENALTY_AREA_DEPTH;

  baseShape(attack, dirA, 0.4, 0.95);
  baseShape(defence, dirD, 0.05, 0.6);

  const taker = fromFront(attack, 0);
  // Behind the ball, so his run-up goes toward the goal rather than away from it.
  if (taker) put(taker.p, spotX - dirA * 3.2, HALF_WIDTH);

  const keeper = defence.find((s) => s.p.role === 'GK');
  if (keeper) put(keeper.p, goalX + (dirA > 0 ? -0.35 : 0.35), HALF_WIDTH);

  // Everyone else lines the edge of the area, behind the ball and outside the D.
  const rest = [...attack.filter((s) => s !== taker), ...defence.filter((s) => s !== keeper)];
  rest.forEach((s, i) => {
    const spread = rest.length > 1 ? i / (rest.length - 1) - 0.5 : 0;
    put(s.p, edge - dirA * 1.6, HALF_WIDTH + spread * (PENALTY_AREA_WIDTH + 8));
    // Out of the D as well as out of the box: the arc is measured from the spot.
    clearOf(s.p, spotX, HALF_WIDTH, CENTRE_CIRCLE_RADIUS + 0.5);
    // And never nearer the goal than the edge of the area.
    const beyond = dirA > 0 ? s.p.targetX > edge : s.p.targetX < edge;
    if (beyond) put(s.p, edge - dirA * 1.2, s.p.targetY);
  });
}
