// ============================================================================
//  Musical ELEMENTS — what is playing, not just how loud it is.
//
//  The rhythm side of the engine works off band energy, which is enough for
//  drums: a kick IS low-frequency energy arriving suddenly. Everything else in
//  a mix fails that test. A bass note and a kick occupy the same octave. A
//  vocal and a guitar occupy the same one. Loudness in a band cannot tell them
//  apart, so "melody" built on a band is really just "midrange loudness".
//
//  Three separations run here, each cheap enough for a frame budget:
//
//  1. HARMONIC / PERCUSSIVE (HPSS). On a spectrogram a sustained note is a
//     HORIZONTAL ridge — the same bin, frame after frame — and a drum hit is a
//     VERTICAL one, every bin at the same instant. Median-filtering across time
//     keeps the horizontal and erases the vertical; median-filtering across
//     frequency does the opposite. Two soft masks fall out of the pair, and
//     suddenly the melody trackers never see the drums.
//
//  2. CENTRE / SIDES. Vocals are panned centre in almost every mix, so they
//     are the part of the signal where left and right AGREE. Comparing the two
//     channels per bin — which needs real phase, hence the FFT below rather
//     than the built-in analyser, which throws phase away — pulls the centre
//     out. It is not a studio stem, but it is a genuine voice-ish stream.
//
//  3. PITCH, not brightness. Bass and lead both get a harmonic product
//     spectrum, which multiplies the spectrum by decimated copies of itself so
//     that a fundamental reinforced by its overtones beats a lone loud partial.
//     That is what stops a tracker from hearing the second harmonic and
//     reporting the note an octave up.
//
//  The heavy buffers are allocated once and reused; per-frame garbage is kept
//  to the returned object and a couple of closures.
// ============================================================================

/** Iterative radix-2 FFT. In-place, real+imaginary, precomputed twiddles. */
class FFT {
  private readonly n: number;
  private readonly cosT: Float32Array;
  private readonly sinT: Float32Array;
  private readonly rev: Uint32Array;

  constructor(n: number) {
    this.n = n;
    const levels = Math.round(Math.log2(n));
    this.cosT = new Float32Array(n / 2);
    this.sinT = new Float32Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cosT[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinT[i] = Math.sin((2 * Math.PI * i) / n);
    }
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i, r = 0;
      for (let j = 0; j < levels; j++) {
        r = (r << 1) | (x & 1);
        x >>= 1;
      }
      this.rev[i] = r >>> 0;
    }
  }

  forward(re: Float32Array, im: Float32Array): void {
    const { n, rev, cosT, sinT } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size *= 2) {
      const half = size >> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cosT[k] + im[l] * sinT[k];
          const tim = -re[l] * sinT[k] + im[l] * cosT[k];
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  }
}

/** Median of a short window, via insertion sort into scratch. */
function medianInto(scratch: Float32Array, len: number): number {
  for (let i = 1; i < len; i++) {
    const v = scratch[i];
    let j = i - 1;
    while (j >= 0 && scratch[j] > v) {
      scratch[j + 1] = scratch[j];
      j--;
    }
    scratch[j + 1] = v;
  }
  return scratch[len >> 1];
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a || 1e-6)));
  return t * t * (3 - 2 * t);
};

/** How many frames of history the temporal median sees (~150 ms at 60 fps). */
const TIME_MED = 9;
/** Frequency median half-width, in bins. */
const FREQ_MED = 4;
/** Decimation factor for the time-domain bass pitch search. */
const DECIM = 8;

export interface ElementOut {
  /** percussive-masked total energy, 0..1 raw (caller auto-gains) */
  perc: number;
  /** harmonic-masked total energy */
  harm: number;
  /** pitched low end, kick transient removed by the harmonic mask */
  bass: number;
  /** the dominant pitched line above the bass */
  lead: number;
  /** centre-extracted, vocal-band, harmonic — voice-ish */
  vocal: number;
  /** sustained chordal remainder: harmonic minus bass minus the lead peak */
  pad: number;
  /** side-channel top end — reverb tails, wideners, cymbal wash */
  air: number;

