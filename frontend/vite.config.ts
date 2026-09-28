import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  appType: 'mpa',
  // Local preview only; production HTTP headers are configured by the client's web server.
  preview: { cors: true },
  test: { include: ['tests/**/*.test.ts'] },
});
