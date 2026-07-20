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
//    3. feather-local UV: v 0..1 base→tip, u -1..1 across the vane
//    4. per-band SOLIDITY (mask fill inside the width envelope) → the downy
//       base reads as low solidity, the firm vane as high. The plume is
//       anchored at the calamus and contiguous, so the boundary is found by
//       walking up until the vane goes solid and stays solid.
//    5. CALAMUS from the width profile: the narrow bare base below the vane.
//    6. per-particle BARB TANGENT: the real diagonal a barb runs, so motion
//       travels along the barbs instead of as noise.
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
  downy: Float32Array; // 0 firm pennaceous … 1 loose plumulaceous
  barb: Float32Array; // 2 per particle: unit barb tangent in feather-local space
  cluster: Float32Array;
  /** 4 per particle: zone centre xy, phase 0..1, kind (0 none · 1 round · 2 stripe) */
  patA: Float32Array;
  /** 4 per particle: zone axis xy, along-coord -1..1, across-coord 0..1.6 */
  patB: Float32Array;
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

export async function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not load that image'));
    img.src = src;
  });
}

export function analyzeAnatomy(img: HTMLImageElement): Anatomy {
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
  const cnt0 = new Float32Array(BINS);
  const wsum = new Float32Array(BINS);
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor(((along[i] - aMin) / aSpan) * BINS));
    wsum[b] += Math.abs(across[i]);
    cnt0[b]++;
  }
  const meanW = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) meanW[b] = cnt0[b] ? wsum[b] / cnt0[b] : 0;
  const lowEnd = (meanW[0] + meanW[1] + meanW[2]) / 3;
  const highEnd = (meanW[BINS - 1] + meanW[BINS - 2] + meanW[BINS - 3]) / 3;
  const flip = lowEnd > highEnd; // narrow end (calamus) must be v = 0

  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = (along[i] - aMin) / aSpan;
    v[i] = flip ? 1 - t : t;
  }
  // width + solidity re-binned in v (so bin 0 = calamus end)
  const halfW = new Float32Array(BINS); // half-width envelope
  const binCnt = new Float32Array(BINS);
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor(v[i] * BINS));
    halfW[b] = Math.max(halfW[b], Math.abs(across[i]));
    binCnt[b]++;
  }
  // smooth the envelope a touch
  const halfWS = new Float32Array(BINS);
  for (let b = 0; b < BINS; b++) {
    const a = halfW[Math.max(0, b - 1)], c = halfW[Math.min(BINS - 1, b + 1)];
    halfWS[b] = Math.max(2, (a + halfW[b] + c) / 3);
  }
  // SOLIDITY per bin: how filled the mask is inside its width envelope.
  // firm pennaceous vane ≈ 1; loose downy barbs leave gaps ≈ 0.3–0.5.
  const binLen = aSpan / BINS;
  const solidity = new Float32Array(BINS);
  let solMax = 0.001;
  for (let b = 0; b < BINS; b++) {
    const area = binLen * 2 * halfWS[b];
    solidity[b] = area > 0 ? binCnt[b] / area : 0;
    if (solidity[b] > solMax) solMax = solidity[b];
  }
  for (let b = 0; b < BINS; b++) solidity[b] /= solMax; // 0..1

  const u = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = Math.min(BINS - 1, Math.floor(v[i] * BINS));
    u[i] = Math.max(-1.4, Math.min(1.4, across[i] / halfWS[b]));
  }

  // ---- 4. downiness: pennaceous (firm) vs plumulaceous (downy) -------------
  // The plume is ANCHORED AT THE CALAMUS and runs contiguously up — it never
  // reappears halfway along a firm vane. So find the downy/firm boundary by
  // walking up from the base until the vane goes solid and STAYS solid, and
  // treat everything above as pennaceous. Judging each band independently let
  // dark bands in a patterned vane read as "loose" and painted plume up the
  // middle of a flight feather.
  let firmBin = 0;
  for (let b = 0; b < BINS; b++) {
    if (solidity[b] >= 0.58) {
      // require it to hold, so one solid band inside the plume isn't the edge
      let holds = true;
      for (let c = b; c < Math.min(BINS, b + 3); c++) if (solidity[c] < 0.5) holds = false;
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

  // ---- 5. calamus: the narrow bare quill at the base ----------------------
  // Walk up from v=0 while the width stays close to the base (shaft-only)
  // width — that stretch has no vane, so it is calamus.
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

  // ---- 6. colour groups — COLOUR ONLY, no position ------------------------
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

  // ---- 7. pattern markings: background subtraction (see patterns.ts) ------
  let maxHalfPx = 0;
  for (let b = 0; b < BINS; b++) maxHalfPx = Math.max(maxHalfPx, halfWS[b]);
  const { compOf, markings } = findPatterns({
    w, h, data, gridIdx, n, xs, ys, cols, halfWidthPx: maxHalfPx,
  });
  // keep the biggest MAX_ZONES markings
  const order = markings
    .map((m, id) => ({ m, id }))
    .sort((p, q) => q.m.size - p.m.size)
    .slice(0, MAX_ZONES);
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

  // ---- 8. assemble particles ----------------------------------------------
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
  const patAArr = new Float32Array(count * 4);
  const patBArr = new Float32Array(count * 4);

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
  }
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
    };
  });
  const zones: PatternZone[] = zoneGeom;
  const eyeCenter: [number, number] | null = eyeZone >= 0 ? [zoneGeom[eyeZone].cx, zoneGeom[eyeZone].cy] : null;

  // barb sweep sign follows the axis flip (barbs always lean toward the tip)
  const sweepY = flip ? -BARB_SWEEP : BARB_SWEEP;

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

    // barb tangent: from the rachis outward (sign of u) with a sweep toward
    // the tip. In feather-local space y grows toward the tip already.
    let bxv = u[i] >= 0 ? 1 : -1;
    let byv = sweepY;
    const bl = Math.hypot(bxv, byv) || 1;
    bxv /= bl;
    byv /= bl;
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
    } else {
      patAArr[j * 4 + 3] = 0; // kind 0 = not part of any marking
    }

    // part label (for the eye pulse, rigidity and the readout)
    let part: number = PART.barbs;
    if (eyeZone >= 0 && zid === eyeZone) part = PART.eye;
    else if (v[i] < calTopV) part = PART.calamus;
    else if (Math.abs(u[i]) < 0.06) part = PART.rachis;
    else if (downy > 0.5) part = PART.down;
    partA[j] = part;

    // stats for the feather-type label
    if (part === PART.barbs || part === PART.down) {
      vaneCount++;
      if (downy > 0.5) plumCount++;
      if (x < 0) leftArea++;
      else rightArea++;
    }
    j++;
  }

  const plumFrac = vaneCount ? plumCount / vaneCount : 0;
  const asymmetry = leftArea + rightArea ? Math.abs(leftArea - rightArea) / (leftArea + rightArea) : 0;
  const halfWidth = maxX;
  let kind: FeatherKind;
  if (plumFrac > 0.78) kind = 'Down';
  else if (plumFrac > 0.42) kind = halfWidth > 0.5 ? 'Contour' : 'Semiplume';
  else if (halfWidth < 0.28) kind = 'Plume';
  else kind = 'Flight'; // long firm vane (wing/tail)
  void asymmetry;

  return {
    count,
    pos,
    rgb,
    uv: uvA,
    part: partA,
    downy: downyA,
    barb: barbA,
    cluster: clusterA,
    patA: patAArr,
    patB: patBArr,
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
