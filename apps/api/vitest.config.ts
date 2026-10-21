import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// NestJS يعتمد على بيانات الزخرفة الوصفية، وesbuild لا يولّدها؛ لذلك SWC.
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
