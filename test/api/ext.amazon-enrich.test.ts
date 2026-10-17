import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { NextApiRequest } from 'next';

const USER_ID = 'c' + 'b'.repeat(24);

vi.mock('@/lib/auth', () => ({
  getAuthUser: vi.fn(async (req: any) => (req.headers?.['x-test-auth'] === 'yes' ? { id: USER_ID } : null)),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const credential = { current: null as any };
vi.mock('@/lib/prisma', () => ({
  default: {
    credential: {
      findUnique: vi.fn(async () => credential.current),
      update: vi.fn(async () => ({})),
    },
  },
}));

vi.mock('@/lib/integrations/amazonClient', () => ({
  AMAZON_MARKETPLACES: {
    US: { id: 'ATVPDKIKX0DER', domain: 'amazon.com', region: 'na', name: 'United States' },
    DE: { id: 'A1PA6795UKMFR9', domain: 'amazon.de', region: 'eu', name: 'Germany' },
  },
  getValidToken: vi.fn(async () => 'access-token'),
}));

const signals = { current: { items: {}, errors: {} } as any };
vi.mock('@/lib/amazon/spapiSignals', () => ({
  fetchProductSignals: vi.fn(async () => signals.current),
}));

import handler from '@/pages/api/ext/amazon-enrich';
import { fetchProductSignals } from '@/lib/amazon/spapiSignals';

function req(body: any, auth = true): NextApiRequest {
  return { method: 'POST', headers: auth ? { 'x-test-auth': 'yes' } : {}, body, query: {} } as unknown as NextApiRequest;
}
function res() {
  const state = { status: 0, body: null as any };
  const r: any = {
    setHeader: vi.fn(),
    status: vi.fn((c: number) => { state.status = c; return r; }),
    json: vi.fn((b: any) => { state.body = b; return r; }),
    end: vi.fn(() => r),
    state,
  };
  return r;
}

describe('POST /api/ext/amazon-enrich', () => {
  beforeEach(() => {
    vi.mocked(fetchProductSignals).mockClear();
    credential.current = {
      amazonRefreshToken: 'enc:refresh',
      amazonAccessToken: 'enc:access',
      amazonMarketplaceId: 'ATVPDKIKX0DER',
      amazonMarketplaceIds: ['ATVPDKIKX0DER'],
      amazonRegion: 'na',
    };
    signals.current = { items: {}, errors: {} };
  });

  it('requires auth', async () => {
    const r = res();
    await handler(req({ asins: ['B0ORGANIC1'] }, false), r);
    expect(r.state.status).toBe(401);
  });

  it('rejects requests without valid ASINs', async () => {
    const r = res();
    await handler(req({ asins: ['nope'] }), r);
    expect(r.state.status).toBe(400);
  });

  it('reports not_connected without a seller credential', async () => {
    credential.current = null;
    const r = res();
    await handler(req({ asins: ['B0ORGANIC1'], marketplace: 'US' }), r);
    expect(r.state.body).toEqual({ available: false, reason: 'not_connected' });
  });

  it('reports marketplace_not_connected for a marketplace the seller is not in', async () => {
    const r = res();
    await handler(req({ asins: ['B0ORGANIC1'], marketplace: 'DE' }), r);
    expect(r.state.body).toEqual({ available: false, reason: 'marketplace_not_connected' });
    expect(fetchProductSignals).not.toHaveBeenCalled();
  });

  it('reports access_denied when Amazon refuses both APIs (missing app role)', async () => {
    signals.current = { items: {}, errors: { catalog: 'access_denied', pricing: 'access_denied' } };
    const r = res();
    await handler(req({ asins: ['B0ORGANIC1'], marketplace: 'US' }), r);
    expect(r.state.body).toMatchObject({ available: false, reason: 'access_denied' });
  });

  it('returns SP-API items for the page marketplace', async () => {
    signals.current = { items: { B0ORGANIC1: { asin: 'B0ORGANIC1', bsr: 1234, offerCountAny: 5 } }, errors: {} };
    const r = res();
    await handler(req({ asins: ['b0organic1', 'B0ORGANIC1'], marketplace: 'US' }), r);
    expect(r.state.status).toBe(200);
    expect(r.state.body).toMatchObject({ available: true, source: 'sp-api', marketplaceId: 'ATVPDKIKX0DER', items: { B0ORGANIC1: { bsr: 1234 } } });
    expect(vi.mocked(fetchProductSignals).mock.calls[0][0]).toMatchObject({ asins: ['B0ORGANIC1'], region: 'na', marketplaceId: 'ATVPDKIKX0DER', sellerKey: USER_ID });
  });
});
