// The manager screens.
//
// Every one of them obeys the depth ladder (design §5b): what a kid needs is a bar height
// or a spatial arrangement, and the words are enrichment beside it. Ability is a bar with
// the numeral next to it, form is a row of shaped pips, the table is crests and numbers,
// and the shape is a pitch you drag people around on.
//
// Composition rule for the whole file: **one card per question the screen answers.** The
// club screen answers "how are we doing", "who is next" and "what does the board think",
// so it is three cards and a table, not a wall of panels. Nothing nests inside a card.

import { clamp01 } from '../core/math.js';
import { ordinal, t, type StringKey } from '../i18n.js';
import { audio } from '../audio/audio.js';
import { caOf, stars } from '../sim/ratings/ability.js';
import { attr, GOALKEEPING, MENTAL, PHYSICAL, TECHNICAL, type AnyAttr } from '../sim/ratings/attributes.js';
import type { Position } from '../sim/ratings/positions.js';
import { FORMATIONS, INSTRUCTION_PRESETS, deriveLabel } from '../sim/match/tactics.js';
import type { FormationSlot, MatchState, Side } from '../sim/match/types.js';
import { Minimap } from './minimap.js';
import { buildTable, nextFixture, positionOf } from '../sim/career/fixtures.js';
import { pickEleven } from '../sim/career/squad.js';
import { playerValue } from '../sim/career/transfers.js';
import { fullName, surname } from '../sim/world/names.js';
import { clubStrength, inkOn, startingClubs } from '../sim/world/worldgen.js';
import { squadOf, type Club, type World, type WorldPlayer } from '../sim/world/types.js';
import { icon, type IconName } from './icons.js';
import { kitCss } from './theme.js';
import { clubCrest } from './crest.js';
import { kitArt, numberInk } from './art/kit.js';
import { NUMBER_STYLES } from '../render/kitPattern.js';
import { FACILITY_KINDS, facilityCost } from '../sim/career/facilities.js';
import { emptyScene, type EmptyScene } from './art/empty.js';
import {
  attrBar,
  bar,
  button,
  card,
  clear,
  el,
  heading,
  money,
  sheet,
  stat,
  toneOf,
} from './dom.js';

/** A running match, as much of it as the club screen needs. */
export interface LiveMatchView {
  /** Live and mutating — the card's minimap reads it several times a second. */
  readonly state: MatchState;
  readonly mine: Side;
  summary(): {
    minute: number;
    home: number;
    away: number;
    homeShort: string;
    awayShort: string;
    paused: boolean;
    finished: boolean;
  };
}

/** The match that just finished, from the managed club's point of view. */
export interface LastMatchView {
  us: number;
  them: number;
}

export interface ScreenHost {
  world: World;
  club: Club | null;
  go(route: string): void;
  refresh(): void;
  /** Save without re-rendering — for editors that must not lose focus mid-edit. */
  persist(): void;
  pickClub(id: number): void;
  continueDay(): void;
  playMatch(watch: boolean): void;
  rollSeason(): void;
  buy(playerId: number): void;
  sell(playerId: number): void;
  toast(message: string, glyph?: IconName): void;
  /** Back to the front door, saving on the way out. */
  openMenu(): void;
  /** The match being played right now, or null. A match can be live on any screen. */
  readonly liveMatch: LiveMatchView | null;
  /** The last match this career finished, until the player presses Continue. */
  readonly lastMatch: LastMatchView | null;
  /** Bring the running match back to the front. */
  watchLive(): void;
  toggleMatchPause(): void;
  showMatchSummary(): void;
  showMatchLog(): void;
}

const posLabel = (p: Position): string => t(`pos.${p}` as StringKey);

/** The 1–200 Current Ability scale as the 1–20 one a player reads. */
const asTwenty = (ca: number): number => Math.max(1, Math.min(20, Math.round(((ca - 1) / 199) * 19 + 1)));

/**
 * A club's badge.
 *
 * A thin wrapper on `clubCrest` so every screen in this file keeps calling `crest(...)`, and
 * so the world — which is what knows whether this club is the managed one and therefore
 * whether it has an authored badge — is threaded in from one place.
 *
 * It used to be a CSS gradient in a rounded box: the same silhouette for every club in the
 * game, at every size, on every screen, with only the two colours to tell three hundred of
 * them apart. See `src/ui/crest.ts` for what replaced it and why every club can have its own
 * without costing a byte of save.
 */
export function crest(world: World, club: Club, size = 34): SVGSVGElement {
  return clubCrest(world, club, size);
}

/** Recent results as five shaped pips: shape AND colour, so it survives colour blindness. */
function formPips(ratings: readonly number[]): HTMLElement {
  const row = el('span', { class: 'tl-form' });
  const recent = ratings.slice(-5);
  for (const r of recent) {
    const cls = r >= 7.2 ? 'w' : r >= 6.2 ? 'd' : 'l';
    row.append(el('i', { class: cls, text: cls === 'w' ? '▲' : cls === 'd' ? '■' : '▼', title: r.toFixed(1) }));
  }
  if (recent.length === 0) row.append(el('span', { class: 'tl-muted', text: '–' }));
  return row;
}

/** A short availability tag, or nothing. */
function statusPill(p: WorldPlayer): HTMLElement | null {
  if (p.injuryDays > 0) return el('span', { class: 'tl-pill bad', text: t('squad.injured') });
  if (p.banMatches > 0) return el('span', { class: 'tl-pill warn', text: t('squad.banned') });
  return null;
}

/**
 * A panel with nothing in it, and a picture of why.
 *
 * It used to be one flat 30px icon above a sentence, in all four places — which says "this
 * is empty" and nothing else, so a season finished and a transfer market with nobody in it
 * looked like the same event. A scene can carry the difference. See src/ui/art/ for why
 * these are SVG in a TypeScript file rather than images.
 */
function emptyState(message: string, art: EmptyScene): HTMLElement {
  return el('div', { class: 'tl-empty' }, [emptyScene(art), el('span', { text: message })]);
}

// ---- club picker --------------------------------------------------------------

