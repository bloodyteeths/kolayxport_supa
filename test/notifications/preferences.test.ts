import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({ default: {} }));

import { resolvePrefs, settingsFromRow, DEFAULT_SETTINGS, type UserNotificationConfig, type PrefRow } from '@/lib/notificationCenter/preferences';
import { buildPreferencesView, validatePreferencesPatch } from '@/lib/notificationCenter/preferencesService';
import { NOTIFICATION_REGISTRY, presetPrefs, getTypeDef } from '@/lib/notificationCenter/registry';

function cfg(over: Partial<UserNotificationConfig['settings']> = {}, rows: PrefRow[] = []): UserNotificationConfig {
  return { settings: { ...DEFAULT_SETTINGS, ...over }, rows: new Map(rows.map((r) => [r.type, r])) };
}

afterEach(() => {
  delete process.env.TELEGRAM_BOT_TOKEN;
});

describe('registry defaults (spec W5 T1)', () => {
  it('orderNew is activity-only; orderCanceled in-app only; stock-out is digest; dispatch risk emails', () => {
    const r = (t: string) => resolvePrefs(t, cfg(), { telegramConfigured: false });
    expect(r('orderNew')).toMatchObject({ badge: false, email: false });
    expect(r('orderCanceled')).toMatchObject({ inApp: true, badge: true, email: false });
    expect(r('orderCanceledAfterLabel')).toMatchObject({ email: true, emailMode: 'instant' });
    expect(r('dispatchOverdue')).toMatchObject({ email: true, emailMode: 'instant' });
    expect(r('dispatchDueToday')).toMatchObject({ email: true, emailMode: 'instant' });
    expect(r('dispatchDueTomorrow')).toMatchObject({ email: true, emailMode: 'digest' });
    expect(r('stockOutOfStock')).toMatchObject({ email: true, emailMode: 'digest' });
    expect(r('stockDrift')).toMatchObject({ inApp: true, email: false });
    expect(r('stockUnmatchedSale')).toMatchObject({ inApp: true, email: false });
    expect(r('orderShippedExternal')).toMatchObject({ badge: false, email: false });
    expect(r('listingChangedExternally')).toMatchObject({ inApp: false, badge: false });
    expect(r('orderSyncFailed')).toMatchObject({ inApp: true, email: false });
  });

  it('every NotificationType literal has a registry entry', () => {
    const types = [
      'draftSyncFailed', 'draftConflict', 'reauthRequired', 'orderSyncFailed', 'usageNearLimit', 'usageLimitReached',
      'orderNew', 'orderCanceled', 'orderCanceledAfterLabel', 'orderShippedExternal', 'dispatchDueTomorrow',
      'dispatchDueToday', 'dispatchOverdue', 'listingDeactivated', 'listingExpired', 'listingDeleted',
      'listingChangedExternally', 'stockOutOfStock', 'stockPushFailed', 'stockDrift', 'stockUnmatchedSale',
      'seoExperimentReady', 'scheduledSendResult', 'webhookBacklog',
      'researchShopNewListings', 'researchShopPriceDrop', 'researchShopSalesSpike',
    ];
    for (const t of types) expect(getTypeDef(t), t).toBeDefined();
    expect(NOTIFICATION_REGISTRY.length).toBe(types.length);
  });
});

