// The quick engine: a match without simulating a match.
//
// A career has 1,900 fixtures a season across five divisions and the player watches about
// thirty-eight of them. The full engine takes a second and a half per match, so running it
// on all of them would cost forty minutes of a kid's afternoon per season, which is not a
// game. This is what FM's detail levels are for, and this is ours.
//
// The model is a possession chain rather than a positional simulation: who has the ball,
// how often that turns into a shot, and how often a shot goes in. The parameters are not
// invented — they are fitted to what the full engine produces (calibrate.ts, and the
// agreement is asserted in quick.test.ts), which is the only thing that makes the two
// interchangeable. Results that depend on whether you were watching are the failure
// players notice first.

import { clamp, clamp01, lerp } from '../../core/math.js';
import { fairConditions, touchPenalty, type Conditions } from './conditions.js';
import { gauss, type Rng } from '../../core/rng.js';
import { attrUnit } from '../ratings/attributes.js';
import { caOf } from '../ratings/ability.js';
import { activePlayers } from './agent.js';
import { settleRatings } from './engine.js';
import type { MatchPlayer, MatchResult, Side, TeamSetup } from './types.js';

// Fitted against the full engine, not invented. `fit-quick.ts` prints both engines across
// a ladder of strength mismatches, and these are the numbers that made the two agree.
//
// The shape that fitting revealed is the interesting part: a strength gap barely changes
// how MANY shots a match contains — it changes who takes them and how many go in. An
// earlier version scaled shot count by strength as well, and a three-division mismatch
// came out 24-0 off ninety-five shots.
const TOTAL_SHOTS = 26;
/** How far possession and shot share can be pulled by a mismatch. */
const SHARE_SWING = 0.28;
/** Strength difference, in ability points, at which the swing is most of the way there. */
const SHARE_SCALE = 45;
const CONVERSION = 0.105;
/** How sharply conversion responds to attack against defence. Fitted; see above. */
const CONVERSION_POWER = 1.35;
/** Nobody converts a third of their shots over ninety minutes, however good they are. */
const CONVERSION_CAP = 0.33;
const ON_TARGET_SHARE = 0.33;
const FOULS_PER_TEAM = 9.4;
const CARD_PER_FOUL = 0.16;
const HOME_ADVANTAGE = 1.045;

export interface TeamRating {
  attack: number;
  midfield: number;
  defence: number;
  keeper: number;
}

/**
 * Reduce a team to four numbers.
 *
 * Weighted by where a player is standing, because that is what decides which of his
 * attributes the match will ask for. A brilliant centre-back contributes nothing to the
 * attack rating and should not.
 */
export function rateTeam(team: TeamSetup): TeamRating {
  const players = activePlayers(team);
  let attack = 0;
  let midfield = 0;
  let defence = 0;
  let keeper = 0;
  let attackW = 0;
  let midW = 0;
  let defW = 0;

  for (const p of players) {
    const ability = caOf(p.attrs, p.role) * lerp(0.72, 1, clamp01(p.familiarity)) * (0.85 + 0.15 * p.condition);
    const slot = team.formation.slots[team.players.indexOf(p)];
    const along = slot?.along ?? 0.5;

    if (p.role === 'GK') {
      keeper = ability;
      continue;
    }
    // A player contributes to each phase in proportion to how far up the pitch he stands.
    const a = clamp01((along - 0.35) / 0.5);
    const d = clamp01((0.55 - along) / 0.5);
    const m = 1 - Math.abs(along - 0.45) * 1.6;
    attack += ability * a;
    attackW += a;
    defence += ability * d;
    defW += d;
    midfield += ability * Math.max(m, 0);
    midW += Math.max(m, 0);
  }

  const inst = team.instructions;
  return {
    attack: (attackW > 0 ? attack / attackW : 60) * lerp(0.9, 1.12, inst.attackingIntent),
    midfield: (midW > 0 ? midfield / midW : 60) * lerp(0.94, 1.08, inst.tempo * 0.5 + (1 - inst.directness) * 0.5),
    defence: (defW > 0 ? defence / defW : 60) * lerp(1.1, 0.9, inst.lineHeight * 0.5 + inst.attackingIntent * 0.5),
    keeper: keeper || 60,
  };
}

