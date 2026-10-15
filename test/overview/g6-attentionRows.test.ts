// overview G6 (§3.2, §8): attentionRows — ordering, grouping, hide-at-0, hideBilling, extension vs setup CTA,
// partial errors never "All caught up", not-connected rows 1–3 only, legacy vs v2 hrefs.
import { describe, expect, it } from 'vitest';
import {
  ATTENTION_ORDER,
  EXTENSION_SETUP_HREF,
  SUPPORT_HREF,
  buildAttentionRows,
  daysUntil,
  orderRefText,
  queueState,
  quoteError,
  usagePause,
  type AttentionInput,
} from '@/components/domain/overview/attentionRows';
import type { OverviewSummary } from '@/lib/overview/types';
import { NOW, baseSummary, busySummary, emptyBucket } from './g6-fixtures';

function input(summary: OverviewSummary | null | undefined, over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    summary,
    reconnect: [],
    syncFailures: [],
    extensionDetected: true,
    anyMarketplace: true,
    flags: {},
    now: NOW,
    ...over,
  };
}

const kinds = (s: OverviewSummary | null | undefined, over: Partial<AttentionInput> = {}) => buildAttentionRows(input(s, over)).rows.map((r) => r.id);

describe('buildAttentionRows', () => {
  it('renders nothing when every count is 0', () => {
    const m = buildAttentionRows(input(baseSummary()));
    expect(m.rows).toEqual([]);
    expect(m.failedSections).toEqual([]);
  });

  it('orders rows 1–11 and groups per provider / marketplace', () => {
    const s = busySummary({
      usage: { ...busySummary().usage!, blocked: 'planLimit' },
      drafts: {
        etsy: busySummary().drafts!.etsy,
        ebay: emptyBucket({ conflict: 2, draft: 1, firstConflict: { draftId: 'e1', listingId: 'SKU-1', title: 'Ebay Thing', thumb: null, error: null } }),
      },
    });
    const ids = kinds(s, {
      reconnect: [
        { provider: 'ebay', name: 'eBay', reason: 'refresh_token_expired' },
        { provider: 'etsy', name: 'Etsy', reason: null },
      ],
      syncFailures: [
        { id: 'n1', type: 'orderSyncFailed', titleKey: 'types.orderSyncFailed', params: { provider: 'Amazon' }, link: '/app/senkron', createdAt: '2026-10-15T06:00:00Z' },
      ],
    });
    expect(ids).toEqual([
      'paused',
      'reconnect:ebay',
      'reconnect:etsy',
      'syncFailing',
      'labelsFailed',
      'overdue',
      'conflict:etsy',
      'conflict:ebay',
      'sendFailed:etsy',
      'tracking',
      'notSent:etsy',
      'notSent:ebay',
      // blocked: the usage row (11) is replaced by the paused row (1); listing health hidden without a doctor link
    ]);
    const kindsSeen = buildAttentionRows(input(s)).rows.map((r) => ATTENTION_ORDER.indexOf(r.kind));
    expect([...kindsSeen].sort((a, b) => a - b)).toEqual(kindsSeen);
  });

  it('names the first item and counts the rest as "+N more"', () => {
    const rows = buildAttentionRows(input(busySummary())).rows;
    const labels = rows.find((r) => r.kind === 'labelsFailed')!;
    expect(labels.title).toEqual({ kind: 'raw', text: '#3891 Baby Blanket' });
    expect(labels.detail).toEqual({ kind: 'raw', text: '“FedEx: invalid postal code”' });
    expect(labels.more).toBe(1);
    const overdue = rows.find((r) => r.kind === 'overdue')!;
    expect(overdue.detail).toEqual({ kind: 'shipBy', date: '2026-10-14T08:00:00Z' });
    expect(overdue.more).toBe(1);
    const sendFailed = rows.find((r) => r.kind === 'sendFailed')!;
    expect(sendFailed.more).toBe(2);
    const notSent = rows.find((r) => r.kind === 'notSent')!;
    expect(notSent.title).toEqual({ kind: 'key', key: 'overview.attention.notSent.title', values: { count: 7, marketplace: 'Etsy' } });
  });

  it('falls back to a counted title when the server sent no first item', () => {
    const s = baseSummary({ labels: { failed: 3, first: null } });
    const row = buildAttentionRows(input(s)).rows[0];
    expect(row.title).toEqual({ kind: 'key', key: 'overview.attention.labelsFailed.title', values: { count: 3 } });
    expect(row.more).toBe(0);
  });

  it('paused: See plans normally, Contact support for hideBilling (shopify_free never sees Stripe)', () => {
    const blocked = (hideBilling: boolean) => baseSummary({ usage: { ...baseSummary().usage!, blocked: 'noSubscription', hideBilling } });
    const plain = buildAttentionRows(input(blocked(false))).rows[0];
    expect(plain.cta.href).toBe('/ayarlar?tab=billing');
    expect(plain.cta.label).toEqual({ kind: 'key', key: 'overview.attention.paused.cta' });
    expect(plain.title).toEqual({ kind: 'key', key: 'overview.attention.paused.title' });
    expect(plain.detail).toEqual({ kind: 'key', key: 'overview.attention.paused.reason', values: { reason: 'noSubscription' } });
    const free = buildAttentionRows(input(blocked(true))).rows[0];
    expect(free.cta.href).toBe(SUPPORT_HREF);
    expect(free.cta.label).toEqual({ kind: 'key', key: 'overview.attention.paused.supportCta' });
  });

  it('paused splits per meter: a trial with labels used up keeps order syncs (never "trial ended")', () => {
    const trialUsage = { ...baseSummary().usage!, plan: 'trial', status: 'trialing', trialEndsAt: '2026-11-01T00:00:00Z' };
    const labelsOnly = baseSummary({ usage: { ...trialUsage, orderSync: { used: 5, limit: 50 }, label: { used: 10, limit: 10 }, blocked: 'trial' } });
    expect(usagePause(labelsOnly.usage)).toEqual({ orderSync: false, label: true, reason: 'trial' });
    const row = buildAttentionRows(input(labelsOnly)).rows[0];
    expect(row.kind).toBe('paused');
    expect(row.title).toEqual({ kind: 'key', key: 'overview.attention.paused.titleLabels' });
    expect(row.detail).toEqual({ kind: 'key', key: 'overview.attention.usage.detail', values: { kind: 'label', used: 10, limit: 10 } });

    const syncsOnly = baseSummary({ usage: { ...trialUsage, orderSync: { used: 50, limit: 50 }, label: { used: 2, limit: 10 }, blocked: 'trial' } });
    expect(usagePause(syncsOnly.usage)).toEqual({ orderSync: true, label: false, reason: 'trial' });
    expect(buildAttentionRows(input(syncsOnly)).rows[0].title).toEqual({ kind: 'key', key: 'overview.attention.paused.titleOrderSync' });

    const both = baseSummary({ usage: { ...trialUsage, orderSync: { used: 50, limit: 50 }, label: { used: 10, limit: 10 }, blocked: 'trial' } });
    const bothRow = buildAttentionRows(input(both)).rows[0];
    expect(bothRow.title).toEqual({ kind: 'key', key: 'overview.attention.paused.title' });
    expect(bothRow.detail).toEqual({ kind: 'key', key: 'overview.attention.paused.limitReason', values: { reason: 'trial' } });

    expect(usagePause(baseSummary({ usage: { ...trialUsage, blocked: 'invalidPlan' } }).usage)).toEqual({ orderSync: true, label: true, reason: 'invalidPlan' });
    expect(usagePause(baseSummary().usage)).toEqual({ orderSync: false, label: false, reason: null });
    expect(usagePause(null)).toEqual({ orderSync: false, label: false, reason: null });
  });

  it('near-limit / trial-ending rows are hidden for hideBilling and while blocked', () => {
    const near = busySummary();
    expect(kinds(near)).toContain('usage');
    expect(kinds(busySummary({ usage: { ...near.usage!, hideBilling: true } }))).not.toContain('usage');
    const trial = baseSummary({ usage: { ...baseSummary().usage!, status: 'trialing', trialEndsAt: '2026-10-18T07:42:00Z' } });
    const row = buildAttentionRows(input(trial)).rows.find((r) => r.kind === 'usage')!;
    expect(row.pill).toEqual({ kind: 'status', domain: 'subscription', status: 'trial_ending' });
    expect(row.title).toEqual({ kind: 'key', key: 'overview.attention.trialEnds', values: { days: 3 } });
    const far = baseSummary({ usage: { ...baseSummary().usage!, status: 'trialing', trialEndsAt: '2026-11-15T07:42:00Z' } });
    expect(kinds(far)).not.toContain('usage');
  });

  it('near limit names the meter closest to its limit', () => {
    const row = buildAttentionRows(input(busySummary())).rows.find((r) => r.kind === 'usage')!;
    expect(row.title).toEqual({ kind: 'key', key: 'overview.attention.usage.detail', values: { kind: 'label', used: 9, limit: 10 } });
  });

  it('tracking: Review with the extension, Set up extension without it (or when unknown)', () => {
    const s = busySummary();
    const withExt = buildAttentionRows(input(s, { extensionDetected: true })).rows.find((r) => r.kind === 'tracking')!;
    expect(withExt.cta.href).toBe('/app/labels?label=labeled&mp=etsy&from=all');
    expect(withExt.pill).toEqual({ kind: 'status', domain: 'tracking', status: 'not_sent' });
    const without = buildAttentionRows(input(s, { extensionDetected: false })).rows.find((r) => r.kind === 'tracking')!;
    expect(without.cta.href).toBe(EXTENSION_SETUP_HREF);
    const unknown = buildAttentionRows(input(s, { extensionDetected: null })).rows.find((r) => r.kind === 'tracking')!;
    expect(unknown.cta.href).toBe(EXTENSION_SETUP_HREF);
    const failed = busySummary({ tracking: { notSent: 0, failed: 1, first: null } });
    expect(buildAttentionRows(input(failed)).rows.find((r) => r.kind === 'tracking')!.pill).toEqual({ kind: 'status', domain: 'tracking', status: 'send_failed' });
  });

  it('listing health shows only with a doctor link; label switches with the research flag', () => {
    expect(kinds(busySummary())).not.toContain('listingHealth');
    const m5 = buildAttentionRows(input(busySummary(), { flags: { 'listings-etsy': true } })).rows.find((r) => r.kind === 'listingHealth')!;
    expect(m5.cta.href).toBe('/app/etsy-listings?view=needs_work');
    expect(m5.cta.label).toEqual({ kind: 'key', key: 'overview.attention.health.ctaLegacy' });
    expect(m5.pill).toEqual({ kind: 'score', score: 22 });
    const r1 = buildAttentionRows(input(busySummary(), { flags: { research: true } })).rows.find((r) => r.kind === 'listingHealth')!;
    expect(r1.cta.href).toBe('/app/research/listings');
    expect(r1.cta.label).toEqual({ kind: 'key', key: 'overview.attention.health.cta' });
  });

  it('deep links follow the flags (legacy vs v2)', () => {
    const legacy = buildAttentionRows(input(busySummary())).rows;
    const v2 = buildAttentionRows(input(busySummary(), { flags: { orders: true, 'editor-etsy': true, 'listings-etsy': true } })).rows;
    const href = (rows: typeof legacy, id: string) => rows.find((r) => r.id === id)!.cta.href;
    expect(href(legacy, 'overdue')).toBe('/app/labels?q=114-0098&qt=order&label=all&from=all');
    expect(href(v2, 'overdue')).toBe('/app/labels?view=all&open=ord_1&panel=label');
    expect(href(legacy, 'labelsFailed')).toBe('/app/labels?label=failed&from=all');
    expect(href(v2, 'labelsFailed')).toBe('/app/labels?view=problems');
    expect(href(legacy, 'conflict:etsy')).toBe('/app/etsy-listings?open=111');
    expect(href(v2, 'conflict:etsy')).toBe('/app/etsy-listings/111');
    expect(href(legacy, 'notSent:etsy')).toBe('/app/etsy-listings');
    expect(href(v2, 'notSent:etsy')).toBe('/app/etsy-listings?view=not_sent');
  });

  it('partial errors are reported (queue sections only) and the queue is never "done"', () => {
    const s = baseSummary({ drafts: null, series: null, errors: ['drafts', 'series'] });
    const m = buildAttentionRows(input(s));
    expect(m.failedSections).toEqual(['drafts']);
    expect(queueState({ summary: s, wholeError: false, model: m, anyMarketplace: true, setupCardVisible: false })).toBe('doneWithErrors');
    const ok = buildAttentionRows(input(baseSummary()));
    expect(queueState({ summary: baseSummary(), wholeError: false, model: ok, anyMarketplace: true, setupCardVisible: false })).toBe('done');
  });

  it('not connected: rows 1–3 only', () => {
    const s = busySummary({ usage: { ...busySummary().usage!, blocked: 'noSubscription' } });
    const ids = kinds(s, { anyMarketplace: false, reconnect: [{ provider: 'etsy', name: 'Etsy' }] });
    expect(ids).toEqual(['paused', 'reconnect:etsy']);
    // Row 11 (near limit / trial ending) is not rendered without a store.
    expect(kinds(busySummary(), { anyMarketplace: false })).not.toContain('usage');
    const trial = baseSummary({ usage: { ...baseSummary().usage!, status: 'trialing', trialEndsAt: '2026-10-18T07:42:00Z' } });
    expect(kinds(trial, { anyMarketplace: false })).toEqual([]);
    const m = buildAttentionRows(input(baseSummary(), { anyMarketplace: false }));
    expect(queueState({ summary: baseSummary(), wholeError: false, model: m, anyMarketplace: false, setupCardVisible: false })).toBe('notConnected');
    expect(queueState({ summary: baseSummary(), wholeError: false, model: m, anyMarketplace: false, setupCardVisible: true })).toBe('done');
  });

  it('client-cache rows render while loading and after a whole failure', () => {
    const over = { reconnect: [{ provider: 'ebay', name: 'eBay', reason: 'reauth_required' }] };
    const loading = buildAttentionRows(input(undefined, over));
    expect(loading.rows.map((r) => r.id)).toEqual(['reconnect:ebay']);
    expect(loading.rows[0].detail).toEqual({ kind: 'key', key: 'overview.reason.reauth_required' });
    expect(loading.rows[0].cta.href).toBe('/ayarlar?tab=connections&provider=ebay');
    expect(queueState({ summary: undefined, wholeError: false, model: loading, anyMarketplace: true, setupCardVisible: false })).toBe('loading');
    expect(queueState({ summary: undefined, wholeError: true, model: loading, anyMarketplace: true, setupCardVisible: false })).toBe('error');
  });

  it('no orders yet → noOrders state', () => {
    const s = baseSummary({ setup: { hasOrders: false, senderComplete: true, hasLabel: false } });
    expect(queueState({ summary: s, wholeError: false, model: buildAttentionRows(input(s)), anyMarketplace: true, setupCardVisible: true })).toBe('noOrders');
  });

  it('sync failures: only unresolved orderSyncFailed, newest first, link fallback', () => {
    const m = buildAttentionRows(
      input(baseSummary(), {
        syncFailures: [
          { id: 'a', type: 'orderSyncFailed', titleKey: 'types.orderSyncFailed', params: { provider: 'Wix' }, link: null, createdAt: '2026-10-14T00:00:00Z' },
          { id: 'b', type: 'orderSyncFailed', titleKey: 'types.orderSyncFailed', params: { provider: 'Amazon' }, link: null, createdAt: '2026-10-15T00:00:00Z' },
          { id: 'c', type: 'orderSyncFailed', titleKey: 'types.orderSyncFailed', params: null, link: null, resolvedAt: '2026-10-15T01:00:00Z' },
          { id: 'd', type: 'reauthRequired', titleKey: 'types.reauthRequired', params: null, link: null },
        ],
      }),
    );
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].lead).toEqual({ kind: 'logo', brand: 'Amazon' });
    expect(m.rows[0].more).toBe(1);
    expect(m.rows[0].cta.href).toBe('/app/bildirimler');
  });
});

describe('helpers', () => {
  it('quoteError drops JSON and cuts to 80 chars', () => {
    expect(quoteError('{"error":"x"}')).toBeNull();
    expect(quoteError('  ')).toBeNull();
    const long = quoteError('x'.repeat(200))!;
    expect(long.length).toBe(82); // 80 + quotes
    expect(long.endsWith('…”')).toBe(true);
  });
  it('orderRefText does not double #', () => {
    expect(orderRefText({ orderNumber: '#12', itemName: 'Mug' })).toBe('#12 Mug');
    expect(orderRefText({ orderNumber: '12', itemName: null })).toBe('#12');
  });
  it('daysUntil rounds up and ignores the past', () => {
    expect(daysUntil('2026-10-15T08:00:00Z', NOW)).toBe(1);
    expect(daysUntil('2026-10-14T08:00:00Z', NOW)).toBeNull();
  });
});
