/**
 * Notification preferences (owner W5). Server-only.
 *
 * Resolution order for one (user, type):
 *   1. the user's NotificationPreference row for that type
 *   2. else the user's '*' row
 *   3. else NotificationSettings.preset (critical | recommended | all)
 *   4. else the registry default (= 'recommended')
 * Then:
 *   - badge  = registry.badge && callerBadge !== false && inApp  (a disabled in-app type is still written,
 *              with badge=false, so it stays in the Activity feed for audit)
 *   - email  also requires NotificationSettings.emailEnabled (master switch)
 *   - telegram also requires TELEGRAM_BOT_TOKEN + a linked chat id (inert today)
 *
 * Config is cached per process for 30 s; PUT /api/notifications/preferences
 * calls invalidateNotificationConfig(userId) so changes apply on the next notify.
 */
import prisma from '@/lib/prisma';
import {
  getTypeDef,
  presetPrefs,
  UNKNOWN_TYPE_PREFS,
  type ChannelPrefs,
  type NotificationEmailMode,
} from './registry';
import { DEFAULT_TIMEZONE } from './time';

export interface EffectiveSettings {
  locale: string | null;
  timezone: string;
  preset: string;
  emailEnabled: boolean;
  quietHoursStart: number | null;
  quietHoursEnd: number | null;
  digestHour: number;
  lastDigestAt: Date | null;
  telegramChatId: string | null;
}

export const DEFAULT_SETTINGS: EffectiveSettings = {
  locale: null,
  timezone: DEFAULT_TIMEZONE,
  preset: 'recommended',
  emailEnabled: true,
  quietHoursStart: 23,
  quietHoursEnd: 8,
  digestHour: 8,
  lastDigestAt: null,
  telegramChatId: null,
};

export interface PrefRow {
  type: string;
  inApp: boolean;
  email: boolean;
  telegram: boolean;
  emailMode: string;
}

export interface UserNotificationConfig {
  settings: EffectiveSettings;
  /** type (or '*') -> row */
  rows: Map<string, PrefRow>;
}

export interface ResolvedPrefs extends ChannelPrefs {
  /** Whether this raise counts toward the unread badge. */
  badge: boolean;
  /** Where the channel values came from (debug / UI). */
  source: 'type' | 'wildcard' | 'preset';
}

function toMode(v: unknown, fallback: NotificationEmailMode): NotificationEmailMode {
  return v === 'digest' || v === 'instant' ? v : fallback;
}

export function telegramGloballyConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN);
}

/** Pure resolver (unit-tested). `callerBadge: false` (NotifyInput.badge) forces an activity-only row for any type. */
export function resolvePrefs(
  type: string,
  config: UserNotificationConfig,
  opts: { callerBadge?: boolean; telegramConfigured?: boolean } = {},
): ResolvedPrefs {
  const d = getTypeDef(type);
  const base: ChannelPrefs = d ? presetPrefs(config.settings.preset, d) : { ...UNKNOWN_TYPE_PREFS };
  const row = config.rows.get(type) ?? config.rows.get('*');
  const source: ResolvedPrefs['source'] = config.rows.has(type) ? 'type' : config.rows.has('*') ? 'wildcard' : 'preset';
  const ch: ChannelPrefs = row
    ? { inApp: row.inApp, email: row.email, telegram: row.telegram, emailMode: toMode(row.emailMode, base.emailMode) }
    : base;
  // Registry activity types never badge; an explicit caller badge:false always wins.
  const typeBadge = (d ? d.badge : true) && opts.callerBadge !== false;
  const telegramOk = (opts.telegramConfigured ?? telegramGloballyConfigured()) && Boolean(config.settings.telegramChatId);
  return {
    inApp: ch.inApp,
    email: ch.email && config.settings.emailEnabled !== false,
    telegram: ch.telegram && telegramOk,
    emailMode: ch.emailMode,
    badge: typeBadge && ch.inApp,
    source,
  };
}

