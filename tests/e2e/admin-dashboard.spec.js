import { test, expect } from '@playwright/test';

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to admin dashboard
    await page.goto('/admin');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
  });

  test('admin dashboard loads successfully', async ({ page }) => {
    // Check that the page title is correct
    await expect(page).toHaveTitle(/Admin/);
    
    // Check that main sections are visible
    await expect(page.locator('#admin-root')).toBeVisible();
  });

  test('dashboard metrics populate correctly', async ({ page }) => {
    // Wait for dashboard to be active (default route)
    await page.waitForSelector('#section-dashboard', { state: 'visible' });
    
    // Check that metrics are loading/loaded (not showing "Loading...")
    const uptimeElement = page.locator('#uptime');
    await expect(uptimeElement).toBeVisible();
    
    // Wait a bit for API calls to complete
    await page.waitForTimeout(2000);
    
    // Check that uptime is not "Loading..." anymore
    const uptimeText = await uptimeElement.textContent();
    expect(uptimeText).not.toBe('Loading...');
    
    // Check Supabase status
    const supabaseStatus = page.locator('#supabase-status');
    await expect(supabaseStatus).toBeVisible();
    const supabaseText = await supabaseStatus.textContent();
    expect(supabaseText).toBe('Connected');
  });
});

test.describe('Document Upload', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    // Navigate to document upload section
    await page.click('#tab-doc-upload');
    await page.waitForTimeout(1000); // Wait for section to load
  });

  test('manufacturer dropdown loads and works', async ({ page }) => {
    // Wait for document upload section to be visible
    await page.waitForSelector('#section-doc-upload', { state: 'visible' });
    
    // Find manufacturer dropdown
    const manufacturerSelect = page.locator('#manufacturer-select');
    await expect(manufacturerSelect).toBeVisible();
    
    // Wait for dropdown to be populated (not just placeholder)
    await page.waitForFunction(() => {
      const select = document.querySelector('#manufacturer-select');
      return select && select.options.length > 1;
    }, { timeout: 10000 });
    
    // Check that dropdown has options
    const options = await manufacturerSelect.locator('option').count();
    expect(options).toBeGreaterThan(1); // Should have more than just placeholder
    
    // Test selecting an option
    const firstOption = manufacturerSelect.locator('option').nth(1);
    const optionText = await firstOption.textContent();
    await manufacturerSelect.selectOption({ index: 1 });
    
    // Verify selection worked
    await expect(manufacturerSelect).toHaveValue(/./); // Should have some value
  });

  test('model dropdown updates when manufacturer changes', async ({ page }) => {
    // Wait for document upload section
    await page.waitForSelector('#section-doc-upload', { state: 'visible' });
    
    const manufacturerSelect = page.locator('#manufacturer-select');
    const modelSelect = page.locator('#model-select');
    
    // Wait for dropdowns to be populated
    await page.waitForFunction(() => {
      const manufacturer = document.querySelector('#manufacturer-select');
      return manufacturer && manufacturer.options.length > 1;
    }, { timeout: 10000 });
    
    // Select a manufacturer
    await manufacturerSelect.selectOption({ index: 1 });
    
    // Wait for model dropdown to update
    await page.waitForTimeout(2000);
    
    // Check that model dropdown is enabled and has options
    await expect(modelSelect).toBeEnabled();
    
    const modelOptions = await modelSelect.locator('option').count();
    expect(modelOptions).toBeGreaterThan(1);
  });

  test('file upload form works', async ({ page }) => {
    // Wait for document upload section
    await page.waitForSelector('#section-doc-upload', { state: 'visible' });
    
    // Check that file input exists
    const fileInput = page.locator('input[type="file"]');
    await expect(fileInput).toBeVisible();
    
    // Check that upload button exists
    const uploadButton = page.locator('button[type="submit"]');
    await expect(uploadButton).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('all navigation links work', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    const navButtons = [
      { id: '#tab-dashboard', section: '#section-dashboard' },
      { id: '#tab-doc-upload', section: '#section-doc-upload' },
      { id: '#tab-dip', section: '#section-dip' },
      { id: '#tab-jobs', section: '#section-jobs' },
      { id: '#tab-chunks', section: '#section-chunks' },
      { id: '#tab-metrics', section: '#section-metrics' },
      { id: '#tab-health', section: '#section-health' },
      { id: '#tab-systems', section: '#section-systems' },
      { id: '#tab-suggestions', section: '#section-suggestions' },
    ];
    
    for (const button of navButtons) {
      // Click navigation button
      await page.click(button.id);
      
      // Wait for section to be visible
      await page.waitForSelector(button.section, { state: 'visible' });
      
      // Verify section is visible
      await expect(page.locator(button.section)).toBeVisible();
      
      // Wait a bit before next navigation
      await page.waitForTimeout(500);
    }
  });
});
