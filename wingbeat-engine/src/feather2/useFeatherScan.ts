import { libraryShaftGuide } from './shaftGuides';
import { useEffect, useRef, useState } from 'react';
import { loadImage, readFeatherPixels, type Anatomy } from './anatomy.ts';

export interface Specimen { src: string; label: string }

/** A new selection discards stale decoded images and terminates the previous worker. */
export function useFeatherScan(source: Specimen, sensitivity: number, particleCount: number) {
  const [result, setResult] = useState<{ anatomy: Anatomy; source: Specimen; elapsed: number } | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const cache = useRef<{ src: string; particleCount: number; pixels: ImageData } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let worker: Worker | undefined;
    setBusy(true);
    setError('');
    const timer = window.setTimeout(async () => {
      try {
        let pixels = cache.current?.src === source.src && cache.current.particleCount === particleCount ? cache.current.pixels : null;
        if (!pixels) {
          const img = await loadImage(source.src);
          if (cancelled) return;
          pixels = readFeatherPixels(img, particleCount);
          cache.current = { src: source.src, particleCount, pixels };
        }
        if (cancelled) return;
        const start = performance.now();
        worker = new Worker(new URL('./anatomy.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<{ anatomy?: Anatomy; error?: string }>) => {
          if (cancelled) return;
          if (data.anatomy) setResult({ anatomy: data.anatomy, source, elapsed: performance.now() - start });
          else setError(data.error || 'The feather could not be analysed.');
          setBusy(false);
          worker?.terminate();
        };
        worker.onerror = () => {
          if (!cancelled) { setError('Analysis could not start. Try selecting the feather again.'); setBusy(false); }
          worker?.terminate();
        };
        worker.postMessage({ pixels, options: { sensitivity, particleCount, shaftGuide: libraryShaftGuide(source.src) } });
      } catch (err) {
        worker?.terminate();
        if (!cancelled) { setError(err instanceof Error ? err.message : 'Could not read this image.'); setBusy(false); }
      }
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); worker?.terminate(); };
  }, [source, sensitivity, particleCount]);

  return { result, busy, error };
}
