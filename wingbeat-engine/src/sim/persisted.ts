// ============================================================================
//  Tiny versioned-localStorage helper — the house pattern from inputs.ts,
//  factored out so every persisted thing (mixer, mic/cam calibration, console,
//  LED config) reads and writes the same way: a versioned key, a validator
//  that clamps/allowlists every field, and silence when storage is unavailable.
// ============================================================================

export function loadJson<T>(key: string, validate: (raw: unknown) => T): T {
  try {
    const raw = localStorage.getItem(key);
    return validate(raw ? JSON.parse(raw) : undefined);
  } catch {
    return validate(undefined);
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the session still works, it just won't persist */
  }
}

export const finite = (v: unknown, fallback: number, lo = -Infinity, hi = Infinity): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

export const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
