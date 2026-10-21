import { Global, Inject, Injectable, Module, type OnModuleDestroy } from '@nestjs/common';
import { createPool, withTenant, type Db } from '@trend/db';
import type { Pool, PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config';
import type { Principal } from '../auth/principal';

export const PG_POOL = Symbol('PG_POOL');

/**
 * §5.4: الوصول الوحيد للبيانات من الخادم. كل استدعاء معاملة مضبوطة على مستأجر الطالب
 * ومعرّفه وعنوانه، فتعمل سياسات RLS وسجل التدقيق تلقائياً.
 */
@Injectable()
export class TenantDb {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  run<T>(principal: Principal, fn: (db: Db, client: PoolClient) => Promise<T>): Promise<T> {
    return withTenant(
      this.pool,
      {
        tenantId: principal.tenantId,
        userId: principal.userId,
        source: principal.source,
        actorType: principal.source === 'mcp' ? 'mcp' : 'user',
        ip: principal.ip,
      },
      fn,
    );
  }

  async ping(): Promise<boolean> {
    const { rows } = await this.pool.query<{ ok: number }>('SELECT 1 AS ok');
    return rows[0]?.ok === 1;
  }
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => createPool(config.DATABASE_URL),
    },
    TenantDb,
  ],
  exports: [TenantDb, PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
