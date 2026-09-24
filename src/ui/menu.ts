// The front door.
//
// Before this the game booted straight into whatever career was in storage, which is fine
// with one save and impossible with three. What the menu has to do is small — offer to
// carry on, list what exists, and let a career be started or thrown away — and the only
// part with any weight in it is the deleting, because a career is many hours and there is
// no undo.
//
// It draws from `listSlots()`, which reads each save's `summary` and stops. Unpacking
// three worlds to label three buttons would be about eight thousand players.

import { t } from '../i18n.js';
import { listSlots, type SlotInfo } from '../save/api.js';
import { button, clear, el, heading, sheet } from './dom.js';
import { crestSvg, defaultCrest } from './crest.js';
import { icon } from './icons.js';
import { deviceSettingRows, graphicsSettingRows } from './settings.js';
import { unpackCrest, type Settings } from '../save/format.js';

export interface MenuActions {
  /** Open a slot that already holds a career. */
  onPlay(slot: number): void;
  /** Start fresh in a slot. The slot is wiped first when it held something. */
  onNew(slot: number): void;
  /** Throw a career away, already confirmed. */
  onDelete(slot: number): void;
  /**
   * The device's settings, edited in place, and what to call after each change. Settings
   * belong on the front door too: a kid who wants the sound off should not have to start a
   * career to find the switch.
   */
  settings: Settings;
  onSettingsChange(): void;
}

/** Draw the menu into `root`. Re-entrant: call it again to refresh after a delete. */
export function renderMenu(root: HTMLElement, actions: MenuActions): void {
  clear(root);
  const slots = listSlots();
  const newest = pickNewest(slots);

  // A title screen, not a form: a wordmark with weight, a ribbon under it, and the floodlight
  // beams behind both. Everything decorative here is aria-hidden and takes no focus, so the
  // Tab order is still Continue (when there is one) and then the slots, as it always was.
  root.append(el('div', { class: 'tl-menu-hero' }, [
    el('div', { class: 'tl-menu-emblem', 'aria-hidden': 'true' }, [football()]),
    el('h1', { class: 'tl-menu-title', text: t('menu.title') }),
    el('p', { class: 'tl-menu-tagline', text: t('menu.tagline') }),
  ]));

  if (newest !== null) {
    const info = slots.find((s) => s.index === newest);
    const go = button(t('menu.continue'), () => actions.onPlay(newest), {
      class: 'tl-btn tl-primary tl-block tl-menu-continue', icon: 'play',
    });
    // The club it continues, so the biggest button on the screen says whose career it is.
    const badge = info ? slotBadge(info, 40) : null;
    if (badge) {
      // Decoration here: the club's name is written on the button beside it.
      badge.setAttribute('aria-hidden', 'true');
      go.prepend(badge);
    }
    if (info?.summary?.clubName) {
      go.append(el('small', { class: 'tl-menu-continue-club', text: info.summary.clubName }));
    }
    root.append(go);
  }

  const list = el('div', { class: 'tl-slots' });
  for (const info of slots) list.append(slotRow(info, actions, root));
  root.append(el('section', { class: 'tl-menu-careers' }, [
    el('h2', { class: 'tl-menu-section' }, [icon('club', 16), el('span', { text: t('menu.slots') })]),
    list,
  ]));

  // Last on the page and quiet: a ghost button with the gear, so it is findable without
  // competing with Continue for the eye.
  root.append(el('div', { class: 'tl-menu-foot' }, [
    button(t('nav.settings'), () => openSettings(actions), { class: 'tl-btn tl-ghost tl-menu-settings', icon: 'settings' }),
  ]));
}

function openSettings(actions: MenuActions): void {
  sheet({
    title: t('nav.settings'),
    icon: 'settings',
    body: [
      el('p', { class: 'tl-studio-note', style: 'margin:0 0 6px', text: t('menu.settingsHint') }),
      ...deviceSettingRows(actions.settings, () => actions.onSettingsChange()),
      ...graphicsSettingRows(actions.settings, () => actions.onSettingsChange()),
    ],
  });
}

/**
 * A proper football for the emblem: a white ball, a black pentagon in the middle and five
 * patches cut off by its edge. The icon set's 'ball' is a line drawing at 20px, and scaled
 * up to a logo it read as a ring with a hole in it.
 */
function football(): SVGSVGElement {
  const pent = (cx: number, cy: number, r: number, rot: number): string => {
    const pts: string[] = [];
    for (let i = 0; i < 5; i++) {
      const a = rot + (i * 2 * Math.PI) / 5;
      pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
    }
    return pts.join(' ');
  };
  const up = -Math.PI / 2;
  let patches = `<polygon points="${pent(32, 32, 9, up)}"/>`;
  const seams: string[] = [];
  for (let i = 0; i < 5; i++) {
    const a = up + (i * 2 * Math.PI) / 5;
    const x = 32 + 26 * Math.cos(a);
    const y = 32 + 26 * Math.sin(a);
    patches += `<polygon points="${pent(x, y, 9, a + Math.PI / 5)}"/>`;
    // Seam from the centre pentagon's corner out to the edge patch.
    seams.push(`M${(32 + 9 * Math.cos(a)).toFixed(2)} ${(32 + 9 * Math.sin(a)).toFixed(2)}`
      + `L${(32 + 17.5 * Math.cos(a)).toFixed(2)} ${(32 + 17.5 * Math.sin(a)).toFixed(2)}`);
  }
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 64');
  svg.setAttribute('class', 'tl-menu-ball');
  svg.setAttribute('aria-hidden', 'true');
  // Authored here from numbers; nothing a player or a network supplied goes into it.
  svg.innerHTML = `
    <defs><clipPath id="tl-ball-clip"><circle cx="32" cy="32" r="27"/></clipPath></defs>
    <circle cx="32" cy="32" r="27" fill="#fff"/>
    <g clip-path="url(#tl-ball-clip)" fill="#10261a">${patches}</g>
    <path d="${seams.join('')}" stroke="#10261a" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="32" cy="32" r="27" fill="none" stroke="#10261a" stroke-width="2.4"/>
    <ellipse cx="23" cy="20" rx="9" ry="5" fill="#fff" opacity="0.5" transform="rotate(-30 23 20)"/>`;
  return svg;
}

