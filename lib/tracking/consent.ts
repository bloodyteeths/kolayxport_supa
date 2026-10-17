// KVKK-compliant cookie consent + Google Consent Mode v2 (docs/gtm/tracking/README.md).
// Default is "denied" for everything non-essential (set inline in pages/_document.js before GTM loads).
// The choice is stored in localStorage (UI) and in the `kx_consent` cookie (so server-side events —
// Meta CAPI, GA4 Measurement Protocol — can respect it).

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  /** ISO timestamp of the decision. */
  at: string;
  v: 1;
}

const KEY = 'kx-consent';
const COOKIE = 'kx_consent';
export const OPEN_EVENT = 'kx:open-cookie-preferences';
export const CHANGE_EVENT = 'kx:consent-changed';

type GtagFn = (...args: unknown[]) => void;
declare global {
  interface Window { dataLayer?: unknown[]; gtag?: GtagFn }
}

export function readConsent(): ConsentState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && v.v === 1 ? v : null;
  } catch {
    return null;
  }
}

/** Cookie value: "a1m0" = analytics on, marketing off. Parsed by lib/tracking/server.ts. */
export function consentCookieValue(c: Pick<ConsentState, 'analytics' | 'marketing'>): string {
  return `a${c.analytics ? 1 : 0}m${c.marketing ? 1 : 0}`;
}

export function parseConsentCookie(value: string | undefined | null): { analytics: boolean; marketing: boolean } {
  const m = /^a([01])m([01])$/.exec(value || '');
  return { analytics: m?.[1] === '1', marketing: m?.[2] === '1' };
}

export function applyConsent(c: Pick<ConsentState, 'analytics' | 'marketing'>) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  const gtag: GtagFn = window.gtag || function gtag() { window.dataLayer!.push(arguments); };
  gtag('consent', 'update', {
    analytics_storage: c.analytics ? 'granted' : 'denied',
    ad_storage: c.marketing ? 'granted' : 'denied',
    ad_user_data: c.marketing ? 'granted' : 'denied',
    ad_personalization: c.marketing ? 'granted' : 'denied',
  });
  window.dataLayer.push({ event: 'consent_update', consent_analytics: c.analytics, consent_marketing: c.marketing });
}

export function saveConsent(c: Pick<ConsentState, 'analytics' | 'marketing'>): ConsentState {
  const state: ConsentState = { analytics: c.analytics, marketing: c.marketing, at: new Date().toISOString(), v: 1 };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: the cookie below still carries the choice for this session */
  }
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${COOKIE}=${consentCookieValue(state)}; Path=/; Max-Age=${60 * 60 * 24 * 180}; SameSite=Lax${secure}`;
  applyConsent(state);
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: state }));
  return state;
}

/** Re-open the preferences dialog (footer link "Çerez tercihleri"). */
export function openCookiePreferences() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(OPEN_EVENT));
}
