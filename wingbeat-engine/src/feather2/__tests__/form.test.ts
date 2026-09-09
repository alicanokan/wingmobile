import { describe, expect, it } from 'vitest';
import {
  closeSmallRowGaps,
  estimateRowBackground,
  floodFromBorder,
  formedRestZ,
  matchesRowPlate,
} from '../form.ts';
import { analyzePixels } from '../anatomy.ts';

function plate(width: number, height: number, paint: (data: Uint8ClampedArray) => void) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  paint(data);
  return { width, height, data };
}

describe('Higgsfield-style photo forming', () => {
  it('treats row-edge grey as studio plate without eating a brighter interior', () => {
    const { width, height, data } = plate(40, 30, (pixels) => {
      for (let y = 0; y < 30; y++) {
        for (let x = 0; x < 40; x++) {
          const i = (y * 40 + x) * 4;
          const edge = x < 2 || x > 37;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = edge ? 22 : 18;
        }
      }
      for (let y = 6; y < 24; y++) for (let x = 12; x < 28; x++) {
        const i = (y * 40 + x) * 4;
        pixels[i] = 90;
        pixels[i + 1] = 70;
        pixels[i + 2] = 40;
      }
    });
    const rowBg = estimateRowBackground(data, width, height);
    expect(matchesRowPlate(data, width, 15 * width + 1, rowBg, 28)).toBe(true);
    expect(matchesRowPlate(data, width, 15 * width + 20, rowBg, 28)).toBe(false);
  });

  it('closes hairline vane cracks and leaves large cut-outs open', () => {
    const width = 48, height = 16;
    const isBg = new Uint8Array(width * height).fill(1);
    for (let y = 4; y < 12; y++) {
      for (let x = 6; x <= 20; x++) isBg[y * width + x] = 0;
      for (let x = 23; x < 42; x++) isBg[y * width + x] = 0;
    }
    const recovered = closeSmallRowGaps(isBg, width, height);
    expect(recovered).toBeGreaterThan(0);
    expect(isBg[8 * width + 21]).toBe(0);
    expect(isBg[8 * width + 22]).toBe(0);

    const open = new Uint8Array(width * height).fill(1);
    for (let y = 4; y < 12; y++) {
      for (let x = 4; x < 16; x++) open[y * width + x] = 0;
      for (let x = 32; x < 44; x++) open[y * width + x] = 0;
    }
    closeSmallRowGaps(open, width, height);
    expect(open[8 * width + 24]).toBe(1);
  });

  it('floods only border-connected plate so enclosed pigment remains a body', () => {
    const bgLike = new Uint8Array(12 * 12).fill(1);
    for (let y = 3; y < 9; y++) for (let x = 3; x < 9; x++) bgLike[y * 12 + x] = 0;
    bgLike[6 * 12 + 6] = 1;
    const isBg = floodFromBorder(bgLike, 12, 12);
    expect(isBg[0]).toBe(1);
    expect(isBg[6 * 12 + 6]).toBe(0);
    expect(isBg[5 * 12 + 5]).toBe(0);
  });

  it('gives mid-vane more rest thickness than the calamus, and a proud shaft', () => {
    const tip = formedRestZ(0.2, 0.02, 0.04, 0.9, 0, 0.25, 0.5);
    const mid = formedRestZ(0.2, 0.5, 0.04, 0.2, 0, 0.25, 0.5);
    const shaft = formedRestZ(0, 0.5, 0, 1, 0, 0.25, 0.5);
    expect(Math.abs(mid)).toBeGreaterThan(Math.abs(tip));
    expect(shaft).toBeGreaterThan(mid);
  });

  it('forms a continuous rest body from a cracked studio feather', () => {
    const width = 90, height = 130;
    const image = plate(width, height, (pixels) => {
      for (let y = 8; y < 122; y++) {
        const t = (y - 8) / 114;
        const half = Math.round(10 + 16 * Math.sin(Math.PI * t));
        for (let x = 45 - half; x <= 45 + half; x++) {
          if (x === 45 && y > 20 && y < 110 && y % 11 === 0) continue;
          const i = (y * width + x) * 4;
          pixels[i] = 210;
          pixels[i + 1] = 196;
          pixels[i + 2] = 168;
        }
        pixels[(y * width + 45) * 4] = 236;
        pixels[(y * width + 45) * 4 + 1] = 232;
        pixels[(y * width + 45) * 4 + 2] = 220;
      }
    });
    const anatomy = analyzePixels(image, { particleCount: 24_000 });
    expect(anatomy.formZ.length).toBe(anatomy.count);
    expect(anatomy.formZ.every(Number.isFinite)).toBe(true);
    const mid: number[] = [];
    const ends: number[] = [];
    for (let i = 0; i < anatomy.count; i++) {
      const v = anatomy.uv[i * 2 + 1];
      if (v > 0.4 && v < 0.6) mid.push(Math.abs(anatomy.formZ[i]));
      if (v < 0.08 || v > 0.92) ends.push(Math.abs(anatomy.formZ[i]));
    }
    expect(mid.length).toBeGreaterThan(40);
    expect(ends.length).toBeGreaterThan(20);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean(mid)).toBeGreaterThan(mean(ends));
  });
});
