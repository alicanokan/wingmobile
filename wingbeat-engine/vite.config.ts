import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // expose on LAN so the same machine can also reach the MQTT broker
    port: 5173,
  },
  build: {
    rollupOptions: {
      input: { main: 'index.html', test: 'test.html', testfeather: 'testfeather.html' },
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
