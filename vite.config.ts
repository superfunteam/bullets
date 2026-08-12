import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  // A packaged Electron app loads index.html from file://. Relative asset URLs
  // keep module chunks inside the app bundle; the web deployment still needs
  // root-relative URLs so Netlify routes assets from its origin as usual.
  base: process.env.VITE_DESKTOP ? './' : '/',
  plugins: [react(), tailwindcss()],
  define: {
    // The APK compares this against the latest GitHub release tag to decide
    // whether to offer an update, so it must track package.json exactly.
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
