import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './sim/App.tsx';
import FeatherView from './sim/FeatherView.tsx';
import CamSender from './sim/CamSender.tsx';
import Controller from './sim/Controller.tsx';
import Conductor from './sim/Conductor.tsx';
import Experience from './sim/Experience.tsx';
import Feather2 from './feather2/Feather2.tsx';

// Entry points on one app: the operator console (/), a display-only projection
// (/feather) for a second screen, a phone camera sender (/cam), a phone
// remote controller (/controller), the conductor preset generator (/conductor)
// that drives every connected device, and the distilled front-of-house page
// (/experience) — all joined by QR.
const path = window.location.pathname.replace(/\/+$/, '');

createRoot(document.getElementById('root')!).render(
  path.endsWith('/feather') ? (
    <FeatherView />
  ) : path.endsWith('/cam') ? (
    <CamSender />
  ) : path.endsWith('/controller') ? (
    <Controller />
  ) : path.endsWith('/conductor') ? (
    <Conductor />
  ) : path.endsWith('/experience') ? (
    <Experience />
  ) : path.endsWith('/feather2') ? (
    <Feather2 />
  ) : (
    <StrictMode>
      <App />
    </StrictMode>
  ),
);