export function renderClubPicker(host: ScreenHost, root: HTMLElement): void {
  const world = host.world;
  root.append(card([
    el('h1', { class: 'tl-display', text: t('club.pick.title') }),
    el('p', { class: 'tl-lede', style: 'margin:0', text: t('club.pick.hint') }),
  ]));

  for (const division of world.divisions) {
    const clubs = startingClubs(world, division.tier);
    if (clubs.length === 0) continue;
    const panel = card([heading(division.name, 'table')], { class: 'tl-card' });
    const cards = el('div', { class: 'tl-cards' });
    for (const club of clubs) {
      const strength = clamp01(clubStrength(world, club) / 180);
      const cardEl = el('button', {
        class: 'tl-club-card',
        type: 'button',
        style: `--card-a:${kitCss(club.kitPrimary)};--card-b:${kitCss(club.kitSecondary)}`,
        'aria-label': `${club.name}, ${division.name}`,
      }, [
        el('div', { class: 'rowtop' }, [
          crest(world, club, 30),
          el('span', { class: 'abbr', text: club.short }),
        ]),
        el('div', { class: 'nm', text: club.name }),
        // One bar, no caption. The word "Squad" repeated fifty-one times down a screen of
        // clubs tells a reader nothing the bar has not already said, and design §3 asks
        // this screen for crests, colours and one strength bar each.
        bar(strength, { label: t('club.pick.strength'), tone: toneOf(strength) }),
      ]);
      cardEl.addEventListener('click', () => host.pickClub(club.id));
      cards.append(cardEl);
    }
    panel.append(cards);
    root.append(panel);
  }
}

// ---- club (home) ---------------------------------------------------------------

export function renderHome(host: ScreenHost, root: HTMLElement): void {
  const { world, club } = host;
  if (!club) return;
  const table = buildTable(world, club.tier);
  const fixture = nextFixture(world, club.id);

  // Two columns from 940px: the MATCH column, which is what the screen is for, and a rail
  // of the things a manager glances at between matches. One column on a phone, in that
  // same order, so the next match is always the first thing under the thumb.
  const main = el('div', { class: 'tl-dash-main' });
  const rail = el('div', { class: 'tl-dash-rail' });

  const live = host.liveMatch;
  const last = host.lastMatch;

  // One card, four states, and which one it is comes from the MATCH rather than from the
  // calendar. That is the whole of the fix to a button that said "Watch" whether the match
  // had started or not: the label is now a reading of what is actually happening.
  if (live) {
    main.append(liveMatchCard(host, live));
  } else if (last) {
    main.append(fullTimeCard(host, last));
  } else if (!fixture) {
    main.append(card([
      heading(t('home.seasonOver'), 'star'),
      el('p', { class: 'tl-lede', text: t('home.seasonOverBody') }),
      button(t('home.newSeason'), () => host.rollSeason(), { class: 'tl-btn tl-primary tl-block', icon: 'forward' }),
    ]));
  } else {
    main.append(matchHero(host, fixture));
  }

  const upcoming = upcomingCard(host, fixture);
  if (upcoming) main.append(upcoming);
  main.append(leagueCard(host, table));

  rail.append(clubCard(host), moneyCard(host), scorerCard(host));
  root.append(el('div', { class: 'tl-dash' }, [main, rail]));
}

/** The last few results of any club, oldest first, as w / d / l. */
function resultsOf(world: World, clubId: number, n = 5): ('w' | 'd' | 'l')[] {
  const out: ('w' | 'd' | 'l')[] = [];
  for (const f of world.fixtures) {
    if (!f.played || (f.homeId !== clubId && f.awayId !== clubId)) continue;
    const us = f.homeId === clubId ? f.homeGoals : f.awayGoals;
    const them = f.homeId === clubId ? f.awayGoals : f.homeGoals;
    out.push(us > them ? 'w' : us === them ? 'd' : 'l');
  }
  return out.slice(-n);
}

/** Results as the same shaped pips a player's form uses: shape AND colour. */
function resultPips(results: readonly ('w' | 'd' | 'l')[]): HTMLElement {
  const row = el('span', { class: 'tl-form' });
  for (const r of results) row.append(el('i', { class: r, text: r === 'w' ? '▲' : r === 'd' ? '■' : '▼' }));
  if (results.length === 0) row.append(el('span', { class: 'tl-muted', text: '–' }));
  return row;
}

/**
 * The next match, as the biggest thing on the screen.
 *
 * Both clubs' colours meet in a band across the top, each side carries its crest, its place
 * in the table and its last five, and the two buttons are the only actions on the card.
 */
function matchHero(host: ScreenHost, fixture: NonNullable<ReturnType<typeof nextFixture>>): HTMLElement {
  const { world } = host;
  const club = host.club as Club;
  const isHome = fixture.homeId === club.id;
  const home = world.clubs[fixture.homeId];
  const away = world.clubs[fixture.awayId];
  const opponent = isHome ? away : home;

  const side = (c: Club | undefined): HTMLElement => {
    if (!c) return el('div');
    const pos = positionOf(world, c.id);
    return el('div', { class: `tl-hero-side${c.id === club.id ? ' mine' : ''}` }, [
      crest(world, c, 76),
      el('b', { class: 'tl-hero-name', text: c.name }),
      el('span', { class: 'tl-hero-meta' }, [
        pos > 0 ? el('span', { text: ordinal(pos) }) : null,
        resultPips(resultsOf(world, c.id)),
      ]),
    ]);
  };

  return el('section', {
    class: 'tl-card tl-hero',
    style: `--home:${kitCss(home?.kitPrimary ?? 0)};--away:${kitCss(away?.kitPrimary ?? 0)}`,
    'aria-label': t('home.next'),
  }, [
    el('div', { class: 'tl-hero-top' }, [
      heading(t('home.next'), 'whistle'),
      el('span', { class: 'tl-pill', text: t('home.matchday', { n: fixture.round + 1 }) }),
      el('span', { class: `tl-pill ${isHome ? 'club' : ''}`, text: isHome ? t('fixtures.home') : t('fixtures.away') }),
    ]),
    el('div', { class: 'tl-hero-vs' }, [
      side(home),
      el('span', { class: 'tl-hero-v', text: t('home.versus') }),
      side(away),
    ]),
    el('div', { class: 'tl-hero-actions' }, [
      // START, because the match has not started. It said "Watch" in both states.
      button(t('match.start'), () => host.playMatch(true), { class: 'tl-btn tl-primary tl-kick', icon: 'play' }),
      button(t('match.quick'), () => host.playMatch(false), {
        class: 'tl-btn tl-ghost', icon: 'skip', tip: t('match.quickTip'),
      }),
    ]),
    el('p', { class: 'tl-hero-venue' }, [
      icon('stadium', 15),
      el('span', {
        text: isHome ? t('home.atHome', { stadium: club.stadium }) : t('home.away', { club: opponent?.name ?? '' }),
      }),
    ]),
  ]);
}

