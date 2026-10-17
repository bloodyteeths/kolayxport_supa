// Public marketing routes. Turkish is the default (no prefix); English lives under /en with the same slugs.
export type SiteLocale = 'tr' | 'en';

/** Path for a locale: localePath('en', '/cozumler/etsy-satici') → '/en/cozumler/etsy-satici'; home → '/' or '/en'. */
export function localePath(locale: SiteLocale, path: string): string {
  const p = path === '/' ? '' : path;
  if (locale === 'tr') return p || '/';
  return `/en${p}`;
}

/** Use-case pages shown in the header/footer (labels: messages site.cases.<key>). Order = menu order. */
export const CASES = [
  'etsy-satici',
  'ebay-satici',
  'trendyoldan-dunyaya',
  'ai-ilan-optimizasyonu',
  'urun-arastirma-arbitraj',
  'mikro-ihracat-kargo-etgb',
] as const;

export const LEGAL = [
  'kvkk-aydinlatma-metni',
  'cerez-politikasi',
  'gizlilik-politikasi',
  'kullanim-sartlari',
  'mesafeli-satis-sozlesmesi',
  'on-bilgilendirme-formu',
] as const;

export const SIGNUP_HREF = '/login?mode=signup';

/** Signup link that keeps the landing page's campaign context (utm_* are kept by lib/tracking). */
export function signupHref(from?: string): string {
  return from ? `${SIGNUP_HREF}&from=${encodeURIComponent(from)}` : SIGNUP_HREF;
}
