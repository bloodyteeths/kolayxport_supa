import { describe, expect, it } from 'vitest';
import {
  CREDENTIAL_PROVIDERS,
  INTEGRATIONS,
  clearCredentialsPatch,
  credentialFieldNames,
  credentialHints,
  credentialPatch,
  firstMissingField,
  getIntegration,
  nextSecretValue,
  normalizeShopifySubdomain,
  shopifyConnectHref,
  amazonConnectHref,
  validateCredentials,
} from '@/lib/settings/integrations';
import { getLogo, logoDisplayName } from '@/lib/ds/logos';
import { flattenSettingsB } from './b-messages';

describe('integration registry (settings §5.2, §17 integrationsRegistry.test)', () => {
  it('DHL eCommerce fields are exactly mngCustomerNumber + mngPassword', () => {
    expect(credentialFieldNames('mng')).toEqual(['mngCustomerNumber', 'mngPassword']);
    expect(getIntegration('mng')?.name).toBe('DHL eCommerce');
    expect(logoDisplayName(getIntegration('mng')!.logo)).toBe('DHL eCommerce');
  });

  it('no removed field is offered anywhere', () => {
    const all = INTEGRATIONS.flatMap((s) => s.fields?.map((f) => f.name) ?? []);
    for (const gone of ['parasutBaseUrl', 'parasutRedirectUri', 'mngAppId', 'mngAppSecret', 'mngApiEnvironment']) {
      expect(all).not.toContain(gone);
    }
  });

  it('field maps match §5.2 (secrets marked)', () => {
    const map = Object.fromEntries(CREDENTIAL_PROVIDERS.map((s) => [s.id, s.fields!.map((f) => `${f.name}${f.secret ? '*' : ''}`)]));
    expect(map).toEqual({
      trendyol: ['trendyolApiKey*', 'trendyolApiSecret*', 'trendyolSupplierId'],
      veeqo: ['veeqoApiKey*'],
      shippo: ['shippoToken*'],
      fedex: ['fedexApiKey*', 'fedexApiSecret*', 'fedexAccountNumber'],
      ups: ['upsApiKey*', 'upsApiSecret*', 'upsAccountNumber'],
      mng: ['mngCustomerNumber', 'mngPassword*'],
      parasut: ['parasutClientId', 'parasutClientSecret*', 'parasutUsername', 'parasutPassword*', 'parasutCompanyId'],
    });
  });

  it('every tile has a logo in the registry except the Chrome extension (monogram)', () => {
    for (const s of INTEGRATIONS) {
      if (s.id === 'chrome') expect(getLogo(s.logo)).toBeNull();
      else expect(getLogo(s.logo), s.id).not.toBeNull();
    }
  });

  it('every tile has an EN+TR blurb key', () => {
    const keys = new Set(flattenSettingsB().map((k) => k.key));
    for (const s of INTEGRATIONS) expect(keys.has(`connections.blurb.${s.id}`), s.id).toBe(true);
    for (const s of CREDENTIAL_PROVIDERS) for (const f of s.fields!) expect(keys.has(`credentials.field.${f.labelKey}`), f.labelKey).toBe(true);
  });
});

describe('validateCredentials', () => {
  it('all empty is valid (that is "Remove credentials")', () => {
    expect(validateCredentials('trendyol', { trendyolApiKey: '', trendyolApiSecret: '', trendyolSupplierId: '' })).toEqual({});
  });
  it('any filled → every required field is required (server incomplete_credentials)', () => {
    expect(validateCredentials('trendyol', { trendyolApiKey: 'abc', trendyolApiSecret: '', trendyolSupplierId: '' })).toEqual({
      trendyolApiSecret: { code: 'requiredWith', field: 'trendyolApiSecret' },
      trendyolSupplierId: { code: 'requiredWith', field: 'trendyolSupplierId' },
    });
  });
  it('a masked secret counts as filled', () => {
    expect(validateCredentials('trendyol', { trendyolApiKey: '••••1234', trendyolApiSecret: '••••abcd', trendyolSupplierId: '123' })).toEqual({});
  });
  it('supplier ID is digits only', () => {
    expect(validateCredentials('trendyol', { trendyolApiKey: 'a', trendyolApiSecret: 'b', trendyolSupplierId: '12a' })).toEqual({
      trendyolSupplierId: { code: 'digits' },
    });
    expect(validateCredentials('trendyol', { trendyolApiKey: 'a', trendyolApiSecret: 'b', trendyolSupplierId: ' 123 ' })).toEqual({});
  });
});

