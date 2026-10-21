import { expect, test } from '@playwright/test';
import { mockApi, signedIn } from './helpers';

// §10.2 العربية أولاً، §10.3 بنية التنقل، FR-ADM-04 اللغتان والوضعان.

test.beforeEach(async ({ page }) => {
  await mockApi(page, signedIn(false));
});

test('defaults to Arabic, right-to-left', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ar$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('link', { name: 'الرئيسية' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحباً بك في ترند');
});

test('the sidebar sits on the right in Arabic and the left in English', async ({ page }) => {
  await page.goto('/ar');
  const ar = await page.locator('aside').boundingBox();
  const width = page.viewportSize()!.width;
  expect(ar!.x + ar!.width).toBeGreaterThan(width - 2);

  await page.getByRole('link', { name: 'English' }).click();
  await expect(page).toHaveURL(/\/en$/);
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  const en = await page.locator('aside').boundingBox();
  expect(en!.x).toBeLessThan(2);
});

test('toggles dark mode', async ({ page }) => {
  await page.goto('/ar');
  await page.getByRole('button', { name: /المظهر/ }).click();
  const theme = await page.locator('html').getAttribute('data-theme');
  expect(['light', 'dark']).toContain(theme);
  await page.getByRole('button', { name: /المظهر/ }).click();
  expect(await page.locator('html').getAttribute('data-theme')).not.toBe(theme);
});
