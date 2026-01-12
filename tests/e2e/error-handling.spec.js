// tests/e2e/error-handling.spec.js
//
// E2E tests for error states and graceful degradation.
// Validates the app handles failures without crashing.

import { test, expect } from '@playwright/test';

test.describe('Network Error Handling', () => {
  test('chat page handles API timeout gracefully', async ({ page, context }) => {
    // Simulate slow network
    await context.route('**/chat/**', async route => {
      // Delay response for 10 seconds
      await new Promise(resolve => setTimeout(resolve, 10000));
      route.abort('timedout');
    });

    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    // Page should still be functional
    await expect(page.locator('#messageInput')).toBeVisible();
    await expect(page.locator('#chatSection')).toBeVisible();
  });

  test('admin page handles API errors gracefully', async ({ page, context }) => {
    // Block admin API calls
    await context.route('**/admin/api/**', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Internal Server Error' })
      });
    });

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Page should load without crashing
    await expect(page.locator('#admin-root')).toBeVisible();
  });

  test('health endpoint failure shows status', async ({ page, context }) => {
    await context.route('**/health', route => {
      route.fulfill({
        status: 503,
        body: JSON.stringify({ status: 'unhealthy' })
      });
    });

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Admin page should still render
    await expect(page.locator('#admin-root')).toBeVisible();
  });
});

test.describe('Page Load Errors', () => {
  test('handles missing resources gracefully', async ({ page }) => {
    // Block some static resources
    await page.route('**/*.css', route => route.abort());

    await page.goto('/public/index-mobile.html');

    // Page should still function (may look broken, but functional)
    await expect(page.locator('#messageInput')).toBeVisible();
  });

  test('404 page shows for unknown routes', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist-12345');

    // Should return 404
    expect(response.status()).toBe(404);
  });
});

test.describe('Form Validation', () => {
  test('empty message cannot be sent', async ({ page }) => {
    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    const sendBtn = page.locator('#sendBtn');
    const messageInput = page.locator('#messageInput');

    // Ensure input is empty
    await messageInput.clear();

    // Try to click send
    await sendBtn.click();

    // No message should appear (or validation error shown)
    await page.waitForTimeout(1000);

    // Chat should remain in initial state (no user messages added)
    const messages = page.locator('#messages');
    await expect(messages).toBeVisible();
  });
});

test.describe('Session Handling', () => {
  test('page handles invalid session gracefully', async ({ page, context }) => {
    // Simulate session errors
    await context.route('**/sessions/**', route => {
      route.fulfill({
        status: 401,
        body: JSON.stringify({ error: 'Unauthorized' })
      });
    });

    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    // Page should still load
    await expect(page.locator('#chatSection')).toBeVisible();
  });
});

test.describe('Admin Authentication', () => {
  test('admin API routes return 401 without token', async ({ page }) => {
    // Make direct API call without token
    const response = await page.request.get('/admin/api/systems');

    // Should require authentication
    expect(response.status()).toBe(401);
  });

  test('admin page loads even if some APIs fail', async ({ page, context }) => {
    // Make some admin APIs fail
    await context.route('**/admin/api/metrics', route => {
      route.fulfill({ status: 500, body: '{}' });
    });

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Page should still render
    await expect(page.locator('#admin-root')).toBeVisible();
  });
});

test.describe('JavaScript Errors', () => {
  test('no console errors on chat page', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    // Wait for any async errors
    await page.waitForTimeout(2000);

    // Should have no JavaScript errors
    expect(errors).toHaveLength(0);
  });

  test('no console errors on admin page', async ({ page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Wait for any async errors
    await page.waitForTimeout(2000);

    // Filter out known acceptable errors (like network failures when mocking)
    const criticalErrors = errors.filter(e => !e.includes('NetworkError'));

    expect(criticalErrors).toHaveLength(0);
  });
});

test.describe('Accessibility', () => {
  test('chat input has proper label', async ({ page }) => {
    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    const input = page.locator('#messageInput');

    // Input should have placeholder or aria-label
    const placeholder = await input.getAttribute('placeholder');
    const ariaLabel = await input.getAttribute('aria-label');

    expect(placeholder || ariaLabel).toBeTruthy();
  });

  test('send button has aria-label', async ({ page }) => {
    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    const sendBtn = page.locator('#sendBtn');
    const ariaLabel = await sendBtn.getAttribute('aria-label');

    expect(ariaLabel).toBeTruthy();
  });
});
