// ============================================================================
//  Audio features for /feather2 — a small analyser, not a synth engine.
//
//  Input is a music file (played out loud) or the mic (analysed silently).
//  Each frame the spectrum is reduced to the features the anatomy responds to.
//  Three things make this more than a level meter:
//
//  1. PER-BAND AUTO GAIN. Raw band energy is useless across material: a quiet
//     acoustic track barely moves the feather and a mastered club track pins
//     every slider at 1. Each band tracks its own recent peak and reports a
//     fraction of it, so a whisper and a wall of sound both use the full range.
//
//  2. THREE ONSET DETECTORS, not one. Spectral flux with an adaptive threshold
//     is run separately on the low band (kick), the mid band (snare//chord
//     stabs) and the top (hats, ticks). One beat number can only ever thump;
//     three let the shaft, the fringe and the glitter answer to different
//     things in the same bar.
//
//  3. A TEMPO TRACKER. Onsets are instants — everything between them is dead
//     air for the visuals. Voting kick intervals into a period histogram gives
//     a running PHASE 0..1 (and a 4-beat BAR phase), so motion can anticipate
//     and swing between hits instead of only reacting after them.
//
//  Plus a spectral centroid (brightness) and the dominant pitch class, so the
//  colour follows the actual note rather than mid-band loudness.
// ============================================================================

export interface AudioFeatures {
  // --- the original four, unchanged in meaning ---
  beat: number; // 0..1 pulse on the low onset, fast decay
  melody: number; // 0..1 smoothed mid activity
  hue: number; // radians — now steered by the dominant pitch
  wave: number; // 0..1 smoothed bass
  shimmer: number; // 0..1 top end
  level: number;
  playing: boolean;
  sourceLabel: string;

  // --- bands, auto-gained 0..1 ---
  sub: number; // 20–60   the floor you feel
  bass: number; // 60–160
  body: number; // 160–500
  mid: number; // 500–2000
  high: number; // 2000–6000
  air: number; // 6000–14000

  // --- transients ---
  kick: number;
  snare: number;
  hat: number;
  attack: number; // broadband flux — any sudden change at all

  // --- time ---
  phase: number; // 0..1 within the beat
  bar: number; // 0..1 across four beats
  bpm: number; // 0 until the tracker is confident
  lock: number; // 0..1 tempo confidence

  // --- colour ---
  bright: number; // spectral centroid, 0 dark … 1 brilliant
  pitch: number; // 0..1 dominant pitch class

  idle: number; // 1 when there is nothing to listen to
}

const FFT = 2048;
const HIST = 43; // ~0.7 s of flux history at 60 fps

/** Per-band auto gain: report a fraction of this band's own recent peak. */
class Norm {
  private pk = 0.03;
  push(v: number, dt: number): number {
    const decayed = this.pk * Math.exp(-dt / 9);
    this.pk = Math.max(0.03, v, decayed);
    return Math.min(1, v / this.pk);
  }
}

/** Spectral flux onset with an adaptive threshold and a decaying pulse. */
class Onset {
  private prev = 0;
  private hist: number[] = [];
  private lastAt = -1e9;
  pulse = 0;
  fired = false;

  /**
   * `veto` lets a caller say "something moved, but it wasn't yours" — the
   * history and the decay still run (so the threshold stays honest) but no
   * pulse is emitted. Used to stop a cymbal from registering as a snare.
   */
  step(v: number, now: number, dt: number, gapMs: number, k: number, decay: number, veto = false): void {
    const flux = Math.max(0, v - this.prev);
    this.prev = v;
    this.hist.push(flux);
    if (this.hist.length > HIST) this.hist.shift();
    const len = this.hist.length || 1;
    let m = 0;
    for (const f of this.hist) m += f;
    m /= len;
    let sd = 0;
    for (const f of this.hist) sd += (f - m) * (f - m);
    sd = Math.sqrt(sd / len);

    this.fired = false;
    if (!veto && flux > m + k * sd && flux > 0.02 && now - this.lastAt > gapMs) {
      this.pulse = 1;
      this.lastAt = now;
      this.fired = true;
    }
    this.pulse *= Math.exp(-dt / decay);
  }
}

// tempo candidates: 50–214 bpm, folded into one octave of period
const T_MIN = 0.28;
const T_MAX = 1.2;
const T_BINS = 36;

/**
 * Interval-histogram tempo tracker. Every kick contributes its interval (and
 * its half and double, so a half-time backbeat still votes for the real
 * pulse); the winning bin is the period. Phase runs free between onsets and is
 * nudged — never snapped — toward each hit, so a missed beat doesn't jolt.
 */
class Tempo {
  private votes = new Float32Array(T_BINS);
  private lastAt = 0;
  period = 0.5;
  phase = 0;
  beats = 0;
  lock = 0;

