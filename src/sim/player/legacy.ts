// Retirement, and the one door between the two careers (design player-career §C).
//
// Legacy converts the slot in place (§15 q5): the same world carries on, the retired hero
// is framed in the honours of the club he takes over, and the save becomes a Club career
// managed by him. One function so the caller can make it one write.

import { fullName } from '../world/names.js';
import type { World } from '../world/types.js';
import { heroPlayer, type Hero } from './hero.js';

/** Clubs that would have him as manager: his own, and the two nearest in standing. */
export function legacyClubs(world: World): number[] {
  const player = heroPlayer(world);
  const own = player ? world.clubs[player.clubId] : undefined;
  if (!own) return [];
  const near = world.clubs
    .filter((club) => club.id !== own.id && Math.abs(club.tier - own.tier) <= 1)
    .sort((a, b) => Math.abs(a.reputation - own.reputation) - Math.abs(b.reputation - own.reputation))
    .slice(0, 2);
  return [own.id, ...near.map((club) => club.id)];
}

export function retireIntoManagement(world: World, clubId: number): void {
  const hero = world.hero as Hero;
  const player = heroPlayer(world);
  if (!player || !world.clubs[clubId]) return;
  world.legend = {
    firstIdx: player.firstIdx, lastIdx: player.lastIdx, number: hero.number,
    apps: player.career.apps, goals: player.career.goals, honours: player.career.honours, clubId,
  };
  const club = world.clubs[player.clubId];
  if (club) club.playerIds = club.playerIds.filter((id) => id !== player.id);
  player.clubId = -1;
  player.retired = true;
  world.managedClubId = clubId;
  world.managerName = fullName(world.book, player.firstIdx, player.lastIdx);
  delete world.hero;
}
