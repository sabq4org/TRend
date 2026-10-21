import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { TenantDb } from '../database/database.module';

// §12.5: فحص توفر الخدمة من الخارج.
@Controller('health')
export class HealthController {
  constructor(private readonly db: TenantDb) {}

  @Public()
  @Get()
  async check() {
    const db = await this.db.ping().catch(() => false);
    if (!db) throw new ServiceUnavailableException();
    return { status: 'ok', db: 'ok' };
  }
}
