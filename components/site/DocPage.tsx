import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ArrowRight, Clock } from 'lucide-react';
import type { ContentDoc, ContentType } from '@/lib/site/content';
import type { Asset } from '@/lib/site/media';
import { localePath, type SiteLocale } from '@/lib/site/routes';
import { breadcrumbs, faqPage, article, howTo } from '@/lib/site/schema';
import SiteLayout from './SiteLayout';
import { Shot, Photo } from './Media';
import { Section, Heading, TrialCta, PainQuotes, Steps, FeatureList, Faq, StatusMark, Breadcrumbs, CtaBand, Prose } from './Blocks';

export interface DocPageProps {
  locale: SiteLocale;
  type: ContentType;
  doc: ContentDoc;
  path: string;
  heroPhoto: Asset | null;
  heroShot: Asset | null;
  heroShotMobile?: Asset | null;
  related: { slug: string; meta: Record<string, any> }[];
  ogImage: string | null;
}

function readMinutes(html: string) {
  return Math.max(1, Math.round(html.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length / 200));
}

export default function DocPage(props: DocPageProps) {
  const { locale, type, doc, path } = props;
  const m = doc.meta;
  const base = path.replace(/\/[^/]+$/, '');
  const crumbs = [
    { name: locale === 'tr' ? 'Ana sayfa' : 'Home', path: localePath(locale, '/') },
    ...(type === 'legal' ? [] : [{ name: crumbLabel(type, locale), path: localePath(locale, base) }]),
    { name: m.h1 || m.title, path: localePath(locale, path) },
  ];
  const faq = Array.isArray(m.faq) ? m.faq : [];
  const schema: (Record<string, unknown> | null)[] = [breadcrumbs(crumbs), faqPage(faq)];
  if (type === 'blog') {
    schema.push(article({ title: m.h1 || m.title, description: m.description, path: localePath(locale, path), date: m.date || m.updated, updated: m.updated, image: props.heroPhoto?.src, author: m.author || 'KolayXport', locale }));
  }
  if (type === 'guides' && Array.isArray(m.steps)) {
    schema.push(howTo({
      name: m.h1 || m.title,
      description: m.description,
      duration: m.duration,
      steps: m.steps.map((s: any) => (typeof s === 'string' ? { name: s, text: s } : { name: s.name, text: s.text, image: s.image ? `/${String(s.image).replace(/^\//, '')}` : undefined })),
      video: m.video?.youtubeId ? {
        name: m.h1 || m.title,
        embedUrl: `https://www.youtube-nocookie.com/embed/${m.video.youtubeId}`,
        thumbnailUrl: `https://i.ytimg.com/vi/${m.video.youtubeId}/hqdefault.jpg`,
        uploadDate: m.video.uploadDate || m.updated,
        duration: m.video.duration || m.duration,
      } : null,
    }));
  }

  return (
    <SiteLayout
      locale={locale}
      seo={{ title: m.title, description: m.description, path, hasTwin: doc.hasTwin, ogImage: props.ogImage, type: type === 'blog' ? 'article' : 'website' }}
      jsonLd={schema}
      keepInPlayApp={type === 'legal'}
    >
      <Body {...props} crumbs={crumbs} faq={faq} />
    </SiteLayout>
  );
}

function crumbLabel(type: ContentType, locale: SiteLocale) {
  const tr: Record<string, string> = { cases: 'Çözümler', integrations: 'Entegrasyonlar', compare: 'Karşılaştırmalar', guides: 'Nasıl kullanılır', blog: 'Blog' };
  const en: Record<string, string> = { cases: 'Solutions', integrations: 'Integrations', compare: 'Comparisons', guides: 'How-to guides', blog: 'Blog' };
  return (locale === 'tr' ? tr : en)[type] || '';
}

