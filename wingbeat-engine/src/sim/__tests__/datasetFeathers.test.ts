import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { FEATHERS } from '../feathers.ts';
import { DATASET_FEATHERS, DATASET_SOURCES } from '../datasetFeathers.ts';
import { analyzePixels } from '../../feather2/anatomy.ts';

// pngjs comes in through the QR dependency; the anatomy tests decode PNGs the same way.
const { PNG } = createRequire(import.meta.url)('pngjs');
type Decoded = { width: number; height: number; data: Uint8Array; colorType: number };
const publicFile = (src: string) => new URL(`../../../public${src}`, import.meta.url);
const thumbOf = (src: string) => src.replace('/feathers/', '/feathers/thumbs/');
const decode = (src: string) => PNG.sync.read(readFileSync(publicFile(src))) as Decoded;

function downscale(input: Decoded, longSide = 560) {
  const scale = longSide / Math.max(input.width, input.height);
  const width = Math.round(input.width * scale), height = Math.round(input.height * scale);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (Math.min(input.height - 1, Math.floor(y / scale)) * input.width + Math.min(input.width - 1, Math.floor(x / scale))) * 4;
    data.set(input.data.subarray(offset, offset + 4), (y * width + x) * 4);
  }
  return { width, height, data };
}

describe('dataset feathers catalogue', () => {
  it('joins the collection after the built-ins, with unique ids', () => {
    const ids = FEATHERS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    const firstDataset = FEATHERS.findIndex((f) => f.dataset);
    expect(firstDataset).toBeGreaterThan(0);
    expect(FEATHERS.slice(firstDataset).every((f) => f.dataset)).toBe(true);
    expect(FEATHERS.slice(firstDataset).map((f) => f.id)).toEqual(DATASET_FEATHERS.map((f) => f.id));
  });

  it('names a species and a known source for every feather, and uses both datasets', () => {
    for (const f of DATASET_FEATHERS) {
      expect(f.id).toMatch(/^ds-[a-z0-9-]+$/);
      expect(f.src).toBe(`/feathers/dataset/${f.id.slice(3)}.png`);
      expect(f.label.length).toBeGreaterThan(0);
      expect(f.species).toMatch(/^[A-Z][a-z]+ [a-z]+$/);
      expect(DATASET_SOURCES[f.dataset]).toBeDefined();
      expect(f.original.length).toBeGreaterThan(0);
    }
    expect(new Set(DATASET_FEATHERS.map((f) => f.dataset))).toEqual(new Set(Object.keys(DATASET_SOURCES)));
  });

  it('credits every image and both datasets in the licence file', () => {
    const licence = readFileSync(publicFile('/feathers/dataset/LICENSE.md'), 'utf8');
    expect(licence).toContain('A.V. Belko, K.S. Dobratulin');
    expect(licence).toContain('Mirek Lasota and Arda Mavi');
    expect(licence).toContain('CC BY-NC-SA 4.0');
    expect(licence).toContain('non-commercial research purposes');
    for (const f of DATASET_FEATHERS) {
      expect(licence).toContain(`${f.id.slice(3)}.png`);
      expect(licence).toContain(f.original);
    }
  });
});

describe.each(DATASET_FEATHERS.map((f) => [f.id, f] as const))('dataset feather %s', (_id, f) => {
  it('has a 900 px RGBA image and a 150 px thumbnail', () => {
    expect(existsSync(publicFile(f.src))).toBe(true);
    expect(existsSync(publicFile(thumbOf(f.src)))).toBe(true);
    const image = decode(f.src), thumb = decode(thumbOf(f.src));
    expect(image.height).toBe(900);
    expect(image.width).toBeLessThan(image.height);
    expect(thumb.height).toBe(150);
    expect(image.colorType).toBe(6); // RGBA
  });

  it('is cut out on black: clear corners and no colour hiding under transparency', () => {
    const { width, height, data } = decode(f.src);
    for (const [x, y] of [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]]) expect(data[(y * width + x) * 4 + 3]).toBe(0);
    let opaque = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) expect(data[i] + data[i + 1] + data[i + 2]).toBe(0);
      else opaque++;
    }
    expect(opaque / (width * height)).toBeGreaterThan(0.2);
  });

  it('analyses into a complete particle feather like the built-ins', () => {
    const anatomy = analyzePixels(downscale(decode(f.src)));
    expect(anatomy.count).toBeGreaterThan(400);
    expect(anatomy.pos.length).toBe(anatomy.count * 2);
    expect(anatomy.rgb.length).toBe(anatomy.count * 3);
    expect(anatomy.aspect).toBeGreaterThan(0);
    expect(Array.from(anatomy.pos.subarray(0, 200)).every(Number.isFinite)).toBe(true);
  });
});
