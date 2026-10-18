/**
 * Push channel: App Store app notifications through APNs (lib/push/apns.ts).
 *
 * Queued by afterRaise (lib/notifications.ts) only for the types in PUSH_TYPES, only when the type is on in-app
 * and the user has a registered device. Quiet hours, retries and the re-send cooldown come from the dispatcher like
 * every instant channel. Dead tokens (410 / BadDeviceToken) are deleted on the spot.
 */
import prisma from '@/lib/prisma';
import { apnsConfigured, sendApns } from '@/lib/push/apns';
import { renderTitle } from '../render';
import type { NotificationChannel } from './types';

/** Things a seller wants on the lock screen: new or cancelled orders, shipping deadlines, broken connections. */
export const PUSH_TYPES = new Set<string>([
  'orderNew',
  'orderCanceled',
  'orderCanceledAfterLabel',
  'dispatchDueToday',
  'dispatchOverdue',
  'reauthRequired',
  'orderSyncFailed',
  'stockOutOfStock',
  'draftSyncFailed',
]);

export async function hasPushDevice(userId: string): Promise<boolean> {
  if (!apnsConfigured()) return false;
  return (await prisma.pushDevice.count({ where: { userId } })) > 0;
}

export const pushChannel: NotificationChannel = {
  name: 'push',
  isConfigured: () => apnsConfigured(),
  async send(r, n) {
    if (!apnsConfigured()) return { ok: false, permanent: true, error: 'push_not_configured' };
    const devices = await prisma.pushDevice.findMany({ where: { userId: r.userId }, select: { token: true } });
    if (!devices.length) return { ok: false, permanent: true, error: 'push_no_device' };
    const locale = r.settings.locale === 'en' ? 'en' : 'tr';
    try {
      const results = await sendApns(devices.map((d) => d.token), {
        title: renderTitle(n, locale),
        link: n.link ?? null,
        collapseId: `${n.type}:${n.link ?? ''}`,
      });
      const dead = [...results].filter(([, res]) => res.unregistered).map(([token]) => token);
      if (dead.length) await prisma.pushDevice.deleteMany({ where: { token: { in: dead } } });
      const anyOk = [...results.values()].some((res) => res.ok);
      if (anyOk) return { ok: true };
      const first = [...results.values()][0];
      const permanent = [...results.values()].every((res) => res.unregistered);
      return { ok: false, permanent, error: `apns_${first?.status ?? 0}_${first?.reason ?? 'unknown'}`.slice(0, 120) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'push_threw' };
    }
  },
};