  /** 0..1 pitch class of the bass note, -1 when nothing is tracked */
  bassNote: number;
  /** 0..1 pitch class of the lead note, -1 when nothing is tracked */
  leadNote: number;
  /** MIDI note number of the lead, for interval logic; 0 when untracked */
  leadMidi: number;
  /** fires the frame the lead moves to a new note */
  noteChanged: boolean;
  /** 0..1 — how much the lead pitch is wobbling, the giveaway for a sung line */
  vibrato: number;
}

export class ElementAnalyser {
  private readonly n: number;
  private readonly fft: FFT;
  private readonly win: Float32Array;

  // FFT workspaces for the two channels
  private reL: Float32Array;
  private imL: Float32Array;
  private reR: Float32Array;
  private imR: Float32Array;

  private readonly half: number;
  private mag: Float32Array;      // mono magnitude
  private centre: Float32Array;   // centre-extracted magnitude
  private side: Float32Array;     // side magnitude
  private harmMag: Float32Array;  // harmonic-masked
  private percMag: Float32Array;  // percussive-masked

  // temporal median ring: [TIME_MED][half]
  private ring: Float32Array;
  private ringAt = 0;
  private ringFill = 0;

  private tScratch = new Float32Array(TIME_MED);
  private fScratch = new Float32Array(FREQ_MED * 2 + 1);
  private hps = new Float32Array(0);

  // bass pitch runs in the TIME domain — see bassHz()
  private dec: Float32Array;
  private ac: Float32Array;

  // pitch state
  private leadMidiSm = 0;
  private leadHist: number[] = [];
  private quiet = 0;
  private lastNote = -999;
  private noteHold = 0;

  constructor(fftSize = 2048) {
    this.n = fftSize;
    this.half = fftSize >> 1;
    this.fft = new FFT(fftSize);
    this.win = new Float32Array(fftSize);
    // Hann — the sidelobes of a rectangular window would smear every partial
    // across neighbouring bins and ruin the frequency median
    for (let i = 0; i < fftSize; i++) this.win[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    this.reL = new Float32Array(fftSize);
    this.imL = new Float32Array(fftSize);
    this.reR = new Float32Array(fftSize);
    this.imR = new Float32Array(fftSize);
    this.mag = new Float32Array(this.half);
    this.centre = new Float32Array(this.half);
    this.side = new Float32Array(this.half);
    this.harmMag = new Float32Array(this.half);
    this.percMag = new Float32Array(this.half);
    this.ring = new Float32Array(TIME_MED * this.half);
    this.hps = new Float32Array(this.half);
    this.dec = new Float32Array(fftSize / DECIM);
    this.ac = new Float32Array(fftSize / DECIM);
  }

  /**
   * Bass pitch, by autocorrelation on a decimated copy of the waveform.
   *
   * The spectrum cannot do this job. At a 2048-point FFT one bin spans 23 Hz,
   * and 23 Hz at the bottom of a bass guitar is four and a half SEMITONES —
   * the note is smaller than the measurement. Period estimation in the time
   * domain has the opposite bias: the lower the note, the more samples per
   * cycle and the better it resolves. Decimating by 8 first makes the lag
   * search cheap and low-passes away everything above the bass in one step.
   *
   * Returns Hz, or 0 when nothing periodic is down there.
   */
  private bassHz(left: Float32Array, right: Float32Array, sampleRate: number): number {
    const D = DECIM;
    const m = this.dec.length;
    const dec = this.dec;
    // box-average decimation — crude, but it IS the anti-alias filter
    for (let i = 0; i < m; i++) {
      let s = 0;
      const base = i * D;
      for (let k = 0; k < D; k++) s += left[base + k] + right[base + k];
      dec[i] = s / (2 * D);
    }
    const sr = sampleRate / D;
    const lagMin = Math.max(2, Math.floor(sr / 280));
    const lagMax = Math.min(m - 4, Math.floor(sr / 34));
    if (lagMax <= lagMin) return 0;

    let e0 = 0;
    for (let i = 0; i < m; i++) e0 += dec[i] * dec[i];
    if (e0 < 1e-8) return 0;

    const ac = this.ac;
    let bv = 0;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let s = 0, e = 0;
      const lim = m - lag;
      for (let i = 0; i < lim; i++) {
        const b = dec[i + lag];
        s += dec[i] * b;
        e += b * b;
      }
      const v = s / Math.sqrt(e0 * e + 1e-12);
      ac[lag] = v;
      if (v > bv) bv = v;
    }
    if (bv < 0.3) return 0;

    // Take the FIRST lag that gets close to the best one, not the best itself.
    // Autocorrelation peaks again at every multiple of the true period, so the
    // global maximum happily reports the note an octave or two too low.
    let best = -1;
    for (let lag = lagMin + 1; lag < lagMax; lag++) {
      if (ac[lag] >= 0.86 * bv && ac[lag] >= ac[lag - 1] && ac[lag] >= ac[lag + 1]) {
        best = lag;
        break;
      }
    }
    if (best < 0) return 0;

    // parabolic refinement on the correlation curve — the period is almost
    // never a whole number of samples
    const l = ac[best - 1], c = ac[best], r = ac[best + 1];
    const d = l - 2 * c + r;
    const off = Math.abs(d) > 1e-12 ? Math.max(-0.5, Math.min(0.5, (0.5 * (l - r)) / d)) : 0;
    const period = best + off;
    return period > 0 ? sr / period : 0;
  }

