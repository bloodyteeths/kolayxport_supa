// components/domain/settings/PreferencesPanel.tsx — Settings › Preferences (`?tab=preferences`, settings §7).
// Language applies at once (useLocaleStore, same as the account menu). Timezone is the account timezone
// (BUILD_PLAN BR-2 / D-T1 = NotificationSettings.timezone), read and written through the existing
// GET/PUT /api/notifications/preferences (`settings.timezone`), so no new column or endpoint is needed.
// Also holds the "Notification settings ›" row (BUILD_PLAN §7 item 12).
import { useCallback, useEffect, useMemo, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { useTranslations } from 'next-intl';
import { Button, Combobox, SegmentedControl, type ComboboxOption } from '@/components/ds/inputs';
import { Section, StickyActionBar } from '@/components/ds/page';
import { ErrorState, PanelSkeleton } from '@/components/ds/state';
import { useToast } from '@/components/ds/feedback';
import { icons } from '@/lib/ds/icons';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { DEFAULT_TIME_ZONE } from '@/lib/format';
import useLocaleStore, { type AppLocale } from '@/lib/stores/useLocaleStore';
import { USER_SETTINGS_KEY } from '@/lib/shipping/useSenderProfile';
import { PanelHeading, SettingsRow } from './sender';

/** Same SWR key as the notification-center preferences panel, so both views share one cache entry. */
export const PREFERENCES_API = '/api/notifications/preferences';
export const NOTIFICATION_SETTINGS_HREF = '/app/bildirimler?tab=preferences';
/** Language names in their own language (same as the account menu / MoreSheet); never translated. */
const LOCALE_ENDONYMS: Record<AppLocale, string> = { en: 'English', tr: 'Türkçe' };

interface PreferencesSnapshot {
  settings?: { timezone?: string | null; locale?: string | null } | null;
}

// ── pure helpers (unit-tested) ────────────────────────────────────────────────────────────────────

/** IANA zones the browser knows; always contains Europe/Istanbul and UTC. */
export function listTimeZones(): string[] {
  let zones: string[] = [];
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    zones = typeof fn === 'function' ? fn('timeZone') : [];
  } catch {
    zones = [];
  }
  const set = new Set(zones);
  set.add(DEFAULT_TIME_ZONE);
  set.add('UTC');
  return Array.from(set).sort();
}

/** "GMT+3" for the zone at `now` ("GMT" for UTC). Empty string if the runtime cannot tell. */
export function gmtOffset(zone: string, now: Date = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
}

/** "Europe/Istanbul (GMT+3)"; underscores read as spaces ("America/New York (GMT-4)"). */
export function timeZoneLabel(zone: string, now: Date = new Date()): string {
  const name = zone.replace(/_/g, ' ');
  const off = gmtOffset(zone, now);
  return off ? `${name} (${off})` : name;
}

/** Stored value → effective zone (null / unknown = Europe/Istanbul). */
export function effectiveTimeZone(stored: string | null | undefined, known?: readonly string[]): string {
  if (!stored) return DEFAULT_TIME_ZONE;
  if (known && known.length && !known.includes(stored)) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: stored }); return stored; } catch { return DEFAULT_TIME_ZONE; }
  }
  return stored;
}

async function fetchPreferences(url: string): Promise<PreferencesSnapshot> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`preferences_${res.status}`);
  return (await res.json()) as PreferencesSnapshot;
}

// ── component ─────────────────────────────────────────────────────────────────────────────────────

export interface PreferencesPanelProps {
  /** Default true: section title + description (settings §1.3). */
  heading?: boolean;
  /** Reports the unsaved-timezone state (for the nav dot and the unsaved-changes guard). */
  onDirtyChange?: (dirty: boolean) => void;
}