describe('credentialPatch (PATCH body carries only that provider, masks stripped)', () => {
  it('drops masks, trims ids, keeps only the provider keys', () => {
    expect(credentialPatch('fedex', {
      fedexApiKey: '••••1234', fedexApiSecret: 'new-secret', fedexAccountNumber: ' 5678 ', upsApiKey: 'leak?',
    })).toEqual({ fedexApiSecret: 'new-secret', fedexAccountNumber: '5678' });
  });
  it('remove credentials sends empty strings for every field', () => {
    expect(clearCredentialsPatch('mng')).toEqual({ mngCustomerNumber: '', mngPassword: '' });
  });
});

describe('nextSecretValue (legacy ApiKeysPanel.onSecretChange, unchanged)', () => {
  const mask = '••••1234';
  it('typing next to the mask replaces it with the typed text', () => {
    expect(nextSecretValue(mask, `${mask}x`)).toBe('x');
    expect(nextSecretValue(mask, `x${mask}`)).toBe('x');
  });
  it('a partial edit of the mask keeps the saved secret', () => {
    expect(nextSecretValue(mask, '••••123')).toBe(mask);
  });
  it('clearing the whole field removes it', () => {
    expect(nextSecretValue(mask, '')).toBe('');
  });
  it('plain values pass through', () => {
    expect(nextSecretValue('abc', 'abcd')).toBe('abcd');
  });
});

describe('hints, missing field, summaries, hrefs', () => {
  it('credentialHints lists hint fields with values', () => {
    expect(credentialHints('trendyol', { trendyolApiKey: '••••1234', trendyolSupplierId: '123456' }).map((h) => [h.field.labelKey, h.value]))
      .toEqual([['apiKey', '••••1234'], ['supplierId', '123456']]);
    expect(credentialHints('trendyol', null)).toEqual([]);
  });
  it('credentialHints display-masks non-secret identifiers (supplier ID stays in full)', () => {
    expect(credentialHints('fedex', { fedexAccountNumber: '123455678' }).map((h) => h.value)).toEqual(['••••5678']);
    expect(credentialHints('ups', { upsAccountNumber: ' A1B2C3 ' }).map((h) => h.value)).toEqual(['••••B2C3']);
    expect(credentialHints('mng', { mngCustomerNumber: '42' }).map((h) => h.value)).toEqual(['••••42']);
    expect(credentialHints('parasut', { parasutCompanyId: '987654' }).map((h) => h.value)).toEqual(['••••7654']);
    expect(credentialHints('fedex', { fedexAccountNumber: '••••5678' }).map((h) => h.value)).toEqual(['••••5678']);
  });
  it('Etsy has a disconnect marker (per-shop POST handled by useConnectionActions)', () => {
    expect(getIntegration('etsy')?.disconnect).toEqual({ method: 'post', url: '/api/integrations/etsy/shops' });
  });
  it('firstMissingField', () => {
    expect(firstMissingField('trendyol', { trendyolApiKey: 'a', trendyolApiSecret: 'b', trendyolSupplierId: '' })?.labelKey).toBe('supplierId');
    expect(firstMissingField('trendyol', null)).toBeUndefined();
  });
  it('OAuth hrefs are the legacy ones', () => {
    expect(normalizeShopifySubdomain(' my-store.myshopify.com ')).toBe('my-store');
    expect(shopifyConnectHref('my-store')).toBe('/api/integrations/shopify/connect?shop=my-store.myshopify.com');
    expect(amazonConnectHref(['A1', 'A2'])).toBe('/api/integrations/amazon/connect?marketplaceIds=A1,A2');
  });
});

describe('Group B i18n fragment', () => {
  const keys = flattenSettingsB();
  it('every key has EN and TR', () => {
    for (const k of keys) {
      expect(k.en.length, k.key).toBeGreaterThan(0);
      expect(k.tr.length, k.key).toBeGreaterThan(0);
    }
  });
  it('TR has no ASCII-Turkish', () => {
    for (const k of keys) expect(k.tr, k.key).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme|Baglan|Magaza|Sifre/);
  });
  it('no uppercase-only labels (P5)', () => {
    for (const k of keys) expect(k.en === k.en.toUpperCase() && /[A-Z]{4,}/.test(k.en), k.key).toBe(false);
  });
});
