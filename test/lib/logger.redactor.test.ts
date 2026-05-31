import { describe, it, expect } from 'vitest';
import { redact } from '@/lib/logger';

describe('logger redact()', () => {
  it('redacts top-level access tokens', () => {
    const out = redact({ accessToken: 'AAAA', userId: 'u1' });
    expect(out.accessToken).toBe('[REDACTED]');
    expect(out.userId).toBe('u1');
  });

  it('redacts snake_case access_token', () => {
    const out = redact({ access_token: 'AAAA' });
    expect(out.access_token).toBe('[REDACTED]');
  });

  it('redacts refresh tokens, api keys, secrets, passwords', () => {
    const out = redact({
      refreshToken: 'r',
      refresh_token: 'r',
      apiKey: 'k',
      api_key: 'k',
      apiSecret: 's',
      clientSecret: 'c',
      privateKey: 'p',
      password: 'pw',
      authorization: 'Bearer x',
      cookie: 'sid=x',
      'set-cookie': 'sid=x',
      'stripe-signature': 'sig',
    });
    for (const v of Object.values(out)) {
      expect(v).toBe('[REDACTED]');
    }
  });

  it('redacts nested objects recursively', () => {
    const out = redact({
      user: { id: 'u1', credentials: { etsyAccessToken: 'ET', refreshToken: 'RT' } },
      ok: true,
    });
    expect(out.user.id).toBe('u1');
    expect(out.user.credentials.etsyAccessToken).toBe('[REDACTED]');
    expect(out.user.credentials.refreshToken).toBe('[REDACTED]');
    expect(out.ok).toBe(true);
  });

  it('redacts values inside arrays', () => {
    const out = redact([{ token: 'a' }, { token: 'b' }, { safe: 'ok' }]);
    expect(out[0].token).toBe('[REDACTED]');
    expect(out[1].token).toBe('[REDACTED]');
    expect(out[2].safe).toBe('ok');
  });

  it('does not redact innocuous fields', () => {
    const out = redact({ orderId: 'o', marketplace: 'etsy', tracking_number: 'TN' });
    expect(out.orderId).toBe('o');
    expect(out.marketplace).toBe('etsy');
    expect(out.tracking_number).toBe('TN');
  });

  it('handles circular references', () => {
    const a: any = { name: 'a' };
    a.self = a;
    const out = redact(a);
    expect(out.name).toBe('a');
    expect(out.self).toBe('[CIRCULAR]');
  });

  it('caps recursion depth', () => {
    let node: any = { v: 'leaf' };
    for (let i = 0; i < 20; i++) node = { child: node };
    const out = redact(node);
    let cursor: any = out;
    let depth = 0;
    while (cursor && cursor.child && typeof cursor.child === 'object') {
      cursor = cursor.child;
      depth++;
      if (depth > 50) break;
    }
    expect(depth).toBeLessThanOrEqual(10);
  });

  it('truncates very long strings', () => {
    const big = 'x'.repeat(10000);
    const out = redact({ note: big });
    expect(out.note.length).toBeLessThanOrEqual(4096 + 20);
    expect(out.note.endsWith('...[TRUNCATED]')).toBe(true);
  });

  it('serializes Error objects without leaking secret-ish fields on them', () => {
    const e = new Error('boom');
    (e as any).accessToken = 'should not leak via Error coercion';
    const out = redact({ err: e });
    expect(out.err.name).toBe('Error');
    expect(out.err.message).toBe('boom');
    expect(JSON.stringify(out.err).includes('should not leak')).toBe(false);
  });

  it('preserves Date objects', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const out = redact({ at: d });
    expect(out.at instanceof Date).toBe(true);
    expect(out.at.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
