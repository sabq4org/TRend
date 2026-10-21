import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import {
  createTestDatabase,
  provisionTenant,
  withTenant,
  type ProvisionResult,
  type TestDatabase,
} from '@trend/db';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/auth/tokens';
import { createApp } from '../src/bootstrap';
import { loadConfig, type AppConfig } from '../src/config';

// §14.1: «اختبارات الصلاحيات إلزامية لكل نقطة نهاية» — والمستأجر الآخر لا يُرى أبداً.

let db: TestDatabase;
let app: INestApplication;
let config: AppConfig;
let A: ProvisionResult;
let B: ProvisionResult;
const users: Record<string, string> = {};

const token = (sub: string, tid = A.tenantId) => signAccessToken({ sub, tid }, config);
const api = () => request(app.getHttpServer());
const as = async (user: string, tid?: string) => ({
  Authorization: `Bearer ${await token(user, tid)}`,
});

async function addMember(
  t: ProvisionResult,
  key: string,
  role: 'admin' | 'member' | 'guest',
  opts: { expires?: Date; managerId?: string } = {},
) {
  users[key] = await withTenant(db.appPool, { tenantId: t.tenantId }, async (_d, c) => {
    const {
      rows: [u],
    } = await c.query(
      `INSERT INTO users (tenant_id, email, name_ar, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [t.tenantId, `${key}@trend.sa`, key],
    );
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, workspace_id, role, guest_expires_at, manager_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        t.tenantId,
        u.id,
        t.workspaceId,
        role,
        role === 'guest' ? opts.expires : null,
        opts.managerId ?? null,
      ],
    );
    return u.id as string;
  });
}

beforeAll(async () => {
  db = await createTestDatabase();
  config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: db.appUrl,
    JWT_SECRET: 'test-secret-test-secret-test-secret-123',
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
  users.owner = A.ownerUserId;
  await addMember(A, 'admin', 'admin');
  await addMember(A, 'member', 'member', { managerId: undefined });
  await addMember(A, 'report', 'member');
  await addMember(A, 'guest', 'guest', { expires: new Date(Date.now() + 86_400_000) });
  await addMember(A, 'expired', 'guest', { expires: new Date(Date.now() - 1000) });
  // «report» يتبع المشرف مباشرة، فيقع في نطاقه.
  await withTenant(db.appPool, { tenantId: A.tenantId }, (_d, c) =>
    c.query(`UPDATE memberships SET manager_id = $1 WHERE user_id = $2`, [
      users.admin,
      users.report,
    ]),
  );

  app = await createApp(config);
  await app.init();
});

afterAll(async () => {
  await app?.close();
  await db?.drop();
});

describe('health', () => {
  it('is public', async () => {
    await api().get('/api/v1/health').expect(200, { status: 'ok', db: 'ok' });
  });
});

describe('authentication', () => {
  it('rejects requests without a token with an RFC 9457 problem in Arabic and English', async () => {
    const res = await api().get('/api/v1/me').expect(401);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body).toMatchObject({
      status: 401,
      code: 'unauthorized',
      messages: { ar: 'يجب تسجيل الدخول للمتابعة' },
    });
  });

  it('rejects a token signed with another key', async () => {
    const forged = await signAccessToken(
      { sub: A.ownerUserId, tid: A.tenantId },
      {
        ...config,
        JWT_SECRET: 'another-secret-another-secret-another-1',
      },
    );
    await api().get('/api/v1/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });

  it('rejects an expired token', async () => {
    const expired = await signAccessToken({ sub: A.ownerUserId, tid: A.tenantId }, config, -10);
    await api().get('/api/v1/me').set('Authorization', `Bearer ${expired}`).expect(401);
  });

  it('rejects a valid user id paired with another tenant', async () => {
    await api()
      .get('/api/v1/me')
      .set(await as(A.ownerUserId, B.tenantId))
      .expect(401);
  });

  it('returns the current user and workspaces', async () => {
    const res = await api()
      .get('/api/v1/me')
      .set(await as(users.owner!))
      .expect(200);
    expect(res.body).toMatchObject({
      id: A.ownerUserId,
      workspaces: [{ id: A.workspaceId, role: 'owner' }],
    });
  });

  it('hides workspaces of expired guests', async () => {
    const res = await api()
      .get('/api/v1/me')
      .set(await as(users.expired!))
      .expect(200);
    expect(res.body.workspaces).toEqual([]);
  });
});

describe('tenant isolation over HTTP', () => {
  it("returns 404 for another tenant's workspace", async () => {
    for (const path of ['org-units', 'members', 'audit-events']) {
      await api()
        .get(`/api/v1/workspaces/${B.workspaceId}/${path}`)
        .set(await as(users.owner!))
        .expect(404);
    }
  });
});

describe('org units (FR-ORG-01, §9.1)', () => {
  let sectorId: string;

  it.each([
    ['owner', 201],
    ['admin', 201],
    ['member', 403],
    ['guest', 403],
    ['expired', 403],
  ])('%s creating a unit → %i', async (who, status) => {
    const res = await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/org-units`)
      .set(await as(users[who]!))
      .send({ nameAr: `قطاع ${who}`, type: 'sector' })
      .expect(status);
    if (status === 201) sectorId = res.body.id;
  });

  it('rejects an invalid hierarchy with a validation problem', async () => {
    const team = await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/org-units`)
      .set(await as(users.owner!))
      .send({ nameAr: 'فريق', type: 'team', parentId: sectorId })
      .expect(201);
    expect(team.body.depth).toBe(2);
    await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/org-units`)
      .set(await as(users.owner!))
      .send({ nameAr: 'إدارة', type: 'department', parentId: team.body.id })
      .expect(400);
  });

  it('lets members read the tree but not guests', async () => {
    const res = await api()
      .get(`/api/v1/workspaces/${A.workspaceId}/org-units`)
      .set(await as(users.member!))
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    await api()
      .get(`/api/v1/workspaces/${A.workspaceId}/org-units`)
      .set(await as(users.guest!))
      .expect(403);
  });
});

