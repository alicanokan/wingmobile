import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { WebSocketServer } from 'ws';

// ---------------------------------------------------------------------------
//  Phone-camera relay: a tiny LAN WebSocket hub at /cam-relay. A phone opens
//  the /cam sender page, runs the motion detection locally, and posts the
//  RESULT here; the console connects too and receives it as the "Net" source.
//  Only the small motion numbers cross the wire — never the video. It only
//  handles its own path so Vite's HMR socket keeps working.
// ---------------------------------------------------------------------------
function camRelay(): PluginOption {
  const PATH = '/cam-relay';
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => {
    socket.on('message', (data, isBinary) => {
      for (const client of wss.clients) {
        if (client !== socket && client.readyState === 1 /* OPEN */) {
          client.send(data, { binary: isBinary });
        }
      }
    });
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attach = (httpServer: any) => {
    httpServer?.on('upgrade', (req: import('node:http').IncomingMessage, socket: import('node:stream').Duplex, head: Buffer) => {
      if ((req.url?.split('?')[0] ?? '') === PATH) {
        wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
      }
    });
  };
  return {
    name: 'wingbeat-cam-relay',
    configureServer: (server) => attach(server.httpServer),
    configurePreviewServer: (server) => attach(server.httpServer),
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), camRelay()],
  server: {
    host: true, // expose on LAN so the same machine can also reach the MQTT broker
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        // three.js is by far the heaviest dependency and it never changes
        // between deploys. Splitting it (and React) off means a visitor who
        // has been here before only re-downloads the app code, and the app
        // chunk stays small enough to parse quickly on a phone.
        // Assigned by module path rather than by package name: the name form
        // puts a shared dependency in whichever group claimed it first, which
        // buried react-dom inside the r3f chunk and left `react` empty.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (id.includes('/three/')) return 'three';
          // kept apart from `three`: /feather2 drives raw three.js and has no
          // reason to pull the react-three wrappers down with it
          if (id.includes('@react-three')) return 'r3f';
          if (/\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('/tone/')) return 'audio';
          if (/\/(mqtt|peerjs|qrcode)|@supabase/.test(id)) return 'net';
        },
      },
    },
  },
});
