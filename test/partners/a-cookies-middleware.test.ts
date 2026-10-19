// Referral spec §5 tests 1–4: middleware first-party cookies (kx_ref / kx_ft), first touch wins, bad codes ignored,
// frozen / API / asset paths untouched.
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from '../../middleware.js';
import {
  buildFtCookieValue,
  firstTouchFromUrl,
  normalizeRefCode,
  parseFtCookie,
  parseRefCookie,
  shouldCaptureRequest,
} from '@/lib/partners/cookies';

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)';

function req(url: string, cookies: Record<string, string> = {}, ua = UA) {
  const headers = new Headers({ 'user-agent': ua });
  const c = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
  if (c) headers.set('cookie', c);
  return new NextRequest(new URL(url, 'https://kolayxport.com'), { headers });
}

function setCookies(res: Response): string[] {
  const h = res.headers as Headers & { getSetCookie?: () => string[] };
  return h.getSetCookie ? h.getSetCookie() : (res.headers.get('set-cookie') || '').split(/,(?=\s*kx_)/);
}

describe('ref code format', () => {
  it('upper-cases valid codes and rejects bad ones', () => {
    expect(normalizeRefCode('etsyilegelir')).toBe('ETSYILEGELIR');
    expect(normalizeRefCode('ab')).toBeNull();
    expect(normalizeRefCode('<script>')).toBeNull();
    expect(normalizeRefCode('x'.repeat(40))).toBeNull();
    expect(normalizeRefCode('TEST-PARTNER')).toBe('TEST-PARTNER');
  });
});

describe('middleware (tests 1–4)', () => {
  it('1: sets kx_ref with HttpOnly, Secure, Lax, 90 days', async () => {
    const res = await middleware(req('/?ref=etsyilegelir'));
    const c = setCookies(res).find((s) => s.startsWith('kx_ref='))!;
    expect(c).toMatch(/^kx_ref=ETSYILEGELIR(%7C|\|)\d+/);
    expect(c).toMatch(/HttpOnly/i);
    expect(c).toMatch(/Secure/i);
    expect(c).toMatch(/SameSite=lax/i);
    expect(c).toMatch(/Max-Age=7776000/i);
    const value = decodeURIComponent(c.split(';')[0].slice('kx_ref='.length));
    expect(parseRefCookie(value)?.code).toBe('ETSYILEGELIR');
  });

  it('2: an existing kx_ref is never overwritten', async () => {
    const res = await middleware(req('/?ref=etsyilegelir', { kx_ref: 'OTHER|1700000000' }));
    expect(setCookies(res).some((s) => s.startsWith('kx_ref='))).toBe(false);
  });

  it('3: invalid codes set nothing', async () => {
    for (const bad of ['%3Cscript%3E', 'x'.repeat(40)]) {
      const res = await middleware(req(`/?ref=${bad}`));
      expect(setCookies(res).some((s) => s.startsWith('kx_ref='))).toBe(false);
    }
  });

  it('4: API, auth, MCP, OAuth consent, .well-known, _next and assets are skipped', () => {
    for (const p of ['/api/auth/signin', '/api/mcp', '/api/shopify/install', '/oauth/authorize', '/.well-known/openai-apps-challenge', '/_next/data/x.json', '/logo.png', '/auth/verify']) {
      expect(shouldCaptureRequest('GET', p, UA)).toBe(false);
    }
    expect(shouldCaptureRequest('POST', '/', UA)).toBe(false);
    expect(shouldCaptureRequest('GET', '/', 'Googlebot/2.1')).toBe(false);
    expect(shouldCaptureRequest('GET', '/', UA)).toBe(true);
    expect(shouldCaptureRequest('GET', '/fiyatlandirma', UA)).toBe(true);
  });

  it('sets kx_ft from the first utm touch only', async () => {
    const res = await middleware(req('/cozumler/etsy-satici?utm_source=facebook&utm_campaign=grup1'));
    const c = setCookies(res).find((s) => s.startsWith('kx_ft='))!;
    const ft = parseFtCookie(c.split(';')[0].slice('kx_ft='.length));
    expect(ft).toMatchObject({ utm_source: 'facebook', utm_campaign: 'grup1', landing: '/cozumler/etsy-satici' });
    const again = await middleware(req('/?utm_source=google', { kx_ft: c.split(';')[0].slice('kx_ft='.length) }));
    expect(setCookies(again).some((s) => s.startsWith('kx_ft='))).toBe(false);
  });

  it('never touches kx_client and does nothing without a query', async () => {
    const res = await middleware(req('/app', { kx_client: 'play' }));
    expect(setCookies(res).filter(Boolean)).toEqual([]);
  });
});

describe('kx_ft encoding', () => {
  it('round-trips, trims values to 100 chars and stays under 600 bytes', () => {
    const url = new URL(`https://kolayxport.com/?utm_source=${'a'.repeat(300)}&utm_medium=x&utm_campaign=y&utm_content=z&utm_term=w`);
    const ft = firstTouchFromUrl(url, 1_760_000_000)!;
    expect(ft.utm_source).toHaveLength(100);
    const v = buildFtCookieValue(ft)!;
    expect(v.length).toBeLessThanOrEqual(600);
    expect(parseFtCookie(v)).toEqual(ft);
    expect(parseFtCookie('not-base64!!')).toBeNull();
  });
});
