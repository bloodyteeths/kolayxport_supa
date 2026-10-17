import { listContent } from './content';
import { photos, screens } from './media';
import { HOME_INTEGRATIONS } from './homeData';
import { testimonials } from './testimonials';
import type { SiteLocale } from './routes';

export async function homeStaticProps(locale: SiteLocale) {
  const docs = listContent(locale, 'integrations');
  const integrations = HOME_INTEGRATIONS
    .map((slug) => docs.find((d) => d.slug === slug))
    .filter(Boolean)
    .map((d) => ({ slug: d!.slug, name: String(d!.meta.name || d!.slug), kind: String(d!.meta.kind || 'marketplace'), status: String(d!.meta.status || 'production') }));
  return {
    props: {
      locale,
      integrations,
      testimonials: testimonials(locale),
      shots: await screens(['etsy-listings', 'etsy-listings-mobile', 'orders', 'orders-mobile', 'listing-editor', 'research', 'arbitrage', 'labels', 'stock-sync'], locale),
      photos: await photos(['hero-packing', 'textile-workshop']),
    },
  };
}
