// Commentary.
//
// Turns the engine's event stream into lines a person would say. Three rules shape it and
// all three come from the design doc rather than from taste:
//
// 1. **It emits KEYS, never text.** Every line goes out as a `StringKey` plus params and is
//    resolved through `t()` at the last moment, so `?blank=1` blanks the commentary along
//    with everything else and design §11's wordless matchday path survives. A generator
//    that returned strings would be the one thing on the screen that could not be blanked.
// 2. **It is deterministic.** Seeded from the match's own seed, so re-running a match says
//    the same things about it — the same contract the engine itself keeps.
// 3. **It drops lines rather than falling behind.** At 40x a ninety-minute match is two
//    minutes long and there is no room to say everything, so every line carries a priority
//    and the passing goes before the goals do.

import { mulberry32, type Rng } from '../core/rng.js';
import type { StringKey } from '../i18n.js';
import type { MatchEvent, MatchPlayer, MatchState, Side } from '../sim/match/types.js';

export interface Line {
  key: StringKey;
  params: Record<string, string | number>;
  /** 0..100. Higher survives when there is not time for everything. */
  priority: number;
  /** Match minute, for the log. */
  minute: number;
  /** A class for the ticker, matching the existing tl-tick kinds. */
  kind: string;
  /** Whether this is the managed side's doing, so the log can colour it. */
  mine: boolean;
}

/** How many variants each event has. Kept here so the string tables and this cannot drift. */
const VARIANTS: Partial<Record<string, number>> = {
  goal: 3, goalMine: 3, shotOn: 3, shotOff: 3, save: 3, post: 2,
  foul: 2, yellow: 2, red: 2, penalty: 2, corner: 2, offside: 2,
  sub: 2, injury: 2, kickoff: 2, halfTime: 2, fullTime: 3,
  chance: 2, freeKick: 2,
  trickNutmeg: 1, trickRoulette: 1, trickElastico: 1, trickFlick: 1,
};

/** The tricks worth a line even when nobody was beaten by them. */
const SHOWY_TRICKS = new Set(['nutmeg', 'roulette', 'elastico', 'flick']);

/**
 * Nothing below this is ever said at all.
 *
 * A match log that lists every interception and every tackle is not a record of the match,
 * it is a record of the ball: 192 rows for ninety minutes on the first attempt, and 113
 * after the interceptions went. A report is corners upward — the things a person would
 * still mention an hour later.
 */
const FLOOR = 30;

/**
 * The commentator.
 *
 * One per match. `feed` takes the events from a tick and returns the lines worth saying,
 * already rate-limited — the caller does not decide what is worth saying, because the
 * caller does not know what else happened this second.
 */
export class Commentator {
  readonly #rng: Rng;
  readonly #mine: Side;
  /** Seconds of match-clock since the last line, so a fast-forward stays readable. */
  #quiet = 0;
  #lastKey = '';
  /** The latest minute reported, so a clock that winds back cannot un-order the log. */
  #minute = 0;

  constructor(seed: number, mine: Side) {
    this.#rng = mulberry32((seed ^ 0x5eed) >>> 0);
    this.#mine = mine;
  }

  /** Advance the silence clock. `dt` is real seconds, not match seconds. */
  tick(dt: number): void {
    this.#quiet += dt;
  }

  /**
   * What is worth saying about this tick, for the LOG.
   *
   * At most one line, because football commentary is one voice and two lines in the same
   * breath is less information rather than more. No time limiting here: the log is a
   * record and wants everything above the floor. Whether a line also reaches the ticker is
   * `worthShowing`, and the split matters — the two were one method, gated on a clock that
   * meant real seconds in the live loop and match seconds in the harness, so the same
   * match produced a highlights reel in a browser and a wall of noise under automation.
   */
  feed(state: MatchState, events: readonly MatchEvent[]): Line | null {
    let best: Line | null = null;
    for (const e of events) {
      const line = this.#lineFor(state, e);
      if (line && line.priority >= FLOOR && (!best || line.priority > best.priority)) best = line;
    }
    return best;
  }

