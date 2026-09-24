import { describe, expect, it, beforeEach } from 'vitest';
import { caOf } from '../sim/ratings/ability.js';
import { createWorld } from '../sim/world/worldgen.js';
import { advanceDay, endSeason, startSeason } from '../sim/career/season.js';
import { SAVE_VERSION, defaultSettings } from './format.js';
import { loadGame, restoreWorld, saveGame, saveSizeBytes, setStore, wipeSave } from './api.js';
import { checksum, memoryStorage, readBest, writeSlot } from './storage.js';
import { migrate } from './migrations.js';

function freshStore() {
  const s = memoryStorage();
  setStore(s);
  return s;
}

function playSeason(world: ReturnType<typeof createWorld>): void {
  for (let i = 0; i < 400; i++) if (advanceDay(world).seasonEnded) return;
}

describe('slots', () => {
  beforeEach(() => freshStore());

  it('round-trips a payload', () => {
    const store = freshStore();
    writeSlot(store, 'hello');
    expect(readBest(store)).toBe('hello');
  });

  it('alternates slots so a half-written save never destroys the last good one', () => {
    const store = freshStore();
    writeSlot(store, 'first');
    writeSlot(store, 'second');
    // Corrupt whichever slot is now active; the older one must still load.
    const active = store.getItem('touchline:save-active');
    store.setItem(active === 'a' ? 'touchline:save-a' : 'touchline:save-b', '{"sum":1,"body":"tampered"}');
    expect(readBest(store)).toBe('first');
  });

  it('returns null when both slots are unreadable', () => {
    const store = freshStore();
    store.setItem('touchline:save-a', 'not json');
    store.setItem('touchline:save-b', '{"sum":99,"body":"mismatch"}');
    expect(readBest(store)).toBe(null);
  });

  it('detects a truncated payload', () => {
    expect(checksum('abc')).not.toBe(checksum('abcd'));
  });
});

describe('a career round-trips', () => {
  beforeEach(() => freshStore());

  it('restores a fresh world exactly', () => {
    const world = createWorld(1234);
    startSeason(world);
    world.managedClubId = 7;
    saveGame(world, defaultSettings());

    const loaded = loadGame();
    expect(loaded.kind).toBe('ok');
    if (loaded.kind !== 'ok') return;
    const back = restoreWorld(loaded.data);

    expect(back.seed).toBe(world.seed);
    expect(back.managedClubId).toBe(7);
    expect(back.clubs.length).toBe(world.clubs.length);
    expect(back.players.length).toBe(world.players.length);
    expect(back.fixtures.length).toBe(world.fixtures.length);
    expect(back.clubs.map((c) => c.name)).toEqual(world.clubs.map((c) => c.name));
    for (let i = 0; i < world.players.length; i += 97) {
      const a = world.players[i]!;
      const b = back.players[i]!;
      expect(Array.from(b.attrs)).toEqual(Array.from(a.attrs));
      expect(Array.from(b.familiarity)).toEqual(Array.from(a.familiarity));
      expect(b.natural).toBe(a.natural);
      expect(b.pa).toBe(a.pa);
      expect(b.clubId).toBe(a.clubId);
      expect(caOf(b.attrs, b.natural)).toBe(caOf(a.attrs, a.natural));
    }
  });

  it('restores mid-season state including played fixtures', () => {
    const world = createWorld(555);
    startSeason(world);
    world.managedClubId = 3;
    for (let i = 0; i < 90; i++) advanceDay(world);
    saveGame(world, defaultSettings());

    const loaded = loadGame();
    if (loaded.kind !== 'ok') throw new Error('save did not load');
    const back = restoreWorld(loaded.data);
    expect(back.day).toBe(world.day);
    expect(back.fixtures.filter((f) => f.played).length).toBe(world.fixtures.filter((f) => f.played).length);
    const a = world.fixtures.find((f) => f.played)!;
    const b = back.fixtures.find((f) => f.day === a.day && f.homeId === a.homeId)!;
    expect(b.homeGoals).toBe(a.homeGoals);
    expect(b.awayGoals).toBe(a.awayGoals);
  });

  it('keeps season and career statistics', () => {
    const world = createWorld(88);
    startSeason(world);
    world.managedClubId = 1;
    playSeason(world);
    saveGame(world, defaultSettings());
    const loaded = loadGame();
    if (loaded.kind !== 'ok') throw new Error('save did not load');
    const back = restoreWorld(loaded.data);
    const scorer = world.players.reduce((a, b) => (b.season.goals > a.season.goals ? b : a));
    expect(back.players[scorer.id]!.season.goals).toBe(scorer.season.goals);
    expect(back.players[scorer.id]!.career.apps).toBe(scorer.career.apps);
  });
});

