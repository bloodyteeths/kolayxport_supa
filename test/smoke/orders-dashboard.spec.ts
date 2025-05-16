import { test, expect } from '@playwright/test';

const SYNC_BUTTON = 'button:has-text("SİPARİŞLERİ SENKRONİZE ET")';
const TABLE_ROW = 'table tbody tr';
const IMAGE_CELL = 'td:nth-child(1) img';
const VARIANT_CELL = 'td:nth-child(3)';
const NOTE_CELL = 'td:nth-child(4)';

// Helper to trigger sync via API
async function triggerSync(page) {
  await page.request.post('/api/orders/sync');
}

test.describe('Orders Dashboard Smoke Test', () => {
  test('renders orders with image, variant, note and resyncs', async ({ page }) => {
    // Trigger sync via API
    await triggerSync(page);
    // Go to dashboard
    await page.goto('/app/senkron');
    // Wait for table to load
    await page.waitForSelector(TABLE_ROW);
    // Assert at least one row has an image, variant, and note
    const rows = await page.$$(TABLE_ROW);
    let found = false;
    for (const row of rows) {
      const img = await row.$(IMAGE_CELL);
      const variant = await row.$eval(VARIANT_CELL, el => el.textContent?.trim());
      const note = await row.$eval(NOTE_CELL, el => el.textContent?.trim());
      if (img && variant && variant.length > 0 && note && note.length > 0) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
    // Click the sync button and confirm no error
    await page.click(SYNC_BUTTON);
    await page.waitForSelector(TABLE_ROW); // Table should refresh
    // Optionally check for a success toast or message
    expect(await page.isVisible(TABLE_ROW)).toBe(true);
  });
}); 