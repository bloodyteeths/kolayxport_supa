import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { consentCookieValue, parseConsentCookie } from '@/lib/tracking/consent';
import { contextFromMetadata, contextToMetadata, contextFromRequest, sendServerEvent } from '@/lib/tracking/server';

const ENV = { ...process.env };
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  process.env.META_PIXEL_ID = '123';
  process.env.META_CAPI_TOKEN = 'tok';
  process.env.GA4_MEASUREMENT_ID = 'G-TEST';
  process.env.GA4_API_SECRET = 'sec';
});
afterEach(() => { vi.unstubAllGlobals(); process.env = { ...ENV }; });

describe('consent cookie', () => {
  it('round-trips and defaults to denied', () => {
    expect(parseConsentCookie(consentCookieValue({ analytics: true, marketing: false }))).toEqual({ analytics: true, marketing: false });
    expect(parseConsentCookie(undefined)).toEqual({ analytics: false, marketing: false });
    expect(parseConsentCookie('garbage')).toEqual({ analytics: false, marketing: false });
  });
});

describe('server events', () => {
  const req: any = { headers: { 'user-agent': 'UA', 'x-forwarded-for': '1.2.3.4, 10.0.0.1', referer: 'https://kolayxport.com/login' }, cookies: { kx_consent: 'a1m1', _fbp: 'fb.1.1.1', _ga: 'GA1.1.111.222' }, socket: {} };

  it('reads consent, ip and click ids from the request and survives Stripe metadata', () => {
    const ctx = contextFromRequest(req);
    expect(ctx).toMatchObject({ consent: { analytics: true, marketing: true }, ip: '1.2.3.4', fbp: 'fb.1.1.1', gaClientId: '111.222' });
    expect(contextFromMetadata(contextToMetadata(ctx))).toMatchObject({ consent: ctx.consent, fbp: ctx.fbp, gaClientId: ctx.gaClientId });
  });

  it('sends nothing without consent', async () => {
    await sendServerEvent({ name: 'sign_up', eventId: 'e1', email: 'a@b.co' }, { consent: { analytics: false, marketing: false }, gaClientId: '1.2' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('marketing consent → Meta only, with hashed email and the shared event_id', async () => {
    await sendServerEvent({ name: 'sign_up', eventId: 'e2', email: ' A@B.co ' }, { consent: { analytics: false, marketing: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('graph.facebook.com');
    const body = JSON.parse(init.body);
    expect(body.data[0]).toMatchObject({ event_name: 'CompleteRegistration', event_id: 'e2' });
    expect(body.data[0].user_data.em[0]).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(body)).not.toContain('A@B.co');
  });

  it('analytics consent + GA client id → GA4 Measurement Protocol', async () => {
    await sendServerEvent({ name: 'purchase', eventId: 'cs_1', value: 99, currency: 'usd' }, { consent: { analytics: true, marketing: false }, gaClientId: '111.222' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('google-analytics.com/mp/collect');
    expect(JSON.parse(init.body)).toMatchObject({ client_id: '111.222', events: [{ name: 'purchase', params: { event_id: 'cs_1', value: 99, currency: 'USD' } }] });
  });

  it('never throws when a platform is down', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    await expect(sendServerEvent({ name: 'sign_up', eventId: 'e3' }, { consent: { analytics: true, marketing: true }, gaClientId: '1.2' })).resolves.toBeUndefined();
  });
});
