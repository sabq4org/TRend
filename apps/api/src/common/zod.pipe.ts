import type { PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

// §9.2: تحقق Zod لكل مدخل، بالمخطط نفسه المستخدم في الواجهة.
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    return this.schema.parse(value);
  }
}
