import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config';
import { unauthorized } from '../common/problem';
import { TenantDb } from '../database/database.module';
import type { Principal } from './principal';
import { verifyAccessToken } from './tokens';

const IS_PUBLIC = 'trend:isPublic';
/** يُستثنى من المصادقة (الفحص الصحي فقط حالياً). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** الحارس الافتراضي لكل نقطة نهاية: لا وصول دون رمز صالح لمستخدم نشط في مستأجره. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: TenantDb,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) {
      return true;
    }
    const req = ctx.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const header = req.headers.authorization ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) throw unauthorized();

    let claims;
    try {
      claims = await verifyAccessToken(token, this.config);
    } catch {
      throw unauthorized();
    }

    const principal: Principal = {
      userId: claims.sub,
      tenantId: claims.tid,
      ip: req.ip ?? null,
      source: 'api',
    };
    // الاستعلام يمر عبر RLS: مستخدم من مستأجر آخر لا يُعثر عليه أصلاً.
    const active = await this.db.run(principal, async (_db, c) => {
      const { rows } = await c.query(
        `SELECT 1 FROM users WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [principal.userId],
      );
      return rows.length === 1;
    });
    if (!active) throw unauthorized();

    req.principal = principal;
    return true;
  }
}
