import { analyzePixels, type AnalyzeOptions } from './anatomy.ts';

self.onmessage = ({ data }: MessageEvent<{ pixels: ImageData; options: AnalyzeOptions }>) => {
  try {
    const anatomy = analyzePixels(data.pixels, data.options);
    const buffers = Object.values(anatomy)
      .filter((value): value is Float32Array => value instanceof Float32Array)
      .map((value) => value.buffer);
    self.postMessage({ anatomy }, { transfer: buffers });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'The feather could not be analysed.' });
  }
};
