// ============================================================================
//  Feather anatomy analysis — the engine behind /feather2.
//
//  Modelled on real feather structure (see the reference plates):
//
//    CALAMUS   the bare hollow quill at the base — no barbs, just shaft.
//    RACHIS    the central shaft running the whole length, tapering to the tip.
//    VANE      the blade of BARBS either side of the rachis. Barbs branch off
//              diagonally, sweeping outward AND toward the tip.
//    Two textures make up the vane:
//      PENNACEOUS   firm, zipped, solid — the outer/upper blade.
//      PLUMULACEOUS loose, downy, open — always at the BASE by the calamus.
//    The pennaceous:plumulaceous ratio is what separates a flight feather
//    (mostly firm vane) from a contour, semiplume or down feather.
//
//  Recovery from a photo:
//    1. mask the feather — flood fill the background inward from the border,
//       so dark regions inside a dark feather aren't eaten as background
//    2. PCA → shaft axis; the width profile puts the narrow end (calamus) at v=0
//    3. the SHAFT RIDGE: the rachis is found as a thin luminance ridge and fit
//       as a straight line, because on an asymmetric flight feather the shaft
//       is nowhere near the centre of area. Each vane half is then normalised
//       by its OWN width → u -1..1 across, v 0..1 base→tip.
//    4. per-band SOLIDITY (mask fill inside the width envelope) → the downy
//       base reads as low solidity, the firm vane as high. The plume is
//       anchored at the calamus and contiguous, so the boundary is found by
//       walking up until the vane goes solid and stays solid.
//    5. CALAMUS from the width profile: the narrow bare base below the vane;
//       the rachis as a tapering bar of near-constant width around the ridge.
//    6. four SURFACE FIELDS measured per particle, not per band:
//         core   distance transform → how deep inside the silhouette
//         loose  local mask-boundary density → real fluff vs a clean rim
//         flow   structure tensor → the direction the barbs actually run
//         spine  distance from the fitted shaft → shaft vs vane
//    7. colour groups by COLOUR ALONE (position weighting would merge a
//       repeating marking into its surroundings), and PATTERN MARKINGS by
//       background subtraction — see patterns.ts.
//    8. a rough feather-TYPE label from the proportions.
// ============================================================================

import { findPatterns } from './patterns.ts';

export const PART = {
  calamus: 0,
  rachis: 1,
  barbs: 2, // pennaceous vane
  down: 3, // plumulaceous base
  eye: 4, // ocellus / strongest pattern zone
} as const;

export type FeatherKind = 'Flight' | 'Contour' | 'Semiplume' | 'Down' | 'Plume';

export interface PatternZone {
  cx: number; // feather-local centre
  cy: number;
  a: number; // semi-major, feather-local
  b: number; // semi-minor
  round: boolean;
  size: number;
}

export interface Anatomy {
  count: number;
  pos: Float32Array; // 2 per particle, feather-local (x right, y up; calamus y≈-1)
  rgb: Float32Array; // 3 per particle
  uv: Float32Array; // 2 per particle: u -1..1 across, v 0..1 along
  part: Float32Array; // PART.* per particle
  downy: Float32Array; // 0 firm pennaceous … 1 loose plumulaceous (structural)
  barb: Float32Array; // 2 per particle: unit barb tangent in feather-local space
  cluster: Float32Array;
  /**
   * 4 per particle — the SURFACE fields, measured from the photo:
   *   x  core   0 at the silhouette rim … 1 deep inside the vane
   *   y  loose  0 firm zipped barbs … 1 open fluff (local strand fragmentation)
   *   z  flow   0 barb direction guessed … 1 read straight off the striations
   *   w  spine  1 on the rachis/calamus shaft … 0 out in the vane
   */
  surf: Float32Array;
  /** 4 per particle: zone centre xy, phase 0..1, kind (0 none · 1 round · 2 stripe) */
  patA: Float32Array;
  /** 4 per particle: zone axis xy, along-coord -1..1, across-coord 0..1.6 */
  patB: Float32Array;
  /** 2 per particle: marking strength 0..1, marking order along the feather 0..1 */
  patC: Float32Array;
  palette: number[][];
  zones: PatternZone[];
  eyeCenter: [number, number] | null;
  aspect: number; // half-width of the cloud, for camera framing
  kind: FeatherKind;
  plumFrac: number; // fraction of the vane that is downy
}

const ANALYSIS_LONG_SIDE = 560; // also the particle source — higher = denser cloud
const TARGET_PARTICLES = 140_000;
const K = 6; // colour groups for the melody recolour (colour only, no position)
const KMEANS_TRAIN_STRIDE = 3;
const MAX_ZONES = 260; // markings kept — a barred feather has many
const BINS = 48;
const BARB_SWEEP = 0.42; // how much barbs lean toward the tip (tan of the angle)
const PROF = 41; // across-profile resolution used to hunt the rachis ridge

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load that image'));
    img.src = src;
  });
}

export interface AnalyzeOptions {
  /** pattern-scan sensitivity, 0 strict … 1 fine; 0.5 = default */
  sensitivity?: number;
}

