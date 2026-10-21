import type { Pool } from 'pg';
import { provisionTenant, type ProvisionResult } from './provision';
import { withTenant } from './tenant';

export async function twoTenants(admin: Pool): Promise<[ProvisionResult, ProvisionResult]> {
  const a = await provisionTenant(admin, {
    tenantName: 'ترند',
    workspaceName: 'ترند',
    owner: { email: 'owner@trend.sa', nameAr: 'مالك ترند' },
  });
  const b = await provisionTenant(admin, {
    tenantName: 'شركة أخرى',
    workspaceName: 'أخرى',
    owner: { email: 'owner@other.sa', nameAr: 'مالك آخر' },
  });
  return [a, b];
}

export async function addUser(
  app: Pool,
  t: ProvisionResult,
  email: string,
  role: 'admin' | 'member' | 'guest' = 'member',
  extra: { orgUnitId?: string | null; managerId?: string | null } = {},
): Promise<string> {
  return withTenant(app, { tenantId: t.tenantId, userId: t.ownerUserId }, async (_db, c) => {
    const {
      rows: [u],
    } = await c.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name_ar) VALUES ($1, $2, $3) RETURNING id`,
      [t.tenantId, email, email.split('@')[0]],
    );
    await c.query(
      `INSERT INTO memberships (tenant_id, user_id, workspace_id, role, org_unit_id, manager_id, guest_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        t.tenantId,
        u!.id,
        t.workspaceId,
        role,
        extra.orgUnitId ?? null,
        extra.managerId ?? null,
        role === 'guest' ? new Date(Date.now() + 86_400_000) : null,
      ],
    );
    return u!.id;
  });
}

export async function addUnit(
  app: Pool,
  t: ProvisionResult,
  type: 'sector' | 'department' | 'section' | 'team',
  parentId: string | null,
  headUserId: string | null = null,
): Promise<string> {
  return withTenant(app, { tenantId: t.tenantId, userId: t.ownerUserId }, async (_db, c) => {
    const {
      rows: [u],
    } = await c.query<{ id: string }>(
      `INSERT INTO org_units (tenant_id, workspace_id, parent_id, type, name_ar, head_user_id, path)
       VALUES ($1, $2, $3, $4, $5, $6, '') RETURNING id`,
      [t.tenantId, t.workspaceId, parentId, type, `${type}-${Math.random()}`, headUserId],
    );
    return u!.id;
  });
}
