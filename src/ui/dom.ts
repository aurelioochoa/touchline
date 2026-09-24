// Small DOM helpers. No framework: the match view is the product and everything else is a
// list of things, which does not need a runtime to render (design §12).

import { icon, type IconName } from './icons.js';

export type Attrs = Record<string, string | number | boolean | undefined | null>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k === 'style') node.setAttribute('style', String(v));
    else if (k.startsWith('data') || k.startsWith('aria') || k === 'role') node.setAttribute(k, String(v));
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

/**
 * A button. Always a real <button>, because a div with a click handler is not reachable by
 * Tab, not activated by Enter, and not announced as a control — and design §10 requires all
 * three.
 *
 * `opts.icon` puts a drawn glyph before the label. When the label is empty — which is what
 * `?blank=1` does to every string in the game — the button becomes icon-only and keeps its
 * accessible name from `aria-label`, so the wordless path still has operable controls
 * rather than eleven identical blank rectangles.
 */
export function button(
  label: string,
  onClick: () => void,
  attrs: Attrs & { icon?: IconName; tip?: string } = {},
): HTMLButtonElement {
  const { icon: name, tip, ...rest } = attrs;
  const cls = String(rest.class ?? 'tl-btn');
  const iconOnly = !!name && !label;
  const b = el('button', {
    ...rest,
    type: 'button',
    class: iconOnly && !cls.includes('tl-icon-only') ? `${cls} tl-icon-only` : cls,
  });
  if (name) b.append(icon(name, cls.includes('tl-sm') ? 16 : 18));
  if (label) b.append(el('span', { text: label }));
  b.addEventListener('click', onClick);

  // An icon-only control has nothing written on it, so the accessible name is also the only
  // thing that could be shown to a sighted player — and it already exists on every one of
  // them. Mirroring it here covers the pause button, the camera, the tactics drawer, the
  // match log, Back and the career delete in one place, instead of a per-call-site
  // afterthought that half of them would never get. `tip` is for the handful of LABELLED
  // controls whose label is not the whole story: Quick result, Continue, Surprise me.
  const name2 = tip ?? (iconOnly ? rest['aria-label'] : undefined);
  if (typeof name2 === 'string' && name2) b.setAttribute('data-tip', name2);
  return b;
}

/**
 * A 0..1 value as a bar. The bar is the primary channel and the number is secondary —
 * design §5b: an attribute grid is not a reading surface, and a bar is legible to someone
 * who cannot read at all.
 */
export function bar(value: number, opts: { label?: string; tone?: string; width?: string; valueText?: string } = {}): HTMLElement {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return el('div', {
    class: 'tl-bar',
    role: 'img',
    'aria-label': [opts.label, opts.valueText ?? `${Math.round(pct)}%`].filter(Boolean).join(': '),
    style: opts.width ? `width:${opts.width}` : undefined,
  }, [
    el('i', { class: `tl-bar-fill${opts.tone ? ' tone-' + opts.tone : ''}`, style: `width:${pct.toFixed(1)}%` }),
  ]);
}

/** The tone a 0..1 quantity should wear. One table, so nothing drifts between screens. */
export function toneOf(v: number): string {
  return v >= 0.72 ? 'good' : v >= 0.48 ? 'ok' : v >= 0.28 ? 'weak' : 'bad';
}

/**
 * A 1-20 attribute: bar plus numeral, on one baseline. Numerals are numeracy, not
 * literacy — this is the one place in the game where a number is the point.
 */
export function attrBar(value: number, label?: string): HTMLElement {
  const tone = value >= 15 ? 'good' : value >= 11 ? 'ok' : value >= 7 ? 'weak' : 'bad';
  return el('div', { class: `tl-attr${value >= 14 ? ' hi' : ''}` }, [
    bar((value - 1) / 19, { label: label ?? '', tone, valueText: `${value}/20` }),
    el('b', { text: String(value) }),
  ]);
}

/** A section heading in the broadcast-caption idiom. */
export function heading(text: string, glyph?: IconName): HTMLElement {
  return el('h2', { class: 'tl-h' }, [glyph ? icon(glyph, 14) : null, text ? el('span', { text }) : null]);
}

/** A card. The one surface in the system; nothing nests inside another one. */
export function card(children: (Node | null | undefined)[], attrs: Attrs = {}): HTMLElement {
  return el('div', { class: 'tl-card', ...attrs }, children);
}

/** A big number with its label under it. */
export function stat(label: string, value: string, opts: { hot?: boolean; sup?: string } = {}): HTMLElement {
  const b = el('b', {}, [value]);
  if (opts.sup) b.append(el('sup', { text: opts.sup }));
  return el('div', { class: `tl-stat${opts.hot ? ' hot' : ''}` }, [
    b,
    el('span', { text: label }),
  ]);
}

export function on<K extends keyof HTMLElementEventMap>(
  node: Element,
  type: K,
  handler: (e: HTMLElementEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): void {
  node.addEventListener(type, handler as EventListener, opts);
}

/** Money, short enough to fit in a table cell. */
export function money(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(Math.round(n));
}

/** Focus the first focusable thing in a container, for keyboard-only navigation. */
export function focusFirst(root: ParentNode): void {
  const target = root.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input, select, [tabindex]:not([tabindex="-1"])',
  );
  target?.focus();
}

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export interface SheetOptions {
  title?: string;
  icon?: IconName;
  body: (Node | null | undefined)[];
  foot?: (Node | null | undefined)[];
  /** Where to mount. Defaults to document.body; the match mounts inside its own root. */
  host?: HTMLElement | undefined;
  onClose?: (() => void) | undefined;
}

/**
 * A modal dialog — a bottom sheet on a phone, a centred panel above 560px, the same
 * markup either way.
 *
 * It traps focus and restores it on close. Without that a keyboard user tabs straight out
 * of the dialog into the screen behind it, which is still there and still operable, and
 * design §10 promises full operation with no pointer.
 */
export function sheet(opts: SheetOptions): { close: () => void; root: HTMLElement } {
  const host = opts.host ?? document.body;
  const previous = document.activeElement as HTMLElement | null;
  const overlay = el('div', { class: 'tl-overlay', role: 'dialog', 'aria-modal': 'true' });
  const panel = el('div', { class: 'tl-sheet' });

  const close = (): void => {
    overlay.remove();
    removeEventListener('keydown', onKey, true);
    opts.onClose?.();
    previous?.focus?.();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0] as HTMLElement;
    const last = items[items.length - 1] as HTMLElement;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (opts.title !== undefined) {
    const id = `tl-sheet-${Math.random().toString(36).slice(2, 8)}`;
    overlay.setAttribute('aria-labelledby', id);
    panel.append(el('div', { class: 'tl-sheet-head' }, [
      opts.icon ? icon(opts.icon, 18) : null,
      el('h2', { id, text: opts.title }),
      el('span', { class: 'tl-spacer' }),
      button('', close, { class: 'tl-btn tl-sm tl-ghost', icon: 'close', 'aria-label': 'Close' }),
    ]));
  }
  panel.append(el('div', { class: 'tl-sheet-body' }, opts.body));
  if (opts.foot?.length) panel.append(el('div', { class: 'tl-sheet-foot' }, opts.foot));

  overlay.append(panel);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  addEventListener('keydown', onKey, true);
  host.append(overlay);
  focusFirst(panel);
  return { close, root: panel };
}
