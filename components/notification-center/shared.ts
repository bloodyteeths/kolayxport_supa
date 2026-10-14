/**
 * Client helpers for the notification center UI (owner W5). Browser-safe.
 */
import type { NotificationGroup } from '@/lib/notificationCenter/registry';
import { getTypeDef } from '@/lib/notificationCenter/registry';

export type ClientSeverity = 'info' | 'warning' | 'error';

/** Client view of one notification row (GET /api/notifications items[]). */
export interface CenterItem {
  id: string;
  type: string;
  severity: ClientSeverity;
  titleKey: string;
  params: Record<string, string | number> | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
  badge: boolean;
  resolvedAt: string | null;
  entityType: string | null;
  entityId: string | null;
}

export interface CenterPage {
  items: CenterItem[];
  unreadCount: number;
  nextCursor: string | null;
}

export const SEVERITY_COLOR: Record<ClientSeverity, { dot: string; bg: string; fg: string }> = {
  info: { dot: '#3b82f6', bg: '#eff6ff', fg: '#1d4ed8' },
  warning: { dot: '#f59e0b', bg: '#fffbeb', fg: '#b45309' },
  error: { dot: '#ef4444', bg: '#fef2f2', fg: '#b91c1c' },
};

const SEVERITIES: readonly ClientSeverity[] = ['info', 'warning', 'error'];

function sanitizeParams(raw: unknown): Record<string, string | number> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'boolean') out[k] = String(v);
  }
  return out;
}

/** Only same-origin relative paths are followed (no open redirects via stored links). */
export function safeLink(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  return s;
}

export function normalizeItem(raw: unknown): CenterItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.titleKey !== 'string') return null;
  return {
    id: r.id,
    type: typeof r.type === 'string' ? r.type : '',
    severity: SEVERITIES.includes(r.severity as ClientSeverity) ? (r.severity as ClientSeverity) : 'info',
    titleKey: r.titleKey,
    params: sanitizeParams(r.params),
    link: safeLink(r.link),
    readAt: typeof r.readAt === 'string' ? r.readAt : null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : new Date().toISOString(),
    badge: r.badge !== false,
    resolvedAt: typeof r.resolvedAt === 'string' ? r.resolvedAt : null,
    entityType: typeof r.entityType === 'string' ? r.entityType : null,
    entityId: typeof r.entityId === 'string' ? r.entityId : null,
  };
}

export function normalizePage(raw: unknown): CenterPage {
  if (!raw || typeof raw !== 'object') return { items: [], unreadCount: 0, nextCursor: null };
  const r = raw as Record<string, unknown>;
  const items = Array.isArray(r.items) ? (r.items.map(normalizeItem).filter(Boolean) as CenterItem[]) : [];
  return {
    items,
    unreadCount: typeof r.unreadCount === 'number' && Number.isFinite(r.unreadCount) ? Math.max(0, Math.floor(r.unreadCount)) : 0,
    nextCursor: typeof r.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null,
  };
}

export function groupOf(type: string): NotificationGroup | null {
  return getTypeDef(type)?.group ?? null;
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function relativeTime(iso: string, locale: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diffSec = Math.round((then - now) / 1000);
  let rtf: Intl.RelativeTimeFormat;
  try {
    rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
  } catch {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
  }
  for (const [unit, secs] of UNITS) {
    if (Math.abs(diffSec) >= secs) return rtf.format(Math.round(diffSec / secs), unit);
  }
  return rtf.format(0, 'minute');
}

export function absoluteTime(iso: string, locale: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Istanbul' }).format(d);
  } catch {
    return d.toISOString();
  }
}

/** Split into Today / Earlier (local calendar day of the viewer). */
export function splitByDay<T extends { createdAt: string }>(items: T[], now = new Date()): { today: T[]; earlier: T[] } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today: T[] = [];
  const earlier: T[] = [];
  for (const it of items) {
    const t = new Date(it.createdAt).getTime();
    (Number.isFinite(t) && t >= start.getTime() ? today : earlier).push(it);
  }
  return { today, earlier };
}

export const NOTIFICATIONS_API = '/api/notifications';
export const ACTIVITY_API = '/api/notifications/activity';
export const PREFERENCES_API = '/api/notifications/preferences';