/** Raw (preference-level) values for the preferences screen: no master switches applied. */
export function resolveRawPrefs(type: string, config: UserNotificationConfig): ChannelPrefs {
  const d = getTypeDef(type);
  const base: ChannelPrefs = d ? presetPrefs(config.settings.preset, d) : { ...UNKNOWN_TYPE_PREFS };
  const row = config.rows.get(type) ?? config.rows.get('*');
  return row
    ? { inApp: row.inApp, email: row.email, telegram: row.telegram, emailMode: toMode(row.emailMode, base.emailMode) }
    : base;
}

export function settingsFromRow(row: Partial<EffectiveSettings> | null | undefined): EffectiveSettings {
  if (!row) return { ...DEFAULT_SETTINGS };
  return {
    locale: typeof row.locale === 'string' ? row.locale : null,
    timezone: typeof row.timezone === 'string' && row.timezone ? row.timezone : DEFAULT_TIMEZONE,
    preset: typeof row.preset === 'string' && row.preset ? row.preset : 'recommended',
    emailEnabled: row.emailEnabled !== false,
    quietHoursStart: typeof row.quietHoursStart === 'number' ? row.quietHoursStart : null,
    quietHoursEnd: typeof row.quietHoursEnd === 'number' ? row.quietHoursEnd : null,
    digestHour: typeof row.digestHour === 'number' ? row.digestHour : DEFAULT_SETTINGS.digestHour,
    lastDigestAt: row.lastDigestAt instanceof Date ? row.lastDigestAt : null,
    telegramChatId: typeof row.telegramChatId === 'string' && row.telegramChatId ? row.telegramChatId : null,
  };
}

// ---------------------------------------------------------------------------
// DB loading (cached)
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; config: UserNotificationConfig }>();

export function invalidateNotificationConfig(userId?: string) {
  if (userId) cache.delete(userId);
  else cache.clear();
}

/** Loads settings + per-type rows. Throws on DB failure (callers decide). */
export async function loadNotificationConfig(userId: string, opts: { fresh?: boolean } = {}): Promise<UserNotificationConfig> {
  if (!opts.fresh) {
    const hit = cache.get(userId);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.config;
  }
  const [settingsRow, prefRows] = await Promise.all([
    prisma.notificationSettings.findUnique({ where: { userId } }),
    prisma.notificationPreference.findMany({
      where: { userId },
      select: { type: true, inApp: true, email: true, telegram: true, emailMode: true },
    }),
  ]);
  const config: UserNotificationConfig = {
    settings: settingsFromRow(settingsRow as Partial<EffectiveSettings> | null),
    rows: new Map((prefRows || []).map((r) => [r.type, r as PrefRow])),
  };
  if (cache.size > 2000) cache.clear();
  cache.set(userId, { at: Date.now(), config });
  return config;
}

/** Never throws: on DB failure falls back to defaults (in-app only, recommended preset). */
export async function loadNotificationConfigSafe(userId: string): Promise<UserNotificationConfig> {
  try {
    return await loadNotificationConfig(userId);
  } catch {
    return { settings: { ...DEFAULT_SETTINGS }, rows: new Map() };
  }
}

// ---------------------------------------------------------------------------
// Locale capture (X-KX-Locale header) — at most once per hour per user/process
// ---------------------------------------------------------------------------

const localeSeen = new Map<string, { at: number; locale: string }>();
const LOCALE_TTL_MS = 60 * 60 * 1000;

export function normalizeLocale(raw: unknown): 'tr' | 'en' | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().toLowerCase().slice(0, 2);
  return v === 'tr' || v === 'en' ? v : null;
}

/** Fire-and-forget; never throws. */
export async function captureLocale(userId: string, raw: unknown): Promise<void> {
  try {
    const locale = normalizeLocale(raw);
    if (!userId || !locale) return;
    const seen = localeSeen.get(userId);
    if (seen && seen.locale === locale && Date.now() - seen.at < LOCALE_TTL_MS) return;
    if (localeSeen.size > 5000) localeSeen.clear();
    localeSeen.set(userId, { at: Date.now(), locale });
    await prisma.notificationSettings.upsert({
      where: { userId },
      create: { userId, locale },
      update: { locale },
    });
    const hit = cache.get(userId);
    if (hit) hit.config.settings.locale = locale;
  } catch {
    /* best effort */
  }
}

/** Test hook. */
export function __resetPreferenceCaches() {
  cache.clear();
  localeSeen.clear();
}
