// The vocabulary the match engine and its clients share.
//
// This module imports nothing that renders and nothing that persists. The renderer, the
// UI and the commentary all read these types; none of them may write to a MatchState.
// (Design §12: the sim is pure and everything else is a client of it.)

import type { Attributes } from '../ratings/attributes.js';
import type { Conditions } from './conditions.js';
import type { Position } from '../ratings/positions.js';
import type { Direction } from './pitch.js';

export type Side = 'home' | 'away';

export function otherSide(s: Side): Side {
  return s === 'home' ? 'away' : 'home';
}

/** How a player is currently engaged with the game — drives which animation plays. */
export type PlayerAction =
  | 'idle'
  | 'run'
  | 'sprint'
  | 'dribble'
  | 'pass'
  | 'shoot'
  | 'tackle'
  | 'header'
  | 'dive'
  | 'celebrate'
  | 'down';

/**
 * A feint or a trick on the ball. Cosmetic to the result — see sim/match/skills.ts — but
 * chosen by the engine, from the player's attributes, so the good dribbler is the one
 * doing them.
 */
export type SkillMove =
  | 'bodyFeint'
  | 'stepover'
  | 'dragBack'
  | 'cutInside'
  | 'nutmeg'
  | 'roulette'
  | 'elastico'
  | 'flick';

/** One player, as the engine sees him. Career data stays out; only what plays football. */
export interface MatchPlayer {
  readonly id: number;
  readonly side: Side;
  readonly shirt: number;
  readonly name: string;
  /** The slot he is currently filling, which is not always his natural position. */
  role: Position;
  /** 0..1 — how well he plays this slot. Multiplies effective attributes. */
  familiarity: number;
  /**
   * Multiplier on top speed for playing at home. 1 for everyone else.
   *
   * It is its own field because the obvious place — `condition` — does not work. That is
   * what `applyHomeAdvantage` used for the whole of the game's first life: it raised
   * condition by 4.5% to a clamp of 1.08, and then every consumer read it back through
   * `clamp01`, which returns it to exactly 1. Since a fresh season sets every condition to
   * 1, the home advantage was not merely small, it was arithmetically nothing — and the
   * quick engine, which applies its 1.045 to a team rating instead, drifted away from the
   * full engine by a quarter of all home wins with no test able to say why.
   */
  homeEdge: number;
  readonly attrs: Attributes;

  // --- live state ---
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Body facing, radians. Determines which way he can strike the ball well. */
  facing: number;
  /** 0..1. Drains with work done, refills slowly, and gates speed and decisions. */
  stamina: number;
  /** 0..1 match sharpness from the career layer; a fixed multiplier for the match. */
  condition: number;
  action: PlayerAction;
  /** Ticks remaining in a committed action (a strike, a tackle, getting up). */
  actionTicks: number;
  /** Ticks until this player will reconsider what to do. Reaction time, in effect. */
  decisionTicks: number;
  /** Where he currently wants to be. Recomputed by the positioning pass. */
  targetX: number;
  targetY: number;
  yellow: number;
  sentOff: boolean;
  /** Set when he is hurt; the career layer decides how bad it turned out to be. */
  injured: boolean;
  onPitch: boolean;
  /** Accumulated for the post-match report. */
  stats: PlayerMatchStats;
}

export interface PlayerMatchStats {
  passes: number;
  passesCompleted: number;
  shots: number;
  shotsOnTarget: number;
  goals: number;
  assists: number;
  tackles: number;
  tacklesWon: number;
  interceptions: number;
  fouls: number;
  saves: number;
  distanceM: number;
  /** 0..10, the traditional match rating, settled at full time. */
  rating: number;
}

export function emptyPlayerStats(): PlayerMatchStats {
  return {
    passes: 0,
    passesCompleted: 0,
    shots: 0,
    shotsOnTarget: 0,
    goals: 0,
    assists: 0,
    tackles: 0,
    tacklesWon: 0,
    interceptions: 0,
    fouls: 0,
    saves: 0,
    distanceM: 0,
    rating: 6,
  };
}

