// ============================================================================
//  Pattern recognition — what the markings on a feather actually are.
//
//  A feather's pattern is NOT a colour cluster. The vane carries a smooth
//  shading gradient (bright near the rachis, falling off to the edges, warm at
//  the tip), and the MARKINGS are local departures from it: chevron bars, spot
//  rows, an ocellus, a pale tip band. Clustering colour lumps a marking in with
//  whatever it sits next to; adding position makes it worse, because one stripe
//  pattern repeats at many positions.
//
//  So instead:
//    1. estimate the smooth background — a wide, mask-aware box blur (via
//       integral images, so the radius is free)
//    2. residual = pixel − background. Markings pop; shading cancels.
//    3. threshold the residual adaptively, keeping the SIGN: light markings
//       and dark bars are separate features and must not merge
//    4. connected components → one per marking
//    5. PCA per component → centroid, major/minor axis, elongation. A bar is
//       elongated; an eye is round. They pulse differently:
//         round  → concentric rings out of the centre
//         stripe → a wave running ALONG the bar, displacing across it, so a
//                  barred feather ripples like plucked strings
// ============================================================================

export interface Marking {
  cx: number; // image space
  cy: number;
  /** unit major axis, image space */
  ux: number;
  uy: number;
  a: number; // semi-major (px)
  b: number; // semi-minor (px)
  size: number;
  elong: number;
  round: boolean;
  sign: number; // +1 lighter than background, -1 darker
}

export interface PatternResult {
  /** component id per mask pixel, -1 = plain vane */
  compOf: Int32Array;
  markings: Marking[];
}

interface Input {
  w: number;
  h: number;
  data: Uint8ClampedArray;
  /** pixel index in the flat mask lists, -1 = background */
  gridIdx: Int32Array;
  n: number;
  xs: number[];
  ys: number[];
  cols: number[];
  /** typical half-width of the feather in px — sets the background scale */
  halfWidthPx: number;
  /** 0 strict (only bold markings) … 1 fine (dig out faint speckles); 0.5 = default */
  sensitivity?: number;
}

