// The sound of a football match, synthesized.
//
// Zero asset files (design §9), so there is no sample anywhere in here: the crowd is
// filtered noise, the whistle is a detuned pair of oscillators, a boot on a ball is a
// short noise burst through a resonant band-pass, and the goal sting is an arpeggio.
//
// The load-bearing claim from design §7a is that **a kid should be able to tell whether
// it is going well with their eyes shut**, and that is what the crowd bed is for: it is
// not ambience, it is a readout. Its level follows how dangerous the moment is and its
// balance follows momentum, so a long spell of pressure sounds like one.
//
// Everything is gated on a real user gesture, because every browser suspends an
// AudioContext created without one — and a game that logs an autoplay warning fails the
// "no console errors" ship gate.

import type { CrowdCall, CrowdReaction } from './crowdReact.js';
import { BARRA_BPM, BarraSound } from './barra.js';

const MASTER = 0.5;

/**
 * The least time between two of the same crowd call, in seconds. A crowd does not "ooh"
 * twice in half a second, and at 24x match speed the events arrive faster than any crowd
 * could react to them — without this, a fast-forwarded match is one continuous scream.
 */
const CALL_GAP: Readonly<Record<CrowdCall, number>> = {
  cheer: 1.1,
  roar: 1.5,
  ooh: 1.6,
  groan: 1.6,
  gasp: 1.0,
  boo: 2.6,
  jeer: 2.8,
  applause: 2.2,
  ole: 1.3,
  anticipate: 2.5,
  hush: 4,
};

/** Vowel formants (F1, F2) in Hz — what makes filtered noise say "ooh" rather than "aah". */
const VOWEL = {
  a: [760, 1250],
  e: [520, 1850],
  o: [480, 880],
  u: [330, 760],
} as const;
type Vowel = keyof typeof VOWEL;

export class MatchAudio {
  #ctx: AudioContext | null = null;
  #master: GainNode | null = null;
  /** The steady crowd bed and the two filters that shape it. */
  #bedGain: GainNode | null = null;
  #bedFilter: BiquadFilterNode | null = null;
  #noise: AudioBuffer | null = null;
  #bedSource: AudioBufferSourceNode | null = null;
  /** Rhythmic support when the managed team is on top. */
  #chantGain: GainNode | null = null;
  #chantTimer: number | null = null;
  /** The weather bed: rain and wind, both filtered noise, both off by default. */
  #weatherGain: GainNode | null = null;
  #rainFilter: BiquadFilterNode | null = null;
  #windFilter: BiquadFilterNode | null = null;
  #windLfo: OscillatorNode | null = null;
  #weatherSources: AudioBufferSourceNode[] = [];
  /** Rate limit for footsteps: twenty-five men is a texture, not a machine gun. */
  #lastStep = 0;
  #enabled = true;
  #started = false;
  /** 0..1, smoothed outside so the bed never jumps. */
  #excitement = 0;
  /**
   * The stadium: a send into a convolution reverb whose impulse response is generated,
   * not recorded. Everything that happens ON the pitch goes through it a little, which is
   * what puts a kick inside a bowl of concrete instead of inside a pair of headphones.
   */
  #send: GainNode | null = null;
  /** Voices in the crowd: a band of chatter that swells with the bed. */
  #chatterGain: GainNode | null = null;
  /** The club's fantasy ball, if it has one: which whoosh a strike makes. */
  #ballFx: string | null = null;
  /**
   * White noise, for the crowd's VOICES. The bed is brown noise because a murmur is all
   * low end; a vowel needs energy up at its second formant, near 2kHz, where brown noise
   * has almost none, and an "olé" through it comes out as a rumble.
   */
  #white: AudioBuffer | null = null;
  /** Three seconds of twenty thousand pairs of hands, built once. */
  #claps: AudioBuffer | null = null;
  /** When each crowd call last went off, in context time. */
  readonly #lastCall = new Map<CrowdCall, number>();
  /** The home end's band and its whistling (barra.ts). */
  #barra: BarraSound | null = null;

  get enabled(): boolean {
    return this.#enabled;
  }

  /**
   * Turn sound on or off. Off releases nothing — the context is cheap to keep and
   * expensive to re-create, and a kid toggling mute twice should not hear a gap.
   */
  setEnabled(on: boolean): void {
    this.#enabled = on;
    if (this.#master && this.#ctx) {
      this.#master.gain.setTargetAtTime(on ? MASTER : 0, this.#ctx.currentTime, 0.05);
    }
    if (on) void this.#ctx?.resume();
  }

  /**
   * Build the graph. Safe to call repeatedly; the first call inside a user gesture is the
   * one that sticks. Every failure path leaves the game silent rather than broken —
   * `AudioContext` throws outright in some embedded webviews.
   */
  start(): void {
    if (this.#started) {
      void this.#ctx?.resume();
      return;
    }
    type WithWebkit = typeof globalThis & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (globalThis as WithWebkit).webkitAudioContext;
    if (!Ctor) return;
    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return;
    }
    this.#started = true;
    this.#ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = this.#enabled ? MASTER : 0;
    master.connect(ctx.destination);
    this.#master = master;

