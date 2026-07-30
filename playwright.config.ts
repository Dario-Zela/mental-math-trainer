import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4173/mental-math-trainer/',
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173/mental-math-trainer/',
    reuseExistingServer: true,
  },
});
