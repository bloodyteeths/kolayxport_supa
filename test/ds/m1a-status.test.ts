import { describe, expect, it } from 'vitest';
import {
  STATUS_VOCABULARY,
  allStatusMessageIds,
  connectionStatus,
  getStatusStyle,
  invoiceStatus,
  isStatusKey,
  isUnread,
  isUnsent,
  listingStatus,
  messageStatus,
  normalizeRaw,
  orderRowStatus,
  orderStatus,
  runStatus,
  subscriptionAlert,
  subscriptionStatus,
  syncStatus,
  trackingStatus,
} from '@/lib/ds/status';
import { M1A_KEYS } from './m1a-i18n';

const NOW = new Date('2026-10-15T09:00:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

describe('vocabulary (DS §3.9 + C26 additions)', () => {
  it('has every domain and every key the specs require', () => {
    const keys = (d: keyof typeof STATUS_VOCABULARY) => Object.keys(STATUS_VOCABULARY[d]).sort();
    expect(keys('order')).toEqual(['cancelled', 'delivered', 'label_created', 'on_hold', 'overdue', 'problem', 'refunded', 'shipped', 'to_ship']);
    expect(keys('label')).toEqual(['label_failed']);
    expect(keys('listing')).toEqual(['active', 'draft', 'expired', 'in_review', 'inactive', 'rejected', 'sold_out']);
    expect(keys('sync')).toEqual(['conflict', 'pending', 'refresh_failed', 'sync_failed', 'synced', 'syncing']);
    expect(keys('connection')).toEqual(['check_failed', 'connected', 'incomplete', 'needs_reconnect', 'not_connected']);
    expect(keys('message')).toEqual(['answer_rejected', 'in_review', 'needs_reply', 'unread']);
    expect(keys('subscription')).toHaveLength(8);
    expect(keys('invoice')).toEqual(['open', 'paid', 'uncollectible', 'void']);
    expect(keys('run')).toEqual(['completed', 'failed', 'running']);
    expect(keys('tracking')).toEqual(['not_sent', 'send_failed']);
  });

  it('tones follow the spec (attention only for unsent drafts)', () => {
    expect(getStatusStyle('sync', 'pending')).toEqual({ tone: 'attention' });
    expect(getStatusStyle('sync', 'syncing')).toEqual({ tone: 'info', dot: 'pulse' });
    expect(getStatusStyle('order', 'label_created')).toEqual({ tone: 'neutral', dot: 'accent' });
    expect(getStatusStyle('order', 'delivered')).toEqual({ tone: 'success', dot: 'hollow' });
    expect(getStatusStyle('connection', 'incomplete')).toEqual({ tone: 'warning', outline: true });
    expect(getStatusStyle('run', 'running')?.dot).toBe('pulse');
    const attention = Object.entries(STATUS_VOCABULARY).flatMap(([d, m]) =>
      Object.entries(m).filter(([, s]) => s.tone === 'attention').map(([k]) => `${d}.${k}`),
    );
    expect(attention).toEqual(['sync.pending']);
  });

  it('rejects keys outside the vocabulary', () => {
    expect(getStatusStyle('order', 'paid')).toBeNull();
    expect(isStatusKey('listing', 'in_review')).toBe(true);
    expect(isStatusKey('order', 'in_review')).toBe(false);
  });

  it('every vocabulary key has EN and TR messages, and nothing extra', () => {
    const msgIds = M1A_KEYS.filter((k) => k.namespace === 'status').map((k) => `status.${k.key}`).sort();
    expect(msgIds).toEqual(allStatusMessageIds().sort());
    for (const k of M1A_KEYS) {
      expect(k.en.trim(), k.key).not.toBe('');
      expect(k.tr.trim(), k.key).not.toBe('');
      expect(k.tr, `ASCII-Turkish in ${k.key}`).not.toMatch(/Olustur|Gonder|Siparis|Iptal|Odeme/);
    }
  });

  it('normalizeRaw folds case, camelCase and Turkish letters', () => {
    expect(normalizeRaw('PartiallyShipped')).toBe('partially_shipped');
    expect(normalizeRaw('Kargolandı')).toBe('kargolandi');
    expect(normalizeRaw('SHIPPED')).toBe('shipped');
    expect(normalizeRaw(' on-hold ')).toBe('on_hold');
    expect(normalizeRaw(null)).toBe('');
  });
});

describe('orderStatus / orderRowStatus (orders §4.2)', () => {
  it('maps raw marketplace values', () => {
    expect(orderStatus('Cancelled', 'trendyol')).toBe('cancelled');
    expect(orderStatus('canceled', 'amazon')).toBe('cancelled');
    expect(orderStatus('refunded')).toBe('refunded');
    expect(orderStatus('Returned', 'trendyol')).toBe('refunded');
    expect(orderStatus('completed', 'etsy')).toBe('delivered');
    expect(orderStatus('Delivered')).toBe('delivered');
    expect(orderStatus('PartiallyShipped', 'amazon')).toBe('shipped');
    expect(orderStatus('Kargolandı')).toBe('shipped');
    expect(orderStatus('FULFILLED', 'wix')).toBe('shipped');
    expect(orderStatus('NOT_FULFILLED', 'wix')).toBe('to_ship');
    expect(orderStatus('UnDelivered', 'trendyol')).toBe('problem');
    expect(orderStatus('on_hold')).toBe('on_hold');
    expect(orderStatus('Pending', 'amazon')).toBe('to_ship');
    expect(orderStatus('paid', 'etsy')).toBe('to_ship');
    expect(orderStatus(null)).toBe('to_ship');
  });

  it('applies the priority list, first match wins', () => {
    const base = { rawStatus: 'paid', marketplace: 'etsy', now: NOW };
    expect(orderRowStatus({ ...base, rawStatus: 'cancelled', labelFailed: true })).toMatchObject({ domain: 'order', key: 'cancelled' });
    expect(orderRowStatus({ ...base, rawStatus: 'shipped', hasLabel: true })).toMatchObject({ key: 'shipped', raw: 'shipped' });
    expect(orderRowStatus({ ...base, labelFailed: true, labelError: 'Invalid postcode', hasLabel: true })).toEqual({
      domain: 'label',
      key: 'label_failed',
      raw: 'paid',
      reason: 'label_error',
      detail: 'Invalid postcode',
    });
    expect(orderRowStatus({ ...base, isFBA: true, shipBy: hoursAgo(48) })).toMatchObject({ key: 'to_ship', reason: 'fba' });
    expect(orderRowStatus({ ...base, isFBA: true, rawStatus: 'Shipped' })).toMatchObject({ key: 'shipped', reason: 'fba' });
    expect(orderRowStatus({ ...base, hasLabel: true, addressMissing: ['postalCode'], shipBy: hoursAgo(5) })).toMatchObject({ key: 'label_created' });
    expect(orderRowStatus({ ...base, addressMissing: ['postalCode'] })).toMatchObject({ key: 'problem', reason: 'address_incomplete', detail: 'postalCode' });
    expect(orderRowStatus({ ...base, addressUnavailable: true })).toMatchObject({ key: 'problem', reason: 'address_unavailable' });
    expect(orderRowStatus({ ...base, rawStatus: 'on_hold', shipBy: hoursAgo(5) })).toMatchObject({ key: 'on_hold' });
    expect(orderRowStatus({ ...base, shipBy: hoursAgo(1) })).toMatchObject({ key: 'overdue' });
    expect(orderRowStatus({ ...base, shipBy: hoursAgo(-5) })).toMatchObject({ key: 'to_ship' });
    expect(orderRowStatus({ ...base, shipBy: null })).toMatchObject({ key: 'to_ship' });
  });
});

describe('listingStatus (listings-grid §3)', () => {
  it('etsy', () => {
    expect(listingStatus({ state: 'active' }, 'etsy')).toBe('active');
    expect(listingStatus({ state: 'sold_out' }, 'etsy')).toBe('sold_out');
    expect(listingStatus({ state: 'expired' }, 'etsy')).toBe('expired');
    expect(listingStatus({ state: 'draft' }, 'etsy')).toBe('draft');
    expect(listingStatus({ state: 'whatever' }, 'etsy')).toBe('inactive');
  });
  it('ebay', () => {
    expect(listingStatus({ status: 'PUBLISHED', quantity: 3 }, 'ebay')).toBe('active');
    expect(listingStatus({ status: 'PUBLISHED', quantity: 0 }, 'ebay')).toBe('sold_out');
    expect(listingStatus({ status: 'ENDED' }, 'ebay')).toBe('inactive');
    expect(listingStatus({ status: 'DRAFT' }, 'ebay')).toBe('draft');
    expect(listingStatus({ status: 'UNPUBLISHED' }, 'ebay')).toBe('draft');
  });
  it('trendyol', () => {
    expect(listingStatus({ rejected: true, approved: true, onSale: true }, 'trendyol')).toBe('rejected');
    expect(listingStatus({ blacklisted: true }, 'trendyol')).toBe('rejected');
    expect(listingStatus({ approved: false }, 'trendyol')).toBe('in_review');
    expect(listingStatus({ approved: true, archived: true, onSale: true }, 'trendyol')).toBe('inactive');
    expect(listingStatus({ approved: true, onSale: true, quantity: 0 }, 'trendyol')).toBe('sold_out');
    expect(listingStatus({ approved: true, onSale: true, quantity: 4 }, 'trendyol')).toBe('active');
    expect(listingStatus({ approved: true, onSale: false }, 'trendyol')).toBe('inactive');
  });
  it('wix', () => {
    expect(listingStatus({ visible: false, inStock: true }, 'wix')).toBe('inactive');
    expect(listingStatus({ visible: true, inStock: false }, 'wix')).toBe('sold_out');
    expect(listingStatus({ visible: true, inStock: true, trackInventory: true, quantity: 0 }, 'wix')).toBe('sold_out');
    expect(listingStatus({ visible: true, inStock: true, trackInventory: false, quantity: 0 }, 'wix')).toBe('active');
  });
  it('shopify', () => {
    expect(listingStatus({ status: 'archived' }, 'shopify')).toBe('inactive');
    expect(listingStatus({ status: 'draft' }, 'shopify')).toBe('draft');
    expect(listingStatus({ status: 'active', trackInventory: true, totalInventory: 0 }, 'shopify')).toBe('sold_out');
    expect(listingStatus({ status: 'active', trackInventory: false, totalInventory: 0 }, 'shopify')).toBe('active');
  });
});

describe('syncStatus (drafts)', () => {
  it('maps draft states and hides "Sent" after 24h', () => {
    expect(syncStatus({ status: 'draft' }, NOW)).toBe('pending');
    expect(syncStatus({ status: 'syncing' }, NOW)).toBe('syncing');
    expect(syncStatus({ status: 'failed' }, NOW)).toBe('sync_failed');
    expect(syncStatus({ status: 'conflict' }, NOW)).toBe('conflict');
    expect(syncStatus({ status: 'synced', syncedAt: hoursAgo(2) }, NOW)).toBe('synced');
    expect(syncStatus({ status: 'synced', syncedAt: hoursAgo(25) }, NOW)).toBeNull();
    expect(syncStatus({ status: 'synced', updatedAt: hoursAgo(1) }, NOW)).toBe('synced');
    expect(syncStatus({ status: 'synced' }, NOW)).toBeNull();
    expect(syncStatus({ status: 'cancelled' }, NOW)).toBeNull();
    expect(syncStatus(null, NOW)).toBeNull();
    expect(isUnsent('pending')).toBe(true);
    expect(isUnsent('syncing')).toBe(false);
  });
});

describe('connectionStatus (honest: never "not connected" when unknown)', () => {
  it('maps', () => {
    expect(connectionStatus({ connected: true })).toBe('connected');
    expect(connectionStatus({ connected: true, needsReauth: true })).toBe('needs_reconnect');
    expect(connectionStatus({ connected: false, reason: 'incomplete_credentials' })).toBe('incomplete');
    expect(connectionStatus({ connected: false })).toBe('not_connected');
    expect(connectionStatus(undefined)).toBe('check_failed');
    expect(connectionStatus({ connected: true }, { checkFailed: true })).toBe('check_failed');
  });
});

describe('messageStatus (messages §5.2)', () => {
  it('trendyol and wix', () => {
    expect(messageStatus({ platform: 'trendyol', needsReply: true, platformStatus: 'WAITING_FOR_ANSWER' })).toBe('needs_reply');
    expect(messageStatus({ platform: 'trendyol', needsReply: false, platformStatus: 'WAITING_FOR_APPROVE' })).toBe('in_review');
    expect(messageStatus({ platform: 'trendyol', needsReply: false, platformStatus: 'ANSWERED' })).toBeNull();
    expect(messageStatus({ platform: 'trendyol', needsReply: true, platformStatus: 'REJECTED' })).toBe('answer_rejected');
    expect(messageStatus({ platform: 'trendyol', needsReply: false, platformStatus: 'REPORTED' })).toBeNull();
    expect(messageStatus({ platform: 'wix', needsReply: true })).toBe('needs_reply');
    expect(messageStatus({ platform: 'wix', needsReply: false })).toBeNull();
  });
  it('unread is a dot, computed separately', () => {
    expect(isUnread({ needsReply: true, lastMessageAt: NOW, lastSeenAt: null })).toBe(true);
    expect(isUnread({ needsReply: true, lastMessageAt: NOW, lastSeenAt: hoursAgo(1) })).toBe(true);
    expect(isUnread({ needsReply: true, lastMessageAt: hoursAgo(2), lastSeenAt: hoursAgo(1) })).toBe(false);
    expect(isUnread({ needsReply: false, lastMessageAt: NOW, lastSeenAt: null })).toBe(false);
  });
});

describe('billing (settings §9.3, overview queue)', () => {
  it('subscriptionStatus', () => {
    expect(subscriptionStatus({ state: 'trial' })).toBe('trial');
    expect(subscriptionStatus({ state: 'grace' })).toBe('grace');
    expect(subscriptionStatus({ state: 'active' })).toBe('active');
    expect(subscriptionStatus({ state: 'active', cancelAtPeriodEnd: true })).toBe('canceling');
    expect(subscriptionStatus({ state: 'past_due_grace' })).toBe('past_due');
    expect(subscriptionStatus({ state: 'expired' })).toBe('expired');
    expect(subscriptionStatus({ state: 'enterprise' })).toBe('active');
    expect(subscriptionStatus({ state: 'shopify_free' })).toBeNull();
    expect(subscriptionStatus(null)).toBeNull();
  });
  it('subscriptionAlert', () => {
    const in3d = new Date(NOW.getTime() + 3 * 86_400_000).toISOString();
    const in9d = new Date(NOW.getTime() + 9 * 86_400_000).toISOString();
    const meters = { labels: { used: 9, limit: 10 }, orders: { used: 1, limit: null } };
    expect(subscriptionAlert({ state: 'trial', trialEndsAt: in3d }, NOW)).toBe('trial_ending');
    expect(subscriptionAlert({ state: 'trial', trialEndsAt: in3d, meters }, NOW)).toBe('trial_ending');
    expect(subscriptionAlert({ state: 'trial', trialEndsAt: in9d, meters }, NOW)).toBe('near_limit');
    expect(subscriptionAlert({ state: 'active', meters: { labels: { used: 7, limit: 10 } } }, NOW)).toBeNull();
    expect(subscriptionAlert({ state: 'shopify_free', plan: 'shopify_free', meters }, NOW)).toBeNull();
    expect(subscriptionAlert({ state: 'expired', meters }, NOW)).toBeNull();
  });
  it('invoiceStatus', () => {
    expect(invoiceStatus('paid')).toBe('paid');
    expect(invoiceStatus('open')).toBe('open');
    expect(invoiceStatus('void')).toBe('void');
    expect(invoiceStatus('uncollectible')).toBe('uncollectible');
    expect(invoiceStatus('draft')).toBeNull();
  });
});

describe('runStatus / trackingStatus', () => {
  it('runStatus', () => {
    expect(runStatus('succeeded')).toBe('completed');
    expect(runStatus('running')).toBe('running');
    expect(runStatus('failed')).toBe('failed');
    expect(runStatus('weird')).toBeNull();
  });
  it('trackingStatus', () => {
    expect(trackingStatus({ etsySubmitStatus: 'failed' }, { now: NOW })).toBe('send_failed');
    expect(trackingStatus({ status: 'failed', etsySubmitStatus: 'submitted' }, { now: NOW })).toBe('send_failed');
    expect(trackingStatus({ etsySubmitStatus: 'pending', submittedAt: hoursAgo(1) }, { now: NOW })).toBe('not_sent');
    expect(trackingStatus({ etsySubmitStatus: 'pending', submittedAt: hoursAgo(0.25) }, { now: NOW })).toBeNull();
    expect(trackingStatus({ etsySubmitStatus: 'submitted' }, { now: NOW })).toBeNull();
    expect(trackingStatus(null, { labelCreatedAt: hoursAgo(3), now: NOW })).toBe('not_sent');
    expect(trackingStatus(null, { labelCreatedAt: hoursAgo(1), now: NOW })).toBeNull();
    expect(trackingStatus(null, { labelCreatedAt: hoursAgo(24 * 20), now: NOW })).toBeNull();
    expect(trackingStatus(null, { now: NOW })).toBeNull();
  });
});
