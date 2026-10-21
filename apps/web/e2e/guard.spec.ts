import { expect, test, type Page } from '@playwright/test';
import { mockApi, signedIn } from './helpers';

// §8.1 / §9.2: صفحات التطبيق لمن سجّل الدخول فقط.

const noSession = { '/api/v1/auth/token': { status: 401, body: { code: 'UNAUTHORIZED' } } };

async function fillLogin(page: Page) {
  await page.getByLabel('البريد الإلكتروني').fill('sara@trend.sa');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('correct-password');
  await page.getByRole('button', { name: 'دخول' }).click();
}

test('without a session the app sends you to the login screen and shows nothing first', async ({
  page,
}) => {
  await mockApi(page, noSession);
  await page.goto('/ar');
  await expect(page).toHaveURL(/\/ar\/login$/);
  await expect(page.getByRole('navigation')).toHaveCount(0);
});

test('after signing in you return to the page you asked for', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/sign-in/email': { body: { token: 'session' } },
    ...signedIn(false),
  });
  await page.goto('/ar/login?next=%2F%3Fwelcome%3D1');
  await fillLogin(page);
  await expect(page).toHaveURL(/\/ar\?welcome=1$/);
});

test('a next link to another site is ignored', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/sign-in/email': { body: { token: 'session' } },
    ...signedIn(false),
  });
  await page.goto('/ar/login?next=%2F%2Fevil.example');
  await fillLogin(page);
  await expect(page).toHaveURL(/localhost:3100\/ar$/);
});

test('an admin without 2FA is sent to set it up before using the app', async ({ page }) => {
  await mockApi(page, signedIn(true));
  await page.goto('/ar');
  await expect(page).toHaveURL(/\/ar\/setup-mfa$/);
});

test('when the server is unreachable the app offers a retry instead of the login screen', async ({
  page,
}) => {
  let up = false;
  await mockApi(page, {
    '/api/v1/auth/token': () => (up ? { body: { token: 'jwt' } } : { status: 503 }),
    '/api/v1/me': { body: { id: 'u1', email: 'sara@trend.sa', mfaRequired: false } },
  });
  await page.goto('/ar');
  await expect(page.getByText('تعذّر الوصول إلى الخادم')).toBeVisible();
  await expect(page).toHaveURL(/\/ar$/);
  up = true;
  await page.getByRole('button', { name: 'إعادة المحاولة' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مرحباً بك في ترند');
});

test('signing out ends the session and returns to the login screen', async ({ page }) => {
  const calls = await mockApi(page, { ...signedIn(false), '/api/v1/auth/sign-out': { body: {} } });
  await page.goto('/ar');
  await page.getByRole('button', { name: 'تسجيل الخروج' }).click();
  await expect(page).toHaveURL(/\/ar\/login$/);
  expect(calls.map((c) => c.path)).toContain('/api/v1/auth/sign-out');
});
