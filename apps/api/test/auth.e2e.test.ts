import 'reflect-metadata';
import { createHmac, randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import {
  createTestDatabase,
  provisionTenant,
  type ProvisionResult,
  type TestDatabase,
} from '@trend/db';
import { decodeJwt } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTH } from '../src/auth/auth.module';
import type { Auth } from '../src/auth/better-auth';
import { issueAccessToken } from '../src/auth/tokens';
import { createApp } from '../src/bootstrap';
import { loadConfig } from '../src/config';

// §8.1 / §9.2: الدخول بكلمة مرور، الرموز، القفل، المصادقة الثنائية، الأجهزة، وقبول الدعوة.

let db: TestDatabase;
let app: INestApplication;
let A: ProvisionResult;
let B: ProvisionResult;

const api = () => request(app.getHttpServer());
const accept = (token: string, password = PASSWORD) =>
  request(app.getHttpServer()).post('/api/v1/invitations/accept').send({ token, password });
const auth = (path: string) => `/api/v1/auth${path}`;
const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
// كلمة مرور تُولَّد لكل تشغيل، فلا تظهر قيمة ثابتة في المستودع.
const PASSWORD = `test-${randomBytes(12).toString('hex')}`;

/** يدعو عضواً بصلاحية المالك ويعيد رمز الدعوة. */
async function invite(email: string, role: 'admin' | 'member', t = A) {
  const owner = await issueAccessToken(app.get<Auth>(AUTH), {
    sub: t.ownerUserId,
    tid: t.tenantId,
    priv: true,
    mfa: true,
  });
  const res = await api()
    .post(`/api/v1/workspaces/${t.workspaceId}/members`)
    .set(bearer(owner))
    .send({ email, nameAr: email.split('@')[0], role })
    .expect(201);
  return res.body as { userId: string; invitation: { token: string; url: string } };
}

function signIn(email: string, password = PASSWORD) {
  return api().post(auth('/sign-in/email')).send({ email, password });
}

/** جلسة جديدة: رمز الجلسة (للتجديد) من ترويسة set-auth-token. */
async function session(email: string) {
  const res = await signIn(email).expect(200);
  return res.headers['set-auth-token'] as string;
}

async function accessToken(sessionToken: string) {
  const res = await api().get(auth('/token')).set(bearer(sessionToken)).expect(200);
  return { jwt: res.body.token as string, next: res.headers['set-auth-token'] as string };
}

/** TOTP وفق RFC 6238 من سر base32 في رابط otpauth. */
function totp(uri: string, at = Date.now()) {
  const secret = new URL(uri).searchParams.get('secret')!;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of secret.replace(/=+$/, '')) {
    bits += alphabet.indexOf(ch).toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = createHmac('sha1', key).update(counter).digest();
  const offset = h[h.length - 1]! & 0xf;
  const code = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return code.toString().padStart(6, '0');
}

beforeAll(async () => {
  db = await createTestDatabase();
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.appUrl,
    AUTH_DATABASE_URL: db.authUrl,
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-123',
  });
  A = await provisionTenant(db.adminPool, {
    tenantName: 'ترند',
    workspaceName: 'ترند',
    owner: { email: 'owner@trend.sa', nameAr: 'المالك' },
  });
  B = await provisionTenant(db.adminPool, {
    tenantName: 'أخرى',
    workspaceName: 'أخرى',
    owner: { email: 'owner@other.sa', nameAr: 'مالك آخر' },
  });
  app = await createApp(config);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('schema', () => {
  it('matches what Better Auth expects (no pending migrations)', async () => {
    const { getMigrations } = await import('better-auth/db/migration');
    const { toBeCreated, toBeAdded, schemaProblems } = await getMigrations(
      app.get<Auth>(AUTH).options,
    );
    expect(toBeCreated.map((t) => t.table)).toEqual([]);
    expect(toBeAdded.map((t) => t.table)).toEqual([]);
    expect(schemaProblems).toEqual([]);
  });
});

