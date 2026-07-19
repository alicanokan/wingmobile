// ============================================================================
//  Theme — one light/dark choice shared by the landing, console, mobile
//  experience and /conductor. Dark is the default: the piece is built for a
//  darkened room, and light mode is for working on it in daylight.
//
//  The projection surfaces (feather render, fullscreen) deliberately stay dark
//  in both themes — see the .wb-light rules in ui.css.
// ============================================================================

import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const KEY = 'wb.theme';
/** /conductor shipped its own toggle first; carry that choice over once. */
const LEGACY_KEY = 'wb.conductorTheme';

function read(): Theme {
  const stored = localStorage.getItem(KEY) ?? localStorage.getItem(LEGACY_KEY);
  return stored === 'light' ? 'light' : 'dark';
}

/**
 * Reads the persisted theme and keeps it in localStorage. Every mounted copy
 * stays in sync, so the toggle in the rail and the one on the landing agree.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(read);

  useEffect(() => {
    localStorage.setItem(KEY, theme);
    // Other hook instances in this tab won't see a same-tab storage event,
    // so broadcast explicitly.
    window.dispatchEvent(new CustomEvent('wb-theme', { detail: theme }));
  }, [theme]);

  useEffect(() => {
    const onTheme = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener('wb-theme', onTheme);
    return () => window.removeEventListener('wb-theme', onTheme);
  }, []);

  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

/** Class to hang on a root element so the .wb-light rules apply below it. */
export function themeClass(theme: Theme): string {
  return theme === 'light' ? 'wb-light' : '';
}

/**
 * QR module colours per theme. The dark console renders them inverted so the
 * tile sits in the panel; on light we go back to conventional dark-on-light,
 * which more scanners handle reliably.
 */
export function qrColors(theme: Theme): { dark: string; light: string } {
  return theme === 'light'
    ? { dark: '#1c1c22', light: '#ffffff' }
    : { dark: '#e8e8e8', light: '#0c0c12' };
}
