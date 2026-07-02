// ============================================================================
//  Feather color analysis — how the engine "understands" an uploaded feather.
//
//  Given a feather photo (shot on black), we extract its dominant COLOR GROUPS
//  via k-means over the non-black pixels. The result is a small palette that
//  the color-channel sensors bind to, so each sensor can drive a real color
//  found in that specific feather (the white group, the gold group, …).
//
//  Returns palette as rgb in 0..1, sorted brightest-first (slot 0 ≈ the lightest
//  / "white" group), which is what SENSOR_CHANNELS' colorSlot indexes into.
// ============================================================================

const DARK_CUTOFF = 0.12; // ignore the black background
const SAMPLE_W = 60; // downscale width for speed

export interface FeatherAnalysis {
  palette: number[][]; // k entries, each [r,g,b] in 0..1, brightest-first
  counts: number[]; // pixels nearest to each palette color (the "layers")
}

export function analyzeFeatherImage(img: HTMLImageElement | HTMLCanvasElement, k = 4): FeatherAnalysis {
  const iw = (img as HTMLImageElement).naturalWidth || img.width;
  const ih = (img as HTMLImageElement).naturalHeight || img.height;
  const aspect = ih ? iw / ih : 0.3;
  const w = SAMPLE_W;
  const h = Math.max(1, Math.round(w / (aspect || 0.3)));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return { palette: fallbackPalette(), counts: [1, 1, 1, 1] };
  ctx.drawImage(img, 0, 0, w, h);

  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return { palette: fallbackPalette(), counts: [1, 1, 1, 1] }; // tainted canvas
  }

  // collect non-dark pixels
  const pts: number[][] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < DARK_CUTOFF) continue;
    pts.push([r, g, b]);
  }
  if (pts.length < k) return { palette: fallbackPalette(), counts: [1, 1, 1, 1] };

  const palette = kmeans(pts, k, 8);
  // sort brightest-first so slot 0 is the lightest group
  palette.sort((a, b) => lumOf(b) - lumOf(a));

  // count how many pixels belong to each layer (group)
  const counts = new Array(palette.length).fill(0);
  for (const p of pts) {
    let best = 0;
    let bd = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const dr = p[0] - palette[k][0];
      const dg = p[1] - palette[k][1];
      const db = p[2] - palette[k][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) {
        bd = d;
        best = k;
      }
    }
    counts[best]++;
  }
  return { palette, counts };
}

function lumOf(c: number[]) {
  return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
}

function kmeans(pts: number[][], k: number, iters: number): number[][] {
  // deterministic spread init: pick evenly across luminance-sorted points
  const sorted = [...pts].sort((a, b) => lumOf(a) - lumOf(b));
  const centroids: number[][] = [];
  for (let i = 0; i < k; i++) {
    centroids.push(sorted[Math.floor(((i + 0.5) / k) * (sorted.length - 1))].slice());
  }

  for (let it = 0; it < iters; it++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]); // r,g,b,count
    for (const p of pts) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dr = p[0] - centroids[c][0];
        const dg = p[1] - centroids[c][1];
        const db = p[2] - centroids[c][2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const s = sums[best];
      s[0] += p[0];
      s[1] += p[1];
      s[2] += p[2];
      s[3] += 1;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][3] > 0) {
        centroids[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      }
    }
  }
  return centroids;
}

function fallbackPalette(): number[][] {
  return [
    [0.95, 0.93, 0.88],
    [0.8, 0.6, 0.3],
    [0.5, 0.35, 0.2],
    [0.25, 0.2, 0.15],
  ];
}