describe('members (FR-ORG-03, FR-ADM-02)', () => {
  it('admin invites a member with role and unit in one step', async () => {
    const res = await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/members`)
      .set(await as(users.admin!))
      .send({ email: 'Hind@Trend.sa', nameAr: 'هند', role: 'member' })
      .expect(201);
    expect(res.body.role).toBe('member');
    const outbox = await db.adminPool.query(
      `SELECT topic FROM outbox_events WHERE payload->>'userId' = $1`,
      [res.body.userId],
    );
    expect(outbox.rows).toEqual([{ topic: 'member.invited' }]);
  });

  it('rejects a duplicate invite with 409', async () => {
    await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/members`)
      .set(await as(users.admin!))
      .send({ email: 'hind@trend.sa', nameAr: 'هند', role: 'member' })
      .expect(409);
  });

  it('requires an expiry date for guests', async () => {
    const res = await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/members`)
      .set(await as(users.owner!))
      .send({ email: 'client@example.com', nameAr: 'عميل', role: 'guest' })
      .expect(400);
    expect(res.body.errors[0].path).toBe('guestExpiresAt');
    expect(res.body.messages.ar).toBe('البيانات المُرسلة غير صالحة');
  });

  it('members cannot invite', async () => {
    await api()
      .post(`/api/v1/workspaces/${A.workspaceId}/members`)
      .set(await as(users.member!))
      .send({ email: 'x@trend.sa', nameAr: 'س', role: 'member' })
      .expect(403);
  });

  it('guests cannot see the staff directory', async () => {
    await api()
      .get(`/api/v1/workspaces/${A.workspaceId}/members`)
      .set(await as(users.guest!))
      .expect(403);
  });
});

describe('audit log (§9.1, NFR-16)', () => {
  it('owner sees everything, including system provisioning', async () => {
    const res = await api()
      .get(`/api/v1/workspaces/${A.workspaceId}/audit-events?limit=200`)
      .set(await as(users.owner!))
      .expect(200);
    const actions = res.body.map((e: { action: string }) => e.action);
    expect(actions).toContain('tenants.created');
    expect(actions).toContain('org_units.created');
  });

  it('admin sees only their own and their reports’ actions', async () => {
    const res = await api()
      .get(`/api/v1/workspaces/${A.workspaceId}/audit-events?limit=200`)
      .set(await as(users.admin!))
      .expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const e of res.body) expect([users.admin, users.report]).toContain(e.actorId);
  });

  it('members and guests cannot read it', async () => {
    for (const who of ['member', 'guest']) {
      await api()
        .get(`/api/v1/workspaces/${A.workspaceId}/audit-events`)
        .set(await as(users[who]!))
        .expect(404);
    }
  });

  it('records API writes with source and actor', async () => {
    const { rows } = await db.adminPool.query(
      `SELECT actor_id, source FROM audit_events WHERE action = 'org_units.created' AND tenant_id = $1 LIMIT 1`,
      [A.tenantId],
    );
    expect(rows[0]).toEqual({ actor_id: A.ownerUserId, source: 'api' });
  });
});
