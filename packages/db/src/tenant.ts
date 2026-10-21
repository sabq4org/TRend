import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;

export interface TenantContext {
  tenantId: string;
  userId?: string | null;
  /** §8.4: مصدر العملية في سجل التدقيق (app | api | mcp | system). */
  source?: string;
  actorType?: 'user' | 'system' | 'api_key' | 'mcp';
  ip?: string | null;
}

export function createPool(connectionString: string, max = 10): Pool {
  return new Pool({ connectionString, max });
}

/**
 * §5.4: كل وصول للبيانات يمر عبر معاملة تضبط app.tenant_id أولاً (SET LOCAL)،
 * فتنطبق سياسات RLS على كل استعلام، وتُمسح الإعدادات تلقائياً بانتهاء المعاملة
 * فلا يتسرب سياق مستأجر لطلب آخر يعيد استخدام الاتصال نفسه.
 */
export async function withTenant<T>(
  pool: Pool,
  ctx: TenantContext,
  fn: (db: Db, client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.tenant_id', $1, true),
              set_config('app.user_id', $2, true),
              set_config('app.source', $3, true),
              set_config('app.actor_type', $4, true),
              set_config('app.ip', $5, true)`,
      [
        ctx.tenantId,
        ctx.userId ?? '',
        ctx.source ?? 'app',
        ctx.actorType ?? (ctx.userId ? 'user' : 'system'),
        ctx.ip ?? '',
      ],
    );
    const result = await fn(drizzle(client, { schema }), client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
