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
  it('only draft / photo tools write, all need the write scope', () => {
    const writers = MCP_TOOLS.filter((t) => !t.readOnly);
    expect(writers.map((t) => t.name).sort()).toEqual(['add_listing_photos', 'create_listing_draft', 'generate_product_image', 'stage_listing_changes']);
    expect(writers.every((t) => t.scope === 'write')).toBe(true);
    expect(new Set(MCP_TOOLS.map((t) => t.name)).size).toBe(MCP_TOOLS.length);
  });
  it('the Etsy rules the AI reads are the seller\'s own', async () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'seo_rules')!;
    const r: any = await tool.run({ userId: 'u', connectionId: 'c', scopes: ['read'], name: 't' }, { marketplace: 'etsy' });
    expect(r.title).toMatchObject({ min: 100, max: 140 });
    expect(r.tags).toMatchObject({ count: 13, maxLength: 20 });
    expect(JSON.stringify(r)).toMatch(/Commas are the only separators/);
  });
  it('check_listing_text flags Etsy title and tag problems before staging', async () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'check_listing_text')!;
    const r: any = await tool.run({ userId: 'u', connectionId: 'c', scopes: ['read'], name: 't' }, { marketplace: 'etsy', title: 'baby dress - pink | girl', tags: ['this tag is far too long for etsy', 'pink'] });
    expect(r.title.ok).toBe(false);
    expect(r.title.issues).toContain('disallowed_separator');
    expect(r.tags.tooLong.length).toBe(1);
  });
  it('photo links must be public https', async () => {
    const tool = MCP_TOOLS.find((t) => t.name === 'generate_product_image')!;
    await expect(tool.run({ userId: 'u', connectionId: 'c', scopes: ['write'], name: 't' }, { prompt: 'x', referencePhotoUrls: ['http://127.0.0.1/a.jpg'] })).rejects.toThrow(/public https/);
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
