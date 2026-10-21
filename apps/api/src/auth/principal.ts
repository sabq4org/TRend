import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

/** هوية الطالب بعد التحقق من رمز الوصول. الدور لا يُؤخذ من الرمز بل من العضوية في كل مساحة. */
export interface Principal {
  userId: string;
  tenantId: string;
  ip: string | null;
  source: 'api' | 'mcp';
  /** مالك أو مشرف في مساحة ما (§9.2: المصادقة الثنائية إلزامية له). */
  privileged: boolean;
  mfa: boolean;
}

export const CurrentPrincipal = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Principal =>
    ctx.switchToHttp().getRequest<{ principal: Principal }>().principal,
);
