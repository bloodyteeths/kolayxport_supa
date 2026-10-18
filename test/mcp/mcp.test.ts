import crypto from 'crypto';
import { describe, expect, it } from 'vitest';
import { normalizeScopes, pkceOk, redirectUriAllowed } from '@/lib/mcp/tokens';
import { MCP_TOOLS, countryOf, toolsFor } from '@/lib/mcp/tools';

describe('MCP credentials', () => {
  it('PKCE S256: only the verifier that made the challenge passes', () => {
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    expect(pkceOk(verifier, challenge)).toBe(true);
    expect(pkceOk(`${verifier}x`, challenge)).toBe(false);
    expect(pkceOk('short', challenge)).toBe(false);
    expect(pkceOk(undefined, challenge)).toBe(false);
  });
  it('redirect URIs: https, or http only on the loopback; never fragments or other schemes', () => {
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriAllowed('http://localhost:6274/callback')).toBe(true);
    expect(redirectUriAllowed('http://127.0.0.1:33418/cb')).toBe(true);
    expect(redirectUriAllowed('http://evil.com/cb')).toBe(false);
    expect(redirectUriAllowed('javascript:alert(1)')).toBe(false);
    expect(redirectUriAllowed('https://x.com/cb#frag')).toBe(false);
  });
  it('scopes: unknown dropped, read by default, order fixed', () => {
    expect(normalizeScopes('write read admin')).toEqual(['read', 'write']);
    expect(normalizeScopes(['admin'])).toEqual(['read']);
    expect(normalizeScopes(undefined)).toEqual(['read']);
  });
});

describe('MCP tools', () => {
  it('a read-only connection never sees the draft tool; nothing takes a user id', () => {
    expect(toolsFor(['read']).map((t) => t.name)).not.toContain('stage_listing_changes');
    expect(toolsFor(['read', 'write']).map((t) => t.name)).toContain('stage_listing_changes');
    for (const t of MCP_TOOLS) {
      const props = Object.keys(((t.inputSchema as any).properties ?? {}) as object);
      expect(props.some((p) => /user|tenant|account/i.test(p))).toBe(false);
    }
  });
  it('only the draft tool writes, and it is marked so', () => {
    expect(MCP_TOOLS.filter((t) => !t.readOnly).map((t) => t.name)).toEqual(['stage_listing_changes']);
  });
});

describe('order privacy', () => {
  it('only the country leaves, from JSON or JSON-text addresses; free text is never parsed', () => {
    const addr = JSON.stringify({ name: 'Jane Doe', street1: '1 Main St', city: 'Austin', country: 'US', phone: '555' });
    expect(countryOf(addr, 'amazon')).toBe('US');
    expect(countryOf({ countryCode: 'DE', name: 'x' }, 'etsy')).toBe('DE');
    expect(countryOf('Ayşe Yılmaz, Kadıköy İstanbul', 'Trendyol')).toBe('TR');
    expect(countryOf('Jane Doe, 1 Main St, Austin', 'ebay')).toBeNull();
  });
});
