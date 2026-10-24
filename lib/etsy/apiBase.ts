// lib/etsy/apiBase.ts — the Etsy Open API v3 base that every server-side Etsy client uses.
// ETSY_API_BASE_URL overrides it for a local demo or a sandbox (e.g. http://localhost:3999/v3/application); it is unset
// in production. Plain http is accepted only for localhost, so a typo can never send seller tokens in clear text;
// anything invalid falls back to real Etsy. OAuth (api.etsy.com/v3/public/oauth) is not affected.
export const ETSY_DEFAULT_API_BASE = 'https://openapi.etsy.com/v3/application';

export function resolveEtsyApiBase(raw: string | undefined = process.env.ETSY_API_BASE_URL): string {
  const v = (raw ?? '').trim().replace(/\/+$/, '');
  if (!v) return ETSY_DEFAULT_API_BASE;
  try {
    const u = new URL(v);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
    if (u.protocol === 'https:' || (u.protocol === 'http:' && local)) return v;
  } catch {
    /* invalid URL: real Etsy */
  }
  return ETSY_DEFAULT_API_BASE;
}

/** `https://openapi.etsy.com/v3/application` unless ETSY_API_BASE_URL overrides it (read once at startup). */
export const ETSY_OPENAPI_BASE = resolveEtsyApiBase();

/** Loud on purpose: a non-default base receives sellers' Etsy bearer tokens, so it must never go unnoticed. */
export function etsyBaseWarning(base: string, raw: string | undefined): string | null {
  if (base !== ETSY_DEFAULT_API_BASE) return `[etsy] WARNING: ETSY_API_BASE_URL is set, Etsy API calls (with seller tokens) go to ${base}, not real Etsy`;
  if ((raw ?? '').trim()) return `[etsy] WARNING: ETSY_API_BASE_URL="${raw}" was rejected (https, or http on localhost only); using real Etsy`;
  return null;
}
const warning = etsyBaseWarning(ETSY_OPENAPI_BASE, process.env.ETSY_API_BASE_URL);
if (warning) console.warn(warning);