export function PreferencesPanel({ heading = true, onDirtyChange }: PreferencesPanelProps) {
  const t = useTranslations('settings.preferences');
  const tBar = useTranslations('settings.saveBar');
  const toast = useToast();
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const { data, error, isLoading, mutate } = useSWR<PreferencesSnapshot>(PREFERENCES_API, fetchPreferences, { revalidateOnFocus: false });
  const { mutate: globalMutate } = useSWRConfig();
  const zones = useMemo(() => listTimeZones(), []);
  const saved = effectiveTimeZone(data?.settings?.timezone, zones);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const current = draft ?? saved;
  const dirty = draft !== null && draft !== saved;

  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const options: ComboboxOption[] = useMemo(() => {
    const now = new Date();
    const list = zones.includes(current) ? zones : [current, ...zones];
    return list.map((z) => ({ value: z, label: timeZoneLabel(z, now) }));
  }, [zones, current]);
  const selected = options.find((o) => o.value === current) ?? null;

  const save = useCallback(async () => {
    if (!dirty || saving || draft === null) return;
    setSaving(true);
    try {
      const res = await fetch(PREFERENCES_API, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { timezone: draft } }),
      });
      if (!res.ok) throw new Error(`preferences_${res.status}`);
      const next = (await res.json()) as PreferencesSnapshot;
      await mutate(next, { revalidate: false });
      // The account timezone is also served by /api/user/settings (preferences.timezone, same row), which feeds
      // the app-level FormatProvider: revalidate it so dates switch zone without a reload (settings §7).
      void globalMutate(USER_SETTINGS_KEY);
      setDraft(null);
      toast.success(t('saved'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [dirty, saving, draft, mutate, globalMutate, toast, t]);

  useShortcuts({ 'mod+s': { handler: () => { void save(); }, allowInInput: true, enabled: dirty } }, { scope: 'page' });

  const tzState: 'loading' | 'error' | 'ready' = data ? 'ready' : error ? 'error' : isLoading ? 'loading' : 'loading';

  return (
    <div data-testid="preferences-panel">
      {heading ? <PanelHeading title={t('title')} description={t('description')} /> : null}
      <Section variant="card" id="preferences-region">
        <SettingsRow label={t('language')} helper={t('languageHelp')} data-testid="preferences-row-language">
          {() => (
            <SegmentedControl<AppLocale>
              aria-label={t('language')}
              value={locale}
              onChange={(v) => setLocale(v)}
              options={[
                { value: 'en', label: LOCALE_ENDONYMS.en },
                { value: 'tr', label: LOCALE_ENDONYMS.tr },
              ]}
              size="md"
              data-testid="preferences-language"
            />
          )}
        </SettingsRow>
        {tzState === 'ready' ? (
          <SettingsRow label={t('timezone')} helper={t('timezoneHelp')} data-testid="preferences-row-timezone">
            {(id) => (
              <Combobox
                id={id}
                value={selected}
                onChange={(o) => { if (o) setDraft(o.value === saved ? null : o.value); }}
                options={options}
                placeholder={timeZoneLabel(DEFAULT_TIME_ZONE)}
                data-testid="preferences-timezone"
              />
            )}
          </SettingsRow>
        ) : tzState === 'loading' ? (
          <PanelSkeleton sections={1} data-testid="preferences-timezone-skeleton" />
        ) : (
          <ErrorState variant="inline" title={t('loadFailed')} onRetry={() => { void mutate(); }} />
        )}
        <SettingsRow label={t('notifications')} bare data-testid="preferences-row-notifications">
          {() => (
            <Button variant="secondary" size="sm" href={NOTIFICATION_SETTINGS_HREF} trailingIcon={icons.next} data-testid="preferences-notifications-link">
              {t('notificationsLink')}
            </Button>
          )}
        </SettingsRow>
      </Section>

      <StickyActionBar
        visible={dirty}
        ariaLabel={t('title')}
        status={tBar('status')}
        secondary={{ id: 'preferences-discard', label: tBar('discard'), onClick: () => setDraft(null), disabled: saving }}
        primary={{ id: 'preferences-save', label: tBar('save'), onClick: () => { void save(); }, loading: saving, loadingLabel: tBar('saving'), shortcut: 'mod+s' }}
        data-testid="preferences-save-bar"
      />
    </div>
  );
}

export default PreferencesPanel;