export function findPatterns(inp: Input): PatternResult {
  const { w, h, data, gridIdx, n, xs, ys, cols, halfWidthPx } = inp;
  const sens = Math.max(0, Math.min(1, inp.sensitivity ?? 0.5));

  // ---- 1. integral images (mask-aware) -----------------------------------
  const W1 = w + 1;
  const iiR = new Float64Array(W1 * (h + 1));
  const iiG = new Float64Array(W1 * (h + 1));
  const iiB = new Float64Array(W1 * (h + 1));
  const iiC = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowR = 0, rowG = 0, rowB = 0, rowC = 0;
    for (let x = 0; x < w; x++) {
      const inM = gridIdx[y * w + x] >= 0;
      if (inM) {
        const i = (y * w + x) * 4;
        rowR += data[i];
        rowG += data[i + 1];
        rowB += data[i + 2];
        rowC += 1;
      }
      const o = (y + 1) * W1 + (x + 1);
      const up = y * W1 + (x + 1);
      iiR[o] = iiR[up] + rowR;
      iiG[o] = iiG[up] + rowG;
      iiB[o] = iiB[up] + rowB;
      iiC[o] = iiC[up] + rowC;
    }
  }
  const boxSum = (ii: Float64Array, x0: number, y0: number, x1: number, y1: number) =>
    ii[(y1 + 1) * W1 + (x1 + 1)] - ii[y0 * W1 + (x1 + 1)] - ii[(y1 + 1) * W1 + x0] + ii[y0 * W1 + x0];

  // ---- 2. MULTI-SCALE residual -------------------------------------------
  // One blur radius only ever finds markings SMALLER than itself: a broad
  // chevron band wider than the radius drags the background estimate along
  // with it and the residual cancels to nothing. So sample several scales —
  // fine speckles, mid bars, broad bands — and keep the strongest response at
  // each pixel. That is what lets a feather with both delicate tip flecks and
  // wide gold bands report both.
  const scales = [0.28, 0.7, 1.7, 3.4]
    .map((f) => Math.round(halfWidthPx * f))
    .map((r) => Math.max(3, Math.min(150, r)))
    .filter((r, i, a) => a.indexOf(r) === i);

  const dev = new Float32Array(n);
  const sign = new Int8Array(n);
  for (const R of scales) {
    for (let k = 0; k < n; k++) {
      const x = xs[k], y = ys[k];
      const x0 = Math.max(0, x - R), y0 = Math.max(0, y - R);
      const x1 = Math.min(w - 1, x + R), y1 = Math.min(h - 1, y + R);
      const c = boxSum(iiC, x0, y0, x1, y1);
      if (c < 4) continue;
      const br = boxSum(iiR, x0, y0, x1, y1) / c;
      const bgc = boxSum(iiG, x0, y0, x1, y1) / c;
      const bb = boxSum(iiB, x0, y0, x1, y1) / c;
      const i = cols[k];
      const pr = data[i], pg = data[i + 1], pb = data[i + 2];
      const dL = (0.299 * pr + 0.587 * pg + 0.114 * pb - (0.299 * br + 0.587 * bgc + 0.114 * bb)) / 255;
      const dC = (Math.abs(pr - br) + Math.abs(pg - bgc) + Math.abs(pb - bb)) / (3 * 255);
      const d = Math.max(Math.abs(dL), dC * 0.9);
      if (d > dev[k]) {
        dev[k] = d;
        sign[k] = dL >= 0 ? 1 : -1;
      }
    }
  }

  // ---- 3. adaptive threshold ---------------------------------------------
  let mean = 0;
  for (let k = 0; k < n; k++) mean += dev[k];
  mean /= n || 1;
  let sd = 0;
  for (let k = 0; k < n; k++) sd += (dev[k] - mean) * (dev[k] - mean);
  sd = Math.sqrt(sd / (n || 1));
  // Sensitivity slides both the absolute floor and how far above the mean a
  // residual must sit. At 0.5 this is exactly the old fixed threshold; toward
  // 1 it digs out faint speckles, toward 0 it keeps only the boldest markings.
  const thresh = Math.max(0.006 + 0.024 * (1 - sens), mean + (0.45 - 0.6 * sens) * sd);

  // ---- 4. connected components, sign-separated ---------------------------
  const compOf = new Int32Array(n).fill(-1);
  const comps: Array<{ px: number[]; sign: number }> = [];
  {
    const stack: number[] = [];
    for (let seed = 0; seed < n; seed++) {
      if (compOf[seed] !== -1 || dev[seed] < thresh) continue;
      const s = sign[seed];
      const id = comps.length;
      const px: number[] = [];
      stack.length = 0;
      stack.push(seed);
      compOf[seed] = id;
      while (stack.length) {
        const p = stack.pop()!;
        px.push(p);
        const x = xs[p], y = ys[p];
        for (let d = 0; d < 8; d++) {
          const nx = x + ((d & 1) ? 1 : 0) - ((d & 2) ? 1 : 0);
          const ny = y + ((d & 4) ? 1 : 0) - ((d & 8) ? 1 : 0);
          if (nx === x && ny === y) continue;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const gi = gridIdx[ny * w + nx];
          if (gi < 0 || compOf[gi] !== -1) continue;
          if (dev[gi] < thresh || sign[gi] !== s) continue;
          compOf[gi] = id;
          stack.push(gi);
        }
      }
      comps.push({ px, sign: s });
    }
  }

  // ---- 5. shape per component --------------------------------------------
  // minimum marking size follows sensitivity: a fine scan keeps small flecks,
  // a strict one drops them (×1 at 0.5, ×4 at 0, ×0.25 at 1)
  const fine = Math.pow(4, 1 - 2 * sens);
  const minSize = Math.max(4, Math.round(Math.max(12, n * 0.00015) * fine));
  const markings: Marking[] = [];
  const remap = new Int32Array(comps.length).fill(-1);
  comps.forEach((c, id) => {
    if (c.px.length < minSize) return;
    let mx = 0, my = 0;
    for (const p of c.px) {
      mx += xs[p];
      my += ys[p];
    }
    const cnt = c.px.length;
    mx /= cnt;
    my /= cnt;
    let sxx = 0, sxy = 0, syy = 0;
    for (const p of c.px) {
      const dx = xs[p] - mx, dy = ys[p] - my;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
    }
    sxx /= cnt;
    sxy /= cnt;
    syy /= cnt;
    const tr = sxx + syy;
    const det = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
    const l1 = tr / 2 + disc;
    const l2 = Math.max(1e-6, tr / 2 - disc);
    let ux = l1 - syy, uy = sxy;
    if (Math.abs(ux) + Math.abs(uy) < 1e-6) {
      ux = 1;
      uy = 0;
    }
    const ul = Math.hypot(ux, uy) || 1;
    ux /= ul;
    uy /= ul;
    const a = 2 * Math.sqrt(l1);
    const b = 2 * Math.sqrt(l2);
    const elong = a / Math.max(0.8, b);
    remap[id] = markings.length;
    markings.push({
      cx: mx,
      cy: my,
      ux,
      uy,
      a: Math.max(1, a),
      b: Math.max(0.8, b),
      size: cnt,
      elong,
      round: elong < 2.2,
      sign: c.sign,
    });
  });

  // renumber compOf to the kept markings
  for (let k = 0; k < n; k++) {
    const c = compOf[k];
    compOf[k] = c >= 0 ? remap[c] : -1;
  }

  return { compOf, markings };
}
