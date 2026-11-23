// The player career, around the pitch: the trial, the signing, the locker, the week, the
// matches, the offers and the farewell (design player-career §3–§8, §A).
//
// Wordless end to end (§11): offers are crest cards, relationships are rings with pips,
// the week is icons. Every label here is also an accessible name, so `?blank=1` still has
// operable controls.

import { clamp01 } from '../../core/math.js';
import { streamOf } from '../../core/rng.js';
import { t, type StringKey } from '../../i18n.js';
import { audio } from '../../audio/audio.js';
import { advanceDay, applyResult, endSeason, openMatch, playQuick } from '../../sim/career/season.js';
import { nextFixture } from '../../sim/career/fixtures.js';
import { conditionsFor } from '../../sim/match/conditions.js';
import type { MatchEvent, MatchPlayer, MatchState } from '../../sim/match/types.js';
import { rollName, fullName } from '../../sim/world/names.js';
import { defaultLook, type Club, type World } from '../../sim/world/types.js';
import { generateAttributes } from '../../sim/ratings/ability.js';
import {
  ACTIVITIES, BOOT_COLOURS, DRILLS, HERO_POSITIONS, MILESTONES, SLOTS_PER_WEEK, announceRetirement, bootsUnlocked,
  celebrationUnlocked, closeHeroSeason, closeWeek, createHero, doActivity, hasMilestone, heroControl, heroPlayer,
  moveHero, recordHeroMatch, retirementStage, startsFor, type Activity, type DrillKind, type Hero, type HeroPosition,
  type MatchLine, type RingChange,
} from '../../sim/player/hero.js';
import { heroOffers } from '../../sim/player/offers.js';
import { legacyClubs, retireIntoManagement } from '../../sim/player/legacy.js';
import { sessionStars, trialPosition } from '../../sim/player/drills.js';
import type { MomentKind, MomentOption } from '../../sim/player/moments.js';
import type { Settings } from '../../save/format.js';
import { kitArt } from '../art/kit.js';
import { kitCss } from '../theme.js';
import { button, clear, el, focusFirst, sheet } from '../dom.js';
import { icon, type IconName } from '../icons.js';
import { MatchScreen } from '../match.js';
import { crest, renderTable } from '../screens.js';
import { Stage } from './stage.js';
import { playDrill, playTrial, type TrialCounts as Counts } from './sessions.js';

/** What the Game lends the career. Getters, because a new career replaces the world. */
export interface CareerHost {
  readonly world: World;
  readonly settings: Settings;
  readonly tier: number;
  readonly reducedMotion: boolean;
  saveNow(): void;
  refresh(): void;
  openMenu(): void;
  toast(message: string, glyph?: IconName): void;
  /** Show or hide the career screens while a full-screen stage or match is up. */
  cover(on: boolean): void;
  /** Legacy is done: the slot is a Club career now. */
  becomeClubCareer(): void;
}

const ACTIVITY_GLYPH: Record<Activity, IconName> = { drill: 'cone', rest: 'moon', kickabout: 'ball', extra: 'clipboard', fanday: 'scarf' };
const DRILL_GLYPH: Record<DrillKind, IconName> = { hoops: 'target', rondo: 'rondo', gap: 'cone' };
const RING_GLYPH = { coach: 'clipboard', team: 'huddle', fans: 'scarf' } as const;
const MILESTONE_GLYPH: IconName[] = ['shirt', 'ball', 'star', 'flag', 'trophy', 'transfers', 'trophy', 'goal'];
const NUMBERS = [7, 8, 9, 10, 11, 14, 17, 19, 23, 27];

interface MomentRecord {
  kind: MomentKind;
  outcome: 'goal' | 'good' | 'lost' | 'saved' | '';
}

export class Career {
  readonly #host: CareerHost;
  /** Set between the trial and the signature: what the trial read. */
  #signing: { counts: Counts } | null = null;
  #route: 'locker' | 'table' = 'locker';

  constructor(host: CareerHost) {
    this.#host = host;
  }