export function analyzeAnatomy(img: HTMLImageElement, opts: AnalyzeOptions = {}): Anatomy {
  const sensitivity = Math.max(0, Math.min(1, opts.sensitivity ?? 0.5));
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const scale = ANALYSIS_LONG_SIDE / Math.max(iw, ih);
  const w = Math.max(8, Math.round(iw * scale));
  const h = Math.max(8, Math.round(ih * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;

  // ---- 1. mask ------------------------------------------------------------
  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) {
      hasAlpha = true;
      break;
    }
  }
  const corner = (cx: number, cy: number) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let y = cy; y < cy + 6 && y < h; y++)
      for (let x = cx; x < cx + 6 && x < w; x++) {
        const i = (y * w + x) * 4;
        r += data[i];
        g += data[i + 1];
        b += data[i + 2];
        n++;
      }
    return [r / n / 255, g / n / 255, b / n / 255];
  };
  const corners = [corner(0, 0), corner(w - 6, 0), corner(0, h - 6), corner(w - 6, h - 6)];
  const bg = [0, 1, 2].map((c) => (corners[0][c] + corners[1][c] + corners[2][c] + corners[3][c]) / 4);

  // Background by FLOOD FILL FROM THE BORDER, not by a per-pixel colour test.
  // A dark feather on a dark ground has regions that look like background in
  // isolation — a plain threshold eats them, punching holes straight through
  // the vane (and taking their patterns with them). The real background is the
  // region CONNECTED to the edge of the frame, so fill inward from the border
  // and keep everything the fill can't reach. Interior darks survive because
  // they are enclosed by feather.
  const bgLike = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (hasAlpha) {
        bgLike[y * w + x] = data[i + 3] < 100 ? 1 : 0;
      } else {
        const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
        const d = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
        bgLike[y * w + x] = d < 0.30 ? 1 : 0; // deliberately loose
      }
    }
  const isBg = new Uint8Array(w * h);
  {
    const q = new Int32Array(w * h);
    let head = 0, tail = 0;
    const push = (x: number, y: number) => {
      const k = y * w + x;
      if (isBg[k] || !bgLike[k]) return;
      isBg[k] = 1;
      q[tail++] = k;
    };
    for (let x = 0; x < w; x++) {
      push(x, 0);
      push(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      push(0, y);
      push(w - 1, y);
    }
    while (head < tail) {
      const k = q[head++];
      const x = k % w, y = (k / w) | 0;
      if (x > 0) push(x - 1, y);
      if (x < w - 1) push(x + 1, y);
      if (y > 0) push(x, y - 1);
      if (y < h - 1) push(x, y + 1);
    }
  }

  const gridIdx = new Int32Array(w * h).fill(-1);
  const xs: number[] = [];
  const ys: number[] = [];
  const cols: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (isBg[y * w + x]) continue;
      gridIdx[y * w + x] = xs.length;
      xs.push(x);
      ys.push(y);
      cols.push((y * w + x) * 4);
    }
  const n = xs.length;
  if (n < 400) throw new Error('could not find a feather in that image — try one on a plain background');

  // ---- 2. PCA → shaft axis ------------------------------------------------
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) {
    mx += xs[i];
    my += ys[i];
  }
  mx /= n;
  my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= n;
  sxy /= n;
  syy /= n;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const l1 = tr / 2 + Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  let ax = l1 - syy, ay = sxy;
  if (Math.abs(ax) + Math.abs(ay) < 1e-6) {
    ax = sxy;
    ay = l1 - sxx;
  }
  const alen = Math.hypot(ax, ay) || 1;
  ax /= alen;
  ay /= alen;
  const bx1 = -ay, by1 = ax;

  const along = new Float32Array(n);
  const across = new Float32Array(n);
  let aMin = Infinity, aMax = -Infinity;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    along[i] = dx * ax + dy * ay;
    across[i] = dx * bx1 + dy * by1;
    if (along[i] < aMin) aMin = along[i];
    if (along[i] > aMax) aMax = along[i];
  }
  const aSpan = aMax - aMin || 1;

  // ---- 3. width + orientation → UV ----------------------------------------
  // WIDTH MUST BE MEASURED INSIDE EACH BAND, not as distance from the axis.
  // The PCA axis is fixed by the vane, which is the heavy end; a bare quill
  // that leaves at a slight angle drifts further and further from that axis,
  // so |across| grows along it and a 2 px quill reports as "wide". That put
  // the calamus at the tip end on any feather whose shaft isn't dead straight.
  // Taking (max − min) inside the band measures the actual span instead.
  const bandW = (idx: (i: number) => number) => {
    const lo = new Float32Array(BINS).fill(Infinity);
    const hi = new Float32Array(BINS).fill(-Infinity);
    const cnt = new Float32Array(BINS);
    for (let i = 0; i < n; i++) {
      const b = idx(i);
      if (across[i] < lo[b]) lo[b] = across[i];
      if (across[i] > hi[b]) hi[b] = across[i];
      cnt[b]++;
    }
    const half = new Float32Array(BINS);
    for (let b = 0; b < BINS; b++) half[b] = cnt[b] ? (hi[b] - lo[b]) / 2 : 0;
    return { half, cnt };
  };
  const byAlong = bandW((i) => Math.min(BINS - 1, Math.floor(((along[i] - aMin) / aSpan) * BINS)));
  const endW = (from: number, to: number) => {
    let s = 0, m = 0;
    for (let b = from; b < to; b++) if (byAlong.cnt[b]) { s += byAlong.half[b]; m++; }
    return m ? s / m : 0;
  };
  const lowEnd = endW(0, 5);
  const highEnd = endW(BINS - 5, BINS);
  const flip = lowEnd > highEnd; // narrow end (calamus) must be v = 0

  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (along[i] - aMin) / aSpan;
    v[i] = flip ? 1 - t : t;
  }
  // width + solidity re-binned in v (so bin 0 = calamus end)
  const byV = bandW((i) => Math.min(BINS - 1, Math.floor(v[i] * BINS)));
  const halfW = byV.half; // half-width envelope, measured inside each band
  const binCnt = byV.cnt;
  // smooth the envelope a touch
  const halfWS = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    const a = halfW[Math.max(0, b - 1)], c = halfW[Math.min(BINS - 1, b + 1)];
    halfWS[b] = Math.max(2, (a + halfW[b] + c) / 3);
  }
  // ---- 3b. CALAMUS: the narrow bare quill at the base ---------------------
  // Found before anything else that talks about the vane, because a bare quill
  // is a thin FULL band — 100% solid — and would otherwise be mistaken for the
  // start of a firm vane the moment the width measurement got accurate.
  let maxHalf = 0;
  for (let b = 0; b < BINS; b++) maxHalf = Math.max(maxHalf, halfWS[b]);
  const baseHalf = halfWS[0];
  const calThresh = baseHalf + 0.14 * (maxHalf - baseHalf);
  let calTopBin = 0;
  for (let b = 0; b < Math.floor(BINS * 0.4); b++) {
    if (halfWS[b] <= calThresh) calTopBin = b;
    else break;
  }
  const calTopV = (calTopBin + 1) / BINS;
  const vaneFrom = Math.min(BINS - 1, calTopBin + 1);

  // SOLIDITY per bin: how filled the mask is inside its width envelope.
  // firm pennaceous vane ≈ 1; loose downy barbs leave gaps ≈ 0.3–0.5. Measured
  // over the VANE only — the quill's own solidity is not a vane reading.
  const binLen = aSpan / BINS;
  const solidity = new Float32Array(BINS);
  let solMax = 0.001;
  for (let b = 0; b < BINS; b++) {
    const area = binLen * 2 * halfWS[b];
    solidity[b] = area > 0 ? binCnt[b] / area : 0;
    if (b >= vaneFrom && solidity[b] > solMax) solMax = solidity[b];
  }
  for (let b = 0; b < BINS; b++) solidity[b] = Math.min(1.2, solidity[b] / solMax);

  // ---- 3c. THE SHAFT RIDGE — where the rachis actually runs ---------------
  // The PCA centroid is the centre of AREA, not the shaft. A flight feather has
  // a narrow leading vane and a wide trailing one, so its rachis sits well off
  // the area centre: centring the UV on the centroid puts the "rachis" band out
  // in the vane and normalises both halves by the wrong width. So look for the
  // shaft the way an eye does — a narrow luminance RIDGE near the middle of
  // each band — then fit a straight line through those hits, because a rachis
  // is straight in the shaft frame even when the vane around it isn't.
  const lumG = new Float32Array(w * h);
  for (let k = 0; k < w * h; k++) {
    const i = k * 4;
    lumG[k] = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
  }
  const shaft = new Float32Array(BINS); // across-offset of the shaft, px
  {
    const acc = new Float32Array(BINS * PROF);
    const cnt = new Float32Array(BINS * PROF);
    for (let i = 0; i < n; i++) {
      const b = Math.min(BINS - 1, Math.floor(v[i] * BINS));
      const t = Math.max(-1, Math.min(1, across[i] / halfWS[b]));
      const s = Math.round((t * 0.5 + 0.5) * (PROF - 1));
      acc[b * PROF + s] += lumG[ys[i] * w + xs[i]];
      cnt[b * PROF + s]++;
    }
    // ridge = profile minus a wide blur of itself; a shaft is a thin spike, the
    // vane's own shading is broad and cancels
    const hit = new Float32Array(BINS);
    const str = new Float32Array(BINS);
    const sgn = new Float32Array(BINS);
    const WIDE = Math.round(PROF / 4);
    for (let b = 0; b < BINS; b++) {
      const prof = new Float32Array(PROF);
      for (let s = 0; s < PROF; s++) prof[s] = cnt[b * PROF + s] ? acc[b * PROF + s] / cnt[b * PROF + s] : NaN;
      // fill gaps from the nearest valid sample so the blur stays honest
      let last = NaN;
      for (let s = 0; s < PROF; s++) { if (Number.isNaN(prof[s])) prof[s] = last; else last = prof[s]; }
      last = NaN;
      for (let s = PROF - 1; s >= 0; s--) { if (Number.isNaN(prof[s])) prof[s] = last; else last = prof[s]; }
      if (Number.isNaN(prof[0])) continue; // empty band
      let best = 0, bestV = 0;
      for (let s = Math.round(PROF * 0.2); s <= Math.round(PROF * 0.8); s++) {
        let sum = 0, m = 0;
        for (let d = -WIDE; d <= WIDE; d++) {
          const q = Math.max(0, Math.min(PROF - 1, s + d));
          sum += prof[q];
          m++;
        }
        const res = prof[s] - sum / m;
        if (Math.abs(res) > Math.abs(bestV)) { bestV = res; best = s; }
      }
      hit[b] = ((best / (PROF - 1)) * 2 - 1) * halfWS[b];
      str[b] = Math.abs(bestV);
      sgn[b] = Math.sign(bestV);
    }
    // one shaft, one polarity: a pale shaft is pale the whole way up. Drop the
    // bands that voted the other way rather than letting them drag the fit.
    let pos = 0, neg = 0;
    for (let b = 0; b < BINS; b++) (sgn[b] > 0 ? (pos += str[b]) : (neg += str[b]));
    const want = pos >= neg ? 1 : -1;
    // weighted least-squares line hit ≈ m·v + c, weight = ridge strength
    let sw = 0, swv = 0, swy = 0, swvv = 0, swvy = 0;
    for (let b = 0; b < BINS; b++) {
      if (sgn[b] !== want || str[b] < 0.012 || !binCnt[b]) continue;
      const vv = (b + 0.5) / BINS;
      const wgt = str[b];
      sw += wgt; swv += wgt * vv; swy += wgt * hit[b];
      swvv += wgt * vv * vv; swvy += wgt * vv * hit[b];
    }
    if (sw > 0.05) {
      const den = sw * swvv - swv * swv;
      const m = Math.abs(den) > 1e-6 ? (sw * swvy - swv * swy) / den : 0;
      const c = (swy - m * swv) / sw;
      for (let b = 0; b < BINS; b++) {
        const vv = (b + 0.5) / BINS;
        // never let the "shaft" wander past the middle of a vane half
        shaft[b] = Math.max(-halfWS[b] * 0.55, Math.min(halfWS[b] * 0.55, m * vv + c));
      }
    }
  }

  // each vane half gets its own half-width, measured from the shaft — that is
  // what makes u = ±1 mean "the outer edge" on BOTH sides of an asymmetric vane
  const halfL = new Float32Array(BINS).fill(2);
  const halfR = new Float32Array(BINS).fill(2);
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor(v[i] * BINS));
    const d = across[i] - shaft[b];
    if (d < 0) halfL[b] = Math.max(halfL[b], -d);
    else halfR[b] = Math.max(halfR[b], d);
  }
  for (const arr of [halfL, halfR]) {
    const sm = arr.slice();
    for (let b = 0; b < BINS; b++) {
      const a = sm[Math.max(0, b - 1)], c = sm[Math.min(BINS - 1, b + 1)];
      arr[b] = Math.max(2, (a + sm[b] + c) / 3);
    }
  }

  const u = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor(v[i] * BINS));
    const d = across[i] - shaft[b];
    u[i] = Math.max(-1.4, Math.min(1.4, d / (d < 0 ? halfL[b] : halfR[b])));
  }

  // ---- 3d. LOOSENESS — fluff measured, not assumed -------------------------
  // Zipped pennaceous vane is a solid sheet: inside a small window its only
  // mask boundary is the silhouette itself — one line across. Open
  // plumulaceous barbs are a hundred separate strands, so the same window is
  // full of edges. Counting boundary pixels per window tells them apart, and
  // unlike a plain solidity test it does not label every clean rim "downy".
  const looseM = new Float32Array(n);
  {
    const bnd = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (isBg[k]) continue;
        const up = y > 0 ? isBg[k - w] : 1;
        const dn = y < h - 1 ? isBg[k + w] : 1;
        const lf = x > 0 ? isBg[k - 1] : 1;
        const rt = x < w - 1 ? isBg[k + 1] : 1;
        if (up || dn || lf || rt) bnd[k] = 1;
      }
    const W1 = w + 1;
    const ii = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let row = 0;
      for (let x = 0; x < w; x++) {
        row += bnd[y * w + x];
        ii[(y + 1) * W1 + (x + 1)] = ii[y * W1 + (x + 1)] + row;
      }
    }
    const R = Math.max(3, Math.round(maxHalf * 0.13));
    const span = 2 * R + 1;
    for (let i = 0; i < n; i++) {
      const x0 = Math.max(0, xs[i] - R), y0 = Math.max(0, ys[i] - R);
      const x1 = Math.min(w - 1, xs[i] + R), y1 = Math.min(h - 1, ys[i] + R);
      const c =
        ii[(y1 + 1) * W1 + (x1 + 1)] - ii[y0 * W1 + (x1 + 1)] - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0];
      // one straight silhouette crossing contributes about `span` boundary
      // pixels; anything much above that is a window full of separate strands
      looseM[i] = smooth(1.3 * span, 3.5 * span, c);
    }
  }

  // per band, so the pennaceous/plumulaceous split can be decided on measured
  // fluff rather than on band solidity alone
  const looseBin = new Float32Array(BINS);
  {
    const c = new Float32Array(BINS);
    for (let i = 0; i < n; i++) {
      const b = Math.min(BINS - 1, Math.floor(v[i] * BINS));
      looseBin[b] += looseM[i];
      c[b]++;
    }
    for (let b = 0; b < BINS; b++) looseBin[b] = c[b] ? looseBin[b] / c[b] : 0;
  }

  // ---- 4. downiness: pennaceous (firm) vs plumulaceous (downy) -------------
  // The plume is ANCHORED AT THE CALAMUS and runs contiguously up — it never
  // reappears halfway along a firm vane. So find the downy/firm boundary by
  // walking up from the base until the vane goes solid and STAYS solid, and
  // treat everything above as pennaceous. Judging each band independently let
  // dark bands in a patterned vane read as "loose" and painted plume up the
  // middle of a flight feather.
  // "Firm" now means BOTH: the band fills its envelope, and its strands read
  // as zipped rather than fluffy. Solidity alone let a dark, sparse-looking
  // downy base pass as vane on some photos and vice versa.
  const isFirm = (b: number) => solidity[b] >= 0.55 && looseBin[b] < 0.42;
  let firmBin = vaneFrom;
  for (let b = vaneFrom; b < BINS; b++) {
    if (isFirm(b)) {
      // require it to hold, so one solid band inside the plume isn't the edge
      let holds = true;
      for (let c = b; c < Math.min(BINS, b + 3); c++) if (solidity[c] < 0.5 || looseBin[c] > 0.55) holds = false;
      if (holds) {
        firmBin = b;
        break;
      }
    }
    firmBin = b + 1;
  }
  const firmV = Math.min(0.6, (firmBin + 0.5) / BINS); // plume can't own the feather
  const downyBin = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    const vv = (b + 0.5) / BINS;
    // 1 below the boundary, easing off just above it
    downyBin[b] = smooth(firmV + 0.06, Math.max(0.01, firmV - 0.06), vv);
  }

  // ---- 5. SHAFT WIDTH ------------------------------------------------------
  // The rachis is a near-constant bar that starts as the bare quill and tapers
  // to nothing at the tip. Calling it "a fixed fraction of the local vane
  // width" made it fat where the vane was fat and vanish where the vane
  // narrowed — the exact opposite of a real shaft.
  const quillPx = Math.max(1.5, Math.min(halfWS[0], maxHalf * 0.16));
  const rachisPx = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) rachisPx[b] = Math.max(1.2, quillPx * (1 - 0.55 * ((b + 0.5) / BINS)));

  // ---- 6. EDGE DISTANCE ---------------------------------------------------
  // How deep inside the silhouette each point sits. Nearly all of a feather's
  // visible movement happens at its fringe; without this, a particle at the
  // rim and one on the rachis get the same treatment.
  const distPx = new Float32Array(n);
  {
    const INF = 1e9;
    const dt = new Float32Array(w * h);
    for (let k = 0; k < w * h; k++) dt[k] = isBg[k] ? 0 : INF;
    const D1 = 1, D2 = 1.4142136;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (dt[k] === 0) continue;
        let m = dt[k];
        if (x === 0 || y === 0) m = D1; // the frame edge cuts the feather off
        if (y > 0) {
          m = Math.min(m, dt[k - w] + D1);
          if (x > 0) m = Math.min(m, dt[k - w - 1] + D2);
          if (x < w - 1) m = Math.min(m, dt[k - w + 1] + D2);
        }
        if (x > 0) m = Math.min(m, dt[k - 1] + D1);
        dt[k] = m;
      }
    for (let y = h - 1; y >= 0; y--)
      for (let x = w - 1; x >= 0; x--) {
        const k = y * w + x;
        if (dt[k] === 0) continue;
        let m = dt[k];
        if (x === w - 1 || y === h - 1) m = Math.min(m, D1);
        if (y < h - 1) {
          m = Math.min(m, dt[k + w] + D1);
          if (x > 0) m = Math.min(m, dt[k + w - 1] + D2);
          if (x < w - 1) m = Math.min(m, dt[k + w + 1] + D2);
        }
        if (x < w - 1) m = Math.min(m, dt[k + 1] + D1);
        dt[k] = m;
      }
    for (let i = 0; i < n; i++) distPx[i] = dt[ys[i] * w + xs[i]];
  }

  // ---- 7. BARB FLOW — the direction the barbs actually run ----------------
  // Read off the photo's own striations with a structure tensor instead of
  // assuming one fixed diagonal for the whole feather. The tensor's SMALL
  // eigenvector points along the strands. Where the texture is too smooth to
  // tell — plain vane, blown highlight — coherence falls and we lean back on
  // the geometric guess.
  const flowX = new Float32Array(n);
  const flowY = new Float32Array(n);
  const flowC = new Float32Array(n);
  {
    const W1 = w + 1;
    const iXX = new Float64Array(W1 * (h + 1));
    const iXY = new Float64Array(W1 * (h + 1));
    const iYY = new Float64Array(W1 * (h + 1));
    const iNN = new Float64Array(W1 * (h + 1));
    for (let y = 0; y < h; y++) {
      let rxx = 0, rxy = 0, ryy = 0, rn = 0;
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        // sample the gradient only where the whole stencil is feather — the
        // silhouette is a huge edge and would drown out the barb texture
        if (
          x > 0 && x < w - 1 && y > 0 && y < h - 1 &&
          !isBg[k] && !isBg[k - 1] && !isBg[k + 1] && !isBg[k - w] && !isBg[k + w]
        ) {
          const gx = (lumG[k + 1] - lumG[k - 1]) * 0.5;
          const gy = (lumG[k + w] - lumG[k - w]) * 0.5;
          rxx += gx * gx;
          rxy += gx * gy;
          ryy += gy * gy;
          rn += 1;
        }
        const o = (y + 1) * W1 + (x + 1), up = y * W1 + (x + 1);
        iXX[o] = iXX[up] + rxx;
        iXY[o] = iXY[up] + rxy;
        iYY[o] = iYY[up] + ryy;
        iNN[o] = iNN[up] + rn;
      }
    }
    const box = (ii: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
      ii[(y1 + 1) * W1 + (x1 + 1)] - ii[y0 * W1 + (x1 + 1)] - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0];
    const R = Math.max(2, Math.round(maxHalf * 0.07));
    const tipSign = flip ? -1 : 1;
    for (let i = 0; i < n; i++) {
      const x0 = Math.max(0, xs[i] - R), y0 = Math.max(0, ys[i] - R);
      const x1 = Math.min(w - 1, xs[i] + R), y1 = Math.min(h - 1, ys[i] + R);
      const cN = box(iNN, x0, y0, x1, y1);
      if (cN < 6) continue;
      const Jxx = box(iXX, x0, y0, x1, y1) / cN;
      const Jxy = box(iXY, x0, y0, x1, y1) / cN;
      const Jyy = box(iYY, x0, y0, x1, y1) / cN;
      const tr2 = (Jxx + Jyy) / 2;
      const disc = Math.sqrt(Math.max(0, tr2 * tr2 - (Jxx * Jyy - Jxy * Jxy)));
      const l1 = tr2 + disc, l2 = tr2 - disc;
      if (l1 < 1e-9) continue;
      let ex = Jxy, ey = l2 - Jxx;
      if (Math.abs(ex) + Math.abs(ey) < 1e-9) {
        ex = l2 - Jyy;
        ey = Jxy;
      }
      const el = Math.hypot(ex, ey);
      if (el < 1e-9) continue;
      ex /= el;
      ey /= el;
      // point it outward from the shaft, tie-broken toward the tip
      const b = Math.min(BINS - 1, Math.floor(v[i] * BINS));
      const side = across[i] - shaft[b] >= 0 ? 1 : -1;
      const outX = side * bx1, outY = side * by1;
      const tipX = tipSign * ax, tipY = tipSign * ay;
      if (ex * outX + ey * outY + 0.35 * (ex * tipX + ey * tipY) < 0) {
        ex = -ex;
        ey = -ey;
      }
      flowX[i] = ex;
      flowY[i] = ey;
      // coherent AND actually textured — a flat patch can be "coherent" by noise
      flowC[i] = ((l1 - l2) / (l1 + l2)) * smooth(2e-4, 5e-3, l1);
    }
  }

  // ---- 8. colour groups — COLOUR ONLY, no position ------------------------
  // These drive the melody recolour: "all the gold", "all the dark blue".
  // Position must NOT enter here. Weighting by position makes clusters
  // spatially compact, which is exactly wrong for a marking that repeats up
  // the feather — the gold chevrons get absorbed into the blue around them.
  const train: number[][] = [];
  for (let i = 0; i < n; i += KMEANS_TRAIN_STRIDE) {
    const ci = cols[i];
    train.push([data[ci] / 255, data[ci + 1] / 255, data[ci + 2] / 255]);
  }
  const { centers } = kmeans(train, K);
  const assign = new Int16Array(n);
  const feat = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const ci = cols[i];
    feat[0] = data[ci] / 255;
    feat[1] = data[ci + 1] / 255;
    feat[2] = data[ci + 2] / 255;
    let bi = 0, bd = Infinity;
    for (let c = 0; c < K; c++) {
      const d = dist2(feat, centers[c], 3);
      if (d < bd) {
        bd = d;
        bi = c;
      }
    }
    assign[i] = bi;
  }
  const palette: number[][] = centers
    .map((c) => [c[0], c[1], c[2]])
    .map((c) => ({ c, lum: 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] }))
    .sort((p, q) => q.lum - p.lum)
    .map((p) => p.c);

  // ---- 9. pattern markings: background subtraction (see patterns.ts) ------
  let maxHalfPx = 0;
  for (let b = 0; b < BINS; b++) maxHalfPx = Math.max(maxHalfPx, halfWS[b]);
  const { compOf, markings } = findPatterns({
    w, h, data, gridIdx, n, xs, ys, cols, halfWidthPx: maxHalfPx, sensitivity,
  });
  // keep the biggest markings — a fine scan is allowed to keep more of them
  const maxZones = Math.round(MAX_ZONES * (0.5 + sensitivity));
  const order = markings
    .map((m, id) => ({ m, id }))
    .sort((p, q) => q.m.size - p.m.size)
    .slice(0, maxZones);
  const remap = new Int32Array(markings.length).fill(-1);
  order.forEach((e, newId) => (remap[e.id] = newId));
  const zoneOf = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const c = compOf[i];
    zoneOf[i] = c >= 0 ? remap[c] : -1;
  }

  // ocellus: the biggest ROUND marking sitting toward the tip — a peacock eye
  // wins on size and roundness without any colour assumption.
  let eyeZone = -1;
  {
    let bestSize = n * 0.004;
    order.forEach((e, newId) => {
      const m = e.m;
      if (!m.round || m.size < bestSize) return;
      const vv = (() => {
        const dx = m.cx - mx, dy = m.cy - my;
        const t = ((dx * ax + dy * ay) - aMin) / aSpan;
        return flip ? 1 - t : t;
      })();
      if (vv < 0.4) return;
      bestSize = m.size;
      eyeZone = newId;
    });
  }

  // ---- 10. assemble particles ----------------------------------------------
  const keep = new Uint8Array(n);
  {
    let acc = 0;
    const rate = Math.min(1, TARGET_PARTICLES / n);
    for (let i = 0; i < n; i++) {
      acc += rate;
      if (acc >= 1) {
        acc -= 1;
        keep[i] = 1;
      }
    }
  }
  let count = 0;
  for (let i = 0; i < n; i++) count += keep[i];

  const pos = new Float32Array(count * 2);
  const rgb = new Float32Array(count * 3);
  const uvA = new Float32Array(count * 2);
  const partA = new Float32Array(count);
  const downyA = new Float32Array(count);
  const barbA = new Float32Array(count * 2);
  const clusterA = new Float32Array(count);
  const surfA = new Float32Array(count * 4);
  const patAArr = new Float32Array(count * 4);
  const patBArr = new Float32Array(count * 4);
  const patCArr = new Float32Array(count * 2);

  const halfSpan = aSpan / 2;
  const toLocal = (pxx: number, pyy: number): [number, number] => {
    const dx = pxx - mx, dy = pyy - my;
    const a = dx * ax + dy * ay;
    const c = dx * bx1 + dy * by1;
    const t = (a - aMin) / aSpan;
    return [c / halfSpan, (flip ? 1 - t : t) * 2 - 1];
  };
  // direction transform: both local axes scale by 1/halfSpan, and the along
  // axis flips when the calamus was at the far end
  const ysign = flip ? -1 : 1;
  const dirLocal = (dx: number, dy: number): [number, number] => {
    const cx2 = dx * bx1 + dy * by1;
    const cy2 = ysign * (dx * ax + dy * ay);
    const l = Math.hypot(cx2, cy2) || 1;
    return [cx2 / l, cy2 / l];
  };

  interface ZoneGeom extends PatternZone {
    ux: number;
    uy: number;
    str: number; // 0..1, how bold this marking is against its surroundings
    seq: number; // 0 at the calamus … 1 at the tip — the cascade order
  }
  let maxStr = 1e-4;
  for (const e of order) maxStr = Math.max(maxStr, e.m.str);
  const zoneGeom: ZoneGeom[] = order.map((e) => {
    const m = e.m;
    const [cx, cy] = toLocal(m.cx, m.cy);
    const [ux, uy] = dirLocal(m.ux, m.uy);
    return {
      cx, cy, ux, uy,
      a: Math.max(0.008, m.a / halfSpan),
      b: Math.max(0.006, m.b / halfSpan),
      round: m.round,
      size: m.size,
      str: Math.min(1, m.str / maxStr),
      seq: Math.max(0, Math.min(1, (cy + 1) * 0.5)),
    };
  });
  const zones: PatternZone[] = zoneGeom;
  const eyeCenter: [number, number] | null = eyeZone >= 0 ? [zoneGeom[eyeZone].cx, zoneGeom[eyeZone].cy] : null;

  let maxX = 0.001;
  let leftArea = 0, rightArea = 0, plumCount = 0, vaneCount = 0;
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const x = across[i] / halfSpan;
    const y = v[i] * 2 - 1;
    pos[j * 2] = x;
    pos[j * 2 + 1] = y;
    if (Math.abs(x) > maxX) maxX = Math.abs(x);
    const ci = cols[i];
    rgb[j * 3] = data[ci] / 255;
    rgb[j * 3 + 1] = data[ci + 1] / 255;
    rgb[j * 3 + 2] = data[ci + 2] / 255;
    uvA[j * 2] = u[i];
    uvA[j * 2 + 1] = v[i];
    clusterA[j] = assign[i];

    const bnorm = Math.min(BINS - 1, Math.floor(v[i] * BINS));
    const downy = downyBin[bnorm];
    downyA[j] = downy;

    // ---- surface fields ---------------------------------------------------
    const dShaft = Math.abs(across[i] - shaft[bnorm]);
    const spine = smooth(rachisPx[bnorm] * 1.7, rachisPx[bnorm] * 0.7, dShaft);
    const core = Math.min(1, distPx[i] / Math.max(3, 0.35 * halfWS[bnorm]));
    // structural downiness and measured fluff both count; the shaft is never
    // loose no matter what the texture around it does
    const loose = Math.max(0, Math.min(1, (0.55 * downy + 0.8 * looseM[i]) * (1 - spine * 0.9)));
    surfA[j * 4] = core;
    surfA[j * 4 + 1] = loose;
    surfA[j * 4 + 2] = Math.min(1, flowC[i]);
    surfA[j * 4 + 3] = spine;

    // barb tangent: outward from the SHAFT (not the area centre), leaning
    // further toward the tip the higher up the vane you are — that is how a
    // real vane fans. Where the striations were legible, the measured flow
    // takes over from the guess.
    const sweep = BARB_SWEEP * (0.55 + 1.05 * v[i]);
    let bxv = u[i] >= 0 ? 1 : -1;
    let byv = sweep;
    let bl = Math.hypot(bxv, byv) || 1;
    bxv /= bl;
    byv /= bl;
    const trust = smooth(0.1, 0.45, flowC[i]);
    if (trust > 0.001) {
      const [fx, fy] = dirLocal(flowX[i], flowY[i]);
      bxv += (fx - bxv) * trust;
      byv += (fy - byv) * trust;
      bl = Math.hypot(bxv, byv) || 1;
      bxv /= bl;
      byv /= bl;
    }
    barbA[j * 2] = bxv;
    barbA[j * 2 + 1] = byv;

    // pattern zone attributes: centre + axis + this point's place within the
    // marking, so a round zone can ring outward and a bar can ripple along
    const zid = zoneOf[i];
    if (zid >= 0) {
      const z = zoneGeom[zid];
      const dx = x - z.cx, dy = y - z.cy;
      const alongZ = (dx * z.ux + dy * z.uy) / z.a; // -1..1 down the marking
      const acrossZ = Math.abs(-dx * z.uy + dy * z.ux) / z.b; // 0..~1 across it
      patAArr[j * 4] = z.cx;
      patAArr[j * 4 + 1] = z.cy;
      patAArr[j * 4 + 2] = (zid * 0.618) % 1; // phase
      patAArr[j * 4 + 3] = z.round ? 1 : 2; // kind
      patBArr[j * 4] = z.ux;
      patBArr[j * 4 + 1] = z.uy;
      patBArr[j * 4 + 2] = Math.max(-1.4, Math.min(1.4, alongZ));
      patBArr[j * 4 + 3] = Math.min(1.6, z.round ? Math.hypot(dx, dy) / (z.a * 1.15) : acrossZ);
      patCArr[j * 2] = z.str;
      patCArr[j * 2 + 1] = z.seq;
    } else {
      patAArr[j * 4 + 3] = 0; // kind 0 = not part of any marking
    }

    // part label (for the eye pulse, rigidity and the readout)
    let part: number = PART.barbs;
    if (eyeZone >= 0 && zid === eyeZone) part = PART.eye;
    else if (v[i] < calTopV) part = PART.calamus;
    else if (spine > 0.55) part = PART.rachis;
    // down is decided PER PARTICLE. The band walk only ever finds a full-width
    // plume at the base; a flight feather's afterfeather is a tuft off one
    // side, and averaged across its band it disappears entirely.
    else if (downy > 0.5 || looseM[i] > 0.55) part = PART.down;
    partA[j] = part;

    // stats for the feather-type label
    if (part === PART.barbs || part === PART.down) {
      vaneCount++;
      if (part === PART.down) plumCount++;
      // sides measured about the SHAFT, so vane asymmetry is real asymmetry
      if (u[i] < 0) leftArea++;
      else rightArea++;
    }
    j++;
  }

  const plumFrac = vaneCount ? plumCount / vaneCount : 0;
  const asymmetry = leftArea + rightArea ? Math.abs(leftArea - rightArea) / (leftArea + rightArea) : 0;
  const halfWidth = maxX;
  // Type from the proportions. The old test called anything narrower than 0.28
  // a plume — which is nearly every feather ever photographed, since width over
  // length is about 0.2 for a normal one. What actually separates a wing
  // feather is ASYMMETRY: the leading vane is narrower than the trailing one.
  // A plume is the rare case: narrow, symmetric and loose.
  let kind: FeatherKind;
  if (plumFrac > 0.70) kind = 'Down';
  else if (plumFrac > 0.35) kind = halfWidth > 0.22 ? 'Contour' : 'Semiplume';
  else if (asymmetry > 0.16) kind = 'Flight'; // one vane clearly wider — wing/tail
  else if (halfWidth < 0.12) kind = 'Plume';
  else kind = 'Contour';

  return {
    count,
    pos,
    rgb,
    uv: uvA,
    part: partA,
    downy: downyA,
    barb: barbA,
    cluster: clusterA,
    surf: surfA,
    patA: patAArr,
    patB: patBArr,
    patC: patCArr,
    palette,
    zones,
    eyeCenter,
    aspect: maxX,
    kind,
    plumFrac,
  };
}