    // Four seconds of noise, looped. Long enough that the loop point is inaudible and
    // short enough that the buffer is under a megabyte.
    const frames = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Brown-ish noise: white noise integrated, which has the low-frequency weight a
    // twenty-thousand-person murmur actually has. White noise alone is rain.
    let last = 0;
    for (let i = 0; i < frames; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.4;
    }
    this.#noise = buf;
    this.#white = whiteNoise(ctx, 3);
    this.#claps = clapTexture(ctx, 3);

    // --- the stadium's acoustics --------------------------------------------------
    const verb = ctx.createConvolver();
    verb.buffer = stadiumImpulse(ctx, 2.4);
    const send = ctx.createGain();
    send.gain.value = 0.32;
    const wet = ctx.createGain();
    wet.gain.value = 0.9;
    send.connect(verb);
    verb.connect(wet);
    wet.connect(master);
    this.#send = send;

    // The bed is STEREO: two reads of the same noise, far apart in the buffer so they do
    // not correlate, one per ear. A mono crowd sits in the middle of your head; a stereo
    // one is all round you, which is where a crowd is. A biquad filters each channel of a
    // stereo input independently, so every automation below still applies to both.
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const srcR = ctx.createBufferSource();
    srcR.buffer = buf;
    srcR.loop = true;
    const merge = ctx.createChannelMerger(2);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.7;

    const bed = ctx.createGain();
    bed.gain.value = 0.0;

    src.connect(merge, 0, 0);
    srcR.connect(merge, 0, 1);
    merge.connect(filter);
    filter.connect(bed);
    bed.connect(master);
    bed.connect(send);
    src.start();
    srcR.start(0, 2.1);
    this.#weatherSources.push(srcR);

    // --- voices ------------------------------------------------------------------
    //
    // Twenty thousand people are not a hiss: they are a hiss with syllables in it. A
    // band of noise in the vocal range, its level driven at audio rate by a slowly
    // wandering envelope at about talking speed, is the cheapest thing that reads as
    // "people" rather than "air".
    const chatterSrc = ctx.createBufferSource();
    chatterSrc.buffer = buf;
    chatterSrc.loop = true;
    chatterSrc.playbackRate.value = 1.7;
    const chatterBand = ctx.createBiquadFilter();
    chatterBand.type = 'bandpass';
    chatterBand.frequency.value = 1350;
    chatterBand.Q.value = 1.1;
    const syllables = ctx.createGain();
    syllables.gain.value = 0.5;
    const envSrc = ctx.createBufferSource();
    envSrc.buffer = syllableEnvelope(ctx, 6);
    envSrc.loop = true;
    envSrc.connect(syllables.gain);
    const chatter = ctx.createGain();
    chatter.gain.value = 0;
    chatterSrc.connect(chatterBand);
    chatterBand.connect(syllables);
    syllables.connect(chatter);
    // Centred and dry-light; it is the reverb send that spreads it round the bowl.
    chatter.connect(master);
    chatter.connect(send);
    chatterSrc.start(0, 1.3);
    envSrc.start();
    this.#chatterGain = chatter;
    this.#weatherSources.push(chatterSrc, envSrc);

    this.#bedSource = src;
    this.#bedFilter = filter;
    this.#bedGain = bed;

    const chant = ctx.createGain();
    chant.gain.value = 0;
    chant.connect(master);
    this.#chantGain = chant;

    this.#barra = new BarraSound(ctx, master, send, this.#white);

    // --- the weather bed ---------------------------------------------------------
    //
    // Two voices off the same noise buffer. Rain is the white end of it — the crowd bed's
    // own comment notes that white noise alone IS rain, which is exactly why the crowd had
    // to be brown-noise integrated, and exactly why rain needs no new source. Wind is the
    // band-passed end with the filter drifting, because wind is one moving resonance.
    const weather = ctx.createGain();
    weather.gain.value = 0;
    weather.connect(master);
    this.#weatherGain = weather;

    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = buf;
    rainSrc.loop = true;
    rainSrc.playbackRate.value = 3.6;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1500;
    const rainGain = ctx.createGain();
    rainGain.gain.value = 0.55;
    rainSrc.connect(rainHp);
    rainHp.connect(rainGain);
    rainGain.connect(weather);
    rainSrc.start();
    this.#rainFilter = rainHp;

    const windSrc = ctx.createBufferSource();
    windSrc.buffer = buf;
    windSrc.loop = true;
    windSrc.playbackRate.value = 0.6;
    const windBp = ctx.createBiquadFilter();
    windBp.type = 'bandpass';
    windBp.frequency.value = 420;
    windBp.Q.value = 2.4;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.5;
    windSrc.connect(windBp);
    windBp.connect(windGain);
    windGain.connect(weather);
    windSrc.start();
    this.#windFilter = windBp;

    // A slow drift on the wind's resonance. Without it the wind is a hiss; with it, it
    // gusts, and a gust is the whole of what wind sounds like.
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.09;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 190;
    lfo.connect(lfoDepth);
    lfoDepth.connect(windBp.frequency);
    lfo.start();
    this.#windLfo = lfo;
    // Pushed, not assigned: the crowd's own sources are already in this list.
    this.#weatherSources.push(rainSrc, windSrc);

