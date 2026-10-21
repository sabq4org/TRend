import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  createTestDatabase,
  provisionTenant,
  type ProvisionResult,
  type TestDatabase,
} from '@trend/db';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AUTH } from '../src/auth/auth.module';
import type { Auth } from '../src/auth/better-auth';
import { issueAccessToken } from '../src/auth/tokens';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';
import { MemoryTransport } from '../src/mail/transport';
import { MailWorker } from '../src/mail/worker';

// §6.6 / §9.2 / FR-ORG-03: البريد الصادر، بريد الدعوة، واستعادة كلمة المرور.

let db: TestDatabase;
let app: INestApplication;
let A: ProvisionResult;
const mail = new MemoryTransport();

const api = () => request(app.getHttpServer());
const auth = (path: string) => `/api/v1/auth${path}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
const PASSWORD = `test-${randomBytes(12).toString('hex')}`;
const NEW_PASSWORD = `new-${randomBytes(12).toString('hex')}`;
const drain = () => app.get(MailWorker).drain();
const lastTo = (email: string) => mail.sent.filter((m) => m.to === email).at(-1);
const linkIn = (text: string) => text.match(/https?:\/\/\S+/)![0];

async function ownerToken() {
  return issueAccessToken(app.get<Auth>(AUTH), {
    sub: A.ownerUserId,
    tid: A.tenantId,
    priv: true,
    mfa: true,
  });
}

async function invite(email: string, nameAr = 'سارة') {
  return api()
    .post(`/api/v1/workspaces/${A.workspaceId}/members`)
    .set(bearer(await ownerToken()))
    .send({ email, nameAr, role: 'member' });
}

/** دعوة يُتوقع نجاحها. */
async function invited(email: string, nameAr?: string) {
  const res = await invite(email, nameAr);
  expect(res.status).toBe(201);
  return res;
}

/** يدعو مستخدماً ويفعّل حسابه بكلمة المرور الافتراضية. */
async function activeUser(email: string) {
  const res = await invited(email);
  await api()
    .post('/api/v1/invitations/accept')
    .send({ token: res.body.invitation.token, password: PASSWORD })
    .expect(200);
  return res.body as { userId: string; membershipId: string };
}

const requestReset = (email: string) =>
  api().post(auth('/request-password-reset')).send({ email }).expect(200);
const resetPassword = (token: string, newPassword = NEW_PASSWORD) =>
  api().post(auth('/reset-password')).send({ token, newPassword });
const signIn = (email: string, password: string) =>
  api().post(auth('/sign-in/email')).send({ email, password });

async function resetToken(email: string) {
  await drain();
  const sent = lastTo(email);
  expect(sent).toBeDefined();
  return new URL(linkIn(sent!.text)).searchParams.get('token')!;
}

beforeAll(async () => {
  db = await createTestDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
    WEB_URL: 'https://app.trend.test',
  });
  A = await provisionTenant(db.adminPool, {
    tenantName: 'ترند',
    workspaceName: 'فريق الأخبار',
    owner: { email: 'owner@trend.sa', nameAr: 'نورة' },
  });
  app = await createApp(config, { mailTransport: mail });
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

beforeEach(async () => {
  mail.sent.length = 0;
  mail.failNext = 0;
  await db.adminPool.query('DELETE FROM auth.login_lockouts');
});

describe('invitation email (FR-ORG-03)', () => {
  it('is queued with the invitation and sent in Arabic with the one-time link', async () => {
    const res = await invited('huda@trend.sa', 'هدى');
    expect(mail.sent).toHaveLength(0);
    expect(await drain()).toBe(1);

    const sent = lastTo('huda@trend.sa')!;
    expect(sent.subject).toBe('نورة يدعوك إلى فريق الأخبار في ترند');
    expect(sent.html).toContain('dir="rtl"');
    expect(sent.text).toContain('بدور عضو');
    expect(linkIn(sent.text)).toBe(`https://app.trend.test/ar/invite/${res.body.invitation.token}`);
  });

  it('wipes the link from the outbox once sent', async () => {
    await invited('wipe@trend.sa');
    await drain();
    const { rows } = await db.adminPool.query(
      `SELECT payload, sent_at FROM auth.mail_outbox WHERE to_email = 'wipe@trend.sa'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toEqual({});
    expect(rows[0].sent_at).not.toBeNull();
  });

  it('is sent again with a fresh link when the invitation is reissued', async () => {
    const first = await invited('again@trend.sa');
    await drain();
    const reissued = await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/members/${first.body.membershipId}/invitation`)
      .set(bearer(await ownerToken()))
      .expect(201);
    await drain();
    const sent = mail.sent.filter((m) => m.to === 'again@trend.sa');
    expect(sent).toHaveLength(2);
    expect(linkIn(sent[1]!.text)).toContain(reissued.body.token);
    expect(reissued.body.token).not.toBe(first.body.invitation.token);
  });

  it('replaces an unsent email when the invitation is reissued', async () => {
    const first = await invited('stale@trend.sa');
    mail.failNext = 1;
    expect(await drain()).toBe(0);
    const reissued = await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/members/${first.body.membershipId}/invitation`)
      .set(bearer(await ownerToken()))
      .expect(201);
    await db.adminPool.query(
      `UPDATE auth.mail_outbox SET send_after = now() WHERE to_email = 'stale@trend.sa'`,
    );
    expect(await drain()).toBe(1);
    const sent = mail.sent.filter((m) => m.to === 'stale@trend.sa');
    expect(sent).toHaveLength(1);
    expect(linkIn(sent[0]!.text)).toContain(reissued.body.token);
  });

  it('is not sent when the invitation fails', async () => {
    await invited('twice@trend.sa');
    await drain();
    mail.sent.length = 0;
    const res = await invite('twice@trend.sa');
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await drain()).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it('uses the invitee language', async () => {
    const res = await invited('omar@trend.sa', 'عمر');
    await db.adminPool.query(`UPDATE users SET locale = 'en', name_en = 'Omar' WHERE id = $1`, [
      res.body.userId,
    ]);
    await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/members/${res.body.membershipId}/invitation`)
      .set(bearer(await ownerToken()))
      .expect(201);
    await drain();
    const sent = lastTo('omar@trend.sa')!;
    expect(sent.subject).toBe('نورة invited you to فريق الأخبار on TRend');
    expect(sent.html).toContain('dir="ltr"');
    expect(sent.text).toContain('Hello Omar,');
    expect(linkIn(sent.text)).toMatch(/^https:\/\/app\.trend\.test\/en\/invite\//);
  });

  it('retries after a provider failure, later', async () => {
    await invited('retry@trend.sa');
    mail.failNext = 1;
    expect(await drain()).toBe(0);
    const { rows } = await db.adminPool.query(
      `SELECT attempts, last_error, send_after > now() AS deferred
         FROM auth.mail_outbox WHERE to_email = 'retry@trend.sa'`,
    );
    expect(rows[0]).toEqual({
      attempts: 1,
      last_error: 'simulated provider failure',
      deferred: true,
    });
    // لا يعاد فوراً؛ بعد حلول موعده يُرسل.
    expect(await drain()).toBe(0);
    await db.adminPool.query(
      `UPDATE auth.mail_outbox SET send_after = now() WHERE to_email = 'retry@trend.sa'`,
    );
    expect(await drain()).toBe(1);
    expect(lastTo('retry@trend.sa')).toBeDefined();
  });
});

