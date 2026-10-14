import { emailChannel } from './email';
import { inAppChannel } from './inApp';
import { telegramChannel } from './telegram';
import type { NotificationChannel } from './types';

export const CHANNELS: Record<string, NotificationChannel> = {
  inApp: inAppChannel,
  email: emailChannel,
  telegram: telegramChannel,
};

export function getChannel(name: string): NotificationChannel | undefined {
  return CHANNELS[name];
}

export type { NotificationChannel, ChannelRecipient, ChannelSendResult, ChannelName } from './types';