  private binToHz(b: number, sampleRate: number): number {
    return (b * sampleRate) / this.n;
  }
  private hzToBin(hz: number, sampleRate: number): number {
    return Math.round((hz * this.n) / sampleRate);
  }

  /**
   * Harmonic product spectrum over a bin range. Multiplying the spectrum by
   * decimated copies of itself makes a true fundamental — which has partials
   * at 2f, 3f, 4f — beat a single loud overtone, which has nothing at its own
   * multiples. Returns the winning bin, or -1.
   */
  private hpsPeak(src: Float32Array, lo: number, hi: number, harmonics: number): number {
    const hps = this.hps;
    const top = Math.min(hi, this.half - 1);
    if (top <= lo) return -1;

    // A plain product annihilates: one missing harmonic zeroes the whole
    // candidate, so a PURE tone — a sine lead, a flute, a soft pad — scores
    // zero at its own fundamental and the peak collapses into noise. Adding a
    // small floor, scaled to the loudest bin in the range, keeps a missing
    // harmonic merely unconvincing instead of disqualifying.
    let peak = 0;
    for (let b = lo; b <= top; b++) if (src[b] > peak) peak = src[b];
    if (peak <= 0) return -1;
    const floor = peak * 0.02;

    for (let b = lo; b <= top; b++) hps[b] = src[b];
    for (let h = 2; h <= harmonics; h++) {
      for (let b = lo; b <= top; b++) {
        const s = b * h;
        hps[b] *= (s < this.half ? src[s] : 0) + floor;
      }
    }
    // A candidate must carry real energy of its own. Without this the floor
    // above backfires: half the true bin holds nothing but spectral leakage,
    // yet leakage×(loud fundamental) beats (loud fundamental)×floor², so the
    // tracker reports the note an octave DOWN. It only shows up once a note
    // moves — vibrato smears energy into the neighbours that leakage needs.
    const need = peak * 0.15;
    let best = -1, bv = 0;
    for (let b = lo; b <= top; b++) {
      if (src[b] < need) continue;
      if (hps[b] > bv) { bv = hps[b]; best = b; }
    }
    return bv > 0 ? best : -1;
  }

  /** Parabolic interpolation around a spectral peak, for sub-bin accuracy. */
  private refine(src: Float32Array, b: number): number {
    if (b <= 0 || b >= this.half - 1) return b;
    const l = src[b - 1], c = src[b], r = src[b + 1];
    const d = l - 2 * c + r;
    if (Math.abs(d) < 1e-12) return b;
    // A true peak sits within half a bin of its sample. Anything larger means
    // the three points were flat or noisy rather than a peak, and the division
    // blew up — unclamped, that reported notes far outside the search range.
    const off = (0.5 * (l - r)) / d;
    return b + Math.max(-0.5, Math.min(0.5, off));
  }

