import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight } from 'lucide-react';
import type { Asset } from '@/lib/site/media';
import { localePath, type SiteLocale } from '@/lib/site/routes';
import { softwareApplication, faqPage } from '@/lib/site/schema';
import { HOME_PAINS } from '@/lib/site/homeData';
import SiteLayout from './SiteLayout';
import { Shot, Photo, ManifestCard } from './Media';
import { Section, Heading, TrialCta, PainQuotes, Steps, Bullets, Faq, CtaBand } from './Blocks';
import PricingTeaser from './PricingTeaser';

export interface HomeProps {
  locale: SiteLocale;
  shots: Record<string, Asset | null>;
  photos: Record<string, Asset | null>;
  integrations: { slug: string; name: string; kind: string; status: string }[];
  testimonials: { quote: string; name: string; shop?: string | null }[];
}

export default function HomePage(props: HomeProps) {
  return (
    <SiteLayout
      locale={props.locale}
      seo={{
        title: props.locale === 'tr' ? 'KolayXport — Yurt dışına satışın tek paneli' : 'KolayXport — One dashboard for selling abroad',
        description: props.locale === 'tr'
          ? "Etsy, eBay ve Amazon'da satan Türk satıcılar için: yapay zekâ ile İngilizce ilan, ürün araştırması, FedEx/UPS etiketi, ETGB ve kâr raporu tek panelde. 14 gün ücretsiz."
          : 'For sellers in Türkiye on Etsy, eBay and Amazon: AI-written English listings, product research, FedEx/UPS labels, ETGB and profit reports in one place. 14 days free.',
        path: '/',
        hasTwin: true,
        ogImage: props.locale === 'en' ? '/og/default-en.png' : '/og/default.png',
      }}
      jsonLd={[softwareApplication(props.locale)]}
    >
      <HomeBody {...props} />
    </SiteLayout>
  );
}

