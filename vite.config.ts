import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Względne ścieżki – strona działa pod dowolnym podkatalogiem GitHub Pages.
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 120_000,
  },
});
