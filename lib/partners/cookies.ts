// lib/partners/cookies.ts — first-touch attribution cookies (docs/gtm/referral-spec.md §2.1). Pure and edge-safe:
// used by middleware.js (Edge runtime, no Buffer) to set them and by the API (lib/partners/acquisition.ts) to read.
//   kx_ref = <CODE>|<epochSeconds>            partner code from ?ref=
//   kx_ft  = base64url(JSON {utm…, landing, at}) first UTM touch
// Both: Path=/; Max-Age=90 days; SameSite=Lax; Secure; HttpOnly. First touch wins: never overwritten.

export const REF_COOKIE = 'kx_ref';
export const FT_COOKIE = 'kx_ft';
export const ATTR_MAX_AGE = 7_776_000; // 90 days, seconds

const REF_RE = /^[A-Za-z0-9-]{3,20}$/;
export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];

export interface FirstTouch {
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  landing?: string;
  /** epoch seconds */
  at?: number;
}

export interface RefTouch {
  code: string;
  /** epoch seconds */
  at: number | null;
}

/** Upper-cased partner code when the format is valid, else null. */
export function normalizeRefCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  return REF_RE.test(v) ? v.toUpperCase() : null;
}

export function buildRefCookieValue(code: string, nowSec: number): string {
  return `${code}|${nowSec}`;
}

export function parseRefCookie(value: string | undefined | null): RefTouch | null {
  if (!value) return null;
  const [rawCode, rawAt] = decodeURIComponent(value).split('|');
  const code = normalizeRefCode(rawCode);
  if (!code) return null;
  const at = Number(rawAt);
  return { code, at: Number.isFinite(at) && at > 0 ? Math.floor(at) : null };
}

const toB64Url = (s: string) => {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64Url = (s: string) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

const clip = (v: unknown, max = 100): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

/** Keeps only known fields; null when there is no UTM value at all. */
export function sanitizeFirstTouch(raw: unknown): FirstTouch | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: FirstTouch = {};
  for (const k of UTM_KEYS) {
    const v = clip(r[k]);
    if (v) out[k] = v;
  }
  if (!UTM_KEYS.some((k) => out[k])) return null;
  const landing = clip(r.landing, 200);
  if (landing && landing.startsWith('/')) out.landing = landing;
  if (typeof r.at === 'number' && Number.isFinite(r.at) && r.at > 0) out.at = Math.floor(r.at);
  return out;
}

/** The first UTM touch from a request URL, or null when the URL carries no utm_* value. */
export function firstTouchFromUrl(url: URL, nowSec: number): FirstTouch | null {
  const raw: Record<string, unknown> = { landing: url.pathname, at: nowSec };
  for (const k of UTM_KEYS) raw[k] = url.searchParams.get(k) ?? undefined;
  return sanitizeFirstTouch(raw);
}

/** base64url JSON, kept under 600 bytes (values were already trimmed to 100 chars). */
export function buildFtCookieValue(ft: FirstTouch): string | null {
  const v = toB64Url(JSON.stringify(ft));
  return v.length <= 600 ? v : null;
}

export function parseFtCookie(value: string | undefined | null): FirstTouch | null {
  if (!value) return null;
  try {
    return sanitizeFirstTouch(JSON.parse(fromB64Url(value)));
  } catch {
    return null;
  }
}

/** Requests the middleware must never touch (frozen MCP / OAuth / Shopify review surfaces, assets, bots). */
const SKIP_PREFIXES = ['/api', '/oauth', '/.well-known', '/_next', '/auth', '/static', '/images', '/assets', '/demo', '/marketing'];
const ASSET_RE = /\.(?:png|jpe?g|gif|webp|svg|ico|css|js|map|txt|xml|json|webmanifest|woff2?|ttf|mp4|pdf)$/i;
const BOT_RE = /bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|python-requests|headless/i;

export function shouldCaptureRequest(method: string, pathname: string, userAgent: string | null): boolean {
  if (method !== 'GET') return false;
  if (SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return false;
  if (ASSET_RE.test(pathname)) return false;
  if (userAgent && BOT_RE.test(userAgent)) return false;
  return true;
}