/** Poisson draw by inversion. Fine at the counts football produces. */
function poisson(rng: Rng, mean: number): number {
  const m = Math.max(0, mean);
  if (m > 30) return Math.max(0, Math.round(m + gauss(rng) * Math.sqrt(m)));
  const limit = Math.exp(-m);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

function binomial(rng: Rng, n: number, p: number): number {
  let hits = 0;
  for (let i = 0; i < n; i++) if (rng() < p) hits++;
  return hits;
}

/**
 * Play a whole match in a few hundred operations.
 *
 * The two knobs that matter are how many shots each side gets — a function of midfield
 * control and attack against defence — and how many go in, which is attack against the
 * opposing keeper. Everything else is bookkeeping.
 */
export function quickMatch(
  home: TeamSetup,
  away: TeamSetup,
  rng: Rng,
  conditions: Conditions = fairConditions(),
): MatchResult {
  const H = rateTeam(home);
  const A = rateTeam(away);

  /** One number for how good a side is at controlling a football match. */
  const overall = (r: TeamRating): number => r.attack * 0.4 + r.midfield * 0.35 + r.defence * 0.25;
  const diff = overall(H) * HOME_ADVANTAGE - overall(A);
  const share = 0.5 + SHARE_SWING * Math.tanh(diff / SHARE_SCALE);

  // Possession moves less than shot share does — the full engine holds possession near
  // even at strength gaps that produce six-nils, because a side under the cosh still has
  // the ball a lot; it just has it in its own half.
  const homePoss = clamp(0.5 + (share - 0.5) * 0.3, 0.32, 0.68);

  // Weather, applied the same way it is in the full engine: a heavy touch costs everyone
  // accuracy, so fewer shots and fewer of them on target. Without this the two engines
  // disagree about a wet January in exactly the way `fit-quick` exists to catch.
  const slip = touchPenalty(conditions);
  const total = poisson(rng, TOTAL_SHOTS * (1 - slip * 0.5));
  const homeShots = Math.round(total * share);
  const awayShots = total - homeShots;

  /** Conversion is where a strength gap actually shows up. */
  const convert = (attack: number, defence: number, keeper: number): number =>
    clamp(
      CONVERSION * Math.pow(Math.max(attack, 20) / Math.max(defence * 0.6 + keeper * 0.4, 20), CONVERSION_POWER),
      0.015,
      CONVERSION_CAP,
    );

  const onTarget = ON_TARGET_SHARE * (1 - slip * 0.45);
  const homeOn = binomial(rng, homeShots, onTarget);
  const awayOn = binomial(rng, awayShots, onTarget);
  const homeGoals = binomial(rng, homeShots, convert(H.attack, A.defence, A.keeper));
  const awayGoals = binomial(rng, awayShots, convert(A.attack, H.defence, H.keeper));

  const result: MatchResult = {
    homeGoals,
    awayGoals,
    homeShots,
    awayShots,
    homeShotsOnTarget: Math.max(homeOn, homeGoals),
    awayShotsOnTarget: Math.max(awayOn, awayGoals),
    homePossession: homePoss,
    scorers: [],
    cards: [],
    ratings: new Map(),
  };

  awardGoals(result, home, 'home', homeGoals, rng);
  awardGoals(result, away, 'away', awayGoals, rng);
  awardCards(result, home, 'home', rng);
  awardCards(result, away, 'away', rng);
  awardRatings(result, home, away);
  return result;
}

/** Hand out goals to the players most likely to have scored them. */
function awardGoals(result: MatchResult, team: TeamSetup, side: Side, goals: number, rng: Rng): void {
  const players = activePlayers(team).filter((p) => p.role !== 'GK');
  if (players.length === 0) return;
  const weights = players.map((p) => {
    const slot = team.formation.slots[team.players.indexOf(p)];
    const along = slot?.along ?? 0.5;
    // Where he stands, then how well he finishes. A full-back scores occasionally; a
    // striker scores most weeks.
    return Math.pow(clamp01((along - 0.25) / 0.7), 2.1) * (0.35 + attrUnit(p.attrs, 'finishing')) + 0.015;
  });
  const total = weights.reduce((a, b) => a + b, 0);

  for (let i = 0; i < goals; i++) {
    let r = rng() * total;
    let scorer = players[0] as MatchPlayer;
    for (let k = 0; k < players.length; k++) {
      r -= weights[k] as number;
      if (r <= 0) {
        scorer = players[k] as MatchPlayer;
        break;
      }
    }
    scorer.stats.goals++;
    scorer.stats.shots++;
    scorer.stats.shotsOnTarget++;
    result.scorers.push({ playerId: scorer.id, side, minute: 1 + Math.floor(rng() * 94), ownGoal: false });
    // An assist about two goals in three, which is roughly the real rate.
    if (rng() < 0.66) {
      const helper = players[Math.floor(rng() * players.length)] as MatchPlayer;
      if (helper.id !== scorer.id) helper.stats.assists++;
    }
  }
  result.scorers.sort((a, b) => a.minute - b.minute);
}

function awardCards(result: MatchResult, team: TeamSetup, side: Side, rng: Rng): void {
  const players = activePlayers(team);
  const fouls = poisson(rng, FOULS_PER_TEAM);
  for (let i = 0; i < fouls; i++) {
    const p = players[Math.floor(rng() * players.length)] as MatchPlayer | undefined;
    if (!p) continue;
    p.stats.fouls++;
    const dirty = attrUnit(p.attrs, 'dirtiness');
    if (rng() >= CARD_PER_FOUL * (0.6 + dirty)) continue;
    const red = rng() < 0.055;
    if (red) {
      p.sentOff = true;
      p.onPitch = false;
    } else {
      p.yellow++;
      if (p.yellow >= 2) {
        p.sentOff = true;
        p.onPitch = false;
      }
    }
    result.cards.push({
      playerId: p.id,
      side,
      minute: 1 + Math.floor(rng() * 94),
      red: red || p.yellow >= 2,
    });
  }
  result.cards.sort((a, b) => a.minute - b.minute);
}

/**
 * Ratings, from the same function the full engine uses. Reusing it rather than inventing a
 * parallel one is what stops a player noticing that quick-simmed weeks rate differently.
 */
function awardRatings(result: MatchResult, home: TeamSetup, away: TeamSetup): void {
  const fake = {
    home,
    away,
    score: { home: result.homeGoals, away: result.awayGoals },
  } as Parameters<typeof settleRatings>[0];
  settleRatings(fake);
  for (const team of [home, away]) {
    for (const p of [...team.players, ...team.bench]) result.ratings.set(p.id, p.stats.rating);
  }
}