describe('invitation acceptance (FR-ORG-03)', () => {
  let sara: Awaited<ReturnType<typeof invite>>;

  beforeAll(async () => {
    sara = await invite('sara@trend.sa', 'member');
  });

  it('returns a single-use link to the inviter', () => {
    expect(sara.invitation.url).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
  });

  it('rejects a short password', async () => {
    await api()
      .post('/api/v1/invitations/accept')
      .send({ token: sara.invitation.token, password: 'short' })
      .expect(400);
  });

  it('rejects an unknown token', async () => {
    const res = await api()
      .post('/api/v1/invitations/accept')
      .send({ token: 'x'.repeat(43), password: PASSWORD })
      .expect(400);
    expect(res.body.code).toBe('invalidInvitation');
  });

  it('cannot sign in before accepting', async () => {
    await signIn('sara@trend.sa').expect(401);
  });

  it('activates the account and sets the password', async () => {
    const res = await api()
      .post('/api/v1/invitations/accept')
      .send({ token: sara.invitation.token, password: PASSWORD })
      .expect(200);
    expect(res.body).toEqual({ email: 'sara@trend.sa' });
    const { rows } = await db.adminPool.query(
      `SELECT u.status, a.password LIKE '$argon2id$%' AS argon2id
         FROM users u JOIN auth."account" a ON a."userId" = u.auth_user_id
        WHERE u.id = $1`,
      [sara.userId],
    );
    expect(rows[0]).toEqual({ status: 'active', argon2id: true });
  });

  it('cannot be reused', async () => {
    const res = await api()
      .post('/api/v1/invitations/accept')
      .send({ token: sara.invitation.token, password: PASSWORD })
      .expect(400);
    expect(res.body.code).toBe('invalidInvitation');
  });

  it('refuses an invitation once the account is suspended', async () => {
    const later = await invite('later@trend.sa', 'member');
    await db.adminPool.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [later.userId]);
    const res = await accept(later.invitation.token).expect(400);
    expect(res.body.code).toBe('invalidInvitation');
  });

  it('an existing identity joins another tenant only with its own password, under lockout', async () => {
    await db.adminPool.query(`DELETE FROM auth.login_lockouts`);
    const other = await invite('sara@trend.sa', 'member', B);
    for (let i = 0; i < 5; i++)
      await accept(other.invitation.token, 'not-her-password-1').expect(401);
    const locked = await accept(other.invitation.token).expect(429);
    expect(locked.body.code).toBe('accountLocked');
    expect(locked.headers['retry-after']).toBeDefined();
    // القفل نفسه يمنع الدخول العادي.
    await signIn('sara@trend.sa').expect(429);
    await db.adminPool.query(`DELETE FROM auth.login_lockouts`);
    await accept(other.invitation.token).expect(200);
  });

  it('records acceptance in the audit log without the token hash', async () => {
    const { rows } = await db.adminPool.query(
      `SELECT action, after FROM audit_events WHERE entity_type = 'invitations' AND tenant_id = $1 ORDER BY seq`,
      [A.tenantId],
    );
    expect(rows.map((r) => r.action)).toContain('invitations.accepted');
    for (const r of rows) expect(r.after).not.toHaveProperty('token_hash');
  });
});

describe('sign-in and tokens (§8.1)', () => {
  it('self sign-up is disabled', async () => {
    await api()
      .post(auth('/sign-up/email'))
      .send({ email: 'free@trend.sa', password: PASSWORD, name: 'x' })
      .expect(400);
  });

  it('rejects a wrong password', async () => {
    await signIn('sara@trend.sa', 'wrong-password-123').expect(401);
  });

  it('issues a 15-minute access token that opens the API', async () => {
    const { jwt } = await accessToken(await session('sara@trend.sa'));
    const claims = decodeJwt(jwt);
    expect(claims.exp! - claims.iat!).toBe(15 * 60);
    expect(claims).toMatchObject({ tid: A.tenantId, priv: false, mfa: false });
    const me = await api().get('/api/v1/me').set(bearer(jwt)).expect(200);
    expect(me.body).toMatchObject({ email: 'sara@trend.sa', mfaRequired: false });
    expect(claims.sub).toBe(me.body.id);
  });

  it('rotates the refresh token on every use and retires the old one', async () => {
    const first = await session('sara@trend.sa');
    const { next } = await accessToken(first);
    expect(next).toBeTruthy();
    expect(next).not.toBe(first);
    const { rows } = await db.adminPool.query<{ left: number }>(
      `SELECT extract(epoch FROM "expiresAt" - now())::int AS left FROM auth."session" WHERE token = $1`,
      [first.split('.')[0]],
    );
    expect(rows[0]!.left).toBeLessThanOrEqual(30);
    // الرمز الجديد يعمل بدوره.
    await accessToken(next);
  });

  it('a session token is not accepted as an access token', async () => {
    const s = await session('sara@trend.sa');
    await api().get('/api/v1/me').set(bearer(s)).expect(401);
  });
});

