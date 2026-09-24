// The barra's band: bass drums, a snare, a cymbal, trumpets — and the whistling.
//
// A South American end does not chant over silence; it sings over a band that never
// stops. The bombos carry the beat, the redoblante fills between them, a platillo marks
// the bar, and every so often the trumpets take a phrase and the whole end comes in under
// them. All of it synthesized: a bombo is a sine dropping from 110Hz to 48 with a click on
// the front, a snare is band-passed noise over a triangle, a trumpet is two detuned saws
// through a filter that opens as the note speaks (design §9 — no samples).
//
// It is heard from the pitch, forty to a hundred metres away, so everything goes through
// a low-pass and most of it through the stadium's reverb: the band is IN the ground, not
// in your headphones.
//
// The tempo is shared with the picture (render/ultras.ts), so the end jumps to the drums
// you hear.

/** The beat of the barra, beats per minute. */
export const BARRA_BPM = 132;

export type DrumHit = 'bombo' | 'accent' | 'snare' | 'roll' | 'cymbal';

/**
 * What the band plays on one eighth-note step of a two-bar phrase (sixteen steps). Pure,
 * so the rhythm is testable: the bombo has to land on the downbeat or the end jumps
 * against it. `frenzy` is after a goal, when the drums double up.
 */
export function drumStep(step: number, frenzy: boolean): DrumHit[] {
  const s = ((step % 16) + 16) % 16;
  const hits: DrumHit[] = [];
  // The murga figure: BOM . . bom . bom . . | BOM . . bom . bom bom .
  if (s === 0 || s === 8) hits.push('accent');
  else if (s === 3 || s === 5 || s === 11 || s === 13 || s === 14) hits.push('bombo');
  else if (frenzy && s % 2 === 0) hits.push('bombo');
  if (s === 2 || s === 6 || s === 10) hits.push('snare');
  if (s === 15 || (frenzy && s === 7)) hits.push('roll');
  if (s === 0 || (frenzy && s === 8)) hits.push('cymbal');
  return hits;
}

/**
 * The trumpet phrase, as (semitones above D4, length in beats). Original, and simple on
 * purpose: a rising call and an answer, the shape every terrace tune has.
 */
export const RIFF: readonly (readonly [number, number])[] = [
  [0, 0.5], [4, 0.5], [7, 0.5], [7, 0.5], [9, 1], [7, 0.5], [4, 0.5],
  [5, 0.5], [5, 0.5], [4, 0.5], [2, 0.5], [0, 2],
];
/** A goal gets a fanfare instead: up the arpeggio and hold the top. */
export const FANFARE: readonly (readonly [number, number])[] = [
  [0, 0.5], [4, 0.5], [7, 0.5], [12, 1.5], [7, 0.5], [12, 4.5],
];
const D4 = 293.66;

export class BarraSound {
  readonly #ctx: AudioContext;
  readonly #white: AudioBuffer;
  /** The band's bus: far away, so low-passed, and mostly reverb. */
  readonly #bus: GainNode;
  readonly #whistleBus: GainNode;
  #timer: number | null = null;
  #step = 0;
  /** The last time the match told us it was running, in context time. */
  #alive = -1;
  #excite = 0;
  #frenzyUntil = -1;
  #nextRiff = 0;
  #nextWhistle = 0;