describe('password recovery (§9.2)', () => {
  let rana: { userId: string };

  beforeAll(async () => {
    rana = await activeUser('rana@trend.sa');
  });

  it('answers the same for unknown, invited and suspended accounts, and sends nothing', async () => {
    await invited('pending@trend.sa');
    const suspended = await activeUser('gone@trend.sa');
    await db.adminPool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [
      suspended.userId,
    ]);
    await drain();
    mail.sent.length = 0;

    const answers = await Promise.all(
      ['nobody@trend.sa', 'pending@trend.sa', 'gone@trend.sa'].map(
        async (email) => (await requestReset(email)).body,
      ),
    );
    expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
    expect(await drain()).toBe(0);
  });

  it('emails a 30-minute link to the web reset screen', async () => {
    await requestReset('rana@trend.sa');
    await drain();
    const sent = lastTo('rana@trend.sa')!;
    expect(sent.subject).toBe('إعادة تعيين كلمة المرور في ترند');
    expect(sent.text).toContain('30 دقيقة');
    expect(linkIn(sent.text)).toMatch(
      /^https:\/\/app\.trend\.test\/ar\/reset-password\?token=[A-Za-z0-9]+$/,
    );
    const { rows } = await db.adminPool.query(
      `SELECT round(extract(epoch FROM "expiresAt" - now()) / 60) AS minutes
         FROM auth.verification WHERE identifier LIKE 'reset-password:%'
        ORDER BY "createdAt" DESC LIMIT 1`,
    );
    expect(Number(rows[0].minutes)).toBe(30);
  });

  it('sends at most one email a minute to the same address', async () => {
    await db.adminPool.query(`DELETE FROM auth.mail_outbox WHERE to_email = 'rana@trend.sa'`);
    await requestReset('rana@trend.sa');
    await requestReset('rana@trend.sa');
    expect(await drain()).toBe(1);
  });

  it('rejects a short new password', async () => {
    await db.adminPool.query(`DELETE FROM auth.mail_outbox WHERE to_email = 'rana@trend.sa'`);
    await requestReset('rana@trend.sa');
    const token = await resetToken('rana@trend.sa');
    await resetPassword(token, 'short').expect(400);
  });

  it('sets the new password, signs out every device and unlocks the account', async () => {
    const before = (await signIn('rana@trend.sa', PASSWORD).expect(200)).headers[
      'set-auth-token'
    ] as string;
    for (let i = 0; i < 5; i++) await signIn('rana@trend.sa', 'wrong-password-1');
    await signIn('rana@trend.sa', PASSWORD).expect(429);

    await db.adminPool.query(`DELETE FROM auth.mail_outbox WHERE to_email = 'rana@trend.sa'`);
    await requestReset('rana@trend.sa');
    const token = await resetToken('rana@trend.sa');
    await resetPassword(token).expect(200);

    await api().get(auth('/token')).set(bearer(before)).expect(401);
    await signIn('rana@trend.sa', PASSWORD).expect(401);
    await signIn('rana@trend.sa', NEW_PASSWORD).expect(200);
    // الرابط لمرة واحدة.
    const reused = await resetPassword(token, `${NEW_PASSWORD}-2`).expect(400);
    expect(reused.body.code).toBe('INVALID_TOKEN');
  });

  it('rejects an expired link', async () => {
    await db.adminPool.query(`DELETE FROM auth.mail_outbox WHERE to_email = 'rana@trend.sa'`);
    await requestReset('rana@trend.sa');
    const token = await resetToken('rana@trend.sa');
    await db.adminPool.query(
      `UPDATE auth.verification SET "expiresAt" = now() - interval '1 second'
        WHERE identifier = $1`,
      [`reset-password:${token}`],
    );
    const res = await resetPassword(token).expect(400);
    expect(res.body.code).toBe('INVALID_TOKEN');
    expect(rana.userId).toBeDefined();
  });
});