// The budget from design §C, asserted so it cannot drift silently.
describe('the save budget', () => {
  beforeEach(() => freshStore());

  it('fits a fresh world in well under a megabyte per slot', () => {
    const world = createWorld(9);
    startSeason(world);
    world.managedClubId = 0;
    saveGame(world, defaultSettings());
    const bytes = saveSizeBytes();
    // Both slots plus the pointer. localStorage gives an origin about 5 MB.
    expect(bytes).toBeLessThan(1_400_000);
  });

  it('still fits after ten seasons of history', () => {
    const world = createWorld(10);
    startSeason(world);
    world.managedClubId = 0;
    for (let s = 0; s < 10; s++) {
      playSeason(world);
      endSeason(world);
    }
    saveGame(world, defaultSettings());
    saveGame(world, defaultSettings()); // fill both slots
    // BOUNDED, not merely large enough. Retired players are pruned at each season roll, so
    // a save after ten seasons is the same size as a fresh one — without that it grows by
    // about 270 players a year and a long career stops fitting at all.
    expect(saveSizeBytes()).toBeLessThan(1_600_000);
  });

  it('does not grow without bound as seasons pass', () => {
    const world = createWorld(11);
    startSeason(world);
    world.managedClubId = 0;
    // Twice, so both slots hold a payload — otherwise this compares one filled slot
    // against two and reports 2x growth that is not growth at all.
    saveGame(world, defaultSettings());
    saveGame(world, defaultSettings());
    const fresh = saveSizeBytes();
    for (let s = 0; s < 12; s++) {
      playSeason(world);
      endSeason(world);
    }
    saveGame(world, defaultSettings());
    expect(saveSizeBytes()).toBeLessThan(fresh * 1.5);
  });
});

describe('migration', () => {
  it('refuses a save from a newer build rather than mangling it', () => {
    expect(migrate({ version: 999 })).toEqual({ ok: false, reason: 'too-new' });
  });

  it('rejects nonsense', () => {
    expect(migrate(null).ok).toBe(false);
    expect(migrate({}).ok).toBe(false);
    expect(migrate('a string').ok).toBe(false);
  });

  it('passes a current-version save straight through', () => {
    const r = migrate({ version: SAVE_VERSION, hello: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as unknown as { hello: boolean }).hello).toBe(true);
  });

  // Design §C: forward-only and ADDITIVE. Every step below is asserted on its own rather
  // than only through the whole chain, because a chain test passes as long as the last
  // step happens to supply what the earlier one dropped.
  it('1 -> 2 adds onboarded, and does not re-open the tour on an existing career', () => {
    const r = migrate({ version: 1, settings: { sound: false, matchSpeed: 8 } });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.settings.onboarded).toBe(true);
    // Additive means additive: nothing that was already there may change.
    expect(r.data.settings.sound).toBe(false);
    expect(r.data.settings.matchSpeed).toBe(8);
  });

  it('1 -> 2 tolerates a save with no settings block at all', () => {
    const r = migrate({ version: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.settings.onboarded).toBe(true);
  });

  it('a save the player has already onboarded through keeps its own answer', () => {
    const r = migrate({ version: 1, settings: { onboarded: false } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.settings.onboarded).toBe(false);
  });
});

describe('an empty or broken store', () => {
  it('reports empty rather than throwing', () => {
    freshStore();
    wipeSave();
    expect(loadGame().kind).toBe('empty');
  });

  it('reports corrupt rather than throwing', () => {
    const store = freshStore();
    writeSlot(store, 'definitely not json');
    expect(loadGame().kind).toBe('corrupt');
  });
});
