/**
 * Preferences read/write for GET/PUT /api/notifications/preferences (owner W5).
 * Server-only. The validation step is pure (unit-tested).
 */
import prisma from '@/lib/prisma';
import {
  NOTIFICATION_REGISTRY,
  getTypeDef,
  isPresetName,
  type NotificationEmailMode,
  type NotificationGroup,
  type NotificationPresetName,
  type RegistrySeverity,
} from './registry';
import {
  invalidateNotificationConfig,
  loadNotificationConfig,
  normalizeLocale,
  resolveRawPrefs,
  telegramGloballyConfigured,
  type UserNotificationConfig,
} from './preferences';
import { isValidTimezone } from './time';

export interface PreferenceTypeView {
  type: string;
  group: NotificationGroup;
  severity: RegistrySeverity;
  /** false = activity-feed type (never raises the badge) */
  badge: boolean;
  inApp: boolean;
  email: boolean;
  emailMode: NotificationEmailMode;
  telegram: boolean;
  telegramAvailable: boolean;
  /** true when the user has an explicit per-type row */
  customized: boolean;
}

export interface PreferencesView {
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
  /** any per-type override exists (UI shows "Custom") */
  customized: boolean;
  telegramAvailable: boolean;
  types: PreferenceTypeView[];
}

export function buildPreferencesView(config: UserNotificationConfig, isAdmin: boolean): PreferencesView {
  const telegramAvailable = telegramGloballyConfigured() && Boolean(config.settings.telegramChatId);
  const preset: NotificationPresetName = isPresetName(config.settings.preset) ? config.settings.preset : 'recommended';
  const types = NOTIFICATION_REGISTRY.filter((d) => isAdmin || !d.adminOnly).map((d) => {
    const raw = resolveRawPrefs(d.type, config);
    return {
      type: d.type,
      group: d.group,
      severity: d.severity,
      badge: d.badge,
      inApp: raw.inApp,
      email: raw.email,
      emailMode: raw.emailMode,
      telegram: raw.telegram,
      telegramAvailable,
      customized: config.rows.has(d.type),
    };
  });
  return {
    settings: {
      locale: config.settings.locale,
      timezone: config.settings.timezone,
      emailEnabled: config.settings.emailEnabled,
      quietHoursStart: config.settings.quietHoursStart,
      quietHoursEnd: config.settings.quietHoursEnd,
      digestHour: config.settings.digestHour,
      telegramLinked: Boolean(config.settings.telegramChatId),
    },
    preset,
    customized: types.some((t) => t.customized),
    telegramAvailable,
    types,
  };
}

export interface PreferencesPatch {
  settings?: {
    locale?: 'tr' | 'en' | null;
    timezone?: string;
    emailEnabled?: boolean;
    quietHoursStart?: number | null;
    quietHoursEnd?: number | null;
    digestHour?: number;
  };
  /** Choosing a preset clears per-type overrides (unless `types` is sent too). */
  preset?: NotificationPresetName;
  types?: { type: string; inApp?: boolean; email?: boolean; emailMode?: NotificationEmailMode }[];
  /** Clear all per-type overrides (back to the preset). */
  resetTypes?: boolean;
}

function isHour(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 23;
}

