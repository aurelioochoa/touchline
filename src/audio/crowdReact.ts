// What the crowd does about what just happened.
//
// The crowd is the HOME crowd. The ground is painted in the home club's colours (stadium.ts)
// and so are most of the people in it, and a crowd that cheered both sides alike would be
// a laugh track. So the same event gets opposite answers depending on who did it: a home
// winger's stepover gets an "olé", the away winger's gets a sharp intake of breath; a card
// for the away full-back is cheered, one for the home centre-half is booed at the referee.
//
// Pure: a MatchEvent and a little context in, a list of calls out. The audio engine turns a
// call into sound and the stadium turns it into movement; neither decides anything.

import type { MatchEvent, Side } from '../sim/match/types.js';

/** The vocabulary of a football crowd. */
export type CrowdCall =
  | 'cheer'
  | 'roar'
  | 'ooh'
  | 'groan'
  | 'gasp'
  | 'boo'
  | 'jeer'
  | 'applause'
  | 'ole'
  | 'anticipate'
  | 'hush';

export interface CrowdReaction {
  call: CrowdCall;
  /** 0..1, how big. */
  level: number;
}

export interface CrowdContext {
  /** Whose ground it is. */
  home: Side;
  /** 0..1: how close the ball is to a goal, the same number the camera and the bed use. */
  danger: number;
  /** The score, for the final whistle. */
  score: { home: number; away: number };
  /**
   * The side that shot in the last few seconds, if that shot has not yet been saved or
   * scored. The engine's `shot` event is emitted as the ball is struck — `onTarget` is
   * always false there, because nobody knows yet — so a miss can only be recognised when
   * it resolves: as the goal kick or corner that follows it.
   */
  recentShot: Side | null;
}

/** The tricks that bring a crowd to its feet rather than just making it murmur. */
const SHOWY = new Set(['nutmeg', 'roulette', 'elastico', 'flick']);

export function crowdReaction(e: MatchEvent, ctx: CrowdContext): CrowdReaction[] {
  const ours = (s: Side) => s === ctx.home;
  const r = (call: CrowdCall, level: number): CrowdReaction => ({ call, level });
  switch (e.type) {
    case 'skill': {
      const big = SHOWY.has(e.move);
      if (ours(e.side)) {
        // "Olé" is for a man actually beaten. A feint gets appreciation, not a chant.
        if (e.beat || big) return [r('ole', big ? 1 : 0.75)];
        return [r('cheer', 0.3)];
      }
      return e.beat || big ? [r('gasp', big ? 0.7 : 0.45)] : [];
    }
    case 'tackle': {
      if (!e.won) return [];
      // A tackle in midfield is not an event to twenty thousand people. A tackle that
      // stops a chance is.
      if (ours(e.side)) return ctx.danger > 0.3 ? [r('cheer', 0.55), r('applause', 0.45)] : [r('applause', 0.25)];
      return ctx.danger > 0.45 ? [r('groan', 0.35)] : [];
    }
    case 'passIntercepted':
      return ours(e.side) && ctx.danger > 0.4 ? [r('cheer', 0.35)] : [];
    case 'foul': {
      // `side` is the offender's.
      if (ours(e.side)) {
        // One of ours, booked: that is the referee's fault.
        return e.card === 'none' ? [r('groan', 0.25)] : [r('boo', e.card === 'red' ? 1 : 0.6), r('jeer', 0.6)];
      }
      // Fouled by them: whistles, and a cheer if he is booked for it.
      const out: CrowdReaction[] = [r('jeer', e.card === 'none' ? 0.45 : 0.7)];
      if (e.card !== 'none') out.push(r('cheer', e.card === 'red' ? 1 : 0.6));
      else out.push(r('boo', 0.35));
      return out;
    }
    case 'offside':
      // `side` is the side that was caught.
      return ours(e.side) ? [r('groan', 0.4)] : [r('cheer', 0.35)];
    case 'corner':
      // Off a shot, the "ooh" of a chance that nearly was comes first.
      if (ctx.recentShot !== null) return ours(e.side) ? [r('ooh', 0.75), r('anticipate', 0.5)] : [r('cheer', 0.3)];
      return ours(e.side) ? [r('anticipate', 0.55)] : [r('hush', 0.3)];
    case 'goalKick':
      // `side` is the defending side taking it. After a shot, that is a shot that missed.
      if (ctx.recentShot === null) return [];
      return ours(ctx.recentShot) ? [r('ooh', 0.85)] : [r('cheer', 0.3), r('applause', 0.2)];
    case 'freeKick':
      if (!e.dangerous) return ours(e.side) ? [r('applause', 0.2)] : [r('jeer', 0.3)];
      return ours(e.side) ? [r('anticipate', 0.7)] : [r('hush', 0.45)];
    case 'penaltyAwarded':
      return ours(e.side) ? [r('roar', 0.95)] : [r('boo', 1), r('jeer', 1)];
    case 'shot':
      // Struck: twenty thousand people take a breath. Whether it is an "ooh", a groan or a
      // roar is decided by what the ball does next — see `recentShot`.
      return ours(e.side) ? [r('anticipate', e.distance < 20 ? 0.8 : 0.55)] : [r('gasp', e.distance < 20 ? 0.5 : 0.3)];
    case 'save':
      // `side` is the keeper's.
      return ours(e.side)
        ? [r('cheer', e.spectacular ? 0.85 : 0.45), r('applause', e.spectacular ? 0.8 : 0.35)]
        : [r('ooh', e.spectacular ? 1 : 0.7)];
    case 'post':
      return ours(e.side) ? [r('gasp', 1), r('ooh', 0.8)] : [r('gasp', 0.8)];
    case 'chance':
      return ours(e.side) && e.quality > 0.55 ? [r('anticipate', 0.5)] : [];
    case 'injury':
      return [r('hush', 0.7), r('applause', 0.3)];
    case 'substitution':
      return [r('applause', ours(e.side) ? 0.6 : 0.25)];
    case 'kickoff':
      return [r('cheer', 0.45)];
    case 'halfTime':
      return [r('applause', 0.55)];
    case 'fullTime': {
      const mine = ctx.home === 'home' ? ctx.score.home - ctx.score.away : ctx.score.away - ctx.score.home;
      if (mine > 0) return [r('roar', 0.9), r('applause', 1)];
      if (mine < 0) return [r('boo', 0.7), r('applause', 0.25)];
      return [r('applause', 0.6)];
    }
    default:
      return [];
  }
}

/**
 * How much each call lifts the stands, 0..1 — the visual half of the reaction. Boos and
 * whistles move people too: a crowd on its feet at a referee is not a crowd sitting still.
 */
export function standLift(c: CrowdReaction): number {
  switch (c.call) {
    case 'roar':
      return c.level;
    case 'ole':
    case 'cheer':
      return c.level * 0.7;
    case 'gasp':
    case 'ooh':
      return c.level * 0.5;
    case 'boo':
    case 'jeer':
      return c.level * 0.4;
    case 'anticipate':
      return c.level * 0.45;
    case 'applause':
      return c.level * 0.3;
    case 'groan':
    case 'hush':
      return 0;
  }
}
