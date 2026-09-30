import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Frontend unit tests (Vitest + Testing Library, jsdom). The app's vite
// config injects virtual modules and reads files by paths relative to its
// own location; the test config mirrors what those modules export so app
// imports resolve, without pulling the dev-server/SEO plugins along.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'virtual:last-updated': fileURLToPath(new URL('./src/virtualStubs.ts', import.meta.url)),
      'virtual:sw-version': fileURLToPath(new URL('./src/virtualStubs.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
  },
});
