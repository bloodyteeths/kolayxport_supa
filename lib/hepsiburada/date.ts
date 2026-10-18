/**
 * Hepsiburada date handling.
 *
 * OMS filters (`begindate`/`enddate`, claims `beginDate`/`endDate`) take `yyyy-MM-dd HH:mm` read as Turkey local
 * time. An ISO string is accepted and then matches nothing (200 + empty page), and a UTC value shifts the window 3h
 * early — both fail silently, so every OMS date goes through `hbDate`. Finance filters take ISO-8601.
 * Türkiye has been on permanent UTC+3 since 2016.
 */
const TR_OFFSET_MS = 3 * 60 * 60 * 1000;
const pad = (n: number) => String(n).padStart(2, '0');

export function hbDate(instant: Date | number | string): string {
  const d = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(d.getTime())) throw new TypeError(`hbDate: invalid date ${String(instant)}`);
  const t = new Date(d.getTime() + TR_OFFSET_MS);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}`;
}

/**
 * Parse a response timestamp. Values come as `…Z`, `…+03:00`, zone-less (`2018-12-21T09:34:47`, meaning Turkey time)
 * or with 7 fractional digits from .NET. Returns undefined instead of an Invalid Date.
 */
export function parseHbTimestamp(value: string | null | undefined): Date | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const v = value.trim().replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1');
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/.test(v);
  const ms = Date.parse(hasZone ? v : `${v}+03:00`);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

export function parseHbIso(value: string | null | undefined): string | undefined {
  return parseHbTimestamp(value)?.toISOString();
}
