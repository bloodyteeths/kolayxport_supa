// components/site/tools/ToolPages.tsx — /araclar (free seller tools) pages, TR + EN. Owner of the site look:
// turkey-gtm (SiteLayout + Blocks); the calculators live next to this file.
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { localePath, type SiteLocale } from '@/lib/site/routes';
import SiteLayout from '../SiteLayout';
import { Section, CtaBand } from '../Blocks';
import TrendyolProfitCalculator from './TrendyolProfitCalculator';

export const TOOLS = [{ slug: 'trendyol-komisyon-ve-kar-hesaplama', key: 'trendyolProfit' }] as const;

export function TrendyolProfitPage({ locale, usdTry }: { locale: SiteLocale; usdTry: number | null }) {
  const t = useTranslations('site.tools.trendyolProfit');
  return (
    <SiteLayout locale={locale} seo={{ title: t('seoTitle'), description: t('seoDescription'), path: '/araclar/trendyol-komisyon-ve-kar-hesaplama', hasTwin: true }}>
      <TrendyolProfitCalculator locale={locale} usdTry={usdTry} />
    </SiteLayout>
  );
}

export function ToolsIndexPage({ locale }: { locale: SiteLocale }) {
  const t = useTranslations('site.tools');
  return (
    <SiteLayout locale={locale} seo={{ title: t('index.seoTitle'), description: t('index.seoDescription'), path: '/araclar', hasTwin: true }}>
      <Section>
        <h1 className="display text-[40px] md:text-[60px]">{t('index.title')}</h1>
        <p className="mt-5 max-w-3xl text-lg text-ink-soft">{t('index.intro')}</p>
        <ul className="mt-10 grid gap-4 md:grid-cols-2">
          {TOOLS.map((x) => (
            <li key={x.slug}>
              <Link href={localePath(locale, `/araclar/${x.slug}`)} className="block rounded-2xl border border-line bg-white p-6 hover:border-ink">
                <span className="block text-lg font-semibold text-ink">{t(`${x.key}.cardTitle`)}</span>
                <span className="mt-2 block text-ink-soft">{t(`${x.key}.cardText`)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>
      <CtaBand title={t('index.ctaTitle')} text={t('index.ctaText')} />
    </SiteLayout>
  );
}
