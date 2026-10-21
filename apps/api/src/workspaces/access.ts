import {
  defaultMemberPolicy,
  defineAbilityFor,
  allows,
  type Action,
  type Actor,
  type AppAbility,
  type MemberPolicy,
  type Subject,
} from '@trend/permissions';
import type { Role } from '@trend/schemas';
import type { PoolClient } from 'pg';
import { forbidden, notFound } from '../common/problem';
import type { Principal } from '../auth/principal';

export interface WorkspaceAccess {
  actor: Actor;
  ability: AppAbility;
  require(action: Action, subject: Subject): void;
}

/**
 * يحمّل عضوية الطالب في المساحة ويبني صلاحياته (§9.1). يعمل داخل معاملة المستأجر.
 * مساحة لا عضوية فيها تُعامل كغير موجودة (404) حتى لا يُكشف وجودها.
 */
export async function loadWorkspaceAccess(
  c: PoolClient,
  principal: Principal,
  workspaceId: string,
): Promise<WorkspaceAccess> {
  const { rows } = await c.query<{
    role: Role;
    guest_expires_at: Date | null;
    settings: { memberPolicy?: Partial<MemberPolicy> };
  }>(
    `SELECT m.role, m.guest_expires_at, w.settings
       FROM memberships m JOIN workspaces w ON w.id = m.workspace_id
      WHERE m.user_id = $1 AND m.workspace_id = $2
        AND m.deleted_at IS NULL AND w.deleted_at IS NULL`,
    [principal.userId, workspaceId],
  );
  const row = rows[0];
  if (!row) throw notFound();

  const subordinates = await c.query<{ id: string }>(
    'SELECT app.subordinate_user_ids($1, $2) AS id',
    [principal.userId, workspaceId],
  );

  const actor: Actor = {
    userId: principal.userId,
    workspaceId,
    role: row.role,
    guestExpiresAt: row.guest_expires_at,
    subordinateIds: subordinates.rows.map((r) => r.id),
    memberPolicy: { ...defaultMemberPolicy, ...row.settings?.memberPolicy },
  };
  const ability = defineAbilityFor(actor);

  return {
    actor,
    ability,
    require(action, subject) {
      if (!allows(ability, action, subject)) throw forbidden();
    },
  };
}
