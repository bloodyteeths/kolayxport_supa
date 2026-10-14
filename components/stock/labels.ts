/** Small i18n helpers shared by the stock components (W2). */
type T = ((key: string, values?: Record<string, any>) => string) & { has?: (key: string) => boolean };

export function channelLabel(t: T, channel: string | null | undefined): string {
  const ch = String(channel || '');
  if (!ch) return '';
  const key = `channels.${ch}`;
  return t.has && !t.has(key) ? ch : t(key);
}

export function linkReasonLabel(t: T, reason: string | null | undefined): string | null {
  if (!reason) return null;
  const key = `link.reasons.${reason}`;
  if (t.has && t.has(key)) return t(key);
  if (reason.startsWith('listing_')) return t('link.reasons.unsupported');
  return reason;
}

export function fmtTime(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export const CHANNEL_COLORS: Record<string, string> = {
  etsy: '#F1641E',
  trendyol: '#F27A1A',
  shopify: '#5E8E3E',
  ebay: '#0064D2',
  wix: '#0C6EFC',
  amazon: '#FF9900',
  hepsiburada: '#FF6000',
};
