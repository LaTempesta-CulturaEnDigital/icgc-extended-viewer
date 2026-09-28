import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:8099',
    viewport: { width: 1280, height: 900 },
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'uv run --project ../backend --locked python ../tests/browser_server.py',
    url: 'http://127.0.0.1:8099/health/ready',
    reuseExistingServer: !process.env.CI,
    timeout: 60000,
  },
});