function smooth(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ---- plain k-means ---------------------------------------------------------
function kmeans(pts: number[][], k: number): { assign: Int16Array; centers: number[][] } {
  const n = pts.length;
  const dim = pts[0].length;
  const centers: number[][] = [];
  centers.push(pts[Math.floor(n / 2)].slice());
  while (centers.length < k) {
    let far = 0, farD = -1;
    for (let i = 0; i < n; i += 7) {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, dist2(pts[i], c, dim));
      if (d > farD) {
        farD = d;
        far = i;
      }
    }
    centers.push(pts[far].slice());
  }
  const assign = new Int16Array(n);
  for (let iter = 0; iter < 8; iter++) {
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const d = dist2(pts[i], centers[c], dim);
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      assign[i] = bi;
    }
    const sums = centers.map(() => new Array(dim + 1).fill(0));
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      for (let d = 0; d < dim; d++) s[d] += pts[i][d];
      s[dim]++;
    }
    for (let c = 0; c < k; c++) {
      if (!sums[c][dim]) continue;
      for (let d = 0; d < dim; d++) centers[c][d] = sums[c][d] / sums[c][dim];
    }
  }
  return { assign, centers };
}

function dist2(a: number[], b: number[], dim: number): number {
  let s = 0;
  for (let d = 0; d < dim; d++) {
    const t = a[d] - b[d];
    s += t * t;
  }
  return s;
}
