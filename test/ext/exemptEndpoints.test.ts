// Etsy order / address import and tracking entry are never research-limited:
// /api/integrations/etsy/*, /api/auth/extension and content.js keep working after the
// user has used up today's research lookups (and even with the global brakes on).
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import type { NextApiRequest } from 'next';

const USER = 'user_exempt';

vi.mock('@/lib/prisma', async () => {
  const { fakePrisma } = await import('./fakeResearchStore');
  return {
    default: {
      ...fakePrisma,
      etsyShop: { findMany: vi.fn(async () => [{ shopName: 'MyShop' }]) },
      order: { findMany: vi.fn(async () => []) },
      etsyAddress: { findMany: vi.fn(async () => []) },
      trackingSubmission: { findMany: vi.fn(async () => []) },
    },
  };
});
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/admin/events', () => ({ logSecurityEvent: vi.fn(), logExtensionEvent: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(async () => ({ id: USER, email: 'u@example.com', name: 'U' })),
  createExtensionToken: vi.fn(async () => 'ext-token'),
  EXTENSION_TOKEN_MAX_AGE_SECONDS: 86400,
}));

import { store, makeRes } from './fakeResearchStore';
import { quotaKey, budgetKey, istanbulDay, GLOBAL_USER_ID } from '@/lib/ext/researchQuota';
import addressPending from '@/pages/api/integrations/etsy/address-pending';
import trackingPending from '@/pages/api/integrations/etsy/tracking-pending';
import authExtension from '@/pages/api/auth/extension';

const ROOT = path.join(__dirname, '../..');

function get(url: string): NextApiRequest {
  return {
    method: 'GET',
    url,
    // Even a request that looks like an extension research call is not limited here.
    headers: { authorization: 'Bearer ext-token', 'x-kx-client': 'ext/9.7.1', 'x-kx-page-view': 'pvexempt00001' },
    query: {},
    body: {},
  } as unknown as NextApiRequest;
}

beforeEach(() => {
  store.reset();
  store.setUser(USER, 'trial', 'trialing', new Date(Date.now() + 86400e3));
  const day = istanbulDay().day;
  store.setCount(USER, quotaKey(day), 50); // trial limit used up
  for (const m of ['etsy', 'ebay', 'amazon'] as const) store.setCount(GLOBAL_USER_ID, budgetKey(m, day), 10_000_000);
});

describe('exempt endpoints after the research quota is exhausted', () => {
  it('GET /api/integrations/etsy/address-pending answers normally', async () => {
    const before = store.snapshot();
    const r = makeRes();
    await addressPending(get('/api/integrations/etsy/address-pending'), r);
    expect(r.state.status).toBe(200);
    expect(r.state.body).toMatchObject({ pending: [] });
    expect(store.snapshot()).toBe(before);
    expect(store.queryRawCalls).toBe(0);
  });

  it('GET /api/integrations/etsy/tracking-pending answers normally', async () => {
    const before = store.snapshot();
    const r = makeRes();
    await trackingPending(get('/api/integrations/etsy/tracking-pending'), r);
    expect(r.state.status).toBe(200);
    expect(r.state.status).not.toBe(429);
    expect(store.snapshot()).toBe(before);
  });

  it('GET /api/auth/extension still issues the token', async () => {
    const r = makeRes();
    await authExtension(get('/api/auth/extension'), r);
    expect(r.state.status).toBe(200);
    expect(JSON.stringify(r.state.body)).toContain('ext-token');
    expect(store.queryRawCalls).toBe(0);
  });

  it('none of the exempt code paths use the research quota', () => {
    const dir = path.join(ROOT, 'pages/api/integrations/etsy');
    const files = readdirSync(dir).map((f) => path.join(dir, f));
    files.push(path.join(ROOT, 'pages/api/auth/extension.ts'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/researchQuota|withResearchQuota|research_limit/);
    }
    // content.js (order/address import + tracking entry) sends no research messages and no card.
    const content = readFileSync(path.join(ROOT, 'chrome-extension/src/content.js'), 'utf8');
    expect(content).not.toMatch(/kx_research|kx_listing_stats|kx_ebay_research|kx_amazon_enrich|__KX_LIMIT|research_limit/);
    // …and the manifest does not load the limit card into the order-page content script.
    const manifest = JSON.parse(readFileSync(path.join(ROOT, 'chrome-extension/manifest.json'), 'utf8'));
    const orderScripts = manifest.content_scripts.find((cs: any) => cs.js.includes('src/content.js'));
    expect(orderScripts.js).toEqual(['src/content.js']);
  });
});
