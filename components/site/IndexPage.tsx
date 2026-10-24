import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NextSeo } from 'next-seo';
import { SITE_URL } from '@/lib/site/company';
import { ArrowRight } from 'lucide-react';
import type { ContentType } from '@/lib/site/content';
import { localePath, type SiteLocale } from '@/lib/site/routes';
import { breadcrumbs } from '@/lib/site/schema';
import { HOWTO_VIDEOS, type HowtoVideo } from '@/lib/site/howtoVideos';
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
      {type === 'guides' ? <HowtoVideos locale={locale} guideSlugs={cards.map((x) => x.slug)} /> : null}
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

/** Product videos, each next to its related how-to guide (lib/site/howtoVideos.ts). */
function HowtoVideos({ locale, guideSlugs }: { locale: SiteLocale; guideSlugs: string[] }) {
  const t = useTranslations('site.help.videos');
  const items = HOWTO_VIDEOS.filter((v) => v.youtube?.[locale] || v.file[locale]);
  if (!items.length) return null;
  return (
    <Section tone="white">
      <span id="videolar" className="block scroll-mt-24" />
      <Heading title={t('title')} lead={t('lead')} />
      <ul className="mt-10 grid gap-10 lg:grid-cols-2">
        {items.map((v) => (
          <li key={v.key} className={v.shape === 'wide' ? 'lg:col-span-2' : ''}>
            <h3 className="display text-[24px] leading-tight">{t(`items.${v.key}.title` as any)}</h3>
            <p className="mt-2 text-ink-soft">{t(`items.${v.key}.caption` as any)}</p>
            <div className={`mt-5 ${v.shape === 'tall' ? 'mx-auto max-w-[340px]' : ''}`}><VideoPlayer v={v} locale={locale} label={t(`items.${v.key}.title` as any)} /></div>
            {v.guide && guideSlugs.includes(v.guide) ? (
              <Link prefetch={false} href={localePath(locale, `/nasil-kullanirim/${v.guide}`)} className="mt-4 inline-block text-sm font-semibold text-kx">
                {t('related')} <ArrowRight size={14} className="inline" aria-hidden />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function VideoPlayer({ v, locale, label }: { v: HowtoVideo; locale: SiteLocale; label: string }) {
  const aspect = v.shape === 'tall' ? 'aspect-[9/16]' : 'aspect-video';
  const yt = v.youtube?.[locale];
  if (yt) {
    return (
      <div className={`site-shot ${aspect} overflow-hidden`}>
        <iframe
          className="h-full w-full"
          src={`https://www.youtube-nocookie.com/embed/${yt}?rel=0&cc_load_policy=1&cc_lang_pref=${locale}&hl=${locale}`}
          title={label}
          loading="lazy"
          allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    );
  }
  const src = `/media/demos/${v.file[locale]}`;
  return (
    <video className={`site-shot ${aspect} w-full bg-ink`} controls playsInline preload="none" poster={`${src}.jpg`} aria-label={label}>
      <source src={`${src}.mp4`} type="video/mp4" />
    </video>
  );
}
