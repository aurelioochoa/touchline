// The game: world, save, router and chrome.
//
// Hash routing, because there is no server-side rewrite on the site and a reload must land
// back where the player was (SHIP-CHECKLIST §2). One screen is rendered at a time into
// `#main`; the match takes over the whole viewport because nothing may cover a running
// game.

import { streamOf } from '../core/rng.js';
import { detectLang, setBlankStrings, setLang, t, type StringKey } from '../i18n.js';
import { audio } from '../audio/audio.js';
import { caOf } from '../sim/ratings/ability.js';
import { advanceDay, applyResult, endSeason, openMatch, playQuick, startSeason } from '../sim/career/season.js';
import { conditionsFor, type Conditions } from '../sim/match/conditions.js';
import { nextFixture, positionOf } from '../sim/career/fixtures.js';
import { playerValue } from '../sim/career/transfers.js';
import { assignSquadNumbers, createWorld, wageFor } from '../sim/world/worldgen.js';
import { fullName } from '../sim/world/names.js';
import { squadOf, type Club, type Fixture, type World } from '../sim/world/types.js';
import type { MatchEngine } from '../sim/match/engine.js';
import type { MatchState, Side } from '../sim/match/types.js';
import type { Line } from './commentary.js';
import { QUALITY_TIERS, DEFAULT_TIER } from '../render/tiers.js';
import { roofColour } from '../render/ballStyle.js';
import type { Settings } from '../save/format.js';
import {
  loadGame,
  makeThrottle,
  mostRecentSlot,
  restoreWorld,
  saveGame,
  savePrefs,
  settingsFor,
  wipeSave,
} from '../save/api.js';
import { button, clear, el, focusFirst, money } from './dom.js';
import { ordinal } from '../i18n.js';
import { icon, type IconName } from './icons.js';
import { installStyles } from './styles.js';
import { applyClubTheme, applyMotion } from './theme.js';
import { MatchScreen, fullTimeSheet, logSheet } from './match.js';
import { Coach, clubSteps, matchSteps } from './onboarding.js';
import { renderMenu } from './menu.js';
import { Intro, type IntroHost } from './intro.js';
import { groundScene } from './art/ground.js';
import { renderSettings } from './settings.js';
import { renderStudio } from './studio.js';
import {
  crest,
  renderClubPicker,
  renderFixtures,
  renderHome,
  renderSquad,
  renderTable,
  renderTactics,
  renderTransfers,
  type LastMatchView,
  type LiveMatchView,
  type ScreenHost,
} from './screens.js';

const ROUTES = ['home', 'squad', 'tactics', 'table', 'fixtures', 'transfers', 'studio', 'settings'] as const;
type Route = (typeof ROUTES)[number];

/**
 * The sections that get a tab, with their icon and label. One table, so nothing drifts.
 *
 * Settings is a route but not a tab: it is a gear in the top bar, the way it is in every
 * app a kid already uses, which is what frees the seventh tab for the club studio without
 * pushing the phone bar past the width a 56px target allows.
 */
const TABS: { route: Route; glyph: IconName; key: StringKey }[] = [
  { route: 'home', glyph: 'club', key: 'nav.home' },
  { route: 'squad', glyph: 'squad', key: 'nav.squad' },
  { route: 'tactics', glyph: 'tactics', key: 'nav.tactics' },
  { route: 'table', glyph: 'table', key: 'nav.table' },
  { route: 'fixtures', glyph: 'fixtures', key: 'nav.fixtures' },
  { route: 'transfers', glyph: 'transfers', key: 'nav.transfers' },
  { route: 'studio', glyph: 'palette', key: 'nav.studio' },
];

/**
 * A match that is being played right now, whether or not it is the thing on screen.
 *
 * The simulation belongs to the Game and the screen is a view of it, which is the whole
 * point: `attached` false means the player has gone back to the club and the engine is
 * still ticking behind it. Before this existed the two were the same object, so leaving
 * the match view and ending the match were the same act.
 */
interface LiveMatch {
  screen: MatchScreen;
  engine: MatchEngine;
  fixture: Fixture;
  mine: Side;
  attached: boolean;
}

