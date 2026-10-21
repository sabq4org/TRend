import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProvisionResult } from './provision';
import { createTestDatabase, type TestDatabase } from './test-db';
import { withTenant } from './tenant';
import { addUnit, addUser, twoTenants } from './fixtures.test-helpers';

// بوابة المرحلة 2: «اختبارات الصلاحيات وعزل المستأجرين ناجحة 100%» (§15.1).
// §5.4 / §7.3: RLS تمنع رؤية بيانات مستأجر آخر حتى لو أخطأ الكود.

let db: TestDatabase;
let A: ProvisionResult;
let B: ProvisionResult;

const TENANT_TABLES = [
  'users',
  'workspaces',
  'org_units',
  'memberships',
  'membership_org_units',
  'work_calendars',
  'audit_events',
  'outbox_events',
];

beforeAll(async () => {
  db = await createTestDatabase();
  [A, B] = await twoTenants(db.adminPool);
  // بيانات لكل جدول في المستأجرين كليهما.
  for (const t of [A, B]) {
    const unit = await addUnit(db.appPool, t, 'department', null);
    await addUser(db.appPool, t, `m@${t.tenantId}.sa`, 'member', { orgUnitId: unit });
    await withTenant(db.appPool, { tenantId: t.tenantId }, async (_d, c) => {
      const {
        rows: [m],
      } = await c.query<{ id: string }>(`SELECT id FROM memberships WHERE role = 'member'`);
      await c.query(
        `INSERT INTO membership_org_units (tenant_id, workspace_id, membership_id, org_unit_id) VALUES ($1, $2, $3, $4)`,
        [t.tenantId, t.workspaceId, m!.id, unit],
      );
      await c.query(
        `INSERT INTO outbox_events (tenant_id, topic, payload) VALUES ($1, 'x', '{}')`,
        [t.tenantId],
      );
    });
  }
});

afterAll(async () => {
  await db?.drop();
});

describe('schema guarantees', () => {
  it('every table with tenant_id has RLS enabled, forced, and a policy', async () => {
    const { rows } = await db.adminPool.query<{
      table: string;
      rls: boolean;
      forced: boolean;
      policies: number;
    }>(`
      SELECT c.relname AS table, c.relrowsecurity AS rls, c.relforcerowsecurity AS forced,
             (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
       WHERE c.relkind IN ('r', 'p')
         AND (c.relname = 'tenants' OR EXISTS (
               SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped))`);
    const names = rows.map((r) => r.table).sort();
    expect(names).toEqual([...TENANT_TABLES, 'tenants'].sort());
    for (const r of rows) {
      expect(r, r.table).toMatchObject({ rls: true, forced: true });
      expect(r.policies, r.table).toBeGreaterThan(0);
    }
  });

  it('every public table except schema_migrations is tenant-scoped', async () => {
    const { rows } = await db.adminPool.query<{ t: string }>(`
      SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`);
    const unscoped = rows
      .map((r) => r.t)
      .filter((t) => ![...TENANT_TABLES, 'tenants', 'schema_migrations'].includes(t));
    expect(unscoped).toEqual([]);
  });

  it('the application role cannot bypass RLS', async () => {
    const { rows } = await db.appPool.query<{ s: boolean; b: boolean }>(
      `SELECT rolsuper AS s, rolbypassrls AS b FROM pg_roles WHERE rolname = current_user`,
    );
    expect(rows[0]).toEqual({ s: false, b: false });
  });
});

describe('read isolation', () => {
  for (const table of [...TENANT_TABLES, 'tenants']) {
    it(`${table}: tenant A sees none of tenant B's rows`, async () => {
      const col = table === 'tenants' ? 'id' : 'tenant_id';
      const [own, foreign] = await withTenant(
        db.appPool,
        { tenantId: A.tenantId },
        async (_d, c) => {
          const o = await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [
            A.tenantId,
          ]);
          const f = await c.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} <> $1`, [
            A.tenantId,
          ]);
          return [o.rows[0].n as number, f.rows[0].n as number];
        },
      );
      expect(own).toBeGreaterThan(0);
      expect(foreign).toBe(0);
    });

    it(`${table}: no tenant context means no rows (fail closed)`, async () => {
      const { rows } = await db.appPool.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(rows[0].n).toBe(0);
    });
  }

  it('tenant context does not leak to the next use of a pooled connection', async () => {
    const one = await db.appPool.connect();
    await one.query('BEGIN');
    await one.query(`SELECT set_config('app.tenant_id', $1, true)`, [A.tenantId]);
    await one.query('COMMIT');
    const { rows } = await one.query(`SELECT count(*)::int AS n FROM users`);
    one.release();
    expect(rows[0].n).toBe(0);
  });
});

describe('write isolation', () => {
  it('cannot insert a row for another tenant', async () => {
    await expect(
      withTenant(db.appPool, { tenantId: A.tenantId }, (_d, c) =>
        c.query(`INSERT INTO workspaces (tenant_id, name) VALUES ($1, 'تسلل')`, [B.tenantId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another tenant's rows", async () => {
    const { updated, deleted } = await withTenant(
      db.appPool,
      { tenantId: A.tenantId },
      async (_d, c) => {
        const u = await c.query(`UPDATE workspaces SET name = 'x' WHERE id = $1`, [B.workspaceId]);
        const d = await c.query(`DELETE FROM work_calendars WHERE workspace_id = $1`, [
          B.workspaceId,
        ]);
        return { updated: u.rowCount, deleted: d.rowCount };
      },
    );
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
  });

  it('cannot move own rows into another tenant', async () => {
    await expect(
      withTenant(db.appPool, { tenantId: A.tenantId }, (_d, c) =>
        c.query(`UPDATE workspaces SET tenant_id = $1 WHERE id = $2`, [B.tenantId, A.workspaceId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot reference another tenant's user even with a known id", async () => {
    await expect(
      withTenant(db.appPool, { tenantId: A.tenantId }, (_d, c) =>
        c.query(
          `INSERT INTO memberships (tenant_id, user_id, workspace_id, role) VALUES ($1, $2, $3, 'member')`,
          [A.tenantId, B.ownerUserId, A.workspaceId],
        ),
      ),
    ).rejects.toThrow(/foreign key/);
  });

  it('cannot create tenants from the application role', async () => {
    await expect(
      withTenant(db.appPool, { tenantId: A.tenantId }, (_d, c) =>
        c.query(`INSERT INTO tenants (id, name) VALUES ($1, 'x')`, [A.tenantId]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
