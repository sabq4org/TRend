import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProvisionResult } from './provision';
import { createTestDatabase, type TestDatabase } from './test-db';
import { withTenant } from './tenant';
import { addUnit, addUser, twoTenants } from './fixtures.test-helpers';

let db: TestDatabase;
let A: ProvisionResult;

beforeAll(async () => {
  db = await createTestDatabase();
  [A] = await twoTenants(db.adminPool);
});
afterAll(async () => {
  await db?.drop();
});

const q = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  withTenant(
    db.appPool,
    { tenantId: A.tenantId, userId: A.ownerUserId },
    async (_d, c) => (await c.query(sql, params)).rows as T[],
  );

describe('ids (§7.1)', () => {
  it('generates time-ordered UUIDv7', async () => {
    const { rows } = await db.adminPool.query(
      `SELECT app.uuid_v7()::text AS a, pg_sleep(0.002), app.uuid_v7()::text AS b`,
    );
    expect(rows[0].a[14]).toBe('7');
    expect(rows[0].a < rows[0].b).toBe(true);
  });
});

describe('org hierarchy (FR-ORG-01)', () => {
  it('builds ltree paths down the tree', async () => {
    const sector = await addUnit(db.appPool, A, 'sector', null);
    const dept = await addUnit(db.appPool, A, 'department', sector);
    const team = await addUnit(db.appPool, A, 'team', dept);
    const [row] = await q<{ ok: boolean; depth: number }>(
      `SELECT t.path <@ s.path AS ok, nlevel(t.path) AS depth
         FROM org_units t, org_units s WHERE t.id = $1 AND s.id = $2`,
      [team, sector],
    );
    expect(row).toEqual({ ok: true, depth: 3 });
  });

  it('rejects a unit under a lower or equal level', async () => {
    const team = await addUnit(db.appPool, A, 'team', null);
    await expect(addUnit(db.appPool, A, 'department', team)).rejects.toThrow(
      /org_unit_invalid_hierarchy/,
    );
  });

  it('rejects cycles', async () => {
    const sector = await addUnit(db.appPool, A, 'sector', null);
    const dept = await addUnit(db.appPool, A, 'department', sector);
    const section = await addUnit(db.appPool, A, 'section', dept);
    // نجعل القسم الأعلى تحت حفيده عبر تغيير النوع إلى فريق.
    await expect(
      q(`UPDATE org_units SET parent_id = $1, type = 'team' WHERE id = $2`, [section, dept]),
    ).rejects.toThrow(/org_unit_cycle/);
  });

  it('moving a unit moves its whole subtree', async () => {
    const s1 = await addUnit(db.appPool, A, 'sector', null);
    const s2 = await addUnit(db.appPool, A, 'sector', null);
    const dept = await addUnit(db.appPool, A, 'department', s1);
    const sec = await addUnit(db.appPool, A, 'section', dept);
    const team = await addUnit(db.appPool, A, 'team', sec);
    await q(`UPDATE org_units SET parent_id = $1 WHERE id = $2`, [s2, dept]);
    const rows = await q<{ id: string; under: boolean; old: boolean }>(
      `SELECT u.id, u.path <@ (SELECT path FROM org_units WHERE id = $1) AS under,
              u.path <@ (SELECT path FROM org_units WHERE id = $2) AS old
         FROM org_units u WHERE u.id = ANY($3)`,
      [s2, s1, [dept, sec, team]],
    );
    expect(rows).toHaveLength(3);
    for (const r of rows) expect(r).toMatchObject({ under: true, old: false });
  });
});

