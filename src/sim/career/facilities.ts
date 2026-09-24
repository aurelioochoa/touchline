// What a club can build, what it costs, and what it does.
//
// Every upgrade here changes a number the rest of the career already reads — capacity, the
// money a home match brings in, how fast a tired player recovers, how quickly a young one
// grows. None of them is a stat that exists only to go up: a kid who builds a bigger stand
// sees a bigger crowd figure and more money after the next home match, and that is the
// whole of the promise.
//
// Only the managed club builds anything. The other ninety-nine clubs are unchanged, which
// is why this lives on the world rather than widening every club's record.

import type { Club, Facilities, World, WorldPlayer } from '../world/types.js';

export type FacilityKind = keyof Facilities;
export const FACILITY_KINDS: readonly FacilityKind[] = ['stands', 'training', 'shop'];

/** The highest level each one goes to. */
export const FACILITY_MAX: Readonly<Record<FacilityKind, number>> = { stands: 4, training: 3, shop: 3 };

/**
 * A division's prices, as a multiplier. A top-flight club pays top-flight prices, and a
 * fifth-tier club can still afford a shop in its first season, which is what makes the
 * small-club story work.
 */
const TIER_PRICE = [2.2, 1.4, 0.9, 0.55, 0.35];

/** Each stand extension adds this share of the current capacity. */
export const STAND_GROWTH = 0.15;
/** Money per spectator per home match, for each level of the shop. */
export const SHOP_PER_FAN = 4;
/** Extra recovery per day, as a share of the normal rate, per training level. */
export const TRAINING_RECOVERY = 0.2;
/** Added to the season's coaching quality, per training level. */
export const TRAINING_COACHING = 0.1;

function tierPrice(club: Club): number {
  return TIER_PRICE[club.tier] ?? 1;
}

/** What the next level costs, or null when it is already built to the top. */
export function facilityCost(world: World, club: Club, kind: FacilityKind): number | null {
  const level = world.facilities[kind];
  if (level >= FACILITY_MAX[kind]) return null;
  const step = level + 1;
  switch (kind) {
    // Stands are priced by the seat, so a bigger ground costs more to grow.
    case 'stands': return Math.round((club.capacity * 55 * step) / 1000) * 1000;
    case 'training': return Math.round((700_000 * step * tierPrice(club)) / 1000) * 1000;
    case 'shop': return Math.round((600_000 * step * tierPrice(club)) / 1000) * 1000;
  }
}

/** Seats the next stand extension adds, rounded to a hundred. */
export function standGrowth(club: Club): number {
  return Math.max(100, Math.round((club.capacity * STAND_GROWTH) / 100) * 100);
}

/**
 * Build the next level, paid from the club's balance. Returns whether it happened — a
 * facility at its top level, or one the club cannot afford, is a no-op and not an error.
 */
export function buildFacility(world: World, kind: FacilityKind): boolean {
  const club = world.clubs[world.managedClubId];
  if (!club) return false;
  const cost = facilityCost(world, club, kind);
  if (cost === null || cost > club.balance) return false;
  club.balance -= cost;
  if (kind === 'stands') club.capacity += standGrowth(club);
  world.facilities[kind]++;
  return true;
}

/** The shop's takings from one home crowd. Zero for any club that is not the player's. */
export function shopIncome(world: World, club: Club, attendance: number): number {
  if (club.id !== world.managedClubId) return 0;
  return attendance * SHOP_PER_FAN * world.facilities.shop;
}

/** How many days' recovery one rest day is worth to this player. */
export function recoveryDays(world: World, p: WorldPlayer): number {
  if (p.clubId !== world.managedClubId || p.clubId < 0) return 1;
  return 1 + TRAINING_RECOVERY * world.facilities.training;
}

/** What the training ground adds to a club's coaching for the season's development. */
export function coachingBonus(world: World, club: Club): number {
  if (club.id !== world.managedClubId) return 0;
  return TRAINING_COACHING * world.facilities.training;
}