  /**
   * @param left  time-domain samples, length = fftSize
   * @param right same, or the same array for a mono source
   */
  analyse(left: Float32Array, right: Float32Array, sampleRate: number, dt: number): ElementOut {
    const { n, half, win, reL, imL, reR, imR, mag, centre, side } = this;

    for (let i = 0; i < n; i++) {
      const w = win[i];
      reL[i] = left[i] * w;
      imL[i] = 0;
      reR[i] = right[i] * w;
      imR[i] = 0;
    }
    this.fft.forward(reL, imL);
    this.fft.forward(reR, imR);

    // Everything above 16 kHz is inaudible detail that would still cost a
    // pair of median filters per bin, so the whole chain stops there.
    const top = Math.min(half, this.hzToBin(16000, sampleRate) + 1);

    // magnitudes, plus mid/side from the complex pair
    for (let b = 0; b < top; b++) {
      const lr = reL[b], li = imL[b], rr = reR[b], ri = imR[b];
      const mr = (lr + rr) * 0.5, mi = (li + ri) * 0.5;
      const sr = (lr - rr) * 0.5, si = (li - ri) * 0.5;
      const mMag = Math.hypot(mr, mi);
      const sMag = Math.hypot(sr, si);
      mag[b] = Math.hypot(lr, li) * 0.5 + Math.hypot(rr, ri) * 0.5;
      side[b] = sMag;
      // Centre-ness: energy that survives the mid sum AND is not explained by
      // the difference. Squared so that a bin only half-agreeing between the
      // channels contributes a quarter, which keeps wide synths out of the
      // vocal stream.
      const coh = mMag / (mMag + sMag + 1e-9);
      centre[b] = mMag * coh * coh;
    }

    // ---- HPSS ------------------------------------------------------------
    // temporal median (horizontal ridges = sustained = harmonic)
    const ring = this.ring;
    ring.set(mag, this.ringAt * half); // mag.length === half already
    this.ringAt = (this.ringAt + 1) % TIME_MED;
    this.ringFill = Math.min(TIME_MED, this.ringFill + 1);
    const fill = this.ringFill;

    const tS = this.tScratch, fS = this.fScratch;
    for (let b = 0; b < top; b++) {
      for (let k = 0; k < fill; k++) tS[k] = ring[k * half + b];
      const hEst = medianInto(tS, fill);

      // frequency median (vertical ridges = broadband = percussive)
      let cnt = 0;
      for (let d = -FREQ_MED; d <= FREQ_MED; d++) {
        const j = b + d;
        if (j >= 0 && j < top) fS[cnt++] = mag[j];
      }
      const pEst = medianInto(fS, cnt);

      // soft Wiener-style masks — squared so the split is decisive but still
      // continuous, and a bin that is genuinely both gets shared
      const h2 = hEst * hEst, p2 = pEst * pEst;
      const tot = h2 + p2 + 1e-12;
      this.harmMag[b] = mag[b] * (h2 / tot);
      this.percMag[b] = mag[b] * (p2 / tot);
    }

    // ---- element energies -------------------------------------------------
    const bin = (hz: number) => this.hzToBin(hz, sampleRate);
    const sum = (src: Float32Array, lo: number, hi: number) => {
      let s = 0;
      const top = Math.min(hi, half - 1);
      for (let b = Math.max(0, lo); b <= top; b++) s += src[b];
      return s;
    };

    const bBassLo = bin(40), bBassHi = bin(260);
    const bLeadLo = bin(180), bLeadHi = bin(2200);
    const bVoxLo = bin(180), bVoxHi = bin(4000);

    const percE = sum(this.percMag, bin(30), bin(14000));
    const harmE = sum(this.harmMag, bin(30), bin(14000));
    const bassE = sum(this.harmMag, bBassLo, bBassHi);
    const airE = sum(side, bin(5000), bin(16000));

    // ---- pitch ------------------------------------------------------------
    const leadBin = this.hpsPeak(this.harmMag, bLeadLo, bLeadHi, 3);

    const pcOf = (b: number): number => {
      if (b < 1) return -1;
      const hz = this.binToHz(this.refine(this.harmMag, b), sampleRate);
      if (!(hz > 20)) return -1;
      const midi = 69 + 12 * Math.log2(hz / 440);
      return (((midi % 12) + 12) % 12) / 12;
    };

    const bHz = this.bassHz(left, right, sampleRate);
    const bassNote = bHz > 20 ? ((((69 + 12 * Math.log2(bHz / 440)) % 12) + 12) % 12) / 12 : -1;
    const leadNote = pcOf(leadBin);

    let leadMidi = 0;
    if (leadBin > 0) {
      const hz = this.binToHz(this.refine(this.harmMag, leadBin), sampleRate);
      if (hz > 20) leadMidi = 69 + 12 * Math.log2(hz / 440);
    }

    // lead energy: the peak and its immediate neighbours, so a loud pad two
    // semitones away does not count as "the melody"
    let leadE = 0;
    if (leadBin > 0) {
      for (let d = -2; d <= 2; d++) {
        const j = leadBin + d;
        if (j >= 0 && j < half) leadE += this.harmMag[j];
      }
      // and its first two partials, which is where a lead's character lives
      const h2 = leadBin * 2, h3 = leadBin * 3;
      if (h2 < half) leadE += this.harmMag[h2] * 0.5;
      if (h3 < half) leadE += this.harmMag[h3] * 0.5;
    }

    // vocal: centre-extracted, in the voice band, and only the harmonic part
    let voxE = 0;
    for (let b = Math.max(0, bVoxLo); b <= Math.min(bVoxHi, half - 1); b++) {
      const hm = mag[b] > 1e-9 ? this.harmMag[b] / mag[b] : 0;
      voxE += centre[b] * hm;
    }

    // pad: sustained harmonic material that is neither the bass nor the lead
    const padE = Math.max(0, sum(this.harmMag, bLeadLo, bin(6000)) - leadE);

    // ---- vibrato: the tell that a pitched line is SUNG ---------------------
    if (leadMidi > 0) {
      this.quiet = 0;
      this.leadMidiSm += (leadMidi - this.leadMidiSm) * Math.min(1, dt * 12);
      this.leadHist.push(leadMidi);
      if (this.leadHist.length > 26) this.leadHist.shift();
    } else if (++this.quiet > 24) {
      // The window holds 26 TRACKED frames, not 26 consecutive ones, so without
      // this it stitches across silence: one note, ten seconds of nothing, then
      // a note a semitone away reads as a spread of 0.5 and reports full
      // vibrato from two dead-straight notes. It also meant vibrato never
      // returned to zero once the music stopped.
      this.leadHist.length = 0;
    }
    let vibrato = 0;
    if (this.leadHist.length > 8) {
      let m = 0;
      for (const v of this.leadHist) m += v;
      m /= this.leadHist.length;
      let sd = 0;
      for (const v of this.leadHist) sd += (v - m) * (v - m);
      sd = Math.sqrt(sd / this.leadHist.length);
      // Calibrated against a true 1.3% frequency wobble at 5.5 Hz — a typical
      // sung vibrato — which measures 0.119 semitones of spread here, against
      // ~0.000 for a held synth note. The upper term matters as much as the
      // lower one: a melody CHANGING notes also spreads, by whole semitones,
      // so anything past a tone is a moving line rather than a wobbling one
      // and is excluded instead of counted as singing.
      vibrato = smooth(0.015, 0.18, sd) * (1 - smooth(0.9, 2.2, sd));
    }

    // ---- note change ------------------------------------------------------
    let noteChanged = false;
    this.noteHold = Math.max(0, this.noteHold - dt);
    if (leadMidi > 0) {
      const q = Math.round(leadMidi);
      if (Math.abs(q - this.lastNote) >= 1 && this.noteHold <= 0) {
        noteChanged = true;
        this.lastNote = q;
        this.noteHold = 0.07;
      }
    }

    return {
      perc: percE,
      harm: harmE,
      bass: bassE,
      lead: leadE,
      // a voice reads as centre + harmonic + wobbling; the vibrato term is a
      // lift rather than a gate, so a dead-straight vocal still registers
      vocal: voxE * (0.65 + 0.35 * vibrato),
      pad: padE,
      air: airE,
      bassNote,
      leadNote,
      leadMidi,
      noteChanged,
      vibrato,
    };
  }
}