describe('memberships (FR-ORG-02, FR-ADM-02)', () => {
  it('requires an expiry date for guests and forbids it for others', async () => {
    const u = await addUser(db.appPool, A, 'g1@trend.sa', 'member');
    await expect(
      q(`UPDATE memberships SET role = 'guest' WHERE user_id = $1`, [u]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      q(`UPDATE memberships SET guest_expires_at = now() WHERE user_id = $1`, [u]),
    ).rejects.toThrow(/check constraint/);
  });

  it('a user cannot be their own manager', async () => {
    const u = await addUser(db.appPool, A, 'self@trend.sa');
    await expect(
      q(`UPDATE memberships SET manager_id = user_id WHERE user_id = $1`, [u]),
    ).rejects.toThrow(/check constraint/);
  });
});

describe('workspace consistency', () => {
  it('rejects units, managers and heads from another workspace of the same tenant', async () => {
    const [ws2] = await q<{ id: string }>(
      `INSERT INTO workspaces (tenant_id, name) VALUES (app.current_tenant_id(), 'ثانية') RETURNING id`,
    );
    const [foreignUnit] = await q<{ id: string }>(
      `INSERT INTO org_units (tenant_id, workspace_id, type, name_ar, path)
       VALUES (app.current_tenant_id(), $1, 'sector', 'قطاع آخر', '') RETURNING id`,
      [ws2!.id],
    );
    const u = await addUser(db.appPool, A, 'ws-check@trend.sa');
    // وحدة من مساحة أخرى
    await expect(
      q(`UPDATE memberships SET org_unit_id = $1 WHERE user_id = $2`, [foreignUnit!.id, u]),
    ).rejects.toThrow(/foreign key/);
    // مدير ليس عضواً في المساحة
    const [outsider] = await q<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name_ar) VALUES (app.current_tenant_id(), 'out@trend.sa', 'خارجي') RETURNING id`,
    );
    await expect(
      q(`UPDATE memberships SET manager_id = $1 WHERE user_id = $2`, [outsider!.id, u]),
    ).rejects.toThrow(/foreign key/);
    // رئيس وحدة ليس عضواً في مساحتها
    await expect(addUnit(db.appPool, A, 'sector', null, outsider!.id)).rejects.toThrow(
      /foreign key/,
    );
    // ربط إضافي بوحدة من مساحة أخرى
    await expect(
      q(
        `INSERT INTO membership_org_units (tenant_id, workspace_id, membership_id, org_unit_id)
         SELECT tenant_id, workspace_id, id, $2 FROM memberships WHERE user_id = $1`,
        [u, foreignUnit!.id],
      ),
    ).rejects.toThrow(/foreign key/);
  });
});

describe('hierarchical visibility (§9.1)', () => {
  it('a manager sees their subtree and direct reports, not peers or superiors', async () => {
    const boss = await addUser(db.appPool, A, 'boss@trend.sa', 'admin');
    const head = await addUser(db.appPool, A, 'head@trend.sa', 'admin');
    const peerHead = await addUser(db.appPool, A, 'peer@trend.sa', 'admin');

    const sector = await addUnit(db.appPool, A, 'sector', null, boss);
    const dept = await addUnit(db.appPool, A, 'department', sector, head);
    const peerDept = await addUnit(db.appPool, A, 'department', sector, peerHead);
    const team = await addUnit(db.appPool, A, 'team', dept);
    await q(`UPDATE memberships SET org_unit_id = $2 WHERE user_id = $1`, [boss, sector]);
    await q(`UPDATE memberships SET org_unit_id = $2 WHERE user_id = $1`, [head, dept]);
    await q(`UPDATE memberships SET org_unit_id = $2 WHERE user_id = $1`, [peerHead, peerDept]);

    const inDept = await addUser(db.appPool, A, 'd1@trend.sa', 'member', { orgUnitId: dept });
    const inTeam = await addUser(db.appPool, A, 't1@trend.sa', 'member', { orgUnitId: team });
    const inPeer = await addUser(db.appPool, A, 'p1@trend.sa', 'member', { orgUnitId: peerDept });
    const direct = await addUser(db.appPool, A, 'direct@trend.sa', 'member', { managerId: head });
    // عضو أصله في وحدة الزميل لكنه مرتبط إضافياً بفريق المدير (FR-ORG-02).
    const dual = await addUser(db.appPool, A, 'dual@trend.sa', 'member', { orgUnitId: peerDept });
    await q(
      `INSERT INTO membership_org_units (tenant_id, workspace_id, membership_id, org_unit_id)
       SELECT tenant_id, workspace_id, id, $2 FROM memberships WHERE user_id = $1`,
      [dual, team],
    );

    const sub = async (m: string) =>
      (await q<{ id: string }>(`SELECT app.subordinate_user_ids($1, $2) AS id`, [m, A.workspaceId]))
        .map((r) => r.id)
        .sort();

    expect(await sub(head)).toEqual([inDept, inTeam, direct, dual].sort());
    expect(await sub(head)).not.toContain(inPeer);
    expect(await sub(head)).not.toContain(boss);
    expect(await sub(boss)).toEqual(
      expect.arrayContaining([head, peerHead, inDept, inTeam, inPeer, dual]),
    );
    expect(await sub(inTeam)).toEqual([]);
  });
});

describe('work calendars (FR-ORG-05)', () => {
  it('defaults to a Sunday–Thursday week and validates hours', async () => {
    const [cal] = await q<{ weekdays: number[] }>(
      `SELECT weekdays FROM work_calendars WHERE workspace_id = $1 AND org_unit_id IS NULL`,
      [A.workspaceId],
    );
    expect(cal!.weekdays).toEqual([0, 1, 2, 3, 4]);
    await expect(
      q(`UPDATE work_calendars SET ramadan_start = '10:00' WHERE workspace_id = $1`, [
        A.workspaceId,
      ]),
    ).rejects.toThrow(/check constraint/);
    await expect(
      q(`UPDATE work_calendars SET weekdays = '{0,7}' WHERE workspace_id = $1`, [A.workspaceId]),
    ).rejects.toThrow(/check constraint/);
  });
});