function HomeBody({ locale, shots, photos, integrations, testimonials }: HomeProps) {
  const t = useTranslations('site.home');
  const c = useTranslations('site.common');
  const href = (p: string) => localePath(locale, p);
  const faq = t.raw('faq.items') as { q: string; a: string }[];
  const steps = t.raw('steps.items') as { title: string; text: string }[];
  const pillars = (['listings', 'research', 'ops'] as const).map((k) => ({
    key: k,
    eyebrow: t(`pillars.${k}.eyebrow`),
    title: t(`pillars.${k}.title`),
    text: t(`pillars.${k}.text`),
    bullets: t.raw(`pillars.${k}.bullets`) as string[],
    shot: shots[{ listings: 'listing-editor', research: 'research', ops: 'labels' }[k]] || shots[{ listings: 'etsy-listings', research: 'arbitrage', ops: 'orders' }[k]],
  }));
  const heroShot = shots['etsy-listings'] || shots['orders'];
  const heroShotMobile = shots['etsy-listings'] ? shots['etsy-listings-mobile'] : shots['orders-mobile'];
  const heroPhoto = photos['hero-packing'];

  return (
    <>
      <JsonLdFaq items={faq} />
      {/* HERO */}
      <section className="site-rules relative overflow-hidden">
        <div className="pointer-events-none absolute -right-40 -top-40 hidden h-[620px] w-[620px] rounded-full border-2 border-dashed border-kx/20 lg:block" aria-hidden />
        <div className="relative mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-16 pt-12 md:px-8 md:pb-24 md:pt-20 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="site-tag site-rise">{t('hero.eyebrow')}</p>
            <h1 className="display site-rise site-rise-2 mt-5 text-[44px] text-ink md:text-[72px]">{t('hero.title')}</h1>
            <p className="site-rise site-rise-3 mt-6 max-w-[34rem] text-lg leading-relaxed text-ink-soft md:text-[21px]">{t('hero.lead')}</p>
            <div className="site-rise site-rise-4 mt-8">
              <TrialCta secondary={{ href: '#nasil-calisir', label: t('hero.ctaSecondary') }} />
            </div>
          </div>
          <div className="relative">
            {heroPhoto ? (
              <>
                <Photo asset={heroPhoto} alt={t('hero.title')} label={c('illustration')} priority className="aspect-[4/3] lg:aspect-[5/4]" />
                {heroShot ? <Shot asset={heroShot} alt={c('screenAlt', { name: 'Etsy' })} className="absolute -bottom-10 -left-6 w-[70%] md:-left-10" /> : null}
              </>
            ) : heroShot ? (
              <Shot asset={heroShot} mobile={heroShotMobile} alt={c('screenAlt', { name: 'Etsy' })} priority />
            ) : (
              <ManifestCard lines={steps.map((s) => s.title)} stamp={t('hero.stamp')} className="lg:ml-8" />
            )}
          </div>
        </div>
      </section>

      {/* PAINS */}
      <Section tone="paper-2">
        <Heading title={t('pains.title')} lead={t('pains.lead')} />
        <div className="mt-10"><PainQuotes items={[...HOME_PAINS[locale]]} sourceLabel={c('painsSource')} /></div>
      </Section>

      {/* HOW IT WORKS */}
      <Section id="nasil-calisir">
        <Heading eyebrow={c('stepsTitle')} title={t('steps.title')} />
        <div className="mt-10"><Steps items={steps} /></div>
      </Section>

      {/* PILLARS */}
      <Section tone="white">
        <Heading title={t('pillars.title')} lead={t('pillars.lead')} />
        <div className="mt-14 grid gap-20 md:gap-28">
          {pillars.map((p, i) => (
            <div key={p.key} className={`grid items-center gap-10 lg:grid-cols-2 ${i % 2 ? 'lg:[&>*:first-child]:order-2' : ''}`}>
              <div>
                <p className="site-tag">{p.eyebrow}</p>
                <h3 className="display mt-4 text-[28px] text-ink md:text-[38px]">{p.title}</h3>
                <p className="mt-4 text-lg text-ink-soft">{p.text}</p>
                <Bullets items={p.bullets} />
              </div>
              <div>
                {p.shot ? <Shot asset={p.shot} alt={c('screenAlt', { name: p.eyebrow })} /> : <ManifestCard lines={p.bullets} stamp={p.eyebrow} />}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* TRENDYOL TRACK (positioning C) */}
      <Section tone="ink">
        <div className="grid items-center gap-10 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="site-tag !border-paper/20 !bg-paper/10 !text-paper">{t('trendyol.eyebrow')}</p>
            <h2 className="display mt-4 text-[30px] text-paper md:text-[46px]">{t('trendyol.title')}</h2>
            <p className="mt-5 text-lg text-paper/75">{t('trendyol.text')}</p>
            <Link href={href('/cozumler/trendyoldan-dunyaya')} className="btn-ghost btn-ghost-dark mt-8">{t('trendyol.cta')} <ArrowRight size={18} aria-hidden /></Link>
          </div>
          <div>
            {photos['textile-workshop'] ? <Photo asset={photos['textile-workshop']} alt={t('trendyol.title')} label={c('illustration')} className="aspect-[4/3]" /> : shots['stock-sync'] ? <Shot asset={shots['stock-sync']} alt={c('screenAlt', { name: 'Trendyol' })} /> : null}
          </div>
        </div>
      </Section>

      {/* INTEGRATIONS */}
      <Section>
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <Heading title={t('integrations.title')} lead={t('integrations.lead')} />
          <Link href={href('/entegrasyonlar')} className="font-semibold text-kx hover:underline">{t('integrations.all')} →</Link>
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {integrations.map((it) => (
            <li key={it.slug}>
              <Link href={href(`/entegrasyonlar/${it.slug}`)} className="group flex h-full flex-col justify-between rounded-2xl border border-line bg-white p-5 transition-colors hover:border-ink">
                <span className="text-xs font-semibold uppercase tracking-[.12em] text-ink-mute">{c(`kinds.${it.kind}` as any)}</span>
                <span className="display mt-6 text-[24px] text-ink">{it.name}</span>
                <span className="mt-2 text-xs font-medium text-ink-mute">{c(`maturity.${it.status}` as any)}</span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-ink-mute">{t('integrations.notYet')}</p>
      </Section>

      {/* PRICING */}
      <Section tone="paper-2">
        <PricingTeaser locale={locale} />
      </Section>

      {/* TESTIMONIALS: rendered only when real, consented entries exist (content/testimonials). */}
      {testimonials.length ? (
        <Section tone="white">
          <Heading title={t('testimonialsTitle')} />
          <ul className="mt-10 grid gap-5 md:grid-cols-3">
            {testimonials.map((q) => (
              <li key={q.quote} className="rounded-2xl border border-line bg-paper p-6">
                <blockquote className="display text-[20px] leading-snug" style={{ fontWeight: 500 }}>&ldquo;{q.quote}&rdquo;</blockquote>
                <p className="mt-4 text-sm font-semibold">{q.name}{q.shop ? <span className="font-normal text-ink-mute"> · {q.shop}</span> : null}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* TRUST (real, verifiable facts) */}
      <Section>
        <Heading title={t('trust.title')} />
        <ul className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {(t.raw('trust.items') as { title: string; text: string }[]).map((it) => (
            <li key={it.title} className="border-t-2 border-ink pt-5">
              <h3 className="text-lg font-semibold">{it.title}</h3>
              <p className="mt-2 text-ink-soft">{it.text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section tone="white"><Faq items={faq} title={c('faqTitle')} /></Section>

      <CtaBand title={t('final.title')} text={t('final.text')} />
    </>
  );
}

function JsonLdFaq({ items }: { items: { q: string; a: string }[] }) {
  // Rendered here (inside the intl provider) so the FAQ schema always matches the visible FAQ.
  const data = faqPage(items);
  return data ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }} /> : null;
}
