import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config';
import { PG_POOL } from '../database/database.module';
import { createAuth, settleAuthBackgroundTasks, type Auth } from './better-auth';
import { AccessTokenVerifier } from './tokens';

export const AUTH = Symbol('AUTH');
export const AUTH_POOL = Symbol('AUTH_POOL');

@Global()
@Module({
  providers: [
    {
      provide: AUTH_POOL,
      inject: [APP_CONFIG],
      // جداول Better Auth بأسمائها الافتراضية داخل مخطط auth.
      useFactory: (config: AppConfig) =>
        new Pool({
          connectionString: config.AUTH_DATABASE_URL,
          max: 5,
          options: '-c search_path=auth',
        }),
    },
    {
      provide: AUTH,
      inject: [APP_CONFIG, AUTH_POOL, PG_POOL],
      useFactory: (config: AppConfig, authPool: Pool, appPool: Pool): Auth =>
        createAuth({ config, authPool, appPool }),
    },
    {
      provide: AccessTokenVerifier,
      inject: [AUTH, APP_CONFIG],
      useFactory: (auth: Auth, config: AppConfig) => new AccessTokenVerifier(auth, config),
    },
  ],
  exports: [AUTH, AUTH_POOL, AccessTokenVerifier],
})
export class AuthModule implements OnModuleDestroy {
  constructor(@Inject(AUTH_POOL) private readonly pool: Pool) {}

  async onModuleDestroy(): Promise<void> {
    await settleAuthBackgroundTasks();
    await this.pool.end();
  }
}
