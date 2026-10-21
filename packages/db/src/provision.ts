import type { Pool } from 'pg';

// تهيئة مستأجر جديد بمساحته الأولى ومالكها. تُشغَّل بدور المالك (لا بدور التطبيق)،
// وتضبط app.tenant_id على المستأجر الجديد حتى تمر سياسات RLS المفروضة (FORCE).

export interface ProvisionInput {
  tenantName: string;
  workspaceName: string;
  owner: { email: string; nameAr: string; nameEn?: string };
}

export interface ProvisionResult {
  tenantId: string;
  workspaceId: string;
  ownerUserId: string;
}

export async function provisionTenant(
  admin: Pool,
  input: ProvisionInput,
): Promise<ProvisionResult> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<{ id: string }>('SELECT app.uuid_v7()::text AS id');
    const tenantId = rows[0]!.id;
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.source', 'system', true)`,
      [tenantId],
    );
    await client.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [
      tenantId,
      input.tenantName,
    ]);
    const {
      rows: [user],
    } = await client.query<{ id: string }>(
      `INSERT INTO users (tenant_id, email, name_ar, name_en, status)
       VALUES ($1, $2, $3, $4, 'active') RETURNING id`,
      [tenantId, input.owner.email, input.owner.nameAr, input.owner.nameEn ?? null],
    );
    const {
      rows: [ws],
    } = await client.query<{ id: string }>(
      'INSERT INTO workspaces (tenant_id, name) VALUES ($1, $2) RETURNING id',
      [tenantId, input.workspaceName],
    );
    await client.query(
      `INSERT INTO memberships (tenant_id, user_id, workspace_id, role) VALUES ($1, $2, $3, 'owner')`,
      [tenantId, user!.id, ws!.id],
    );
    // FR-ORG-05 / §10.2: تقويم عمل افتراضي للشركة (الأحد–الخميس).
    await client.query('INSERT INTO work_calendars (tenant_id, workspace_id) VALUES ($1, $2)', [
      tenantId,
      ws!.id,
    ]);
    await client.query('COMMIT');
    return { tenantId, workspaceId: ws!.id, ownerUserId: user!.id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
