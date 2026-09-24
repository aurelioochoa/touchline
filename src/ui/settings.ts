// Settings.
//
// Everything here already existed in the save format and none of it had a control, which
// meant `sound`, `quality` and `reducedMotion` were fields nobody could reach. The rule
// this screen follows is the depth ladder's (design §5b): **every setting has a default
// the game will choose**, and the default is always the first option, so a kid who never
// opens this screen is not playing a worse game than one who does.
//
// `lang` is deliberately NOT here. `kidtopia:lang` belongs to the site and the game reads
// it read-only (design §11) — a language picker in the game would either write to the
// site's key or disagree with it, and both are worse than not having one.

import { t, type StringKey } from '../i18n.js';
import { hasLocalVoice } from './voice.js';
import { audio } from '../audio/audio.js';
import type { Settings } from '../save/format.js';
import { MATCH_SPEEDS } from './match.js';
import { button, card, el, heading, sheet } from './dom.js';
import { applyMotion } from './theme.js';
import type { Club, World } from '../sim/world/types.js';

export interface SettingsHost {
  settings: Settings;
  /** The badge editor edits the club, so this screen needs both. Null before one is chosen. */
  readonly world: World;
  readonly club: Club | null;
  persist(): void;
  refresh(): void;
  newCareer(): void;
  /** Back to the front door, saving on the way out. */
  openMenu(): void;
  go(route: string): void;
  toast(message: string, glyph?: 'check' | 'settings'): void;
}

const QUALITIES: Settings['quality'][] = ['auto', 'low', 'medium', 'high', 'ultra'];
const COMMENTARY: Settings['commentary'][] = ['off', 'text', 'voice'];
const CROWDS: Settings['crowd3d'][] = ['auto', 'full', 'half', 'off'];
const STYLES: Settings['playerStyle'][] = ['retro', 'realistic'];

/** One labelled row with its control on the right, or under it on a phone. */
function row(label: string, detail: string, control: HTMLElement): HTMLElement {
  const node = el('div', { class: 'tl-set-row' }, [
    el('div', { class: 'lab' }, [
      el('b', { text: label }),
      detail ? el('span', { text: detail }) : null,
    ]),
    control,
  ]);
  // A choice row of five buttons has no business being squeezed into the right-hand
  // column of a 390px screen, so anything with more than two options stacks.
  if (control.classList.contains('tl-choice') && control.childElementCount > 2) {
    node.classList.add('stack');
  }
  return node;
}

/** A segmented choice. The first option is always the game's own default. */
function choice<T>(
  options: readonly T[],
  current: T,
  labelOf: (v: T) => string,
  onPick: (v: T) => void,
): HTMLElement {
  const group = el('div', { class: 'tl-choice', role: 'group' });
  for (const option of options) {
    const b = button(labelOf(option), () => {
      onPick(option);
      for (const other of group.children) other.setAttribute('aria-pressed', 'false');
      b.setAttribute('aria-pressed', 'true');
      audio.tick();
    }, { class: 'tl-btn tl-sm', 'aria-pressed': option === current });
    group.append(b);
  }
  return group;
}

/** An on/off switch, as two buttons — a real toggle needs a label either way. */
function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  return choice([true, false], on, (v) => (v ? t('common.on') : t('common.off')), onChange);
}

/**
 * The rows that belong to the device, not the career: sound, speed, commentary, camera
 * (the graphics have their own rows, below). Shared by this screen and the main menu's
 * settings sheet, so the two can never offer different controls for the same thing.
 */
export function deviceSettingRows(s: Settings, persist: () => void): HTMLElement[] {
  return [
    row(
      t('settings.sound'),
      t('settings.soundHint'),
      toggle(s.sound, (v) => {
        s.sound = v;
        audio.setEnabled(v);
        if (v) audio.start();
        persist();
      }),
    ),
    row(
      t('settings.speed'),
      t('settings.speedHint'),
      choice(MATCH_SPEEDS, s.matchSpeed, (v) => `${v}×`, (v) => {
        s.matchSpeed = v;
        persist();
      }),
    ),
    // Spoken commentary is only offered when the browser has an OFFLINE voice: the
    // server-side ones send the text away to be synthesized, and this game does not make
    // network calls (see src/ui/voice.ts).
    row(
      t('settings.commentary'),
      hasLocalVoice() ? t('settings.commentaryHint') : t('settings.commentaryNoVoice'),
      choice(
        hasLocalVoice() ? COMMENTARY : COMMENTARY.filter((v) => v !== 'voice'),
        s.commentary,
        (v) => t(`settings.commentary.${v}` as StringKey),
        (v) => {
          s.commentary = v;
          persist();
        },
      ),
    ),
    row(
      t('settings.motion'),
      t('settings.motionHint'),
      choice(
        [null, true, false] as (boolean | null)[],
        s.reducedMotion,
        (v) => (v === null ? t('common.auto') : v ? t('settings.motionCalm') : t('settings.motionFull')),
        (v) => {
          s.reducedMotion = v;
          // The stylesheet has to hear about it too, or this control only ever reached the
          // match camera and left every card entrance and every panel animating.
          applyMotion(v);
          persist();
        },
      ),
    ),
  ];
}