/**
 * The match this career finished most recently, until the player moves on from it.
 *
 * Kept because a match can now finish while the player is on the transfer screen, and a
 * result they never saw needs somewhere to be seen. Both fields are plain data and outlive
 * the MatchScreen that produced them.
 */
interface LastMatch {
  state: MatchState;
  lines: readonly Line[];
  us: number;
  them: number;
}

export class Game implements ScreenHost {
  world: World;
  settings: Settings;
  readonly root = el('div', { class: 'tl-root' });
  #topbar = el('div', { class: 'tl-topbar' });
  #nav = el('nav', { class: 'tl-nav', 'aria-label': 'Sections' });
  #main = el('main', { class: 'tl-main', id: 'main' });
  #toasts = el('div', { class: 'tl-toast-host', role: 'status', 'aria-live': 'polite' });
  #live: LiveMatch | null = null;
  #lastMatch: LastMatch | null = null;
  #coach: Coach | null = null;
  #route: Route = 'home';
  #saveThrottled = makeThrottle(1500);
  /** Which career this is. Everything persisted goes to this slot and no other. */
  #slot = 0;
  /**
   * Whether the front door is showing.
   *
   * Deliberately not a Route: routes get a nav button and appear in the section keys, and
   * the menu is neither a section nor somewhere Tab should land mid-career.
   */
  #showMenu = true;
  /** The inheritance story, alive only while a brand-new career is being set up. */
  #intro: Intro | null = null;

