import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/smoke',
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  retries: 0,
}); 