// Group C pure logic: usage model, account banner state, breadcrumb collapsing, badge helpers.
import { describe, expect, it } from 'vitest';
import { deriveShellUsage, type ShellSubscription } from '@/components/ds/shell/SideNavFooter';
import { accountBannerState } from '@/components/ds/shell/AccountBanner';
import { visibleCrumbs } from '@/components/ds/shell/Breadcrumbs';
import { notificationBadgeTone } from '@/components/ds/shell/NotificationsButton';
import { formatNavCount, itemDetail, itemShortcut } from '@/components/ds/shell/SideNavItem';
import { pageShortcutRows } from '@/components/ds/shell/ShortcutSheet';

const NOW = new Date('2026-10-15T12:00:00Z');
const sub = (over: Partial<ShellSubscription>): ShellSubscription => ({
  subscriptionPlan: 'trial',
  subscriptionStatus: 'trialing',
  trialExpiresAt: '2026-10-27T12:00:00Z',
  usageResetAt: null,
  orderSyncCount: 32,
  labelCount: 7,
  ...over,
}) as ShellSubscription;

describe('deriveShellUsage', () => {
  it('trial: days left and both meters with the server limits', () => {
    const u = deriveShellUsage(sub({ limits: { orderSync: 50, label: 10 }, period: 'trial' }), NOW)!;
    expect(u.state).toBe('trial');
    expect(u.planKey).toBe('trial');
    expect(u.trialDaysLeft).toBe(12);
    expect(u.meters).toEqual([
      { kind: 'label', used: 7, limit: 10 },
      { kind: 'orderSync', used: 32, limit: 50 },
    ]);
    expect(u.blocked).toBeNull();
    expect(u.limitReached).toBeNull();
    expect(u.nearLimit).toBeNull();
  });

  it('falls back to the enforced table when the payload has no `limits` (no hard-coded numbers in UI)', () => {
    const u = deriveShellUsage(sub({}), NOW)!;
    expect(u.meters.map((m) => m.limit)).toEqual([10, 50]);
  });

  it('near and over the limit', () => {
    const near = deriveShellUsage(sub({ labelCount: 9, limits: { orderSync: 50, label: 10 } }), NOW)!;
    expect(near.nearLimit).toEqual({ kind: 'label', used: 9, limit: 10 });
    expect(near.limitReached).toBeNull();
    const over = deriveShellUsage(sub({ labelCount: 10, limits: { orderSync: 50, label: 10 } }), NOW)!;
    expect(over.limitReached).toEqual({ kind: 'label', used: 10, limit: 10 });
  });

  it('trial date passed → blocked trialEnded, no meters', () => {
    const u = deriveShellUsage(sub({ trialExpiresAt: '2026-10-01T00:00:00Z' }), NOW)!;
    expect(u.blocked).toBe('trialEnded');
    expect(u.meters).toEqual([]);
  });

  it('canceled paid plan → blocked noPlan', () => {
    expect(deriveShellUsage(sub({ subscriptionPlan: 'starter', subscriptionStatus: 'canceled' }), NOW)!.blocked).toBe('noPlan');
  });

  it('active but unknown plan (invalidPlan) is not shown as "no plan" to a paying user', () => {
    const u = deriveShellUsage(sub({ subscriptionPlan: 'pro' as never, subscriptionStatus: 'active' }), NOW)!;
    expect(u.state).toBe('invalidPlan');
    expect(u.blocked).toBeNull();
  });

  it('active starter: month period, reset date', () => {
    const u = deriveShellUsage(
      sub({ subscriptionPlan: 'starter', subscriptionStatus: 'active', usageResetAt: '2026-11-01T00:00:00Z', limits: { orderSync: 200, label: 100 }, period: 'month' }),
      NOW,
    )!;
    expect(u.planKey).toBe('starter');
    expect(u.resetsAt).toBe('2026-11-01T00:00:00Z');
    expect(u.meters.map((m) => m.limit)).toEqual([100, 200]);
  });

  it('shopify_free (plan or billing provider) and enterprise are unlimited, never blocked', () => {
    const a = deriveShellUsage(sub({ subscriptionPlan: 'shopify_free', subscriptionStatus: null }), NOW)!;
    expect(a).toMatchObject({ unlimited: true, planKey: 'shopifyFree', blocked: null, meters: [] });
    const b = deriveShellUsage(sub({ subscriptionPlan: 'trial', subscriptionStatus: 'canceled', billingProvider: 'shopify_free' }), NOW)!;
    expect(b).toMatchObject({ state: 'shopify_free', blocked: null });
    const e = deriveShellUsage(sub({ subscriptionPlan: 'enterprise', subscriptionStatus: 'active', limits: { orderSync: null, label: null } }), NOW)!;
    expect(e).toMatchObject({ unlimited: true, planKey: 'enterprise', meters: [] });
  });

  it('no subscription block → null', () => {
    expect(deriveShellUsage(null)).toBeNull();
    expect(deriveShellUsage(undefined)).toBeNull();
  });
});

