import { describe, expect, it } from 'vitest';
import type { Role } from '@trend/schemas';
import { allows, defineAbilityFor, isGuestExpired, type Actor, type Subject } from './index';

// NFR-15: تغطية 100% لمنطق الصلاحيات. كل سطر في مصفوفة §9.1 له اختبار هنا.

const WS = 'ws-1';
const OTHER_WS = 'ws-2';
const ME = 'u-me';
const REPORT = 'u-report';
const PEER = 'u-peer';
const future = new Date('2099-01-01');

function actor(role: Role, extra: Partial<Actor> = {}): Actor {
  return {
    userId: ME,
    workspaceId: WS,
    role,
    subordinateIds: [REPORT],
    guestExpiresAt: role === 'guest' ? future : null,
    ...extra,
  };
}

const can = (a: Actor, action: Parameters<typeof allows>[1], s: Subject) =>
  allows(defineAbilityFor(a), action, s);

const board = (ownerId: string, memberIds: string[]): Subject => ({
  kind: 'Board',
  workspaceId: WS,
  ownerId,
  memberIds,
});
const task = (boardMemberIds: string[], participantIds: string[] = []): Subject => ({
  kind: 'Task',
  workspaceId: WS,
  boardMemberIds,
  participantIds,
});

type Row = [string, Action, Subject, Record<Role, boolean>];
type Action = Parameters<typeof allows>[1];

const matrix: Row[] = [
  [
    'تعديل هوية المساحة',
    'update',
    { kind: 'Workspace', id: WS },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [
    'الفوترة',
    'update',
    { kind: 'Billing', workspaceId: WS },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [
    'إدارة الأعضاء',
    'create',
    { kind: 'Member', workspaceId: WS },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    'إدارة الأقسام',
    'update',
    { kind: 'OrgUnit', workspaceId: WS },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    'إنشاء مشروع (الافتراضي للعضو: لا)',
    'create',
    { kind: 'Project', workspaceId: WS },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    'إعدادات لوحة يملكها المستخدم',
    'update',
    board(ME, [ME]),
    { owner: true, admin: true, member: true, guest: false },
  ],
  [
    'إعدادات لوحة لا يملكها',
    'update',
    board(PEER, [ME, PEER]),
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    'مهمة في لوحة هو عضو فيها',
    'update',
    task([ME, PEER]),
    { owner: true, admin: true, member: true, guest: false },
  ],
  [
    'مهمة في لوحة ليس عضواً فيها',
    'update',
    task([PEER]),
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    'مهمة أُضيف إليها صراحة',
    'read',
    task([PEER], [ME]),
    { owner: true, admin: true, member: false, guest: true },
  ],
  [
    'إنجاز نفسه',
    'read',
    { kind: 'Performance', workspaceId: WS, userId: ME },
    { owner: true, admin: true, member: true, guest: false },
  ],
  [
    'إنجاز من تحته',
    'read',
    { kind: 'Performance', workspaceId: WS, userId: REPORT },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    'إنجاز زميل بجواره',
    'read',
    { kind: 'Performance', workspaceId: WS, userId: PEER },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [
    'تعديل سياسة الإنجاز',
    'update',
    { kind: 'PerformancePolicy', workspaceId: WS },
    { owner: true, admin: false, member: false, guest: false },
  ],
  [
    'محادثة هو عضو فيها',
    'read',
    { kind: 'Conversation', workspaceId: WS, memberIds: [ME] },
    { owner: true, admin: true, member: true, guest: true },
  ],
  [
    'محادثة ليس عضواً فيها',
    'read',
    { kind: 'Conversation', workspaceId: WS, memberIds: [PEER] },
    { owner: true, admin: true, member: true, guest: false },
  ],
  [
    'اجتماع مدعو إليه',
    'access',
    { kind: 'Meeting', workspaceId: WS, inviteeIds: [ME] },
    { owner: true, admin: true, member: true, guest: true },
  ],
  [
    'اجتماع غير مدعو إليه',
    'access',
    { kind: 'Meeting', workspaceId: WS, inviteeIds: [PEER] },
    { owner: true, admin: true, member: true, guest: false },
  ],
  [
    'الاتصال التنبيهي',
    'send',
    { kind: 'AlertCall', workspaceId: WS },
    { owner: true, admin: true, member: true, guest: false },
  ],
  [
    'سجل تدقيق ضمن النطاق',
    'read',
    { kind: 'AuditLog', workspaceId: WS, actorId: REPORT },
    { owner: true, admin: true, member: false, guest: false },
  ],
  [
    'سجل تدقيق خارج النطاق',
    'read',
    { kind: 'AuditLog', workspaceId: WS, actorId: PEER },
    { owner: true, admin: false, member: false, guest: false },
  ],
];

describe('role matrix (§9.1)', () => {
  for (const [label, action, subject, expected] of matrix) {
    for (const role of ['owner', 'admin', 'member', 'guest'] as Role[]) {
      it(`${label} — ${role}: ${expected[role] ? 'يُسمح' : 'يُمنع'}`, () => {
        expect(can(actor(role), action, subject)).toBe(expected[role]);
      });
    }
  }
});

describe('workspace isolation', () => {
  it('never grants anything in another workspace, for any role', () => {
    for (const role of ['owner', 'admin', 'member', 'guest'] as Role[]) {
      const a = actor(role);
      expect(can(a, 'update', { kind: 'Workspace', id: OTHER_WS })).toBe(false);
      expect(can(a, 'read', { ...task([ME], [ME]), workspaceId: OTHER_WS } as Subject)).toBe(false);
      expect(can(a, 'read', { kind: 'AuditLog', workspaceId: OTHER_WS, actorId: ME })).toBe(false);
    }
  });
});

describe('configurable member permissions', () => {
  it('lets members create projects and boards when enabled', () => {
    const a = actor('member', {
      memberPolicy: { canCreateProjects: true, canSendAlertCalls: true },
    });
    expect(can(a, 'create', { kind: 'Project', workspaceId: WS })).toBe(true);
    expect(can(a, 'create', board(ME, []))).toBe(true);
  });

  it('blocks member alert calls when disabled', () => {
    const a = actor('member', {
      memberPolicy: { canCreateProjects: false, canSendAlertCalls: false },
    });
    expect(can(a, 'send', { kind: 'AlertCall', workspaceId: WS })).toBe(false);
  });
});

describe('guest expiry (§9.1, FR-ADM-02)', () => {
  const t = task([PEER], [ME]);

  it('loses all access after expiry', () => {
    const a = actor('guest', {
      guestExpiresAt: new Date('2026-01-01'),
      now: new Date('2026-02-01'),
    });
    expect(isGuestExpired(a)).toBe(true);
    expect(can(a, 'read', t)).toBe(false);
  });

  it('treats a guest without an expiry date as expired (fail closed)', () => {
    const a = actor('guest', { guestExpiresAt: null });
    expect(can(a, 'read', t)).toBe(false);
  });

  it('non-guests never expire', () => {
    expect(isGuestExpired({ role: 'member', guestExpiresAt: null })).toBe(false);
  });
});
