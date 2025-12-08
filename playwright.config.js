// @ts-check
import { defineConfig, devices } from '@playwright/test';

const isCI = !!process.env.CI;
const useJsonReporter = !!process.env.PLAYWRIGHT_JSON_REPORT;

/**
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests',
  testMatch: ['**/e2e/**/*.spec.js', '**/nightly/**/*.spec.js'],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: isCI,
  /* Retry on CI only */
  retries: isCI ? 2 : 0,
  /* Opt out of parallel tests on CI. */
  workers: isCI ? 1 : undefined,
  /* Reporter: JSON when PLAYWRIGHT_JSON_REPORT is set, HTML otherwise */
  reporter: useJsonReporter
    ? [['json', { outputFile: 'results/playwright.json' }]]
    : [['html']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL - use BASE_URL env var for CI, localhost for local dev */
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
    /* Take screenshot on failure */
    screenshot: 'only-on-failure',
    /* Record video on failure */
    video: 'retain-on-failure',
  },

  /* Configure projects for browsers */
  /* CI: Chromium only (faster, matches installed browser). Local: all browsers. */
  projects: process.env.CI
    ? [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      ]
    : [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
      ],

  /* Run your local dev server before starting the tests (skip in CI - testing against production) */
  webServer: process.env.CI ? undefined : {
    command: 'echo "Server should already be running"',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 30 * 1000, // 30 seconds
  },
});
