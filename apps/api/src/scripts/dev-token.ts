import { signAccessToken } from '../auth/tokens';
import { loadConfig } from '../config';

// للتطوير المحلي فقط إلى أن تكتمل وحدة الهوية: يصدر رمز وصول لمستخدم موجود.
// الاستخدام: pnpm --filter @trend/api dev:token <userId> <tenantId>
async function main() {
  const config = loadConfig();
  if (config.NODE_ENV === 'production') throw new Error('dev-token is disabled in production');
  const [sub, tid] = process.argv.slice(2);
  if (!sub || !tid) throw new Error('usage: dev-token <userId> <tenantId>');
  console.log(await signAccessToken({ sub, tid }, config));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
