import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // Progressive Web App: precache the built app shell so the UI loads offline,
    // and auto-update the service worker when a new build is deployed. Book files
    // and reading-progress sync are handled in-app (IndexedDB) rather than by
    // Workbox runtime caching — see src/lib/offline.ts and src/lib/progressSync.ts.
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'fonts/**/*'],
      manifest: {
        name: 'Project North Star',
        short_name: 'North Star',
        description: 'Your self-hosted personal book library',
        theme_color: '#c96526',
        background_color: '#f5f0e6',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the app shell; SPA navigations fall back to index.html. API
        // calls are never cached here (they're auth'd and handled in-app).
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api/],
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
