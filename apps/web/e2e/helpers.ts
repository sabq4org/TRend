import type { Page, Route } from '@playwright/test';

const API = 'http://localhost:4000';
const ORIGIN = 'http://localhost:3100';

type Reply = { status?: number; body?: unknown; headers?: Record<string, string> };

/** يحاكي نقاط الخادم مع ترويسات CORS والطلب التمهيدي، ويسجل ما وصله. */
export async function mockApi(
  page: Page,
  routes: Record<string, Reply | ((body: unknown) => Reply)>,
) {
  const calls: { path: string; body: unknown }[] = [];
  await page.route(`${API}/**`, async (route: Route) => {
    const req = route.request();
    const cors = {
      'access-control-allow-origin': ORIGIN,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'content-type, authorization',
      'access-control-allow-methods': 'GET, POST',
      'access-control-expose-headers': 'retry-after',
    };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const path = new URL(req.url()).pathname;
    const body = req.postDataJSON() as unknown;
    calls.push({ path, body });
    const handler = routes[path];
    const reply = typeof handler === 'function' ? handler(body) : (handler ?? { status: 404 });
    return route.fulfill({
      status: reply.status ?? 200,
      headers: { ...cors, ...reply.headers },
      contentType: 'application/json',
      body: JSON.stringify(reply.body ?? {}),
    });
  });
  return calls;
}

export const signedIn = (mfaRequired: boolean) => ({
  '/api/v1/auth/token': { body: { token: 'jwt' } },
  '/api/v1/me': { body: { id: 'u1', email: 'sara@trend.sa', mfaRequired } },
});
