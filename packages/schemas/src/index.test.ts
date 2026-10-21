import { describe, expect, it } from 'vitest';
import { fromPublicId, inviteMemberSchema, toPublicId } from './index';

describe('public ids (§7.1)', () => {
  it('round-trips with a type prefix', () => {
    const uuid = '0192f0c4-7b8a-7c3e-9d1f-2a3b4c5d6e7f';
    const pub = toPublicId('task', uuid);
    expect(pub).toBe('tsk_0192f0c47b8a7c3e9d1f2a3b4c5d6e7f');
    expect(fromPublicId('task', pub)).toBe(uuid);
  });

  it('rejects the wrong prefix', () => {
    expect(fromPublicId('project', 'tsk_0192f0c47b8a7c3e9d1f2a3b4c5d6e7f')).toBeNull();
  });
});

describe('inviteMemberSchema (FR-ORG-03, FR-ADM-02)', () => {
  const base = { email: 'Hind@Trend.sa', nameAr: 'هند' };

  it('normalises email', () => {
    const r = inviteMemberSchema.parse({ ...base, role: 'member' });
    expect(r.email).toBe('hind@trend.sa');
  });

  it('requires an expiry for guests', () => {
    expect(inviteMemberSchema.safeParse({ ...base, role: 'guest' }).success).toBe(false);
    expect(
      inviteMemberSchema.safeParse({ ...base, role: 'guest', guestExpiresAt: '2026-12-31' })
        .success,
    ).toBe(true);
  });

  it('cannot invite an owner', () => {
    expect(inviteMemberSchema.safeParse({ ...base, role: 'owner' }).success).toBe(false);
  });
});
