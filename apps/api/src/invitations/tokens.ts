import { createHash, randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';

// FR-ORG-03: رمز الدعوة لمرة واحدة. يُعاد للمرسل مرة واحدة ولا يُخزَّن إلا تجزئته.
export const INVITATION_TTL_DAYS = 7;

export const hashInvitationToken = (token: string): Buffer =>
  createHash('sha256').update(token).digest();

export interface IssuedInvitation {
  token: string;
  url: string;
  expiresAt: Date;
}

/** يصدر رمزاً جديداً ويلغي أي رمز سابق غير مستخدم للعضوية نفسها. داخل معاملة المستأجر. */
export async function issueInvitation(
  c: PoolClient,
  webUrl: string,
  membership: { id: string; workspaceId: string; userId: string },
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
  return {
    token,
    url: `${webUrl.replace(/\/$/, '')}/invite/${token}`,
    expiresAt: row!.expires_at,
  };
}
