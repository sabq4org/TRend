import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProvisionResult } from './provision';
import { createTestDatabase, type TestDatabase } from './test-db';
import { withTenant } from './tenant';
import { twoTenants } from './fixtures.test-helpers';

// NFR-16: كل عملية على مهمة أو إعداد أو صلاحية مسجلة ولا يمكن حذفها — «فحص سلسلة التجزئة».

let db: TestDatabase;
let A: ProvisionResult;
let B: ProvisionResult;

beforeAll(async () => {
  db = await createTestDatabase();
  [A, B] = await twoTenants(db.adminPool);
});
afterAll(async () => {
  await db?.drop();
});

const verify = async (tenantId: string) =>
  (await db.adminPool.query(`SELECT app.verify_audit_chain($1) AS broken`, [tenantId])).rows[0]
    .broken as string | null;

describe('automatic auditing (§7.1)', () => {
  it('records provisioning as system actions', async () => {
    const { rows } = await db.adminPool.query(
      `SELECT action, actor_type FROM audit_events WHERE tenant_id = $1 ORDER BY seq`,
      [A.tenantId],
    );
    expect(rows.map((r) => r.action)).toEqual([
      'tenants.created',
      'users.created',
      'workspaces.created',
      'memberships.created',
      'work_calendars.created',
    ]);
    expect(new Set(rows.map((r) => r.actor_type))).toEqual(new Set(['system']));
  });

  it('records actor, source, ip and before/after on changes', async () => {
    await withTenant(
      db.appPool,
      { tenantId: A.tenantId, userId: A.ownerUserId, source: 'api', ip: '10.0.0.7' },
      (_d, c) =>
        c.query(`UPDATE workspaces SET name = 'ترند الرئيسية' WHERE id = $1`, [A.workspaceId]),
    );
    const { rows } = await db.adminPool.query(
      `SELECT * FROM audit_events WHERE tenant_id = $1 AND action = 'workspaces.updated'`,
      [A.tenantId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: A.ownerUserId,
      actor_type: 'user',
      source: 'api',
      ip: '10.0.0.7',
      entity_id: A.workspaceId,
    });
    expect(rows[0].before.name).toBe('ترند');
    expect(rows[0].after.name).toBe('ترند الرئيسية');
  });

  it('labels soft deletes as trashed', async () => {
    await withTenant(db.appPool, { tenantId: A.tenantId, userId: A.ownerUserId }, async (_d, c) => {
      const {
        rows: [w],
      } = await c.query(
        `INSERT INTO workspaces (tenant_id, name) VALUES ($1, 'مؤقتة') RETURNING id`,
        [A.tenantId],
      );
      await c.query(`UPDATE workspaces SET deleted_at = now() WHERE id = $1`, [w.id]);
    });
    const { rows } = await db.adminPool.query(
      `SELECT count(*)::int AS n FROM audit_events WHERE tenant_id = $1 AND action = 'workspaces.trashed'`,
      [A.tenantId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('skips no-op updates', async () => {
    const count = async () =>
      (await db.adminPool.query(`SELECT count(*)::int AS n FROM audit_events`)).rows[0].n;
    const before = await count();
    await withTenant(db.appPool, { tenantId: A.tenantId }, (_d, c) =>
      c.query(`UPDATE workspaces SET name = name WHERE id = $1`, [A.workspaceId]),
    );
    expect(await count()).toBe(before);
  });
});

describe('append-only hash chain (§9.2)', () => {
  it('chains are intact and independent per tenant', async () => {
    expect(await verify(A.tenantId)).toBeNull();
    expect(await verify(B.tenantId)).toBeNull();
    const { rows } = await db.adminPool.query(
      `SELECT prev_hash FROM audit_events WHERE tenant_id = $1 ORDER BY seq LIMIT 1`,
      [B.tenantId],
    );
    expect(rows[0].prev_hash).toBeNull();
  });

  it('stays linear under concurrent writes', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        withTenant(db.appPool, { tenantId: A.tenantId, userId: A.ownerUserId }, (_d, c) =>
          c.query(`INSERT INTO workspaces (tenant_id, name) VALUES ($1, $2)`, [
            A.tenantId,
            `ws${i}`,
          ]),
        ),
      ),
    );
    expect(await verify(A.tenantId)).toBeNull();
  });

  it('the application role cannot update or delete audit rows', async () => {
    for (const sql of [`UPDATE audit_events SET action = 'x'`, `DELETE FROM audit_events`]) {
      await expect(
        withTenant(db.appPool, { tenantId: A.tenantId }, (_d, c) => c.query(sql)),
      ).rejects.toThrow(/permission denied/);
    }
  });

  it('even the owner role is blocked by the append-only trigger', async () => {
    await expect(db.adminPool.query(`UPDATE audit_events SET action = 'x'`)).rejects.toThrow(
      /audit_events_append_only/,
    );
    await expect(db.adminPool.query(`DELETE FROM audit_events`)).rejects.toThrow(
      /audit_events_append_only/,
    );
    await expect(db.adminPool.query(`TRUNCATE audit_events`)).rejects.toThrow(
      /audit_events_append_only/,
    );
  });

  it('detects tampering if someone disables the trigger', async () => {
    const {
      rows: [target],
    } = await db.adminPool.query(
      `SELECT id, seq FROM audit_events WHERE tenant_id = $1 ORDER BY seq OFFSET 2 LIMIT 1`,
      [B.tenantId],
    );
    const c = await db.adminPool.connect();
    try {
      await c.query('BEGIN');
      await c.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_no_update');
      await c.query(`UPDATE audit_events SET after = '{"forged":true}' WHERE id = $1`, [target.id]);
      await c.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_no_update');
      await c.query('COMMIT');
    } finally {
      c.release();
    }
    expect(String(await verify(B.tenantId))).toBe(String(target.seq));
    expect(await verify(A.tenantId)).toBeNull();
  });
});