  /**
   * Should this line go on screen and be spoken, or only into the log?
   *
   * Gated on REAL seconds, which is what the viewer experiences: at 40x a ninety-minute
   * match lasts two minutes and there is no room to read it all, so the small talk goes
   * and the goals never do.
   */
  worthShowing(line: Line): boolean {
    const gap = line.priority >= 70 ? 0 : line.priority >= 40 ? 1.6 : 3.4;
    if (this.#quiet < gap) return false;
    if (line.key === this.#lastKey && line.priority < 70) return false;
    this.#quiet = 0;
    this.#lastKey = line.key;
    return true;
  }

  /** Pick one of an event's phrasings. */
  #pick(base: string): StringKey {
    const n = VARIANTS[base] ?? 1;
    return `cm.${base}.${Math.floor(this.#rng() * n) % n}` as StringKey;
  }

  #lineFor(state: MatchState, e: MatchEvent): Line | null {
    // Monotonic. The engine rewinds the clock to 45:00 to restart the second half, so a
    // raw reading can go backwards mid-log; a report that lists 47' above 45' reads as a
    // bug whatever the engine meant by it.
    const minute = Math.min(Math.floor(state.clock / 60), 120);
    this.#minute = Math.max(this.#minute, minute);
    const mine = 'side' in e ? e.side === this.#mine : false;
    const make = (base: string, priority: number, kind: string, params: Record<string, string | number> = {}): Line => ({
      key: this.#pick(base), params, minute: this.#minute, priority, kind, mine,
    });
    const who = (id: number): string => shortName(find(state, id)?.name ?? '');

    switch (e.type) {
      case 'goal':
        return make(mine !== e.ownGoal ? 'goalMine' : 'goal', 100, 'goal', { name: who(e.by) });
      case 'penaltyAwarded':
        return make('penalty', 90, 'penalty');
      case 'save':
        return make('save', 72, 'save', { name: who(e.by) });
      case 'post':
        return make('post', 74, 'post', { name: who(e.by) });
      case 'shot':
        return make(e.onTarget ? 'shotOn' : 'shotOff', 62, 'shot', { name: who(e.by) });
      case 'chance':
        return make('chance', 52, 'shot');
      case 'foul':
        if (e.card === 'red') return make('red', 86, 'card', { name: who(e.by) });
        if (e.card === 'yellow') return make('yellow', 58, 'card', { name: who(e.by) });
        return make('foul', 34, 'foul', { name: who(e.by) });
      case 'injury':
        return make('injury', 48, 'injury', { name: who(e.playerId) });
      case 'substitution':
        return make('sub', 44, 'sub', { on: who(e.on), off: who(e.off) });
      case 'offside':
        return make('offside', 36, 'offside', { name: who(e.by) });
      case 'skill': {
        // Only the showy ones, and only when they came off. A stepover is part of the
        // picture, not the report: with every beaten man in it the log ran past a
        // hundred lines, which is a record of the ball again (see FLOOR).
        if (!e.beat || !SHOWY_TRICKS.has(e.move)) return null;
        const base = `trick${e.move.charAt(0).toUpperCase()}${e.move.slice(1)}`;
        return make(base, 42, 'skill', { name: who(e.by) });
      }
      case 'corner':
        return make('corner', 30, 'corner');
      case 'freeKick':
        return e.dangerous ? make('freeKick', 38, 'foul') : null;
      case 'kickoff':
        // A `kickoff` event means "somebody has restarted play from the centre spot",
        // which covers the start of each half AND every restart after a goal. Only the
        // first of those is the match starting, and the clock is the thing that says so —
        // the period does not, because a first-half goal restarts inside the first half.
        return state.clock < 3 ? make('kickoff', 95, 'whistle') : null;
      case 'halfTime':
        return make('halfTime', 95, 'whistle');
      case 'fullTime':
        return make('fullTime', 100, 'whistle');
      default:
        return null;
    }
  }
}

function find(state: MatchState, id: number): MatchPlayer | null {
  for (const team of [state.home, state.away]) {
    for (const p of [...team.players, ...team.bench]) if (p.id === id) return p;
  }
  return null;
}

/** "Rasmus Ostergaard" becomes "Ostergaard" — a commentator says the surname. */
function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? (parts[parts.length - 1] as string) : name;
}

/** Every key the commentator can ever emit. The parity test walks this. */
export function everyCommentaryKey(): StringKey[] {
  const out: StringKey[] = [];
  for (const [base, n] of Object.entries(VARIANTS)) {
    for (let i = 0; i < (n ?? 1); i++) out.push(`cm.${base}.${i}` as StringKey);
  }
  return out;
}
