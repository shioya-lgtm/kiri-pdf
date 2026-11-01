// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true
  },
  webServer: {
    command: 'node tests/server.js',
    url: 'http://localhost:4173/',
    reuseExistingServer: !process.env.CI
  }
});
