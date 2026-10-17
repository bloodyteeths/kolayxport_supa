/**
 * Notification preferences (owner W5) — rendered on /app/bildirimler?tab=preferences.
 *
 * Email first: a master switch and one Off / Instant / Daily summary choice per kind of notification
 * (orders, ship-by, listings, stock, research, account), each with its per-type switches under "Details".
 * Then a compact preset row, quiet hours, daily summary hour and timezone. Telegram is shown
 * disabled ("coming soon"). Every change saves immediately (PUT) and the
 * server's fresh view replaces the local one.
 */
import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Autocomplete,
  Chip,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Skeleton,
  Switch,
  TextField,
} from '@mui/material';
import { Send } from 'lucide-react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import { notify } from '@/lib/notify';
import {
  NOTIFICATION_GROUPS,
  NOTIFICATION_PRESETS,
  type NotificationGroup,
  type NotificationPresetName,
} from '@/lib/notificationCenter/registry';
import { PREFERENCES_API, SEVERITY_COLOR, type ClientSeverity } from './shared';
import { useNotificationText } from './useNotificationText';

interface TypeView {
  type: string;
  group: NotificationGroup;
  severity: ClientSeverity;
  badge: boolean;
  inApp: boolean;
  email: boolean;
  emailMode: 'instant' | 'digest';
  telegram: boolean;
  telegramAvailable: boolean;
  customized: boolean;
}

interface PrefsView {
  settings: {
    locale: string | null;
    timezone: string;
    emailEnabled: boolean;
    quietHoursStart: number | null;
    quietHoursEnd: number | null;
    digestHour: number;
    telegramLinked: boolean;
  };
  preset: NotificationPresetName;
  customized: boolean;
  telegramAvailable: boolean;
  types: TypeView[];
}

type Patch = {
  settings?: Partial<Omit<PrefsView['settings'], 'telegramLinked'>>;
  preset?: NotificationPresetName;
  types?: { type: string; inApp?: boolean; email?: boolean; emailMode?: 'instant' | 'digest' }[];
};

class FetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`Request failed (${status})`);
    this.status = status;
  }
}

async function fetchPrefs(url: string): Promise<PrefsView> {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new FetchError(res.status);
  return (await res.json()) as PrefsView;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const FALLBACK_TIMEZONES = [
  'Europe/Istanbul',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'UTC',
];

function timezoneOptions(current: string): string[] {
  let list: string[] = FALLBACK_TIMEZONES;
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof fn === 'function') list = fn('timeZone');
  } catch {
    /* fallback list */
  }
  return list.includes(current) ? list : [current, ...list];
}

/** Apply a patch to the local view so switches respond instantly. */
function applyLocal(view: PrefsView, patch: Patch): PrefsView {
  const next: PrefsView = { ...view, settings: { ...view.settings, ...(patch.settings || {}) } };
  if (patch.preset) next.preset = patch.preset;
  if (patch.types) {
    const byType = new Map(patch.types.map((t) => [t.type, t]));
    next.types = view.types.map((t) => {
      const p = byType.get(t.type);
      return p ? { ...t, ...p, customized: true } : t;
    });
    next.customized = true;
  }
  return next;
}

export type EmailChoice = 'off' | 'instant' | 'digest';
const EMAIL_CHOICES: readonly EmailChoice[] = ['off', 'instant', 'digest'];

/**
 * The email setting a group shows: off when nothing in it emails, else instant when anything emails instantly,
 * else daily summary. (A preset mixes them inside a group; the exact per-type state is under Details.) Pure.
 */
export function groupEmailChoice(types: Pick<TypeView, 'email' | 'emailMode'>[]): EmailChoice {
  const on = types.filter((x) => x.email);
  if (!on.length) return 'off';
  return on.some((x) => x.emailMode === 'instant') ? 'instant' : 'digest';
}

export interface NotificationPreferencesPanelProps {
  locale: string;
}

