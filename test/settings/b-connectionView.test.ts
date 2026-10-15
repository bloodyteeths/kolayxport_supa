import { describe, expect, it } from 'vitest';
import {
  STALE_SYNC_MS,
  latestSync,
  reauthBannerModel,
  storeLimitModel,
  storesFull,
  storesLine,
  tileModel,
  type TileContext,
} from '@/components/domain/settings/connections/connectionView';
import { getIntegration } from '@/lib/settings/integrations';
import type { ConnectionEntry } from '@/lib/integrations/connectionStatus';

const NOW = new Date('2026-10-15T12:00:00Z');
const ctx = (over: Partial<TileContext> = {}): TileContext => ({ loading: false, checkFailed: false, now: NOW, ...over });
const spec = (id: string) => getIntegration(id)!;
const recent = new Date(NOW.getTime() - 5 * 60_000).toISOString();
const old = new Date(NOW.getTime() - STALE_SYNC_MS - 60_000).toISOString();
const acct = (o: Partial<ConnectionEntry['accounts'][number]> = {}) => ({ id: 'a1', name: 'BelleCoutureGifts', externalId: '123', lastSyncAt: recent, ...o });

describe('tileModel (§4.2 table)', () => {
  it('connected Etsy offers Disconnect in ⋯', () => {
    expect(tileModel(spec('etsy'), ctx({ entry: { connected: true, accounts: [acct()], needsReauth: false } }))).toMatchObject({ canDisconnect: true });
    expect(tileModel(spec('etsy'), ctx({ entry: { connected: false, accounts: [], needsReauth: false } }))).toMatchObject({ canDisconnect: false });
  });

  it('first load → skeleton, no button', () => {
    const m = tileModel(spec('etsy'), ctx({ loading: true }));
    expect(m).toMatchObject({ status: 'loading', button: null, meta: { kind: 'none' } });
  });

  it('not connected oauth → "Connect {name}"; credentials → "Set up"; blurb meta', () => {
    expect(tileModel(spec('ebay'), ctx({ entry: { connected: false, accounts: [], needsReauth: false } }))).toMatchObject({
      status: 'not_connected', button: 'connect', meta: { kind: 'blurb' }, canRefresh: false, canDisconnect: false,
    });
    expect(tileModel(spec('ups'), ctx({ entry: { connected: false, accounts: [], needsReauth: false } }))).toMatchObject({
      status: 'not_connected', button: 'setUp', canRemoveCredentials: false,
    });
  });

  it('incomplete → "Finish setup" + the first missing field when settings are loaded', () => {
    const entry: ConnectionEntry = { connected: false, accounts: [], needsReauth: false, reason: 'incomplete_credentials' };
    expect(tileModel(spec('trendyol'), ctx({ entry, credentialValues: { trendyolApiKey: '••••1', trendyolApiSecret: '••••2', trendyolSupplierId: '' } })))
      .toMatchObject({ status: 'incomplete', button: 'finishSetup', meta: { kind: 'missingField', field: 'supplierId' }, canRemoveCredentials: true });
    expect(tileModel(spec('trendyol'), ctx({ entry }))).toMatchObject({ meta: { kind: 'reason', reason: 'incomplete' } });
  });

  it('needs reauth → "Reconnect" + account · Authorization expired', () => {
    const entry: ConnectionEntry = { connected: true, needsReauth: true, reason: 'refresh_token_expired', accounts: [acct({ needsReauth: true, reason: 'refresh_token_expired', name: 'Amazon A1B2' })] };
    expect(tileModel(spec('amazon'), ctx({ entry }))).toMatchObject({
      status: 'needs_reconnect', button: 'reconnect', meta: { kind: 'reason', reason: 'authExpired', account: 'Amazon A1B2' }, canRefresh: true, canDisconnect: true,
    });
  });

  it('connected Etsy with several shops → "3 shops", Manage', () => {
    const entry: ConnectionEntry = { connected: true, needsReauth: false, accounts: [acct({ id: '1' }), acct({ id: '2' }), acct({ id: '3' })] };
    expect(tileModel(spec('etsy'), ctx({ entry }))).toMatchObject({ status: 'connected', button: 'manage', meta: { kind: 'shops', count: 3 } });
  });

  it('connected with a stale refresh → stale meta (warning + inline refresh)', () => {
    const entry: ConnectionEntry = { connected: true, needsReauth: false, accounts: [acct({ lastSyncAt: old })] };
    expect(tileModel(spec('etsy'), ctx({ entry })).meta).toEqual({ kind: 'account', name: 'BelleCoutureGifts', lastSyncAt: old, stale: true });
  });

  it('connected panel-less provider has no button; generic account names are dropped', () => {
    const entry: ConnectionEntry = { connected: true, needsReauth: false, accounts: [{ id: 'credential', name: 'eBay', externalId: null, lastSyncAt: null }] };
    expect(tileModel(spec('ebay'), ctx({ entry }))).toMatchObject({ button: null, meta: { kind: 'account', name: undefined }, canReconnect: true });
  });

  it('status request failed with cache → check_failed pill, last known meta/button', () => {
    const entry: ConnectionEntry = { connected: true, needsReauth: false, accounts: [acct()] };
    const m = tileModel(spec('etsy'), ctx({ entry, checkFailed: true }));
    expect(m.status).toBe('check_failed');
    expect(m.knownStatus).toBe('connected');
    expect(m.button).toBe('manage');
  });

  it('Hepsiburada is support-managed; Chrome extension readonly', () => {
    expect(tileModel(spec('hepsiburada'), ctx({ entry: { connected: false, accounts: [], needsReauth: false } }))).toMatchObject({
      status: 'not_connected', button: 'contactSupport', meta: { kind: 'supportManaged' },
    });
    expect(tileModel(spec('chrome'), ctx({ extension: { detected: true, lastActivityAt: recent } }))).toMatchObject({
      status: 'connected', button: null, meta: { kind: 'extension', lastActivityAt: recent },
    });
    expect(tileModel(spec('chrome'), ctx({ extension: { detected: false, lastActivityAt: null } }))).toMatchObject({
      status: 'not_connected', button: 'installExtension', meta: { kind: 'notDetected' },
    });
  });

  it('Wix polling and timeout replace the meta', () => {
    const entry: ConnectionEntry = { connected: false, accounts: [], needsReauth: false };
    expect(tileModel(spec('wix'), ctx({ entry, wixPoll: 'polling' }))).toMatchObject({ meta: { kind: 'wixWaiting' }, button: 'connect' });
    expect(tileModel(spec('wix'), ctx({ entry, wixPoll: 'timedOut' }))).toMatchObject({ meta: { kind: 'wixTimedOut' }, button: 'checkAgain' });
  });

  it('latestSync picks the newest account', () => {
    expect(latestSync({ connected: true, needsReauth: false, accounts: [acct({ lastSyncAt: old }), acct({ id: '2', lastSyncAt: recent })] })).toBe(recent);
    expect(latestSync(undefined)).toBeNull();
  });
});

