// ============================================================================
//  Photo-feather forming — Higgsfield's reconstruction rules, kept anatomical.
//
//  Their engine builds a body, not a stamp of surviving pixels:
//    • background is the studio plate at each row's edges, not a global colour
//    • only border-connected plate is removed, so enclosed pigment survives
//    • tiny gaps inside an otherwise solid vane are closed
//    • rest pose already has camber, a rounded shaft, and down scatter
//
//  We keep our rachis / vane / pattern analysis. This file only forms the
//  silhouette and the rest-space thickness those fields hang from.
// ============================================================================

export function estimateRowBackground(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
): Float32Array {
  const row = new Float32Array(h * 6);
  for (let y = 0; y < h; y++) {
    const left = y * w;
    const inset = Math.min(2, w - 1);
    const right = left + w - 1;
    const innerRight = left + Math.max(0, w - 3);
    for (let k = 0; k < 3; k++) {
      row[y * 6 + k] = (data[left * 4 + k] + data[(left + inset) * 4 + k]) / 2;
      row[y * 6 + 3 + k] = (data[right * 4 + k] + data[innerRight * 4 + k]) / 2;
    }
  }
  return row;
}

/** True when a pixel is the studio plate, using Higgsfield's per-row edge test. */
export function matchesRowPlate(
  data: Uint8ClampedArray | Uint8Array,
  w: number,
  i: number,
  rowBg: Float32Array,
  threshold: number,
): boolean {
  const y = (i / w) | 0;
  let left = 0, right = 0, brightness = 0;
  for (let k = 0; k < 3; k++) {
    const v = data[i * 4 + k];
    brightness = Math.max(brightness, v);
    left = Math.max(left, Math.abs(v - rowBg[y * 6 + k]));
    right = Math.max(right, Math.abs(v - rowBg[y * 6 + 3 + k]));
  }
  return brightness <= threshold || (brightness < 100 && Math.min(left, right) <= threshold);
}

export function floodFromBorder(bgLike: Uint8Array, w: number, h: number): Uint8Array {
  const isBg = new Uint8Array(w * h);
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
  return isBg;
}

/**
 * Close hairline cracks inside a zipped vane. Large cut-outs and downy
 * spacing reach the silhouette or exceed the local gap cap, so they stay open.
 */
export function closeSmallRowGaps(isBg: Uint8Array, w: number, h: number, filled?: Uint8Array): number {
  let recovered = 0;
  for (let y = 0; y < h; y++) {
    let left = w, right = -1;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!isBg[row + x]) {
        if (x < left) left = x;
        right = x;
      }
    }
    if (right < left) continue;
    const maxGap = Math.max(2, Math.min(7, Math.round((right - left + 1) * 0.035)));
    let x = left;
    while (x <= right) {
      if (!isBg[row + x]) {
        x++;
        continue;
      }
      const gapStart = x;
      while (x <= right && isBg[row + x]) x++;
      if (x - gapStart <= maxGap && gapStart > left && x <= right) {
        for (let gx = gapStart; gx < x; gx++) {
          isBg[row + gx] = 0;
          if (filled) filled[row + gx] = 1;
          recovered++;
        }
      }
    }
  }
  return recovered;
}

/** Pull a studio-coloured interior pixel toward neighbouring vane pigment. */
export function readFormedColor(
  data: Uint8ClampedArray | Uint8Array,
  isBg: Uint8Array,
  rowBg: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
  threshold: number,
  filled?: Uint8Array,
): [number, number, number] {
  const sample = (sx: number, sy: number) => {
    const i = (sy * w + sx) * 4;
    return [data[i] / 255, data[i + 1] / 255, data[i + 2] / 255] as [number, number, number];
  };
  const own = sample(x, y);
  if (!filled?.[y * w + x] || !matchesRowPlate(data, w, y * w + x, rowBg, threshold)) return own;
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (isBg[ny * w + nx]) continue;
      if (matchesRowPlate(data, w, ny * w + nx, rowBg, threshold)) continue;
      const c = sample(nx, ny);
      r += c[0];
      g += c[1];
      b += c[2];
      n++;
    }
  }
  return n ? [r / n, g / n, b / n] : own;
}

/**
 * Rest-space thickness copied from Higgsfield's photo constructor, scaled to
 * our UV frame. Mid-vane dishes, the shaft stands proud, down scatters.
 */
export function formedRestZ(
  u: number,
  v: number,
  x: number,
  spine: number,
  loose: number,
  hw: number,
  seed: number,
): number {
  const s = Math.max(0, Math.min(1, v));
  const width = Math.max(0.05, hw);
  const camber = Math.cos(x * 2.15) * Math.sin(s * Math.PI) * width * 0.22;
  const ridge = spine * width * 0.16 * Math.sqrt(Math.max(0, 1 - Math.min(1, Math.abs(u) * 3)));
  const puff = (seed - 0.5) * 2 * loose * width * 0.28;
  return camber + ridge + puff;
}

export function formSeed(x: number, y: number): number {
  return ((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 + 1) % 1;
}
