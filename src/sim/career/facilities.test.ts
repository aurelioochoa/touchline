import { describe, expect, it } from 'vitest';
import { createWorld } from '../world/worldgen.js';
import { startSeason } from './season.js';
import { buildFacility, FACILITY_MAX, facilityCost, recoveryDays, shopIncome, standGrowth } from './facilities.js';
import { packWorld, unpackWorld } from '../../save/format.js';

function career() {
  const world = createWorld(4242);
  startSeason(world);
  world.managedClubId = world.divisions[2]?.clubIds[0] ?? 0;
  const club = world.clubs[world.managedClubId];
  if (!club) throw new Error('no club');
  return { world, club };
}

describe('facilities', () => {
  it('spends the balance and grows the ground', () => {
    const { world, club } = career();
    club.balance = 50_000_000;
    const cost = facilityCost(world, club, 'stands') ?? 0;
    const seats = standGrowth(club);
    const before = club.capacity;
    expect(buildFacility(world, 'stands')).toBe(true);
    expect(club.balance).toBe(50_000_000 - cost);
    expect(club.capacity).toBe(before + seats);
    expect(world.facilities.stands).toBe(1);
  });

  it('refuses what the club cannot afford, and changes nothing', () => {
    const { world, club } = career();
    club.balance = 10;
    expect(buildFacility(world, 'shop')).toBe(false);
    expect(club.balance).toBe(10);
    expect(world.facilities.shop).toBe(0);
  });

  it('stops at the top level', () => {
    const { world, club } = career();
    club.balance = 1e12;
    for (let i = 0; i < 10; i++) buildFacility(world, 'training');
    expect(world.facilities.training).toBe(FACILITY_MAX.training);
    expect(facilityCost(world, club, 'training')).toBeNull();
  });

  it('pays only the managed club, and only once built', () => {
    const { world, club } = career();
    const other = world.clubs.find((c) => c.id !== club.id);
    if (!other) throw new Error('no other club');
    expect(shopIncome(world, club, 1000)).toBe(0);
    world.facilities.shop = 2;
    expect(shopIncome(world, club, 1000)).toBeGreaterThan(0);
    expect(shopIncome(world, other, 1000)).toBe(0);
  });

  it('speeds recovery for the managed squad only', () => {
    const { world, club } = career();
    world.facilities.training = 2;
    const mine = world.players[club.playerIds[0] ?? 0];
    const theirs = world.players.find((p) => p.clubId !== club.id && p.clubId >= 0);
    if (!mine || !theirs) throw new Error('no players');
    expect(recoveryDays(world, mine)).toBeGreaterThan(1);
    expect(recoveryDays(world, theirs)).toBe(1);
  });

  it('survives a save round trip, with the look', () => {
    const { world } = career();
    world.facilities = { stands: 2, training: 1, shop: 3 };
    world.look = {
      shorts: 2, sleeves: 1, socks: 3, ball: 17, roof: 2,
      pattern: 4, patternColour: 2, chestBadge: false, numberColour: 3, numberStyle: 2,
    };
    const back = unpackWorld(JSON.parse(JSON.stringify(packWorld(world))));
    expect(back.facilities).toEqual(world.facilities);
    expect(back.look).toEqual(world.look);
  });

  it('gives an old save the defaults', () => {
    const { world } = career();
    const packed = JSON.parse(JSON.stringify(packWorld(world)));
    delete packed.look;
    delete packed.facilities;
    const back = unpackWorld(packed);
    expect(back.facilities).toEqual({ stands: 0, training: 0, shop: 0 });
    expect(back.look.shorts).toBe(1);
  });
});
