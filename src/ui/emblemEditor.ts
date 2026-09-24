// The Layers tab of the badge editor: build an emblem out of pieces.
//
// The shape of it is the console emblem editor every kid who has seen one already knows —
// a stack of layers, one selected at a time, and for the selected one a shape, a colour,
// and handles for size, turn and position. Three things it keeps:
//
// - **Sliders never lose the thumb.** Moving a slider repaints the BADGE and nothing else;
//   the panel is only rebuilt when the selection or the stack changes. Rebuilding the panel
//   on every input event would pull the slider out from under a dragging finger.
// - **Drag on the badge.** With a layer selected, pressing and dragging on the preview moves
//   it there. The sliders are the same edit for keyboard and switch users, so nothing here
//   needs a pointer.
// - **It survives `?blank=1`.** Every control is an icon or a picture as well as a word.

import { t } from '../i18n.js';
import { audio } from '../audio/audio.js';
import type { EmblemLayer } from '../sim/world/types.js';
import { button, el } from './dom.js';
import { GLYPHS, LAYER_COLOURS, MAX_LAYERS, clampLayer, glyphSvg, layerColour, newLayer } from './emblems.js';
import { kitCss } from './theme.js';

export interface LayerHost {
  layers(): EmblemLayer[];
  /** Write a new stack. `live` means mid-drag: repaint the badge, skip the click sound. */
  commit(layers: EmblemLayer[], live?: boolean): void;
  /** Rebuild this panel — after the selection or the stack changes. */
  rebuild(): void;
  primary: number;
  secondary: number;
}

/** Which layer is selected, per editor instance, surviving panel rebuilds. */
export interface LayerSelection {
  index: number;
}

