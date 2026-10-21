import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import { messages } from '@trend/i18n';
import type { Problem } from '@trend/schemas';
import type { Response } from 'express';
import type { ZodError } from 'zod';

// §8.1: الأخطاء بصيغة RFC 9457 (Problem Details) برمز ثابت ورسالة عربية وإنجليزية.

type ErrorCode = keyof (typeof messages)['ar']['errors'];

const statusCodes: Record<number, ErrorCode> = {
  400: 'validation',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'notFound',
  409: 'conflict',
};

export class ProblemException extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    readonly errors?: Problem['errors'],
  ) {
    super(code, status);
  }
}

export const forbidden = () => new ProblemException(HttpStatus.FORBIDDEN, 'forbidden');
export const notFound = () => new ProblemException(HttpStatus.NOT_FOUND, 'notFound');
export const unauthorized = () => new ProblemException(HttpStatus.UNAUTHORIZED, 'unauthorized');
export const conflict = () => new ProblemException(HttpStatus.CONFLICT, 'conflict');

export function toProblem(status: number, code: ErrorCode, errors?: Problem['errors']): Problem {
  return {
    type: `https://trend.sa/problems/${code}`,
    title: messages.en.errors[code],
    status,
    code,
    messages: { ar: messages.ar.errors[code], en: messages.en.errors[code] },
    ...(errors?.length ? { errors } : {}),
  };
}

@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    let problem: Problem;

    if (isZodError(exception)) {
      problem = toProblem(
        400,
        'validation',
        exception.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      );
    } else if (exception instanceof ProblemException) {
      problem = toProblem(exception.getStatus(), exception.code, exception.errors);
    } else if (exception instanceof HttpException) {
      const status = exception.getStatus();
      problem = toProblem(status, statusCodes[status] ?? 'internal');
    } else if (isPgError(exception) && exception.code === '23505') {
      problem = toProblem(409, 'conflict');
    } else if (isPgError(exception) && ['23514', '23503'].includes(exception.code)) {
      problem = toProblem(400, 'validation', [{ path: '', message: exception.message }]);
    } else {
      this.logger.error(exception);
      problem = toProblem(500, 'internal');
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }
}

function isPgError(e: unknown): e is { code: string; message: string } {
  return typeof e === 'object' && e !== null && typeof (e as { code?: unknown }).code === 'string';
}

// فحص بالشكل لا بـ instanceof: قد تُحمَّل نسختا CJS وESM من zod في الوقت نفسه.
function isZodError(e: unknown): e is ZodError {
  return e instanceof Error && e.name === 'ZodError' && Array.isArray((e as ZodError).issues);
}