  private vote(p: number, weight: number): void {
    if (p < T_MIN || p > T_MAX) return;
    const f = ((p - T_MIN) / (T_MAX - T_MIN)) * (T_BINS - 1);
    const i = Math.floor(f);
    const frac = f - i;
    this.votes[i] += weight * (1 - frac);
    if (i + 1 < T_BINS) this.votes[i + 1] += weight * frac;
  }

  onset(now: number): void {
    const iv = (now - this.lastAt) / 1000;
    this.lastAt = now;
    if (iv > 0.16 && iv < 2.6) {
      this.vote(iv, 1);
      this.vote(iv * 0.5, 0.6);
      this.vote(iv * 2, 0.45);
    }
    // pull the phase toward the hit rather than resetting it
    const err = this.phase > 0.5 ? this.phase - 1 : this.phase;
    this.phase -= err * (0.25 + 0.4 * this.lock);
    if (this.phase < 0) this.phase += 1;
  }

  step(dt: number): void {
    let best = 0, bestI = 0, sum = 0;
    for (let i = 0; i < T_BINS; i++) {
      this.votes[i] *= Math.exp(-dt / 14);
      sum += this.votes[i];
      if (this.votes[i] > best) {
        best = this.votes[i];
        bestI = i;
      }
    }
    this.lock = sum > 0.5 ? Math.min(1, (best / sum) * 3.2) : 0;
    if (sum > 0.5 && best > 0) {
      // sub-bin peak: the winning bin plus its neighbours, by centroid. A bin
      // is 1.6 bpm wide up at 120, so snapping to the bin centre alone reports
      // a steady 120 bpm track as 122 and slowly drifts the phase.
      const lo = Math.max(0, bestI - 1), hi = Math.min(T_BINS - 1, bestI + 1);
      let wsum = 0, isum = 0;
      for (let i = lo; i <= hi; i++) {
        wsum += this.votes[i];
        isum += this.votes[i] * i;
      }
      const at = wsum > 0 ? isum / wsum : bestI;
      const target = T_MIN + (at / (T_BINS - 1)) * (T_MAX - T_MIN);
      this.period += (target - this.period) * Math.min(1, dt * 1.5);
    }
    this.phase += dt / Math.max(0.15, this.period);
    while (this.phase >= 1) {
      this.phase -= 1;
      this.beats = (this.beats + 1) % 4;
    }
  }

  get bpm(): number {
    return this.lock > 0.22 ? 60 / this.period : 0;
  }
  get bar(): number {
    return (this.beats + this.phase) / 4;
  }
}

export class AudioFeed {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private bins: Uint8Array = new Uint8Array(0);
  private el: HTMLAudioElement | null = null;
  private elSrc: MediaElementAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private micSrc: MediaStreamAudioSourceNode | null = null;

  private nSub = new Norm();
  private nBass = new Norm();
  private nBody = new Norm();
  private nMid = new Norm();
  private nHigh = new Norm();
  private nAir = new Norm();
  private oKick = new Onset();
  private oSnare = new Onset();
  private oHat = new Onset();
  private oAll = new Onset();
  private tempo = new Tempo();

  private melodySm = 0;
  private waveSm = 0;
  private shimmerSm = 0;
  private brightSm = 0;
  private idleSm = 1;
  private presentPk = 0;
  private pLow = 0;
  private pMid = 0;
  private pTop = 0;
  private pitchX = 1;
  private pitchY = 0;
  private hue = 0;
  private lastT = 0;

