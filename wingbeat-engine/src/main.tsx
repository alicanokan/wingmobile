import { StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from './sim/ErrorBoundary.tsx';

const App = lazy(() => import('./sim/App.tsx'));
const FeatherView = lazy(() => import('./sim/FeatherView.tsx'));
const CamSender = lazy(() => import('./sim/CamSender.tsx'));
const Controller = lazy(() => import('./sim/Controller.tsx'));
const Conductor = lazy(() => import('./sim/Conductor.tsx'));
const Experience = lazy(() => import('./sim/Experience.tsx'));
const Feather2 = lazy(() => import('./feather2/Feather2.tsx'));

// Entry points on one app: the operator console (/), a display-only projection
// (/feather) for a second screen, a phone camera sender (/cam), a phone
// remote controller (/controller), the conductor preset generator (/conductor)
// that drives every connected device, and the distilled front-of-house page
// (/experience) — all joined by QR.
const path = window.location.pathname.replace(/\/+$/, '');

// Exact-match routing: `endsWith` used to make ANY typo silently render the
// full operator console — including on the projection machine, in front of
// the audience. An unknown path now says so and lists the real doors.
const ROUTES: Record<string, { label: string; el: () => ReactNode }> = {
  '/feather': { label: 'projection display', el: () => <FeatherView /> },
  '/cam': { label: 'phone camera', el: () => <CamSender /> },
  '/controller': { label: 'phone controller', el: () => <Controller /> },
  '/conductor': { label: 'conductor', el: () => <Conductor /> },
  '/experience': { label: 'experience', el: () => <Experience /> },
  '/feather2.html': { label: 'feather studio', el: () => <Feather2 /> },
  '/feather2': { label: 'feather lab', el: () => <Feather2 /> },
};

function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        background: '#0b0a09',
        color: '#e9e3d7',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 40 }}>🪶</div>
      <div style={{ fontSize: 17, fontWeight: 700 }}>No page at “{path}”</div>
      <div style={{ fontSize: 14, opacity: 0.75, textAlign: 'center', lineHeight: 2 }}>
        <a href="/" style={{ color: '#de9a3b' }}>/</a> console
        {Object.entries(ROUTES).map(([p, r]) => (
          <span key={p}>
            {' · '}
            <a href={p} style={{ color: '#de9a3b' }}>{p}</a> {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function RouteFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b0a09',
        color: '#e9e3d7',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        opacity: 0.7,
      }}
    >
      loading…
    </div>
  );
}

const route = ROUTES[path];
const label = route?.label ?? 'console';

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary label={label}>
    <Suspense fallback={<RouteFallback />}>
      {route ? (
        route.el()
      ) : path === '' || path === '/' ? (
        <StrictMode>
          <App />
        </StrictMode>
      ) : (
        <NotFound />
      )}
    </Suspense>
  </ErrorBoundary>,
);
