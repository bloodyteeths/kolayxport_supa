// lib/settings/accountTimezone.ts — account timezone for `/api/user/settings` (settings §2.3 A6).
//
// BUILD_PLAN BR-2 / D-T1: the account timezone is the existing `NotificationSettings.timezone`
// (default `Europe/Istanbul`), so no `User.timezone` column or migration is added. The same value is
// read/written by `/api/notifications/preferences` (`settings.timezone`); both routes share one row.
import { DEFAULT_TIMEZONE, isValidTimezone } from '@/lib/notificationCenter/time';

export const ACCOUNT_DEFAULT_TIMEZONE = DEFAULT_TIMEZONE;

/**
 * Any zone `Intl.DateTimeFormat` can construct — the same rule as `/api/notifications/preferences`
 * (`preferencesService` → `isValidTimezone`), since both routes write `NotificationSettings.timezone`.
 * No `Intl.supportedValuesOf('timeZone')` membership check: Node/ICU lists legacy IDs only
 * (Asia/Calcutta, Europe/Kiev) and would reject current IANA names browsers offer (Asia/Kolkata, Europe/Kyiv).
 */
export function isAccountTimezone(tz: unknown): tz is string {
  return isValidTimezone(tz);
}

export type PreferencesPatchResult =
  | { ok: true; patch: { timezone: string } | null }
  | { ok: false; fields: string[] };

/**
 * Pure: the PATCH body's `preferences` value → what to write.
 *   undefined → nothing (patch null) · { timezone: null } → reset to Europe/Istanbul ·
 *   { timezone: '<IANA>' } → that zone · { } → nothing · anything else → 400 fields.
 */
export function parsePreferencesPatch(raw: unknown): PreferencesPatchResult {
  if (raw === undefined) return { ok: true, patch: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, fields: ['preferences'] };
  const p = raw as Record<string, unknown>;
  if (!('timezone' in p) || p.timezone === undefined) return { ok: true, patch: null };
  if (p.timezone === null || p.timezone === '') return { ok: true, patch: { timezone: ACCOUNT_DEFAULT_TIMEZONE } };
  if (isAccountTimezone(p.timezone)) return { ok: true, patch: { timezone: p.timezone } };
  return { ok: false, fields: ['preferences.timezone'] };
}
