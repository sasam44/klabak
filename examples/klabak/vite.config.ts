import { defineConfig } from 'vite';
import viteReact from '@vitejs/plugin-react';

// The game runs inside the host's iframe on a different origin, and the host
// fetches /game.manifest.json cross-origin — CORS must stay open.
export default defineConfig({
  plugins: [viteReact()],
  // The jam gallery hosts one card per entry, and the dev preview runs behind a
  // proxy host — both need to be accepted, so no host allowlist for the dev server.
  server: { port: 3200, cors: true, host: true, allowedHosts: true },
  preview: { port: 3200, cors: true },
  build: { target: 'es2022' },
});
