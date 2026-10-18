// lib/billing/playClient.ts — "running inside a store app": the Google Play app (the TWA in mobile/android-twa)
// or the Apple App Store app (the Capacitor shell in mobile/ios-app).
// Google Play's payments policy and App Store guideline 3.1.1: the apps sell nothing and never point at a web
// checkout, so every price, plan upsell and credit-pack purchase is hidden there, the same way Shopify-connected
// accounts never see Stripe (isNeutralBilling). The TWA opens `/app?src=play` (referrer android-app://<package>),
// the iOS app opens `/app?src=ios` (and carries the native Capacitor bridge); markPlayClient() turns that into a
// long-lived cookie so later pages, reloads and the API routes know too. The iOS app's WebView has its own cookie
// store, so the cookie never leaks into Safari.
export const PLAY_PACKAGE = 'com.kolayxport.app';
export const PLAY_COOKIE = 'kx_client';
export type StoreApp = 'play' | 'ios';
const STORE_APPS: readonly StoreApp[] = ['play', 'ios'];
const COOKIE_RE = new RegExp(`(?:^|;\\s*)${PLAY_COOKIE}=(play|ios)(?:;|$)`);

/** Client: which store app the page runs in, or null on the web. Always null on the server. */
export function storeApp(): StoreApp | null {
  if (typeof document === 'undefined') return null;
  const m = COOKIE_RE.exec(document.cookie);
  return m ? (m[1] as StoreApp) : null;
}

/** Client: true inside a store app (Google Play or App Store). Always false on the server (use isPlayRequest). */
export function isPlayClient(): boolean {
  return storeApp() !== null;
}

/** Client: true inside the App Store (iOS) app. */
export function isIosApp(): boolean {
  return storeApp() === 'ios';
}

function detectLaunch(): StoreApp | null {
  const src = new URLSearchParams(window.location.search).get('src');
  if (src === 'play' || src === 'ios') return src;
  if (document.referrer.startsWith(`android-app://${PLAY_PACKAGE}`)) return 'play';
  const cap = (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  if (cap?.getPlatform?.() === 'ios') return 'ios';
  return null;
}

/** Client, once per page load: remembers the store-app launch for 400 days. */
export function markPlayClient(): void {
  if (typeof window === 'undefined' || isPlayClient()) return;
  let app: StoreApp | null = null;
  try {
    app = detectLaunch();
  } catch {
    return;
  }
  if (!app) return;
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${PLAY_COOKIE}=${app}; Path=/; Max-Age=${400 * 86_400}; SameSite=Lax${secure}`;
}

/** Server: the request came from a store app (API routes refuse checkout / portal / credit purchases). */
export function isPlayRequest(req: { cookies?: Partial<Record<string, string>> }): boolean {
  return STORE_APPS.includes(req.cookies?.[PLAY_COOKIE] as StoreApp);
}
