// Settings Group A — pure nav model, tab parsing, guard URL rule, OAuth copy (settings §1, §3.3, §11).
import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_PROVIDERS, SETTINGS_NAV_GROUPS, buildSettingsNav, leavesSettingsTab, navLabel, oauthMessage,
  parseSettingsTab, resolveSettingsTab, settingsHref, tabSlices, type SettingsNavInputs,
} from '@/components/domain/settings/settingsNav';
import type { ConnectionsMap } from '@/lib/integrations/connectionStatus';

const t = (key: string, values?: Record<string, string | number>) => (values ? `${key}${JSON.stringify(values)}` : key);
const copy = { t, planLabel: (p: string) => `plan:${p}` };

function conn(connected: string[], reauth: string[] = []): ConnectionsMap {
  const all = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo', 'fedex', 'ups', 'mng', 'parasut'];
  return Object.fromEntries(
    all.map((p) => [p, { connected: connected.includes(p), accounts: [], needsReauth: reauth.includes(p) }]),
  ) as unknown as ConnectionsMap;
}

const base: SettingsNavInputs = { connections: null, needsReauthCount: 0, billing: null, dirtySections: [], lastRunStatus: null };
const item = (groups: ReturnType<typeof buildSettingsNav>, key: string) => groups.flatMap((g) => g.items).find((i) => i.key === key)!;

describe('tabs', () => {
  it('keeps the five existing keys and adds preferences', () => {
    expect(parseSettingsTab('billing')).toBe('billing');
    expect(parseSettingsTab('syncAdvanced')).toBe('syncAdvanced');
    expect(parseSettingsTab('preferences')).toBe('preferences');
    expect(parseSettingsTab(['apiKeys', 'x'])).toBe('apiKeys');
    expect(parseSettingsTab('nope')).toBeNull();
    expect(parseSettingsTab(undefined)).toBeNull();
  });
  it('desktop falls back to Connections, mobile to the index', () => {
    expect(resolveSettingsTab('nope', false)).toBe('connections');
    expect(resolveSettingsTab(undefined, false)).toBe('connections');
    expect(resolveSettingsTab('nope', true)).toBeNull();
    expect(resolveSettingsTab('billing', true)).toBe('billing');
  });
  it('builds hrefs', () => {
    expect(settingsHref('billing', { invoices: 'all' })).toBe('/ayarlar?tab=billing&invoices=all');
    expect(settingsHref(null)).toBe('/ayarlar');
    expect(settingsHref('apiKeys', { provider: undefined })).toBe('/ayarlar?tab=apiKeys');
  });
  it('maps tabs to form slices', () => {
    expect(tabSlices('senderProfile')).toEqual(['shipperProfile', 'shippingSettings']);
    expect(tabSlices('apiKeys')).toEqual(['integrationSettings']);
    expect(tabSlices('billing')).toEqual([]);
    expect(tabSlices(null)).toEqual([]);
  });
  it('groups follow §1.2 order', () => {
    expect(SETTINGS_NAV_GROUPS.flatMap((g) => g.items)).toEqual(['connections', 'apiKeys', 'senderProfile', 'billing', 'preferences', 'syncAdvanced']);
    expect(CREDENTIAL_PROVIDERS).toHaveLength(7);
  });
});

describe('guard URL rule', () => {
  it('param-only rewrites on the same tab do not leave the form', () => {
    expect(leavesSettingsTab('/ayarlar?tab=senderProfile', '/ayarlar?tab=senderProfile&provider=fedex', false)).toBe(false);
    expect(leavesSettingsTab('/ayarlar?tab=connections&success=etsy_ok', '/ayarlar?tab=connections', false)).toBe(false);
    expect(leavesSettingsTab('/ayarlar', '/ayarlar?tab=connections', false)).toBe(false); // desktop default
  });
  it('a different tab, the mobile index or another page does', () => {
    expect(leavesSettingsTab('/ayarlar?tab=senderProfile', '/ayarlar?tab=billing', false)).toBe(true);
    expect(leavesSettingsTab('/ayarlar?tab=senderProfile', '/ayarlar', true)).toBe(true);
    expect(leavesSettingsTab('/ayarlar?tab=senderProfile', '/app/labels', false)).toBe(true);
  });
});

