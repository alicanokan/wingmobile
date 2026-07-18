// ============================================================================
//  Feather color analysis — how the engine "understands" an uploaded feather.
//
//  Given a feather photo (shot on black), we extract its dominant COLOR GROUPS
//  via k-means over the non-black pixels. The result is a small palette that
//  the color-channel sensors bind to, so each sensor can drive a real color
//  found in that specific feather (the white group, the gold group, …).
//
//  Clustering is POSITION-AWARE: each pixel carries its normalized (x,y) in
//  addition to (r,g,b), weighted by POS_WEIGHT. Pure color-only k-means happily
//  lumps a feather's tip-white together with its base-white into one "layer"
//  that then flickers across two unrelated regions at once. Nudging the metric
//  with position keeps a layer anchored to one coherent anatomical patch (the
//  tip, one side of the vane, …) even when two patches share a color.
//
//  Returns palette as rgb in 0..1, sorted brightest-first (slot 0 ≈ the lightest
//  / "white" group), which is what SENSOR_CHANNELS' colorSlot indexes into.
// ============================================================================

const DARK_CUTOFF = 0.12; // ignore the black background
const SAMPLE_W = 60; // downscale width for speed
const POS_WEIGHT = 0.45; // 0 = color-only (old behavior), 1 = position dominates color

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

  // collect non-dark pixels, carrying normalized position alongside color so
  // the clusters stay spatially coherent (see POS_WEIGHT above).
  const pts: number[][] = [];
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255;
    const g = data[i + 1] / 255;
    const b = data[i + 2] / 255;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < DARK_CUTOFF) continue;
    const px = (i / 4) % w;
    const py = Math.floor(i / 4 / w);
    pts.push([r, g, b, (px / Math.max(1, w - 1)) * POS_WEIGHT, (py / Math.max(1, h - 1)) * POS_WEIGHT]);
  }
  if (pts.length < k) return { palette: fallbackPalette(), counts: [1, 1, 1, 1] };

  // cluster in [r,g,b,x,y] space, then drop the position dims — the palette
  // itself is still a pure color, just chosen by a spatially-aware grouping.
  const palette = kmeans(pts, k, 8).map((c) => c.slice(0, 3));
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
  const dim = pts[0]?.length ?? 3;
  // deterministic spread init: pick evenly across luminance-sorted points
  const sorted = [...pts].sort((a, b) => lumOf(a) - lumOf(b));
  const centroids: number[][] = [];
  for (let i = 0; i < k; i++) {
    centroids.push(sorted[Math.floor(((i + 0.5) / k) * (sorted.length - 1))].slice());
  }

  for (let it = 0; it < iters; it++) {
    const sums = Array.from({ length: k }, () => new Array(dim + 1).fill(0)); // …dims, count
    for (const p of pts) {
      let best = 0;
      let bestD = Infinity;
      for (let c = 0; c < k; c++) {
        let d = 0;
        for (let dd = 0; dd < dim; dd++) {
          const diff = p[dd] - centroids[c][dd];
          d += diff * diff;
        }
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      const s = sums[best];
      for (let dd = 0; dd < dim; dd++) s[dd] += p[dd];
      s[dim] += 1;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c][dim] > 0) {
        centroids[c] = sums[c].slice(0, dim).map((v) => v / sums[c][dim]);
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
