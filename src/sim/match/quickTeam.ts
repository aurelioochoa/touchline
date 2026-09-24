// Build a plausible eleven at a given strength.
//
// This is not test scaffolding that happens to have escaped: worldgen uses the same shape
// to fill a division, the 3D spike uses it to have something to render before the career
// layer exists, and the calibration suite uses it to compare two teams that differ only in
// the number it was given.

import { int, type Rng } from '../../core/rng.js';
import { generateAttributes } from '../ratings/ability.js';
import { POSITION_NEIGHBOURS, type Position } from '../ratings/positions.js';
import { DEFAULT_FORMATION } from './tactics.js';
import { makeMatchPlayer } from './engine.js';
import { defaultInstructions, type Formation, type MatchPlayer, type Side, type TeamSetup } from './types.js';

let nextId = 1;

/** Reset the id counter. Tests that compare two runs need the same ids in both. */
export function resetPlayerIds(from = 1): void {
  nextId = from;
}

export interface TeamSpec {
  side: Side;
  clubId: number;
  name: string;
  shortName: string;
  /** Average Current Ability of the eleven. 40 is the fifth division, 160 is a champion. */
  strength: number;
  kitPrimary: number;
  kitSecondary: number;
  reputation?: number;
  formation?: Formation;
  /** Bench size. Five substitutions are allowed, so seven is the usual number named. */
  benchSize?: number;
}

/**
 * How well a player fills a slot he was not born for. A midfielder at left-back is not
 * useless, he is worse — and the difference is what makes squad depth a real problem.
 */
export function familiarityFor(natural: Position, playing: Position): number {
  if (natural === playing) return 1;
  return POSITION_NEIGHBOURS[natural][playing] ?? 0.35;
}

export function buildTeam(rng: Rng, spec: TeamSpec): TeamSetup {
  const formation = spec.formation ?? DEFAULT_FORMATION;
  const benchSize = spec.benchSize ?? 7;
  const players: MatchPlayer[] = [];
  const bench: MatchPlayer[] = [];
  const shirts = new Set<number>();

  const shirt = (): number => {
    for (let i = 0; i < 60; i++) {
      const n = int(rng, 1, 39);
      if (!shirts.has(n)) {
        shirts.add(n);
        return n;
      }
    }
    return shirts.size + 1;
  };

  formation.slots.forEach((slot, i) => {
    // Spread the squad around the target: a team is not eleven identical players, and the
    // spread is what makes team selection a decision.
    const ca = Math.max(15, Math.round(spec.strength + (rng() * 2 - 1) * 14));
    const attrs = generateAttributes(rng, slot.position, ca);
    players.push(
      makeMatchPlayer({
        id: nextId++,
        side: spec.side,
        shirt: i === 0 ? 1 : shirt(),
        name: `${spec.shortName} ${slot.position}${i}`,
        role: slot.position,
        familiarity: 1,
        attrs,
        condition: 1,
        onPitch: true,
      }),
    );
  });

  // A bench that covers the pitch: a keeper, then a spread of outfield slots.
  const benchRoles: Position[] = ['GK', 'DC', 'DL', 'MC', 'MC', 'AML', 'ST', 'DM', 'AMC'];
  for (let i = 0; i < benchSize; i++) {
    const role = benchRoles[i % benchRoles.length] as Position;
    const ca = Math.max(12, Math.round(spec.strength * 0.86 + (rng() * 2 - 1) * 12));
    bench.push(
      makeMatchPlayer({
        id: nextId++,
        side: spec.side,
        shirt: shirt(),
        name: `${spec.shortName} sub${i}`,
        role,
        familiarity: 1,
        attrs: generateAttributes(rng, role, ca),
        condition: 1,
        onPitch: false,
      }),
    );
  }

  return {
    side: spec.side,
    clubId: spec.clubId,
    name: spec.name,
    shortName: spec.shortName,
    kitPrimary: spec.kitPrimary,
    kitSecondary: spec.kitSecondary,
    players,
    bench,
    formation,
    instructions: defaultInstructions(),
    reputation: spec.reputation ?? 0.5,
    subsUsed: 0,
  };
}
