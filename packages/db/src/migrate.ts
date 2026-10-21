import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

// §12.4: الترحيلات تُطبّق آلياً بدور المالك (لا بدور التطبيق)، كل ملف في معاملة،
// ولا يُسمح بتعديل ترحيل طُبّق سابقاً (توسيع ثم تقليص بملفات جديدة).

export const migrationsDir = join(__dirname, '..', 'migrations');

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export async function migrate(adminUrl: string, dir = migrationsDir): Promise<MigrationResult> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  const result: MigrationResult = { applied: [], skipped: [] };
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    // يمنع تشغيل ترحيلين متزامنين.
    await client.query(`SELECT pg_advisory_lock(hashtext('trend_migrations'))`);

    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.sql'))
      .sort();
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations',
    );
    const done = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const prior = done.get(file);
      if (prior) {
        if (prior !== checksum) {
          throw new Error(`Migration ${file} was modified after being applied`);
        }
        result.skipped.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('COMMIT');
        result.applied.push(file);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query(`SELECT pg_advisory_unlock(hashtext('trend_migrations'))`).catch(() => {});
    await client.end();
  }
  return result;
}