  get #world(): World {
    return this.#host.world;
  }

  /** Whether this career owns the screen: a hero signed, or a trial just finished. */
  get active(): boolean {
    return !!this.#world.hero || !!this.#signing;
  }

  get club(): Club | null {
    const player = heroPlayer(this.#world);
    return player ? this.#world.clubs[player.clubId] ?? null : null;
  }

  // ---- the trial and the signing -------------------------------------------------

  /** A training pitch at dusk, a ball at his feet, three moments (§3). */
  async startTrial(): Promise<void> {
    const world = this.#world;
    const rng = streamOf(world.seed, 'trial');
    const attrs = generateAttributes(rng, 'ST', 70);
    const stage = new Stage({ tier: this.#host.tier, reducedMotion: this.#host.reducedMotion, playerStyle: this.#host.settings.playerStyle });
    this.#host.cover(true);
    let leave: () => void = () => undefined;
    stage.root.append(button('', () => leave(), { class: 'tl-btn tl-ghost tl-icon-only tl-stage-back', icon: 'back', 'aria-label': t('nav.back') }));
    const counts = await Promise.race([playTrial(stage, rng, attrs), new Promise<null>((resolve) => { leave = () => resolve(null); })]);
    stage.dispose();
    this.#host.cover(false);
    if (!counts) {
      this.#host.openMenu();
      return;
    }
    audio.whistle('long');
    this.#signing = { counts };
    this.#host.refresh();
  }

  #renderSigning(main: HTMLElement): void {
    const world = this.#world;
    const counts = (this.#signing as { counts: Counts }).counts;
    // A tier-3, -4 and -5 club, each holding up a shirt; the smallest is the default (§3).
    const rng = streamOf(world.seed, 'trial-clubs');
    const clubs = [2, 3, 4].map((tier) => {
      const division = world.divisions[tier]?.clubIds ?? [];
      return world.clubs[division[Math.floor(rng() * division.length)] ?? 0] as Club;
    });
    const choice = {
      club: clubs[2] as Club,
      number: 9,
      boots: 0,
      position: trialPosition(counts) as HeroPosition,
      roll: 0,
    };
    const wrap = el('div', { class: 'tl-wrap tl-stack tl-enter tl-signing' });
    const draw = (): void => {
      clear(wrap);
      const name = rollName(streamOf(world.seed + choice.roll * 7, 'hero-name'), world.book, choice.club.culture);
      wrap.append(
        el('h1', { class: 'tl-career-title' }, [icon('shirt', 26), el('span', { text: t('career.signTitle') })]),
        el('div', { class: 'tl-offer-row' }, clubs.map((club) => offerCard(world, club, {
          pressed: club === choice.club,
          label: t('career.accept'),
          onPick: () => {
            choice.club = club;
            draw();
          },
        }))),
        pickerRow(t('career.position'), 'flag', HERO_POSITIONS.map((position) => ({
          label: t(`pos.${position}` as StringKey), pressed: position === choice.position, art: positionArt(position),
          pick: () => { choice.position = position; draw(); },
        }))),
        pickerRow(t('career.number'), 'shirt', NUMBERS.map((number) => ({
          label: String(number), pressed: number === choice.number, raw: true,
          pick: () => { choice.number = number; draw(); },
        }))),
        pickerRow(t('career.boots'), 'boot', BOOT_COLOURS.slice(0, 4).map((colour, index) => ({
          label: `${t('career.boots')} ${index + 1}`, pressed: index === choice.boots, swatch: colour,
          pick: () => { choice.boots = index; draw(); },
        }))),
        el('div', { class: 'tl-sign-name' }, [
          kitArt(defaultLook(), { primary: choice.club.kitPrimary, secondary: choice.club.kitSecondary }, { side: 'back', number: choice.number, shirtOnly: true }),
          el('b', { text: fullName(world.book, name.first, name.last) }),
          button('', () => { choice.roll++; draw(); }, { class: 'tl-btn tl-ghost tl-icon-only', icon: 'dice', 'aria-label': t('career.reroll') }),
        ]),
        button(t('career.sign'), () => {
          const player = createHero(world, { clubId: choice.club.id, position: choice.position, number: choice.number, boots: choice.boots });
          player.firstIdx = name.first;
          player.lastIdx = name.last;
          this.#signing = null;
          audio.whistle('short');
          this.#host.saveNow();
          this.#host.refresh();
        }, { class: 'tl-btn tl-primary tl-block tl-sign-go', icon: 'check' }),
      );
    };
    draw();
    main.append(wrap);
    focusFirst(wrap);
  }

  // ---- the locker --------------------------------------------------------------

  render(main: HTMLElement, topbar: HTMLElement): void {
    if (this.#signing) {
      // Leaving the signing leaves the slot empty: nothing is saved until he signs.
      topbar.append(el('b', { class: 'tl-brand', text: t('career.trial') }), el('span', { class: 'tl-spacer' }),
        button('', () => this.#host.openMenu(), { class: 'tl-btn tl-ghost tl-icon-only tl-top-icon', icon: 'home', 'aria-label': t('menu.back') }));
      this.#renderSigning(main);
      return;
    }
    const world = this.#world;
    const hero = world.hero as Hero;
    const player = heroPlayer(world);
    const club = this.club;
    if (!player || !club) return;
    topbar.append(
      el('button', { class: 'tl-top-id tl-career-id', type: 'button', 'aria-label': `${club.name} — ${t('career.locker')}` }, [
        crest(world, club, 40),
        el('span', { class: 'tl-title' }, [
          el('span', { class: 'tl-club', text: fullName(world.book, player.firstIdx, player.lastIdx) }),
          el('span', { class: 'tl-sub', text: `${club.name} · ${t('career.age', { n: player.age })}` }),
        ]),
      ]),
      el('span', { class: 'tl-spacer' }),
      el('div', { class: 'tl-top-actions' }, [
        button('', () => { this.#route = this.#route === 'table' ? 'locker' : 'table'; this.#host.refresh(); }, {
          class: 'tl-btn tl-ghost tl-icon-only tl-top-icon tl-top-settings', icon: this.#route === 'table' ? 'shirt' : 'table',
          'aria-label': t(this.#route === 'table' ? 'career.locker' : 'nav.table'),
        }),
        button('', () => this.#host.openMenu(), { class: 'tl-btn tl-ghost tl-icon-only tl-top-icon tl-top-menu', icon: 'home', 'aria-label': t('menu.back') }),
      ]),
    );
    const wrap = el('div', { class: 'tl-wrap tl-stack tl-enter tl-locker' });
    if (this.#route === 'table') renderTable({ world, club }, wrap);
    else if (hero.retired) this.#renderRetired(wrap);
    else this.#renderLocker(wrap);
    main.append(wrap);
  }

  #renderLocker(wrap: HTMLElement): void {
    const world = this.#world;
    const hero = world.hero as Hero;
    const player = heroPlayer(world)!;
    const club = this.club!;
    const fixture = nextFixture(world, club.id);
    const peg = el('section', { class: 'tl-card tl-peg', style: `--kit:${kitCss(club.kitPrimary)}` }, [
      el('div', { class: 'tl-peg-shirt' }, [
        kitArt(defaultLook(), { primary: club.kitPrimary, secondary: club.kitSecondary }, { side: 'back', number: hero.number, shirtOnly: true }),
        button('', () => {
          // Tap the boots for the next colour the shelf has earned.
          const open = BOOT_COLOURS.map((_colour, index) => index).filter((index) => bootsUnlocked(hero, index));
          hero.boots = open[(open.indexOf(hero.boots) + 1) % open.length] ?? 0;
          this.#host.saveNow();
          this.#host.refresh();
        }, { class: 'tl-btn tl-ghost tl-boot-art', style: `color:${kitCss(BOOT_COLOURS[hero.boots] ?? 0xffffff)}`, icon: 'boot', 'aria-label': t('career.boots') }),
      ]),
      el('div', { class: 'tl-rings' }, (['coach', 'team', 'fans'] as const).map((ring) => ringArt(ring, hero[ring]))),
      el('div', { class: 'tl-peg-stats' }, [
        statChip('ball', t('career.goals'), player.season.goals),
        statChip('shirt', t('career.apps'), player.season.apps),
      ]),
    ]);
    wrap.append(peg);

    if (hero.offers.length) wrap.append(this.#offersCard());

    const matchCard = el('section', { class: 'tl-card tl-career-match-card' });
    if (fixture) {
      const opponent = world.clubs[fixture.homeId === club.id ? fixture.awayId : fixture.homeId] as Club;
      const starts = startsFor(world, club);
      matchCard.append(
        el('div', { class: 'tl-career-vs' }, [
          crest(world, club, 56),
          el('span', { class: 'tl-career-vs-mid' }, [icon(fixture.homeId === club.id ? 'home' : 'forward', 20), el('b', { text: t('career.next') })]),
          crest(world, opponent, 56),
        ]),
        el('div', { class: `tl-career-start ${starts ? 'is-start' : 'is-bench'}` }, [icon(starts ? 'shirt' : 'sub', 20), el('span', { text: t(starts ? 'career.starts' : 'career.bench') })]),
        el('div', { class: 'tl-row tl-career-go' }, [
          button(t('career.play'), () => this.#playMatch(true), { class: 'tl-btn tl-primary tl-kick', icon: 'play' }),
          button(t('career.playForMe'), () => this.#playMatch(false), { class: 'tl-btn', icon: 'skip' }),
        ]),
      );
    } else {
      matchCard.append(
        el('h2', { class: 'tl-career-head' }, [icon('star', 18), el('span', { text: t('career.seasonOver') })]),
        button(t('career.nextSeason'), () => this.#nextSeason(), { class: 'tl-btn tl-primary tl-block', icon: 'forward' }),
      );
    }
    wrap.append(matchCard);

    // The week: three slots, and the drills — which are free practice once the week is full.
    const week = el('section', { class: 'tl-card tl-week' }, [el('h2', { class: 'tl-career-head' }, [icon('fixtures', 18), el('span', { text: t('career.week') })])]);
    const slots = el('div', { class: 'tl-week-slots' });
    for (let slot = 0; slot < SLOTS_PER_WEEK; slot++) {
      const used = hero.week[slot];
      slots.append(used
        ? el('span', { class: 'tl-week-slot is-used', role: 'img', 'aria-label': t(`activity.${used}` as StringKey) }, [icon(ACTIVITY_GLYPH[used], 26)])
        : button('', () => this.#chooseActivity(), { class: 'tl-btn tl-week-slot', icon: 'plus', 'aria-label': t('career.slot', { n: slot + 1 }) }));
    }
    week.append(slots);
    if (hero.week.length >= SLOTS_PER_WEEK) {
      week.append(el('div', { class: 'tl-row tl-practice' }, DRILLS.map((kind) => button('', () => this.#drill(kind, false), {
        class: 'tl-btn tl-ghost tl-icon-only', icon: DRILL_GLYPH[kind], 'aria-label': `${t('drill.practice')} — ${t(`drill.${kind}` as StringKey)}`,
      }))));
    }
    wrap.append(week);

    const shelf = el('section', { class: 'tl-card tl-shelf' }, [el('h2', { class: 'tl-career-head' }, [icon('trophy', 18), el('span', { text: t('career.shelf') })])]);
    shelf.append(el('div', { class: 'tl-shelf-row' }, MILESTONES.map((milestone, index) => el('span', {
      class: `tl-shelf-item${hasMilestone(hero, milestone) ? ' is-earned' : ''}`, role: 'img',
      'aria-label': `${t(`milestone.${milestone}` as StringKey)}${hasMilestone(hero, milestone) ? '' : ' 🔒'}`,
    }, [icon(hasMilestone(hero, milestone) ? MILESTONE_GLYPH[index] ?? 'star' : 'lock', 24)]))));
    wrap.append(shelf);

    const stage = retirementStage(player);
    if (stage !== 'none' && !hero.farewell) {
      wrap.append(button(t(stage === 'offer' ? 'retire.hang' : 'retire.testimonial'), () => {
        announceRetirement(world);
        this.#host.saveNow();
        this.#host.refresh();
      }, { class: 'tl-btn tl-block', icon: 'boot' }));
    }
    if (hero.farewell) wrap.append(el('p', { class: 'tl-career-farewell' }, [icon('star', 18), el('span', { text: t('retire.farewell') })]));
  }

  #offersCard(): HTMLElement {
    const world = this.#world;
    const hero = world.hero as Hero;
    return el('section', { class: 'tl-card tl-offers' }, [
      el('h2', { class: 'tl-career-head' }, [icon('transfers', 18), el('span', { text: t('career.offers') })]),
      el('div', { class: 'tl-offer-row' }, hero.offers.map((offer) => offerCard(world, world.clubs[offer.clubId] as Club, {
        starts: offer.starts,
        loan: offer.loan,
        label: t(offer.loan ? 'career.loan' : 'career.accept'),
        onPick: () => {
          const club = world.clubs[offer.clubId] as Club;
          moveHero(world, offer.clubId, offer.loan);
          this.#host.toast(t('career.moved', { club: club.name }), 'transfers');
          this.#host.saveNow();
          this.#host.refresh();
        },
      }))),
      button(t('career.stay'), () => {
        hero.offers = [];
        this.#host.saveNow();
        this.#host.refresh();
      }, { class: 'tl-btn tl-ghost tl-block', icon: 'close' }),
    ]);
  }

  // ---- the week ----------------------------------------------------------------

  #chooseActivity(): void {
    const dialog = sheet({
      title: t('career.week'),
      icon: 'fixtures',
      body: [el('div', { class: 'tl-activity-grid' }, ACTIVITIES.map((activity) => button(t(`activity.${activity}` as StringKey), () => {
        dialog.close();
        if (activity === 'drill') {
          this.#chooseDrill();
          return;
        }
        doActivity(this.#world, activity);
        audio.tick();
        this.#host.saveNow();
        this.#host.refresh();
      }, { class: 'tl-btn tl-activity', icon: ACTIVITY_GLYPH[activity] })))],
    });
  }

  #chooseDrill(): void {
    const dialog = sheet({
      title: t('activity.drill'),
      icon: 'cone',
      body: DRILLS.map((kind) => el('div', { class: 'tl-drill-row' }, [
        el('span', { class: 'tl-drill-name' }, [icon(DRILL_GLYPH[kind], 26), el('b', { text: t(`drill.${kind}` as StringKey) })]),
        button('', () => { dialog.close(); void this.#drill(kind, true); }, {
          class: 'tl-btn tl-primary tl-icon-only', icon: 'play', 'aria-label': `${t('drill.play')} — ${t(`drill.${kind}` as StringKey)}`,
        }),
        button('', () => {
          dialog.close();
          doActivity(this.#world, 'drill', { kind, stars: sessionStars(kind, 0) });
          this.#host.saveNow();
          this.#host.refresh();
        }, { class: 'tl-btn tl-icon-only', icon: 'clipboard', 'aria-label': `${t('drill.coach')} — ${t(`drill.${kind}` as StringKey)}` }),
      ])),
    });
  }

  /** A drill on the training ground; `counts` false is free practice, the drill as a toy. */
  async #drill(kind: DrillKind, counts: boolean): Promise<void> {
    const world = this.#world;
    const hero = world.hero as Hero;
    const player = heroPlayer(world)!;
    const rng = streamOf(world.seed + world.season * 53 + world.day * 7 + hero.week.length, `drill-${kind}`);
    const stage = new Stage({ tier: this.#host.tier, reducedMotion: this.#host.reducedMotion, playerStyle: this.#host.settings.playerStyle });
    this.#host.cover(true);
    const back = button('', () => finish(-1), { class: 'tl-btn tl-ghost tl-icon-only tl-stage-back', icon: 'back', 'aria-label': t('nav.back') });
    stage.root.append(back);
    let resolveSession: (score: number) => void = () => undefined;
    const finish = (score: number): void => resolveSession(score);
    const score = await Promise.race([
      playDrill(stage, kind, rng, player.attrs, hero.number),
      new Promise<number>((resolve) => { resolveSession = resolve; }),
    ]);
    stage.dispose();
    this.#host.cover(false);
    // Backing out is the coach running it: trying is never worse than skipping (§A).
    const stars = sessionStars(kind, Math.max(0, score));
    if (counts) doActivity(world, 'drill', { kind, stars });
    this.#host.saveNow();
    this.#host.refresh();
    if (score >= 0) starsSheet(kind, stars, counts);
  }

  // ---- matchday ------------------------------------------------------------------

  #playMatch(watch: boolean): void {
    const world = this.#world;
    const club = this.club!;
    for (let guard = 0; guard < 400; guard++) {
      const fixture = nextFixture(world, club.id);
      if (!fixture || fixture.day === world.day) break;
      if (advanceDay(world, { watchClubId: club.id }).ownFixture) break;
    }
    const fixture = nextFixture(world, club.id);
    if (!fixture) {
      this.#host.refresh();
      return;
    }
    closeWeek(world);
    const rng = streamOf(world.seed + world.season * 104729 + fixture.day, 'day');
    for (const other of world.fixtures) {
      if (other.played || other.day !== fixture.day || other === fixture) continue;
      applyResult(world, other, playQuick(world, other, rng));
    }
    const control = heroControl(world, club);
    const started = control.enterAt === Infinity;
    const heroId = control.playerId;
    if (!watch) {
      const result = playQuick(world, fixture, rng);
      applyResult(world, fixture, result);
      world.day = fixture.day + 1;
      const minutes = started ? 90 : Math.round(90 - control.enterAt / 60);
      const line: MatchLine = {
        started, minutes, rating: clamp01((result.ratings.get(heroId) ?? 6.4) / 10) * 10,
        goals: result.scorers.filter((scorer) => scorer.playerId === heroId).length, assists: 0, passesChosen: 0, passesArrived: 0,
      };
      this.#afterMatch(line, fixture.homeId === club.id ? [result.homeGoals, result.awayGoals] : [result.awayGoals, result.homeGoals], []);
      return;
    }

    const engine = openMatch(world, fixture, control);
    const mine = fixture.homeId === club.id ? 'home' : 'away';
    const moments: MomentRecord[] = [];
    let enteredAt = started ? 0 : -1;
    const track = (events: readonly MatchEvent[]): void => {
      for (const event of events) {
        if (event.type === 'substitution' && event.on === heroId) enteredAt = Math.floor(engine.state.clock / 60);
        const last = moments[moments.length - 1];
        if (!last || last.outcome) continue;
        last.outcome = outcomeOf(event, heroId);
      }
    };
    const screen = new MatchScreen({
      engine,
      mine,
      speed: 40,
      reducedMotion: this.#host.reducedMotion,
      sound: this.#host.settings.sound,
      tier: this.#host.tier,
      conditions: conditionsFor(world.seed, world.season, fixture.round),
      commentary: this.#host.settings.commentary,
      autoQuality: this.#host.settings.quality === 'auto',
      crowd: this.#host.settings.crowd3d,
      stadiumFx: this.#host.settings.stadiumFx,
      playerStyle: this.#host.settings.playerStyle,
      camera: 'broadcast',
      career: {
        heroId,
        celebrations: [0, 1, 2, 3].map((pose) => celebrationUnlocked(world.hero as Hero, pose)),
        onEvents: track,
        onChoice: (option: MomentOption) => {
          moments.push({ kind: option.kind === 'auto' ? kindOf(option) : option.kind, outcome: '' });
        },
      },
      onLeave: () => leaveSheet(screen),
      onFinished: (state) => {
        if (!fixture.played) {
          applyResult(world, fixture, engine.runToEnd());
          world.day = fixture.day + 1;
        }
        const figure = findFigure(state, heroId);
        const line: MatchLine = {
          started,
          minutes: enteredAt < 0 ? 0 : 90 - enteredAt,
          rating: figure?.stats.rating ?? 6.4,
          goals: figure?.stats.goals ?? 0,
          assists: figure?.stats.assists ?? 0,
          passesChosen: moments.filter((moment) => moment.kind === 'pass').length,
          passesArrived: moments.filter((moment) => moment.kind === 'pass' && moment.outcome === 'good').length,
        };
        const score: [number, number] = mine === 'home' ? [state.score.home, state.score.away] : [state.score.away, state.score.home];
        screen.dispose();
        this.#host.cover(false);
        this.#afterMatch(line, score, moments);
      },
    });
    document.body.append(screen.root);
    this.#host.cover(true);
    this.#live = screen;
  }

  /** The match being played, for the harnesses. */
  #live: MatchScreen | null = null;
  get liveMatch(): MatchScreen | null {
    return this.#live?.root.isConnected ? this.#live : null;
  }

  #afterMatch(line: MatchLine, score: [number, number], moments: MomentRecord[]): void {
    const world = this.#world;
    const hero = world.hero as Hero;
    this.#live = null;
    const change = recordHeroMatch(world, line);
    // Six straight benchings always bring a club where he would start (§8).
    if (hero.benchStreak >= 6) {
      hero.offers = heroOffers(world);
      hero.benchStreak = 0;
    }
    this.#host.saveNow();
    this.#host.refresh();
    postMatchSheet(line, score, moments, change);
  }

  #nextSeason(): void {
    const world = this.#world;
    const hero = world.hero as Hero;
    // The rest of the league finishes its fixtures before the table is settled.
    for (let guard = 0; guard < 400; guard++) if (advanceDay(world).seasonEnded) break;
    closeHeroSeason(world);
    endSeason(world);
    hero.offers = heroOffers(world);
    if (retirementStage(heroPlayer(world)!) === 'forced') announceRetirement(world);
    this.#host.saveNow();
    this.#host.refresh();
    this.#host.toast(t('home.season', { n: world.season + 1 }), 'star');
  }

  // ---- the farewell and Legacy -----------------------------------------------------

  #renderRetired(wrap: HTMLElement): void {
    const world = this.#world;
    const hero = world.hero as Hero;
    const player = heroPlayer(world)!;
    const club = this.club!;
    wrap.append(
      el('section', { class: 'tl-card tl-retired' }, [
        el('h1', { class: 'tl-career-title' }, [icon('trophy', 26), el('span', { text: t('retire.title') })]),
        el('div', { class: 'tl-frame' }, [
          kitArt(defaultLook(), { primary: club.kitPrimary, secondary: club.kitSecondary }, { side: 'back', number: hero.number, shirtOnly: true }),
        ]),
        el('div', { class: 'tl-peg-stats' }, [
          statChip('shirt', t('career.apps'), player.career.apps),
          statChip('ball', t('career.goals'), player.career.goals),
          statChip('trophy', t('milestone.trophy'), player.career.honours),
        ]),
      ]),
      el('section', { class: 'tl-card tl-offers' }, [
        el('h2', { class: 'tl-career-head' }, [icon('club', 18), el('span', { text: t('retire.manage') })]),
        el('div', { class: 'tl-offer-row' }, legacyClubs(world).map((clubId) => offerCard(world, world.clubs[clubId] as Club, {
          label: t('retire.manage'),
          onPick: () => {
            retireIntoManagement(world, clubId);
            this.#host.saveNow();
            this.#host.becomeClubCareer();
          },
        }))),
      ]),
      button(t('menu.back'), () => this.#host.openMenu(), { class: 'tl-btn tl-ghost tl-block', icon: 'home' }),
    );
  }
}

// ---- pieces ---------------------------------------------------------------------

function findFigure(state: MatchState, id: number): MatchPlayer | undefined {
  return [...state.home.players, ...state.home.bench, ...state.away.players, ...state.away.bench].find((player) => player.id === id);
}

function kindOf(option: MomentOption): MomentKind {
  const kind = option.action.kind;
  return kind === 'pass' || kind === 'shoot' || kind === 'cross' || kind === 'dribble' ? kind : 'auto';
}

/** What a moment came to, read off the first event that settles it. */
function outcomeOf(event: MatchEvent, heroId: number): MomentRecord['outcome'] {
  switch (event.type) {
    case 'goal': return event.by === heroId || event.assist === heroId ? 'goal' : '';
    case 'passComplete': return event.from === heroId ? 'good' : '';
    case 'passIntercepted': return event.from === heroId ? 'lost' : '';
    case 'save': return 'saved';
    case 'tackle': return event.on === heroId && event.won ? 'lost' : '';
    case 'skill': return event.by === heroId && event.beat ? 'good' : '';
    case 'goalKick': case 'corner': case 'throwIn': return 'lost';
    default: return '';
  }
}

/** A club as a crest card: division, stadium size, and a shirt for whether he would start. */
function offerCard(world: World, club: Club, opts: { pressed?: boolean; starts?: boolean; loan?: boolean; label: string; onPick(): void }): HTMLElement {
  const card = button('', opts.onPick, {
    class: `tl-btn tl-offer${opts.pressed ? ' is-picked' : ''}`,
    'aria-label': `${opts.label} — ${club.name}, ${t('career.division', { n: club.tier + 1 })}`,
    'aria-pressed': opts.pressed === undefined ? undefined : String(opts.pressed),
  });
  card.append(
    crest(world, club, 64),
    el('b', { class: 'tl-offer-name', text: club.short }),
    el('span', { class: 'tl-offer-facts' }, [
      el('span', { class: 'tl-offer-tier', 'aria-hidden': 'true' }, Array.from({ length: 5 - club.tier }, () => el('i'))),
      el('span', { class: 'tl-offer-seats' }, [icon('stadium', 14), el('span', { text: `${Math.round(club.capacity / 1000)}k` })]),
    ]),
  );
  if (opts.starts !== undefined) card.append(el('span', { class: `tl-offer-start${opts.starts ? ' is-start' : ''}` }, [icon(opts.starts ? 'shirt' : 'sub', 18)]));
  if (opts.loan) card.append(el('span', { class: 'tl-offer-loan' }, [icon('back', 14)]));
  return card;
}

interface PickerItem {
  label: string;
  pressed: boolean;
  pick(): void;
  /** Written on the button even with every string blanked: a shirt number. */
  raw?: boolean;
  swatch?: number;
  art?: Element;
}

function pickerRow(label: string, glyph: IconName, items: PickerItem[]): HTMLElement {
  return el('div', { class: 'tl-picker', role: 'group', 'aria-label': label }, [
    el('span', { class: 'tl-picker-label' }, [icon(glyph, 18), el('span', { text: label })]),
    el('div', { class: 'tl-picker-items' }, items.map((item) => {
      const choice = button(item.raw || item.art ? item.label : '', item.pick, {
        class: `tl-btn tl-sm tl-pick${item.swatch !== undefined ? ' tl-swatch' : ''}`,
        'aria-pressed': String(item.pressed),
        'aria-label': item.label,
        ...(item.swatch !== undefined ? { icon: 'boot' as const, style: `color:${kitCss(item.swatch)}` } : {}),
      });
      if (item.art) choice.prepend(item.art);
      return choice;
    })),
  ]);
}

/** Where on the pitch a position plays, as a dot on a little pitch: readable with no words. */
function positionArt(position: HeroPosition): Element {
  const [x, y] = { ST: [12, 6], AML: [5, 9], AMR: [19, 9], AMC: [12, 11], MC: [12, 16] }[position];
  const art = el('span', { class: 'tl-pos-art', 'aria-hidden': 'true' });
  art.innerHTML = `<svg viewBox="0 0 24 30" width="20" height="25"><rect x="1" y="1" width="22" height="28" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/>`
    + `<path d="M1 15h22M8 1v4h8V1" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.6"/><circle cx="${x}" cy="${y}" r="3.2" fill="currentColor"/></svg>`;
  return art;
}

/** A ring: how full, as an arc and as five pips — never colour alone (§D). */
function ringArt(ring: 'coach' | 'team' | 'fans', value: number): HTMLElement {
  const length = 2 * Math.PI * 26;
  const svg = `<svg viewBox="0 0 64 64" width="72" height="72" aria-hidden="true">
    <circle cx="32" cy="32" r="26" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="7"/>
    <circle cx="32" cy="32" r="26" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"
      stroke-dasharray="${(length * clamp01(value)).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 32 32)"/></svg>`;
  const art = el('span', { class: 'tl-ring-art' });
  art.innerHTML = svg;
  art.append(icon(RING_GLYPH[ring], 24));
  const pips = el('span', { class: 'tl-pips', 'aria-hidden': 'true' });
  for (let pip = 0; pip < 5; pip++) pips.append(el('i', { class: pip < Math.round(value * 5) ? 'on' : '' }));
  return el('div', {
    class: `tl-ring ring-${ring}`, role: 'img',
    'aria-label': `${t(`career.${ring}` as StringKey)} ${Math.round(value * 5)}/5`,
  }, [art, pips, el('span', { class: 'tl-ring-label', text: t(`career.${ring}` as StringKey) })]);
}

function statChip(glyph: IconName, label: string, value: number): HTMLElement {
  return el('span', { class: 'tl-stat-chip', role: 'img', 'aria-label': `${label} ${value}` }, [icon(glyph, 18), el('b', { text: String(value) })]);
}

/** The match as icons: the score, his rating as pips, each moment and how it went. */
function postMatchSheet(line: MatchLine, score: [number, number], moments: MomentRecord[], change: RingChange): void {
  const glyph: Record<MomentKind, IconName> = { pass: 'squad', shoot: 'goal', cross: 'flag', dribble: 'up', auto: 'play' };
  const pips = el('span', { class: 'tl-pips tl-rating', role: 'img', 'aria-label': `${t('post.rating')} ${line.rating.toFixed(1)}` });
  for (let pip = 0; pip < 5; pip++) pips.append(el('i', { class: pip < Math.round((line.rating - 4) / 1.2) ? 'on' : '' }));
  const rings = (['coach', 'team', 'fans'] as const).map((ring) => el('span', {
    class: `tl-ring-delta ${change[ring] > 0.001 ? 'up' : change[ring] < -0.001 ? 'down' : ''}`, role: 'img',
    'aria-label': `${t(`career.${ring}` as StringKey)} ${change[ring] > 0 ? '+' : ''}${Math.round(change[ring] * 100)}`,
  }, [icon(RING_GLYPH[ring], 20), icon(change[ring] > 0.001 ? 'up' : change[ring] < -0.001 ? 'down' : 'check', 14)]));
  const dialog = sheet({
    title: t('post.title'),
    icon: 'whistle',
    body: [
      el('div', { class: 'tl-post-score' }, [el('b', { text: `${score[0]} – ${score[1]}` })]),
      pips,
      el('div', { class: 'tl-post-moments', role: 'list', 'aria-label': t('post.moments') }, moments.map((moment) => el('span', {
        class: `tl-post-moment is-${moment.outcome || 'none'}`, role: 'listitem', 'aria-label': `${t(`moment.${moment.kind}` as StringKey)}`,
      }, [icon(moment.outcome === 'goal' ? 'ball' : glyph[moment.kind], 20)]))),
      el('div', { class: 'tl-post-rings' }, rings),
    ],
    foot: [button(t('drill.done'), () => dialog.close(), { class: 'tl-btn tl-primary tl-block', icon: 'check' })],
  });
}

function starsSheet(kind: DrillKind, stars: number, counted: boolean): void {
  const row = el('div', { class: 'tl-stars', role: 'img', 'aria-label': t('drill.stars', { n: stars }) });
  for (let star = 0; star < 3; star++) row.append(el('span', { class: star < stars ? 'on' : '' }, [icon('star', 40)]));
  const dialog = sheet({
    title: t(counted ? `drill.${kind}` as StringKey : 'drill.practice'),
    icon: 'cone',
    body: [row],
    foot: [button(t('drill.done'), () => dialog.close(), { class: 'tl-btn tl-primary tl-block', icon: 'check' })],
  });
}

/** Back in a player-career match asks, because finishing for him is a real choice. */
function leaveSheet(screen: MatchScreen): void {
  const dialog = sheet({
    title: t('leave.title'),
    icon: 'back',
    host: screen.root,
    body: [],
    foot: [
      button(t('leave.stay'), () => dialog.close(), { class: 'tl-btn tl-primary', icon: 'play', style: 'flex:1' }),
      button(t('leave.finish'), () => {
        dialog.close();
        screen.finishForMe();
      }, { class: 'tl-btn', icon: 'skip', style: 'flex:1' }),
    ],
  });
}

