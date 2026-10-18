// lib/billing/playClient.ts — "running inside the Google Play app" (the TWA in mobile/android-twa).
// Google Play's payments policy: the Android app sells nothing and never points at a web checkout, so every
// price, plan upsell and credit-pack purchase is hidden there, the same way Shopify-connected accounts never
// see Stripe (isNeutralBilling). The TWA opens `/app?src=play` (its referrer is android-app://<package>);
// markPlayClient() turns that into a long-lived cookie so later pages, reloads and the API routes know too.
export const PLAY_PACKAGE = 'com.kolayxport.app';
export const PLAY_COOKIE = 'kx_client';
const PLAY_VALUE = 'play';
const COOKIE_RE = new RegExp(`(?:^|;\\s*)${PLAY_COOKIE}=${PLAY_VALUE}(?:;|$)`);

/** Client: true inside the Play app. Always false on the server (use isPlayRequest there). */
export function isPlayClient(): boolean {
  if (typeof document === 'undefined') return false;
  return COOKIE_RE.test(document.cookie);
}

/** Client, once per page load: remembers the Play app launch (?src=play or the TWA referrer) for 400 days. */
export function markPlayClient(): void {
  if (typeof window === 'undefined' || isPlayClient()) return;
  let fromPlay = false;
  try {
    fromPlay = new URLSearchParams(window.location.search).get('src') === PLAY_VALUE
      || document.referrer.startsWith(`android-app://${PLAY_PACKAGE}`);
  } catch {
    return;
  }
  if (!fromPlay) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PLAY_COOKIE}=${PLAY_VALUE}; Path=/; Max-Age=${400 * 86_400}; SameSite=Lax${secure}`;
}

/** Server: the request came from the Play app (API routes refuse checkout / portal / credit purchases). */
export function isPlayRequest(req: { cookies?: Partial<Record<string, string>> }): boolean {
  return req.cookies?.[PLAY_COOKIE] === PLAY_VALUE;
}
