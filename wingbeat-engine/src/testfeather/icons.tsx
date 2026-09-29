import type { ReactNode } from 'react';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    pulse: <path d="M2 12h5l3-7 4 14 3-7h5" />,
    wave: <><path d="M2 8c5-9 9 9 14 0s6 0 6 0M2 16c5-9 9 9 14 0s6 0 6 0" /></>,
    air: <><path d="M3 8h12c6 0 6-6 2-6M3 12h16c5 0 5 7 0 7M3 16h8c5 0 5 6 1 6" /></>,
    dots: <><circle cx="6" cy="6" r="1.5"/><circle cx="17" cy="7" r="2"/><circle cx="10" cy="15" r="2"/><circle cx="20" cy="19" r="1"/><circle cx="3" cy="21" r="1"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></>,
    feather: <><path d="M4 22 19 3c-10-5-19 6-13 14 11 5 18-9 13-14M8 11l1 6m3-11 1 6m0 0 7-1"/></>,
    play: <path d="m8 4 13 8-13 8Z"/>,
    stop: <rect x="5" y="5" width="14" height="14" rx="2"/>,
    upload: <path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>,
    arrow: <path d="m6 9 6 6 6-6"/>,
    swirl: <path d="M20 13a8 8 0 1 1-8-9c7 0 9 11 2 11-5 0-5-7-1-6"/>,
    globe: <><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="4" ry="10"/><path d="M2 12h20"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.feather}</svg>;
}