/** The three fixtures after the next one. Nothing at all when there are none. */
function upcomingCard(host: ScreenHost, next: ReturnType<typeof nextFixture>): HTMLElement | null {
  const { world } = host;
  const club = host.club as Club;
  const later = world.fixtures
    .filter((f) => !f.played && f !== next && (f.homeId === club.id || f.awayId === club.id))
    .slice(0, 3);
  if (later.length === 0) return null;
  const rows = el('div', { class: 'tl-upcoming' });
  for (const f of later) {
    const isHome = f.homeId === club.id;
    const opp = world.clubs[isHome ? f.awayId : f.homeId];
    rows.append(el('div', { class: 'tl-up-row' }, [
      el('span', { class: 'tl-up-round', text: String(f.round + 1) }),
      opp ? crest(world, opp, 26) : null,
      el('b', { class: 'tl-up-name', text: opp?.name ?? '' }),
      el('span', { class: `tl-pill${isHome ? ' club' : ''}`, text: isHome ? t('fixtures.home') : t('fixtures.away') }),
    ]));
  }
  return card([
    heading(t('home.upcoming'), 'fixtures'),
    rows,
    button(t('nav.fixtures'), () => host.go('fixtures'), { class: 'tl-btn tl-sm tl-ghost tl-card-link', icon: 'chevron' }),
  ]);
}

/** Where the club stands: the neighbourhood of the table, the record and the last five. */
function leagueCard(host: ScreenHost, table: ReturnType<typeof buildTable>): HTMLElement {
  const { world } = host;
  const club = host.club as Club;
  const division = world.divisions[club.tier];
  const row = table.find((r) => r.clubId === club.id);
  const me = table.findIndex((r) => r.clubId === club.id);
  const from = Math.max(0, Math.min(me - 2, table.length - 5));
  const panel = card([heading(division?.name ?? t('nav.table'), 'table')], { class: 'tl-card tl-flush' });
  panel.append(el('div', { class: 'tl-league-strip' }, [
    el('span', { class: 'tl-league-record', text: t('home.record', { w: row?.won ?? 0, d: row?.drawn ?? 0, l: row?.lost ?? 0 }) }),
    el('span', { class: 'tl-league-form' }, [el('span', { text: t('home.form') }), resultPips(resultsOf(world, club.id))]),
  ]));
  panel.append(tableElement(host, table.slice(from, from + 5), club.id, from + 1));
  panel.append(el('div', { class: 'tl-card-foot' }, [
    button(t('table.full'), () => host.go('table'), { class: 'tl-btn tl-sm tl-ghost', icon: 'chevron' }),
  ]));
  return panel;
}

/** The club itself: badge, kit and ground, and the way into the studio. */
function clubCard(host: ScreenHost): HTMLElement {
  const { world } = host;
  const club = host.club as Club;
  const colours = { primary: club.kitPrimary, secondary: club.kitSecondary };
  const canBuild = FACILITY_KINDS.some((k) => {
    const cost = facilityCost(world, club, k);
    return cost !== null && cost <= club.balance;
  });
  return card([
    heading(t('home.yourClub'), 'club'),
    el('div', { class: 'tl-clubcard' }, [
      el('div', { class: 'tl-clubcard-art' }, [crest(world, club, 64), kitArt(world.look, colours)]),
      el('div', { class: 'tl-clubcard-text' }, [
        el('b', { text: club.stadium }),
        el('span', { class: 'tl-muted', text: t('home.capacity', { n: club.capacity.toLocaleString() }) }),
        canBuild ? el('span', { class: 'tl-pill good tl-nudge' }, [icon('build', 12), el('span', { text: t('home.canBuild') })]) : null,
      ]),
    ]),
    button(t('home.openStudio'), () => host.go('studio'), { class: 'tl-btn tl-block', icon: 'palette' }),
  ], { class: 'tl-card tl-clubcard-card', style: `--card-a:${kitCss(club.kitPrimary)};--card-b:${kitCss(club.kitSecondary)}` });
}

/** The board and the money, which are one question: can I spend, and are they happy. */
function moneyCard(host: ScreenHost): HTMLElement {
  const club = host.club as Club;
  const confident = club.boardConfidence > 0.55;
  return card([
    heading(t('home.money'), 'coins'),
    el('div', { class: 'tl-kvs' }, [
      el('div', { class: 'tl-kv' }, [el('span', { text: t('home.balance') }), el('b', { text: money(club.balance) })]),
      el('div', { class: 'tl-kv' }, [el('span', { text: t('home.budget') }), el('b', { class: 'hot', text: money(club.transferBudget) })]),
      el('div', { class: 'tl-kv' }, [el('span', { text: t('home.wages') }), el('b', { text: money(club.wageBudget) })]),
    ]),
    el('div', { class: 'tl-boardroom' }, [
      el('div', { class: 'tl-board-row' }, [
        el('span', { text: `${t('home.board')} · ${t('home.boardTarget', { n: ordinal(club.expectation) })}` }),
        el('span', { class: `tl-pill ${confident ? 'good' : 'warn'}`, text: confident ? t('home.boardHappy') : t('home.boardWorried') }),
      ]),
      bar(club.boardConfidence, { label: t('home.board'), tone: toneOf(club.boardConfidence) }),
    ]),
  ]);
}

/** Who is scoring. A name to root for is worth a card. */
function scorerCard(host: ScreenHost): HTMLElement {
  const { world } = host;
  const club = host.club as Club;
  let best: WorldPlayer | null = null;
  for (const p of squadOf(world, club.id)) {
    if (p.season.goals > 0 && (!best || p.season.goals > best.season.goals)) best = p;
  }
  return card([
    heading(t('home.topScorer'), 'ball'),
    best
      ? el('div', { class: 'tl-scorer' }, [
        el('span', { class: 'tl-scorer-num', style: `background:${kitCss(club.kitPrimary)};color:${inkOn(club.kitPrimary)}`, text: String(best.squadNumber) }),
        el('span', { class: 'tl-scorer-who' }, [
          el('b', { text: fullName(world.book, best.firstIdx, best.lastIdx) }),
          el('span', { class: 'tl-muted', text: `${posLabel(best.natural)} · ${t('home.goalsN', { n: best.season.goals })}` }),
        ]),
      ])
      : el('p', { class: 'tl-muted', style: 'margin:0', text: t('home.noneScored') }),
  ]);
}