export function layersPanel(host: LayerHost, sel: LayerSelection): HTMLElement {
  const layers = host.layers();
  if (sel.index >= layers.length) sel.index = layers.length - 1;
  const current = layers[sel.index];

  const update = (patch: Partial<EmblemLayer>, live = false): void => {
    const next = host.layers().map((l, i) => (i === sel.index ? clampLayer({ ...l, ...patch }) : l));
    host.commit(next, live);
  };

  // ---- the stack ----------------------------------------------------------------------
  const stack = el('div', { class: 'tl-layer-stack', role: 'listbox', 'aria-label': t('crest.layers') });
  // Top of the stack first, which is how every layer panel lists them.
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i] as EmblemLayer;
    const on = i === sel.index;
    const chip = el('button', {
      class: 'tl-layer-chip',
      type: 'button',
      role: 'option',
      'aria-selected': String(on),
      'aria-label': t('emblem.layer', { n: i + 1 }),
    }, [
      glyphSvg(l.glyph, kitCss(layerColour(l.colour, host.primary, host.secondary)), 26),
      el('span', { text: String(i + 1) }),
    ]);
    chip.addEventListener('click', () => {
      sel.index = i;
      audio.tick();
      host.rebuild();
    });
    stack.append(chip);
  }

  const full = layers.length >= MAX_LAYERS;
  const add = button(t('emblem.add'), () => {
    if (host.layers().length >= MAX_LAYERS) return;
    const next = [...host.layers(), newLayer()];
    sel.index = next.length - 1;
    host.commit(next);
    host.rebuild();
  }, { class: 'tl-btn tl-sm tl-primary', icon: 'plus', disabled: full });

  const tools = el('div', { class: 'tl-layer-tools' }, [add]);
  if (current) {
    const move = (by: number): void => {
      const list = [...host.layers()];
      const to = sel.index + by;
      if (to < 0 || to >= list.length) return;
      const [item] = list.splice(sel.index, 1);
      if (item) list.splice(to, 0, item);
      sel.index = to;
      host.commit(list);
      host.rebuild();
    };
    tools.append(
      button(t('emblem.duplicate'), () => {
        const list = [...host.layers()];
        if (list.length >= MAX_LAYERS) return;
        list.splice(sel.index + 1, 0, clampLayer({ ...current, x: current.x + 4, y: current.y + 4 }));
        sel.index += 1;
        host.commit(list);
        host.rebuild();
      }, { class: 'tl-btn tl-sm', icon: 'copy', disabled: full }),
      button(t('emblem.up'), () => move(1), { class: 'tl-btn tl-sm', icon: 'up', disabled: sel.index >= layers.length - 1 }),
      button(t('emblem.down'), () => move(-1), { class: 'tl-btn tl-sm', icon: 'down', disabled: sel.index <= 0 }),
      button(t('emblem.delete'), () => {
        const list = host.layers().filter((_, i) => i !== sel.index);
        sel.index = Math.min(sel.index, list.length - 1);
        host.commit(list);
        host.rebuild();
      }, { class: 'tl-btn tl-sm tl-ghost', icon: 'trash' }),
    );
  }

  const top = el('div', { class: 'tl-layer-top' }, [stack, tools]);
  if (full) top.append(el('p', { class: 'tl-studio-note', text: t('emblem.full', { n: MAX_LAYERS }) }));

  if (!current) {
    return el('div', { class: 'tl-layers' }, [
      top,
      el('p', { class: 'tl-layer-empty', text: t('emblem.empty') }),
    ]);
  }

  // ---- the selected layer --------------------------------------------------------------
  const colour = kitCss(layerColour(current.colour, host.primary, host.secondary));
  const shapes = el('div', { class: 'tl-glyph-grid', role: 'group', 'aria-label': t('emblem.shape') });
  GLYPHS.forEach((_, i) => {
    const on = i === current.glyph;
    const b = el('button', {
      class: 'tl-glyph',
      type: 'button',
      'aria-pressed': String(on),
      'aria-label': `${t('emblem.shape')} ${i + 1}`,
    }, [glyphSvg(i, on ? colour : 'currentColor', 26)]);
    b.addEventListener('click', () => {
      update({ glyph: i });
      host.rebuild();
    });
    shapes.append(b);
  });

  const colours = el('div', { class: 'tl-swatches', role: 'group', 'aria-label': t('emblem.colour') });
  LAYER_COLOURS.forEach((_, i) => {
    const hex = layerColour(i, host.primary, host.secondary);
    const on = i === current.colour;
    const b = el('button', {
      class: `tl-swatch${on ? ' on' : ''}${i < 2 ? ' club' : ''}`,
      type: 'button',
      style: `background:${kitCss(hex)}`,
      'aria-pressed': String(on),
      'aria-label': i === 0 ? t('kit.source.primary') : i === 1 ? t('kit.source.secondary') : `${t('emblem.colour')} ${i + 1}`,
    });
    b.addEventListener('click', () => {
      update({ colour: i });
      host.rebuild();
    });
    colours.append(b);
  });

  const slider = (label: string, min: number, max: number, value: number, key: 'size' | 'rot' | 'x' | 'y'): HTMLElement => {
    const out = el('output', { text: String(value) });
    const input = el('input', {
      class: 'tl-range',
      type: 'range', min, max, step: 1, value,
      'aria-label': label,
      style: `--pct:${Math.round(((value - min) / (max - min)) * 100)}%`,
    }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const v = Number(input.value);
      out.textContent = String(v);
      input.style.setProperty('--pct', `${Math.round(((v - min) / (max - min)) * 100)}%`);
      update({ [key]: v } as Partial<EmblemLayer>, true);
    });
    input.addEventListener('change', () => audio.tick());
    return el('div', { class: 'tl-slider' }, [el('label', {}, [el('span', { text: label }), out]), input]);
  };

  const flip = button(t('emblem.flip'), () => {
    update({ flip: !current.flip });
    host.rebuild();
  }, { class: 'tl-btn tl-sm', icon: 'flip', 'aria-pressed': current.flip });

  return el('div', { class: 'tl-layers' }, [
    top,
    el('div', { class: 'tl-layer-edit' }, [
      el('div', { class: 'tl-field' }, [el('span', { text: t('emblem.shape') }), shapes]),
      el('div', { class: 'tl-layer-controls' }, [
        el('div', { class: 'tl-field' }, [el('span', { text: t('emblem.colour') }), colours]),
        slider(t('emblem.size'), 4, 72, current.size, 'size'),
        slider(t('emblem.turn'), 0, 359, current.rot, 'rot'),
        slider(t('emblem.across'), -32, 32, current.x, 'x'),
        slider(t('emblem.updown'), -32, 32, current.y, 'y'),
        el('div', { class: 'tl-layer-flip' }, [flip]),
        el('p', { class: 'tl-studio-note', text: t('emblem.drag') }),
      ]),
    ]),
  ]);
}