export default function NotificationPreferencesPanel({ locale }: NotificationPreferencesPanelProps) {
  const t = useTranslations('notificationCenter');
  const { typeLabel } = useNotificationText();
  const { data, error, isLoading, mutate } = useSWR<PrefsView>(PREFERENCES_API, fetchPrefs, { revalidateOnFocus: false });
  const [saving, setSaving] = useState(false);
  const [openGroup, setOpenGroup] = useState<NotificationGroup | null>(null);

  const save = useCallback(
    async (patch: Patch) => {
      if (!data) return;
      const body: Patch = { ...patch, settings: { ...(patch.settings || {}) } };
      // Persist the UI language so emails go out in it.
      if ((locale === 'tr' || locale === 'en') && data.settings.locale !== locale) body.settings!.locale = locale;
      if (!Object.keys(body.settings!).length) delete body.settings;
      setSaving(true);
      try {
        await mutate(
          async () => {
            const res = await fetch(PREFERENCES_API, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            });
            if (!res.ok) throw new FetchError(res.status);
            return (await res.json()) as PrefsView;
          },
          { optimisticData: applyLocal(data, patch), rollbackOnError: true, populateCache: true, revalidate: false },
        );
      } catch (err) {
        notify.error(err, 'notificationCenter.prefs.saveFailed');
      } finally {
        setSaving(false);
      }
    },
    [data, locale, mutate],
  );

  const byGroup = useMemo(() => {
    const m = new Map<NotificationGroup, TypeView[]>();
    for (const tv of data?.types || []) {
      const list = m.get(tv.group) || [];
      list.push(tv);
      m.set(tv.group, list);
    }
    return m;
  }, [data]);

  if (error && !data) {
    return <ErrorState title={t('prefs.loadFailed')} error={error} onRetry={() => mutate()} />;
  }
  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-3" aria-busy="true">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} variant="rounded" height={96} />
        ))}
      </div>
    );
  }

  const s = data.settings;
  const quietOn = s.quietHoursStart !== null && s.quietHoursEnd !== null;
  const card = 'rounded-xl border border-slate-200 bg-white p-4';
  const hourLabel = (h: number) => t('prefs.hour', { hour: String(h).padStart(2, '0') });

  // One email choice per kind of notification (founder 2026-10-17: "users should be able to subscribe to
  // notification emails of different kinds"). The per-type switches stay one tap away under "Details".
  const groups = NOTIFICATION_GROUPS.filter((g) => byGroup.has(g));
  const saveGroup = (g: NotificationGroup, mode: EmailChoice) => {
    const types = (byGroup.get(g) || []).map((tv) =>
      mode === 'off' ? { type: tv.type, email: false } : { type: tv.type, email: true, emailMode: mode },
    );
    void save(mode !== 'off' && !s.emailEnabled ? { types, settings: { emailEnabled: true } } : { types });
  };

  return (
    <div className="flex flex-col gap-3" aria-busy={saving}>
      {/* Email: which kinds, how often */}
      <section className={card} aria-labelledby="np-email">
        <label className="flex items-center justify-between gap-3" style={{ minHeight: 40 }}>
          <span className="min-w-0">
            <span id="np-email" className="block text-sm font-semibold text-slate-800">{t('prefs.emailEnabled')}</span>
            <span className="block text-xs text-slate-500">{t('prefs.emailHint')}</span>
          </span>
          <Switch checked={s.emailEnabled} onChange={(e) => void save({ settings: { emailEnabled: e.target.checked } })} />
        </label>
        <ul className={`mt-2 -mx-4 border-t border-slate-100 ${s.emailEnabled ? '' : 'opacity-50'}`} data-testid="np-email-groups">
          {groups.map((g) => {
            const list = byGroup.get(g) || [];
            const choice = groupEmailChoice(list);
            const open = openGroup === g;
            return (
              <li key={g} className="border-b border-slate-100 last:border-b-0 px-4 py-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-x-3 gap-y-2">
                  <button
                    type="button"
                    className="min-w-0 text-left flex-1"
                    onClick={() => setOpenGroup(open ? null : g)}
                    aria-expanded={open}
                  >
                    <span className="block text-sm font-medium text-slate-800">{t(`groups.${g}` as any)}</span>
                    <span className="block text-xs text-slate-500">
                      {t(`prefs.groupHints.${g}` as any)} · <span className="text-blue-600">{open ? t('prefs.hideDetails') : t('prefs.details')}</span>
                    </span>
                  </button>
                  <div role="radiogroup" aria-label={t(`groups.${g}` as any)} className="flex rounded-lg bg-slate-100 p-0.5 flex-shrink-0 w-full sm:w-auto">
                    {EMAIL_CHOICES.map((c) => (
                      <button
                        key={c}
                        type="button"
                        role="radio"
                        aria-checked={choice === c}
                        disabled={!s.emailEnabled && c === 'off'}
                        onClick={() => saveGroup(g, c)}
                        className={`flex-1 sm:flex-none px-2.5 h-8 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                          choice === c ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {t(`prefs.emailChoice.${c}` as any)}
                      </button>
                    ))}
                  </div>
                </div>
                {open && (
                  <ul className="mt-2 flex flex-col">
                    {list.map((tv) => {
                      const label = typeLabel(tv.type);
                      return (
                        <li key={tv.type} className="flex items-center justify-between gap-3 py-1.5 border-t border-slate-50 first:border-t-0">
                          <span className="min-w-0 text-[13px] text-slate-700 break-words">{label}</span>
                          <span className="flex items-center gap-1 flex-shrink-0">
                            <label className="flex items-center text-[11px] text-slate-500">
                              {t('prefs.columns.inApp')}
                              <Switch size="small" checked={tv.inApp} inputProps={{ 'aria-label': `${label}: ${t('prefs.columns.inApp')}` }} onChange={(e) => void save({ types: [{ type: tv.type, inApp: e.target.checked }] })} />
                            </label>
                            <label className="flex items-center text-[11px] text-slate-500">
                              {t('prefs.columns.email')}
                              <Switch size="small" checked={tv.email} disabled={!s.emailEnabled} inputProps={{ 'aria-label': `${label}: ${t('prefs.columns.email')}` }} onChange={(e) => void save({ types: [{ type: tv.type, email: e.target.checked }] })} />
                            </label>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Quick presets: one compact row, the active one's hint below */}
      <section className={card} aria-labelledby="np-level">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="np-level" className="text-sm font-semibold text-slate-800">{t('prefs.levelTitle')}</h2>
          <div role="radiogroup" aria-labelledby="np-level" className="flex rounded-lg bg-slate-100 p-0.5">
            {NOTIFICATION_PRESETS.map((p) => {
              const active = data.preset === p && !data.customized;
              return (
                <button
                  key={p}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => void save({ preset: p })}
                  className={`px-2.5 h-8 rounded-md text-xs font-medium whitespace-nowrap ${active ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                >
                  {t(`prefs.presets.${p}` as any)}
                </button>
              );
            })}
          </div>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          {data.customized ? t('prefs.customHint') : t(`prefs.presetHints.${data.preset}` as any)}
        </p>
      </section>

      {/* Quiet hours + digest + timezone */}
      <section className={card} aria-labelledby="np-quiet">
        <h2 id="np-quiet" className="text-sm font-semibold text-slate-800 mb-1">
          {t('prefs.quietTitle')}
        </h2>
        <label className="flex items-center justify-between gap-3" style={{ minHeight: 44 }}>
          <span className="text-sm text-slate-700">{t('prefs.quietEnabled')}</span>
          <Switch
            checked={quietOn}
            onChange={(e) =>
              void save({
                settings: e.target.checked
                  ? { quietHoursStart: 23, quietHoursEnd: 8 }
                  : { quietHoursStart: null, quietHoursEnd: null },
              })
            }
          />
        </label>
        <p className="text-xs text-slate-500 mb-3">{t('prefs.quietHint')}</p>
        {quietOn && (
          <div className="grid grid-cols-2 gap-3 mb-4">
            <FormControl size="small" fullWidth>
              <InputLabel id="np-qs">{t('prefs.quietFrom')}</InputLabel>
              <Select
                labelId="np-qs"
                label={t('prefs.quietFrom')}
                value={s.quietHoursStart ?? 23}
                onChange={(e) => void save({ settings: { quietHoursStart: Number(e.target.value) } })}
                sx={{ minHeight: 44 }}
              >
                {HOURS.map((h) => (
                  <MenuItem key={h} value={h}>
                    {hourLabel(h)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" fullWidth>
              <InputLabel id="np-qe">{t('prefs.quietTo')}</InputLabel>
              <Select
                labelId="np-qe"
                label={t('prefs.quietTo')}
                value={s.quietHoursEnd ?? 8}
                onChange={(e) => void save({ settings: { quietHoursEnd: Number(e.target.value) } })}
                sx={{ minHeight: 44 }}
              >
                {HOURS.map((h) => (
                  <MenuItem key={h} value={h}>
                    {hourLabel(h)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
        )}

        <h2 className="text-sm font-semibold text-slate-800 mb-1 mt-2">{t('prefs.digestTitle')}</h2>
        <p className="text-xs text-slate-500 mb-3">{t('prefs.digestHint')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormControl size="small" fullWidth>
            <InputLabel id="np-dh">{t('prefs.digestHour')}</InputLabel>
            <Select
              labelId="np-dh"
              label={t('prefs.digestHour')}
              value={s.digestHour}
              onChange={(e) => void save({ settings: { digestHour: Number(e.target.value) } })}
              sx={{ minHeight: 44 }}
            >
              {HOURS.map((h) => (
                <MenuItem key={h} value={h}>
                  {hourLabel(h)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Autocomplete
            size="small"
            disableClearable
            options={timezoneOptions(s.timezone)}
            value={s.timezone}
            onChange={(_, v) => {
              if (v && v !== s.timezone) void save({ settings: { timezone: v } });
            }}
            renderInput={(params) => <TextField {...params} label={t('prefs.timezone')} />}
          />
        </div>
      </section>

      {/* Telegram (inert) */}
      <section className={`${card} opacity-80`} aria-labelledby="np-tg">
        <div className="flex items-center justify-between gap-3" style={{ minHeight: 44 }}>
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-8 h-8 rounded-lg bg-sky-50 flex items-center justify-center flex-shrink-0" aria-hidden="true">
              <Send size={16} className="text-sky-500" />
            </span>
            <span className="min-w-0">
              <span id="np-tg" className="block text-sm font-semibold text-slate-800">
                {t('prefs.telegram')}
              </span>
              <span className="block text-xs text-slate-500">{t('prefs.telegramHint')}</span>
            </span>
          </div>
          <Chip size="small" label={t('prefs.comingSoon')} />
        </div>
      </section>
    </div>
  );
}