function Body({ locale, type, doc, heroPhoto, heroShot, heroShotMobile, related, crumbs, faq }: DocPageProps & { crumbs: { name: string; path: string }[]; faq: { q: string; a: string }[] }) {
  const c = useTranslations('site.common');
  const t = useTranslations('site');
  const m = doc.meta;
  const href = (p: string) => localePath(locale, p);
  const crumbItems = crumbs.map((x) => ({ href: x.path, label: x.name }));

  if (type === 'legal') {
    return (
      <Section>
        <Breadcrumbs items={crumbItems} />
        <h1 className="display mt-6 max-w-3xl text-[36px] md:text-[52px]">{m.h1 || m.title}</h1>
        <p className="mt-4 text-sm text-ink-mute">{t('legal.effective')}: {m.effective || m.updated}</p>
        {m.lawyerReviewed === false ? (
          <p className="mt-4 inline-flex rounded-xl border border-kx-cyan bg-kx-cyan-wash px-4 py-2 text-sm text-ink">{t('legal.draft')}</p>
        ) : null}
        <div className="mt-10"><Prose html={doc.html} /></div>
      </Section>
    );
  }

  if (type === 'blog') {
    return (
      <>
        <Section>
          <Breadcrumbs items={crumbItems} />
          <div className="mx-auto mt-8 max-w-[68ch]">
            <p className="text-sm text-ink-mute">{m.date} · {t('blog.readTime', { count: readMinutes(doc.html) })} · {t('blog.by')} {m.author || 'KolayXport'}</p>
            <h1 className="display mt-4 text-[36px] md:text-[54px]">{m.h1 || m.title}</h1>
            {heroPhoto ? <Photo asset={heroPhoto} alt={m.h1 || m.title} label={c('illustration')} className="mt-10 aspect-[16/9]" priority /> : null}
            <div className="mt-10"><Prose html={doc.html} /></div>
          </div>
        </Section>
        <CtaBand title={t('home.final.title')} text={t('home.final.text')} />
      </>
    );
  }

  if (type === 'guides') {
    const steps = Array.isArray(m.steps) ? m.steps : [];
    return (
      <>
        <Section>
          <Breadcrumbs items={crumbItems} />
          <div className="mt-8 grid gap-12 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              <h1 className="display text-[34px] md:text-[50px]">{m.h1 || m.title}</h1>
              {m.description ? <p className="mt-4 text-lg text-ink-soft">{m.description}</p> : null}
              {m.video?.youtubeId ? (
                <div className="site-shot mt-8 aspect-video">
                  <iframe
                    className="h-full w-full"
                    src={`https://www.youtube-nocookie.com/embed/${m.video.youtubeId}?rel=0`}
                    title={m.h1 || m.title}
                    loading="lazy"
                    allow="accelerometer; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                </div>
              ) : m.video?.file ? (
                <video className="site-shot mt-8 aspect-video w-full" controls preload="none" poster={`/media/tutorials/${m.video.file}.jpg`}>
                  <source src={`/media/tutorials/${m.video.file}.mp4`} type="video/mp4" />
                  <track kind="captions" srcLang={locale} src={`/media/tutorials/${m.video.file}.${locale}.vtt`} default />
                </video>
              ) : null}
              {steps.length ? (
                <ol className="mt-10 grid gap-6">
                  {steps.map((s: any, i: number) => (
                    <li key={i} className="grid gap-4 rounded-2xl border border-line bg-white p-6 md:grid-cols-[48px_1fr]">
                      <span className="display text-[34px] leading-none text-kx">{i + 1}</span>
                      <div>
                        <h2 className="text-lg font-semibold">{typeof s === 'string' ? s : s.name}</h2>
                        {typeof s === 'string' ? null : <p className="mt-1 text-ink-soft">{s.text}</p>}
                        {s.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={`/${String(s.image).replace(/^\//, '')}`} alt={s.name} loading="lazy" className="mt-4 rounded-xl border border-line" />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : null}
              <div className="mt-10"><Prose html={doc.html} /></div>
            </div>
            <aside className="lg:sticky lg:top-24 lg:self-start">
              <div className="rounded-2xl border border-line bg-white p-6">
                {m.duration ? <p className="flex items-center gap-2 text-sm text-ink-soft"><Clock size={16} aria-hidden /> {t('help.duration')}: {String(m.duration).replace(/^PT/, '').toLowerCase()}</p> : null}
                <div className="mt-4"><TrialCta /></div>
              </div>
            </aside>
          </div>
        </Section>
        {faq.length ? <Section tone="white"><Faq items={faq} title={c('faqTitle')} /></Section> : null}
      </>
    );
  }

  if (type === 'compare') {
    const rows = Array.isArray(m.rows) ? m.rows : [];
    return (
      <>
        <Section>
          <Breadcrumbs items={crumbItems} />
          <h1 className="display mt-8 max-w-4xl text-[36px] md:text-[54px]">{m.h1 || m.title}</h1>
          {m.subtitle ? <p className="mt-4 max-w-2xl text-lg text-ink-soft">{m.subtitle}</p> : null}
          <div className="mt-10 overflow-x-auto rounded-2xl border border-line bg-white">
            <table className="w-full min-w-[640px] text-left text-[15px]">
              <thead className="bg-paper-2 text-sm">
                <tr>
                  <th scope="col" className="px-5 py-4 font-semibold">{t('compare.feature')}</th>
                  <th scope="col" className="px-5 py-4 font-semibold">{t('compare.us')}</th>
                  <th scope="col" className="px-5 py-4 font-semibold">{m.competitor}</th>
                  <th scope="col" className="px-5 py-4 font-semibold">{t('compare.note')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r: any) => (
                  <tr key={r.feature}>
                    <th scope="row" className="px-5 py-4 font-medium text-ink">{r.feature}</th>
                    <td className="px-5 py-4"><StatusMark status={String(r.us)} /></td>
                    <td className="px-5 py-4"><StatusMark status={String(r.them)} /></td>
                    <td className="px-5 py-4 text-ink-soft">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-sm text-ink-mute">{t('compare.disclaimer', { date: String(m.lastVerified || m.updated) })}</p>
          <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_300px]">
            <Prose html={doc.html} />
            {Array.isArray(m.sources) && m.sources.length ? (
              <aside>
                <h2 className="text-sm font-semibold uppercase tracking-[.12em] text-ink-mute">{t('compare.sources')}</h2>
                <ul className="mt-3 grid gap-2 text-sm">
                  {m.sources.map((s: string) => <li key={s}><a href={s} target="_blank" rel="noopener noreferrer" className="break-all text-kx underline underline-offset-2">{s.replace(/^https?:\/\//, '')}</a></li>)}
                </ul>
              </aside>
            ) : null}
          </div>
        </Section>
        {faq.length ? <Section tone="white"><Faq items={faq} title={c('faqTitle')} /></Section> : null}
        <CtaBand title={t('home.final.title')} text={t('home.final.text')} />
      </>
    );
  }

  // cases + integrations
  const features = Array.isArray(m.features) ? m.features : [];
  const steps = (Array.isArray(m.steps) ? m.steps : []).map((s: any) => (typeof s === 'string' ? { title: '', text: s } : s));
  const caps = Array.isArray(m.capabilities) ? m.capabilities : [];
  const pains = Array.isArray(m.pains) ? m.pains : [];

  return (
    <>
      <section className="site-rules relative overflow-hidden">
        <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-5 pb-16 pt-10 md:px-8 md:pb-24 md:pt-14 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <Breadcrumbs items={crumbItems} />
            {m.eyebrow || m.name ? <p className="site-tag mt-6">{m.eyebrow || t(`common.kinds.${m.kind}` as any)}</p> : null}
            <h1 className="display mt-4 text-[38px] md:text-[60px]">{m.h1 || m.title}</h1>
            {m.subtitle ? <p className="mt-5 max-w-[36rem] text-lg text-ink-soft md:text-[20px]">{m.subtitle}</p> : null}
            {type === 'integrations' ? (
              <dl className="mt-6 grid max-w-md grid-cols-2 gap-4 text-sm">
                <div className="rounded-xl border border-line bg-white p-4"><dt className="text-ink-mute">{c('setup')}</dt><dd className="mt-1 text-lg font-semibold">{c('minutes', { count: m.setupMinutes ?? 5 })}</dd></div>
                <div className="rounded-xl border border-line bg-white p-4"><dt className="text-ink-mute">{c('statusLabel')}</dt><dd className="mt-1 text-lg font-semibold">{c(`maturity.${m.status || 'production'}` as any)}</dd></div>
              </dl>
            ) : null}
            <div className="mt-8"><TrialCta /></div>
          </div>
          <div>
            {heroShot ? <Shot asset={heroShot} mobile={heroShotMobile} alt={c('screenAlt', { name: m.name || m.eyebrow || '' })} priority /> : heroPhoto ? <Photo asset={heroPhoto} alt={m.h1} label={c('illustration')} priority className="aspect-[4/3]" /> : null}
          </div>
        </div>
      </section>

      {pains.length ? (
        <Section tone="paper-2">
          <Heading title={c('painsTitle')} />
          <div className="mt-8"><PainQuotes items={pains} sourceLabel={c('painsSource')} /></div>
        </Section>
      ) : null}

      {caps.length ? (
        <Section tone="white">
          <Heading title={t('integrationsIndex.capabilities')} lead={m.connect ? `${t('integrationsIndex.connect')}: ${m.connect}` : undefined} />
          <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[560px] text-left text-[15px]">
              <tbody className="divide-y divide-line">
                {caps.map((cap: any) => (
                  <tr key={cap.label}>
                    <th scope="row" className="w-[34%] px-5 py-4 font-medium">{cap.label}</th>
                    <td className="w-[16%] px-5 py-4"><StatusMark status={String(cap.status)} /></td>
                    <td className="px-5 py-4 text-ink-soft">{cap.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      ) : null}

      {features.length ? (
        <Section tone={caps.length ? 'paper' : 'white'}>
          <Heading title={c('featuresTitle')} />
          <div className="mt-10"><FeatureList items={features} /></div>
          {heroPhoto && heroShot ? <Photo asset={heroPhoto} alt={m.h1} label={c('illustration')} className="mt-14 aspect-[21/9]" /> : null}
        </Section>
      ) : null}

      {steps.length ? (
        <Section tone="paper-2">
          <Heading title={c('stepsTitle')} />
          <div className="mt-10"><Steps items={steps} /></div>
        </Section>
      ) : null}

      <Section>
        <div className="mx-auto max-w-[68ch]"><Prose html={doc.html} /></div>
      </Section>

      {faq.length ? <Section tone="white"><Faq items={faq} title={c('faqTitle')} /></Section> : null}

      {related.length ? (
        <Section>
          <h2 className="display text-[28px]">{c('related')}</h2>
          <ul className="mt-6 grid gap-4 md:grid-cols-3">
            {related.map((r) => (
              <li key={r.slug}>
                <Link prefetch={false} href={href(`${type === 'cases' ? '/cozumler' : '/entegrasyonlar'}/${r.slug}`)} className="flex h-full flex-col rounded-2xl border border-line bg-white p-5 hover:border-ink">
                  <span className="font-semibold">{r.meta.name || r.meta.h1}</span>
                  <span className="mt-2 text-sm text-ink-soft">{r.meta.subtitle || r.meta.description}</span>
                  <span className="mt-auto pt-4 text-sm font-semibold text-kx">{c('readMore')} <ArrowRight size={14} className="inline" aria-hidden /></span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <CtaBand title={t('home.final.title')} text={t('home.final.text')} />
    </>
  );
}