  constructor(ctx: AudioContext, master: AudioNode, send: AudioNode | null, white: AudioBuffer) {
    this.#ctx = ctx;
    this.#white = white;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(lp);
    // The home end is behind the left-hand goal from the broadcast camera.
    const pan = typeof ctx.createStereoPanner === 'function' ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = -0.35;
      lp.connect(pan);
      pan.connect(master);
      if (send) pan.connect(send);
    } else {
      lp.connect(master);
      if (send) lp.connect(send);
    }
    this.#bus = bus;
    const wb = ctx.createGain();
    wb.gain.value = 1;
    wb.connect(master);
    if (send) wb.connect(send);
    this.#whistleBus = wb;
    this.#nextRiff = ctx.currentTime + 14;
    this.#nextWhistle = ctx.currentTime + 4;
  }

  /**
   * Every frame of a running match. `excite` is the crowd's 0..1. When the calls stop —
   * the match is paused, or over — the band stops too, within a beat.
   */
  update(excite: number): void {
    const ctx = this.#ctx;
    const now = ctx.currentTime;
    this.#alive = now;
    this.#excite = excite;
    // The barra never goes quiet, it only gets louder.
    this.#bus.gain.setTargetAtTime(0.32 + excite * 0.45, now, 0.4);
    if (this.#timer === null) {
      const eighth = 60 / BARRA_BPM / 2;
      this.#timer = setInterval(() => this.#tick(), eighth * 1000) as unknown as number;
    }
    if (now > this.#nextRiff && excite > 0.2) {
      this.#phrase(RIFF, now + 0.05, 0.9);
      this.#nextRiff = now + 18 + Math.random() * 20;
    }
    // Two-finger whistles from all round the ground: a few a minute when it is quiet,
    // a steady shrill thread when it is not.
    if (now > this.#nextWhistle) {
      this.whistle(0.4 + excite * 0.6);
      this.#nextWhistle = now + (6 + Math.random() * 10) / (0.4 + excite * 2.2);
    }
  }

  /** A home goal: a fanfare, the drums doubling up, and the hiss of the flares. */
  goal(): void {
    const now = this.#ctx.currentTime;
    this.#frenzyUntil = now + 25;
    this.#phrase(FANFARE, now + 0.6, 1.2);
    this.#nextRiff = now + 9;
    this.#flares(26);
  }

  #tick(): void {
    const ctx = this.#ctx;
    const now = ctx.currentTime;
    if (now - this.#alive > 0.5) return; // paused: the band waits
    const frenzy = now < this.#frenzyUntil;
    for (const hit of drumStep(this.#step, frenzy)) this.#drum(hit, now + 0.01);
    this.#step = (this.#step + 1) % 16;
  }

  #drum(hit: DrumHit, at: number): void {
    const ctx = this.#ctx;
    const bus = this.#bus;
    if (hit === 'bombo' || hit === 'accent') {
      const loud = hit === 'accent' ? 1 : 0.7;
      // Several drums a hair apart: a section, not a drum machine.
      for (let k = 0; k < 3; k++) {
        const t = at + Math.random() * 0.018;
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(105 + k * 9, t);
        o.frequency.exponentialRampToValueAtTime(46 + k * 4, t + 0.14);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.32 * loud, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
        o.connect(g);
        g.connect(bus);
        o.start(t);
        o.stop(t + 0.45);
      }
      // The beater's slap on the head.
      this.#noiseHit(at, 0.03, 900, 'lowpass', 0.12 * loud, bus);
    } else if (hit === 'snare' || hit === 'roll') {
      const n = hit === 'roll' ? 4 : 1;
      const gap = 60 / BARRA_BPM / 8;
      for (let i = 0; i < n; i++) {
        const t = at + i * gap;
        this.#noiseHit(t, 0.12, 1900, 'bandpass', 0.16 * (hit === 'roll' ? 0.6 + i * 0.12 : 1), bus);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 190;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.06, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        o.connect(g);
        g.connect(bus);
        o.start(t);
        o.stop(t + 0.1);
      }
    } else {
      this.#noiseHit(at, 0.5, 6500, 'highpass', 0.07, bus);
    }
  }

  #noiseHit(at: number, dur: number, freq: number, type: BiquadFilterType, peak: number, out: AudioNode): void {
    const ctx = this.#ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.#white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = type === 'bandpass' ? 0.9 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(at, Math.random() * 2);
    src.stop(at + dur + 0.02);
  }

  /** Three trumpets on a phrase, one a touch sharp — a terrace band, not an orchestra. */
  #phrase(notes: readonly (readonly [number, number])[], at: number, level: number): void {
    const ctx = this.#ctx;
    const beat = 60 / BARRA_BPM;
    let t = at;
    for (const [semi, beats] of notes) {
      const dur = beats * beat;
      const f = D4 * Math.pow(2, semi / 12);
      for (let p = 0; p < 3; p++) {
        const g = ctx.createGain();
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.Q.value = 3;
        // The filter opening is the "blat" of a brass attack.
        lp.frequency.setValueAtTime(700, t);
        lp.frequency.exponentialRampToValueAtTime(3200, t + 0.06);
        lp.frequency.exponentialRampToValueAtTime(1900, t + dur);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 * level, t + 0.03);
        g.gain.setValueAtTime(0.045 * level, t + dur * 0.8);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98);
        lp.connect(g);
        g.connect(this.#bus);
        const vib = ctx.createOscillator();
        vib.frequency.value = 5.5;
        const depth = ctx.createGain();
        depth.gain.value = f * 0.006;
        vib.connect(depth);
        for (const detune of [-6, 7]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f * (p === 2 ? 1.004 : 1);
          o.detune.value = detune + p * 3;
          depth.connect(o.frequency);
          o.connect(lp);
          o.start(t);
          o.stop(t + dur);
        }
        vib.start(t);
        vib.stop(t + dur);
      }
      t += dur;
    }
  }

  /** One person's two-finger whistle, somewhere in the ground. */
  whistle(level: number): void {
    const ctx = this.#ctx;
    const at = ctx.currentTime + Math.random() * 0.2;
    const kind = Math.random();
    const f = 2600 + Math.random() * 900;
    const dur = kind < 0.5 ? 0.5 + Math.random() * 0.5 : 0.9;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f * 0.8, at);
    if (kind < 0.5) {
      // A straight blast: swoops up to pitch and holds.
      o.frequency.exponentialRampToValueAtTime(f, at + 0.06);
    } else {
      // The wolf whistle: up, down, up and away.
      o.frequency.exponentialRampToValueAtTime(f * 1.1, at + 0.18);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, at + 0.34);
      o.frequency.exponentialRampToValueAtTime(f * 1.15, at + 0.6);
      o.frequency.exponentialRampToValueAtTime(f * 0.75, at + dur);
    }
    const g = ctx.createGain();
    const peak = 0.01 + level * 0.018;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.03);
    g.gain.setValueAtTime(peak, at + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    let out: AudioNode = this.#whistleBus;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      p.connect(this.#whistleBus);
      out = p;
    }
    o.connect(g);
    g.connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Flares: a hiss that lasts as long as they burn, with the odd crackle and pop. */
  #flares(seconds: number): void {
    const ctx = this.#ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.#white;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.03, now + 1.2);
    g.gain.setValueAtTime(0.03, now + seconds * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    src.connect(hp);
    hp.connect(g);
    g.connect(this.#bus);
    src.start(now);
    src.stop(now + seconds + 0.1);
    for (let i = 0; i < 40; i++) {
      this.#noiseHit(now + 0.8 + Math.random() * seconds * 0.8, 0.015, 3000, 'bandpass', 0.05 + Math.random() * 0.06, this.#bus);
    }
  }

  dispose(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}