describe('reauthBannerModel (§4.3)', () => {
  const connections = {
    etsy: { connected: true, needsReauth: true, accounts: [acct({ needsReauth: true })] },
    amazon: { connected: true, needsReauth: true, accounts: [acct({ name: 'Amazon' })] },
  };
  it('none → null', () => expect(reauthBannerModel([], connections)).toBeNull());
  it('one → that provider + account + since', () => {
    expect(reauthBannerModel(['etsy'], connections)).toMatchObject({ kind: 'one', account: 'BelleCoutureGifts', since: recent });
  });
  it('several → review N', () => {
    expect(reauthBannerModel(['etsy', 'amazon'], connections)).toEqual({ kind: 'many', count: 2, firstId: 'etsy' });
  });
});

describe('store meter + store-limit modal (§4.5, §4.6, §11)', () => {
  it('no store meter (fallback) → no line', () => {
    expect(storesLine({ stripeUpsell: true })).toBeNull();
    expect(storesFull({ stripeUpsell: true })).toBe(false);
  });
  it('line shows the meter; Compare plans only when stripeUpsell is true', () => {
    expect(storesLine({ stripeUpsell: true, used: 4, limit: 5 })).toEqual({ used: 4, limit: 5, showCompare: true });
    expect(storesLine({ stripeUpsell: false, used: 1, limit: 1 })?.showCompare).toBe(false);
    expect(storesLine({ stripeUpsell: undefined, used: 1, limit: 3 })?.showCompare).toBe(false);
    expect(storesLine({ stripeUpsell: true, used: 2, limit: null })).toBeNull();
  });
  it('full detection', () => {
    expect(storesFull({ stripeUpsell: true, used: 5, limit: 5 })).toBe(true);
    expect(storesFull({ stripeUpsell: true, used: 4, limit: 5 })).toBe(false);
  });
  it('Growth at 5 → move to Pro for 10, /fiyatlandirma?plan=pro', () => {
    expect(storeLimitModel({ stripeUpsell: true, plan: 'growth', used: 5, limit: 5 })).toEqual({
      neutral: false, plan: 'growth', limit: 5, nextPlan: 'pro', nextLimit: 10, compareHref: '/fiyatlandirma?plan=pro',
    });
  });
  it('trial (3) → Growth (5)', () => {
    expect(storeLimitModel({ stripeUpsell: true, plan: 'trial', used: 3, limit: 3 })).toMatchObject({ nextPlan: 'growth', nextLimit: 5 });
  });
  it('entitlement fallback (no store meter) → decided plan limit drives the upgrade copy', () => {
    expect(storeLimitModel({ stripeUpsell: true, plan: 'growth' })).toEqual({
      neutral: false, plan: 'growth', limit: 5, nextPlan: 'pro', nextLimit: 10, compareHref: '/fiyatlandirma?plan=pro',
    });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'starter' })).toMatchObject({ limit: 2, nextPlan: 'growth' });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'trial' })).toMatchObject({ limit: 3, nextPlan: 'growth' });
    expect(storeLimitModel({ stripeUpsell: false, plan: 'shopify_free' })).toEqual({ neutral: true });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'enterprise' })).toEqual({ neutral: true });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'growth', limit: null })).toEqual({ neutral: true });
    expect(storesLine({ stripeUpsell: true, plan: 'growth' })).toBeNull();
  });
  it('shopify_free, unknown provider, Pro and unknown plans → neutral', () => {
    expect(storeLimitModel({ stripeUpsell: false, plan: 'shopify_free', used: 1, limit: 1 })).toEqual({ neutral: true });
    expect(storeLimitModel({ stripeUpsell: undefined })).toEqual({ neutral: true });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'pro', used: 10, limit: 10 })).toEqual({ neutral: true });
    expect(storeLimitModel({ stripeUpsell: true, plan: 'mystery', used: 1, limit: 1 })).toEqual({ neutral: true });
  });
});
