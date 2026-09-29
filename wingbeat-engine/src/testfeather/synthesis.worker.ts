import { renderStudy } from './synthesis.ts';
import type { SoundFeather } from './catalog.ts';
self.onmessage = (event: MessageEvent<SoundFeather>) => {
  try {
    const rendered = renderStudy(event.data);
    self.postMessage({ rendered }, { transfer: rendered.stems.map(stem => stem.buffer) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Could not prepare this study.' });
  }
};
