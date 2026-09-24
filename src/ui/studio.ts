// The club studio: everything a kid can make their own, in one place.
//
// Before this the badge lived at the bottom of Settings, the kit was two swatches inside the
// badge editor, and nothing else about the club could be touched at all. A club you cannot
// dress is a club you are borrowing.
//
// Layout: ONE stage that shows the whole identity at once — the ground, the kit, the badge,
// the ball — and a row of tabs under it that change one thing at a time. The stage repaints
// in place on every tap; the page never re-renders, for the reason crestEditor.ts gives
// (a card entrance replayed twenty times in a row is a flashing screen).
//
// Two rules about honesty:
//
// - **Every preview is drawn from the numbers the match reads** (see src/ui/art/kit.ts).
//   A kit option shows the colour the 3D figures will actually wear.
// - **Looks are free and building costs money.** Cosmetics never compete with signing a
//   striker; facilities do, because they pay something back and the card says what.

import { t, type StringKey } from '../i18n.js';
import { audio } from '../audio/audio.js';
import { BALL_STYLES, ROOF_STYLES, ballStyle, roofColour } from '../render/ballStyle.js';
import { KIT_PATTERNS, NUMBER_STYLES } from '../render/kitPattern.js';
import { ballCanvas } from './art/ball.js';
import {
  FACILITY_KINDS,
  FACILITY_MAX,
  buildFacility,
  facilityCost,
  standGrowth,
  type FacilityKind,
} from '../sim/career/facilities.js';
import { KIT_SOURCES, kitColour, type Club, type ClubLook } from '../sim/world/types.js';
import { kitArt, stadiumArt } from './art/kit.js';
import { crestEditor, PALETTE } from './crestEditor.js';
import { crest, type ScreenHost } from './screens.js';
import { button, card, clear, el, money } from './dom.js';
import { icon, type IconName } from './icons.js';
import { applyClubTheme, kitCss } from './theme.js';

type TabId = 'badge' | 'kit' | 'ball' | 'ground' | 'build';
const TABS: { id: TabId; key: StringKey; glyph: IconName }[] = [
  { id: 'badge', key: 'studio.badge', glyph: 'club' },
  { id: 'kit', key: 'studio.kit', glyph: 'shirt' },
  { id: 'ball', key: 'studio.ball', glyph: 'ball' },
  { id: 'ground', key: 'studio.ground', glyph: 'stadium' },
  { id: 'build', key: 'studio.build', glyph: 'build' },
];

/** Which tab was open, so saving and coming back lands where the kid left off. */
let openTab: TabId = 'badge';

const FACILITY_TEXT: Record<FacilityKind, { name: StringKey; body: StringKey; glyph: IconName }> = {
  stands: { name: 'fac.stands', body: 'fac.standsBody', glyph: 'stadium' },
  training: { name: 'fac.training', body: 'fac.trainingBody', glyph: 'whistle' },
  shop: { name: 'fac.shop', body: 'fac.shopBody', glyph: 'shirt' },
};

