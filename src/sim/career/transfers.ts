// The transfer market.
//
// It exists for a reason that only shows up over a long career: without it, a football
// world decays. Good players retire out of the top division and youth intakes replace them
// from below, so after twenty seasons the best league in the country is playing at what
// used to be third-division standard. Twenty simulated seasons showed exactly that — the
// top flight fell from 142 to 92 — and this is the mechanism that holds it up. Big clubs
// buy the best players from small ones, which is both what really happens and what keeps
// the pyramid a pyramid.
//
// The AI market runs once per season roll. It is a single pass in reputation order, which
// is crude but produces the right shape: the biggest clubs get first pick, and a good
// player at a small club does not stay there for ten years.

import { clamp, clamp01 } from '../../core/math.js';
import { chance, range, type Rng } from '../../core/rng.js';
import { caOf } from '../ratings/ability.js';
import { attrUnit } from '../ratings/attributes.js';
import { POSITION_INDEX, type Position } from '../ratings/positions.js';
import { assignSquadNumbers, valueFor, wageFor, SQUAD_SIZE } from '../world/worldgen.js';
import { squadOf, type Club, type World, type WorldPlayer } from '../world/types.js';
import { slotScore } from './squad.js';

export interface Transfer {
  playerId: number;
  fromClubId: number;
  toClubId: number;
  fee: number;
}

/** What a player is worth today. */
export function playerValue(p: WorldPlayer): number {
  return valueFor(caOf(p.attrs, p.natural), p.pa, p.age, p.contractYears);
}

/**
 * How much better this player would make the club's first eleven, in ability points.
 * Zero if he would not get in the side, which is the only sensible definition of "needed".
 */
export function upgradeValue(world: World, club: Club, candidate: WorldPlayer): number {
  const squad = squadOf(world, club.id);
  if (squad.length === 0) return 0;
  const position = candidate.natural;
  const current = squad
    .map((p) => slotScore(p, position))
    .sort((a, b) => b - a);
  // A squad wants roughly two players per position; being third choice is worth nothing.
  const incumbent = current[1] ?? current[0] ?? 0;
  return Math.max(0, slotScore(candidate, position) - incumbent);
}

/** Whether a club can carry this player's wages without breaching the budget. */
function affordsWage(world: World, club: Club, wage: number): boolean {
  const bill = squadOf(world, club.id).reduce((t, p) => t + p.wage, 0);
  return bill + wage <= club.wageBudget * 1.08;
}

/**
 * Would the selling club let him go?
 *
 * Three reasons a club sells: the money is too good, the player is surplus, or the buyer is
 * simply much bigger and there is no keeping him. The last one is what stops a fifth-tier
 * club hoarding a future international for a decade.
 */
function willSell(world: World, seller: Club, buyer: Club, p: WorldPlayer, fee: number, rng: Rng): boolean {
  if (squadOf(world, seller.id).length <= 18) return false;
  const value = playerValue(p);
  const surplus = upgradeValue(world, seller, p) <= 0;
  const pull = clamp01((buyer.reputation - seller.reputation) / 70);
  const loyalty = attrUnit(p.attrs, 'loyalty');
  const wantsToGo = clamp01(pull * 1.2 + (1 - p.morale) * 0.4 - loyalty * 0.35);
  if (fee >= value * 1.6) return true;
  if (surplus && fee >= value * 0.85) return true;
  return chance(rng, wantsToGo * clamp01(fee / Math.max(value, 1)));
}

/**
 * Run one summer's transfer window across the whole world.
 *
 * Reputation order is deliberate: it is how a football market clears, and doing it in
 * random order gives a fifth-tier club the best free agent in the country.
 */
export function runTransferWindow(world: World, rng: Rng): Transfer[] {
  const done: Transfer[] = [];
  const buyers = [...world.clubs].sort((a, b) => b.reputation - a.reputation);

  for (const buyer of buyers) {
    // How many signings the club will make: enough to fix its worst holes, no more.
    const budget = { cash: buyer.transferBudget };
    let signings = 0;
    const maxSignings = squadOf(world, buyer.id).length < SQUAD_SIZE ? 4 : 3;

    while (signings < maxSignings && budget.cash > 0) {
      const target = findTarget(world, buyer, budget.cash, rng);
      if (!target) break;
      const { player, fee } = target;
      const seller = world.clubs[player.clubId];
      if (!seller) break;

      budget.cash -= fee;
      buyer.balance -= fee;
      seller.balance += fee;
      seller.playerIds = seller.playerIds.filter((id) => id !== player.id);
      buyer.playerIds.push(player.id);
      player.clubId = buyer.id;
      player.wage = Math.max(player.wage, wageFor(caOf(player.attrs, player.natural), player.age));
      player.contractYears = Math.max(player.contractYears, 3);
      player.morale = clamp01(player.morale + 0.15);
      done.push({ playerId: player.id, fromClubId: seller.id, toClubId: buyer.id, fee });
      signings++;

      assignSquadNumbers(world, seller);
      assignSquadNumbers(world, buyer);
    }
  }
  return done;
}