/**
 * The match that is being played right now, as a card on the club screen.
 *
 * This is the other half of a Back button that does not end the match: leaving has to leave
 * you somewhere that can still see it. The picture is the same Minimap the match view uses
 * — twenty-two dots and a ball, mirrored so the managed side attacks right — because the
 * question "what is happening" deserves an answer that is not a number.
 *
 * It polls rather than subscribing. The simulation runs at 10 Hz and this repaints at 4,
 * which is fast enough to read as live and slow enough to cost nothing; the interval is
 * hung off the card so that the next `refresh()` removing the node also stops the timer.
 */
function liveMatchCard(host: ScreenHost, live: LiveMatchView): HTMLElement {
  const map = new Minimap({ mine: live.mine, width: 300, className: 'tl-minimap-inline' });
  const clock = el('span', { class: 'tl-pill live' });
  const score = el('b', {
    style: 'font:800 30px/1 var(--tl-font);letter-spacing:-0.04em;font-variant-numeric:tabular-nums',
  });
  const pause = button('', () => host.toggleMatchPause(), {
    class: 'tl-btn tl-ghost tl-icon-only', icon: 'pause', 'aria-label': t('match.pause'),
  });

  const paint = (): void => {
    const s = live.summary();
    map.update(live.state);
    clock.textContent = s.paused ? t('match.paused') : `${s.minute}'`;
    clock.classList.toggle('paused', s.paused);
    score.textContent = `${s.homeShort} ${s.home}–${s.away} ${s.awayShort}`;
    clear(pause);
    pause.append(icon(s.paused ? 'play' : 'pause', 18));
    pause.setAttribute('aria-label', t(s.paused ? 'match.resume' : 'match.pause'));
  };
  paint();

  const node = card([
    el('div', { style: 'display:flex;align-items:center;gap:10px' }, [
      heading(t('home.live'), 'whistle'),
      el('span', { class: 'tl-spacer' }),
      clock,
    ]),
    score,
    map.root,
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      button(t('match.watchLive'), () => host.watchLive(), {
        class: 'tl-btn tl-primary', icon: 'play', style: 'flex:2 1 160px',
      }),
      pause,
    ]),
    el('p', { class: 'tl-muted', style: 'margin:2px 0 0;font-size:12.5px', text: t('match.stillRunning') }),
  ]);

  // A timer outliving the node it draws into would repaint a detached canvas forever, and
  // there would be one more of them after every render. The observer is the cheapest thing
  // that knows when a node has actually gone.
  const timer = setInterval(paint, 250);
  const stop = new MutationObserver(() => {
    if (node.isConnected) return;
    clearInterval(timer);
    stop.disconnect();
    map.dispose();
  });
  stop.observe(document.body, { childList: true, subtree: true });
  return node;
}

/** Full time, for a match that finished while the player was somewhere else. */
function fullTimeCard(host: ScreenHost, last: LastMatchView): HTMLElement {
  const won = last.us > last.them;
  const drew = last.us === last.them;
  return card([
    heading(t('match.fullTime'), won ? 'star' : 'whistle'),
    el('b', {
      style: 'font:800 40px/1 var(--tl-font);letter-spacing:-0.04em;font-variant-numeric:tabular-nums',
      text: `${last.us}–${last.them}`,
    }),
    // The word, not the score again: the numerals above are already 40px tall.
    el('p', {
      class: 'tl-lede',
      style: 'margin:0',
      text: t(won ? 'match.outcomeWon' : drew ? 'match.outcomeDrew' : 'match.outcomeLost'),
    }),
    el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
      button(t('match.summary'), () => host.showMatchSummary(), {
        class: 'tl-btn tl-primary', icon: 'table', style: 'flex:1 1 150px',
      }),
      button(t('match.log'), () => host.showMatchLog(), {
        class: 'tl-btn tl-ghost', icon: 'list', style: 'flex:1 1 130px',
      }),
    ]),
  ]);
}

// ---- league table --------------------------------------------------------------

export function renderTable(host: ScreenHost, root: HTMLElement): void {
  const { world, club } = host;
  if (!club) return;
  const table = buildTable(world, club.tier);
  const division = world.divisions[club.tier];
  const panel = card([heading(division?.name ?? t('nav.table'), 'table')], { class: 'tl-card tl-flush' });
  panel.append(tableElement(host, table, club.id, 1));

  const key = el('div', { class: 'tl-key' });
  if ((division?.promoted ?? 0) > 0) {
    key.append(el('span', {}, [
      el('i', { style: 'background:var(--tl-good)' }),
      el('span', { text: t('home.promoted') }),
    ]));
  }
  if ((division?.relegated ?? 0) > 0) {
    key.append(el('span', {}, [
      el('i', { style: 'background:var(--tl-bad)' }),
      el('span', { text: t('home.relegated') }),
    ]));
  }
  key.append(el('span', {}, [
    el('i', { style: 'background:var(--tl-club)' }),
    el('span', { text: club.name }),
  ]));
  panel.append(key);
  panel.append(el('div', { style: 'height:14px' }));
  root.append(panel);
}

