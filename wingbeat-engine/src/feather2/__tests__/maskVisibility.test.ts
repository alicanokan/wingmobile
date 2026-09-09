import { expect, it } from 'vitest';
import { maskVisibility } from '../maskVisibility';
it('keeps a solo colour visible without anatomy masters', () => {
  expect(maskVisibility([true,false], [false], [false]).neutralParts).toBe(true);
});
it('limits pattern solo to marked pixels', () => {
  expect(maskVisibility([false], [true], [false]).patternOnly).toBe(true);
});
it('does not reveal the feather when all masks are hidden', () => {
  expect(maskVisibility([false], [false], [false]).any).toBe(false);
});
