// JSON-LD builders for marketing pages (schema.org). Render with <JsonLd data={...} />.
import { COMPANY, SITE_URL } from './company';
import { PLAN_PRICES } from '@/lib/billing/price';
import { DECIDED_TRIAL_DAYS } from '@/lib/billing/planLimits';

export function organization() {
  const a = COMPANY.address;
  const sameAs = Object.values(COMPANY.social).filter(Boolean);
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: COMPANY.brand,
    legalName: COMPANY.legalName,
    url: SITE_URL,
    logo: `${SITE_URL}/brand/kolayxport-symbol-512.png`,
    email: COMPANY.email,
    foundingDate: COMPANY.foundingDate,
    taxID: COMPANY.taxNumber,
    address: { '@type': 'PostalAddress', streetAddress: a.street, addressLocality: a.district, addressRegion: a.city, postalCode: a.postalCode, addressCountry: a.country },
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function website() {
  return { '@context': 'https://schema.org', '@type': 'WebSite', '@id': `${SITE_URL}/#website`, url: SITE_URL, name: COMPANY.brand, publisher: { '@id': `${SITE_URL}/#organization` }, inLanguage: ['tr', 'en'] };
}

/** SoftwareApplication with the real list prices (lib/billing/price.ts) and the real trial length. */
export function softwareApplication(locale: 'tr' | 'en') {
  const offers = (['starter', 'growth', 'pro'] as const).map((plan) => ({
    '@type': 'Offer',
    name: plan.charAt(0).toUpperCase() + plan.slice(1),
    price: String(PLAN_PRICES[plan].try.month),
    priceCurrency: 'TRY',
    url: `${SITE_URL}/fiyatlandirma`,
    category: 'subscription',
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: COMPANY.brand,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: SITE_URL,
    inLanguage: locale,
    description: locale === 'tr'
      ? `Etsy, eBay ve Amazon'da yurt dışına satan satıcılar için ilan optimizasyonu, ürün araştırması, kargo etiketi ve ETGB. ${DECIDED_TRIAL_DAYS} gün ücretsiz deneme, kredi kartı gerekmez.`
      : `Listing optimisation, product research, shipping labels and export paperwork for sellers in Türkiye selling on Etsy, eBay and Amazon. ${DECIDED_TRIAL_DAYS}-day free trial, no card required.`,
    offers,
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function faqPage(items: { q: string; a: string }[]) {
  if (!items?.length) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map((i) => ({ '@type': 'Question', name: i.q, acceptedAnswer: { '@type': 'Answer', text: i.a } })),
  };
}

export function breadcrumbs(items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE_URL}${it.path}` })),
  };
}

export function article(opts: { title: string; description: string; path: string; date: string; updated?: string; image?: string | null; author: string; locale: string }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: opts.title,
    description: opts.description,
    datePublished: opts.date,
    dateModified: opts.updated || opts.date,
    inLanguage: opts.locale,
    mainEntityOfPage: `${SITE_URL}${opts.path}`,
    image: opts.image ? `${SITE_URL}${opts.image}` : `${SITE_URL}/og/default.png`,
    author: { '@type': 'Organization', name: opts.author },
    publisher: { '@id': `${SITE_URL}/#organization` },
  };
}

export function howTo(opts: { name: string; description: string; duration?: string; steps: { name: string; text: string; image?: string }[]; video?: { name: string; contentUrl?: string; embedUrl?: string; thumbnailUrl?: string; uploadDate?: string; duration?: string } | null }) {
  return {
    '@context': 'https://schema.org',
    '@type': 'HowTo',
    name: opts.name,
    description: opts.description,
    ...(opts.duration ? { totalTime: opts.duration } : {}),
    step: opts.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, name: s.name, text: s.text, ...(s.image ? { image: `${SITE_URL}${s.image}` } : {}) })),
    ...(opts.video ? { video: { '@type': 'VideoObject', ...opts.video } } : {}),
  };
}

export function videoObject(v: { name: string; description: string; thumbnailUrl: string; uploadDate: string; duration?: string; contentUrl?: string; embedUrl?: string }) {
  return { '@context': 'https://schema.org', '@type': 'VideoObject', ...v };
}