function tableElement(
  host: ScreenHost,
  rows: ReturnType<typeof buildTable>,
  meId: number,
  startPos: number,
): HTMLElement {
  const division = host.world.divisions[host.club?.tier ?? 0];
  const promoted = division?.promoted ?? 0;
  const relegated = division?.relegated ?? 0;
  const total = division?.clubIds.length ?? rows.length;

  const head = el('tr', {}, [
    el('th', { class: 'tl-num', text: t('table.pos') }),
    el('th', { text: t('table.club') }),
    el('th', { class: 'tl-num', text: t('table.played') }),
    el('th', { class: 'tl-num c-opt', text: t('table.won') }),
    el('th', { class: 'tl-num c-opt', text: t('table.drawn') }),
    el('th', { class: 'tl-num c-opt', text: t('table.lost') }),
    el('th', { class: 'tl-num', text: t('table.gd') }),
    el('th', { class: 'tl-num', text: t('table.points') }),
  ]);
  const body = el('tbody');
  rows.forEach((r, i) => {
    const place = startPos + i;
    const c = host.world.clubs[r.clubId];
    const classes = [
      r.clubId === meId ? 'is-me' : '',
      place <= promoted ? 'is-promo' : '',
      place > total - relegated ? 'is-releg' : '',
    ].filter(Boolean).join(' ');
    const gd = r.goalsFor - r.goalsAgainst;
    body.append(el('tr', { class: classes }, [
      el('td', { class: 'tl-num', style: 'font-weight:700', text: String(place) }),
      el('td', {}, [el('div', { class: 'tl-row', style: 'gap:9px;flex-wrap:nowrap;min-width:0' }, [
        c ? crest(host.world, c, 22) : null,
        el('span', { class: 'tl-name', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap', text: c?.name ?? '' }),
      ])]),
      el('td', { class: 'tl-num', text: String(r.played) }),
      el('td', { class: 'tl-num c-opt', text: String(r.won) }),
      el('td', { class: 'tl-num c-opt', text: String(r.drawn) }),
      el('td', { class: 'tl-num c-opt', text: String(r.lost) }),
      el('td', { class: 'tl-num', text: gd > 0 ? `+${gd}` : String(gd) }),
      el('td', { class: 'tl-num', style: 'font-weight:750', text: String(r.points) }),
    ]));
  });
  return el('div', { class: 'tl-scroll' }, [
    el('table', { class: 'tl-table cols-fixed' }, [el('thead', {}, [head]), body]),
  ]);
}

// ---- squad ---------------------------------------------------------------------

export function renderSquad(host: ScreenHost, root: HTMLElement): void {
  const { world, club } = host;
  if (!club) return;
  const selection = pickEleven(world, club);
  const picked = new Set(selection.eleven.map((p) => p.id));
  const benched = new Set(selection.bench.map((p) => p.id));
  const squad = squadOf(world, club.id).sort((a, b) => {
    const rank = (p: WorldPlayer): number => (picked.has(p.id) ? 0 : benched.has(p.id) ? 1 : 2);
    return rank(a) - rank(b) || caOf(b.attrs, b.natural) - caOf(a.attrs, a.natural);
  });
  const reference = clubStrength(world, club);
  const open = (p: WorldPlayer): void => showPlayer(host, p, reference);

  const panel = card([
    heading(t('nav.squad'), 'squad'),
    el('p', {
      class: 'tl-muted',
      style: 'margin:-6px 0 0;padding:0 18px 12px;font-size:12.5px',
      text: t('squad.hint'),
    }),
  ], { class: 'tl-card tl-flush' });

  // --- wide: the full grid, which is the point of having attributes at all -------
  const body = el('tbody');
  for (const p of squad) {
    const ca = asTwenty(caOf(p.attrs, p.natural));
    const tr = el('tr', { class: `${picked.has(p.id) ? 'is-me' : ''} tap`, tabindex: 0 }, [
      el('td', { class: 'tl-num', style: 'font-weight:700;color:var(--tl-ink-2)', text: String(p.squadNumber) }),
      el('td', {}, [
        el('div', { class: 'tl-name', text: fullName(world.book, p.firstIdx, p.lastIdx) }),
        statusPill(p),
      ]),
      el('td', {}, [el('span', { class: 'tl-pill tl-pos', text: posLabel(p.natural) })]),
      el('td', { class: 'tl-num', text: String(p.age) }),
      el('td', { style: 'min-width:104px' }, [attrBar(ca, t('squad.ability'))]),
      el('td', { style: 'min-width:78px' }, [bar(p.condition, { label: t('squad.condition'), tone: toneOf(p.condition) })]),
      el('td', { style: 'min-width:78px' }, [bar(p.morale, { label: t('squad.morale'), tone: toneOf(p.morale) })]),
      el('td', {}, [formPips(p.form)]),
      el('td', { class: 'tl-num', text: String(p.season.apps) }),
      el('td', { class: 'tl-num', text: String(p.season.goals) }),
      el('td', { class: 'tl-num', text: money(playerValue(p)) }),
    ]);
    tr.addEventListener('click', () => open(p));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(p);
      }
    });
    body.append(tr);
  }
  const head = el('tr', {}, [
    el('th', { class: 'tl-num', text: '#' }),
    el('th', { text: t('squad.name') }),
    el('th', { text: t('squad.pos') }),
    el('th', { class: 'tl-num', text: t('squad.age') }),
    el('th', { text: t('squad.ability') }),
    el('th', { text: t('squad.condition') }),
    el('th', { text: t('squad.morale') }),
    el('th', { text: t('squad.form') }),
    el('th', { class: 'tl-num', text: t('squad.apps') }),
    el('th', { class: 'tl-num', text: t('squad.goals') }),
    el('th', { class: 'tl-num', text: t('squad.value') }),
  ]);
  panel.append(el('div', { class: 'tl-wide-only tl-scroll' }, [
    el('table', { class: 'tl-table' }, [el('thead', {}, [head]), body]),
  ]));

  // --- narrow: the same squad as rows a thumb can hit ----------------------------
  const narrow = el('div', { class: 'tl-narrow-only' });
  // Two bars stacked at the end of a row with nothing to say which is which is a puzzle,
  // not a readout. The wide table has column headers; this needs one too, once, rather
  // than a caption on every one of twenty-six rows.
  narrow.append(el('div', { class: 'tl-rows-head' }, [
    el('span', { text: t('squad.ability') }),
    el('span', { text: t('squad.condition') }),
  ]));
  const rows = el('div', { class: 'tl-rows' });
  for (const p of squad) {
    const ca = asTwenty(caOf(p.attrs, p.natural));
    const item = el('button', {
      class: `tl-row-item${picked.has(p.id) ? ' is-me' : ''}`,
      type: 'button',
      'aria-label': `${fullName(world.book, p.firstIdx, p.lastIdx)}, ${posLabel(p.natural)}`,
    }, [
      el('span', { class: 'rk', text: String(p.squadNumber) }),
      el('span', { class: 'who' }, [
        el('b', { text: fullName(world.book, p.firstIdx, p.lastIdx) }),
        el('span', { class: 'meta' }, [
          el('span', { class: 'tl-pill tl-pos', text: posLabel(p.natural) }),
          el('span', { class: 'tl-muted', style: 'font-size:12px', text: String(p.age) }),
          statusPill(p),
          formPips(p.form),
        ]),
      ]),
      el('span', { class: 'end metrics' }, [
        attrBar(ca, t('squad.ability')),
        bar(p.condition, { label: t('squad.condition'), tone: toneOf(p.condition) }),
      ]),
    ]);
    item.addEventListener('click', () => open(p));
    rows.append(item);
  }
  narrow.append(rows);
  panel.append(narrow);
  root.append(panel);
}