/** The ball. z and vz exist because headers, chips and shots leave the ground. */
export interface Ball {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Player id in control, or -1 for a loose ball. */
  ownerId: number;
  /** Player id who last touched it — for throw-ins, corners and own goals. */
  lastTouchId: number;
  lastTouchSide: Side | null;
  /** Ticks before anyone may take control again (just-struck ball). */
  loose: number;
  /**
   * Who a pass was aimed at, or -1. A defender standing beside the receiver is often a few
   * centimetres nearer the ball than the receiver is, and "nearest wins" hands him half
   * the passes in the match. The man the ball was played to knows it is coming; the
   * defender has to read it. This is what encodes that difference.
   */
  intendedReceiverId: number;
}

/** Team instructions — the levers §5c says a player can actually feel. */
export interface TeamInstructions {
  /** 0..1 — how quickly the ball is moved on. */
  tempo: number;
  /** 0..1 — how far apart the shape sits across the pitch. */
  width: number;
  /** 0..1 — how high the defensive line holds. */
  lineHeight: number;
  /** 0..1 — how far up the pitch the team chases the ball. */
  pressing: number;
  /** 0..1 — short and patient at 0, direct and long at 1. */
  directness: number;
  /** 0..1 — how many players commit ahead of the ball. */
  attackingIntent: number;
}

export function defaultInstructions(): TeamInstructions {
  return {
    tempo: 0.5,
    width: 0.5,
    lineHeight: 0.5,
    pressing: 0.5,
    directness: 0.4,
    attackingIntent: 0.5,
  };
}

/** One slot in a formation: which position, and where it sits in normalised space. */
export interface FormationSlot {
  position: Position;
  /** 0 = own goal line, 1 = opposition goal line. */
  along: number;
  /** 0 = left touchline, 1 = right touchline. */
  across: number;
}

export interface Formation {
  readonly id: string;
  /** "4-4-2" and friends — derived from the slots, not typed in twice. */
  readonly label: string;
  readonly slots: readonly FormationSlot[];
}

/** Everything one team brings to a match. */
export interface TeamSetup {
  readonly side: Side;
  readonly clubId: number;
  readonly name: string;
  readonly shortName: string;
  // Not readonly: a fixture between two clubs in similar colours changes one of them, and
  // that decision belongs to the fixture rather than to the club (career/squad.ts).
  kitPrimary: number;
  kitSecondary: number;
  /**
   * Shorts, sleeves and socks when they are not the plain split of the two colours above.
   * Set only for the managed club, from its look, and dropped if the club changes strip.
   */
  trim?: {
    shorts: number;
    sleeve: number;
    sock: number;
    /** KIT_PATTERNS index on the shirt, and the colour it is drawn in. */
    pattern: number;
    patternColour: number;
    /** The chest badge's colour, or -1 for none. */
    chest: number;
    /** The shirt numbers' colour and NUMBER_STYLES index. Optional: older saves lack them. */
    number?: number;
    numberStyle?: number;
  };
  /** The eleven, in formation-slot order, then the substitutes. */
  players: MatchPlayer[];
  bench: MatchPlayer[];
  formation: Formation;
  instructions: TeamInstructions;
  /** Reputation 0..1, used for crowd support and referee leniency. */
  reputation: number;
  subsUsed: number;
}

/** What the match is doing right now. */
export type PlayState =
  | { kind: 'kickoff'; side: Side }
  | { kind: 'open' }
  | { kind: 'throwIn'; side: Side; x: number; y: number }
  | { kind: 'goalKick'; side: Side }
  | { kind: 'corner'; side: Side; x: number; y: number }
  | { kind: 'freeKick'; side: Side; x: number; y: number }
  | { kind: 'penalty'; side: Side }
  | { kind: 'halfTime' }
  | { kind: 'fullTime' };

export type Period = 'first' | 'second' | 'over';

