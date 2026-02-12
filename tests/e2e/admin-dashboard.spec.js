import { test, expect } from '@playwright/test';

// Inject admin token into localStorage before page loads
async function injectAdminToken(page) {
  const token = process.env.ADMIN_TOKEN;
  if (token) {
    await page.addInitScript((t) => {
      localStorage.setItem('adminToken', t);
    }, token);
  }
}

test.describe('Admin Dashboard', () => {
  test.beforeEach(async ({ page }) => {
    // Inject admin token before navigation
    await injectAdminToken(page);

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
    await injectAdminToken(page);
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // Navigate to document upload section
    await page.click('#tab-doc-upload');
    await page.waitForTimeout(2000); // Wait for section and API calls to load
  });

  test('document upload section loads', async ({ page }) => {
    // Wait for document upload section to be visible
    await page.waitForSelector('#section-doc-upload', { state: 'visible' });

    // Check the section rendered
    await expect(page.locator('#section-doc-upload')).toBeVisible();
  });

  test('manufacturer dropdown exists', async ({ page }) => {
    // Wait for document upload section to be visible
    await page.waitForSelector('#section-doc-upload', { state: 'visible' });

    // Find manufacturer dropdown (correct selector is #manufacturer)
    const manufacturerSelect = page.locator('#manufacturer');
    await expect(manufacturerSelect).toBeVisible();
  });

  test('manufacturer dropdown loads options', async ({ page }) => {
    // Dropdown should populate from /admin/api/manufacturers
    await page.waitForSelector('#section-doc-upload', { state: 'visible' });
    const manufacturerSelect = page.locator('#manufacturer');

    // Wait for dropdown to be populated (API returns 50 manufacturers)
    await page.waitForFunction(() => {
      const select = document.querySelector('#manufacturer');
      return select && select.options.length > 1;
    }, { timeout: 15000 });

    const options = await manufacturerSelect.locator('option').count();
    expect(options).toBeGreaterThan(1);
  });

  test('file upload area exists', async ({ page }) => {
    // Wait for document upload section
    await page.waitForSelector('#section-doc-upload', { state: 'visible' });

    // Check that file input exists (hidden but present in DOM)
    const fileInput = page.locator('#file-input');
    await expect(fileInput).toBeAttached();

    // Check that the drop zone exists (visual element users interact with)
    const dropZone = page.locator('.file-drop-zone, #file-drop-zone');
    await expect(dropZone).toBeVisible();
  });
});

test.describe('Navigation', () => {
  test('all navigation links work', async ({ page }) => {
    await injectAdminToken(page);
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
