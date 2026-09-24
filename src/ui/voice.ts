// Spoken commentary, and the one thing that had to be checked before writing it.
//
// Design §12's invariant is "no external network calls of any kind". `speechSynthesis`
// looks like it satisfies that — it is a browser API and this game ships no audio file —
// but in Chrome many of the voices it offers are SERVER-SIDE: the utterance text is sent
// to Google to be synthesized and the audio comes back. For a child-directed product that
// is a real data flow leaving the device, not a technicality, and it would be invisible
// from the code that calls `speak()`.
//
// So this module will only ever use a voice whose `localService` is true. If the browser
// has no offline voice for the player's language, spoken commentary is simply not offered
// and the setting stays on text. That is a smaller feature than "read it aloud" and it is
// the only version of it this game can honestly ship.
//
// Everything else here is about not being annoying: one line at a time, nothing queued,
// and silence the moment the match is paused or left.

import { detectLang } from '../i18n.js';

type Synth = typeof globalThis extends { speechSynthesis: infer S } ? S : never;

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null;
  const s = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  return s ?? null;
}

/** Offline voices only, for the given language, best match first. */
function localVoicesFor(lang: string): SpeechSynthesisVoice[] {
  const s = synth();
  if (!s) return [];
  let all: SpeechSynthesisVoice[] = [];
  try {
    all = s.getVoices();
  } catch {
    return [];
  }
  return all
    .filter((v) => v.localService)
    .filter((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
}

/**
 * Whether spoken commentary can be offered at all.
 *
 * The settings screen asks this before showing the option, because an option that does
 * nothing is worse than an absent one — the player turns it on, hears nothing, and
 * concludes the sound is broken.
 */
export function hasLocalVoice(): boolean {
  return localVoicesFor(detectLang()).length > 0;
}

/**
 * The voice list arrives asynchronously in some browsers, so anything that asks
 * `hasLocalVoice()` at startup gets "no" whether or not that is true. This resolves once
 * the list is populated, or immediately if it already is.
 */
export function voicesReady(): Promise<void> {
  const s = synth();
  if (!s) return Promise.resolve();
  if (s.getVoices().length > 0) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      resolve();
    };
    s.addEventListener('voiceschanged', finish, { once: true });
    // Some browsers never fire it. Do not hang the settings screen on a maybe.
    setTimeout(finish, 1200);
  });
}

export class Voice {
  #enabled = false;
  #voice: SpeechSynthesisVoice | null = null;

  setEnabled(on: boolean): void {
    this.#enabled = on;
    if (!on) this.stop();
    else this.#voice = localVoicesFor(detectLang())[0] ?? null;
  }

  get available(): boolean {
    return hasLocalVoice();
  }

  /**
   * Say one line, cancelling whatever was being said.
   *
   * Cancel-then-speak, never queue. A queue is how a 40x fast-forward ends with the
   * commentator four minutes behind the match, describing a goal that was three goals ago.
   */
  say(text: string): void {
    const s = synth();
    if (!this.#enabled || !s || !text) return;
    if (!this.#voice) this.#voice = localVoicesFor(detectLang())[0] ?? null;
    if (!this.#voice) return;
    try {
      s.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = this.#voice;
      u.lang = this.#voice.lang;
      u.rate = 1.08;
      u.pitch = 1.02;
      u.volume = 0.9;
      s.speak(u);
    } catch {
      // A browser that throws here is a browser without usable speech. Stay quiet.
    }
  }

  stop(): void {
    try {
      synth()?.cancel();
    } catch {
      // Nothing to cancel.
    }
  }
}

export type { Synth };