describe('resolvePrefs resolution order', () => {
  it('type row > wildcard row > preset > registry default', () => {
    const typeRow: PrefRow = { type: 'orderNew', inApp: true, email: true, telegram: false, emailMode: 'digest' };
    const star: PrefRow = { type: '*', inApp: false, email: false, telegram: false, emailMode: 'instant' };
    const c = cfg({ preset: 'all' }, [typeRow, star]);
    expect(resolvePrefs('orderNew', c)).toMatchObject({ email: true, emailMode: 'digest', source: 'type' });
    expect(resolvePrefs('orderCanceled', c)).toMatchObject({ inApp: false, email: false, badge: false, source: 'wildcard' });
    const p = resolvePrefs('orderCanceled', cfg({ preset: 'all' }));
    expect(resolvePrefs('orderCanceled', cfg())).toMatchObject({ email: false, source: 'preset' });
    expect(p).toMatchObject({ inApp: true, email: true, source: 'preset' });
    expect(resolvePrefs('orderNew', cfg())).toMatchObject({ email: false, source: 'preset' });
  });

  it('critical preset: only error types notify; others are activity-only without email', () => {
    const c = cfg({ preset: 'critical' });
    expect(resolvePrefs('orderCanceledAfterLabel', c)).toMatchObject({ inApp: true, badge: true, email: true, emailMode: 'instant' });
    expect(resolvePrefs('orderNew', c)).toMatchObject({ inApp: false, badge: false, email: false });
    expect(resolvePrefs('dispatchOverdue', c)).toMatchObject({ email: false });
  });

  it('all preset keeps digest types on digest and never enables telegram', () => {
    const def = getTypeDef('listingExpired')!;
    expect(presetPrefs('all', def)).toEqual({ inApp: true, email: true, telegram: false, emailMode: 'digest' });
  });

  it('email master switch off disables email everywhere', () => {
    expect(resolvePrefs('dispatchOverdue', cfg()).email).toBe(true);
    expect(resolvePrefs('dispatchOverdue', cfg({ emailEnabled: false })).email).toBe(false);
  });

  it('telegram needs the bot token AND a linked chat', () => {
    const row: PrefRow = { type: 'orderNew', inApp: true, email: false, telegram: true, emailMode: 'instant' };
    expect(resolvePrefs('orderNew', cfg({}, [row])).telegram).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = 'x';
    expect(resolvePrefs('orderNew', cfg({}, [row])).telegram).toBe(false);
    expect(resolvePrefs('orderNew', cfg({ telegramChatId: '42' }, [row])).telegram).toBe(true);
  });

  it('caller badge:false wins for every type; badge:true cannot override the registry', () => {
    expect(resolvePrefs('somethingNew', cfg(), { callerBadge: false }).badge).toBe(false);
    expect(resolvePrefs('somethingNew', cfg()).badge).toBe(true);
    expect(resolvePrefs('draftSyncFailed', cfg(), { callerBadge: false }).badge).toBe(false);
    expect(resolvePrefs('draftSyncFailed', cfg()).badge).toBe(true);
    expect(resolvePrefs('orderShippedExternal', cfg(), { callerBadge: true }).badge).toBe(false);
  });

  it('settingsFromRow fills defaults (quiet 23–08 Europe/Istanbul)', () => {
    expect(settingsFromRow(null)).toMatchObject({ timezone: 'Europe/Istanbul', quietHoursStart: 23, quietHoursEnd: 8, emailEnabled: true, preset: 'recommended' });
  });
});

describe('preferences API helpers', () => {
  it('view hides admin-only types from non-admins', () => {
    expect(buildPreferencesView(cfg(), false).types.some((t) => t.type === 'webhookBacklog')).toBe(false);
    expect(buildPreferencesView(cfg(), true).types.some((t) => t.type === 'webhookBacklog')).toBe(true);
  });

  it('validates types against the registry and settings ranges', () => {
    expect(validatePreferencesPatch({ types: [{ type: 'nope', email: true }] }, false).ok).toBe(false);
    expect(validatePreferencesPatch({ types: [{ type: 'webhookBacklog', email: true }] }, false).ok).toBe(false);
    expect(validatePreferencesPatch({ types: [{ type: 'webhookBacklog', email: true }] }, true).ok).toBe(true);
    expect(validatePreferencesPatch({ settings: { quietHoursStart: 24 } }, false).ok).toBe(false);
    expect(validatePreferencesPatch({ settings: { timezone: 'Mars/Base' } }, false).ok).toBe(false);
    expect(validatePreferencesPatch({ preset: 'custom' }, false).ok).toBe(false);
    const ok = validatePreferencesPatch(
      { preset: 'critical', settings: { locale: 'EN', timezone: 'America/New_York', quietHoursStart: null, digestHour: 9 }, types: [{ type: 'orderNew', emailMode: 'digest' }] },
      false,
    );
    expect(ok).toEqual({
      ok: true,
      patch: {
        preset: 'critical',
        settings: { locale: 'en', timezone: 'America/New_York', quietHoursStart: null, digestHour: 9 },
        types: [{ type: 'orderNew', emailMode: 'digest' }],
      },
    });
  });
});