export interface MatchState {
  tick: number;
  /** The weather and the time of day. Derived from the fixture, never stored. */
  conditions: Conditions;
  /**
   * Rolling resistance of the surface today — `rollDecayIn(conditions)`, cached.
   *
   * Cached because four separate functions invert it and all four have to agree; keeping
   * the one number on the state is what stops three of them remembering and one forgetting.
   */
  rollDecay: number;
  /** Seconds of match time elapsed. */
  clock: number;
  period: Period;
  /** Added time for the current half, in seconds, decided at the end of it. */
  stoppage: number;
  home: TeamSetup;
  away: TeamSetup;
  ball: Ball;
  play: PlayState;
  /** Ticks to wait before the restart is taken — the pause after a goal, a throw, etc. */
  restartDelay: number;
  score: { home: number; away: number };
  /** Rolling possession count in ticks, for the possession bar. */
  possessionTicks: { home: number; away: number };
  shots: { home: number; away: number };
  shotsOnTarget: { home: number; away: number };
  corners: { home: number; away: number };
  fouls: { home: number; away: number };
  /** Momentum -1..1, home-positive. Drives the crowd bed and the momentum meter. */
  momentum: number;
  /**
   * Set when a pass is played to a player who was beyond the last defender. Offside is a
   * decision made at the moment the ball is PLAYED and punished when it is next touched,
   * so it cannot be a test run at the moment of the touch — it has to be remembered.
   */
  pendingOffside: { playerId: number; side: Side } | null;
  /** Last player to deliberately play the ball to a team-mate, for assists. */
  lastPasserId: number;
  /** Ticks since the ball last changed hands, for the possession model. */
  possessionTicksRun: number;
  finished: boolean;
}

/** Discrete things worth telling a client about. Emitted per tick, consumed and dropped. */
export type MatchEvent =
  | { type: 'kickoff'; side: Side; period: Period }
  | { type: 'pass'; from: number; to: number; side: Side; long: boolean }
  | { type: 'passComplete'; from: number; to: number; side: Side }
  | { type: 'passIntercepted'; from: number; by: number; side: Side }
  | { type: 'shot'; by: number; side: Side; onTarget: boolean; distance: number }
  | { type: 'save'; by: number; side: Side; spectacular: boolean }
  | { type: 'goal'; by: number; side: Side; assist: number | null; ownGoal: boolean }
  | { type: 'post'; by: number; side: Side }
  | { type: 'tackle'; by: number; on: number; side: Side; won: boolean }
  /**
   * A trick by the man on the ball. `on` is the defender it was aimed at; `beat` is true
   * when that defender had just gone in and missed, false for a feint before he commits.
   */
  | { type: 'skill'; by: number; on: number; side: Side; move: SkillMove; beat: boolean }
  | { type: 'foul'; by: number; on: number; side: Side; card: 'none' | 'yellow' | 'red' }
  | { type: 'offside'; by: number; side: Side }
  | { type: 'throwIn'; side: Side }
  | { type: 'corner'; side: Side }
  | { type: 'goalKick'; side: Side }
  | { type: 'freeKick'; side: Side; dangerous: boolean }
  | { type: 'penaltyAwarded'; side: Side }
  | { type: 'substitution'; side: Side; off: number; on: number }
  | { type: 'injury'; playerId: number; side: Side }
  | { type: 'halfTime' }
  | { type: 'fullTime' }
  | { type: 'chance'; side: Side; quality: number };

/** The compact result the career layer stores. A match is not kept tick by tick (§C). */
export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  homeShots: number;
  awayShots: number;
  homeShotsOnTarget: number;
  awayShotsOnTarget: number;
  homePossession: number;
  scorers: { playerId: number; side: Side; minute: number; ownGoal: boolean }[];
  cards: { playerId: number; side: Side; minute: number; red: boolean }[];
  ratings: Map<number, number>;
}

/** Direction each side attacks in the given period. Ends swap at half time. */
export function directionOf(side: Side, period: Period): Direction {
  const homePositive = period === 'first';
  if (side === 'home') return homePositive ? 1 : -1;
  return homePositive ? -1 : 1;
}
