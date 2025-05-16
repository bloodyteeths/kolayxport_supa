import { test, expect, chromium } from '@playwright/test';
import { createTestUser, deleteTestUser } from './setup';

let browser;
let page;
let testUser;

test.beforeAll(async () => {
  // Create test user
  testUser = await createTestUser();
  // Launch browser
  browser = await chromium.launch();
  page = await browser.newPage();
});

test.afterAll(async () => {
  await browser.close();
  await deleteTestUser();
});

test('should load settings page and handle form submission', async () => {
  // 1. Login
  await page.goto('/login');
  await page.fill('input[type="email"]', 'test@example.com');
  await page.fill('input[type="password"]', 'testpassword123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/ayarlar');
  await expect(page).toHaveURL(/.*ayarlar/);
  const response = await page.waitForResponse(
    response => response.url().includes('/api/user/settings') && response.status() === 200
  );
  expect(response.status()).toBe(200);
  await expect(page.locator('input[name="veeqoApiKey"]')).toBeVisible();
  await expect(page.locator('input[name="shippoToken"]')).toBeVisible();
  await expect(page.locator('input[name="fedexApiKey"]')).toBeVisible();
  const testApiKey = 'test-veeqo-key-' + Date.now();
  await page.fill('input[name="veeqoApiKey"]', testApiKey);
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Ayarlar başarıyla kaydedildi!')).toBeVisible();
  await page.reload();
  await page.waitForLoadState('networkidle');
  const inputValue = await page.inputValue('input[name="veeqoApiKey"]');
  expect(inputValue).toBe(testApiKey);
});

test('should handle form validation', async () => {
  await page.goto('/ayarlar');
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Bu alan zorunludur')).toBeVisible();
});

test('should handle API errors gracefully', async () => {
  await page.goto('/ayarlar');
  await page.route('**/api/user/settings', route => 
    route.fulfill({
      status: 500,
      body: JSON.stringify({ error: 'Test error' })
    })
  );
  await page.fill('input[name="veeqoApiKey"]', 'test-key');
  await page.click('button[type="submit"]');
  await expect(page.locator('text=Ayarlar kaydedilemedi')).toBeVisible();
}); 