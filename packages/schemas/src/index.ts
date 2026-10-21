import { z } from 'zod';

// §6.3: مخططات Zod مشتركة بين الويب والجوال والخادم — مصدر واحد لشكل البيانات.

/** §9.1: الأدوار الأربعة الأساسية على مستوى المساحة. */
export const roles = ['owner', 'admin', 'member', 'guest'] as const;
export const roleSchema = z.enum(roles);
export type Role = z.infer<typeof roleSchema>;

/** FR-ORG-01: الشركة ← المساحات ← القطاعات ← الإدارات ← الأقسام ← الفرق ← الموظف. */
export const orgUnitTypes = ['sector', 'department', 'section', 'team'] as const;
export const orgUnitTypeSchema = z.enum(orgUnitTypes);
export type OrgUnitType = z.infer<typeof orgUnitTypeSchema>;

/** ترتيب المستويات: الوحدة لا تقع تحت وحدة من مستوى أدنى منها. */
export const orgUnitLevel: Record<OrgUnitType, number> = {
  sector: 1,
  department: 2,
  section: 3,
  team: 4,
};

export const uuidSchema = z.string().uuid();

/** §7.1: المعرّفات تُعرض للخارج ببادئة نوع. */
export const idPrefixes = {
  tenant: 'tnt',
  user: 'usr',
  workspace: 'wsp',
  orgUnit: 'org',
  membership: 'mbr',
  project: 'prj',
  task: 'tsk',
} as const;
export type IdKind = keyof typeof idPrefixes;

export function toPublicId(kind: IdKind, uuid: string): string {
  return `${idPrefixes[kind]}_${uuid.replace(/-/g, '')}`;
}

export function fromPublicId(kind: IdKind, publicId: string): string | null {
  const prefix = `${idPrefixes[kind]}_`;
  if (!publicId.startsWith(prefix)) return null;
  const hex = publicId.slice(prefix.length);
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const localizedName = {
  nameAr: z.string().trim().min(1).max(200),
  nameEn: z.string().trim().min(1).max(200).optional(),
};

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(200),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

export const createOrgUnitSchema = z.object({
  ...localizedName,
  type: orgUnitTypeSchema,
  parentId: uuidSchema.nullable().optional(),
  headUserId: uuidSchema.nullable().optional(),
});
export type CreateOrgUnitInput = z.infer<typeof createOrgUnitSchema>;

/** FR-ORG-03 / FR-ADM-02: الدعوة بالدور والقسم في خطوة واحدة؛ الضيف بتاريخ انتهاء إلزامي. */
export const inviteMemberSchema = z
  .object({
    email: z.string().trim().toLowerCase().email(),
    ...localizedName,
    role: roleSchema.exclude(['owner']),
    orgUnitId: uuidSchema.nullable().optional(),
    managerId: uuidSchema.nullable().optional(),
    guestExpiresAt: z.coerce.date().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.role === 'guest' && !v.guestExpiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guestExpiresAt'],
        message: 'guest_requires_expiry',
      });
    }
    if (v.role !== 'guest' && v.guestExpiresAt) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['guestExpiresAt'],
        message: 'expiry_only_for_guests',
      });
    }
  });
export type InviteMemberInput = z.infer<typeof inviteMemberSchema>;

/** §8.1: صيغة الأخطاء RFC 9457 برمز ثابت ورسالة عربية وإنجليزية. */
export const problemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int(),
  code: z.string(),
  detail: z.string().optional(),
  messages: z.object({ ar: z.string(), en: z.string() }),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type Problem = z.infer<typeof problemSchema>;
