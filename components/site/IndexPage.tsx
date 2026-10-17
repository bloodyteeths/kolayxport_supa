import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NextSeo } from 'next-seo';
import { SITE_URL } from '@/lib/site/company';
import { ArrowRight } from 'lucide-react';
import type { ContentType } from '@/lib/site/content';
import { localePath, type SiteLocale } from '@/lib/site/routes';
import { breadcrumbs } from '@/lib/site/schema';
import SiteLayout from './SiteLayout';
import { Section, Heading, CtaBand } from './Blocks';

const NS: Record<string, string> = { cases: 'casesIndex', integrations: 'integrationsIndex', compare: 'compare', guides: 'help', blog: 'blog' };

export interface IndexPageProps {
  locale: SiteLocale;
  type: ContentType;
  path: string;
  cards: { slug: string; meta: Record<string, any> }[];
}

export default function IndexPage({ locale, type, path, cards }: IndexPageProps) {
  return (
    <SiteLayout locale={locale} seo={{ title: '', description: '', path, hasTwin: true }}>
      <IndexBody locale={locale} type={type} path={path} cards={cards} />
    </SiteLayout>
  );
}

function IndexBody({ locale, type, path, cards }: IndexPageProps) {
  const t = useTranslations(`site.${NS[type]}`);
  const c = useTranslations('site.common');
  const f = useTranslations('site.home.final');
  const href = (p: string) => localePath(locale, p);
  return (
    <>
      <IndexSeo locale={locale} path={path} title={t('seoTitle')} description={t('seoDescription')} crumb={t('title')} />
      <Section>
        <Heading as="h1" title={t('title')} lead={t('lead')} />
        {cards.length === 0 ? <p className="mt-10 text-ink-soft">{type === 'guides' ? t('empty') : ''}</p> : null}
        {type === 'integrations' ? (
          <IntegrationGroups cards={cards} href={href} />
        ) : (
          <ul className={`mt-12 grid gap-5 ${type === 'blog' ? 'md:grid-cols-2' : 'md:grid-cols-2 lg:grid-cols-3'}`}>
            {cards.map(({ slug, meta }) => (
              <li key={slug}>
                <Link prefetch={false} href={href(`${path}/${slug}`)} className="group flex h-full flex-col rounded-2xl border border-line bg-white p-6 transition-colors hover:border-ink">
                  {meta.eyebrow ? <span className="site-tag self-start">{meta.eyebrow}</span> : null}
                  {type === 'blog' ? <span className="text-sm text-ink-mute">{meta.date}</span> : null}
                  <span className="display mt-4 text-[24px] leading-tight text-ink">{meta.h1 || meta.title}</span>
                  <span className="mt-3 text-ink-soft">{meta.subtitle || meta.description}</span>
                  <span className="mt-auto pt-6 text-sm font-semibold text-kx">{c('readMore')} <ArrowRight size={14} className="inline transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <CtaBand title={f('title')} text={f('text')} />
    </>
  );
}

function IntegrationGroups({ cards, href }: { cards: { slug: string; meta: Record<string, any> }[]; href: (p: string) => string }) {
  const c = useTranslations('site.common');
  const groups = ['marketplace', 'carrier', 'accounting', 'tool'].map((k) => ({ k, items: cards.filter((x) => (x.meta.kind || 'marketplace') === k) })).filter((g) => g.items.length);
  return (
    <div className="mt-12 grid gap-12">
      {groups.map((g) => (
        <div key={g.k}>
          <h2 className="text-sm font-semibold uppercase tracking-[.14em] text-ink-mute">{c(`kinds.${g.k}` as any)}</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {g.items.map(({ slug, meta }) => (
              <li key={slug}>
                <Link prefetch={false} href={href(`/entegrasyonlar/${slug}`)} className="flex h-full flex-col rounded-2xl border border-line bg-white p-6 hover:border-ink">
                  <span className="flex items-center justify-between">
                    <span className="display text-[26px]">{meta.name}</span>
                    <span className="rounded-full bg-paper-2 px-2.5 py-1 text-xs font-semibold text-ink-soft">{c(`maturity.${meta.status || 'production'}` as any)}</span>
                  </span>
                  <span className="mt-3 text-sm text-ink-soft">{meta.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Index pages get their SEO from translations, so it is set inside the intl provider. */
function IndexSeo({ locale, path, title, description, crumb }: { locale: SiteLocale; path: string; title: string; description: string; crumb: string }) {
  const data = breadcrumbs([{ name: locale === 'tr' ? 'Ana sayfa' : 'Home', path: localePath(locale, '/') }, { name: crumb, path: localePath(locale, path) }]);
  return (
    <>
      <NextSeo title={title} description={description} openGraph={{ title, description, url: `${SITE_URL}${localePath(locale, path)}` }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} />
    </>
  );
}
