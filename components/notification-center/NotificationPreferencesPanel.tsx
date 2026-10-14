/**
 * Notification preferences (owner W5) — rendered on /app/bildirimler?tab=preferences.
 *
 * Preset chips (Sadece kritik / Önerilen / Hepsi), email master switch, quiet
 * hours, daily summary hour, timezone, and an "Advanced" accordion with per-type
 * In-app / Email / Daily-summary switches grouped by category. Telegram is shown
 * disabled ("coming soon"). Every change saves immediately (PUT) and the
 * server's fresh view replaces the local one.
 */
import React, { useCallback, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
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
import { ChevronDown, Send } from 'lucide-react';
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

export interface NotificationPreferencesPanelProps {
  locale: string;
}

export default function NotificationPreferencesPanel({ locale }: NotificationPreferencesPanelProps) {
  const t = useTranslations('notificationCenter');
  const { typeLabel } = useNotificationText();
  const { data, error, isLoading, mutate } = useSWR<PrefsView>(PREFERENCES_API, fetchPrefs, { revalidateOnFocus: false });
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="flex flex-col gap-4" aria-busy={saving}>
      {/* Level presets */}
      <section className={card} aria-labelledby="np-level">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h2 id="np-level" className="text-sm font-semibold text-slate-800">
            {t('prefs.levelTitle')}
          </h2>
          {data.customized && <Chip size="small" label={t('prefs.custom')} color="secondary" variant="outlined" />}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2" role="radiogroup" aria-labelledby="np-level">
          {NOTIFICATION_PRESETS.map((p) => {
            const active = data.preset === p && !data.customized;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => void save({ preset: p })}
                className={`text-left rounded-lg border px-3 py-2.5 transition-colors ${
                  active ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-200 hover:bg-slate-50 text-slate-700'
                }`}
                style={{ minHeight: 44 }}
              >
                <span className="block text-sm font-semibold">{t(`prefs.presets.${p}` as any)}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{t(`prefs.presetHints.${p}` as any)}</span>
              </button>
            );
          })}
        </div>
        {data.customized && <p className="text-xs text-slate-500 mt-2">{t('prefs.customHint')}</p>}
      </section>

      {/* Email */}
      <section className={card} aria-labelledby="np-email">
        <h2 id="np-email" className="text-sm font-semibold text-slate-800 mb-1">
          {t('prefs.emailTitle')}
        </h2>
        <label className="flex items-center justify-between gap-3" style={{ minHeight: 44 }}>
          <span className="text-sm text-slate-700">{t('prefs.emailEnabled')}</span>
          <Switch checked={s.emailEnabled} onChange={(e) => void save({ settings: { emailEnabled: e.target.checked } })} />
        </label>
        <p className="text-xs text-slate-500">{t('prefs.emailHint')}</p>
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

      {/* Advanced per-type */}
      <Accordion
        disableGutters
        elevation={0}
        sx={{ border: '1px solid #e2e8f0', borderRadius: '12px !important', '&:before': { display: 'none' } }}
      >
        <AccordionSummary expandIcon={<ChevronDown size={18} />} sx={{ minHeight: 52 }}>
          <span className="text-sm font-semibold text-slate-800">{t('prefs.advanced')}</span>
        </AccordionSummary>
        <AccordionDetails sx={{ px: { xs: 1.5, sm: 2 }, pt: 0 }}>
          {NOTIFICATION_GROUPS.filter((g) => byGroup.has(g)).map((g) => (
            <div key={g} className="mb-4 last:mb-0">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">{t(`groups.${g}` as any)}</h3>
              <div className="hidden sm:grid grid-cols-[1fr_88px_88px_104px] items-center px-3 pb-1 text-[11px] text-slate-400">
                <span />
                <span className="text-center">{t('prefs.columns.inApp')}</span>
                <span className="text-center">{t('prefs.columns.email')}</span>
                <span className="text-center">{t('prefs.columns.digest')}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {(byGroup.get(g) || []).map((tv) => {
                  const dot = (SEVERITY_COLOR[tv.severity] || SEVERITY_COLOR.info).dot;
                  const label = typeLabel(tv.type);
                  return (
                    <li
                      key={tv.type}
                      className="rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2 sm:grid sm:grid-cols-[1fr_88px_88px_104px] sm:items-center"
                    >
                      <div className="flex items-start gap-2 min-w-0 mb-1 sm:mb-0">
                        <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: dot }} aria-hidden="true" />
                        <span className="min-w-0">
                          <span className="block text-sm text-slate-700 break-words">{label}</span>
                          {!tv.badge && <span className="block text-[11px] text-slate-400">{t('prefs.activityOnly')}</span>}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 sm:contents">
                        <label className="flex flex-col sm:flex-row items-center justify-center text-[11px] text-slate-500">
                          <span className="sm:sr-only">{t('prefs.columns.inApp')}</span>
                          <Switch
                            size="small"
                            checked={tv.inApp}
                            inputProps={{ 'aria-label': `${label}: ${t('prefs.columns.inApp')}` }}
                            onChange={(e) => void save({ types: [{ type: tv.type, inApp: e.target.checked }] })}
                          />
                        </label>
                        <label className="flex flex-col sm:flex-row items-center justify-center text-[11px] text-slate-500">
                          <span className="sm:sr-only">{t('prefs.columns.email')}</span>
                          <Switch
                            size="small"
                            checked={tv.email}
                            disabled={!s.emailEnabled}
                            inputProps={{ 'aria-label': `${label}: ${t('prefs.columns.email')}` }}
                            onChange={(e) => void save({ types: [{ type: tv.type, email: e.target.checked }] })}
                          />
                        </label>
                        <label className="flex flex-col sm:flex-row items-center justify-center text-[11px] text-slate-500">
                          <span className="sm:sr-only">{t('prefs.columns.digest')}</span>
                          <Switch
                            size="small"
                            checked={tv.email && tv.emailMode === 'digest'}
                            disabled={!s.emailEnabled || !tv.email}
                            inputProps={{ 'aria-label': `${label}: ${t('prefs.columns.digest')}` }}
                            onChange={(e) =>
                              void save({ types: [{ type: tv.type, emailMode: e.target.checked ? 'digest' : 'instant' }] })
                            }
                          />
                        </label>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </AccordionDetails>
      </Accordion>

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
