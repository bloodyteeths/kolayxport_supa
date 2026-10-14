/** Client shapes returned by the W3 listing-intel APIs (pages/api/etsy/*). */

export type ListingVersionItem = {
  id: string;
  shopId: string;
  listingId: string;
  remoteUpdatedTs: number;
  capturedAt: string;
  source: string;
  attribution: 'external' | 'kolayxport_draft' | 'kolayxport_stock' | 'unknown' | string;
  draftId: string | null;
  batchKey: string | null;
  changedKeys: string[];
  diff: Record<string, any>;
  state: string | null;
  isTombstone: boolean;
  baseline: boolean;
  restorable: boolean;
};

export type ActivityItem = ListingVersionItem & {
  listing: { title: string | null; thumbnail: string | null; state: string | null; url: string | null; exists: boolean };
};

export type CacheStatus = {
  lastChangeAt: string | null;
  lastCheckAt: string | null;
  live: boolean;
  mode: 'live' | 'polling';
  checkIntervalMinutes: number | null;
  needsReauth: boolean;
};

export const ATTRIBUTION_COLORS: Record<string, { bg: string; fg: string }> = {
  external: { bg: '#FEF3C7', fg: '#92400E' },
  kolayxport_draft: { bg: '#DBEAFE', fg: '#1E40AF' },
  kolayxport_stock: { bg: '#DCFCE7', fg: '#166534' },
  unknown: { bg: '#F1F5F9', fg: '#334155' },
};

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: 'same-origin', ...init });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: any = new Error(body?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.key = body?.key;
    err.body = body;
    throw err;
  }
  return body as T;
}
