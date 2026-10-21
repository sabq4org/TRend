import { sql } from 'drizzle-orm';
import {
  bigint,
  customType,
  inet,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// مرآة أنواع لـ migrations/*.sql. مصدر الحقيقة للبنية هو ملفات SQL (تحوي RLS والمشغّلات).

const ltree = customType<{ data: string }>({ dataType: () => 'ltree' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });
const tstz = (name: string) => timestamp(name, { withTimezone: true });

const base = {
  id: uuid('id')
    .primaryKey()
    .default(sql`app.uuid_v7()`),
  createdAt: tstz('created_at').notNull().defaultNow(),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
};
const tenantScoped = { ...base, tenantId: uuid('tenant_id').notNull() };

export const orgUnitType = pgEnum('org_unit_type', ['sector', 'department', 'section', 'team']);
export const workspaceRole = pgEnum('workspace_role', ['owner', 'admin', 'member', 'guest']);

export const tenants = pgTable('tenants', {
  ...base,
  name: text('name').notNull(),
  plan: text('plan').notNull(),
  settings: jsonb('settings').notNull(),
  dataRegion: text('data_region').notNull(),
});

export const users = pgTable('users', {
  ...tenantScoped,
  email: text('email').notNull(),
  phone: text('phone'),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  locale: text('locale').$type<'ar' | 'en'>().notNull(),
  timezone: text('timezone').notNull(),
  numeralSystem: text('numeral_system').$type<'arab' | 'latn'>().notNull(),
  status: text('status').$type<'invited' | 'active' | 'suspended' | 'deactivated'>().notNull(),
  /** هوية الدخول في auth."user" (Better Auth)، تُضبط عند قبول الدعوة. */
  authUserId: uuid('auth_user_id'),
  deletedAt: tstz('deleted_at'),
});

export const workspaces = pgTable('workspaces', {
  ...tenantScoped,
  name: text('name').notNull(),
  identity: jsonb('identity').notNull(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull(),
  deletedAt: tstz('deleted_at'),
});

export const orgUnits = pgTable('org_units', {
  ...tenantScoped,
  workspaceId: uuid('workspace_id').notNull(),
  parentId: uuid('parent_id'),
  type: orgUnitType('type').notNull(),
  nameAr: text('name_ar').notNull(),
  nameEn: text('name_en'),
  headUserId: uuid('head_user_id'),
  // يُحسب بالمشغّل؛ أي قيمة مُرسلة تُستبدل.
  path: ltree('path')
    .notNull()
    .default(sql`''`),
  deletedAt: tstz('deleted_at'),
});

export const memberships = pgTable('memberships', {
  ...tenantScoped,
  userId: uuid('user_id').notNull(),
  workspaceId: uuid('workspace_id').notNull(),
  role: workspaceRole('role').notNull(),
  orgUnitId: uuid('org_unit_id'),
  managerId: uuid('manager_id'),
  guestExpiresAt: tstz('guest_expires_at'),
  deletedAt: tstz('deleted_at'),
});

export const membershipOrgUnits = pgTable('membership_org_units', {
  ...tenantScoped,
  workspaceId: uuid('workspace_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  orgUnitId: uuid('org_unit_id').notNull(),
});

export const workCalendars = pgTable('work_calendars', {
  ...tenantScoped,
  workspaceId: uuid('workspace_id').notNull(),
  orgUnitId: uuid('org_unit_id'),
  weekdays: smallint('weekdays').array().notNull(),
  workStart: time('work_start').notNull(),
  workEnd: time('work_end').notNull(),
  ramadanStart: time('ramadan_start'),
  ramadanEnd: time('ramadan_end'),
  holidays: jsonb('holidays').notNull(),
  timezone: text('timezone').notNull(),
});

export const auditEvents = pgTable('audit_events', {
  id: uuid('id')
    .primaryKey()
    .default(sql`app.uuid_v7()`),
  tenantId: uuid('tenant_id').notNull(),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  workspaceId: uuid('workspace_id'),
  actorId: uuid('actor_id'),
  actorType: text('actor_type').notNull(),
  source: text('source').notNull(),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id'),
  before: jsonb('before'),
  after: jsonb('after'),
  ip: inet('ip'),
  occurredAt: tstz('occurred_at').notNull(),
  prevHash: bytea('prev_hash'),
  hash: bytea('hash').notNull(),
});

/** FR-ORG-03: رابط دعوة لمرة واحدة؛ يُخزن تجزئة الرمز فقط. */
export const invitations = pgTable('invitations', {
  ...tenantScoped,
  workspaceId: uuid('workspace_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  userId: uuid('user_id').notNull(),
  tokenHash: bytea('token_hash').notNull(),
  expiresAt: tstz('expires_at').notNull(),
  acceptedAt: tstz('accepted_at'),
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id')
    .primaryKey()
    .default(sql`app.uuid_v7()`),
  tenantId: uuid('tenant_id').notNull(),
  topic: text('topic').notNull(),
  payload: jsonb('payload').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
  dispatchedAt: tstz('dispatched_at'),
  attempts: smallint('attempts').notNull(),
});
