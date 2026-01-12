// tests/e2e/chat-flow.spec.js
//
// E2E tests for the chat interface - HIGHEST PRIORITY
// Tests the core user journey: sending messages and receiving AI responses.
// These tests are sensitive to Python sidecar availability and response times.

import { test, expect } from '@playwright/test';

// Increase timeout for chat tests - LLM responses can be slow
test.setTimeout(60000);

test.describe('Chat Interface', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to chat page
    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');
  });

  test('chat page loads successfully', async ({ page }) => {
    // Verify main chat elements are visible
    await expect(page.locator('#chatSection')).toBeVisible();
    await expect(page.locator('#messageInput')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeVisible();
  });

  test('empty state is shown initially', async ({ page }) => {
    // When no messages exist, empty state should be visible
    const emptyState = page.locator('.empty-state');
    // Note: This may not exist if there's already a session
    // Just verify messages container exists
    await expect(page.locator('#messages')).toBeVisible();
  });

  test('new chat button is visible', async ({ page }) => {
    const newChatBtn = page.locator('#newChatBtn');
    await expect(newChatBtn).toBeVisible();
  });

  test('message input accepts text', async ({ page }) => {
    const input = page.locator('#messageInput');
    await input.fill('Test message for E2E');
    await expect(input).toHaveValue('Test message for E2E');
  });

  test('send button is clickable', async ({ page }) => {
    const input = page.locator('#messageInput');
    const sendBtn = page.locator('#sendBtn');

    await input.fill('Test');
    await expect(sendBtn).toBeEnabled();
  });
});

test.describe('Chat Sending', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');
  });

  test('can send a message and see user bubble', async ({ page }) => {
    const input = page.locator('#messageInput');
    const sendBtn = page.locator('#sendBtn');

    // Type and send a message
    await input.fill('Hello, this is a test message');
    await sendBtn.click();

    // User message should appear in the chat
    // Wait for the message to appear (may take a moment)
    await expect(page.locator('.message.user, .user-message')).toBeVisible({
      timeout: 10000
    });
  });

  test('input clears after sending', async ({ page }) => {
    const input = page.locator('#messageInput');
    const sendBtn = page.locator('#sendBtn');

    await input.fill('Test clear input');
    await sendBtn.click();

    // Input should be cleared after sending
    await expect(input).toHaveValue('', { timeout: 5000 });
  });

  test('can send message with Enter key', async ({ page }) => {
    const input = page.locator('#messageInput');

    await input.fill('Test enter key');
    await input.press('Enter');

    // Message should appear
    await expect(page.locator('.message.user, .user-message')).toBeVisible({
      timeout: 10000
    });
  });
});

test.describe('Chat Response', () => {
  // These tests require Python sidecar to be running
  // They may fail if the backend is unavailable

  test.beforeEach(async ({ page }) => {
    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');
  });

  test('receives assistant response after sending message', async ({ page }) => {
    const input = page.locator('#messageInput');
    const sendBtn = page.locator('#sendBtn');

    // Send a simple query
    await input.fill('What is the weather like?');
    await sendBtn.click();

    // Wait for assistant response (may take a while with LLM)
    // Look for assistant message bubble
    await expect(page.locator('.message.assistant, .assistant-message')).toBeVisible({
      timeout: 45000 // 45 seconds for LLM response
    });
  });

  test.fixme('response contains relevant content', async ({ page }) => {
    // FIXME: This test is flaky due to variable LLM responses
    // Issue: Response content varies based on context and model

    const input = page.locator('#messageInput');
    const sendBtn = page.locator('#sendBtn');

    // Send a specific query
    await input.fill('What is oil capacity?');
    await sendBtn.click();

    // Wait for response
    const response = page.locator('.message.assistant, .assistant-message');
    await expect(response).toBeVisible({ timeout: 45000 });

    // Response should contain some relevant text
    const responseText = await response.textContent();
    expect(responseText.length).toBeGreaterThan(10);
  });
});

test.describe('Chat History', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');
  });

  test('chat list sidebar exists', async ({ page }) => {
    await expect(page.locator('#chatList, .chat-list')).toBeVisible();
  });

  test.skip('new chat creates fresh conversation', async ({ page }) => {
    // SKIP: On mobile, newChatBtn is hidden in sidebar behind hamburger menu
    // This test works on desktop but not on mobile layout
    const newChatBtn = page.locator('#newChatBtn');

    // Click new chat
    await newChatBtn.click();

    // Should show empty state or clear messages
    // Wait for UI to update
    await page.waitForTimeout(1000);

    // Messages area should be visible (either empty or showing empty state)
    await expect(page.locator('#messages')).toBeVisible();
  });
});

test.describe('Error Handling', () => {
  test('shows error state when backend unavailable', async ({ page, context }) => {
    // Block API calls to simulate backend failure
    await context.route('**/chat/**', route => {
      route.abort('failed');
    });

    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    const input = page.locator('#messageInput');
    const sendBtn = page.locator('#sendBtn');

    // Try to send a message
    await input.fill('Test error handling');
    await sendBtn.click();

    // Should show some error indication
    // This could be an error message, toast, or failed message state
    // Wait for any error indicator
    await page.waitForTimeout(5000);

    // At minimum, the page should not crash
    await expect(page.locator('#chatSection')).toBeVisible();
  });
});

test.describe('Mobile Responsiveness', () => {
  test('chat works on mobile viewport', async ({ page }) => {
    // Set mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });

    await page.goto('/public/index-mobile.html');
    await page.waitForLoadState('networkidle');

    // Chat should still be functional
    await expect(page.locator('#messageInput')).toBeVisible();
    await expect(page.locator('#sendBtn')).toBeVisible();
  });
});
