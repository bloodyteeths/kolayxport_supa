import { emailChannel } from './email';
import { inAppChannel } from './inApp';
import { telegramChannel } from './telegram';
import { pushChannel } from './push';
import type { NotificationChannel } from './types';

export const CHANNELS: Record<string, NotificationChannel> = {
  inApp: inAppChannel,
  email: emailChannel,
  telegram: telegramChannel,
  push: pushChannel,
};

export function getChannel(name: string): NotificationChannel | undefined {
  return CHANNELS[name];
}

export type { NotificationChannel, ChannelRecipient, ChannelSendResult, ChannelName } from './types';
