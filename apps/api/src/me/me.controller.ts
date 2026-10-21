import { Controller, Get } from '@nestjs/common';
import { AllowWithoutMfa } from '../auth/auth.guard';
import { CurrentPrincipal, type Principal } from '../auth/principal';
import { TenantDb } from '../database/database.module';

@Controller('me')
export class MeController {
  constructor(private readonly db: TenantDb) {}

  /** المستخدم الحالي ومساحاته وأدواره، وهل عليه تفعيل المصادقة الثنائية (§9.2). */
  @AllowWithoutMfa()
  @Get()
  me(@CurrentPrincipal() p: Principal) {
    return this.db.run(p, async (_db, c) => {
      const {
        rows: [user],
      } = await c.query(
        `SELECT id, email, name_ar AS "nameAr", name_en AS "nameEn", locale, timezone,
                numeral_system AS "numeralSystem"
           FROM users WHERE id = $1`,
        [p.userId],
      );
      const { rows: workspaces } = await c.query(
        `SELECT w.id, w.name, m.role
           FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
          WHERE m.user_id = $1 AND m.deleted_at IS NULL AND w.deleted_at IS NULL
            AND (m.guest_expires_at IS NULL OR m.guest_expires_at > now())
          ORDER BY w.name`,
        [p.userId],
      );
      return { ...user, workspaces, mfaRequired: p.privileged && !p.mfa };
    });
  }
}
