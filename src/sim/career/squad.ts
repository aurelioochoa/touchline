// Turning a club into a team that can play a match.
//
// The XI picker is the most important default in the game. Design §5b says every system
// must have a default the game will choose for you, and that the default must be
// defensible — a kid who never opens the squad screen still has to field a sensible side,
// every week, for twenty seasons. If this function is bad, the whole "layered, not gated"
// argument collapses.

import { clamp01, lerp } from '../../core/math.js';
import { caOf } from '../ratings/ability.js';
import { POSITION_INDEX, type Position } from '../ratings/positions.js';
import { makeMatchPlayer } from '../match/engine.js';
import { formationById } from '../match/tactics.js';
import type { Formation, MatchPlayer, Side, TeamSetup } from '../match/types.js';
import { surname } from '../world/names.js';
import { formOf, isAvailable, kitColour, squadOf, type Club, type World, type WorldPlayer } from '../world/types.js';

/** How well a player would do in a given slot, all things considered. */
export function slotScore(p: WorldPlayer, position: Position): number {
  const ability = caOf(p.attrs, position);
  const fam = (p.familiarity[POSITION_INDEX[position]] ?? 0) / 20;
  // Out of position is a real cost but not a disqualification: a midfielder at left-back
  // is worse, not useless, and a squad with an injury crisis has to do it.
  const positional = lerp(0.55, 1, fam);
  const fitness = lerp(0.6, 1, clamp01(p.condition));
  const morale = lerp(0.9, 1.06, clamp01(p.morale));
  const form = lerp(0.92, 1.08, clamp01((formOf(p) - 5.5) / 2.5));
  return ability * positional * fitness * morale * form;
}

export interface Selection {
  /** One player per formation slot, in slot order. */
  eleven: WorldPlayer[];
  bench: WorldPlayer[];
}

/**
 * Pick the best available side for a formation.
 *
 * Greedy over the whole score matrix rather than slot by slot: filling the goalkeeper's
 * shirt first and then the left-back's gives the left-back job to whoever is left, and a
 * squad's best player can end up at right-back because his slot came up late.
 */
export function pickEleven(world: World, club: Club, formation?: Formation): Selection {
  const shape = formation ?? formationById(club.formationId);
  const available = squadOf(world, club.id).filter(isAvailable);
  const pool = available.length >= 11 ? available : squadOf(world, club.id);

  const slots = shape.slots;
  const scores: number[][] = slots.map((s) => pool.map((p) => slotScore(p, s.position)));
  const takenSlot = new Set<number>();
  const takenPlayer = new Set<number>();
  const eleven: (WorldPlayer | null)[] = slots.map(() => null);

  for (let n = 0; n < slots.length; n++) {
    let bestSlot = -1;
    let bestPlayer = -1;
    let best = -Infinity;
    for (let s = 0; s < slots.length; s++) {
      if (takenSlot.has(s)) continue;
      const row = scores[s] as number[];
      for (let p = 0; p < pool.length; p++) {
        if (takenPlayer.has(p)) continue;
        const v = row[p] as number;
        if (v > best) {
          best = v;
          bestSlot = s;
          bestPlayer = p;
        }
      }
    }
    if (bestSlot < 0 || bestPlayer < 0) break;
    takenSlot.add(bestSlot);
    takenPlayer.add(bestPlayer);
    eleven[bestSlot] = pool[bestPlayer] as WorldPlayer;
  }

  const chosen = eleven.filter((p): p is WorldPlayer => p !== null);
  // The bench covers the pitch rather than being the next seven best: a side with no
  // substitute keeper is one collision away from a centre-half in gloves.
  const rest = pool.filter((p) => !chosen.includes(p));
  const bench: WorldPlayer[] = [];
  const wantKeeper = rest.find((p) => p.natural === 'GK');
  if (wantKeeper) bench.push(wantKeeper);
  for (const cover of ['DC', 'DL', 'MC', 'AMC', 'AML', 'ST'] as const) {
    const pick = rest
      .filter((p) => !bench.includes(p))
      .sort((a, b) => slotScore(b, cover) - slotScore(a, cover))[0];
    if (pick && bench.length < 7) bench.push(pick);
  }
  for (const p of rest) {
    if (bench.length >= 7) break;
    if (!bench.includes(p)) bench.push(p);
  }

  return { eleven: chosen, bench };
}