/** The best available signing this club could make with the money it has. */
function findTarget(
  world: World,
  buyer: Club,
  cash: number,
  rng: Rng,
): { player: WorldPlayer; fee: number } | null {
  let best: { player: WorldPlayer; fee: number; gain: number } | null = null;

  for (const seller of world.clubs) {
    if (seller.id === buyer.id) continue;
    // A club shops within two divisions of itself — and anywhere at all if it simply
    // dwarfs the seller, which is how a big club plucks a player out of the fifth tier.
    const reach = Math.abs(seller.tier - buyer.tier);
    if (reach > 2 && buyer.reputation - seller.reputation < 45) continue;

    for (const p of squadOf(world, seller.id)) {
      const gain = upgradeValue(world, buyer, p);
      if (gain < 4) continue;
      const value = playerValue(p);
      const fee = Math.round(value * range(rng, 1.0, 1.35));
      if (fee > cash) continue;
      if (!affordsWage(world, buyer, wageFor(caOf(p.attrs, p.natural), p.age))) continue;
      if (!willSell(world, seller, buyer, p, fee, rng)) continue;
      // Value for money, not raw quality: a club with a small budget should buy two
      // useful players rather than one it cannot really afford.
      const score = gain / Math.max(fee / 250_000, 0.35);
      if (!best || score > best.gain) best = { player: p, fee, gain: score };
    }
  }
  return best ? { player: best.player, fee: best.fee } : null;
}

/**
 * Free agents — anyone left without a club after contracts expired — get picked up by
 * whoever has room. Without this they accumulate forever and the player list grows without
 * bound across a long save (design §C).
 */
export function placeFreeAgents(world: World, rng: Rng): void {
  const free = world.players.filter((p) => p.clubId < 0 && !p.retired);
  if (free.length === 0) return;
  free.sort((a, b) => caOf(b.attrs, b.natural) - caOf(a.attrs, a.natural));
  const clubs = [...world.clubs].sort((a, b) => b.reputation - a.reputation);

  for (const p of free) {
    const ca = caOf(p.attrs, p.natural);
    const wage = wageFor(ca, p.age);
    const home = clubs.find(
      (c) => c.playerIds.length < SQUAD_SIZE && affordsWage(world, c, wage) && upgradeValue(world, c, p) > 0,
    );
    if (home) {
      home.playerIds.push(p.id);
      p.clubId = home.id;
      p.wage = wage;
      p.contractYears = 2;
      assignSquadNumbers(world, home);
      continue;
    }
    // Nobody wants him. He leaves the game rather than lingering in the save forever.
    if (chance(rng, 0.85)) p.retired = true;
  }
}

/**
 * Drop players who have left the game, and renumber what is left.
 *
 * Without this the player list only ever grows — about 270 a season — and a save that
 * starts at 1 MB reaches 2.8 MB after twenty years and would not fit a thirty-year career
 * at all (design §C). Ids are array indices, so removal means renumbering, and the only
 * place a player id is held across a save is `club.playerIds`; fixtures and match results
 * never outlive the tick that produced them.
 */
export function pruneRetired(world: World): number {
  const keep = world.players.filter((p) => !p.retired || p.clubId >= 0);
  if (keep.length === world.players.length) return 0;

  const remap = new Map<number, number>();
  keep.forEach((p, i) => remap.set(p.id, i));

  const renumbered: WorldPlayer[] = keep.map((p, i) => ({ ...p, id: i }));
  const removed = world.players.length - renumbered.length;
  world.players = renumbered;
  for (const club of world.clubs) {
    club.playerIds = club.playerIds
      .map((id) => remap.get(id))
      .filter((id): id is number => id !== undefined);
  }
  return removed;
}

/** A club's total weekly wage bill. */
export function wageBill(world: World, club: Club): number {
  return squadOf(world, club.id).reduce((t, p) => t + p.wage, 0);
}

/** Which position a club is weakest in, for the news feed and the transfer screen. */
export function weakestPosition(world: World, club: Club): Position {
  const positions: Position[] = ['GK', 'DC', 'DL', 'DR', 'DM', 'MC', 'ML', 'MR', 'AMC', 'AML', 'AMR', 'ST'];
  let worst: Position = 'MC';
  let worstScore = Infinity;
  const squad = squadOf(world, club.id);
  for (const pos of positions) {
    const best = Math.max(0, ...squad.map((p) => slotScore(p, pos)));
    if (best < worstScore) {
      worstScore = best;
      worst = pos;
    }
  }
  void POSITION_INDEX;
  void clamp;
  return worst;
}
