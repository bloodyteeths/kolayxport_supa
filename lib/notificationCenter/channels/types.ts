/**
 * Out-of-app notification channel interface (owner W5).
 *
 * The dispatcher (lib/notificationCenter/dispatcher.ts) claims due
 * NotificationDelivery rows and hands each one to the channel named by
 * delivery.channel. A channel never throws: it returns a result object.
 */
import type { EffectiveSettings } from '../preferences';
import type { RenderableNotification } from '../render';

export type ChannelName = 'inApp' | 'email' | 'telegram';

export interface ChannelRecipient {
  userId: string;
  email: string | null;
  settings: EffectiveSettings;
}

export interface ChannelSendResult {
  ok: boolean;
  /**
   * permanent = do not retry (e.g. not configured, no address). The delivery
   * becomes 'skipped' instead of being retried.
   */
  permanent?: boolean;
  error?: string;
}

export interface NotificationChannel {
  name: ChannelName;
  /** Whether this channel can deliver to the recipient at all right now. */
  isConfigured(recipient: ChannelRecipient): boolean;
  send(recipient: ChannelRecipient, notification: RenderableNotification): Promise<ChannelSendResult>;
  /** Optional batched send (digest). */
  sendDigest?(
    recipient: ChannelRecipient,
    items: RenderableNotification[],
    opts?: { moreCount?: number },
  ): Promise<ChannelSendResult>;
}
