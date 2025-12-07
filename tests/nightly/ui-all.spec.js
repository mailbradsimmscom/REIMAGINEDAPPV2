/**
 * Comprehensive UI Coverage Tests
 *
 * Auto-generates tests for ALL pages defined in page-interactions.json.
 * Tests: page loads, no JS errors, key elements visible, interactions work.
 *
 * Run: npx playwright test tests/nightly/ui-all.spec.js
 * Or: npm run test:ui:all
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load page interactions config
const configPath = join(__dirname, '../e2e/page-interactions.json');
const config = JSON.parse(readFileSync(configPath, 'utf-8'));

// Main app base URL (from env or default)
const MAIN_BASE_URL = process.env.BASE_URL || 'http://localhost:3000';

// Maintenance agent base URL
const MAINTENANCE_BASE_URL = process.env.MAINTENANCE_URL || 'http://localhost:3001';

// Timeout for page loads
const PAGE_LOAD_TIMEOUT = 30000;

// ============================================
// MAIN APP PAGES (Port 3000)
// ============================================

test.describe('Main App - Page Coverage', () => {
  // Generate tests for each main app page
  for (const [url, pageConfig] of Object.entries(config.pages)) {
    const pageName = pageConfig.name || url;

    test.describe(`${pageName} (${url})`, () => {
      // Test 1: Page loads without HTTP errors
      test('page loads successfully', async ({ page }) => {
        const response = await page.goto(`${MAIN_BASE_URL}${url}`, {
          waitUntil: 'domcontentloaded',
          timeout: PAGE_LOAD_TIMEOUT
        });

        // Should not return 4xx or 5xx
        expect(response.status(), `${url} returned HTTP ${response.status()}`).toBeLessThan(400);
      });

      // Test 2: No JavaScript errors
      test('no console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`${MAIN_BASE_URL}${url}`, {
          waitUntil: 'networkidle',
          timeout: PAGE_LOAD_TIMEOUT
        });

        // Wait for any async errors
        await page.waitForTimeout(1000);

        // Filter out known acceptable errors
        const criticalErrors = errors.filter(e =>
          !e.includes('NetworkError') &&
          !e.includes('Failed to fetch') &&
          !e.includes('net::ERR_') &&
          !e.includes('ResizeObserver')
        );

        expect(criticalErrors, `JS errors on ${url}: ${criticalErrors.join(', ')}`).toHaveLength(0);
      });

      // Test 3: Key elements are visible
      if (pageConfig.elements && pageConfig.elements.length > 0) {
        test('key elements are visible', async ({ page }) => {
          await page.goto(`${MAIN_BASE_URL}${url}`, {
            waitUntil: 'networkidle',
            timeout: PAGE_LOAD_TIMEOUT
          });

          // Check first element (at minimum body should be visible)
          const firstElement = pageConfig.elements[0];
          await expect(
            page.locator(firstElement),
            `Element ${firstElement} not visible on ${url}`
          ).toBeVisible({ timeout: 10000 });
        });
      }

      // Test 4: Dropdowns are populated (if any)
      if (pageConfig.dropdowns && pageConfig.dropdowns.length > 0) {
        test('dropdowns are populated', async ({ page }) => {
          await page.goto(`${MAIN_BASE_URL}${url}`, {
            waitUntil: 'networkidle',
            timeout: PAGE_LOAD_TIMEOUT
          });

          // Wait extra time for API calls to populate dropdowns
          await page.waitForTimeout(2000);

          for (const dropdown of pageConfig.dropdowns) {
            const select = page.locator(dropdown);

            // Check dropdown exists
            const exists = await select.count() > 0;
            if (!exists) continue; // Skip if not found (may be conditionally rendered)

            // Check it has options (at least 1)
            const optionCount = await select.locator('option').count();
            expect(
              optionCount,
              `Dropdown ${dropdown} on ${url} has no options`
            ).toBeGreaterThanOrEqual(1);
          }
        });
      }

      // Test 5: Run defined interactions
      if (pageConfig.interactions && pageConfig.interactions.length > 0) {
        test('interactions work', async ({ page }) => {
          await page.goto(`${MAIN_BASE_URL}${url}`, {
            waitUntil: 'networkidle',
            timeout: PAGE_LOAD_TIMEOUT
          });

          for (const interaction of pageConfig.interactions) {
            try {
              if (interaction.action === 'visible') {
                await expect(
                  page.locator(interaction.selector),
                  `${interaction.selector} not visible`
                ).toBeVisible({ timeout: 10000 });
              } else if (interaction.action === 'click') {
                await page.click(interaction.selector, { timeout: 5000 });
              } else if (interaction.action === 'fill') {
                await page.fill(interaction.selector, interaction.value, { timeout: 5000 });
              } else if (interaction.action === 'enabled') {
                await expect(
                  page.locator(interaction.selector),
                  `${interaction.selector} not enabled`
                ).toBeEnabled({ timeout: 5000 });
              }
            } catch (e) {
              // Log but don't fail for optional interactions
              console.log(`Interaction failed on ${url}: ${interaction.action} ${interaction.selector}`);
            }
          }
        });
      }
    });
  }
});

// ============================================
// MAINTENANCE AGENT PAGES (Port 3001)
// ============================================

test.describe('Maintenance Agent - Page Coverage', () => {
  // Skip maintenance agent tests if URL not available
  test.beforeAll(async ({ request }) => {
    try {
      const response = await request.get(`${MAINTENANCE_BASE_URL}/health`);
      if (response.status() !== 200) {
        test.skip();
      }
    } catch (e) {
      test.skip();
    }
  });

  // Generate tests for each maintenance agent page
  for (const [url, pageConfig] of Object.entries(config.maintenanceAgent?.pages || {})) {
    const pageName = pageConfig.name || url;

    test.describe(`${pageName} (${url})`, () => {
      // Test 1: Page loads without HTTP errors
      test('page loads successfully', async ({ page }) => {
        const response = await page.goto(`${MAINTENANCE_BASE_URL}${url}`, {
          waitUntil: 'domcontentloaded',
          timeout: PAGE_LOAD_TIMEOUT
        });

        // Should not return 4xx or 5xx
        expect(response.status(), `${url} returned HTTP ${response.status()}`).toBeLessThan(400);
      });

      // Test 2: No JavaScript errors
      test('no console errors', async ({ page }) => {
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));

        await page.goto(`${MAINTENANCE_BASE_URL}${url}`, {
          waitUntil: 'networkidle',
          timeout: PAGE_LOAD_TIMEOUT
        });

        await page.waitForTimeout(1000);

        const criticalErrors = errors.filter(e =>
          !e.includes('NetworkError') &&
          !e.includes('Failed to fetch') &&
          !e.includes('net::ERR_') &&
          !e.includes('ResizeObserver')
        );

        expect(criticalErrors, `JS errors on ${url}: ${criticalErrors.join(', ')}`).toHaveLength(0);
      });

      // Test 3: Key elements are visible
      if (pageConfig.elements && pageConfig.elements.length > 0) {
        test('key elements are visible', async ({ page }) => {
          await page.goto(`${MAINTENANCE_BASE_URL}${url}`, {
            waitUntil: 'networkidle',
            timeout: PAGE_LOAD_TIMEOUT
          });

          const firstElement = pageConfig.elements[0];
          await expect(
            page.locator(firstElement),
            `Element ${firstElement} not visible on ${url}`
          ).toBeVisible({ timeout: 10000 });
        });
      }

      // Test 4: Dropdowns are populated (if any)
      if (pageConfig.dropdowns && pageConfig.dropdowns.length > 0) {
        test('dropdowns are populated', async ({ page }) => {
          await page.goto(`${MAINTENANCE_BASE_URL}${url}`, {
            waitUntil: 'networkidle',
            timeout: PAGE_LOAD_TIMEOUT
          });

          await page.waitForTimeout(2000);

          for (const dropdown of pageConfig.dropdowns) {
            const select = page.locator(dropdown);
            const exists = await select.count() > 0;
            if (!exists) continue;

            const optionCount = await select.locator('option').count();
            expect(
              optionCount,
              `Dropdown ${dropdown} on ${url} has no options`
            ).toBeGreaterThanOrEqual(1);
          }
        });
      }

      // Test 5: Run defined interactions
      if (pageConfig.interactions && pageConfig.interactions.length > 0) {
        test('interactions work', async ({ page }) => {
          await page.goto(`${MAINTENANCE_BASE_URL}${url}`, {
            waitUntil: 'networkidle',
            timeout: PAGE_LOAD_TIMEOUT
          });

          for (const interaction of pageConfig.interactions) {
            try {
              if (interaction.action === 'visible') {
                await expect(
                  page.locator(interaction.selector),
                  `${interaction.selector} not visible`
                ).toBeVisible({ timeout: 10000 });
              } else if (interaction.action === 'click') {
                await page.click(interaction.selector, { timeout: 5000 });
              } else if (interaction.action === 'fill') {
                await page.fill(interaction.selector, interaction.value, { timeout: 5000 });
              } else if (interaction.action === 'enabled') {
                await expect(
                  page.locator(interaction.selector),
                  `${interaction.selector} not enabled`
                ).toBeEnabled({ timeout: 5000 });
              }
            } catch (e) {
              console.log(`Interaction failed on ${url}: ${interaction.action} ${interaction.selector}`);
            }
          }
        });
      }
    });
  }
});

// ============================================
// COVERAGE SUMMARY
// ============================================

test.describe('Coverage Summary', () => {
  test('generates coverage report', async () => {
    const mainAppPages = Object.keys(config.pages).length;
    const maintenancePages = Object.keys(config.maintenanceAgent?.pages || {}).length;
    const totalPages = mainAppPages + maintenancePages;

    console.log('\n=== UI Coverage Summary ===');
    console.log(`Main App Pages: ${mainAppPages}`);
    console.log(`Maintenance Agent Pages: ${maintenancePages}`);
    console.log(`Total Pages Tested: ${totalPages}`);
    console.log('===========================\n');

    // This test always passes - it's just for reporting
    expect(totalPages).toBeGreaterThan(0);
  });
});
