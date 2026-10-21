import { createPool, provisionTenant, withTenant } from '@trend/db';
import { hashPassword } from '../auth/password';

// بيانات التطوير المحلي (§12.2: بيانات وهمية مولّدة). يُشغَّل بدور المالك.
// كلمة مرور المالك للتطوير فقط؛ يُطلب منه تفعيل المصادقة الثنائية عند أول دخول (§9.2).
const OWNER_EMAIL = 'owner@trend.local';
const DEV_PASSWORD = process.env.SEED_OWNER_PASSWORD ?? 'trend-dev-password';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('seed is disabled in production');
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) throw new Error('DATABASE_ADMIN_URL is required');
  const pool = createPool(url, 1);
  try {
    const existing = await pool.query(`SELECT id FROM tenants LIMIT 1`);
    if (existing.rowCount) {
      console.log('already seeded');
      return;
    }
    const result = await provisionTenant(pool, {
      tenantName: 'ترند',
      workspaceName: 'ترند',
      owner: { email: OWNER_EMAIL, nameAr: 'مالك ترند', nameEn: 'TRend Owner' },
    });
    const {
      rows: [identity],
    } = await pool.query<{ id: string }>(
      `INSERT INTO auth."user" (name, email, "emailVerified") VALUES ($1, $2, true) RETURNING id`,
      ['TRend Owner', OWNER_EMAIL],
    );
    await pool.query(
      `INSERT INTO auth."account" ("accountId", "providerId", "userId", password, "updatedAt")
       VALUES ($1, 'credential', $2, $3, now())`,
      [identity!.id, identity!.id, await hashPassword(DEV_PASSWORD)],
    );
    await withTenant(pool, { tenantId: result.tenantId, source: 'system' }, (_d, c) =>
      c.query(`UPDATE users SET auth_user_id = $1 WHERE id = $2`, [
        identity!.id,
        result.ownerUserId,
      ]),
    );
    console.log(JSON.stringify({ ...result, email: OWNER_EMAIL, password: DEV_PASSWORD }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
