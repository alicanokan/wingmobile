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
        // Assigned by module path rather than by package name: the name form
        // puts a shared dependency in whichever group claimed it first, which
        // buried react-dom inside the r3f chunk and left `react` empty.
        //
        // three/@react-three are deliberately NOT manually named here. Now
        // that main.tsx loads every route via React.lazy(), Vite's shared
        // dynamic-import helper gets bundled into whichever manual chunk it
        // first associates with — and naming three/r3f made it land there,
        // so the entry statically imported that chunk and every route (even
        // /controller, which never touches 3D) paid for downloading three.js
        // up front, silently undoing the route split. Left to Rollup's own
        // chunking, the helper lands in `react` instead (already required by
        // every route, so it's free), and three+@react-three merge into one
        // auto-named chunk that only the routes actually rendering the 3D
        // feather (/, /feather, /feather2, /conductor, /experience) fetch.
        // Verified: /controller and /cam pull in neither three nor r3f.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/\/(react|react-dom|scheduler)\//.test(id)) return 'react';
          if (id.includes('/tone/')) return 'audio';
          if (/\/(mqtt|peerjs|qrcode)|@supabase/.test(id)) return 'net';
        },
      },
    },
  },
});
