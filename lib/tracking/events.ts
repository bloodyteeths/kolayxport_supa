// Funnel event schema shared by the marketing site and the app (docs/gtm/tracking/README.md).
// Client events go to the GTM dataLayer; GTM forwards them to GA4 / Meta / X / TikTok / LinkedIn
// only when consent allows. The same `event_id` is sent server-side (lib/tracking/server.ts) for dedupe.

export type FunnelEvent =
  | 'page_view'
  | 'view_pricing'
  | 'start_signup'
  | 'sign_up'
  | 'connect_marketplace'
  | 'first_listing_optimized'
  | 'start_trial'
  | 'begin_checkout'
  | 'purchase'
  | 'contact_submit'
  | 'cta_click';

export interface EventParams {
  /** For dedupe with the server-side copy of the same event. */
  event_id?: string;
  marketplace?: string;
  plan?: string;
  interval?: 'month' | 'year';
  currency?: string;
  value?: number;
  location?: string;
  [key: string]: unknown;
}

export function newEventId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function track(event: FunnelEvent, params: EventParams = {}): string {
  const event_id = params.event_id || newEventId();
  if (typeof window !== 'undefined') {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, ...params, event_id });
  }
  return event_id;
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'ttclid'] as const;
const UTM_STORE = 'kx-utm';

/** First-touch attribution: keep the first utm_* / click ids seen in this browser for 90 days. */
export function captureAttribution(search: string) {
  if (typeof window === 'undefined') return;
  try {
    const p = new URLSearchParams(search);
    const found: Record<string, string> = Object.fromEntries(UTM_KEYS.map((k) => [k, p.get(k)]).filter(([, v]) => v));
    // Partner links (?ref=, docs/gtm/referral-spec.md): keep the code, and tag them for GA4 when no utm_* is set.
    const ref = p.get('ref');
    if (ref && /^[A-Za-z0-9-]{3,20}$/.test(ref)) {
      const code = ref.toUpperCase();
      found.ref = code;
      if (!UTM_KEYS.some((k) => k.startsWith('utm_') && found[k])) {
        found.utm_source = 'partner';
        found.utm_content = `ref-${code.toLowerCase()}`;
      }
    }
    if (!Object.keys(found).length) return;
    const prev = JSON.parse(window.localStorage.getItem(UTM_STORE) || 'null');
    if (prev && Date.now() - prev.at < 90 * 864e5) return;
    window.localStorage.setItem(UTM_STORE, JSON.stringify({ ...found, landing: window.location.pathname, at: Date.now() }));
  } catch {
    /* storage blocked */
  }
}

export function readAttribution(): Record<string, string> | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = JSON.parse(window.localStorage.getItem(UTM_STORE) || 'null');
    if (!v) return null;
    const { at, ...rest } = v;
    return rest;
  } catch {
    return null;
  }
}
