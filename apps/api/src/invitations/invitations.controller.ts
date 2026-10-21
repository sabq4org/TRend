import { Body, Controller, HttpCode, Inject, Injectable, Post } from '@nestjs/common';
import { withTenant } from '@trend/db';
import { acceptInvitationSchema, type AcceptInvitationInput } from '@trend/schemas';
import type { Pool } from 'pg';
import { AUTH, AUTH_POOL } from '../auth/auth.module';
import { Public } from '../auth/auth.guard';
import { lockedFor, recordPasswordAttempt, type Auth } from '../auth/better-auth';
import { accountLocked, invalidInvitation, unauthorized } from '../common/problem';
import { ZodPipe } from '../common/zod.pipe';
import { PG_POOL } from '../database/database.module';
import { hashInvitationToken } from './tokens';

@Injectable()
export class InvitationsService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(AUTH_POOL) private readonly authPool: Pool,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  /**
   * FR-ORG-03: قبول الدعوة وتفعيل الحساب. تُنشأ هوية الدخول (أو تُستخدم القائمة إن كان
   * للبريد حساب في مستأجر آخر، بشرط مطابقة كلمة مروره)، ثم يُربط المستخدم ويُفعَّل.
   */
  async accept(input: AcceptInvitationInput, ip: string | null): Promise<{ email: string }> {
    const hash = hashInvitationToken(input.token);
    const { rows } = await this.pool.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM app.find_invitation($1)',
      [hash],
    );
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) throw invalidInvitation();

    return withTenant(this.pool, { tenantId, source: 'api', ip }, async (_db, c) => {
      const {
        rows: [inv],
      } = await c.query<{ id: string; user_id: string; email: string; name_ar: string }>(
        `SELECT i.id, i.user_id, u.email, u.name_ar
           FROM invitations i JOIN users u ON u.id = i.user_id
          WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.expires_at > now()
            AND u.deleted_at IS NULL AND u.status = 'invited'
          FOR UPDATE OF i`,
        [hash],
      );
      if (!inv) throw invalidInvitation();
      // يُنسب القبول في سجل التدقيق إلى المدعو نفسه.
      await c.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.actor_type', 'user', true)`,
        [inv.user_id],
      );

      const identityId = await this.ensureIdentity(inv.email, inv.name_ar, input.password);
      await c.query(`UPDATE users SET auth_user_id = $1, status = 'active' WHERE id = $2`, [
        identityId,
        inv.user_id,
      ]);
      await c.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
      return { email: inv.email };
    });
  }

  private async ensureIdentity(email: string, name: string, password: string): Promise<string> {
    const ctx = await this.auth.$context;
    const { rows } = await this.authPool.query<{ id: string; password: string | null }>(
      `SELECT u.id, a.password
         FROM "user" u LEFT JOIN account a ON a."userId" = u.id AND a."providerId" = 'credential'
        WHERE u.email = $1`,
      [email.toLowerCase()],
    );
    const existing = rows[0];
    if (existing) {
      // §9.2: نفس عدّاد القفل الذي يحمي /sign-in/email، فلا يصبح القبول طريقاً لتخمين كلمة المرور.
      const retryAfter = await lockedFor(this.authPool, email);
      if (retryAfter !== null) throw accountLocked(retryAfter);
      const ok =
        !!existing.password && (await ctx.password.verify({ hash: existing.password, password }));
      await recordPasswordAttempt(this.authPool, email, ok);
      if (!ok) throw unauthorized();
      return existing.id;
    }
    const user = await ctx.internalAdapter.createUser(
      { email: email.toLowerCase(), name, emailVerified: true },
      { method: 'email-password' },
    );
    await ctx.internalAdapter.linkAccount({
      userId: user.id,
      providerId: 'credential',
      accountId: user.id,
      password: await ctx.password.hash(password),
    });
    return user.id;
  }
}

@Controller('invitations')
export class InvitationsController {
  constructor(private readonly service: InvitationsService) {}

  @Public()
  @Post('accept')
  @HttpCode(200)
  accept(@Body(new ZodPipe(acceptInvitationSchema)) body: AcceptInvitationInput) {
    return this.service.accept(body, null);
  }
}
