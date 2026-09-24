// The badge editor.
//
// Lifted out of the intro's identity step, which had five buttons in a row and was already
// the longest function in that file. It has to grow to six dimensions — shape, pattern,
// colours, border, emblem, extras — and six rows of thumbnails stacked down one card is not
// a badge editor, it is a form.
//
// So: tabs, and one live preview that never moves. Three rules it keeps.
//
// - **Every control is its own preview.** A shape option is a crest wearing that shape and
//   the player's current colours; a pattern option is the same badge with that pattern on
//   it. Nothing here is a word describing an outcome you have to imagine.
// - **It repaints in place and never rebuilds itself.** Re-rendering the card on every tap
//   replayed its entrance animation, so choosing a badge made the whole screen flash — and
//   these are exactly the controls a kid taps twenty times in a row.
// - **It survives `?blank=1`.** Every tab carries an icon as well as a label, every option
//   is a picture, and the two switches at the end are the only text in it.

import { t, type StringKey } from '../i18n.js';
import { audio } from '../audio/audio.js';
import type { Club, CrestSpec, EmblemLayer, World } from '../sim/world/types.js';
import {
  CREST_BORDERS,
  CREST_EMBLEMS,
  CREST_MAX_STARS,
  CREST_PATTERNS,
  CREST_SHAPES,
  crestOf,
  crestSvg,
  defaultCrest,
} from './crest.js';
import { button, clear, el } from './dom.js';
import { icon, type IconName } from './icons.js';
import { kitCss } from './theme.js';
import { layersPanel, type LayerSelection } from './emblemEditor.js';
import { clampLayer } from './emblems.js';

/** A palette a kid can pick from without producing a club nobody can look at. */
export const PALETTE = [
  0xd7263d, 0xe8632a, 0xf2b632, 0x3fb950, 0x1f9e8c, 0x2f6ed8,
  0x6a4bd8, 0xc23bb0, 0x101418, 0xf2f4f6, 0x8a5a2b, 0x7a8794,
];

export interface CrestEditorHost {
  readonly world: World;
  readonly club: Club;
  /** Something changed. Save it, and re-theme the page if the colours moved. */
  onChange(): void;
}

export interface CrestEditor {
  node: HTMLElement;
  /** Redraw everything from the current state. For a change made from outside. */
  repaint(): void;
}

type Tab = { key: StringKey; glyph: IconName; build: () => HTMLElement };

const PREVIEW_SIZE = 136;
const OPTION_SIZE = 44;