/** Pure validation. Unknown / admin-only (for non-admins) types are rejected. */
export function validatePreferencesPatch(
  body: unknown,
  isAdmin: boolean,
): { ok: true; patch: PreferencesPatch } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, errors: ['body'] };
  const b = body as Record<string, unknown>;
  const patch: PreferencesPatch = {};

  if (b.settings !== undefined) {
    const s = b.settings as Record<string, unknown>;
    if (!s || typeof s !== 'object' || Array.isArray(s)) errors.push('settings');
    else {
      const out: NonNullable<PreferencesPatch['settings']> = {};
      if ('locale' in s) {
        if (s.locale === null) out.locale = null;
        else {
          const l = normalizeLocale(s.locale);
          if (l) out.locale = l;
          else errors.push('settings.locale');
        }
      }
      if ('timezone' in s) {
        if (isValidTimezone(s.timezone)) out.timezone = s.timezone;
        else errors.push('settings.timezone');
      }
      if ('emailEnabled' in s) {
        if (typeof s.emailEnabled === 'boolean') out.emailEnabled = s.emailEnabled;
        else errors.push('settings.emailEnabled');
      }
      for (const k of ['quietHoursStart', 'quietHoursEnd'] as const) {
        if (k in s) {
          if (s[k] === null || isHour(s[k])) out[k] = s[k] as number | null;
          else errors.push(`settings.${k}`);
        }
      }
      if ('digestHour' in s) {
        if (isHour(s.digestHour)) out.digestHour = s.digestHour;
        else errors.push('settings.digestHour');
      }
      patch.settings = out;
    }
  }

  if (b.preset !== undefined) {
    if (isPresetName(b.preset)) patch.preset = b.preset;
    else errors.push('preset');
  }

  if (b.resetTypes !== undefined) {
    if (typeof b.resetTypes === 'boolean') patch.resetTypes = b.resetTypes;
    else errors.push('resetTypes');
  }

  if (b.types !== undefined) {
    if (!Array.isArray(b.types) || b.types.length > 100) errors.push('types');
    else {
      const out: NonNullable<PreferencesPatch['types']> = [];
      b.types.forEach((raw, i) => {
        const t = raw as Record<string, unknown>;
        const d = t && typeof t.type === 'string' ? getTypeDef(t.type) : undefined;
        if (!d || (d.adminOnly && !isAdmin)) {
          errors.push(`types[${i}].type`);
          return;
        }
        const row: NonNullable<PreferencesPatch['types']>[number] = { type: d.type };
        for (const k of ['inApp', 'email'] as const) {
          if (k in t) {
            if (typeof t[k] === 'boolean') row[k] = t[k] as boolean;
            else errors.push(`types[${i}].${k}`);
          }
        }
        if ('emailMode' in t) {
          if (t.emailMode === 'instant' || t.emailMode === 'digest') row.emailMode = t.emailMode;
          else errors.push(`types[${i}].emailMode`);
        }
        out.push(row);
      });
      patch.types = out;
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, patch };
}

export async function isAdminUser(userId: string): Promise<boolean> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  return u?.role === 'admin';
}

export async function getPreferences(userId: string, isAdmin: boolean): Promise<PreferencesView> {
  const config = await loadNotificationConfig(userId, { fresh: true });
  return buildPreferencesView(config, isAdmin);
}

/** Applies a validated patch; returns the fresh view. Throws on DB failure. */
export async function applyPreferencesPatch(userId: string, patch: PreferencesPatch, isAdmin: boolean): Promise<PreferencesView> {
  const settingsData: Record<string, unknown> = { ...(patch.settings || {}) };
  if (patch.preset) settingsData.preset = patch.preset;
  if (Object.keys(settingsData).length) {
    await prisma.notificationSettings.upsert({
      where: { userId },
      create: { userId, ...settingsData },
      update: settingsData,
    });
  }

  if (patch.resetTypes || (patch.preset && !patch.types)) {
    await prisma.notificationPreference.deleteMany({ where: { userId } });
  }

  if (patch.types && patch.types.length) {
    // Merge partial rows onto the values the user currently sees.
    const current = await loadNotificationConfig(userId, { fresh: true });
    for (const t of patch.types) {
      const raw = resolveRawPrefs(t.type, current);
      const values = {
        inApp: t.inApp ?? raw.inApp,
        email: t.email ?? raw.email,
        telegram: false,
        emailMode: t.emailMode ?? raw.emailMode,
      };
      await prisma.notificationPreference.upsert({
        where: { userId_type: { userId, type: t.type } },
        create: { userId, type: t.type, ...values },
        update: values,
      });
    }
  }

  invalidateNotificationConfig(userId);
  const fresh = await loadNotificationConfig(userId, { fresh: true });
  return buildPreferencesView(fresh, isAdmin);
}
