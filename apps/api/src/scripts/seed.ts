import { createPool, provisionTenant } from '@trend/db';

// بيانات التطوير المحلي (§12.2: بيانات وهمية مولّدة). يُشغَّل بدور المالك.
async function main() {
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
      owner: { email: 'owner@trend.local', nameAr: 'مالك ترند', nameEn: 'TRend Owner' },
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
