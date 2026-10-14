/**
 * Telegram channel (owner W5) — INERT in this build.
 *
 * isConfigured() requires both TELEGRAM_BOT_TOKEN (env) and a linked
 * NotificationSettings.telegramChatId. There is no linking flow yet, so no
 * user has a chat id and nothing is ever sent; the preferences screen shows
 * Telegram as "coming soon".
 */
import { renderTitle, absoluteLink } from '../render';
import type { ChannelRecipient, NotificationChannel } from './types';

function configured(r: ChannelRecipient): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN) && Boolean(r.settings.telegramChatId);
}

export const telegramChannel: NotificationChannel = {
  name: 'telegram',
  isConfigured: configured,
  async send(r, n) {
    if (!configured(r)) return { ok: false, permanent: true, error: 'telegram_not_configured' };
    try {
      const locale = r.settings.locale === 'en' ? 'en' : 'tr';
      const url = absoluteLink(n.link);
      const text = `${renderTitle(n, locale)}${url ? `\n${url}` : ''}`;
      const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: r.settings.telegramChatId, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return { ok: true };
      // 400/403: chat gone or bot blocked — retrying will not help.
      return { ok: false, permanent: res.status === 400 || res.status === 403, error: `telegram_${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message.slice(0, 200) : 'telegram_threw' };
    }
  },
};