function pickNewest(slots: readonly SlotInfo[]): number | null {
  let best: SlotInfo | null = null;
  for (const info of slots) {
    if (!info.summary || info.unreadable) continue;
    if (!best || info.savedAt > best.savedAt) best = info;
  }
  return best ? best.index : null;
}

function slotRow(info: SlotInfo, actions: MenuActions, root: HTMLElement): HTMLElement {
  const label = t('menu.slot', { n: info.index + 1 });
  const filled = !!info.summary && !info.unreadable;

  const title = el('b', { text: filled ? (info.summary?.clubName ?? label) : label });
  const detail = el('span', {
    class: 'meta',
    text: info.unreadable
      ? t('menu.unreadable')
      : filled
        ? t('menu.slotLine', {
            season: info.summary?.season ?? 1,
            // The raw number, never a formatted ordinal: "3rd" is English, and dropping it
            // into the Spanish sentence would put an English ordinal in a Spanish line.
            // Each language's own string decides how a position is written.
            position: info.summary?.position ?? 0,
            tier: (info.summary?.tier ?? 0) + 1,
          })
        : t('menu.empty'),
  });

  // The picture at the top of the card: the club's badge, or an empty kit-hanger ring with a
  // plus in it. The plain slot number survives as a corner tag on every card.
  const art = el('span', { class: 'tl-slot-art' }, [
    slotBadge(info, 64) ?? el('span', { class: 'tl-slot-plus', 'aria-hidden': 'true' },
      [icon(info.unreadable ? 'close' : 'star', 26)]),
  ]);

  const end = el('span', { class: 'end' });
  if (filled) {
    end.append(button(t('menu.load'), () => actions.onPlay(info.index), {
      class: 'tl-btn tl-primary tl-slot-go', icon: 'play',
    }));
    // After Play in the DOM (so Tab meets Play first) and pinned to the corner by CSS.
    end.append(button('', () => confirmDelete(info, actions, root), {
      class: 'tl-btn tl-sm tl-ghost tl-icon-only tl-slot-delete', icon: 'close',
      'aria-label': `${t('menu.delete')} — ${info.summary?.clubName ?? label}`,
    }));
  } else if (!info.unreadable) {
    end.append(button(t('menu.newHere'), () => actions.onNew(info.index), {
      class: 'tl-btn tl-slot-go', icon: 'star',
    }));
  }

  return el('div', { class: `tl-slot${filled ? ' filled' : ''}${info.unreadable ? ' unreadable' : ''}` }, [
    el('span', { class: 'rk', 'aria-hidden': 'true', text: String(info.index + 1) }),
    art,
    el('span', { class: 'who' }, [title, detail]),
    end,
  ]);
}

/**
 * The career's own badge on its slot, in place of the slot number.
 *
 * Drawn from the three fields the summary carries, so the front door costs no more to render
 * than it did — `listSlots()` still reads the summary and stops, and unpacking three worlds
 * to label three buttons would be about eight thousand players.
 *
 * Null for a save written before the summary carried a badge, and for an empty slot: both
 * keep the plain number, which is what they have always had.
 */
function slotBadge(info: SlotInfo, size: number): Element | null {
  const s = info.summary;
  if (!s || info.unreadable || s.kitPrimary === undefined || s.kitSecondary === undefined) return null;
  // The same unpacker the save uses, so a badge with emblem layers shows them here too.
  const spec = unpackCrest(s.crest) ?? defaultCrest();
  return crestSvg({
    spec,
    primary: s.kitPrimary,
    secondary: s.kitSecondary,
    size,
    label: s.clubName,
  });
}

/**
 * Deleting a career is the one irreversible thing in the game, so it asks.
 *
 * Design §8 says nothing compounds irreversibly and there are no dead ends; this is the
 * exception the player creates on purpose, and the confirm is what makes it on purpose.
 * The destructive button is NOT the primary one — a kid tapping through should land on
 * "keep it".
 */
function confirmDelete(info: SlotInfo, actions: MenuActions, root: HTMLElement): void {
  const dialog = sheet({
    title: t('menu.deleteTitle'),
    icon: 'close',
    host: document.body,
    body: [
      el('div', { class: 'tl-empty', style: 'gap:10px' }, [
        icon('club', 26),
        el('b', { text: info.summary?.clubName ?? t('menu.slot', { n: info.index + 1 }) }),
      ]),
      el('p', { class: 'tl-lede', style: 'margin:12px 0 0', text: t('menu.deleteBody') }),
    ],
    foot: [
      button(t('menu.deleteConfirm'), () => {
        actions.onDelete(info.index);
        dialog.close();
        renderMenu(root, actions);
      }, { class: 'tl-btn tl-ghost tl-danger', icon: 'close', style: 'flex:1' }),
      button(t('menu.cancel'), () => dialog.close(), {
        class: 'tl-btn tl-primary', icon: 'check', style: 'flex:1',
      }),
    ],
  });
}