export function crestEditor(host: CrestEditorHost): CrestEditor {
  const club = host.club;

  /** The spec being edited. Writing it through the world is what makes a change stick. */
  const spec = (): CrestSpec => host.world.crest ?? crestOf(host.world, club);
  const set = (patch: Partial<CrestSpec>): void => {
    host.world.crest = { ...spec(), ...patch };
    audio.tick();
    redraw();
    host.onChange();
  };

  const preview = el('div', { class: 'tl-crest-preview' });
  const panel = el('div', { class: 'tl-crest-panel' });
  const tabRow = el('div', { class: 'tl-crest-tabs', role: 'tablist', 'aria-label': t('crest.title') });
  let active = 0;

  /** One option button: a crest wearing the thing it selects. */
  const option = (
    on: boolean,
    label: string,
    draw: () => SVGSVGElement,
    onPick: () => void,
  ): HTMLElement => {
    const b = el('button', {
      class: `tl-crest-option${on ? ' on' : ''}`,
      type: 'button',
      'aria-pressed': String(on),
      'aria-label': label,
      'data-tip': label,
    }, [draw()]);
    b.addEventListener('click', onPick);
    return b;
  };

  const swatchRow = (label: string, current: () => number, onPick: (c: number) => void): HTMLElement => {
    const row = el('div', { class: 'tl-swatches', role: 'group', 'aria-label': label });
    for (const colour of PALETTE) {
      const on = colour === current();
      const b = el('button', {
        class: `tl-swatch${on ? ' on' : ''}`,
        type: 'button',
        style: `background:${kitCss(colour)}`,
        'aria-pressed': String(on),
        'aria-label': `${label} ${colour.toString(16).padStart(6, '0')}`,
        'data-tip': label,
      });
      b.addEventListener('click', () => onPick(colour));
      row.append(b);
    }
    return el('div', { class: 'tl-field' }, [el('span', { text: label }), row]);
  };

  /** A crest identical to the club's except for one field. The thumbnails are all these. */
  const variant = (patch: Partial<CrestSpec>): SVGSVGElement => crestSvg({
    spec: { ...spec(), ...patch },
    primary: club.kitPrimary,
    secondary: club.kitSecondary,
    short: club.short,
    size: OPTION_SIZE,
  });

  const grid = (children: HTMLElement[]): HTMLElement => el('div', { class: 'tl-crest-grid' }, children);

  const TABS: Tab[] = [
    {
      key: 'crest.shape',
      glyph: 'club',
      build: () => grid(CREST_SHAPES.map((_, i) =>
        option(spec().shape === i, `${t('crest.shape')} ${i + 1}`,
          () => variant({ shape: i }), () => set({ shape: i })))),
    },
    {
      key: 'crest.pattern',
      glyph: 'tactics',
      build: () => grid(CREST_PATTERNS.map((_, i) =>
        option(spec().pattern === i, `${t('crest.pattern')} ${i + 1}`,
          () => variant({ pattern: i }), () => set({ pattern: i })))),
    },
    {
      key: 'crest.colour',
      glyph: 'palette',
      build: () => el('div', { class: 'tl-crest-colours' }, [
        swatchRow(t('intro.primary'), () => club.kitPrimary, (c) => {
          club.kitPrimary = c;
          audio.tick();
          redraw();
          host.onChange();
        }),
        swatchRow(t('intro.secondary'), () => club.kitSecondary, (c) => {
          club.kitSecondary = c;
          audio.tick();
          redraw();
          host.onChange();
        }),
        // The border is a colour decision far more than a shape one, so it lives with the
        // colours rather than in a tab of its own that nobody would open.
        el('div', { class: 'tl-field' }, [
          el('span', { text: t('crest.border') }),
          grid(CREST_BORDERS.map((_, i) =>
            option(spec().border === i, `${t('crest.border')} ${i + 1}`,
              () => variant({ border: i }), () => set({ border: i })))),
        ]),
      ]),
    },
    {
      key: 'crest.emblem',
      glyph: 'star',
      build: () => grid(CREST_EMBLEMS.map((_, i) =>
        option(spec().emblem === i, i === 0 ? t('crest.none') : `${t('crest.emblem')} ${i}`,
          () => variant({ emblem: i }), () => set({ emblem: i })))),
    },
    {
      key: 'crest.extras',
      glyph: 'sliders',
      build: () => el('div', { class: 'tl-crest-colours' }, [
        el('div', { class: 'tl-field' }, [
          el('span', { text: t('crest.stars') }),
          grid(Array.from({ length: CREST_MAX_STARS + 1 }, (_, i) =>
            option(spec().stars === i, i === 0 ? t('crest.none') : `${t('crest.stars')} ${i}`,
              () => variant({ stars: i }), () => set({ stars: i })))),
        ]),
        el('div', { class: 'tl-field' }, [
          el('span', { text: t('crest.initials') }),
          grid([false, true].map((v) =>
            option(spec().initials === v, v ? t('crest.initials') : t('crest.none'),
              () => variant({ initials: v }), () => set({ initials: v })))),
        ]),
      ]),
    },
    {
      key: 'crest.layers',
      glyph: 'layers',
      build: () => layersPanel({
        layers: () => spec().layers ?? [],
        commit: (layers: EmblemLayer[], live = false) => {
          host.world.crest = { ...spec(), layers };
          if (!live) audio.tick();
          paintPreview();
          host.onChange();
        },
        rebuild: () => {
          clear(panel);
          panel.append((TABS[active] as Tab).build());
        },
        primary: club.kitPrimary,
        secondary: club.kitSecondary,
      }, selection),
    },
  ];
  const LAYERS_TAB = TABS.length - 1;
  const selection: LayerSelection = { index: (host.world.crest?.layers?.length ?? 0) - 1 };

  // Drag on the badge to move the selected layer — the Layers tab only, and only while a
  // layer is selected. Pointer capture on the stage, which never re-renders, rather than on
  // the <svg>, which is replaced on every repaint.
  let dragging = false;
  const dragTo = (e: PointerEvent, live: boolean): void => {
    const layers = spec().layers ?? [];
    const layer = layers[selection.index];
    const svg = preview.querySelector('svg');
    if (!layer || !svg) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * 64 - 32;
    const y = ((e.clientY - r.top) / r.height) * 64 - 32;
    const next = layers.map((l, i) => (i === selection.index ? clampLayer({ ...l, x, y }) : l));
    host.world.crest = { ...spec(), layers: next };
    paintPreview();
    if (!live) {
      host.onChange();
      clear(panel);
      panel.append((TABS[active] as Tab).build());
    }
  };
  preview.addEventListener('pointerdown', (e) => {
    if (active !== LAYERS_TAB || !(spec().layers ?? [])[selection.index]) return;
    dragging = true;
    preview.setPointerCapture(e.pointerId);
    dragTo(e, true);
  });
  preview.addEventListener('pointermove', (e) => {
    if (dragging) dragTo(e, true);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!dragging) return;
    dragging = false;
    audio.tick();
    dragTo(e, false);
  };
  preview.addEventListener('pointerup', endDrag);
  preview.addEventListener('pointercancel', endDrag);

  /**
   * A whole identity in one tap.
   *
   * Six dimensions is a lot of decisions to ask for before the football starts, and a kid
   * who does not want to make any of them should still end up with a club that looks
   * deliberate. Cosmetic only, so `Math.random` rather than the save's seeded streams:
   * nothing here feeds the sim, and drawing from a world stream would make the badge you
   * chose depend on how many times you pressed this.
   */
  const surprise = button(t('intro.randomise'), () => {
    const pick = (): number => PALETTE[Math.floor(Math.random() * PALETTE.length)] as number;
    const a = pick();
    let b = pick();
    // Two colours nobody can tell apart is not a kit, and twelve swatches hand that out
    // about one time in twelve.
    while (b === a) b = pick();
    club.kitPrimary = a;
    club.kitSecondary = b;
    const roll = (n: number): number => Math.floor(Math.random() * n);
    host.world.crest = {
      shape: roll(CREST_SHAPES.length),
      pattern: roll(CREST_PATTERNS.length),
      border: roll(CREST_BORDERS.length),
      // Most badges carry nothing in the middle, here as in `derivedCrest`.
      emblem: roll(3) === 0 ? roll(CREST_EMBLEMS.length - 1) + 1 : 0,
      stars: roll(6) === 0 ? 1 : 0,
      initials: roll(4) !== 0,
    };
    audio.tick();
    redraw();
    host.onChange();
  }, {
    class: 'tl-btn tl-ghost tl-sm', icon: 'star',
    'aria-label': t('intro.randomise') || 'Surprise me',
    tip: t('crest.randomiseTip'),
  });

  function paintPreview(): void {
    clear(preview);
    preview.classList.toggle('draggable', active === LAYERS_TAB && !!(spec().layers ?? [])[selection.index]);
    preview.append(crestSvg({
      spec: spec(),
      primary: club.kitPrimary,
      secondary: club.kitSecondary,
      short: club.short,
      size: PREVIEW_SIZE,
      label: club.name,
    }));
  }

  function redraw(): void {
    paintPreview();

    clear(tabRow);
    TABS.forEach((tab, i) => {
      const on = i === active;
      const b = el('button', {
        class: `tl-crest-tab${on ? ' on' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': String(on),
        'aria-label': t(tab.key),
      }, [icon(tab.glyph, 17), el('span', { text: t(tab.key) })]);
      b.addEventListener('click', () => {
        active = i;
        audio.tick();
        redraw();
      });
      tabRow.append(b);
    });

    clear(panel);
    panel.append((TABS[active] as Tab).build());
  }

  redraw();
  const node = el('div', { class: 'tl-crest-editor' }, [
    el('div', { class: 'tl-crest-stage' }, [preview, surprise]),
    el('div', { class: 'tl-crest-controls' }, [tabRow, panel]),
  ]);
  return { node, repaint: redraw };
}

/** The badge a brand-new career starts on, before anybody has touched the editor. */
export { defaultCrest };
