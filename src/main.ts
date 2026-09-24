// Boot.
//
// A boot flash goes up before anything else and comes down on the first rendered frame, so
// an exception in here leaves a dash on screen rather than a dead page — the same shape
// Starhaven uses, and for the same reason: a kid has no way to read a console.

import { audio } from './audio/audio.js';
import { Game } from './ui/app.js';
import { voicesReady } from './ui/voice.js';

const flash = document.createElement('div');
flash.id = 'boot-flash';
flash.textContent = 'Touchline';
document.body.appendChild(flash);

try {
  boot();
} catch (err) {
  flash.textContent = '—';
  console.error(err);
}

function boot(): void {
  const app = document.getElementById('app');
  if (!app) throw new Error('#app missing');

  const game = new Game(app);
  flash.remove();

  // Warm the speech-synthesis voice list. Chrome populates it asynchronously, so a
  // settings screen opened in the first second would decide there is no offline voice and
  // hide the spoken-commentary option for the rest of the session. Deliberately not
  // awaited: nothing on the first screen depends on it.
  void voicesReady();

  // Save on the way out. `pagehide` rather than `unload`, which is unreliable on mobile,
  // and `visibilitychange` because a phone backgrounding the tab may never fire either.
  const persist = (): void => game.saveNow();
  addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) persist();
  });

  // Debug hook for the headless harnesses — the same pattern Starhaven and Lumen Reef use.
  (window as unknown as Record<string, unknown>).__touchline = {
    game,
    get world() {
      return game.world;
    },
    go: (route: string) => game.go(route),
    pick: (clubId: number) => game.pickClub(clubId),
    watch: () => game.playMatch(true),
    // Back, and coming back. Leaving no longer ends the match, so a harness needs both.
    leave: () => game.leaveMatch(),
    watchLive: () => game.watchLive(),
    attached: () => game.matchAttached,
    matchBreak: (which: 'half' | 'full') => game.matchBreak(which),
    conditions: (c: unknown) => game.matchConditions(c as never),
    dismissCoach: () => game.dismissCoach(),
    quick: () => game.playMatch(false),
    advanceDays: (n: number) => {
      for (let i = 0; i < n; i++) game.continueDay();
    },
    newCareer: () => game.newCareer(),
    startNew: (slot: number) => game.startNew(slot),
    openSlot: (slot: number) => game.openSlot(slot),
    openMenu: () => game.openMenu(),
    // The sound engine, so a harness can drive every voice without a match to cue it.
    audio,
  };
}
