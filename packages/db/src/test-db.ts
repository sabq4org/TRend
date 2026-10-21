import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { migrate } from './migrate';

// قاعدة اختبار حقيقية معزولة لكل تشغيل (§14.1: «قاعدة اختبار حقيقية في حاوية»).
// المسؤول ينشئ قاعدة مؤقتة ويطبق الترحيلات، والاختبارات تتصل بدور تطبيق بلا صلاحيات تجاوز.

export interface TestDatabase {
  name: string;
  adminPool: Pool;
  appPool: Pool;
  adminUrl: string;
  appUrl: string;
  /** دور Better Auth (مخطط auth فقط). */
  authUrl: string;
  drop(): Promise<void>;
}

function withDatabase(url: string, db: string, user?: { name: string; password: string }): string {
  const u = new URL(url);
  u.pathname = `/${db}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const rootUrl =
    process.env.DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/postgres';
  const suffix = randomBytes(4).toString('hex');
  const name = `trend_test_${suffix}`;
  const appUser = { name: `trend_test_app_${suffix}`, password: randomBytes(12).toString('hex') };
  const authUser = { name: `trend_test_auth_${suffix}`, password: randomBytes(12).toString('hex') };

  const root = new Client({ connectionString: rootUrl });
  await root.connect();
  await root.query(`CREATE DATABASE ${name}`);
  await root.end();

  const adminUrl = withDatabase(rootUrl, name);
  await migrate(adminUrl);

  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(
    `CREATE ROLE ${appUser.name} LOGIN PASSWORD '${appUser.password}' NOSUPERUSER NOBYPASSRLS IN ROLE trend_app`,
  );
  await admin.query(
    `CREATE ROLE ${authUser.name} LOGIN PASSWORD '${authUser.password}' NOSUPERUSER NOBYPASSRLS IN ROLE trend_auth`,
  );
  await admin.end();

  const appUrl = withDatabase(rootUrl, name, appUser);
  const authUrl = withDatabase(rootUrl, name, authUser);
  const adminPool = new Pool({ connectionString: adminUrl, max: 4 });
  const appPool = new Pool({ connectionString: appUrl, max: 8 });

  return {
    name,
    adminPool,
    appPool,
    adminUrl,
    appUrl,
    authUrl,
    async drop() {
      await appPool.end();
      await adminPool.end();
      const c = new Client({ connectionString: rootUrl });
      await c.connect();
      await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await c.query(`DROP ROLE IF EXISTS ${appUser.name}`);
      await c.query(`DROP ROLE IF EXISTS ${authUser.name}`);
      await c.end();
    },
  };
}
