import { defineConfig, devices } from '@playwright/test';

// End-to-end checks run against the production build (`vite preview`), the
// same files that get deployed. Locally they drive the installed Google
// Chrome with the real GPU; in CI the bundled Chromium renders WebGL with
// SwiftShader, which is slow, so frame steps are allowed to be long (?maxdt).
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: ci ? 120_000 : 60_000,
  expect: { timeout: ci ? 30_000 : 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: ci ? 1 : 0,
  reporter: ci ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    channel: ci ? undefined : 'chrome',
    launchOptions: {
      args: ci ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] : ['--ignore-gpu-blocklist']
    }
  },
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/storm.html',
    reuseExistingServer: !ci,
    timeout: 120_000
  }
});
