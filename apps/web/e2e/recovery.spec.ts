import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './helpers';

// §9.2: استعادة كلمة المرور بالبريد.

const alert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

async function choosePassword(page: Page, password = 'a-new-password-1') {
  await page.getByLabel('كلمة المرور الجديدة').fill(password);
  await page.getByLabel('تأكيد كلمة المرور').fill(password);
  await page.getByRole('button', { name: 'حفظ كلمة المرور' }).click();
}

test('the login screen leads to a reset request that does not reveal accounts', async ({
  page,
}) => {
  const calls = await mockApi(page, {
    '/api/v1/auth/request-password-reset': { body: { status: true } },
  });
  await page.goto('/ar/login');
  await page.getByRole('link', { name: 'نسيت كلمة المرور؟' }).click();
  await expect(page).toHaveURL(/\/ar\/forgot-password$/);

  await page.getByLabel('البريد الإلكتروني').fill('sara@trend.sa');
  await page.getByRole('button', { name: 'إرسال الرابط' }).click();
  await expect(page.getByRole('heading', { name: 'تحقق من بريدك' })).toBeVisible();
  await expect(page.getByText('sara@trend.sa')).toBeVisible();
  expect(calls).toEqual([
    { path: '/api/v1/auth/request-password-reset', body: { email: 'sara@trend.sa' } },
  ]);
});

test('too many reset requests are explained', async ({ page }) => {
  await mockApi(page, { '/api/v1/auth/request-password-reset': { status: 429 } });
  await page.goto('/ar/forgot-password');
  await page.getByLabel('البريد الإلكتروني').fill('sara@trend.sa');
  await page.getByRole('button', { name: 'إرسال الرابط' }).click();
  await expect(alert(page)).toContainText('طلبات كثيرة');
});

test('a reset link sets the new password and sends you to sign in', async ({ page }) => {
  const calls = await mockApi(page, { '/api/v1/auth/reset-password': { body: { status: true } } });
  await page.goto('/ar/reset-password?token=tok123');
  await expect(page.getByRole('button', { name: 'حفظ كلمة المرور' })).toBeDisabled();
  await choosePassword(page);
  await expect(page.getByRole('heading', { name: 'تغيّرت كلمة المرور' })).toBeVisible();
  expect(calls).toEqual([
    {
      path: '/api/v1/auth/reset-password',
      body: { token: 'tok123', newPassword: 'a-new-password-1' },
    },
  ]);
  await page.getByRole('link', { name: 'الذهاب لتسجيل الدخول' }).click();
  await expect(page).toHaveURL(/\/ar\/login$/);
});

test('an expired or used link offers a new one', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/reset-password': { status: 400, body: { code: 'INVALID_TOKEN' } },
  });
  await page.goto('/ar/reset-password?token=old');
  await choosePassword(page);
  await expect(alert(page)).toContainText('رابط الاستعادة غير صالح');
  await page.getByRole('link', { name: 'اطلب رابطاً جديداً' }).click();
  await expect(page).toHaveURL(/\/ar\/forgot-password$/);
});

test('a link without a token is invalid', async ({ page }) => {
  await page.goto('/ar/reset-password');
  await expect(alert(page)).toContainText('رابط الاستعادة غير صالح');
});

test('a leaked password is refused with a reason', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/reset-password': { status: 400, body: { code: 'PASSWORD_COMPROMISED' } },
  });
  await page.goto('/ar/reset-password?token=tok');
  await choosePassword(page, 'password1234');
  await expect(alert(page)).toContainText('تسريبات معروفة');
  await expect(page.getByLabel('كلمة المرور الجديدة')).toBeVisible();
});

test('the locked screen offers password recovery', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/sign-in/email': { status: 429, body: { code: 'ACCOUNT_LOCKED', retryAfter: 60 } },
  });
  await page.goto('/ar/login');
  await page.getByLabel('البريد الإلكتروني').fill('sara@trend.sa');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('x-password-1');
  await page.getByRole('button', { name: 'دخول' }).click();
  await page.getByRole('link', { name: 'نسيت كلمة المرور' }).click();
  await expect(page).toHaveURL(/\/ar\/forgot-password$/);
});
