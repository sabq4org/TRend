import { createHash, randomBytes } from 'node:crypto';
import { isLocale } from '@trend/i18n';
import type { PoolClient } from 'pg';
import { enqueueMail } from '../mail/outbox';

// FR-ORG-03: رمز الدعوة لمرة واحدة. يُعاد للمرسل مرة واحدة ولا يُخزَّن إلا تجزئته.
export const INVITATION_TTL_DAYS = 7;

export const hashInvitationToken = (token: string): Buffer =>
  createHash('sha256').update(token).digest();

export interface IssuedInvitation {
  token: string;
  url: string;
  expiresAt: Date;
}

/**
 * يصدر رمزاً جديداً ويلغي أي رمز سابق غير مستخدم للعضوية نفسها، ويضع بريد الدعوة في
 * صندوق الصادر بلغة المدعو. داخل معاملة المستأجر، فلا يُرسل بريد لدعوة لم تثبت.
 */
export async function issueInvitation(
  c: PoolClient,
  webUrl: string,
  membership: { id: string; workspaceId: string; userId: string },
  inviterId: string,
): Promise<IssuedInvitation> {
  const token = randomBytes(32).toString('base64url');
  await c.query('DELETE FROM invitations WHERE membership_id = $1 AND accepted_at IS NULL', [
    membership.id,
  ]);
  const {
    rows: [row],
  } = await c.query<{ expires_at: Date }>(
    `INSERT INTO invitations (tenant_id, workspace_id, membership_id, user_id, token_hash, expires_at)
     VALUES (app.current_tenant_id(), $1, $2, $3, $4, now() + make_interval(days => $5))
     RETURNING expires_at`,
    [
      membership.workspaceId,
      membership.id,
      membership.userId,
      hashInvitationToken(token),
      INVITATION_TTL_DAYS,
    ],
  );
  const base = webUrl.replace(/\/$/, '');
  const issued = { token, url: `${base}/invite/${token}`, expiresAt: row!.expires_at };

  const {
    rows: [m],
  } = await c.query<{
    email: string;
    locale: string;
    name_ar: string;
    name_en: string | null;
    role: 'owner' | 'admin' | 'member' | 'guest';
    workspace: string;
    inviter_ar: string | null;
    inviter_en: string | null;
  }>(
    `SELECT u.email, u.locale, u.name_ar, u.name_en, ms.role, w.name AS workspace,
            i.name_ar AS inviter_ar, i.name_en AS inviter_en
       FROM memberships ms
       JOIN users u ON u.id = ms.user_id
       JOIN workspaces w ON w.id = ms.workspace_id
       LEFT JOIN users i ON i.id = $2
      WHERE ms.id = $1`,
    [membership.id, inviterId],
  );
  const locale = isLocale(m!.locale) ? m!.locale : 'ar';
  const named = (ar: string | null, en: string | null) => (locale === 'en' ? (en ?? ar) : ar) ?? '';
  await enqueueMail(c, m!.email, locale, {
    template: 'invitation',
    payload: {
      name: named(m!.name_ar, m!.name_en),
      inviter: named(m!.inviter_ar, m!.inviter_en) || m!.workspace,
      workspace: m!.workspace,
      role: m!.role,
      url: `${base}/${locale}/invite/${token}`,
      expiresAt: issued.expiresAt.toISOString(),
    },
  });
  return issued;
}
