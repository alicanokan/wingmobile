// Camera input uses the same paired WebRTC path as the touch controller.
// The static website needs no LAN relay; only motion values leave the phone.
import Controller from './Controller.tsx';

export default function CamSender() {
  return <Controller cameraMode />;
}
