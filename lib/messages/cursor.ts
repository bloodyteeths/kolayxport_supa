// lib/messages/cursor.ts — messages §6.1. The list cursor is base64url JSON `{ t, w }`:
//   t = next Trendyol page (number) or null when Trendyol is exhausted / not part of the request,
//   w = next Wix contacts cursor ('' = first page) or null when Wix is exhausted.
// `nextCursor` is null when both sources are exhausted. Pure, no I/O.

export interface InboxCursor {
  t: number | null;
  w: string | null;
}

/** The cursor of the first page (no `cursor` param). */
export const START_CURSOR: InboxCursor = { t: 0, w: '' };

function toBase64Url(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(b64 + '='.repeat((4 - (b64.length % 4)) % 4), 'base64').toString('utf8');
}

/** Encodes a cursor; returns null when both sources are exhausted. */
export function encodeCursor(c: InboxCursor): string | null {
  if (c.t === null && c.w === null) return null;
  return toBase64Url(JSON.stringify({ t: c.t, w: c.w }));
}

/**
 * Decodes a `cursor` query param. Absent/empty → START_CURSOR. Malformed → null (the route answers 400
 * `{ code: 'badCursor' }`).
 */
export function decodeCursor(raw: string | string[] | undefined | null): InboxCursor | null {
  if (raw == null || raw === '') return { ...START_CURSOR };
  if (Array.isArray(raw)) return null;
  try {
    const v = JSON.parse(fromBase64Url(raw)) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const { t, w } = v as { t?: unknown; w?: unknown };
    const tOk = t === null || (typeof t === 'number' && Number.isInteger(t) && t >= 0);
    const wOk = w === null || typeof w === 'string';
    if (!tOk || !wOk) return null;
    return { t: t as number | null, w: w as string | null };
  } catch {
    return null;
  }
}

/** Next Trendyol page, or null when `page` was the last one. */
export function nextTrendyolPage(page: number, totalPages: number | undefined | null, received: number, size: number): number | null {
  if (typeof totalPages === 'number' && Number.isFinite(totalPages)) return page + 1 < totalPages ? page + 1 : null;
  // No totalPages in the payload: a short page means the end.
  return received >= size ? page + 1 : null;
}
