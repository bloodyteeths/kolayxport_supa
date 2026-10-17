import { useLocale } from 'next-intl';
import { useRouter } from 'next/router';
import SiteLayout from './site/SiteLayout';

// Public pages rendered through this wrapper that should be indexed (everything else here is
// a system page: login, logout, auth, 404, errors).
const INDEXABLE = new Set([]);

/**
 * Wrapper for public pages outside the marketing content system (pricing, login, auth, errors).
 * Same header/footer as the marketing site, in the visitor's UI language.
 */
export default function PublicLayout({ children, title, description = '', seo = {} }) {
  const locale = useLocale() === 'en' ? 'en' : 'tr';
  const router = useRouter();
  const noindex = seo.noindex ?? !INDEXABLE.has(router.pathname);
  return (
    <SiteLayout locale={locale} seo={{ title: title || 'KolayXport', description, path: router.pathname, noindex }}>
      {children}
    </SiteLayout>
  );
}
