import {
  AbilityBuilder,
  createMongoAbility,
  subject as asSubject,
  type MongoAbility,
} from '@casl/ability';
import type { Role } from '@trend/schemas';

// §9.1: مصفوفة الأدوار على مستوى المساحة. هذا الفحص يعمل في الخادم لكل طلب،
// وعزل الصفوف (RLS) في قاعدة البيانات هو خط الدفاع الثاني. فحص الواجهة تجميلي فقط.

export type Action = 'manage' | 'create' | 'read' | 'update' | 'delete' | 'send' | 'access';

export interface WorkspaceSubject {
  kind: 'Workspace';
  id: string;
}
export interface BillingSubject {
  kind: 'Billing';
  workspaceId: string;
}
export interface MemberSubject {
  kind: 'Member';
  workspaceId: string;
}
export interface OrgUnitSubject {
  kind: 'OrgUnit';
  workspaceId: string;
}
export interface ProjectSubject {
  kind: 'Project';
  workspaceId: string;
}
export interface BoardSubject {
  kind: 'Board';
  workspaceId: string;
  ownerId: string;
  memberIds: string[];
}
export interface TaskSubject {
  kind: 'Task';
  workspaceId: string;
  boardMemberIds: string[];
  /** المضافون صراحةً (المكلّفون والمتابعون) — هم وحدهم ما يراه الضيف. */
  participantIds: string[];
}
export interface PerformanceSubject {
  kind: 'Performance';
  workspaceId: string;
  userId: string;
}
export interface PerformancePolicySubject {
  kind: 'PerformancePolicy';
  workspaceId: string;
}
export interface ConversationSubject {
  kind: 'Conversation';
  workspaceId: string;
  memberIds: string[];
}
export interface MeetingSubject {
  kind: 'Meeting';
  workspaceId: string;
  inviteeIds: string[];
}
export interface AlertCallSubject {
  kind: 'AlertCall';
  workspaceId: string;
}
export interface AuditLogSubject {
  kind: 'AuditLog';
  workspaceId: string;
  /** المستخدم صاحب الحدث، لتطبيق نطاق المشرف. */
  actorId: string;
}

export type Subject =
  | WorkspaceSubject
  | BillingSubject
  | MemberSubject
  | OrgUnitSubject
  | ProjectSubject
  | BoardSubject
  | TaskSubject
  | PerformanceSubject
  | PerformancePolicySubject
  | ConversationSubject
  | MeetingSubject
  | AlertCallSubject
  | AuditLogSubject;

export type SubjectKind = Subject['kind'];
export type AppAbility = MongoAbility<[Action, SubjectKind | Subject]>;

/** الصلاحيات القابلة للضبط للعضو (§9.1: «قابل للضبط»). المالك لا يُعدَّل. */
export interface MemberPolicy {
  canCreateProjects: boolean;
  canSendAlertCalls: boolean;
}

export const defaultMemberPolicy: MemberPolicy = {
  canCreateProjects: false,
  canSendAlertCalls: true,
};

export interface Actor {
  userId: string;
  workspaceId: string;
  role: Role;
  /** معرّفات من هم تحت المستخدم في شجرة الهيكل (قاعدة الرؤية الهرمية). */
  subordinateIds: string[];
  guestExpiresAt?: Date | null;
  memberPolicy?: MemberPolicy;
  now?: Date;
}

export function isGuestExpired(actor: Pick<Actor, 'role' | 'guestExpiresAt' | 'now'>): boolean {
  if (actor.role !== 'guest') return false;
  // الضيف بلا تاريخ انتهاء حالة غير صالحة: نعامله كمنتهٍ (فشل آمن).
  if (!actor.guestExpiresAt) return true;
  return actor.guestExpiresAt.getTime() <= (actor.now ?? new Date()).getTime();
}

export function defineAbilityFor(actor: Actor): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  const ws = actor.workspaceId;
  const me = actor.userId;
  const policy = actor.memberPolicy ?? defaultMemberPolicy;
  const inScope = [me, ...actor.subordinateIds];

  if (isGuestExpired(actor)) return build();

  switch (actor.role) {
    case 'owner':
      can('update', 'Workspace', { id: ws });
      can('manage', 'Billing', { workspaceId: ws });
      can('manage', 'Member', { workspaceId: ws });
      can('manage', 'OrgUnit', { workspaceId: ws });
      can('create', 'Project', { workspaceId: ws });
      can('manage', 'Board', { workspaceId: ws });
      can('manage', 'Task', { workspaceId: ws });
      can('read', 'Performance', { workspaceId: ws });
      can('update', 'PerformancePolicy', { workspaceId: ws });
      can('read', 'Conversation', { workspaceId: ws });
      can('access', 'Meeting', { workspaceId: ws });
      can('send', 'AlertCall', { workspaceId: ws });
      can('read', 'AuditLog', { workspaceId: ws });
      break;

    case 'admin':
      can('manage', 'Member', { workspaceId: ws });
      can('manage', 'OrgUnit', { workspaceId: ws });
      can('create', 'Project', { workspaceId: ws });
      can('manage', 'Board', { workspaceId: ws });
      can('manage', 'Task', { workspaceId: ws });
      can('read', 'Performance', { workspaceId: ws, userId: { $in: inScope } });
      can('read', 'Conversation', { workspaceId: ws });
      can('access', 'Meeting', { workspaceId: ws });
      can('send', 'AlertCall', { workspaceId: ws });
      can('read', 'AuditLog', { workspaceId: ws, actorId: { $in: inScope } });
      break;

    case 'member':
      if (policy.canCreateProjects) {
        can('create', 'Project', { workspaceId: ws });
        can('create', 'Board', { workspaceId: ws });
      }
      can('read', 'Board', { workspaceId: ws, memberIds: me });
      can('update', 'Board', { workspaceId: ws, ownerId: me });
      can(['create', 'read', 'update'], 'Task', { workspaceId: ws, boardMemberIds: me });
      can('read', 'Performance', { workspaceId: ws, userId: me });
      can('read', 'Conversation', { workspaceId: ws });
      can('access', 'Meeting', { workspaceId: ws });
      if (policy.canSendAlertCalls) can('send', 'AlertCall', { workspaceId: ws });
      break;

    case 'guest':
      can(['read', 'update'], 'Task', { workspaceId: ws, participantIds: me });
      can('read', 'Conversation', { workspaceId: ws, memberIds: me });
      can('access', 'Meeting', { workspaceId: ws, inviteeIds: me });
      break;
  }

  return build({ detectSubjectType: (s) => (s as Subject).kind });
}

/** فحص مختصر على كائن مورد محدد. */
export function allows(ability: AppAbility, action: Action, resource: Subject): boolean {
  return ability.can(action, asSubject(resource.kind, resource));
}