describe('buildSettingsNav', () => {
  it('neutral when nothing is known (provider unknown: "Plan & billing", no summary)', () => {
    const g = buildSettingsNav(base, copy);
    expect(g.map((x) => x.label)).toEqual(['nav.group.workspace', 'nav.group.shipping', 'nav.group.account', 'nav.group.system']);
    const billing = item(g, 'billing');
    expect(billing.label).toBe('nav.billing');
    expect(billing.summary).toBeUndefined();
    expect(billing.dot).toBeNull();
    expect(item(g, 'connections').summary).toBeUndefined();
    expect(item(g, 'connections').href).toBe('/ayarlar?tab=connections');
  });

  it('connections: warning dot + summary with attention count', () => {
    const g = buildSettingsNav({ ...base, connections: conn(['etsy', 'ebay', 'fedex', 'trendyol'], ['etsy']), needsReauthCount: 1 }, copy);
    const c = item(g, 'connections');
    expect(c.dot).toBe('warning');
    expect(c.dotLabel).toBe('nav.dot.needsAttention');
    expect(c.summary).toBe('nav.summary.connections{"connected":4,"attention":1}');
    expect(item(g, 'apiKeys').summary).toBe('nav.summary.apiKeys{"done":2,"total":7}');
  });

  it('billing active: plan · percent of orders; danger dot for grace / past due / expired', () => {
    const active = buildSettingsNav({ ...base, billing: { plan: 'growth', state: 'active', stripeUpsell: true, meters: { orders: { used: 1440, limit: 2000 } } } }, copy);
    expect(item(active, 'billing').summary).toBe('nav.summary.billing{"plan":"plan:growth","percent":72}');
    expect(item(active, 'billing').dot).toBeNull();
    for (const state of ['grace', 'past_due_grace', 'expired']) {
      const g = buildSettingsNav({ ...base, billing: { plan: 'starter', state, stripeUpsell: true } }, copy);
      expect(item(g, 'billing').dot).toBe('danger');
      expect(item(g, 'billing').summary).toBe('plan:starter');
    }
    // Enterprise really has stripeUpsell: false (planLimits / useEntitlement) — never the Shopify wording.
    const unlimited = buildSettingsNav({ ...base, billing: { plan: 'enterprise', state: 'enterprise', stripeUpsell: false, meters: { orders: { used: 9, limit: null } } } }, copy);
    expect(item(unlimited, 'billing').summary).toBe('plan:enterprise');
    expect(item(unlimited, 'billing').label).toBe('nav.billing');
    expect(item(unlimited, 'billing').summary).not.toBe('nav.summary.billingShopify');
  });

  it('shopify_free: label "Plan", summary "Included with Shopify", never a plan name or dot', () => {
    for (const b of [
      { plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false },
      { plan: 'growth', state: 'expired', stripeUpsell: false },
    ]) {
      const g = buildSettingsNav({ ...base, billing: b }, copy);
      const billing = item(g, 'billing');
      expect(billing.label).toBe('nav.billingShopify');
      expect(billing.summary).toBe('nav.summary.billingShopify');
      expect(billing.dot).toBeNull();
    }
  });

  it('dirty sections get the attention dot; a failed last run the danger dot', () => {
    const g = buildSettingsNav({ ...base, dirtySections: ['senderProfile', 'preferences'], lastRunStatus: 'FAILED' }, copy);
    expect(item(g, 'senderProfile').dot).toBe('attention');
    expect(item(g, 'preferences').dot).toBe('attention');
    expect(item(g, 'apiKeys').dot).toBeNull();
    expect(item(g, 'syncAdvanced').dot).toBe('danger');
    expect(item(buildSettingsNav({ ...base, lastRunStatus: 'completed' }, copy), 'syncAdvanced').dot).toBeNull();
  });

  it('navLabel reads the model (shopify wording included)', () => {
    const g = buildSettingsNav({ ...base, billing: { plan: 'shopify_free', state: 'shopify_free', stripeUpsell: false } }, copy);
    expect(navLabel(g, 'billing')).toBe('nav.billingShopify');
    expect(navLabel(g, 'senderProfile')).toBe('nav.senderProfile');
  });
});

describe('oauthMessage (ayarlar.tsx block, verbatim mapping)', () => {
  it('success codes', () => {
    expect(oauthMessage('success', 'shopify_install_complete')).toEqual({ key: 'oauth.shopifyInstallComplete' });
    expect(oauthMessage('success', 'etsy_connected')).toEqual({ key: 'etsyShopConnected' });
    expect(oauthMessage('success', 'trendyol_ok')).toEqual({ key: 'oauth.connectedGeneric', values: { provider: 'Trendyol' } });
    expect(oauthMessage('success', 'zzz_ok')).toEqual({ key: 'oauth.unknownSuccess' });
  });
  it('error codes', () => {
    expect(oauthMessage('error', 'amazon_no_marketplace_selected')).toEqual({ key: 'amazonSelectMarketplaceFirst' });
    expect(oauthMessage('error', 'shopify_expiring_token_required')).toEqual({ key: 'oauth.shopifyTokenType' });
    expect(oauthMessage('error', 'ebay_invalid_state')).toEqual({ key: 'oauth.securityCheckFailed', values: { provider: 'eBay' } });
    expect(oauthMessage('error', 'wix_missing_params')).toEqual({ key: 'oauth.missingParams', values: { provider: 'Wix' } });
    expect(oauthMessage('error', 'etsy_token_exchange')).toEqual({ key: 'etsyConnectionFailed' });
    expect(oauthMessage('error', 'hepsiburada_x')).toEqual({ key: 'oauth.failedGeneric', values: { provider: 'Hepsiburada' } });
    expect(oauthMessage('error', 'qq')).toEqual({ key: 'oauth.unknownFailed' });
  });
});