describe('account lockout (§9.2)', () => {
  beforeAll(async () => {
    const lock = await invite('lock@trend.sa', 'member');
    await api()
      .post('/api/v1/invitations/accept')
      .send({ token: lock.invitation.token, password: PASSWORD })
      .expect(200);
  });

  it('locks the account for 15 minutes after 5 failed attempts', async () => {
    for (let i = 0; i < 5; i++) await signIn('lock@trend.sa', 'wrong-password-123').expect(401);
    const res = await signIn('lock@trend.sa').expect(429);
    expect(res.body.code).toBe('ACCOUNT_LOCKED');
    // حساب آخر لا يتأثر.
    await signIn('sara@trend.sa').expect(200);
  });

  it('a successful sign-in resets the counter', async () => {
    await db.adminPool.query(`DELETE FROM auth.login_lockouts`);
    for (let i = 0; i < 4; i++) await signIn('lock@trend.sa', 'wrong-password-123').expect(401);
    await signIn('lock@trend.sa').expect(200);
    for (let i = 0; i < 4; i++) await signIn('lock@trend.sa', 'wrong-password-123').expect(401);
    await signIn('lock@trend.sa').expect(200);
  });
});

describe('active devices (§8.1)', () => {
  it('lists sessions and revokes one', async () => {
    const phone = await session('sara@trend.sa');
    const laptop = await session('sara@trend.sa');
    const list = await api().get(auth('/list-sessions')).set(bearer(laptop)).expect(200);
    expect(list.body.length).toBeGreaterThanOrEqual(2);
    await api()
      .post(auth('/revoke-session'))
      .set(bearer(laptop))
      .send({ token: phone.split('.')[0] })
      .expect(200);
    await api().get(auth('/token')).set(bearer(phone)).expect(401);
    await accessToken(laptop);
  });
});

describe('two-factor authentication (§9.2)', () => {
  let otpUri: string;

  beforeAll(async () => {
    const noor = await invite('noor@trend.sa', 'admin');
    await api()
      .post('/api/v1/invitations/accept')
      .send({ token: noor.invitation.token, password: PASSWORD })
      .expect(200);
  });

  it('admins without 2FA are blocked from the API but can see why', async () => {
    const { jwt } = await accessToken(await session('noor@trend.sa'));
    expect(decodeJwt(jwt)).toMatchObject({ priv: true, mfa: false });
    const res = await api()
      .get(`/api/v1/workspaces/${A.workspaceId}/members`)
      .set(bearer(jwt))
      .expect(403);
    expect(res.body.code).toBe('mfaRequired');
    const me = await api().get('/api/v1/me').set(bearer(jwt)).expect(200);
    expect(me.body.mfaRequired).toBe(true);
  });

  let preEnrollment: string;

  it('enables TOTP after confirming a code', async () => {
    preEnrollment = await session('noor@trend.sa');
    const s = await session('noor@trend.sa');
    const enable = await api()
      .post(auth('/two-factor/enable'))
      .set(bearer(s))
      .send({ password: PASSWORD })
      .expect(200);
    otpUri = enable.body.totpURI;
    expect(otpUri).toMatch(/^otpauth:\/\/totp\/TRend:/);
    expect(enable.body.backupCodes.length).toBeGreaterThan(0);
    await api()
      .post(auth('/two-factor/verify-totp'))
      .set(bearer(s))
      .send({ code: '000000' === totp(otpUri) ? '111111' : '000000' })
      .expect(401);
    await api()
      .post(auth('/two-factor/verify-totp'))
      .set(bearer(s))
      .send({ code: totp(otpUri) })
      .expect(200);
  });

  it('then requires the code at sign-in and grants full access', async () => {
    const agent = request.agent(app.getHttpServer());
    const first = await agent
      .post(auth('/sign-in/email'))
      .send({ email: 'noor@trend.sa', password: PASSWORD })
      .expect(200);
    expect(first.body.twoFactorRedirect).toBe(true);
    expect(first.headers['set-auth-token']).toBeUndefined();

    const second = await agent
      .post(auth('/two-factor/verify-totp'))
      .send({ code: totp(otpUri) })
      .expect(200);
    const { jwt, next } = await accessToken(second.headers['set-auth-token'] as string);
    expect(decodeJwt(jwt)).toMatchObject({ priv: true, mfa: true });
    // التدوير يحفظ مستوى التحقق.
    expect(decodeJwt((await accessToken(next)).jwt)).toMatchObject({ mfa: true });
    await api().get(`/api/v1/workspaces/${A.workspaceId}/members`).set(bearer(jwt)).expect(200);
  });

  it('password-only sessions from before enrollment stay without MFA', async () => {
    const { jwt } = await accessToken(preEnrollment);
    expect(decodeJwt(jwt)).toMatchObject({ priv: true, mfa: false });
    await api().get(`/api/v1/workspaces/${A.workspaceId}/members`).set(bearer(jwt)).expect(403);
  });
});
