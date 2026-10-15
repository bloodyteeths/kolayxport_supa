// @vitest-environment jsdom
// Settings Group A — useSettings slice API (settings §17 tests: "PATCH body only carries the slice keys,
// masks stripped").
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

const http = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));
vi.mock('axios', () => ({ default: { get: http.get, patch: http.patch, isAxiosError: () => false } }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }));

import { buildSlicePatch, sliceDiffers, useSettings, type UserSettingsResponse } from '@/lib/hooks/useSettings';

const SERVER: UserSettingsResponse = {
  integrationSettings: { trendyolApiKey: '••••1234', trendyolApiSecret: '••••abcd', trendyolSupplierId: '123', fedexApiKey: '••••9999', fedexAccountNumber: null },
  shipperProfile: { shipperName: 'Modsons', shipperCity: 'İstanbul', shipperStreet2: null },
  shippingSettings: { etgbEnabled: true, etgbRecipientEmail: 'a@b.co', packagePresets: [{ id: 'p1' }] },
  subscription: {
    subscriptionPlan: 'growth', subscriptionStatus: 'active', billingInterval: 'month', billingProvider: 'stripe',
    trialExpiresAt: null, usageResetAt: null, orderSyncCount: 10, labelCount: 2,
  },
};

beforeEach(() => {
  http.get.mockReset();
  http.patch.mockReset();
  http.get.mockResolvedValue({ data: structuredClone(SERVER) });
  http.patch.mockResolvedValue({ data: { ok: true } });
});
afterEach(cleanup);

describe('buildSlicePatch (pure)', () => {
  it('carries only the named slice and strips masks', () => {
    const body = buildSlicePatch({ ...SERVER, integrationSettings: { ...SERVER.integrationSettings, trendyolApiSecret: 'new-secret' } }, ['integrationSettings']);
    expect(Object.keys(body)).toEqual(['integrationSettings']);
    expect(body.integrationSettings).toEqual({ trendyolApiSecret: 'new-secret', trendyolSupplierId: '123', fedexAccountNumber: null });
  });
  it('limits integrationSettings to `fields`; masks still stripped; missing fields omitted', () => {
    const form = { ...SERVER, integrationSettings: { ...SERVER.integrationSettings, trendyolApiSecret: 'n' } };
    expect(buildSlicePatch(form, ['integrationSettings'], ['trendyolApiKey', 'trendyolApiSecret', 'trendyolSupplierId', 'notThere'])).toEqual({
      integrationSettings: { trendyolApiSecret: 'n', trendyolSupplierId: '123' },
    });
  });
  it('sends shippingSettings whole (the server replaces the JSON column)', () => {
    const body = buildSlicePatch(SERVER, ['shipperProfile', 'shippingSettings'], ['shipperName']);
    expect(body).toEqual({ shipperProfile: { shipperName: 'Modsons' }, shippingSettings: SERVER.shippingSettings });
  });
  it('a shipperProfile field-subset save keeps the saved defaultWeightKg (the server nulls it when absent)', () => {
    const saved: UserSettingsResponse = { shipperProfile: { shipperName: 'Modsons', defaultWeightKg: '0.5' } };
    const form: UserSettingsResponse = { shipperProfile: { shipperName: 'New', defaultWeightKg: '9' } };
    expect(buildSlicePatch(form, ['shipperProfile'], ['shipperName'], saved)).toEqual({ shipperProfile: { shipperName: 'New', defaultWeightKg: '0.5' } });
    expect(buildSlicePatch(form, ['shipperProfile'], ['shipperName', 'defaultWeightKg'], saved)).toEqual({ shipperProfile: { shipperName: 'New', defaultWeightKg: '9' } });
    expect(buildSlicePatch({ shipperProfile: { shipperName: 'New' } }, ['shipperProfile'], ['shipperName'], { shipperProfile: {} })).toEqual({ shipperProfile: { shipperName: 'New' } });
  });
  it('sliceDiffers: a missing etgbEnabled equals false (toggle on then off is clean)', () => {
    expect(sliceDiffers({ shippingSettings: { etgbEnabled: false } }, { shippingSettings: {} }, 'shippingSettings')).toBe(false);
    expect(sliceDiffers({ shippingSettings: { etgbEnabled: true } }, { shippingSettings: {} }, 'shippingSettings')).toBe(true);
  });
  it('preferences carry only the timezone', () => {
    expect(buildSlicePatch({ preferences: { timezone: '' } }, ['preferences'])).toEqual({ preferences: { timezone: null } });
  });
  it('sliceDiffers treats ""/null/undefined as equal', () => {
    expect(sliceDiffers({ shipperProfile: { a: '' } }, { shipperProfile: { a: null } }, 'shipperProfile')).toBe(false);
    expect(sliceDiffers({ shipperProfile: { a: 'x' } }, { shipperProfile: {} }, 'shipperProfile')).toBe(true);
    expect(sliceDiffers({ shipperProfile: { a: 'x', b: '1' } }, { shipperProfile: { b: '1' } }, 'shipperProfile', ['b'])).toBe(false);
  });
});