export function renderStudio(host: ScreenHost, root: HTMLElement): void {
  const world = host.world;
  // Bound to a typed const after the guard: the panel functions below are declarations,
  // and a declaration does not inherit the narrowing of a destructured nullable.
  const maybe = host.club;
  if (!maybe) return;
  const club: Club = maybe;
  const colours = (): { primary: number; secondary: number } => ({ primary: club.kitPrimary, secondary: club.kitSecondary });

  // ---- the stage --------------------------------------------------------------------
  const stage = el('div', { class: 'tl-studio-stage' });
  const crestHolder = el('div', { class: 'tl-studio-crest' });
  const paintCrest = (): void => {
    clear(crestHolder);
    crestHolder.append(crest(world, club, 84));
  };
  /** The spinning ball on the stage, sized by the stage's CSS rather than its own pixels. */
  const stageBall = (): HTMLCanvasElement => {
    const canvas = ballCanvas(world.look.ball, colours(), {
      size: 110, spin: true, label: t(`ball.style.${ballStyle(world.look.ball).id}` as StringKey),
    });
    canvas.style.width = '';
    canvas.style.height = '';
    return canvas;
  };
  const paintStage = (): void => {
    clear(stage);
    paintCrest();
    stage.append(
      el('div', { class: 'tl-studio-ground' }, [stadiumArt(world.look, colours(), world.facilities.stands, club.stadium)]),
      el('div', { class: 'tl-studio-figures' }, [
        // Kit left, badge low in the middle, ball right: the middle of the frame is the
        // roof's fascia, and the ground's name is written there.
        el('div', { class: 'tl-studio-kit' }, [
          kitArt(world.look, colours(), { label: t('studio.kit'), crest: crest(world, club, 12) }),
        ]),
        crestHolder,
        el('div', { class: 'tl-studio-ball' }, [stageBall()]),
      ]),
      el('div', { class: 'tl-studio-caption' }, [
        el('b', { text: club.name }),
        el('span', { text: `${club.stadium} · ${t('home.capacity', { n: club.capacity.toLocaleString() })}` }),
      ]),
    );
  };

  /** Something about the look changed: save it, repaint the stage and the open panel. */
  const changed = (retheme = false): void => {
    audio.tick();
    if (retheme) applyClubTheme(club);
    host.persist();
    paintStage();
    paintPanel();
  };
  const setLook = (patch: Partial<ClubLook>): void => {
    world.look = { ...world.look, ...patch };
    changed();
  };

  // ---- tabs --------------------------------------------------------------------------
  const tabRow = el('div', { class: 'tl-studio-tabs', role: 'tablist', 'aria-label': t('studio.title') });
  const panel = el('div', { class: 'tl-studio-panel', role: 'tabpanel' });

  const paintTabs = (): void => {
    clear(tabRow);
    for (const tab of TABS) {
      const on = tab.id === openTab;
      const b = el('button', {
        class: 'tl-studio-tab',
        type: 'button',
        role: 'tab',
        id: `tl-studio-tab-${tab.id}`,
        'aria-selected': String(on),
        'aria-controls': 'tl-studio-panel',
        tabindex: on ? 0 : -1,
      }, [icon(tab.glyph, 20), el('span', { text: t(tab.key) })]);
      b.addEventListener('click', () => select(tab.id));
      // Arrow keys move along the tabs, the way a tablist is supposed to behave.
      b.addEventListener('keydown', (e) => {
        const i = TABS.findIndex((x) => x.id === openTab);
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        e.preventDefault();
        const next = TABS[(i + step + TABS.length) % TABS.length] as (typeof TABS)[number];
        select(next.id);
        (tabRow.querySelector(`#tl-studio-tab-${next.id}`) as HTMLElement | null)?.focus();
      });
      tabRow.append(b);
    }
  };
  const select = (id: TabId): void => {
    if (id === openTab) return;
    openTab = id;
    audio.tick();
    paintTabs();
    paintPanel();
  };

  // ---- panels ------------------------------------------------------------------------
  function paintPanel(): void {
    clear(panel);
    panel.id = 'tl-studio-panel';
    panel.setAttribute('aria-labelledby', `tl-studio-tab-${openTab}`);
    switch (openTab) {
      case 'badge': panel.append(badgePanel()); break;
      case 'kit': panel.append(kitPanel()); break;
      case 'ball': panel.append(ballPanel()); break;
      case 'ground': panel.append(groundPanel()); break;
      case 'build': panel.append(buildPanel()); break;
    }
  }

  // The badge editor keeps its own preview and its own tabs; it is a component, and the
  // studio only mounts it. Rebuilt on every panel paint, which is cheap and keeps it in
  // step with colours changed on the Kit tab.
  function badgePanel(): HTMLElement {
    const badge = crestEditor({
      world,
      club,
      onChange: () => {
        applyClubTheme(club);
        host.persist();
        paintCrest();
      },
    });
    return el('div', {}, [badge.node]);
  }

  function swatches(label: string, current: number, onPick: (c: number) => void): HTMLElement {
    const row = el('div', { class: 'tl-swatches', role: 'group', 'aria-label': label });
    for (const colour of PALETTE) {
      const on = colour === current;
      const b = el('button', {
        class: `tl-swatch${on ? ' on' : ''}`,
        type: 'button',
        style: `background:${kitCss(colour)}`,
        'aria-pressed': String(on),
        'aria-label': `${label} ${colour.toString(16).padStart(6, '0')}`,
      });
      b.addEventListener('click', () => onPick(colour));
      row.append(b);
    }
    return el('div', { class: 'tl-field' }, [el('span', { text: label }), row]);
  }

  /** One kit part: four choices, each a chip of the colour it would actually be. */
  function partRow(label: string, field: 'shorts' | 'sleeves' | 'socks' | 'patternColour' | 'numberColour'): HTMLElement {
    const row = el('div', { class: 'tl-opt-row', role: 'group', 'aria-label': label });
    KIT_SOURCES.forEach((source, i) => {
      const on = world.look[field] === i;
      const colour = kitColour(i, club.kitPrimary, club.kitSecondary);
      const b = el('button', {
        class: 'tl-opt',
        type: 'button',
        'aria-pressed': String(on),
      }, [
        el('i', { class: 'tl-opt-dot', style: `background:${kitCss(colour)}` }),
        el('span', { text: t(`kit.source.${source}` as StringKey) }),
      ]);
      b.addEventListener('click', () => setLook({ [field]: i } as Partial<ClubLook>));
      row.append(b);
    });
    return el('div', { class: 'tl-field' }, [el('span', { text: label }), row]);
  }

  /** The name on the back: the manager's own, which is the one a kid wants to see there. */
  const backName = (): string => {
    const name = (world.managerName || t('intro.defaultManager')).trim().split(/\s+/);
    return name[name.length - 1] ?? '';
  };

  function kitPanel(): HTMLElement {
    const patterns = el('div', { class: 'tl-pattern-grid', role: 'group', 'aria-label': t('kit.pattern') });
    KIT_PATTERNS.forEach((id, i) => {
      const on = world.look.pattern === i;
      const label = t(`kit.pattern.${id}` as StringKey);
      const b = el('button', { class: 'tl-pattern-opt', type: 'button', 'aria-pressed': String(on), 'aria-label': label }, [
        kitArt({ ...world.look, pattern: i }, colours(), { shirtOnly: true }),
        el('span', { text: label }),
      ]);
      b.addEventListener('click', () => setLook({ pattern: i }));
      patterns.append(b);
    });

    const styles = el('div', { class: 'tl-opt-row', role: 'group', 'aria-label': t('kit.numberStyle') });
    NUMBER_STYLES.forEach((id, i) => {
      const on = world.look.numberStyle === i;
      const b = el('button', { class: `tl-opt tl-num-opt num-${id}`, type: 'button', 'aria-pressed': String(on) }, [
        el('b', { text: '10' }),
        el('span', { text: t(`kit.numberStyle.${id}` as StringKey) }),
      ]);
      b.addEventListener('click', () => setLook({ numberStyle: i }));
      styles.append(b);
    });

    const chest = el('div', { class: 'tl-opt-row', role: 'group', 'aria-label': t('kit.chestBadge') });
    for (const v of [true, false]) {
      const b = el('button', { class: 'tl-opt', type: 'button', 'aria-pressed': String(world.look.chestBadge === v) }, [
        el('span', { text: v ? t('common.on') : t('common.off') }),
      ]);
      b.addEventListener('click', () => setLook({ chestBadge: v }));
      chest.append(b);
    }

    return el('div', { class: 'tl-studio-cols' }, [
      el('div', { class: 'tl-studio-col' }, [
        // Both sides at once: the pattern and the badge are on the front, the name and the
        // number on the back, and a kit is both.
        el('div', { class: 'tl-kit-pair' }, [
          el('figure', {}, [
            kitArt(world.look, colours(), { side: 'front', crest: crest(world, club, 12), label: t('kit.front') }),
            el('figcaption', { text: t('kit.front') }),
          ]),
          el('figure', {}, [
            kitArt(world.look, colours(), { side: 'back', number: 10, name: backName(), label: t('kit.back') }),
            el('figcaption', { text: t('kit.back') }),
          ]),
        ]),
        el('h3', { class: 'tl-studio-sub', text: t('kit.colours') }),
        swatches(t('intro.primary'), club.kitPrimary, (c) => {
          club.kitPrimary = c;
          changed(true);
        }),
        swatches(t('intro.secondary'), club.kitSecondary, (c) => {
          club.kitSecondary = c;
          changed(true);
        }),
        el('h3', { class: 'tl-studio-sub', text: t('kit.numbers') }),
        partRow(t('kit.numberColour'), 'numberColour'),
        el('div', { class: 'tl-field' }, [el('span', { text: t('kit.numberStyle') }), styles]),
        el('p', { class: 'tl-studio-note', text: t('kit.numberNote') }),
      ]),
      el('div', { class: 'tl-studio-col' }, [
        el('div', { class: 'tl-field' }, [el('span', { text: t('kit.pattern') }), patterns]),
        partRow(t('kit.patternColour'), 'patternColour'),
        partRow(t('kit.sleeves'), 'sleeves'),
        partRow(t('kit.shorts'), 'shorts'),
        partRow(t('kit.socks'), 'socks'),
        el('div', { class: 'tl-field' }, [el('span', { text: t('kit.chestBadge') }), chest]),
        el('p', { class: 'tl-studio-note', text: t('kit.note') }),
      ]),
    ]);
  }

  function ballPanel(): HTMLElement {
    const out = el('div', { class: 'tl-studio-col' });
    for (const group of ['club', 'eras', 'fantasy'] as const) {
      const grid = el('div', { class: 'tl-ball-grid', role: 'group', 'aria-label': t(`ball.group.${group}` as StringKey) });
      BALL_STYLES.forEach((style, i) => {
        if (style.group !== group) return;
        const on = world.look.ball === i;
        const label = t(`ball.style.${style.id}` as StringKey);
        const b = el('button', {
          class: `tl-ball-opt${style.glow ? ' glows' : ''}`,
          type: 'button',
          'aria-pressed': String(on),
          style: style.trail ? `--glow:${kitCss(style.trail)}` : '',
        }, [
          ballCanvas(i, colours(), { size: 60, yaw: 0.4 + i * 0.7 }),
          el('span', { text: label }),
        ]);
        b.addEventListener('click', () => setLook({ ball: i }));
        grid.append(b);
      });
      out.append(el('h3', { class: 'tl-studio-sub', text: t(`ball.group.${group}` as StringKey) }), grid);
    }
    out.append(el('p', { class: 'tl-studio-note', text: t('ball.hint') }));
    return out;
  }

  function groundPanel(): HTMLElement {
    // A form, so Enter saves and the browser's own validation applies the length limit.
    const input = el('input', {
      class: 'tl-input',
      type: 'text',
      value: club.stadium,
      maxlength: 32,
      required: true,
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': t('ground.name'),
    }) as HTMLInputElement;
    // button() always makes type="button", so the save button submits the form by hand;
    // Enter in the field submits it natively.
    const form: HTMLFormElement = el('form', { class: 'tl-rename' }, [
      input,
      button(t('ground.rename'), () => form.requestSubmit(), { class: 'tl-btn tl-primary', icon: 'check' }),
    ]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Collapse runs of whitespace; nothing else is filtered, because nothing else is
      // dangerous — the name is only ever written into the page as text.
      const name = input.value.replace(/\s+/g, ' ').trim().slice(0, 32);
      if (!name || name === club.stadium) return;
      club.stadium = name;
      changed();
      host.toast(t('ground.renamed', { name }), 'stadium');
    });

    const roofs = el('div', { class: 'tl-opt-row', role: 'group', 'aria-label': t('ground.roof') });
    ROOF_STYLES.forEach((style, i) => {
      const on = world.look.roof === i;
      const b = el('button', { class: 'tl-opt', type: 'button', 'aria-pressed': String(on) }, [
        el('i', { class: 'tl-opt-dot', style: `background:${kitCss(roofColour(i, club.kitPrimary, club.kitSecondary))}` }),
        el('span', { text: style === 'slate' ? t('ground.roof.0') : t(`kit.source.${style}` as StringKey) }),
      ]);
      b.addEventListener('click', () => setLook({ roof: i }));
      roofs.append(b);
    });

    return el('div', { class: 'tl-studio-cols' }, [
      el('div', { class: 'tl-studio-col' }, [
        el('div', { class: 'tl-field' }, [el('span', { text: t('ground.name') }), form]),
        el('div', { class: 'tl-kv' }, [
          el('span', { text: t('ground.capacity') }),
          el('b', { text: club.capacity.toLocaleString() }),
        ]),
      ]),
      el('div', { class: 'tl-studio-col' }, [
        el('div', { class: 'tl-field' }, [el('span', { text: t('ground.roof') }), roofs]),
        el('p', { class: 'tl-studio-note', text: t('ground.roofNote') }),
      ]),
    ]);
  }

  function buildPanel(): HTMLElement {
    const list = el('div', { class: 'tl-fac-list' });
    for (const kind of FACILITY_KINDS) {
      const text = FACILITY_TEXT[kind];
      const level = world.facilities[kind];
      const max = FACILITY_MAX[kind];
      const cost = facilityCost(world, club, kind);
      const affordable = cost !== null && cost <= club.balance;

      const pips = el('span', { class: 'tl-pips', 'aria-label': t('fac.level', { n: level, max }) });
      for (let i = 0; i < max; i++) pips.append(el('i', { class: i < level ? 'on' : '' }));

      const action = cost === null
        ? el('span', { class: 'tl-pill good', text: t('fac.maxed') })
        : button(affordable ? t('fac.build', { cost: money(cost) }) : t('fac.short', { cost: money(cost) }), () => {
          if (!buildFacility(world, kind)) return;
          audio.tick();
          host.persist();
          host.toast(t('fac.built', { name: t(text.name) }), 'build');
          paintStage();
          paintPanel();
          paintBalance();
        }, { class: `tl-btn ${affordable ? 'tl-primary' : 'tl-ghost'}`, icon: 'build', disabled: !affordable });

      list.append(el('div', { class: `tl-fac${cost === null ? ' maxed' : ''}` }, [
        el('span', { class: 'tl-fac-icon' }, [icon(text.glyph, 26)]),
        el('div', { class: 'tl-fac-body' }, [
          el('div', { class: 'tl-fac-head' }, [el('b', { text: t(text.name) }), pips]),
          el('p', {
            text: kind === 'stands' ? t(text.body, { n: standGrowth(club).toLocaleString() }) : t(text.body),
          }),
          el('span', { class: 'tl-fac-level', text: t('fac.level', { n: level, max }) }),
        ]),
        el('div', { class: 'tl-fac-action' }, [action]),
      ]));
    }
    return el('div', { class: 'tl-studio-col' }, [list, el('p', { class: 'tl-studio-note', text: t('fac.note') })]);
  }

  // ---- composition --------------------------------------------------------------------
  const balance = el('b');
  const paintBalance = (): void => {
    balance.textContent = money(club.balance);
  };
  paintBalance();

  paintStage();
  paintTabs();
  paintPanel();

  root.append(
    card([
      el('div', { class: 'tl-studio-head' }, [
        el('div', {}, [
          el('h1', { class: 'tl-studio-title', text: t('studio.title') }),
          el('p', { class: 'tl-muted', text: t('studio.hint') }),
        ]),
        el('div', { class: 'tl-money-chip', 'aria-label': t('home.balance') }, [icon('coins', 18), balance]),
      ]),
      stage,
    ], { class: 'tl-card tl-studio' }),
    card([tabRow, panel], { class: 'tl-card tl-studio-editor' }),
  );
}