/**
 * The graphics rows: how good the match looks against how fast it runs. The quality tier,
 * the modelled crowd, and the fire and light in the stands. Shared, like the device rows,
 * between this screen and the main menu's sheet.
 */
export function graphicsSettingRows(s: Settings, persist: () => void): HTMLElement[] {
  return [
    row(
      t('settings.quality'),
      t('settings.qualityHint'),
      choice(QUALITIES, s.quality, (v) => t(`settings.quality.${v}` as StringKey), (v) => {
        s.quality = v;
        persist();
      }),
    ),
    row(
      t('settings.playerStyle'),
      t('settings.playerStyleHint'),
      choice(STYLES, s.playerStyle, (v) => t(`settings.playerStyle.${v}` as StringKey), (v) => {
        s.playerStyle = v;
        persist();
      }),
    ),
    row(
      t('settings.crowd3d'),
      t('settings.crowd3dHint'),
      choice(CROWDS, s.crowd3d, (v) => t(`settings.crowd3d.${v}` as StringKey), (v) => {
        s.crowd3d = v;
        persist();
      }),
    ),
    row(
      t('settings.stadiumFx'),
      t('settings.stadiumFxHint'),
      toggle(s.stadiumFx, (v) => {
        s.stadiumFx = v;
        persist();
      }),
    ),
  ];
}

export function renderSettings(host: SettingsHost, root: HTMLElement): void {
  const s = host.settings;

  root.append(card([
    heading(t('nav.settings'), 'settings'),
    ...deviceSettingRows(s, () => host.persist()),
    el('p', { class: 'tl-studio-note', style: 'margin:14px 0 0', text: t('menu.settingsHint') }),
  ]));

  root.append(card([
    heading(t('settings.graphics'), 'stadium'),
    ...graphicsSettingRows(s, () => host.persist()),
  ]));

  // The badge used to be edited here. It lives in the club studio now, with the kit, the
  // ball and the ground, and this row is the signpost for anyone who remembers where it was.
  if (host.club) {
    root.append(card([
      heading(t('studio.title'), 'palette'),
      row(
        t('settings.studioLink'),
        t('settings.studioHint'),
        button(t('settings.openStudio'), () => host.go('studio'), { class: 'tl-btn tl-sm', icon: 'palette' }),
      ),
    ]));
  }

  root.append(card([
    heading(t('menu.slots'), 'club'),
    row(
      t('menu.back'),
      t('menu.tagline'),
      button(t('menu.back'), () => host.openMenu(), { class: 'tl-btn tl-sm', icon: 'back' }),
    ),
  ]));

  root.append(card([
    heading(t('settings.help'), 'whistle'),
    row(
      t('settings.replayTour'),
      t('settings.replayTourHint'),
      button(t('settings.replayTourGo'), () => {
        s.onboarded = false;
        host.persist();
        host.toast(t('settings.replayTourDone'), 'check');
        host.refresh();
      }, { class: 'tl-btn tl-sm', icon: 'play' }),
    ),
  ]));

  // The one destructive control in the game, and the only one that asks twice. It is at
  // the bottom, on its own, and its confirm names what is lost rather than saying
  // "are you sure" — design §8's no-dead-ends rule cuts both ways.
  root.append(card([
    heading(t('settings.career'), 'star'),
    row(
      t('settings.newCareer'),
      t('settings.newCareerHint'),
      button(t('settings.newCareer'), () => {
        const dialog = sheet({
          title: t('settings.newCareer'),
          icon: 'star',
          body: [el('p', { class: 'tl-lede', style: 'margin:0', text: t('settings.confirmNew') })],
          foot: [
            button(t('common.cancel'), () => dialog.close(), { class: 'tl-btn tl-ghost', style: 'flex:1' }),
            button(t('settings.newCareerGo'), () => host.newCareer(), { class: 'tl-btn tl-primary', style: 'flex:1' }),
          ],
        });
      }, { class: 'tl-btn tl-sm' }),
    ),
  ]));
}