/** The full attribute grid — rung 5 of the depth ladder, behind a tap. */
function showPlayer(host: ScreenHost, p: WorldPlayer, reference: number): void {
  const groups: [string, readonly AnyAttr[]][] = p.natural === 'GK'
    ? [[t('attr.goalkeeping'), GOALKEEPING], [t('attr.mental'), MENTAL], [t('attr.physical'), PHYSICAL]]
    : [[t('attr.technical'), TECHNICAL], [t('attr.mental'), MENTAL], [t('attr.physical'), PHYSICAL]];

  const grid = el('div', { class: 'tl-grid cols2' });
  for (const [label, keys] of groups) {
    const box = el('div', {}, [heading(label)]);
    for (const key of keys) {
      box.append(el('div', {
        style: 'display:grid;grid-template-columns:1fr 108px;align-items:center;gap:10px;padding:3px 0',
      }, [
        el('span', { style: 'font-size:13px;color:var(--tl-ink-2)', text: t(`attr.${key}` as StringKey) }),
        attrBar(attr(p.attrs, key), t(`attr.${key}` as StringKey)),
      ]));
    }
    grid.append(box);
  }

  const rating = Math.round(stars(caOf(p.attrs, p.natural), reference));
  const starRow = el('span', { class: 'tl-row', style: 'gap:2px', 'aria-label': `${rating}/5` });
  for (let i = 0; i < 5; i++) {
    const s = icon('star', 15);
    s.style.color = i < rating ? 'var(--tl-club)' : 'rgba(255,255,255,0.16)';
    if (i < rating) s.querySelector('path')?.setAttribute('fill', 'currentColor');
    starRow.append(s);
  }

  sheet({
    title: fullName(host.world.book, p.firstIdx, p.lastIdx),
    icon: 'squad',
    body: [
      el('div', { class: 'tl-row', style: 'margin-bottom:16px' }, [
        el('span', { class: 'tl-pill tl-pos', text: posLabel(p.natural) }),
        el('span', { class: 'tl-muted', text: t('squad.ageIs', { n: p.age }) }),
        statusPill(p),
        el('span', { class: 'tl-spacer' }),
        starRow,
      ]),
      el('div', { class: 'tl-stats', style: 'margin-bottom:16px' }, [
        stat(t('squad.apps'), String(p.season.apps)),
        stat(t('squad.goals'), String(p.season.goals)),
        stat(t('squad.value'), money(playerValue(p))),
        stat(t('squad.wage'), money(p.wage)),
      ]),
      grid,
    ],
  });
}

// ---- tactics -------------------------------------------------------------------

