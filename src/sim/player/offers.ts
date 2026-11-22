// Which clubs want him (design player-career §A, §8).
//
// The AI market's own rule decides it: `upgradeValue` says whether he would make a club's
// side better, and the reach is the market's — a club looks within two divisions of itself.
// Fans widen how far up the pyramid word of him travels. The one promise layered on top:
// a hero who is not starting is always offered somewhere he would.

import { streamOf, shuffle } from '../../core/rng.js';
import { upgradeValue } from '../career/transfers.js';
import { pickEleven } from '../career/squad.js';
import type { Club, World } from '../world/types.js';
import { NEW_CLUB_RING, heroPlayer, startsFor, type Hero, type Offer } from './hero.js';

/** Whether he would start at this club, judged as a new arrival the coach does not know yet. */
export function wouldStartAt(world: World, club: Club): boolean {
  const hero = world.hero as Hero;
  const player = heroPlayer(world);
  if (!player) return false;
  const home = player.clubId;
  const coach = hero.coach;
  club.playerIds.push(player.id);
  player.clubId = club.id;
  hero.coach = NEW_CLUB_RING;
  const starts = pickEleven(world, club).eleven.some((member) => member.id === player.id);
  club.playerIds.pop();
  player.clubId = home;
  hero.coach = coach;
  return starts;
}

/** Up to three crest cards. Young and benched brings loans rather than transfers. */
export function heroOffers(world: World): Offer[] {
  const hero = world.hero as Hero;
  const player = heroPlayer(world);
  const own = player ? world.clubs[player.clubId] : undefined;
  if (!player || !own) return [];
  const benched = !startsFor(world, own);
  const loan = benched && player.age < 21;
  const reach = 1 + Math.round(hero.fans * 2);
  const rng = streamOf(world.seed + world.season * 977 + world.day, 'hero-offers');

  const keen = shuffle(rng, world.clubs.filter((club) =>
    club.id !== own.id && Math.abs(club.tier - own.tier) <= reach && upgradeValue(world, club, player) > 0));
  // Bigger clubs first, so the cards climb the pyramid when they can.
  const picked = keen.sort((a, b) => a.tier - b.tier).slice(0, 3);
  const offers = picked.map((club) => ({ clubId: club.id, starts: wouldStartAt(world, club), loan }));

  if (benched && !offers.some((offer) => offer.starts)) {
    // The guarantee: walk down from his own level until a club would start him.
    const fallback = [...world.clubs]
      .filter((club) => club.id !== own.id && club.tier >= own.tier)
      .sort((a, b) => a.tier - b.tier || b.reputation - a.reputation)
      .find((club) => wouldStartAt(world, club))
      ?? [...world.clubs].sort((a, b) => b.tier - a.tier)[0];
    if (fallback) offers.splice(Math.min(offers.length, 2), 1, { clubId: fallback.id, starts: true, loan });
  }
  return offers;
}
