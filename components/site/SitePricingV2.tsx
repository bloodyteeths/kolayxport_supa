// components/site/SitePricingV2.tsx — public pricing v2 (docs/gtm/pricing-v2.md; prices decided by Atilla 2026-10-19):
// Aylık ₺2.999 a month, yearly packages Başlangıç / Büyüme / Pro (paid in full), Kurumsal per deal. Final amounts:
// Tamsar, Inc. sells and adds no KDV. Shown only while PRICING_V2 is on (the page's static props carry the flag), in
// TRY on both locales (the v2 Stripe prices are TRY). The founding offer (first N customers, % off for life) is the
// coupon checkout applies itself; its price is shown when spots are open, exactly like the v1 page.
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Check } from 'lucide-react';
import { V2_PLANS, type V2PlanOffer } from '@/lib/billing/pricingV2';
import { DECIDED_PLAN_LIMITS } from '@/lib/billing/planLimits';
import { useFoundingSpots } from '@/lib/billing/useFoundingSpots';
import { SIGNUP_HREF, localePath, type SiteLocale } from '@/lib/site/routes';
import { Section } from './Blocks';

/** Kurumsal starts at this yearly amount (sold per deal by payment link; founder via orchestrator, 2026-10-22). */
export const KURUMSAL_FROM_TRY = 149990;
const ORDER: V2PlanOffer['key'][] = ['aylik', 'baslangic_yil', 'buyume_yil', 'pro_yil'];
const RECOMMENDED: V2PlanOffer['key'] = 'buyume_yil';

const tl = (locale: SiteLocale, n: number) => `₺${Math.round(n).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')}`;

export function SitePricingV2({ locale }: { locale: SiteLocale }) {
  const t = useTranslations('marketing.pricingV2.v2');
  const { spots } = useFoundingSpots();
  const founding = spots && spots.active && spots.remaining > 0 ? spots.percentOff : null;
  const num = (n: number | null) => (n === null ? '∞' : n.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US'));

  return (
    <Section>
      <h1 className="display text-[44px] md:text-[64px]">{t('title')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-ink-soft md:text-[20px]">{t('subtitle')}</p>
      <p className="mt-2 font-semibold text-ink">{t('trialLine')}</p>
      {founding !== null ? (
        <p className="mt-6" role="status">
          <span className="inline-flex rounded-full border border-kx/30 bg-kx-wash px-4 py-2 text-sm font-semibold text-kx-deep" data-testid="pricing-v2-founding">
            {t('founding', { percent: founding, remaining: spots!.remaining, total: spots!.total })}
          </span>
        </p>
      ) : null}

      <ul className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4" data-testid="pricing-v2-plans">
        {ORDER.map((key) => {
          const offer = V2_PLANS.find((p) => p.key === key)!;
          const list = offer.priceTry as number;
          const price = founding !== null ? list * (1 - founding / 100) : list;
          const limits = DECIDED_PLAN_LIMITS[key].limits;
          const yearly = offer.interval === 'year';
          return (
            <li key={key} className={`flex flex-col rounded-2xl border bg-white p-6 ${key === RECOMMENDED ? 'border-kx shadow-lg' : 'border-line'}`} data-testid={`pricing-v2-${key}`}>
              {key === RECOMMENDED ? <span className="mb-2 self-start rounded-full bg-kx px-3 py-1 text-xs font-semibold text-paper">{t('recommended')}</span> : null}
              <h2 className="text-xl font-semibold text-ink">{t(`plans.${key}.name`)}</h2>
              <p className="mt-1 min-h-[44px] text-sm text-ink-soft">{t(`plans.${key}.tagline`)}</p>
              <div className="mt-4">
                <span className="display text-[36px]">{tl(locale, price)}</span>
                <span className="text-ink-soft"> {yearly ? t('perYear') : t('perMonth')}</span>
                {founding !== null ? <p className="text-sm text-ink-mute line-through">{tl(locale, list)}</p> : null}
                {yearly ? <p className="text-sm text-ink-soft">{t('monthlyEquivalent', { price: tl(locale, price / 12) })}</p> : <p className="text-sm text-ink-soft">{t('cancelAnytime')}</p>}
              </div>
              <ul className="mt-5 space-y-2 text-sm text-ink">
                <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-kx" />{t('stores', { count: limits.connectedStores ?? 0 })}</li>
                <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-kx" />{t(yearly ? 'ordersYear' : 'ordersMonth', { count: num(limits.orders) })}</li>
                <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-kx" />{t(yearly ? 'labelsYear' : 'labelsMonth', { count: num(limits.labels) })}</li>
                <li className="flex gap-2"><Check size={16} className="mt-0.5 shrink-0 text-kx" />{t(`plans.${key}.editor`)}</li>
              </ul>
              <Link href={`${SIGNUP_HREF}&plan=${key}`} className={`mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full px-5 font-semibold ${key === RECOMMENDED ? 'bg-kx text-paper' : 'border border-ink text-ink'}`}>
                {t('cta')}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 rounded-2xl border border-line bg-white p-6 md:flex md:items-center md:justify-between" data-testid="pricing-v2-kurumsal">
        <div>
          <h2 className="text-xl font-semibold text-ink">{t('plans.kurumsal.name')}</h2>
          <p className="mt-1 text-sm text-ink-soft">{t('plans.kurumsal.tagline', { price: tl(locale, KURUMSAL_FROM_TRY) })}</p>
        </div>
        <Link href={localePath(locale, '/iletisim')} className="mt-4 inline-flex min-h-[44px] items-center rounded-full border border-ink px-5 font-semibold text-ink md:mt-0">{t('kurumsalCta')}</Link>
      </div>

      <p className="mt-6 text-sm text-ink-soft" data-testid="pricing-v2-tax">{t('taxLine')}</p>
      <p className="mt-1 text-sm text-ink-soft">{t('modulesLine')}</p>
    </Section>
  );
}

export default SitePricingV2;
