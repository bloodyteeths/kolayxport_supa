// getStaticPaths / getStaticProps builders for content-driven marketing pages (server-only).
import { contentCards, contentSlugs, getContent, type ContentType } from './content';
import { photo, screen, type Asset } from './media';
import type { SiteLocale } from './routes';

/** Turkish base path per content type; English = /en + base. Legal pages live at the root. */
export const BASE: Record<ContentType, string> = {
  cases: '/cozumler',
  integrations: '/entegrasyonlar',
  compare: '/karsilastirma',
  guides: '/nasil-kullanirim',
  blog: '/blog',
  legal: '',
};

export function docPaths(locale: SiteLocale, type: ContentType, param = 'slug') {
  return { paths: contentSlugs(locale, type).map((s) => ({ params: { [param]: s } })), fallback: false as const };
}

export async function docProps(locale: SiteLocale, type: ContentType, slug: string) {
  const doc = getContent(locale, type, slug);
  if (!doc) return { notFound: true as const };
  // Local tutorial videos are not in git (YouTube hosts them): only reference a file that exists.
  if (type === 'guides' && doc.meta.video?.file) {
    const fs = require('fs');
    const p = require('path');
    if (!fs.existsSync(p.join(process.cwd(), 'public/media/tutorials', `${doc.meta.video.file}.mp4`))) doc.meta.video = { ...doc.meta.video, file: null };
  }
  const [heroPhoto, heroShot, heroShotMobile] = await Promise.all([photo(doc.meta.image), screen(doc.meta.screenshot, locale), screen(doc.meta.screenshot ? `${doc.meta.screenshot}-mobile` : null, locale)]);
  const related = type === 'cases' || type === 'integrations' ? contentCards(locale, type).filter((d) => d.slug !== slug).slice(0, 3) : [];
  const ogPath = `/og/${locale}/${type}/${slug}.png`;
  return {
    props: {
      locale,
      type,
      doc,
      path: `${BASE[type]}/${slug}`,
      heroPhoto: heroPhoto as Asset | null,
      heroShot: heroShot as Asset | null,
      heroShotMobile: heroShotMobile as Asset | null,
      related,
      ogImage: require('fs').existsSync(require('path').join(process.cwd(), 'public', ogPath)) ? ogPath : null,
    },
  };
}

export function indexProps(locale: SiteLocale, type: ContentType) {
  return { props: { locale, type, cards: contentCards(locale, type), path: BASE[type] } };
}
