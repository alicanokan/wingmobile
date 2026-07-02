import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './sim/App.tsx';
import FeatherView from './sim/FeatherView.tsx';
import CamSender from './sim/CamSender.tsx';
import Controller from './sim/Controller.tsx';

// Entry points on one app: the operator console (/), a display-only projection
// (/feather) for a second screen, a phone camera sender (/cam), and a phone
// remote controller (/controller) — all joined by QR.
const path = window.location.pathname.replace(/\/+$/, '');

createRoot(document.getElementById('root')!).render(
  path.endsWith('/feather') ? (
    <FeatherView />
  ) : path.endsWith('/cam') ? (
    <CamSender />
  ) : path.endsWith('/controller') ? (
    <Controller />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
