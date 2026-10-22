import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// HTTPS=1 serves over HTTPS with a self-signed certificate (npm run lan), so friends on the
// LAN or a Radmin/Hamachi network get a secure context: Web Crypto, AudioWorklet, gamepads and
// the service worker all require one. BASE sets the sub-path for static hosts (GitHub Pages).
const https = process.env.HTTPS === '1';

export default defineConfig({
  base: process.env.BASE ?? '/',
  build: { target: 'es2022' }, // top-level await in main.ts
  worker: { format: 'es' },
  server: { port: 5173 },
  plugins: [
    ...(https ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Linked Past',
        short_name: 'Linked Past',
        description: 'Local multiplayer for A Link to the Past, in your browser.',
        theme_color: '#181838',
        background_color: '#000000',
        display: 'fullscreen',
        orientation: 'any',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
});
