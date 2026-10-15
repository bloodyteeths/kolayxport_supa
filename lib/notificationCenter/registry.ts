/**
 * Notification type registry (owner W5). ISOMORPHIC: no server imports, so the
 * notifications page (components/notification-center/*) imports the same
 * groups/types as the backend.
 *
 * One entry per NotificationType. `defaults` are the "recommended" preset; the
 * user's NotificationPreference rows and NotificationSettings.preset override
 * them (see lib/notificationCenter/preferences.ts for the resolution order).
 *
 *   inApp     — shows in the bell and raises the unread badge. When false the
 *               row is still written (badge=false) so it is visible in the
 *               Activity feed / audit trail.
 *   email     — an email delivery is queued on create / re-raise.
 *   emailMode — 'instant' (dispatcher, honours quiet hours for non-errors) or
 *               'digest' (one daily email at NotificationSettings.digestHour).
 *   badge     — false = this type is an activity-feed event by nature; it never
 *               raises the unread badge, whatever the in-app preference says.
 *   adminOnly — hidden from non-admin preference screens (sent via notifyAdmins).
 *
 * Defaults follow spec W5 T1: orderNew / orderShippedExternal /
 * listingChangedExternally are activity-feed types (badge=false; the new-order
 * chime and live row come from the W6 'order' live event); orderCanceled,
 * stockDrift, stockUnmatchedSale and orderSyncFailed are in-app only;
 * stockOutOfStock is a digest email. Changing any of these is a founder decision.
 */

export type NotificationGroup = 'orders' | 'dispatch' | 'listings' | 'stock' | 'account' | 'system';
export type NotificationEmailMode = 'instant' | 'digest';
export type NotificationPresetName = 'critical' | 'recommended' | 'all';
export type RegistrySeverity = 'info' | 'warning' | 'error';

export const NOTIFICATION_GROUPS: readonly NotificationGroup[] = ['orders', 'dispatch', 'listings', 'stock', 'account', 'system'];
export const NOTIFICATION_PRESETS: readonly NotificationPresetName[] = ['critical', 'recommended', 'all'];

export interface ChannelPrefs {
  inApp: boolean;
  email: boolean;
  telegram: boolean;
  emailMode: NotificationEmailMode;
}

export interface NotificationTypeDef {
  type: string;
  group: NotificationGroup;
  severity: RegistrySeverity;
  /** false = activity-feed type: never raises the unread badge. */
  badge: boolean;
  defaults: ChannelPrefs;
  adminOnly?: boolean;
}

function def(
  type: string,
  group: NotificationGroup,
  severity: RegistrySeverity,
  d: Partial<ChannelPrefs> & { badge?: boolean; adminOnly?: boolean } = {},
): NotificationTypeDef {
  return {
    type,
    group,
    severity,
    badge: d.badge ?? true,
    adminOnly: d.adminOnly,
    defaults: {
      inApp: d.inApp ?? true,
      email: d.email ?? false,
      telegram: d.telegram ?? false,
      emailMode: d.emailMode ?? 'instant',
    },
  };
}

const INSTANT_EMAIL = { email: true, emailMode: 'instant' as const };
const DIGEST_EMAIL = { email: true, emailMode: 'digest' as const };

/** Ordered for display (grouped on the preferences screen). */
export const NOTIFICATION_REGISTRY: readonly NotificationTypeDef[] = [
  // ---- orders ----
  def('orderNew', 'orders', 'info', { badge: false }),
  def('orderCanceled', 'orders', 'warning'),
  def('orderCanceledAfterLabel', 'orders', 'error', INSTANT_EMAIL),
  def('orderShippedExternal', 'orders', 'info', { badge: false }),
  def('orderSyncFailed', 'orders', 'warning'),
  // ---- dispatch (ship-by risk) ----
  def('dispatchOverdue', 'dispatch', 'warning', INSTANT_EMAIL),
  def('dispatchDueToday', 'dispatch', 'warning', INSTANT_EMAIL),
  def('dispatchDueTomorrow', 'dispatch', 'info', DIGEST_EMAIL),
  // ---- listings ----
  def('listingDeactivated', 'listings', 'error', INSTANT_EMAIL),
  def('listingDeleted', 'listings', 'error', INSTANT_EMAIL),
  def('listingExpired', 'listings', 'warning', DIGEST_EMAIL),
  def('listingChangedExternally', 'listings', 'info', { badge: false, inApp: false }),
  def('draftSyncFailed', 'listings', 'error'),
  def('draftConflict', 'listings', 'warning'),
  def('seoExperimentReady', 'listings', 'info', DIGEST_EMAIL),
  // Rollup per scheduled-send run (lib/drafts/scheduledSend). The emitter passes
  // badge: problem > 0, so an all-sent run is activity-only and only failures,
  // conflicts or skips raise the bell.
  def('scheduledSendResult', 'listings', 'info'),
  // ---- stock ----
  def('stockOutOfStock', 'stock', 'warning', DIGEST_EMAIL),
  def('stockPushFailed', 'stock', 'error', INSTANT_EMAIL),
  def('stockDrift', 'stock', 'warning'),
  def('stockUnmatchedSale', 'stock', 'warning'),
  // ---- account ----
  def('reauthRequired', 'account', 'error', INSTANT_EMAIL),
  def('usageNearLimit', 'account', 'warning'),
  def('usageLimitReached', 'account', 'error'),
  // ---- system (admins) ----
  def('webhookBacklog', 'system', 'error', { ...INSTANT_EMAIL, adminOnly: true }),
];

const BY_TYPE = new Map(NOTIFICATION_REGISTRY.map((d) => [d.type, d]));

export function getTypeDef(type: string): NotificationTypeDef | undefined {
  return BY_TYPE.get(type);
}

export function isKnownType(type: string): boolean {
  return BY_TYPE.has(type);
}

export function typesInGroup(group: NotificationGroup): string[] {
  return NOTIFICATION_REGISTRY.filter((d) => d.group === group).map((d) => d.type);
}

export function isNotificationGroup(v: unknown): v is NotificationGroup {
  return typeof v === 'string' && (NOTIFICATION_GROUPS as readonly string[]).includes(v);
}

export function isPresetName(v: unknown): v is NotificationPresetName {
  return typeof v === 'string' && (NOTIFICATION_PRESETS as readonly string[]).includes(v);
}

/**
 * Channel values a preset gives a type (before per-type / '*' overrides).
 *  critical    — only error-severity types notify (in-app + instant email);
 *                everything else is activity-only with no email.
 *  recommended — the registry defaults above.
 *  all         — everything in-app; email for every type (digest types keep digest).
 * Telegram is never enabled by a preset (no linking flow yet).
 */
export function presetPrefs(preset: string | null | undefined, d: NotificationTypeDef): ChannelPrefs {
  switch (preset) {
    case 'critical':
      return d.severity === 'error'
        ? { inApp: true, email: true, telegram: false, emailMode: 'instant' }
        : { inApp: false, email: false, telegram: false, emailMode: d.defaults.emailMode };
    case 'all':
      return { inApp: true, email: true, telegram: false, emailMode: d.defaults.emailMode };
    default:
      // 'recommended', 'custom' (legacy value) and unknown values
      return { ...d.defaults };
  }
}

/** Default for a type the registry does not know (forward compatibility). */
export const UNKNOWN_TYPE_PREFS: ChannelPrefs = { inApp: true, email: false, telegram: false, emailMode: 'instant' };
