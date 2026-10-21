import { Inject, Injectable } from '@nestjs/common';
import type { CreateOrgUnitInput, InviteMemberInput } from '@trend/schemas';
import type { Principal } from '../auth/principal';
import { notFound } from '../common/problem';
import { APP_CONFIG, type AppConfig } from '../config';
import { TenantDb } from '../database/database.module';
import { issueInvitation } from '../invitations/tokens';
import { loadWorkspaceAccess } from './access';

export interface OrgUnitNode {
  id: string;
  parentId: string | null;
  type: string;
  nameAr: string;
  nameEn: string | null;
  headUserId: string | null;
  depth: number;
}

@Injectable()
export class WorkspacesService {
  constructor(
    private readonly db: TenantDb,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** FR-ORG-01: شجرة الهيكل مرتبة بالمسار، يراها كل عضو غير ضيف. */
  listOrgUnits(p: Principal, workspaceId: string): Promise<OrgUnitNode[]> {
    return this.db.run(p, async (_db, c) => {
      const access = await loadWorkspaceAccess(c, p, workspaceId);
      if (access.actor.role === 'guest') {
        // §9.1: لا يظهر للضيف دليل الموظفين ولا الهيكل.
        access.require('manage', { kind: 'OrgUnit', workspaceId });
      }
      const { rows } = await c.query<OrgUnitNode>(
        `SELECT id, parent_id AS "parentId", type, name_ar AS "nameAr", name_en AS "nameEn",
                head_user_id AS "headUserId", nlevel(path) AS depth
           FROM org_units WHERE workspace_id = $1 AND deleted_at IS NULL ORDER BY path`,
        [workspaceId],
      );
      return rows;
    });
  }

  /** FR-ORG-01 / FR-ADM-01: إنشاء وحدة في الهيكل (مالك أو مشرف). */
  createOrgUnit(
    p: Principal,
    workspaceId: string,
    input: CreateOrgUnitInput,
  ): Promise<OrgUnitNode> {
    return this.db.run(p, async (_db, c) => {
      const access = await loadWorkspaceAccess(c, p, workspaceId);
      access.require('create', { kind: 'OrgUnit', workspaceId });
      const { rows } = await c.query<OrgUnitNode>(
        `INSERT INTO org_units (tenant_id, workspace_id, parent_id, type, name_ar, name_en, head_user_id, path)
         VALUES (app.current_tenant_id(), $1, $2, $3, $4, $5, $6, '')
         RETURNING id, parent_id AS "parentId", type, name_ar AS "nameAr", name_en AS "nameEn",
                   head_user_id AS "headUserId", nlevel(path) AS depth`,
        [
          workspaceId,
          input.parentId ?? null,
          input.type,
          input.nameAr,
          input.nameEn ?? null,
          input.headUserId ?? null,
        ],
      );
      return rows[0]!;
    });
  }

  /** FR-ADM-01: الأعضاء وأدوارهم وأقسامهم. */
  listMembers(p: Principal, workspaceId: string) {
    return this.db.run(p, async (_db, c) => {
      const access = await loadWorkspaceAccess(c, p, workspaceId);
      if (access.actor.role === 'guest') access.require('read', { kind: 'Member', workspaceId });
      const { rows } = await c.query(
        `SELECT m.id, m.user_id AS "userId", u.name_ar AS "nameAr", u.name_en AS "nameEn",
                u.email, u.status, m.role, m.org_unit_id AS "orgUnitId",
                m.manager_id AS "managerId", m.guest_expires_at AS "guestExpiresAt"
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.workspace_id = $1 AND m.deleted_at IS NULL
          ORDER BY u.name_ar`,
        [workspaceId],
      );
      return rows;
    });
  }

  /**
   * FR-ORG-03: دعوة بالبريد مع تحديد الدور والقسم في خطوة واحدة.
   * إرسال البريد يأتي مع وحدة الإشعارات؛ هنا يُكتب حدث member.invited في صندوق الأحداث.
   */
  inviteMember(p: Principal, workspaceId: string, input: InviteMemberInput) {
    return this.db.run(p, async (_db, c) => {
      const access = await loadWorkspaceAccess(c, p, workspaceId);
      access.require('create', { kind: 'Member', workspaceId });

      const existing = await c.query<{ id: string }>(
        `SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL`,
        [input.email],
      );
      const userId =
        existing.rows[0]?.id ??
        (
          await c.query<{ id: string }>(
            `INSERT INTO users (tenant_id, email, name_ar, name_en, status)
             VALUES (app.current_tenant_id(), $1, $2, $3, 'invited') RETURNING id`,
            [input.email, input.nameAr, input.nameEn ?? null],
          )
        ).rows[0]!.id;

      const {
        rows: [membership],
      } = await c.query<{ id: string }>(
        `INSERT INTO memberships (tenant_id, user_id, workspace_id, role, org_unit_id, manager_id, guest_expires_at)
         VALUES (app.current_tenant_id(), $1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          userId,
          workspaceId,
          input.role,
          input.orgUnitId ?? null,
          input.managerId ?? null,
          input.guestExpiresAt ?? null,
        ],
      );
      await c.query(
        `INSERT INTO outbox_events (tenant_id, topic, payload)
         VALUES (app.current_tenant_id(), 'member.invited', $1)`,
        [{ workspaceId, userId, membershipId: membership!.id, role: input.role }],
      );
      const invitation = await issueInvitation(c, this.config.WEB_URL, {
        id: membership!.id,
        workspaceId,
        userId,
      });
      return { membershipId: membership!.id, userId, role: input.role, invitation };
    });
  }

  /** FR-ORG-03: إعادة إصدار رابط الدعوة لعضو لم يفعّل حسابه بعد (يلغي الرابط السابق). */
  reissueInvitation(p: Principal, workspaceId: string, membershipId: string) {
    return this.db.run(p, async (_db, c) => {
      const access = await loadWorkspaceAccess(c, p, workspaceId);
      access.require('create', { kind: 'Member', workspaceId });
      const { rows } = await c.query<{ user_id: string }>(
        `SELECT m.user_id FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.id = $1 AND m.workspace_id = $2 AND m.deleted_at IS NULL AND u.status = 'invited'`,
        [membershipId, workspaceId],
      );
      if (!rows[0]) throw notFound();
      return issueInvitation(c, this.config.WEB_URL, {
        id: membershipId,
        workspaceId,
        userId: rows[0].user_id,
      });
    });
  }

  /** §9.1: سجل تدقيق المساحة — المالك كله، والمشرف لنطاقه فقط. أحداث المستأجر العامة خارجه. */
  listAuditEvents(p: Principal, workspaceId: string, limit: number) {
    return this.db.run(p, async (_db, c) => {
      const access = await loadWorkspaceAccess(c, p, workspaceId);
      const { role, userId, subordinateIds } = access.actor;
      if (role !== 'owner' && role !== 'admin') throw notFound();
      const scope = role === 'owner' ? null : [userId, ...subordinateIds];
      const { rows } = await c.query(
        `SELECT id, seq, actor_id AS "actorId", actor_type AS "actorType", source, action,
                entity_type AS "entityType", entity_id AS "entityId", occurred_at AS "occurredAt"
           FROM audit_events
          WHERE workspace_id = $1 AND ($2::uuid[] IS NULL OR actor_id = ANY($2))
          ORDER BY seq DESC LIMIT $3`,
        [workspaceId, scope, limit],
      );
      return rows;
    });
  }
}