/**
 * Build the match-engine view of a club. The engine knows nothing about careers, so this
 * is where a WorldPlayer becomes a MatchPlayer and everything the engine does not need is
 * left behind.
 */
export function buildTeamSetup(
  world: World,
  club: Club,
  side: Side,
  selection?: Selection,
  formation?: Formation,
): TeamSetup {
  const shape = formation ?? formationById(club.formationId);
  const chosen = selection ?? pickEleven(world, club, shape);

  const toMatch = (p: WorldPlayer, role: Position, onPitch: boolean): MatchPlayer =>
    makeMatchPlayer({
      id: p.id,
      side,
      shirt: p.squadNumber,
      name: surname(world.book, p.lastIdx),
      role,
      familiarity: (p.familiarity[POSITION_INDEX[role]] ?? 0) / 20,
      attrs: p.attrs,
      // Morale rides in through condition, which is the only per-match multiplier the
      // engine has. Keeping it to one channel is what stops it being applied twice.
      condition: clamp01(p.condition * lerp(0.94, 1.04, p.morale)),
      onPitch,
    });

  const players = chosen.eleven.map((p, i) =>
    toMatch(p, shape.slots[i]?.position ?? p.natural, true),
  );
  const bench = chosen.bench.map((p) => toMatch(p, p.natural, false));

  return {
    side,
    clubId: club.id,
    name: club.name,
    shortName: club.short,
    kitPrimary: club.kitPrimary,
    kitSecondary: club.kitSecondary,
    // Only the managed club has a look of its own; everyone else wears the plain split.
    ...(club.id === world.managedClubId
      ? {
        trim: {
          shorts: kitColour(world.look.shorts, club.kitPrimary, club.kitSecondary),
          sleeve: kitColour(world.look.sleeves, club.kitPrimary, club.kitSecondary),
          sock: kitColour(world.look.socks, club.kitPrimary, club.kitSecondary),
          pattern: world.look.pattern,
          patternColour: kitColour(world.look.patternColour, club.kitPrimary, club.kitSecondary),
          chest: world.look.chestBadge ? club.kitSecondary : -1,
          number: kitColour(world.look.numberColour, club.kitPrimary, club.kitSecondary),
          numberStyle: world.look.numberStyle,
        },
      }
      : {}),
    players,
    bench,
    formation: shape,
    instructions: { ...club.instructions },
    reputation: clamp01(club.reputation / 200),
    subsUsed: 0,
  };
}

/**
 * If two clubs would be hard to tell apart, change one.
 *
 * A fixture where a kid cannot tell which figures are his is a defect, not a cosmetic
 * problem (design §9), so this runs on every match rather than being left to whoever
 * generated the kits.
 */
export function ensureKitContrast(home: TeamSetup, away: TeamSetup): void {
  if (colourDistance(home.kitPrimary, away.kitPrimary) >= 0.34) return;
  // The away side changes, as in real football.
  const alternatives = [0xf5f7fa, 0x18181c, 0xffd447, 0x00b3c8, 0x7b2ff7, 0xd8353a];
  let best = away.kitPrimary;
  let bestGap = -1;
  for (const c of alternatives) {
    const gap = Math.min(colourDistance(c, home.kitPrimary), colourDistance(c, 0x3f8b3f));
    if (gap > bestGap) {
      bestGap = gap;
      best = c;
    }
  }
  away.kitPrimary = best;
  // A change strip is a change strip: the trim was chosen against the colour just replaced.
  delete away.trim;
  if (colourDistance(away.kitSecondary, best) < 0.2) {
    away.kitSecondary = best === 0x18181c ? 0xf5f7fa : 0x18181c;
  }
}

/** Rough perceptual distance between two packed RGB colours, 0..1. */
export function colourDistance(a: number, b: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  // Weighted for how the eye actually works: green dominates, blue barely registers.
  const dr = (ar - br) / 255;
  const dg = (ag - bg) / 255;
  const db = (ab - bb) / 255;
  return Math.sqrt(dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11);
}