export function renderTactics(host: ScreenHost, root: HTMLElement): void {
  const { world } = host;
  // Bound to a const after the guard: `commit` below cannot narrow a destructured `club`.
  const club = host.club;
  if (!club) return;
  const shape = world.formations.get(club.formationId) ?? FORMATIONS[0];
  if (!shape) return;
  // Edit a copy of the slots; the club keeps a formation id plus its own overrides.
  const slots: FormationSlot[] = shape.slots.map((s) => ({ ...s }));
  const selection = pickEleven(world, club);

  const label = el('b', { class: 'tl-shape', text: deriveLabel(slots) });
  const board = el('div', { class: 'tl-board', role: 'group', 'aria-label': t('tactics.formation') });

  // Markings, so the shape is read against a pitch rather than a rectangle. The board is
  // half a pitch seen from behind your own goal, so it carries a centre circle at the top
  // edge, both boxes, the spot and the D — the previous version had a halfway line and
  // two rectangles, which is not a football pitch.
  const turf = el('div', { class: 'tl-board-turf' });
  board.append(turf);
  const mk = (style: string, cls = 'mk'): void => {
    turf.append(el('div', { class: cls, style }));
  };
  mk('left:3%;right:3%;top:1.5%;bottom:1.5%');                                  // touchlines
  mk('left:22%;right:22%;bottom:1.5%;height:15%');                              // penalty area
  mk('left:35%;right:35%;bottom:1.5%;height:6%');                               // goal area
  mk('left:36%;right:36%;bottom:-1%;height:2.4%;border-width:2px');             // the goal
  mk('left:50%;bottom:11%;width:5px;height:5px;margin-left:-2.5px;border-radius:50%', 'mk fill'); // penalty spot
  mk('left:38%;right:38%;bottom:14.2%;height:6%;border-radius:0 0 60% 60%;border-top:0'); // the D
  mk('left:3%;right:3%;top:1.5%;height:0;border-width:2px 0 0');                // halfway line
  mk('left:35.5%;right:35.5%;top:-14%;height:28%', 'mk circ');                  // centre circle
  mk('left:50%;top:1.5%;width:5px;height:5px;margin-left:-2.5px;border-radius:50%', 'mk fill'); // centre spot

  const place = (token: HTMLElement, slot: FormationSlot): void => {
    token.style.left = `${slot.across * 100}%`;
    token.style.top = `${(1 - slot.along) * 100}%`;
  };
  const commit = (): void => {
    const custom = { id: 'custom', label: deriveLabel(slots), slots: slots.map((s) => ({ ...s })) };
    world.formations.set('custom', custom);
    club.formationId = 'custom';
    // Deliberately does NOT re-render. Re-rendering destroys the token the player is
    // holding — or, for a keyboard user, the one that currently has focus, so the first
    // arrow key works and the second goes nowhere. The screen already shows the change.
    host.persist();
  };

  const kit = kitCss(club.kitPrimary);
  // The shirt numbers as the club studio set them: its colour (kept readable against the
  // shirt by numberInk) and its style, which the token's class carries.
  const ink = kitCss(numberInk(world.look, { primary: club.kitPrimary, secondary: club.kitSecondary }));
  const numberStyle = NUMBER_STYLES[world.look.numberStyle] ?? 'classic';
  slots.forEach((slot, i) => {
    const player = selection.eleven[i];
    const token = el('div', {
      class: `tl-token num-${numberStyle}`,
      style: `background:${kit};color:${ink};--tl-token-ink:${ink}`,
      tabindex: 0,
      role: 'button',
      'aria-label': `${posLabel(slot.position)} ${player ? surname(world.book, player.lastIdx) : ''}`,
    }, [
      el('span', { text: player ? String(player.squadNumber) : posLabel(slot.position) }),
      el('span', { class: 'lbl', text: player ? surname(world.book, player.lastIdx) : posLabel(slot.position) }),
    ]);
    board.append(token);
    place(token, slot);

    let dragging = false;
    token.addEventListener('pointerdown', (e) => {
      dragging = true;
      token.classList.add('dragging');
      token.setPointerCapture(e.pointerId);
    });
    token.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const r = board.getBoundingClientRect();
      slot.across = clamp01((e.clientX - r.left) / r.width);
      slot.along = clamp01(1 - (e.clientY - r.top) / r.height);
      place(token, slot);
      label.textContent = deriveLabel(slots);
    });
    const end = (): void => {
      if (!dragging) return;
      dragging = false;
      token.classList.remove('dragging');
      audio.tick();
      commit();
    };
    token.addEventListener('pointerup', end);
    token.addEventListener('pointercancel', end);

    // Keyboard: arrows nudge the focused player, so the tactics pitch is operable with no
    // pointer at all (design §10).
    token.addEventListener('keydown', (e) => {
      const step = 0.04;
      const key = e.key;
      if (key === 'ArrowLeft') slot.across = clamp01(slot.across - step);
      else if (key === 'ArrowRight') slot.across = clamp01(slot.across + step);
      else if (key === 'ArrowUp') slot.along = clamp01(slot.along + step);
      else if (key === 'ArrowDown') slot.along = clamp01(slot.along - step);
      else return;
      e.preventDefault();
      place(token, slot);
      label.textContent = deriveLabel(slots);
      commit();
    });
  });

  // Preset shapes, so the whole thing is two taps for anyone who does not want to drag.
  const shapes = el('div', { class: 'tl-choice tight' });
  for (const f of FORMATIONS) {
    shapes.append(button(f.label, () => {
      club.formationId = f.id;
      audio.tick();
      host.refresh();
    }, { class: 'tl-btn tl-sm', 'aria-pressed': club.formationId === f.id }));
  }

  const boardCard = card([
    el('div', { class: 'tl-row', style: 'margin-bottom:14px;align-items:baseline' }, [
      label,
      el('span', { class: 'tl-spacer' }),
      el('span', { class: 'tl-muted', style: 'font-size:12.5px', text: t('tactics.hint') }),
    ]),
    el('div', { class: 'tl-board-frame' }, [board]),
    el('div', { style: 'margin-top:16px' }, [heading(t('tactics.formation'), 'tactics'), shapes]),
  ]);

  // The levers that visibly change the picture within seconds (design §5c).
  const leverCard = card([heading(t('tactics.preset'), 'sliders')]);
  const styleRow = el('div', { class: 'tl-choice', style: 'margin-bottom:18px' });
  for (const [name, preset] of Object.entries(INSTRUCTION_PRESETS)) {
    const key = `tactics.style.${name}` as StringKey;
    // A preset button is a shortcut for six slider positions, so the one that is lit is
    // the one whose six values the club is actually using. Without this every style looks
    // unselected, including the one the team is playing.
    const active = (Object.keys(preset) as (keyof typeof preset)[])
      .every((f) => Math.abs(club.instructions[f] - preset[f]) < 0.005);
    styleRow.append(button(t(key) || name, () => {
      club.instructions = { ...preset };
      audio.tick();
      host.refresh();
    }, { class: 'tl-btn tl-sm', 'aria-pressed': active }));
  }
  leverCard.append(styleRow);

  const inst = club.instructions;
  const levers: [StringKey, keyof typeof inst, StringKey, StringKey][] = [
    ['tactics.tempo', 'tempo', 'tactics.slow', 'tactics.fast'],
    ['tactics.width', 'width', 'tactics.narrow', 'tactics.wide'],
    ['tactics.line', 'lineHeight', 'tactics.deep', 'tactics.high'],
    ['tactics.pressing', 'pressing', 'tactics.low', 'tactics.high'],
    ['tactics.directness', 'directness', 'tactics.short', 'tactics.long'],
    ['tactics.intent', 'attackingIntent', 'tactics.cautious', 'tactics.bold'],
  ];
  const grid = el('div', { style: 'display:grid;gap:16px' });
  for (const [key, field, lowKey, highKey] of levers) {
    // The value is a word, not a percentage. "Tempo 62" is a number a kid cannot act on;
    // "Tempo — Fast" is the same information as an instruction.
    const wordFor = (v: number): string => (v < 0.34 ? t(lowKey) : v > 0.66 ? t(highKey) : t('tactics.balanced'));
    const valueEl = el('span', { class: 'val', text: wordFor(inst[field]) });
    const input = el('input', {
      class: 'tl-range',
      type: 'range', min: 0, max: 100, step: 1,
      value: Math.round(inst[field] * 100),
      'aria-label': t(key),
      style: `--pct:${Math.round(inst[field] * 100)}%`,
    });
    input.addEventListener('input', () => {
      const v = Number(input.value) / 100;
      inst[field] = v;
      valueEl.textContent = wordFor(v);
      input.style.setProperty('--pct', `${Math.round(v * 100)}%`);
    });
    // Persist on release, not on every pixel of the drag.
    input.addEventListener('change', () => {
      audio.tick();
      host.persist();
    });
    grid.append(el('div', { class: 'tl-slider' }, [
      el('label', {}, [el('span', { text: t(key) }), valueEl]),
      input,
    ]));
  }
  leverCard.append(grid);

  root.append(el('div', { class: 'tl-grid cols2' }, [boardCard, leverCard]));
}

// ---- fixtures ------------------------------------------------------------------

