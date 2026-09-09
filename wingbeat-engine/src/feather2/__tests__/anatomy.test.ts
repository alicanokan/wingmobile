import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { analyzePixels } from '../anatomy.ts';
import { libraryShaftGuide } from '../shaftGuides.ts';
import { describeAnatomy } from '../analysisReport.ts';

// pngjs is already present through the app's QR dependency. This decodes the
// actual collection without a DOM or a second image-analysis implementation.
const { PNG } = createRequire(import.meta.url)('pngjs');
function specimen(name: string, longSide = 560) {
  const input = PNG.sync.read(readFileSync(new URL(`../../../public/feathers/${name}.png`, import.meta.url))) as { width: number; height: number; data: Uint8Array };
  const scale = longSide / Math.max(input.width, input.height);
  const width = Math.round(input.width * scale), height = Math.round(input.height * scale);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (Math.min(input.height - 1, Math.floor(y / scale)) * input.width + Math.min(input.width - 1, Math.floor(x / scale))) * 4;
    data.set(input.data.subarray(offset, offset + 4), (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('worker-compatible feather analysis', () => {
  it.each(['01f', '10f', '20f', 'air-study'])('recovers a finite, complete cloud from collection specimen %s', (name) => {
    const image = specimen(name);
    const anatomy = analyzePixels(image);
    expect(anatomy.count).toBeGreaterThan(400);
    expect(anatomy.count).toBeLessThanOrEqual(140000);
    expect(anatomy.pos.length).toBe(anatomy.count * 2);
    expect(anatomy.formZ.length).toBe(anatomy.count);
    // A marking crossing the measured shaft must never steal its rigid role.
    for (let i = 0; i < anatomy.count; i++) {
      if (anatomy.surf[i * 4 + 3] > 0.55) expect([0, 1]).toContain(anatomy.part[i]);
    }
    expect(anatomy.rgb.length).toBe(anatomy.count * 3);
    expect(anatomy.surf.length).toBe(anatomy.count * 4);
    expect(anatomy.pattern.length).toBe(anatomy.count);
    expect(anatomy.aspect).toBeGreaterThan(0);
    const patches = anatomy.photoPoints!;
    expect(patches.uv.length).toBe(anatomy.count * 2);
    expect(patches.uv.every(v => Number.isFinite(v) && v >= 0 && v <= 1)).toBe(true);
    expect(patches.basis.every(Number.isFinite)).toBe(true);
    expect(patches.footprint).toBeGreaterThan(0);
    expect(patches.worldSize).toBeGreaterThan(0);
    // Every pair retains its photographed distance under one rigid transform.
    // Row-dependent straightening would fail this even with correct UV colours.
    for (let i = 0; i < anatomy.count - 1; i += 137) {
      const j = Math.min(anatomy.count - 1, i + 311);
      const sourceDistance = Math.hypot((patches.uv[i * 2] - patches.uv[j * 2]) * image.width, (patches.uv[i * 2 + 1] - patches.uv[j * 2 + 1]) * image.height) * patches.worldSize;
      const restDistance = Math.hypot(anatomy.pos[i * 2] - anatomy.pos[j * 2], anatomy.pos[i * 2 + 1] - anatomy.pos[j * 2 + 1]);
      expect(restDistance).toBeCloseTo(sourceDistance, 5);
    }
    const surface = anatomy.photoSurface!;
    expect(surface.positions.length).toBe((surface.columns + 1) * (surface.rows + 1) * 3);
    expect(surface.positions.every(Number.isFinite)).toBe(true);
    expect(surface.nearest.every(index => index < anatomy.count)).toBe(true);
    expect(surface.mask.length).toBe(surface.width * surface.height);
    expect(surface.mask.some(value => value === 255)).toBe(true);
    expect(surface.mask[0]).toBe(0);
    // The full photograph spans the calamus-to-tip frame, without inverted rows.
    const ys = Array.from(surface.positions).filter((_, i) => i % 3 === 1);
    expect(Math.max(...ys)).toBeGreaterThan(0.9);
    expect(Math.min(...ys)).toBeLessThan(-0.9);
    for (const field of [anatomy.pos, anatomy.formZ, anatomy.uv, anatomy.rgb, anatomy.surf, anatomy.patA, anatomy.patB, anatomy.patC]) {
      expect(field.every(Number.isFinite)).toBe(true);
    }
    expect(Math.max(...anatomy.formZ.map(Math.abs))).toBeGreaterThan(0.008);
    // A palette sorted by brightness must remap its cluster IDs as well.
    for (let i = 0; i < anatomy.count; i += 71) {
      const color = anatomy.rgb.subarray(i * 3, i * 3 + 3);
      const distances = anatomy.palette.map((entry) => entry.reduce((sum, channel, c) => sum + (channel - color[c]) ** 2, 0));
      expect(distances[anatomy.cluster[i]]).toBeCloseTo(Math.min(...distances), 5);
    }
    const report = describeAnatomy(anatomy);
    expect(report.parts.reduce((a, b) => a + b)).toBe(anatomy.count);
    expect(report.palette.reduce((a, b) => a + b)).toBe(anatomy.count);
    expect(report.patterns.reduce((a, b) => a + b)).toBeLessThanOrEqual(anatomy.count);
    expect(report.left + report.right).toBeCloseTo(1);
    expect(report.clarity).toBeGreaterThanOrEqual(0);
    expect(report.clarity).toBeLessThanOrEqual(1);
  });
  it('rejects blank and undersized inputs with useful errors', () => {
    expect(() => analyzePixels({ width: 32, height: 32, data: new Uint8ClampedArray(32 * 32 * 4) })).toThrow('plain background');
    expect(() => analyzePixels({ width: 1, height: 1, data: new Uint8ClampedArray(4) })).toThrow('too small');
  });
  it('preserves very dark feather pigment on a true black plate', () => {
    const width = 80, height = 120;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    for (let y = 10; y < 112; y++) for (let x = 14; x < 66; x++) {
      const nx = (x - 40) / (25 * (0.55 + 0.45 * Math.sin(y / 120 * Math.PI)));
      const ny = (y - 58) / 53;
      if (nx * nx + ny * ny > 1) continue;
      const offset = (y * width + x) * 4;
      data[offset] = 12;
      data[offset + 1] = 2;
      data[offset + 2] = 2;
    }
    const anatomy = analyzePixels({ width, height, data }, { particleCount: 24_000 });
    expect(anatomy.count).toBeGreaterThan(1200);
    expect(anatomy.rgb.some((channel) => channel > 0.04)).toBe(true);
  });
  it.each([
    ['01f', [[70, 100], [63, 200], [57, 300], [50, 420]]],
    ['04f', [[68, 100], [69, 220], [71, 340], [73, 420]]],
    ['02f', [[79, 80], [74, 180], [71, 300], [70, 420]]],
  ] as const)('keeps the scan on photographed shaft landmarks in %s', (name, landmarks) => {
    // Hand-inspected landmarks in the 560px source photograph. This catches
    // traces that stay finite but jump into bright vane markings or base fluff.
    const trace = analyzePixels(specimen(name)).shaftTrace!;
    for (const [x, y] of landmarks) {
      let nearest = 0;
      for (let i = 2; i < trace.length; i += 2) {
        if (Math.abs(trace[i + 1] - y) < Math.abs(trace[nearest + 1] - y)) nearest = i;
      }
      expect(Math.abs(trace[nearest] - x)).toBeLessThan(4);
    }
  });
  it.each([960, 1405, 1814])('preserves photographed shaft guides at %ipx detail', (longSide) => {
    for (const name of ['01f', '05f', '10f']) {
      const image = specimen(name, longSide);
      const guide = libraryShaftGuide(`/feathers/${name}.png`)!;
      const a = analyzePixels(image, { shaftGuide: guide });
      for (let k = 4; k < a.shaftTrace!.length - 4; k += 2) {
        const x = a.shaftTrace![k] / image.width, y = a.shaftTrace![k + 1] / image.height;
        let best = Infinity;
        for (let i = 1; i < guide.length; i++) {
          const [ax, ay] = guide[i - 1], [bx, by] = guide[i];
          const t = Math.max(0, Math.min(1, (y - ay) / (by - ay)));
          best = Math.min(best, Math.hypot((x - ax - t * (bx - ax)) * image.width, (y - ay - t * (by - ay)) * image.height));
        }
        expect(best / longSide).toBeLessThan(.003);
      }
    }
  }, 30000);
  it('never applies library guides to uploads', () => {
    expect(libraryShaftGuide('blob:01f.png')).toBeUndefined();
    expect(libraryShaftGuide('/uploads/01f.png')).toBeUndefined();
  });
  it('follows a photographed curved shaft rather than imposing a straight line', () => {
    const width = 160, height = 320, data = new Uint8ClampedArray(width * height * 4);
    const centre = (y: number) => 70 + 17 * Math.sin((1 - y / height) * Math.PI * 1.4);
    for (let y = 8; y < 312; y++) for (let x = 0; x < width; x++) {
      const v = 1 - y / height, dx = x - centre(y);
      const bare = v < .19;
      const widthScale = Math.sin(Math.PI * Math.min(1, (v - .12) / .88));
      if (Math.abs(dx) > 2 && (bare || dx < -16 * widthScale || dx > 31 * widthScale)) continue;
      const value = Math.abs(dx) < 1.8 ? 240 : 65;
      data.set([value, value, value, 255], (y * width + x) * 4);
    }
    const anatomy = analyzePixels({ width, height, data });
    const errors: number[] = [];
    for (let i = 0; i < anatomy.count; i++) if (anatomy.part[i] === 1) {
      const x = anatomy.photoPoints!.uv[i * 2] * width - .5;
      const y = (1 - anatomy.photoPoints!.uv[i * 2 + 1]) * height - .5;
      errors.push(Math.abs(x - centre(y)));
    }
    expect(errors.length).toBeGreaterThan(100);
    expect(errors.reduce((a, b) => a + b, 0) / errors.length).toBeLessThan(3);
    expect(Math.max(...anatomy.shaftX!) - Math.min(...anatomy.shaftX!)).toBeGreaterThan(.025);
  });
  it('maps the recovered rachis to one continuous 3D centreline', () => {
    const anatomy = analyzePixels(specimen('04f'));
    const rachisX: number[] = [];
    const spineX: number[] = [];
    const rachisLum: number[] = [];
    const vaneLum: number[] = [];
    let left = 0, right = 0;
    for (let i = 0; i < anatomy.count; i++) {
      const x = anatomy.pos[i * 2] - (anatomy.shaftX?.[i] ?? 0);
      const lum = 0.299 * anatomy.rgb[i * 3] + 0.587 * anatomy.rgb[i * 3 + 1] + 0.114 * anatomy.rgb[i * 3 + 2];
      if (anatomy.part[i] === 1) { rachisX.push(Math.abs(x)); rachisLum.push(lum); }
      if (anatomy.surf[i * 4 + 3] > 0.8) spineX.push(Math.abs(x));
      if (anatomy.part[i] === 2) { x < 0 ? left++ : right++; vaneLum.push(lum); }
    }
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
    expect(rachisX.length).toBeGreaterThan(100);
    expect(mean(rachisX)).toBeLessThan(0.04);
    expect(mean(spineX)).toBeLessThan(0.035);
    expect(mean(rachisLum)).toBeGreaterThan(mean(vaneLum) + 0.12);
    expect(left).toBeGreaterThan(100);
    expect(right).toBeGreaterThan(100);
  });
});