describe('accountBannerState', () => {
  it('maps blocked and limit states; never for Shopify-free', () => {
    expect(accountBannerState(deriveShellUsage(sub({ trialExpiresAt: '2026-10-01T00:00:00Z' }), NOW))).toEqual({ kind: 'trialEnded' });
    expect(accountBannerState(deriveShellUsage(sub({ subscriptionPlan: 'growth', subscriptionStatus: 'past_due' }), NOW))).toEqual({ kind: 'noPlan' });
    expect(accountBannerState(deriveShellUsage(sub({ labelCount: 10, limits: { orderSync: 50, label: 10 } }), NOW))).toEqual({
      kind: 'limitReached',
      meter: 'label',
      limit: 10,
    });
    expect(accountBannerState(deriveShellUsage(sub({ subscriptionPlan: 'shopify_free', subscriptionStatus: null }), NOW))).toBeNull();
    expect(accountBannerState(deriveShellUsage(sub({}), NOW))).toBeNull();
    expect(accountBannerState(null)).toBeNull();
    expect(accountBannerState(undefined)).toBeNull();
  });
});

describe('visibleCrumbs', () => {
  const c = (label: string) => ({ label });
  it('keeps ≤ 3 crumbs as they are', () => {
    expect(visibleCrumbs([c('a'), c('b'), c('c')]).map((v) => (v.kind === 'crumb' ? v.crumb.label : '…'))).toEqual(['a', 'b', 'c']);
  });
  it('collapses the middle to "…" past 3', () => {
    expect(visibleCrumbs([c('a'), c('b'), c('c'), c('d'), c('e')]).map((v) => (v.kind === 'crumb' ? v.crumb.label : '…'))).toEqual([
      'a',
      '…',
      'd',
      'e',
    ]);
  });
});

describe('badge helpers', () => {
  it('formatNavCount caps at 99+', () => {
    expect(formatNavCount(12)).toBe('12');
    expect(formatNavCount(99)).toBe('99');
    expect(formatNavCount(100)).toBe('99+');
  });
  it('itemDetail joins dot and count sentences; itemShortcut prints the g chord', () => {
    expect(itemDetail({ dotLabel: 'Trendyol needs reconnecting', countLabel: undefined })).toBe('Trendyol needs reconnecting');
    expect(itemDetail({ dotLabel: undefined, countLabel: '12 to ship · 1 overdue' })).toBe('12 to ship · 1 overdue');
    expect(itemShortcut({ gKey: 'o' })).toBe('G O');
    expect(itemShortcut({ gKey: undefined })).toBeUndefined();
  });
  it('bell pill turns danger only for an unread error', () => {
    expect(notificationBadgeTone([{ readAt: null, severity: 'warning' }])).toBe('neutral');
    expect(notificationBadgeTone([{ readAt: '2026-10-15', severity: 'error' }])).toBe('neutral');
    expect(notificationBadgeTone([{ readAt: null, severity: 'error' }])).toBe('danger');
    // Activity-only rows never count toward the badge, so they never turn it red either.
    expect(notificationBadgeTone([{ readAt: null, severity: 'error', badge: false }])).toBe('neutral');
    expect(notificationBadgeTone([{ readAt: null, severity: 'error', badge: true }])).toBe('danger');
  });
  it('page shortcut rows drop global combos and duplicates', () => {
    expect(
      pageShortcutRows([
        { combo: 'j', description: 'Next', scope: 'page' },
        { combo: 'j', description: 'Next again', scope: 'page' },
        { combo: '?', description: 'Help', scope: 'page' },
        { combo: 'mod+k', description: 'Palette', scope: 'global' },
      ]),
    ).toEqual([{ combo: 'j', description: 'Next', scope: 'page' }]);
  });
});
