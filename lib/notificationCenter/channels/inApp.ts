/**
 * In-app channel (owner W5). The Notification row itself IS the in-app
 * delivery (bell / Activity feed, plus the live event published by notify()),
 * so there is nothing to send. Kept behind the interface for symmetry.
 */
import type { NotificationChannel } from './types';

export const inAppChannel: NotificationChannel = {
  name: 'inApp',
  isConfigured: () => true,
  send: async () => ({ ok: true }),
};
