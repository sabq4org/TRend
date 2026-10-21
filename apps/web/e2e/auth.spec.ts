import { expect, test, type Page } from '@playwright/test';
import { mockApi, signedIn } from './helpers';

// §8.1 / §9.2 / FR-ORG-03: شاشات الدخول. الخادم مُحاكى هنا؛ سلوكه نفسه مختبر في apps/api.

/** رسائل الخطأ، دون مُعلن التنقل الذي يضيفه Next.js. */
const alert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

async function fillLogin(page: Page, password = 'correct-password') {
  await page.getByLabel('البريد الإلكتروني').fill('sara@trend.sa');
  await page.getByLabel('كلمة المرور', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'دخول' }).click();
}

test('the login screen is Arabic, right-to-left, without the app sidebar', async ({ page }) => {
  await page.goto('/ar/login');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('تسجيل الدخول');
  await expect(page.getByRole('navigation')).toHaveCount(0);
  await page.getByRole('button', { name: 'إظهار كلمة المرور' }).click();
  await expect(page.getByLabel('كلمة المرور', { exact: true })).toHaveAttribute('type', 'text');
});

test('a wrong password shows an alert and keeps the form', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/sign-in/email': { status: 401, body: { code: 'INVALID_EMAIL_OR_PASSWORD' } },
  });
  await page.goto('/ar/login');
  await fillLogin(page, 'wrong');
  await expect(alert(page)).toContainText('البريد أو كلمة المرور غير صحيحة');
  await expect(page.getByLabel('البريد الإلكتروني')).toBeVisible();
});

test('a locked account shows the remaining time', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/sign-in/email': {
      status: 429,
      body: { code: 'ACCOUNT_LOCKED', retryAfter: 125 },
    },
  });
  await page.goto('/ar/login');
  await fillLogin(page);
  await expect(page.getByRole('heading', { name: 'أوقفنا محاولات الدخول مؤقتاً' })).toBeVisible();
  await expect(page.getByText(/^02:0[0-5]$/)).toBeVisible();
});

test('a member without 2FA goes straight to the home page', async ({ page }) => {
  const calls = await mockApi(page, {
    '/api/v1/auth/sign-in/email': { body: { token: 'session' } },
    ...signedIn(false),
  });
  await page.goto('/ar/login');
  await fillLogin(page);
  await expect(page).toHaveURL(/\/ar$/);
  expect(calls[0]).toEqual({
    path: '/api/v1/auth/sign-in/email',
    body: { email: 'sara@trend.sa', password: 'correct-password' },
  });
});

test('a 2FA account is asked for the code, then an admin without MFA is sent to set it up', async ({
  page,
}) => {
  await mockApi(page, {
    '/api/v1/auth/sign-in/email': { body: { twoFactorRedirect: true } },
    '/api/v1/auth/two-factor/verify-totp': (body) =>
      (body as { code: string }).code === '123456' ? { body: {} } : { status: 401 },
    ...signedIn(true),
  });
  await page.goto('/ar/login');
  await fillLogin(page);
  await expect(page).toHaveURL(/\/ar\/login\/two-factor$/);

  await page.getByLabel('رمز التحقق').fill('000000');
  await page.getByRole('button', { name: 'تحقق ودخول' }).click();
  await expect(alert(page)).toContainText('الرمز غير صحيح');

  await page.getByLabel('رمز التحقق').fill('123 456');
  await page.getByRole('button', { name: 'تحقق ودخول' }).click();
  await expect(page).toHaveURL(/\/ar\/setup-mfa$/);
});

test('setting up 2FA shows the key, a QR code and then the backup codes', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/auth/two-factor/enable': (body) =>
      (body as { password: string }).password === 'correct-password'
        ? {
            body: {
              totpURI: 'otpauth://totp/TRend:noor%40trend.sa?secret=JBSWY3DPEHPK3PXP&issuer=TRend',
              backupCodes: ['aaaa-1111', 'bbbb-2222'],
            },
          }
        : { status: 400, body: { code: 'INVALID_PASSWORD' } },
    '/api/v1/auth/two-factor/verify-totp': { body: {} },
  });
  await page.goto('/ar/setup-mfa');
  await page.getByLabel('أكّد كلمة المرور للبدء').fill('wrong');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect(alert(page)).toHaveText('كلمة المرور غير صحيحة.');

  await page.getByLabel('أكّد كلمة المرور للبدء').fill('correct-password');
  await page.getByRole('button', { name: 'متابعة' }).click();
  await expect(page.getByText('JBSWY3DPEHPK3PXP')).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'رمز QR لإضافة ترند إلى تطبيق المصادقة' }),
  ).toBeVisible();

  await page.getByLabel('رمز التحقق').fill('123456');
  await page.getByRole('button', { name: 'تفعيل' }).click();
  await expect(page.getByRole('heading', { name: 'احفظ رموزك الاحتياطية' })).toBeVisible();
  await expect(page.getByText('aaaa-1111')).toBeVisible();
});

test('accepting an invitation sets the password and signs in', async ({ page }) => {
  const calls = await mockApi(page, {
    '/api/v1/invitations/accept': { body: { email: 'hind@trend.sa' } },
    '/api/v1/auth/sign-in/email': { body: {} },
    ...signedIn(false),
  });
  await page.goto('/ar/invite/tok_123');
  const submit = page.getByRole('button', { name: 'تفعيل الحساب' });
  await page.getByLabel('كلمة المرور', { exact: true }).fill('short');
  await expect(submit).toBeDisabled();
  await page.getByLabel('كلمة المرور', { exact: true }).fill('a-long-password');
  await page.getByLabel('تأكيد كلمة المرور').fill('a-long-password');
  await submit.click();
  await expect(page).toHaveURL(/\/ar$/);
  expect(calls.slice(0, 2)).toEqual([
    { path: '/api/v1/invitations/accept', body: { token: 'tok_123', password: 'a-long-password' } },
    {
      path: '/api/v1/auth/sign-in/email',
      body: { email: 'hind@trend.sa', password: 'a-long-password' },
    },
  ]);
});

test('a used invitation link explains what to do', async ({ page }) => {
  await mockApi(page, {
    '/api/v1/invitations/accept': { status: 400, body: { code: 'invalidInvitation' } },
  });
  await page.goto('/ar/invite/used');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('a-long-password');
  await page.getByLabel('تأكيد كلمة المرور').fill('a-long-password');
  await page.getByRole('button', { name: 'تفعيل الحساب' }).click();
  await expect(alert(page)).toHaveText('رابط الدعوة غير صالح أو منتهٍ أو مستخدم.');
});

test('if sign-in fails after the invitation is accepted, the user is sent to sign in', async ({
  page,
}) => {
  await mockApi(page, {
    '/api/v1/invitations/accept': { body: { email: 'hind@trend.sa' } },
    '/api/v1/auth/sign-in/email': { status: 500 },
  });
  await page.goto('/ar/invite/tok_456');
  await page.getByLabel('كلمة المرور', { exact: true }).fill('a-long-password');
  await page.getByLabel('تأكيد كلمة المرور').fill('a-long-password');
  await page.getByRole('button', { name: 'تفعيل الحساب' }).click();
  await expect(page).toHaveURL(/\/ar\/login$/);
});