  sourceLabel = '';

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = FFT;
      // low smoothing: onsets need the transient intact
      this.analyser.smoothingTimeConstant = 0.35;
      this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    }
    return this.ctx;
  }

  /** Play a music file out loud and analyse it. */
  async useFile(file: File): Promise<void> {
    const ctx = this.ensureCtx();
    await ctx.resume();
    this.stopMic();
    if (!this.el) {
      this.el = new Audio();
      this.el.loop = true;
      this.elSrc = ctx.createMediaElementSource(this.el);
      this.elSrc.connect(this.analyser!);
      this.elSrc.connect(ctx.destination); // music is meant to be heard
    }
    this.el.src = URL.createObjectURL(file);
    await this.el.play();
    this.sourceLabel = file.name;
  }

  /** Analyse the microphone (not routed to the speakers — no feedback). */
  async useMic(): Promise<void> {
    const ctx = this.ensureCtx();
    await ctx.resume();
    this.pauseFile();
    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micSrc = ctx.createMediaStreamSource(this.micStream);
    this.micSrc.connect(this.analyser!);
    this.sourceLabel = 'microphone';
  }

  stopMic(): void {
    this.micSrc?.disconnect();
    this.micSrc = null;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.micStream = null;
    if (this.sourceLabel === 'microphone') this.sourceLabel = '';
  }

  pauseFile(): void {
    this.el?.pause();
  }
  async resumeFile(): Promise<void> {
    await this.ctx?.resume();
    await this.el?.play();
  }
  get filePlaying(): boolean {
    return !!this.el && !this.el.paused;
  }
  get micOn(): boolean {
    return !!this.micStream;
  }
  get active(): boolean {
    return this.filePlaying || this.micOn;
  }

  dispose(): void {
    this.stopMic();
    this.el?.pause();
    this.el = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  /** Average byte energy of a Hz range, 0..1. */
  private band(lo: number, hi: number): number {
    if (!this.ctx || !this.analyser) return 0;
    const nyq = this.ctx.sampleRate / 2;
    const n = this.bins.length;
    const a = Math.max(0, Math.floor((lo / nyq) * n));
    const b = Math.min(n - 1, Math.ceil((hi / nyq) * n));
    let s = 0;
    for (let i = a; i <= b; i++) s += this.bins[i];
    return s / ((b - a + 1) * 255);
  }

  /** Call once per animation frame. */
  read(now: number): AudioFeatures {
    const dt = this.lastT ? Math.min(0.1, (now - this.lastT) / 1000) : 1 / 60;
    this.lastT = now;

    if (this.analyser && this.active) this.analyser.getByteFrequencyData(this.bins);
    else this.bins.fill(0);

    const rawSub = this.band(20, 60);
    const rawBass = this.band(60, 160);
    const rawBody = this.band(160, 500);
    const rawMid = this.band(500, 2000);
    const rawHigh = this.band(2000, 6000);
    const rawAir = this.band(6000, 14000);
    const rawAll = (rawSub + rawBass + rawBody + rawMid + rawHigh + rawAir) / 6;

    const sub = this.nSub.push(rawSub, dt);
    const bass = this.nBass.push(rawBass, dt);
    const body = this.nBody.push(rawBody, dt);
    const mid = this.nMid.push(rawMid, dt);
    const high = this.nHigh.push(rawHigh, dt);
    const air = this.nAir.push(rawAir, dt);

    // --- onsets: three bands, three characters ------------------------------
    // Each detector is fed its band's CONTRAST against the other two, not its
    // raw level. A hi-hat is broadband — it lifts the low band too — so on raw
    // levels every hit fires all three detectors and the feather just flashes
    // in unison. Subtracting the common-mode leaves a kick worth several times
    // a hat to the low detector, and the adaptive threshold does the rest.
    const lowE = sub * 0.55 + bass * 0.45;
    // weighted toward 160–500 Hz: that is the snare's shell, and it is the one
    // stretch of spectrum a cymbal has almost nothing in. Leaning on 500–2000
    // instead put the snare detector squarely in the hats' shoulder.
    const midE = body * 0.6 + mid * 0.4;
    const topE = high * 0.4 + air * 0.6;

    // Which band actually MOVED this frame. Contrast subtraction alone can't
    // separate a snare from a cymbal, because a bright enough hat lifts the
    // shell band a little too and the adaptive threshold is happy to call that
    // an onset. Comparing the rises settles it: if the top end jumped far more
    // than the shell did, the hit was a cymbal, whatever the shell did.
    const dLow = lowE - this.pLow, dMid = midE - this.pMid, dTop = topE - this.pTop;
    this.pLow = lowE;
    this.pMid = midE;
    this.pTop = topE;
    const cymbal = dTop > 0.02 && dTop > dMid * 1.6;
    // A contrast signal rises either because its own band rose or because the
    // others FELL — so a steady bassline under a hat pattern reads as a kick on
    // every gap between hats. Requiring the low band to have genuinely moved,
    // and to have moved more than the bands it is being measured against,
    // throws those away without touching a real kick (which saturates dLow).
    const notLow = dLow < 0.015 || dLow < Math.max(dMid, dTop) * 0.7;

    // deliberately NOT clamped at zero: only rises matter downstream, and
    // clamping would flatten the low band to nothing in a bright mix
    this.oKick.step(lowE - 0.70 * (midE + topE) * 0.5, now, dt, 190, 1.9, 0.16, notLow);
    this.oSnare.step(midE - 0.70 * (lowE + topE) * 0.5, now, dt, 130, 2.35, 0.13, cymbal);
    // the top band is the least contaminated of the three, so subtract less —
    // otherwise a hat landing on the same eighth as a kick gets cancelled away
    this.oHat.step(topE - 0.50 * (lowE + midE) * 0.5, now, dt, 70, 2.3, 0.07);
    this.oAll.step(rawAll, now, dt, 90, 2.0, 0.1);

    // --- tempo ---------------------------------------------------------------
    // The backbeat votes too. A kick-only tracker locks to whatever the kick
    // pattern happens to be: kicks on 1 and 3 of a 120 bpm bar are one second
    // apart, so it reports 60 and every visual riding `phase` moves at half
    // speed. The snare falls between the kicks — together they describe the
    // actual beat. (Before this, the tracker only read 120 on such a pattern
    // because the kick detector was firing on the offbeats by mistake.)
    if (this.oKick.fired || this.oSnare.fired) this.tempo.onset(now);
    this.tempo.step(dt);

    // --- smoothed levels ------------------------------------------------------
    this.melodySm += (mid - this.melodySm) * Math.min(1, dt * 6);
    this.waveSm += (bass - this.waveSm) * Math.min(1, dt * 4);
    this.shimmerSm += (air * 0.6 + high * 0.4 - this.shimmerSm) * Math.min(1, dt * 8);

    // --- spectral centroid → brightness ---------------------------------------
    let bright = 0;
    if (this.ctx && this.analyser) {
      const nyq = this.ctx.sampleRate / 2;
      const n = this.bins.length;
      let num = 0, den = 0;
      for (let i = 1; i < n; i++) {
        const a = this.bins[i];
        if (a < 8) continue;
        num += ((i + 0.5) * nyq) / n * a;
        den += a;
      }
      if (den > 0) {
        const c = num / den;
        bright = Math.max(0, Math.min(1, Math.log2(Math.max(80, c) / 120) / Math.log2(9000 / 120)));
      }
    }
    this.brightSm += (bright - this.brightSm) * Math.min(1, dt * 3);

    // --- dominant pitch class -------------------------------------------------
    // The loudest bin between 80 Hz and 1.6 kHz is a fair stand-in for "the
    // note on top". Held as a VECTOR so it can slew the short way round the
    // circle — C to B is a semitone, not eleven.
    if (this.ctx && this.analyser && this.melodySm > 0.05) {
      const nyq = this.ctx.sampleRate / 2;
      const n = this.bins.length;
      const lo = Math.max(1, Math.floor((80 / nyq) * n));
      const hi = Math.min(n - 1, Math.ceil((1600 / nyq) * n));
      let bi = -1, bv = 24;
      for (let i = lo; i <= hi; i++)
        if (this.bins[i] > bv) {
          bv = this.bins[i];
          bi = i;
        }
      if (bi > 0) {
        const f = ((bi + 0.5) * nyq) / n;
        const midiN = 69 + 12 * Math.log2(f / 440);
        const pc = (((midiN % 12) + 12) % 12) / 12;
        const ang = pc * Math.PI * 2;
        const k = Math.min(1, dt * 2.5 * (0.3 + bv / 255));
        this.pitchX += (Math.cos(ang) - this.pitchX) * k;
        this.pitchY += (Math.sin(ang) - this.pitchY) * k;
      }
    }
    const pitchAng = Math.atan2(this.pitchY, this.pitchX);
    const pitch = ((pitchAng / (Math.PI * 2)) % 1 + 1) % 1;

    // hue: the note picks the colour, and a slow drift keeps it from freezing
    // when a track sits on one chord for a bar
    this.hue += this.melodySm * dt * 0.7;
    const hue = this.hue + pitchAng;

    // --- idle: is anything actually playing? ----------------------------------
    // "Is anything playing" must not dip in the gaps BETWEEN drum hits, or the
    // idle breathing switches itself back on twice a bar. Peak-hold: instant
    // attack, seconds-long release, so idle only climbs during real silence.
    const loudest = Math.max(rawSub, rawBass, rawBody, rawMid, rawHigh, rawAir);
    const present = this.active ? Math.min(1, Math.max(rawAll * 6, loudest * 3)) : 0;
    this.presentPk = Math.max(present, this.presentPk * Math.exp(-dt / 1.5));
    this.idleSm += (1 - this.presentPk - this.idleSm) * Math.min(1, dt * 1.6);

    return {
      beat: this.oKick.pulse,
      melody: Math.min(1, this.melodySm * 1.35),
      hue,
      wave: Math.min(1, this.waveSm * 1.2),
      shimmer: Math.min(1, this.shimmerSm * 1.4),
      level: Math.min(1, rawAll * 3),
      playing: this.active,
      sourceLabel: this.sourceLabel,

      sub, bass, body, mid, high, air,

      kick: this.oKick.pulse,
      snare: this.oSnare.pulse,
      hat: this.oHat.pulse,
      attack: this.oAll.pulse,

      phase: this.tempo.phase,
      bar: this.tempo.bar,
      bpm: this.tempo.bpm,
      lock: this.tempo.lock,

      bright: this.brightSm,
      pitch,

      idle: Math.max(0, Math.min(1, this.idleSm)),
    };
  }
}
