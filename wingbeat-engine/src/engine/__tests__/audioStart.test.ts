import { afterEach, expect, it, vi } from 'vitest';
import { audioStartDeadline } from '../audioStart.ts';
afterEach(() => vi.useRealTimers());
it('returns control when browser audio permission never resolves', async () => {
  vi.useFakeTimers();
  const result = audioStartDeadline(new Promise<void>(() => {}));
  const assertion = expect(result).rejects.toThrow('browser permission');
  await vi.advanceTimersByTimeAsync(8000); await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
it('cleans its deadline on success and preserves the result', async () => {
  vi.useFakeTimers(); expect(await audioStartDeadline(Promise.resolve('ready'))).toBe('ready');
  expect(vi.getTimerCount()).toBe(0);
});
