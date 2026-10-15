// lib/shipping/useSenderProfile.ts — the From section and the panel's settings slice (orders §6.3, §7.3):
// `GET /api/user/settings` → `shipperProfile`, `shippingSettings` (ETGB, package presets), `subscription`.
// One SWR key shared with the settings surface (`/api/user/settings`), so a change there shows here.
import useSWR from 'swr';
import { useMemo } from 'react';
import { senderMissing } from './validate';
import { senderCountry, toIso2, type PackagePreset, type SenderProfile } from './labelDraft';

export const USER_SETTINGS_KEY = '/api/user/settings';

export interface ShippingSettingsJson {
  etgbEnabled?: boolean;
  etgbRecipientEmail?: string | null;
  packagePresets?: PackagePreset[];
  [key: string]: unknown;
}

export interface UserSettingsSlice {
  shipperProfile?: SenderProfile | null;
  shippingSettings?: ShippingSettingsJson | null;
  subscription?: { subscriptionPlan?: string | null; billingProvider?: string | null } | null;
}

export async function fetchUserSettings(url: string = USER_SETTINGS_KEY): Promise<UserSettingsSlice> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) {
    const err = new Error(`settings ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Account base currency: the sender profile's currency, else TRY for a TR sender, else USD. */
export function baseCurrencyOf(sender: SenderProfile | null | undefined): string {
  const c = (sender?.defaultCurrencyCode || '').trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(c)) return c;
  return senderCountry(sender) === 'TR' ? 'TRY' : 'USD';
}

/** One line for the From summary: "Belle Couture Gifts · Tamer S. · Atatürk Cad. 12, Nilüfer, Bursa 16110 TR · +90 532 …". */
export function senderSummary(sender: SenderProfile | null | undefined): string {
  if (!sender) return '';
  const addr = [
    sender.shipperStreet1, sender.shipperStreet2,
    [sender.shipperCity, sender.shipperStateCode, sender.shipperPostalCode].filter(Boolean).join(' '),
    toIso2(sender.shipperCountryCode),
  ].map((v) => (v || '').toString().trim()).filter(Boolean).join(', ');
  return [sender.shipperName, sender.shipperPersonName, addr, sender.shipperPhoneNumber]
    .map((v) => (v || '').toString().trim()).filter(Boolean).join(' · ');
}

export interface UseSenderProfile {
  sender: SenderProfile | null;
  shippingSettings: ShippingSettingsJson;
  /** Missing required sender fields (§6.3). */
  missing: string[];
  complete: boolean;
  senderCountry: string;
  baseCurrency: string;
  etgbEnabled: boolean;
  etgbEmail: string | null;
  /** shopify_free accounts never see Stripe upsells ("See plans" hidden). */
  stripeUpsell: boolean;
  state: 'loading' | 'ready' | 'error';
  error: unknown;
  mutate: () => Promise<unknown>;
}

export function useSenderProfile(enabled = true): UseSenderProfile {
  const { data, error, isLoading, mutate } = useSWR<UserSettingsSlice>(enabled ? USER_SETTINGS_KEY : null, fetchUserSettings, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
    keepPreviousData: true,
  });
  return useMemo(() => {
    const sender = (data?.shipperProfile as SenderProfile | null | undefined) ?? null;
    const shippingSettings = (data?.shippingSettings ?? {}) as ShippingSettingsJson;
    const missing = senderMissing(sender);
    const plan = data?.subscription?.subscriptionPlan;
    const provider = data?.subscription?.billingProvider;
    return {
      sender,
      shippingSettings,
      missing,
      complete: missing.length === 0,
      senderCountry: senderCountry(sender) || 'TR',
      baseCurrency: baseCurrencyOf(sender),
      etgbEnabled: !!shippingSettings.etgbEnabled,
      etgbEmail: (shippingSettings.etgbRecipientEmail || '').trim() || null,
      stripeUpsell: plan !== 'shopify_free' && provider !== 'shopify_free',
      state: data ? 'ready' : error ? 'error' : isLoading || enabled ? 'loading' : 'ready',
      error,
      mutate: () => mutate(),
    };
  }, [data, error, isLoading, enabled, mutate]);
}

export default useSenderProfile;