  constructor(mount: HTMLElement) {
    installStyles();
    const params = new URLSearchParams(location.search);
    if (params.get('blank') === '1') setBlankStrings(true);

    // Boot into the most recently played career so "Continue" is one press, and fall back
    // to a fresh world in slot 0 when there is nothing saved at all.
    this.#slot = mostRecentSlot() ?? 0;
    const loaded = loadGame(this.#slot);
    if (loaded.kind === 'ok') {
      this.world = restoreWorld(loaded.data);
      this.settings = settingsFor(loaded.data.settings);
    } else {
      const seed = Number(params.get('seed') ?? Date.now() % 0x7fffffff) || 20260906;
      this.world = createWorld(seed);
      startSeason(this.world);
      this.settings = settingsFor(undefined);
    }
    setLang(this.settings.lang === 'es' || this.settings.lang === 'en' ? this.settings.lang : detectLang());
    audio.setEnabled(this.settings.sound);
    applyMotion(this.settings.reducedMotion);

    this.root.append(this.#topbar, this.#main);
    mount.append(this.root);
    document.body.append(this.#toasts);
    applyClubTheme(this.club);

    // Every browser suspends an AudioContext built outside a user gesture, and a console
    // warning is a failed ship gate. One listener, removed the moment it has fired.
    const wake = (): void => {
      if (this.settings.sound) audio.start();
      removeEventListener('pointerdown', wake);
      removeEventListener('keydown', wake);
    };
    addEventListener('pointerdown', wake);
    addEventListener('keydown', wake);

    addEventListener('hashchange', () => this.#syncRoute());
    this.#syncRoute();
  }

  get club(): Club | null {
    return this.world.clubs[this.world.managedClubId] ?? null;
  }

  /** The quality tier the settings ask for, or the default when they say `auto`. */
  get #tier(): number {
    return this.settings.quality === 'auto'
      ? DEFAULT_TIER
      : QUALITY_TIERS[this.settings.quality] ?? DEFAULT_TIER;
  }

  get #reducedMotion(): boolean {
    return this.settings.reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ---- routing ----------------------------------------------------------------

  go(route: string): void {
    this.#showMenu = false;
    // Navigating means the player is in the career. Nothing in the intro renders the nav,
    // so this only fires for a programmatic jump — the harnesses, and the deep link.
    if (this.#intro && this.world.managedClubId >= 0) this.#endIntro();
    location.hash = `#/${route}`;
  }

  #syncRoute(): void {
    const raw = location.hash.replace(/^#\/?/, '');
    const route = (ROUTES as readonly string[]).includes(raw) ? (raw as Route) : 'home';
    this.#route = route;
    this.refresh();
  }

  refresh(): void {
    // The match owns the screen while it is being WATCHED. A match running behind the club
    // screen does not, and the guard used to say `if (this.#match)` — which is why there was
    // no state in which the dashboard and a live match could both exist.
    if (this.#live?.attached) return;
    clear(this.#main);
    clear(this.#topbar);
    // Only the career screens have the rail; the menu, the intro and the picker use the
    // whole width, and a reserved empty column beside them would read as a layout fault.
    this.root.classList.remove('has-nav');
    this.root.querySelector('.tl-backdrop')?.remove();

    if (this.#showMenu) {
      this.#nav.remove();
      this.#backdrop();
      // Floodlight beams belong to the ground, not to the column: in the backdrop they are
      // fixed to the viewport, where inside the hero its entrance animation would trap them.
      this.root.querySelector('.tl-backdrop')?.append(el('div', { class: 'tl-menu-beams' }));
      const wrap = el('div', { class: 'tl-wrap tl-stack tl-enter tl-menu' });
      renderMenu(wrap, {
        onPlay: (slot) => this.openSlot(slot),
        onNew: (slot) => this.startNew(slot),
        onDelete: (slot) => {
          wipeSave(slot);
          // If the career that was open is the one just deleted, the in-memory world is
          // now a ghost: saving it would write it straight back.
          if (slot === this.#slot) this.startNew(slot, false);
        },
        settings: this.settings,
        onSettingsChange: () => savePrefs(this.settings),
      });
      this.#main.append(wrap);
      return;
    }

    if (this.#intro) {
      this.#nav.remove();
      this.#backdrop();
      this.#topbar.append(el('b', { class: 'tl-brand', text: t('app.title') }));
      const wrap = el('div', { class: 'tl-wrap tl-stack' });
      wrap.append(this.#intro.root);
      this.#main.append(wrap);
      return;
    }

    if (this.world.managedClubId < 0) {
      this.#nav.remove();
      this.#topbar.append(el('b', { class: 'tl-brand', text: t('app.title') }));
      const wrap = el('div', { class: 'tl-wrap tl-stack tl-enter' });
      renderClubPicker(this, wrap);
      this.#main.append(wrap);
      return;
    }

    this.#renderChrome();
    const wrap = el('div', { class: 'tl-wrap tl-stack tl-enter' });
    switch (this.#route) {
      case 'squad': renderSquad(this, wrap); break;
      case 'tactics': renderTactics(this, wrap); break;
      case 'table': renderTable(this, wrap); break;
      case 'fixtures': renderFixtures(this, wrap); break;
      case 'transfers': renderTransfers(this, wrap); break;
      case 'settings': renderSettings(this, wrap); break;
      case 'studio': renderStudio(this, wrap); break;
      default: renderHome(this, wrap); break;
    }
    this.#main.append(wrap);
    this.#main.scrollTop = 0;
    this.#maybeCoachClub();
  }

  /**
   * The ground, behind everything, on the two screens that are otherwise empty.
   *
   * The front door and the inheritance story are a card floating on a flat rectangle, and
   * they are the first two screens anybody sees. The drawing is a backdrop and nothing else:
   * it sits under the content, fades out toward the top so text stays legible over it, and
   * carries nothing a player needs. See src/ui/art/ for why it is SVG in a TypeScript file
   * and not an image.
   */
  #backdrop(): void {
    if (this.root.querySelector('.tl-backdrop')) return;
    const holder = el('div', { class: 'tl-backdrop', 'aria-hidden': 'true' }, [groundScene()]);
    this.root.prepend(holder);
  }

  #renderChrome(): void {
    const club = this.club;
    if (!club) return;
    const division = this.world.divisions[club.tier];
    const pos = positionOf(this.world, club.id);
    const next = nextFixture(this.world, club.id);
    const opponent = next ? this.world.clubs[next.homeId === club.id ? next.awayId : next.homeId] : null;

    // Identity: the badge and the name are one control, and it goes home. That is where a
    // kid expects the logo in the corner of anything to take them.
    const identity = el('button', {
      class: 'tl-top-id',
      type: 'button',
      'aria-label': `${club.name} — ${t('nav.home')}`,
    }, [
      crest(this.world, club, 40),
      el('span', { class: 'tl-title' }, [
        el('span', { class: 'tl-club', text: club.name }),
        el('span', {
          class: 'tl-sub',
          text: `${division?.name ?? ''} · ${t('home.season', { n: this.world.season + 1 })}`,
        }),
      ]),
    ]);
    identity.addEventListener('click', () => {
      audio.tick();
      this.go('home');
    });

    // The scorebug: where we are and what we can spend, always in view, because both change
    // after every match and neither used to be visible anywhere but the club screen.
    const bug = el('div', { class: 'tl-scorebug' }, [
      el('span', { class: 'tl-bug-cell', 'data-tip': t('home.position'), 'aria-label': `${t('home.position')} ${pos > 0 ? ordinal(pos) : '–'}` }, [
        icon('table', 15),
        el('b', { text: pos > 0 ? ordinal(pos) : '–' }),
        el('span', { class: 'tl-bug-label', text: t('home.position') }),
      ]),
      el('span', { class: 'tl-bug-cell', 'data-tip': t('top.balance'), 'aria-label': `${t('top.balance')} ${money(club.balance)}` }, [
        icon('coins', 15),
        el('b', { text: money(club.balance) }),
        el('span', { class: 'tl-bug-label', text: t('top.balance') }),
      ]),
    ]);

    const actions = el('div', { class: 'tl-top-actions' }, [
      button('', () => this.openMenu(), {
        class: 'tl-btn tl-ghost tl-icon-only tl-top-icon tl-top-menu', icon: 'home', 'aria-label': t('menu.back'),
      }),
      button('', () => {
        audio.tick();
        this.go('settings');
      }, {
        class: 'tl-btn tl-ghost tl-icon-only tl-top-icon tl-top-settings', icon: 'settings', 'aria-label': t('nav.settings'),
        'aria-current': this.#route === 'settings' ? 'page' : undefined,
      }),
    ]);
    // No Continue while a match is being played. The day cannot advance underneath a
    // fixture that is halfway through, and a button that silently means something else is
    // worse than one that is not there.
    if (!this.#live) {
      const go = button(t('home.continue'), () => this.continueDay(), {
        class: 'tl-btn tl-primary tl-top-continue', icon: 'forward', 'aria-label': t('home.continue'),
        tip: t('home.continueTip'),
      });
      if (opponent) go.append(el('small', { text: t('top.next', { club: opponent.short }) }));
      actions.append(go);
    }

    this.#topbar.append(identity, bug, el('span', { class: 'tl-spacer' }), actions);

    clear(this.#nav);
    for (const tab of TABS) {
      const current = this.#route === tab.route;
      const b = el('button', {
        class: 'tl-tab',
        type: 'button',
        'aria-current': current ? 'page' : undefined,
        'aria-label': t(tab.key),
      }, [el('span', { class: 'tl-tab-ico' }, [icon(tab.glyph, 20)]), el('span', { class: 'tl-tab-label', text: t(tab.key) })]);
      b.addEventListener('click', () => {
        audio.tick();
        this.go(tab.route);
      });
      this.#nav.append(b);
    }
    // A sibling of the top bar rather than inside it: on a desktop it is the left rail of
    // the grid, and on a phone it is fixed to the bottom and out of the flow either way.
    // Before #main in the DOM, so Tab meets the sections before the page, as it always has.
    this.root.insertBefore(this.#nav, this.#main);
    this.root.classList.add('has-nav');
  }

  // ---- career actions ----------------------------------------------------------

  pickClub(id: number): void {
    // Choosing a club is entering the career, whatever screen the request arrived from —
    // which is what keeps the headless harnesses working: they boot and call `pick`.
    this.#showMenu = false;
    this.world.managedClubId = id;
    if (this.#intro) {
      applyClubTheme(this.club);
      this.#intro.clubChosen();
      this.refresh();
      return;
    }
    applyClubTheme(this.club);
    audio.tick();
    this.saveNow();
    this.go('home');
    this.refresh();
  }

  /**
   * Advance until something happens: the managed club's next fixture, or the end of the
   * season. Everything in between is played by the quick engine.
   */
  continueDay(): void {
    const club = this.club;
    if (!club) return;
    // Whatever the player meant by this, they did not mean "skip the match that is
    // currently being played". Take them to it instead.
    if (this.#live) {
      this.watchLive();
      return;
    }
    this.#lastMatch = null;
    for (let guard = 0; guard < 400; guard++) {
      const fixture = nextFixture(this.world, club.id);
      if (fixture && fixture.day === this.world.day) return this.#showMatchPrompt();
      const report = advanceDay(this.world, { watchOwn: true });
      if (report.ownFixture) {
        this.save();
        this.refresh();
        return this.#showMatchPrompt();
      }
      if (report.seasonEnded) break;
    }
    this.save();
    this.refresh();
  }

  #showMatchPrompt(): void {
    this.save();
    this.go('home');
    this.refresh();
  }

  playMatch(watch: boolean): void {
    const club = this.club;
    if (!club) return;

    // A match is already being played. Quick result cannot skip a fixture that is halfway
    // through, and Watch means go back to the one that is running rather than start a
    // second one on top of it.
    if (this.#live) {
      this.watchLive();
      return;
    }

    const fixture = nextFixture(this.world, club.id);
    if (!fixture) return;
    this.#lastMatch = null;

    // Everything else on the same day is played first, so the table is current when the
    // player's own match kicks off.
    const rng = streamOf(this.world.seed + this.world.season * 104729 + fixture.day, 'day');
    for (const other of this.world.fixtures) {
      if (other.played || other.day !== fixture.day || other === fixture) continue;
      applyResult(this.world, other, playQuick(this.world, other, rng));
    }

    if (!watch) {
      const result = playQuick(this.world, fixture, rng);
      applyResult(this.world, fixture, result);
      this.world.day = fixture.day + 1;
      this.save();
      this.refresh();
      const mine = fixture.homeId === club.id;
      const us = mine ? result.homeGoals : result.awayGoals;
      const them = mine ? result.awayGoals : result.homeGoals;
      this.toast(
        t(us > them ? 'match.won' : us === them ? 'match.drew' : 'match.lost', { us, them }),
        us > them ? 'star' : 'whistle',
      );
      return;
    }

    const engine = openMatch(this.world, fixture);
    // The weather is derived, never stored: the same three numbers `openMatch` hashes into
    // the match seed decide what the sky is doing, so a fixture looks the same every time
    // it is played and a simulated round agrees with a watched one.
    const conditions = conditionsFor(this.world.seed, this.world.season, fixture.round);
    const mine: Side = fixture.homeId === club.id ? 'home' : 'away';
    this.#coach?.finish();
    const screen = new MatchScreen({
      engine,
      mine,
      dress: {
        ball: { style: this.world.look.ball, primary: club.kitPrimary, secondary: club.kitSecondary },
        // The roof is the ground's, so it is only ours when the match is at our ground.
        ...(mine === 'home' && this.world.look.roof !== 0
          ? { roof: roofColour(this.world.look.roof, club.kitPrimary, club.kitSecondary) }
          : {}),
      },
      speed: this.settings.matchSpeed,
      reducedMotion: this.#reducedMotion,
      sound: this.settings.sound,
      tier: this.#tier,
      conditions,
      commentary: this.settings.commentary,
      autoQuality: this.settings.quality === 'auto',
      onSpeedChange: (speed) => {
        this.settings.matchSpeed = speed;
        this.persist();
      },
      camera: this.settings.camera,
      onCameraChange: (camera) => {
        this.settings.camera = camera;
        this.persist();
      },
      onFinished: (state) => this.#finishMatch(state),
      // Back and Escape. Leaving is not abandoning: the fixture is untouched, the day does
      // not move, and the engine keeps running behind the club screen.
      onLeave: () => this.detachMatch(),
      onHalfTime: (state) => {
        const us = mine === 'home' ? state.score.home : state.score.away;
        const them = mine === 'home' ? state.score.away : state.score.home;
        this.toast(t('match.halfTimeScore', { us, them }), 'whistle');
      },
    });
    this.#live = { screen, engine, fixture, mine, attached: true };
    document.body.append(screen.root);
    this.root.classList.add('tl-hidden');
    this.#maybeCoachMatch(screen);
  }

  /** Bring the running match back to the front. What the club screen's live card does. */
  watchLive(): void {
    const live = this.#live;
    if (!live) return;
    this.#coach?.finish();
    live.attached = true;
    this.root.classList.add('tl-hidden');
    if (!live.screen.root.isConnected) document.body.append(live.screen.root);
    live.screen.setAttached(true);
  }

  /**
   * Put the match behind the club screen. The Back button, and Escape.
   *
   * Nothing about the fixture changes here — no result, no day, no save. That is the
   * entire fix: this used to run the match out with `runToEnd()` and record it, so a kid
   * who tapped Back to look at the table had fast-forwarded ninety minutes and could not
   * undo it.
   */
  detachMatch(): void {
    const live = this.#live;
    if (!live) return;
    this.#coach?.finish();
    live.attached = false;
    live.screen.setAttached(false);
    this.root.classList.remove('tl-hidden');
    this.refresh();
    focusFirst(this.#main);
  }

  /**
   * Full time, wherever the player happens to be.
   *
   * `runToEnd()` on a match that has already finished is a no-op loop that returns the
   * result the engine has been accumulating all along, which is what makes this one path
   * correct for a watched match and a backgrounded one alike.
   */
  #finishMatch(state: MatchState): void {
    const live = this.#live;
    if (!live) return;
    const { fixture, engine, screen, mine, attached } = live;
    if (!fixture.played) {
      applyResult(this.world, fixture, engine.runToEnd());
      this.world.day = fixture.day + 1;
    }
    this.saveNow();

    const us = mine === 'home' ? state.score.home : state.score.away;
    const them = mine === 'home' ? state.score.away : state.score.home;
    // Captured before the screen is disposed. Both are plain data and outlive it.
    this.#lastMatch = { state, lines: screen.logLines(), us, them };

    if (attached) {
      screen.showFullTime(() => this.#endMatch(), () => this.showMatchLog());
      return;
    }
    // Nobody was watching, so the result arrives as a toast rather than as a panel thrown
    // over whatever screen the player is actually on. The club screen keeps the summary.
    this.#endMatch();
    this.toast(
      t(us > them ? 'match.won' : us === them ? 'match.drew' : 'match.lost', { us, them }),
      us > them ? 'star' : 'whistle',
    );
  }

  /** Tear the match down. Only ever after full time — there is no way to abandon one. */
  #endMatch(): void {
    const live = this.#live;
    this.#live = null;
    this.#coach?.finish();
    live?.screen.dispose();
    this.root.classList.remove('tl-hidden');
    this.refresh();
    focusFirst(this.#main);
  }

  // ---- what the club screen's match card reads --------------------------------

  get liveMatch(): LiveMatchView | null {
    const live = this.#live;
    if (!live) return null;
    return {
      state: live.engine.state,
      mine: live.mine,
      summary: () => live.screen.liveSummary(),
    };
  }

  get lastMatch(): LastMatchView | null {
    const last = this.#lastMatch;
    if (!last) return null;
    return { us: last.us, them: last.them };
  }

  toggleMatchPause(): void {
    const live = this.#live;
    if (!live) return;
    live.screen.setPaused(!live.screen.paused);
    audio.tick();
    this.refresh();
  }

  showMatchSummary(): void {
    const last = this.#lastMatch;
    if (!last) return;
    fullTimeSheet({
      state: last.state,
      host: document.body,
      onClose: () => undefined,
      onLog: () => this.showMatchLog(),
    });
  }

  showMatchLog(): void {
    const last = this.#lastMatch;
    if (!last) return;
    logSheet(last.lines, document.body);
  }

  // ---- the guided first match --------------------------------------------------

  /**
   * Two steps on the club screen, ending on the Watch button — so the tour does not
   * explain the match, it starts it. Only ever on the home route, only once, and never
   * while a match or another coach is up.
   */
  #maybeCoachClub(): void {
    if (this.settings.onboarded || this.#coach || this.#live) return;
    if (this.#route !== 'home' || !this.club) return;
    if (!nextFixture(this.world, this.club.id)) return;
    // A timer, not requestAnimationFrame. rAF does not fire at all in a background tab,
    // and a tour that silently never starts because the kid opened the game in a second
    // tab and went to look at something else is worse than one that starts a frame early.
    // The delay is only to let the card entrance settle before anything is measured, and
    // the coach re-measures on a timer anyway.
    setTimeout(() => {
      if (this.settings.onboarded || this.#coach || this.#live) return;
      const watch = (): Element | null => this.#main.querySelector('.tl-btn.tl-primary');
      if (!watch()) return;
      this.#coach = new Coach(this.root, clubSteps(watch), () => {
        this.#coach = null;
      });
    }, 80);
  }

  /** And five more inside the match, on the three levers that are rungs 1 to 3. */
  #maybeCoachMatch(screen: MatchScreen): void {
    if (this.settings.onboarded) return;
    setTimeout(() => {
      if (this.settings.onboarded || !this.#live) return;
      this.#coach = new Coach(screen.root, matchSteps({
        strip: () => screen.coachTargets.strip,
        speed: () => screen.coachTargets.speed,
        tactics: () => screen.coachTargets.tactics,
        drawer: () => screen.coachTargets.drawer,
        goalsSoFar: () => screen.state.score.home + screen.state.score.away,
      }), () => {
        this.#coach = null;
        // Finishing OR skipping ends it for good. A tour you dismissed and then get again
        // on the next match is not a tour, it is an advertisement.
        this.settings.onboarded = true;
        this.saveNow();
      });
    }, 80);
  }

  rollSeason(): void {
    endSeason(this.world);
    applyClubTheme(this.club);
    this.save();
    this.refresh();
    this.toast(t('home.season', { n: this.world.season + 1 }), 'star');
  }

  buy(playerId: number): void {
    const club = this.club;
    const p = this.world.players[playerId];
    if (!club || !p) return;
    const seller = this.world.clubs[p.clubId];
    if (!seller || seller.id === club.id) return;
    const fee = Math.round(playerValue(p) * 1.15);
    if (fee > club.transferBudget) return;

    club.transferBudget -= fee;
    club.balance -= fee;
    seller.balance += fee;
    seller.playerIds = seller.playerIds.filter((id) => id !== playerId);
    club.playerIds.push(playerId);
    p.clubId = club.id;
    p.wage = Math.max(p.wage, wageFor(caOf(p.attrs, p.natural), p.age));
    p.contractYears = Math.max(p.contractYears, 3);
    assignSquadNumbers(this.world, seller);
    assignSquadNumbers(this.world, club);
    audio.tick();
    this.toast(
      t('transfers.bought', { name: fullName(this.world.book, p.firstIdx, p.lastIdx), fee: money(fee) }),
      'check',
    );
    this.save();
    this.refresh();
  }

  sell(playerId: number): void {
    const club = this.club;
    const p = this.world.players[playerId];
    if (!club || !p || p.clubId !== club.id) return;
    if (squadOf(this.world, club.id).length <= 18) return;
    const fee = Math.round(playerValue(p) * 0.9);
    club.transferBudget += fee;
    club.balance += fee;
    club.playerIds = club.playerIds.filter((id) => id !== playerId);
    p.clubId = -1;
    assignSquadNumbers(this.world, club);
    audio.tick(false);
    this.toast(
      t('transfers.sold', { name: fullName(this.world.book, p.firstIdx, p.lastIdx), fee: money(fee) }),
      'check',
    );
    this.save();
    this.refresh();
  }

  /** Record a change without re-rendering. The tactics editor needs this (see commit()). */
  persist(): void {
    savePrefs(this.settings);
    this.save();
  }

  toast(message: string, glyph: IconName = 'check'): void {
    if (!message) return;
    const node = el('div', { class: 'tl-toast' }, [icon(glyph, 18), el('span', { text: message })]);
    this.#toasts.append(node);
    setTimeout(() => node.remove(), 3200);
  }

  // --- hooks for the headless harnesses (scripts/shots.mjs) ---------------------
  // Driving the match through requestAnimationFrame does not work under automation, which
  // throttles it to nothing in a background tab, so the harness steps and draws directly.

  get matchState() {
    return this.#live?.screen.state ?? null;
  }

  /** Whether the match is the thing on screen, rather than running behind the club. */
  get matchAttached(): boolean {
    return this.#live?.attached ?? false;
  }

  matchStep(): void {
    this.#live?.screen.stepOnce();
  }

  matchPause(on: boolean): void {
    this.#live?.screen.setPaused(on);
  }

  get matchRenderer() {
    return this.#live?.screen.renderClient ?? null;
  }

  matchDrawAt(dt: number, alpha: number): void {
    this.#live?.screen.drawAt(dt, alpha);
  }

  matchDraw(frames: number): void {
    this.#live?.screen.drawFrames(frames);
  }

  /**
   * Force the weather, for the contact sheet.
   *
   * A season's worth of skies cannot be screenshotted by waiting for one: conditions are
   * derived from the fixture, so a rainy night match arrives when the calendar says so and
   * not when the harness wants a picture of one.
   */
  matchConditions(c: Conditions): void {
    this.#live?.screen.setConditions(c);
  }

  /**
   * Open the half-time or full-time screen, for the harnesses. Full time closes the same
   * way the real one does, so the check exercises the button as well as the panel.
   */
  matchBreak(which: 'half' | 'full'): void {
    this.#live?.screen.openBreak(which, () => this.#endMatch());
  }

  /** End any onboarding, for harnesses that want the plain screen. */
  dismissCoach(): void {
    this.#coach?.finish();
    this.settings.onboarded = true;
  }

  /**
   * Leave the match the way the Back button does — which now means putting it behind the
   * club screen and nothing else.
   *
   * The rule this hook is here to keep is unchanged and still worth stating: a debug hook
   * that takes a different path from the control it stands in for is worse than no hook.
   * It goes through `requestLeave` for exactly that reason, so a harness that leaves a
   * match sees what a kid pressing Back sees, including the fact that the match is still
   * being played afterwards.
   */
  leaveMatch(): void {
    this.#live?.screen.requestLeave();
  }

  save(): void {
    this.#saveThrottled(() => this.saveNow());
  }

  /** Save without the throttle — used when the tab is going away. */
  saveNow(): void {
    // A world with no club is a world the player abandoned at the picker. Writing it would
    // fill a slot with a career nobody started, and the menu would offer to continue it.
    if (this.world.managedClubId < 0) return;
    saveGame(this.world, this.settings, this.#slot);
  }

  /** Open an existing career. */
  openSlot(slot: number): void {
    const loaded = loadGame(slot);
    if (loaded.kind !== 'ok') {
      this.startNew(slot);
      return;
    }
    this.#slot = slot;
    this.world = restoreWorld(loaded.data);
    this.settings = settingsFor(loaded.data.settings);
    applyClubTheme(this.club);
    applyMotion(this.settings.reducedMotion);
    this.#showMenu = false;
    this.#route = 'home';
    this.refresh();
  }

  /**
   * Start a fresh career in a slot, wiping whatever was there.
   *
   * `enter` false leaves the player on the menu — which is what deleting the open career
   * wants, since it has to replace the live world with something saveable without
   * pretending the player asked to start playing again.
   */
  startNew(slot: number, enter = true): void {
    wipeSave(slot);
    this.#slot = slot;
    const seed = Date.now() % 0x7fffffff || 20260906;
    this.world = createWorld(seed);
    startSeason(this.world);
    applyClubTheme(this.club);
    if (!enter) return;
    this.#showMenu = false;
    this.#route = 'home';
    // A brand-new career meets the letter first. Loading an existing one never does.
    this.#intro = new Intro(this.#introHost(), this.#reducedMotion);
    this.refresh();
  }

  /** Leave the intro, with the defaults it would have applied on the way out. */
  #endIntro(): void {
    if (!this.#intro) return;
    if (!this.world.managerName.trim()) this.world.managerName = t('intro.defaultManager');
    this.#intro = null;
    this.saveNow();
    applyClubTheme(this.club);
  }

  #introHost(): IntroHost {
    // Getters, not captured values. `startNew` replaces `this.world` wholesale and the
    // club is chosen partway through the intro, so a host holding either by value would be
    // pointing at the previous career by the time the badge editor asked for it.
    const game = this;
    return {
      get world(): World {
        return game.world;
      },
      get club(): Club | null {
        return game.club;
      },
      renderPicker: (into: HTMLElement) => renderClubPicker(this, into),
      finish: () => {
        this.#intro = null;
        this.saveNow();
        applyClubTheme(this.club);
        this.refresh();
      },
      persist: () => this.persist(),
    };
  }

  /** Back to the front door. */
  openMenu(): void {
    this.saveNow();
    this.#showMenu = true;
    this.refresh();
  }

  newCareer(): void {
    wipeSave(this.#slot);
    location.reload();
  }
}
