import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import { verifyShopifyHmac } from '@/lib/integrations/shopify/verifyWebhook';

const SECRET = 'shopify-test-secret-aaaaaaaaaaaa';

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = SECRET;
});
afterAll(() => {
  delete process.env.SHOPIFY_API_SECRET;
});

function sign(body: string): string {
  return crypto.createHmac('sha256', SECRET).update(body).digest('base64');
}

describe('verifyShopifyHmac', () => {
  it('accepts a valid HMAC for the exact body', () => {
    const body = '{"hello":"world"}';
    expect(verifyShopifyHmac(body, sign(body))).toBe(true);
  });

  it('rejects a body whose HMAC does not match', () => {
    const body = '{"hello":"world"}';
    const tampered = '{"hello":"WORLD"}';
    expect(verifyShopifyHmac(tampered, sign(body))).toBe(false);
  });

  it('rejects a different-length HMAC without throwing', () => {
    expect(verifyShopifyHmac('payload', 'short')).toBe(false);
    expect(verifyShopifyHmac('payload', 'a'.repeat(200))).toBe(false);
  });

  it('rejects when secret is unset', () => {
    const saved = process.env.SHOPIFY_API_SECRET;
    delete process.env.SHOPIFY_API_SECRET;
    expect(verifyShopifyHmac('p', sign('p'))).toBe(false);
    process.env.SHOPIFY_API_SECRET = saved;
  });

  it('rejects when header missing', () => {
    expect(verifyShopifyHmac('p', undefined)).toBe(false);
    expect(verifyShopifyHmac('p', '')).toBe(false);
  });
});
