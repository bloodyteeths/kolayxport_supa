import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFoundingSpots } from '@/lib/billing/useFoundingSpots';
import type { SiteLocale } from '@/lib/site/routes';
import { Heading } from './Blocks';
import { MONTHLY, RECOMMENDED_YEARLY, YEARLY, perMonth } from './pricingV2Draft';

const PLANS = ['baslangic', 'buyume', 'pro'] as const;

/** Home pricing teaser, pricing v2 (yearly packages first): three yearly cards + the monthly plan line. Numbers from ./pricingV2Draft. */
export default function PricingTeaserYearly({ locale }: { locale: SiteLocale }) {
  const t = useTranslations('site.home.pricingYearly');
  const { spots } = useFoundingSpots();
  const tl = (n: number) => `₺${n.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')}`;

  return (
    <div>
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <Heading title={t('title')} lead={t('lead')} />
        <Link prefetch={false} href="/fiyatlandirma" className="btn-ghost shrink-0">{t('cta')}</Link>
      </div>
      {spots ? (
        <p className="mt-8 inline-flex rounded-full border border-kx/30 bg-kx-wash px-4 py-2 text-sm font-semibold text-kx-deep" role="status">
          {t('founding', { percent: spots.percentOff, remaining: spots.remaining })}
        </p>
      ) : null}
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const f = YEARLY[plan];
          return (
            <li key={plan} className={`rounded-2xl border bg-white p-6 ${plan === RECOMMENDED_YEARLY ? 'border-ink shadow-[0_20px_40px_-28px_rgba(14,26,43,.5)]' : 'border-line'}`}>
              <p className="text-sm font-semibold uppercase tracking-[.12em] text-ink-mute">{t(`plans.${plan}.name`)}</p>
              <p className="mt-3">
                <span className="display text-[40px] tabular-nums text-ink">{tl(f.priceYear!)}</span>
                <span className="ml-1 text-ink-mute">{t('perYear')}</span>
              </p>
              <p className="text-sm text-ink-soft">{t('perMonthTaksit', { price: tl(perMonth(f.priceYear!)), n: f.taksit! })}</p>
              <p className="mt-3 text-ink-soft">{t(`plans.${plan}.line`)}</p>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-sm text-ink-soft">{t('monthly', { price: tl(MONTHLY.priceMonth) })} · {t('tax')}</p>
    </div>
  );
}