export function renderFixtures(host: ScreenHost, root: HTMLElement): void {
  const { world, club } = host;
  if (!club) return;
  const own = world.fixtures.filter((f) => f.homeId === club.id || f.awayId === club.id);
  const panel = card([heading(t('nav.fixtures'), 'fixtures')], { class: 'tl-card tl-flush' });

  if (own.length === 0) {
    panel.append(emptyState(t('fixtures.none'), 'seasonDone'));
    root.append(panel);
    return;
  }

  const rows = el('div', { class: 'tl-rows' });
  for (const f of own) {
    const isHome = f.homeId === club.id;
    const opponent = world.clubs[isHome ? f.awayId : f.homeId];
    const margin = isHome ? f.homeGoals - f.awayGoals : f.awayGoals - f.homeGoals;
    const outcome = !f.played ? '' : margin > 0 ? 'good' : margin === 0 ? '' : 'bad';
    const result = f.played
      ? el('span', { class: `tl-pill ${outcome}`, style: 'font-size:13px;padding:5px 9px', text: `${f.homeGoals}–${f.awayGoals}` })
      : el('span', { class: 'tl-muted', style: 'font-size:12.5px', text: isHome ? t('fixtures.home') : t('fixtures.away') });

    rows.append(el('div', { class: 'tl-row-item' }, [
      el('span', { class: 'rk', text: String(f.round + 1) }),
      el('span', { class: 'who' }, [
        el('b', { text: opponent?.name ?? '' }),
        el('span', { class: 'meta' }, [
          opponent ? crest(world, opponent, 18) : null,
          el('span', {
            class: 'tl-muted', style: 'font-size:12px',
            text: isHome ? t('fixtures.home') : t('fixtures.away'),
          }),
        ]),
      ]),
      el('span', { class: 'end' }, [result]),
    ]));
  }
  panel.append(rows);
  root.append(panel);
}

// ---- transfers -----------------------------------------------------------------

export function renderTransfers(host: ScreenHost, root: HTMLElement): void {
  const { world, club } = host;
  if (!club) return;
  const budget = club.transferBudget;

  root.append(card([
    heading(t('transfers.budget'), 'transfers'),
    el('div', { class: 'tl-stats' }, [
      stat(t('transfers.budget'), money(budget), { hot: true }),
      stat(t('home.wages'), money(club.wageBudget)),
      stat(t('transfers.squadSize'), String(squadOf(world, club.id).length)),
    ]),
  ]));

  // Who is available: anyone at another club whose fee this club could meet, best first.
  const candidates: { p: WorldPlayer; fee: number }[] = [];
  for (const other of world.clubs) {
    if (other.id === club.id) continue;
    if (Math.abs(other.tier - club.tier) > 1) continue;
    for (const p of squadOf(world, other.id)) {
      const fee = Math.round(playerValue(p) * 1.15);
      if (fee > budget) continue;
      candidates.push({ p, fee });
    }
  }
  candidates.sort((a, b) => caOf(b.p.attrs, b.p.natural) - caOf(a.p.attrs, a.p.natural));
  const shortlist = candidates.slice(0, 30);

  const buyPanel = card([heading(t('transfers.buy'), 'transfers')], { class: 'tl-card tl-flush' });
  if (shortlist.length === 0) {
    buyPanel.append(emptyState(t('transfers.none'), 'noPlayers'));
  } else {
    const rows = el('div', { class: 'tl-rows' });
    for (const { p, fee } of shortlist) {
      const from = world.clubs[p.clubId];
      const ca = asTwenty(caOf(p.attrs, p.natural));
      const buy = button(t('transfers.buy'), () => host.buy(p.id), {
        class: 'tl-btn tl-sm tl-primary',
        'aria-label': `${t('transfers.buy')} ${fullName(world.book, p.firstIdx, p.lastIdx)}, ${money(fee)}`,
      });
      rows.append(el('div', { class: 'tl-row-item', style: 'cursor:default;grid-template-columns:1fr auto' }, [
        el('span', { class: 'who' }, [
          el('b', { text: fullName(world.book, p.firstIdx, p.lastIdx) }),
          el('span', { class: 'meta' }, [
            el('span', { class: 'tl-pill tl-pos', text: posLabel(p.natural) }),
            el('span', { class: 'tl-muted', style: 'font-size:12px', text: String(p.age) }),
            el('span', { class: 'tl-muted', style: 'font-size:12px', text: from?.name ?? '' }),
          ]),
          el('div', { style: 'max-width:150px;margin-top:2px' }, [attrBar(ca, t('squad.ability'))]),
        ]),
        el('span', { class: 'end' }, [
          el('b', { style: 'font-variant-numeric:tabular-nums;font-size:15px', text: money(fee) }),
          buy,
        ]),
      ]));
    }
    buyPanel.append(rows);
  }
  root.append(buyPanel);

  // Selling, from the bottom of the squad up. Eighteen is the floor the career layer
  // enforces; below it the club could not field a team.
  const squad = squadOf(world, club.id);
  const sellable = [...squad].sort((a, b) => caOf(a.attrs, a.natural) - caOf(b.attrs, b.natural)).slice(0, 10);
  const sellPanel = card([heading(t('transfers.sell'), 'transfers')], { class: 'tl-card tl-flush' });
  const locked = squad.length <= 18;
  if (locked) {
    sellPanel.append(emptyState(t('transfers.squadTooSmall'), 'thinSquad'));
  } else {
    const rows = el('div', { class: 'tl-rows' });
    for (const p of sellable) {
      rows.append(el('div', { class: 'tl-row-item', style: 'cursor:default;grid-template-columns:1fr auto' }, [
        el('span', { class: 'who' }, [
          el('b', { text: fullName(world.book, p.firstIdx, p.lastIdx) }),
          el('span', { class: 'meta' }, [
            el('span', { class: 'tl-pill tl-pos', text: posLabel(p.natural) }),
            el('span', { class: 'tl-muted', style: 'font-size:12px', text: String(p.age) }),
          ]),
        ]),
        el('span', { class: 'end' }, [
          el('b', { style: 'font-variant-numeric:tabular-nums;font-size:15px', text: money(Math.round(playerValue(p) * 0.9)) }),
          button(t('transfers.sell'), () => host.sell(p.id), {
            class: 'tl-btn tl-sm',
            'aria-label': `${t('transfers.sell')} ${fullName(world.book, p.firstIdx, p.lastIdx)}`,
          }),
        ]),
      ]));
    }
    sellPanel.append(rows);
  }
  root.append(sellPanel);
}
