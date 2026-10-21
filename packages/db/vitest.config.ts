import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // كل ملف ينشئ قاعدة معزولة؛ التشغيل المتسلسل يبقي الأخطاء واضحة.
    fileParallelism: false,
  },
});