describe('useSettings slice API', () => {
  async function loaded() {
    const r = renderHook(() => useSettings());
    await waitFor(() => expect(r.result.current.initialDataLoaded).toBe(true));
    return r;
  }

  it('loads clean, tracks dirty slices and sections', async () => {
    const { result } = await loaded();
    expect(result.current.isDirty).toBe(false);
    expect(result.current.preferencesSupported).toBe(false);
    act(() => result.current.handleInputChange('shipperProfile', 'shipperName', 'Other'));
    expect(result.current.isSliceDirty('shipperProfile')).toBe(true);
    expect(result.current.isSliceDirty(['integrationSettings'])).toBe(false);
    expect(result.current.dirtySlices).toEqual(['shipperProfile']);
    expect(result.current.dirtySections).toEqual(['senderProfile']);
    act(() => result.current.handleInputChange('shipperProfile', 'shipperName', 'Modsons'));
    expect(result.current.isDirty).toBe(false);
  });

  it('saveSlice PATCHes only the slice fields; others stay dirty; masks never sent', async () => {
    const { result } = await loaded();
    act(() => {
      result.current.setField('integrationSettings', 'trendyolApiSecret', 'plain-secret');
      result.current.setField('integrationSettings', 'fedexAccountNumber', '5678');
      result.current.setField('shipperProfile', 'shipperCity', 'Ankara');
    });
    let res: Awaited<ReturnType<typeof result.current.saveSlice>> | undefined;
    await act(async () => {
      res = await result.current.saveSlice('integrationSettings', ['trendyolApiKey', 'trendyolApiSecret', 'trendyolSupplierId']);
    });
    expect(res).toEqual({ ok: true });
    expect(http.patch).toHaveBeenCalledTimes(1);
    expect(http.patch.mock.calls[0][1]).toEqual({ integrationSettings: { trendyolApiSecret: 'plain-secret', trendyolSupplierId: '123' } });
    expect(result.current.isSliceDirty('integrationSettings', ['trendyolApiSecret'])).toBe(false);
    expect(result.current.isSliceDirty('integrationSettings', ['fedexAccountNumber'])).toBe(true);
    expect(result.current.isSliceDirty('shipperProfile')).toBe(true);
    expect(result.current.savedRef.current.integrationSettings?.trendyolApiSecret).toBe('plain-secret');
  });

  it('saveSlice failure returns status + machine code only, form stays dirty', async () => {
    const { result } = await loaded();
    http.patch.mockRejectedValueOnce({ response: { status: 402, data: { reason: 'store_limit', error: 'Raw <b>text</b>' } } });
    act(() => result.current.setField('shipperProfile', 'shipperCity', 'Ankara'));
    let res: unknown;
    await act(async () => { res = await result.current.saveSlice(['shipperProfile', 'shippingSettings']); });
    expect(res).toEqual({ ok: false, status: 402, code: 'store_limit' });
    expect(result.current.isSliceDirty('shipperProfile')).toBe(true);

    http.patch.mockRejectedValueOnce({ response: { status: 500, data: { error: 'Prisma P2002 boom' } } });
    await act(async () => { res = await result.current.saveSlice('shipperProfile'); });
    expect(res).toEqual({ ok: false, status: 500, code: undefined });

    // this endpoint's own 400 carries its machine code in `error`
    http.patch.mockRejectedValueOnce({ response: { status: 400, data: { error: 'invalid_preferences', fields: ['timezone'] } } });
    await act(async () => { res = await result.current.saveSlice('shipperProfile'); });
    expect(res).toEqual({ ok: false, status: 400, code: 'invalid_preferences' });

    http.patch.mockRejectedValueOnce(new Error('Network Error'));
    await act(async () => { res = await result.current.saveSlice('shipperProfile'); });
    expect(res).toEqual({ ok: false, code: 'network' });
  });

  it('preferences are not sent until the server returns them', async () => {
    const { result } = await loaded();
    let res: unknown;
    await act(async () => { res = await result.current.saveSlice('preferences'); });
    expect(res).toEqual({ ok: false, code: 'unsupported' });
    expect(http.patch).not.toHaveBeenCalled();
  });

  it('discard resets a slice (or some fields) to the saved values', async () => {
    const { result } = await loaded();
    act(() => {
      result.current.setField('shipperProfile', 'shipperName', 'X');
      result.current.setField('shipperProfile', 'shipperCity', 'Y');
    });
    act(() => result.current.discard('shipperProfile', ['shipperName']));
    expect(result.current.formData.shipperProfile?.shipperName).toBe('Modsons');
    expect(result.current.formData.shipperProfile?.shipperCity).toBe('Y');
    act(() => result.current.discard(['shipperProfile']));
    expect(result.current.isDirty).toBe(false);
  });

  it('refetch keeps unsaved edits and refreshes clean slices (masked secrets come back)', async () => {
    const { result } = await loaded();
    act(() => result.current.setField('shipperProfile', 'shipperCity', 'Ankara'));
    http.get.mockResolvedValueOnce({
      data: { ...structuredClone(SERVER), integrationSettings: { ...SERVER.integrationSettings, fedexAccountNumber: '••••5678' }, preferences: { timezone: 'Europe/Berlin' } },
    });
    await act(async () => { await result.current.refetch(); });
    expect(result.current.formData.shipperProfile?.shipperCity).toBe('Ankara');
    expect(result.current.formData.integrationSettings?.fedexAccountNumber).toBe('••••5678');
    expect(result.current.formData.preferences?.timezone).toBe('Europe/Berlin');
    expect(result.current.preferencesSupported).toBe(true);
    expect(result.current.isSliceDirty('shipperProfile')).toBe(true);
  });

  it('load failure exposes loadFailed', async () => {
    http.get.mockRejectedValueOnce(new Error('500'));
    const { result } = renderHook(() => useSettings());
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.loadFailed).toBe(true);
    expect(result.current.fetchError).toBe('settingsLoadError');
  });
});