    void ctx.resume();
  }

  dispose(): void {
    if (this.#chantTimer !== null) clearInterval(this.#chantTimer);
    this.#chantTimer = null;
    this.#barra?.dispose();
    this.#barra = null;
    try {
      this.#bedSource?.stop();
      for (const src of this.#weatherSources) src.stop();
      this.#windLfo?.stop();
    } catch {
      // Already stopped; nothing to do.
    }
    this.#weatherSources = [];
    void this.#ctx?.close();
    this.#ctx = null;
    this.#master = null;
    this.#bedGain = null;
    this.#started = false;
  }

  /**
   * Drive the crowd from the state of the match, every frame.
   *
   * `danger` is the same 0..1 the camera's push-in uses, so the sound and the framing
   * agree about when something is happening. `support` is -1..1 toward the managed team,
   * which opens the filter and adds the chant when the crowd is behind you.
   */
  update(danger: number, support: number, dt: number): void {
    const ctx = this.#ctx;
    const bed = this.#bedGain;
    const filter = this.#bedFilter;
    if (!ctx || !bed || !filter) return;

    const want = 0.1 + danger * 0.55 + Math.max(0, support) * 0.14;
    // Excitement rises fast and falls slowly: a crowd goes up in a second and takes ten
    // to come back down, and matching that is most of why this reads as a crowd.
    const rate = want > this.#excitement ? 4.5 : 0.7;
    this.#excitement += (want - this.#excitement) * Math.min(1, rate * dt);

    const now = ctx.currentTime;
    bed.gain.setTargetAtTime(this.#excitement * 0.5, now, 0.12);
    this.#chatterGain?.gain.setTargetAtTime(0.05 + this.#excitement * 0.16, now, 0.3);
    filter.frequency.setTargetAtTime(360 + this.#excitement * 900, now, 0.2);
    filter.Q.setTargetAtTime(0.7 + this.#excitement * 1.4, now, 0.25);

    // The chant only starts when the crowd is genuinely behind the managed team, and it
    // stops itself. A rhythmic bed that never goes away stops carrying information.
    this.#barra?.update(this.#excitement);

    const wantChant = support > 0.35;
    if (wantChant && this.#chantTimer === null) this.#startChant();
    else if (!wantChant && this.#chantTimer !== null) this.#stopChant();
  }

  /**
   * How loud the weather is. Called once when a match opens.
   *
   * `wetness` drives the rain and `wind` the gusts, both from the same Conditions the
   * renderer is drawing — a match that looks like it is raining and does not sound like it
   * is worse than one that does neither.
   */
  setWeather(sky: string, wetness: number, wind: number): void {
    const ctx = this.#ctx;
    const bed = this.#weatherGain;
    if (!ctx || !bed) return;
    const heavy = sky === 'heavyRain';
    const raining = heavy || sky === 'rain';
    const rainLevel = raining ? (heavy ? 0.16 : 0.085) : 0;
    const windLevel = Math.min(wind / 2.4, 1) * 0.07;
    const now = ctx.currentTime;
    // Slowly: weather that snaps on at kick-off sounds like a switch, not like weather.
    bed.gain.setTargetAtTime(rainLevel + windLevel, now, 1.4);
    if (this.#rainFilter) {
      this.#rainFilter.frequency.setTargetAtTime(heavy ? 1150 : 1800, now, 1.2);
    }
    if (this.#windFilter) {
      this.#windFilter.Q.setTargetAtTime(1.6 + Math.min(wind / 2.4, 1) * 2.2, now, 1.2);
    }
    void wetness;
  }

  /**
   * A stereo destination for a one-shot, panned to where the thing happened.
   *
   * `pan` is -1 (left of frame) to 1 (right). Everything used to land dead centre, which
   * is what makes a synthesized stadium sound like a synthesizer: a stadium is a place,
   * and a place has directions in it.
   */
  #out(pan: number): AudioNode | null {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return null;
    if (typeof ctx.createStereoPanner !== 'function') {
      if (this.#send) {
        // Still through the stadium, if not panned.
        const g = ctx.createGain();
        g.connect(master);
        g.connect(this.#send);
        return g;
      }
      return master;
    }
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan)) * 0.75;
    p.connect(master);
    if (this.#send) p.connect(this.#send);
    return p;
  }

  // ---- one-shots ---------------------------------------------------------------

  /** A boot hitting a ball. `power` 0..1 — a tap and a strike are different sounds. */
  kickBall(power: number, pan = 0): void {
    const ctx = this.#ctx;
    const out = this.#out(pan);
    if (!ctx || !out || !this.#noise) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.playbackRate.value = 1.6 + power * 0.9;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 180 + power * 340;
    band.Q.value = 3.2;
    const g = ctx.createGain();
    const level = 0.1 + power * 0.24;
    g.gain.setValueAtTime(level, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.09 + power * 0.05);
    src.connect(band);
    band.connect(g);
    g.connect(out);
    // A random offset into the noise buffer, so ten passes in a row are ten sounds.
    src.start(now, Math.random() * 3);
    src.stop(now + 0.2);

    // The body under the slap: a ball is a drum, and a strike has a pitch that drops as
    // the leather recovers. Without it a shot and a pass differ only in loudness.
    const thump = ctx.createOscillator();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(120 + power * 60, now);
    thump.frequency.exponentialRampToValueAtTime(48, now + 0.08);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.0001, now);
    tg.gain.exponentialRampToValueAtTime(0.08 + power * 0.3, now + 0.004);
    tg.gain.exponentialRampToValueAtTime(0.0001, now + 0.11 + power * 0.04);
    thump.connect(tg);
    tg.connect(out);
    thump.start(now);
    thump.stop(now + 0.18);
  }

  /**
   * Which fantasy effect the club's ball carries (ballTrail.ts's `kind`), or null for a
   * real ball. Once a match.
   */
  setBallFx(kind: string | null): void {
    this.#ballFx = kind;
  }

  /**
   * The sound a fantasy ball makes leaving the boot: a whoosh with the effect's own
   * character on it. A real ball makes none — this is the audio half of the trail, and
   * like the trail it is only for the balls that were sold as more than a ball.
   */
  ballFx(power: number, pan = 0): void {
    const kind = this.#ballFx;
    const ctx = this.#ctx;
    const out = this.#out(pan);
    if (!kind || !ctx || !out || !this.#noise) return;
    const now = ctx.currentTime;
    const p = Math.max(0.2, Math.min(1, power));
    const dur = 0.45 + p * 0.35;

    // Every kind shares the air: a band of noise sweeping down as the ball goes away.
    const air = ctx.createBufferSource();
    air.buffer = this.#noise;
    air.playbackRate.value = 2.2;
    const sweep = ctx.createBiquadFilter();
    sweep.type = 'bandpass';
    sweep.Q.value = 1.4;
    const dark = kind === 'blackHole' || kind === 'void' || kind === 'lava';
    sweep.frequency.setValueAtTime(dark ? 700 : 2600, now);
    sweep.frequency.exponentialRampToValueAtTime(dark ? 120 : 500, now + dur);
    const ag = ctx.createGain();
    ag.gain.setValueAtTime(0.0001, now);
    ag.gain.exponentialRampToValueAtTime(0.1 + p * 0.12, now + 0.05);
    ag.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    air.connect(sweep);
    sweep.connect(ag);
    ag.connect(out);
    air.start(now, Math.random() * 3);
    air.stop(now + dur + 0.05);

    const tone = (type: OscillatorType, f0: number, f1: number, at: number, len: number, level: number): void => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f0, now + at);
      o.frequency.exponentialRampToValueAtTime(f1, now + at + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(level, now + at + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + len);
      o.connect(g);
      g.connect(out);
      o.start(now + at);
      o.stop(now + at + len + 0.02);
    };

    switch (kind) {
      case 'fire':
      case 'lava':
        // Crackle: a scatter of tiny clicks through a high band.
        for (let i = 0; i < 14; i++) {
          const at = Math.random() * dur * 0.8;
          const c = ctx.createBufferSource();
          c.buffer = this.#noise;
          c.playbackRate.value = 4;
          const hp = ctx.createBiquadFilter();
          hp.type = 'highpass';
          hp.frequency.value = kind === 'lava' ? 900 : 2200;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.06 + Math.random() * 0.06, now + at);
          g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.015);
          c.connect(hp);
          hp.connect(g);
          g.connect(out);
          c.start(now + at, Math.random() * 3);
          c.stop(now + at + 0.03);
        }
        if (kind === 'lava') tone('sine', 90, 40, 0, dur, 0.12);
        break;
      case 'ice':
      case 'gold':
        // A chime: bell partials, slightly inharmonic, decaying.
        for (const [ratio, lvl] of [[1, 0.05], [2.76, 0.03], [5.4, 0.018]] as const) {
          const f = (kind === 'ice' ? 1760 : 1320) * ratio;
          tone('sine', f, f * 0.98, 0, 0.9, lvl);
        }
        break;
      case 'lightning': {
        // A zap: a sawtooth diving in pitch, then a crack.
        tone('sawtooth', 2400, 90, 0, 0.22, 0.05);
        tone('square', 180, 60, 0.02, 0.18, 0.03);
        break;
      }
      case 'galaxy':
      case 'aurora':
      case 'rainbow':
        // A shimmer: a quick run of high notes up a pentatonic scale.
        [0, 3, 5, 7, 10, 12].forEach((semi, i) => {
          const f = 880 * Math.pow(2, semi / 12) * (kind === 'aurora' ? 0.75 : 1);
          tone(kind === 'rainbow' ? 'triangle' : 'sine', f, f, i * 0.045, 0.35, 0.035);
        });
        break;
      case 'plasma':
        tone('sawtooth', 320, 1600, 0, 0.3, 0.035);
        tone('sine', 640, 3200, 0, 0.3, 0.03);
        break;
      case 'blackHole':
      case 'void':
        // A whoom: a deep tone bending down, with the air swept dark above.
        tone('sine', 110, 32, 0, dur + 0.2, 0.2);
        break;
      default:
        break;
    }
  }

  /** The net. Higher, softer and longer than the strike that put it there. */
  netRipple(): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master || !this.#noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.playbackRate.value = 3.4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.16, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.42);
    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    src.start(now, Math.random() * 3);
    src.stop(now + 0.5);
  }

  /** The referee. Two detuned squares beating against each other, which is the pea. */
  whistle(length: 'short' | 'long' = 'short'): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const dur = length === 'long' ? 1.15 : 0.34;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    g.gain.setValueAtTime(0.16, now + dur - 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    g.connect(master);
    if (this.#send) g.connect(this.#send);

    for (const [freq, detune] of [[3180, 0], [3180, 26]] as const) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = freq;
      o.detune.value = detune;
      const shaped = ctx.createBiquadFilter();
      shaped.type = 'lowpass';
      shaped.frequency.value = 5200;
      o.connect(shaped);
      shaped.connect(g);
      o.start(now);
      o.stop(now + dur + 0.05);
    }
  }

  /** The rising "ooooh" as a shot builds. Filter sweep on the bed, not a new voice. */
  buildUp(): void {
    const ctx = this.#ctx;
    const filter = this.#bedFilter;
    const bed = this.#bedGain;
    if (!ctx || !filter || !bed) return;
    const now = ctx.currentTime;
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.linearRampToValueAtTime(1700, now + 0.5);
    bed.gain.cancelScheduledValues(now);
    bed.gain.setValueAtTime(bed.gain.value, now);
    bed.gain.linearRampToValueAtTime(0.52, now + 0.5);
    this.#excitement = Math.max(this.#excitement, 0.75);
  }

  /**
   * A goal: the net, a roar, and a rising arpeggio over the top.
   *
   * `mine` decides whether the roar is a roar or a groan — the same noise burst, but the
   * groan falls in pitch and stays dark, which is what an away goal sounds like from
   * inside a home end.
   */
  /**
   * The home side has scored. The crowd's roar is `goal()`'s, and is about whether it was
   * YOUR goal; this is the home end's own answer — fanfare, drums, flares — whoever you are.
   */
  homeGoal(): void {
    if (this.#enabled) this.#barra?.goal();
  }

  goal(mine: boolean): void {
    const ctx = this.#ctx;
    const master = this.#master;
    const bed = this.#bedGain;
    const filter = this.#bedFilter;
    if (!ctx || !master || !bed || !filter) return;
    const now = ctx.currentTime;
    this.netRipple();

    bed.gain.cancelScheduledValues(now);
    bed.gain.setValueAtTime(bed.gain.value, now);
    bed.gain.linearRampToValueAtTime(mine ? 0.95 : 0.34, now + 0.14);
    bed.gain.setTargetAtTime(0.2, now + (mine ? 3.4 : 1.4), 1.4);
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.linearRampToValueAtTime(mine ? 2100 : 300, now + 0.3);
    this.#excitement = mine ? 1 : 0.2;

    if (!mine) return;
    // The sting. A major arpeggio, one note every 90ms, over the roar.
    const notes = [392, 494, 587, 784];
    notes.forEach((f, i) => {
      const at = now + 0.1 + i * 0.09;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.12, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
      o.connect(g);
      g.connect(master);
      o.start(at);
      o.stop(at + 0.55);
    });
  }

  /** A save, a block, a post. A short bright thud plus a crowd catch. */
  save(): void {
    this.kickBall(0.5);
    const ctx = this.#ctx;
    const bed = this.#bedGain;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    bed.gain.cancelScheduledValues(now);
    bed.gain.setValueAtTime(bed.gain.value, now);
    bed.gain.linearRampToValueAtTime(0.6, now + 0.08);
    bed.gain.setTargetAtTime(0.24, now + 0.7, 0.8);
  }

  /** The substitution applause: a short swell, no melody. */
  applause(): void {
    const ctx = this.#ctx;
    const bed = this.#bedGain;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    bed.gain.cancelScheduledValues(now);
    bed.gain.setValueAtTime(bed.gain.value, now);
    bed.gain.linearRampToValueAtTime(0.44, now + 0.2);
    bed.gain.setTargetAtTime(0.18, now + 1.1, 0.7);
    // And the hands, which the swell alone never had.
    this.#applause(0.55, 2.6);
  }

  /** A small confirmation tick, for the manager screens. */
  tick(up = true): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master) return;
    const now = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(up ? 660 : 440, now);
    o.frequency.exponentialRampToValueAtTime(up ? 880 : 330, now + 0.07);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.07, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    o.connect(g);
    g.connect(master);
    o.start(now);
    o.stop(now + 0.16);
  }

  /**
   * The frame. A hard, tuned metallic ring — an aluminium crossbar has a pitch, and it is
   * the single most recognisable sound in football.
   *
   * It used to call `save()`, so hitting the post and making a save were the same sound.
   * Those are the two most different outcomes a shot has.
   */
  post(pan = 0): void {
    const ctx = this.#ctx;
    const out = this.#out(pan);
    if (!ctx || !out) return;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.2, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    g.connect(out);
    // Three inharmonic partials: a bar rings, it does not play a note.
    for (const [f, level] of [[196, 1], [523, 0.5], [1290, 0.28]] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const v = ctx.createGain();
      v.gain.value = level;
      o.connect(v);
      v.connect(g);
      o.start(now);
      o.stop(now + 1.2);
    }
    this.#crowdCatch(0.5);
  }

  /** A boot on grass. Short, soft, and splashier when the pitch is wet. */
  footstep(pan = 0, wet = 0): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#noise) return;
    // Rate limited hard: twenty-five figures each planting twice a stride is a drum roll.
    const now = ctx.currentTime;
    if (now - this.#lastStep < 0.045) return;
    this.#lastStep = now;
    const out = this.#out(pan);
    if (!out) return;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.playbackRate.value = 2.4 + Math.random() * 0.8;
    const f = ctx.createBiquadFilter();
    f.type = wet > 0.4 ? 'bandpass' : 'lowpass';
    f.frequency.value = wet > 0.4 ? 2600 : 900;
    f.Q.value = wet > 0.4 ? 1.1 : 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.02 + wet * 0.02, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(now, Math.random() * 3);
    src.stop(now + 0.1);
  }

  /** The ball landing. Pitched by how hard it came down. */
  bounce(power: number, pan = 0): void {
    const ctx = this.#ctx;
    const out = this.#out(pan);
    if (!ctx || !out || !this.#noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.playbackRate.value = 1.1 + power * 0.6;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 260 + power * 420;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.03 + power * 0.09, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.11);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(now, Math.random() * 3);
    src.stop(now + 0.16);
  }

  /** The noise twenty thousand people make when a shot goes just wide. */
  nearMiss(): void {
    this.#crowdCatch(0.62);
    const ctx = this.#ctx;
    const filter = this.#bedFilter;
    if (!ctx || !filter) return;
    const now = ctx.currentTime;
    // Up and then straight back down: an "ooh" is a swell that does not pay off.
    filter.frequency.cancelScheduledValues(now);
    filter.frequency.setValueAtTime(filter.frequency.value, now);
    filter.frequency.linearRampToValueAtTime(1500, now + 0.18);
    filter.frequency.linearRampToValueAtTime(430, now + 1.5);
  }

  /** A short swell on the crowd bed. The shared body of every reaction above. */
  #crowdCatch(level: number): void {
    const ctx = this.#ctx;
    const bed = this.#bedGain;
    if (!ctx || !bed) return;
    const now = ctx.currentTime;
    bed.gain.cancelScheduledValues(now);
    bed.gain.setValueAtTime(bed.gain.value, now);
    bed.gain.linearRampToValueAtTime(level, now + 0.09);
    bed.gain.setTargetAtTime(0.22, now + 0.8, 0.9);
  }

  // ---- the crowd's voice ---------------------------------------------------------

  /**
   * React. One call from crowdReact.ts, turned into sound. Rate limited per call (CALL_GAP):
   * a crowd is slower than a match engine at 24x.
   */
  crowd(r: CrowdReaction): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#white || !this.#enabled) return;
    const now = ctx.currentTime;
    const last = this.#lastCall.get(r.call) ?? -1e9;
    if (now - last < CALL_GAP[r.call]) return;
    this.#lastCall.set(r.call, now);
    const L = Math.max(0, Math.min(1, r.level));
    switch (r.call) {
      case 'cheer':
        this.#vowel('a', 0.9 + L * 0.6, 0.12 * L + 0.03, { attack: 0.08, glide: 1.12, pitch: 1.1 });
        this.#crowdCatch(0.3 + L * 0.3);
        break;
      case 'roar':
        this.#vowel('a', 2.4, 0.2 * L + 0.05, { attack: 0.1, glide: 1.18, pitch: 1.15 });
        this.#vowel('o', 2.2, 0.08 * L, { attack: 0.2, glide: 1.05 });
        this.#crowdCatch(0.5 + L * 0.4);
        break;
      case 'ooh':
        // Up, and then down without paying off: the sound of a chance going.
        this.#vowel('u', 1.7, 0.16 * L + 0.03, { attack: 0.18, glide: 0.72, rise: 1.25, pitch: 1 });
        break;
      case 'groan':
        this.#vowel('o', 1.5, 0.1 * L + 0.02, { attack: 0.1, glide: 0.7, pitch: 0.8 });
        break;
      case 'gasp':
        // Short, high and sharp: the intake as a ball hits the frame or a defender is sold.
        this.#vowel('a', 0.45, 0.12 * L + 0.03, { attack: 0.025, glide: 1.25, pitch: 1.3 });
        break;
      case 'boo':
        this.#vowel('u', 2.2, 0.13 * L + 0.03, { attack: 0.3, glide: 0.94, pitch: 0.75, tremolo: 4.5 });
        // A South American ground whistles at the referee as much as it boos him.
        this.#whistles(L * 0.6);
        break;
      case 'jeer':
        this.#whistles(L);
        break;
      case 'applause':
        this.#applause(L, 1.4 + L * 2.2);
        break;
      case 'ole':
        // Two syllables: a short "o", and a long, rising "LÉ" that the whole ground lands on.
        this.#vowel('o', 0.32, 0.1 * L + 0.03, { attack: 0.04, glide: 1.02, pitch: 1.05 });
        this.#vowel('e', 0.85, 0.15 * L + 0.04, { attack: 0.05, glide: 1.1, pitch: 1.2, delay: 0.3 });
        this.#crowdCatch(0.3 + L * 0.25);
        break;
      case 'anticipate': {
        // A murmur that rises and holds: the ground leaning forward for a corner.
        const bed = this.#bedGain;
        const filter = this.#bedFilter;
        if (bed && filter) {
          filter.frequency.cancelScheduledValues(now);
          filter.frequency.setValueAtTime(filter.frequency.value, now);
          filter.frequency.linearRampToValueAtTime(700 + L * 700, now + 1.2);
          bed.gain.cancelScheduledValues(now);
          bed.gain.setValueAtTime(bed.gain.value, now);
          bed.gain.linearRampToValueAtTime(0.28 + L * 0.2, now + 1.2);
          bed.gain.setTargetAtTime(0.2, now + 2.6, 1.2);
        }
        this.#vowel('o', 1.8, 0.05 * L + 0.01, { attack: 0.9, glide: 1.1, pitch: 0.95 });
        break;
      }
      case 'hush': {
        // Everyone goes quiet at once — a player down, or the other lot with a free kick
        // on the edge of the box. Silence is a reaction too.
        const bed = this.#bedGain;
        if (bed) {
          bed.gain.cancelScheduledValues(now);
          bed.gain.setValueAtTime(bed.gain.value, now);
          bed.gain.linearRampToValueAtTime(0.05, now + 0.4);
          bed.gain.setTargetAtTime(0.18, now + 1.5 + L * 2, 1.4);
        }
        this.#chatterGain?.gain.setTargetAtTime(0.02, now, 0.2);
        this.#excitement = Math.min(this.#excitement, 0.1);
        break;
      }
    }
  }

  /**
   * A Mexican wave going round the ground: a swell of voices that travels from one side of
   * the stereo field to the other over `seconds`.
   */
  wave(seconds = 5): void {
    const ctx = this.#ctx;
    if (!ctx || !this.#enabled || typeof ctx.createStereoPanner !== 'function') return;
    const now = ctx.currentTime;
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(-0.9, now);
    pan.pan.linearRampToValueAtTime(0.9, now + seconds);
    pan.connect(this.#master as AudioNode);
    if (this.#send) pan.connect(this.#send);
    // Three passes of the swell as it goes round, each its own "whoa".
    for (let i = 0; i < 3; i++) {
      this.#vowel('o', seconds / 3 + 0.6, 0.1, { attack: 0.4, glide: 1.15, pitch: 1.1, delay: (i * seconds) / 3, out: pan });
    }
  }

  /**
   * Twenty thousand people saying one vowel. White noise through the vowel's two formants,
   * with a chorus of detuned voices under it, because a crowd's "ooh" has a pitch — not one
   * pitch, a smear of them — and filtered noise alone sounds like wind with an opinion.
   */
  #vowel(
    v: Vowel,
    dur: number,
    level: number,
    o: { attack: number; glide: number; rise?: number; pitch?: number; tremolo?: number; delay?: number; out?: AudioNode },
  ): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master || !this.#white) return;
    const at = ctx.currentTime + (o.delay ?? 0);
    const end = at + dur;
    const [f1, f2] = VOWEL[v];

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(level, at + o.attack);
    env.gain.setValueAtTime(level, at + Math.max(o.attack, dur * 0.45));
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    if (o.out) env.connect(o.out);
    else {
      env.connect(master);
      if (this.#send) env.connect(this.#send);
    }
    if (o.tremolo) {
      // Boos wobble: thousands of voices drifting in and out of breath at slightly
      // different rates beat against each other.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = o.tremolo;
      const depth = ctx.createGain();
      depth.gain.value = level * 0.35;
      lfo.connect(depth);
      depth.connect(env.gain);
      lfo.start(at);
      lfo.stop(end + 0.05);
    }

    const formants: BiquadFilterNode[] = [];
    for (const [f, q, g] of [[f1, 4.5, 1], [f2, 6, 0.55]] as const) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.Q.value = q;
      // The formants move: up then down for an "ooh", down for a groan, up for a cheer.
      band.frequency.setValueAtTime(f, at);
      if (o.rise) {
        band.frequency.linearRampToValueAtTime(f * o.rise, at + dur * 0.3);
        band.frequency.exponentialRampToValueAtTime(f * o.rise * o.glide, end);
      } else {
        band.frequency.exponentialRampToValueAtTime(f * o.glide, end);
      }
      const gain = ctx.createGain();
      gain.gain.value = g;
      band.connect(gain);
      gain.connect(env);
      formants.push(band);
    }

    // Two unrelated reads of the noise, one per ear, so the crowd surrounds you.
    const merge = ctx.createChannelMerger(2);
    for (const ch of [0, 1]) {
      const src = ctx.createBufferSource();
      src.buffer = this.#white;
      src.loop = true;
      src.connect(merge, 0, ch);
      src.start(at, Math.random() * 2.5);
      src.stop(end + 0.05);
    }
    for (const f of formants) merge.connect(f);

    // The chorus: a handful of voices spread over an octave around a speaking pitch.
    const base = 150 * (o.pitch ?? 1);
    const voices = ctx.createGain();
    voices.gain.value = 0.16;
    for (const f of formants) voices.connect(f);
    for (let i = 0; i < 6; i++) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const f0 = base * (0.75 + Math.random() * 0.7);
      osc.frequency.setValueAtTime(f0, at);
      if (o.rise) osc.frequency.linearRampToValueAtTime(f0 * (0.5 + o.rise * 0.5), at + dur * 0.3);
      osc.frequency.exponentialRampToValueAtTime(f0 * (0.5 + o.glide * 0.5), end);
      osc.detune.value = (Math.random() - 0.5) * 40;
      osc.connect(voices);
      osc.start(at);
      osc.stop(end + 0.05);
    }
  }

  /** Crowd whistling: a dozen people each blowing their own shrill, sliding note. */
  #whistles(level: number): void {
    const ctx = this.#ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const n = 5 + Math.round(level * 7);
    for (let i = 0; i < n; i++) {
      const at = now + Math.random() * 0.5;
      const dur = 0.35 + Math.random() * 0.9;
      const out = this.#out(Math.random() * 2 - 1);
      if (!out) return;
      const o = ctx.createOscillator();
      o.type = 'sine';
      const f = 1900 + Math.random() * 1400;
      o.frequency.setValueAtTime(f, at);
      // Some slide up, some down, some wolf-whistle up and back.
      const shape = Math.random();
      if (shape < 0.35) o.frequency.exponentialRampToValueAtTime(f * 1.3, at + dur);
      else if (shape < 0.7) o.frequency.exponentialRampToValueAtTime(f * 0.8, at + dur);
      else {
        o.frequency.exponentialRampToValueAtTime(f * 1.25, at + dur * 0.4);
        o.frequency.exponentialRampToValueAtTime(f * 0.9, at + dur);
      }
      const g = ctx.createGain();
      const peak = (0.012 + level * 0.02) * (0.5 + Math.random() * 0.5);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.04);
      g.gain.setValueAtTime(peak, at + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      o.connect(g);
      g.connect(out);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
  }

  /** Real applause: the clap texture, swelling in and dying away. */
  #applause(level: number, seconds: number): void {
    const ctx = this.#ctx;
    const master = this.#master;
    if (!ctx || !master || !this.#claps) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.#claps;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 650;
    const g = ctx.createGain();
    const peak = 0.05 + level * 0.14;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(peak, now + 0.35);
    g.gain.setValueAtTime(peak, now + seconds * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
    src.connect(hp);
    hp.connect(g);
    g.connect(master);
    if (this.#send) g.connect(this.#send);
    src.start(now, Math.random() * 2.5);
    src.stop(now + seconds + 0.05);
  }

  // ---- the chant ---------------------------------------------------------------

  #startChant(): void {
    const ctx = this.#ctx;
    const chant = this.#chantGain;
    if (!ctx || !chant || this.#chantTimer !== null) return;
    chant.gain.setTargetAtTime(0.5, ctx.currentTime, 0.6);
    // A pulse on the beat of the barra's drums (barra.ts), so the ground chants to the band
    // rather than against it. Not a tune — a rhythm made of filtered noise is what a chant
    // sounds like from the middle of the pitch.
    this.#chantTimer = setInterval(() => this.#chantHit(), 60000 / BARRA_BPM) as unknown as number;
  }

  #stopChant(): void {
    if (this.#chantTimer !== null) clearInterval(this.#chantTimer);
    this.#chantTimer = null;
    const ctx = this.#ctx;
    if (this.#chantGain && ctx) this.#chantGain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
  }

  #chantHit(): void {
    const ctx = this.#ctx;
    const chant = this.#chantGain;
    if (!ctx || !chant || !this.#noise) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.#noise;
    src.playbackRate.value = 0.85;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 700;
    band.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(0.09, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
    src.connect(band);
    band.connect(g);
    g.connect(chant);
    src.start(now, Math.random() * 3);
    src.stop(now + 0.4);
  }
}

/** Plain white noise, for the crowd's voices. */
function whiteNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Applause, built once: thousands of individual claps scattered through a stereo buffer.
 * A clap is a few milliseconds of noise with a sharp attack; what makes it applause rather
 * than static is that each one is a separate event, with gaps between them that the ear
 * can hear. A noise burst swelling on the bed — what the substitution "applause" used to
 * be — has no gaps, and so sounds like the sea.
 */
function clapTexture(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const frames = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, frames, rate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    const claps = Math.floor(seconds * 260);
    for (let c = 0; c < claps; c++) {
      const start = Math.floor(Math.random() * frames);
      const len = Math.floor(rate * (0.004 + Math.random() * 0.006));
      const amp = 0.25 + Math.random() * 0.75;
      // A clap is bright: the first difference of noise tilts it up the spectrum.
      let prev = 0;
      for (let i = 0; i < len; i++) {
        const k = (start + i) % frames;
        const white = Math.random() * 2 - 1;
        const decay = Math.exp(-i / (len * 0.28));
        data[k] = (data[k] as number) + (white - prev) * amp * decay * 0.5;
        prev = white;
      }
    }
  }
  return buf;
}

/**
 * One audio engine for the whole game. The manager screens use `tick`; the match uses
 * everything. A second AudioContext per match is how a browser runs out of them.
 */
export const audio = new MatchAudio();

/**
 * A stadium's impulse response, generated: stereo noise under an exponential decay, with
 * a short pre-delay (the nearest stand is thirty metres away) and the top end rolled off
 * as it decays, because concrete and people absorb the highs first. No recording — design
 * §9 — and a few milliseconds to build once.
 */
function stadiumImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, length, rate);
  const pre = Math.floor(rate * 0.045);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < length; i++) {
      const t = (i - pre) / (length - pre);
      const white = Math.random() * 2 - 1;
      // A one-pole low-pass whose cutoff falls as the tail decays.
      const k = 0.9 - t * 0.75;
      lp = lp + k * (white - lp);
      d[i] = lp * Math.pow(1 - t, 3.2) * 0.9;
    }
  }
  return buf;
}

/**
 * A level envelope that wanders at talking speed — a new target every 80–250ms, smoothed —
 * for the crowd's chatter. Values 0..1, looped.
 */
function syllableEnvelope(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(1, length, rate);
  const d = buf.getChannelData(0);
  let target = 0.5;
  let v = 0.5;
  let next = 0;
  for (let i = 0; i < length; i++) {
    if (i >= next) {
      target = 0.15 + Math.random() * 0.85;
      next = i + Math.floor(rate * (0.08 + Math.random() * 0.17));
    }
    v += (target - v) * 0.0009;
    d[i] = v;
  }
  return buf;
}
