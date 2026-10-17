import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PLAN_PRICES, FOUNDING_PERCENT_OFF } from '@/lib/billing/price';
import { useFoundingSpots } from '@/lib/billing/useFoundingSpots';
import type { SiteLocale } from '@/lib/site/routes';
import { Heading } from './Blocks';

const PLANS = ['starter', 'growth', 'pro'] as const;

function money(locale: SiteLocale, amount: number) {
  return locale === 'tr'
    ? `₺${amount.toLocaleString('tr-TR')}`
    : `$${amount.toLocaleString('en-US')}`;
}

/** Plan cards from lib/billing/price.ts and the live founding-member counter (never a hardcoded number). */
export default function PricingTeaser({ locale }: { locale: SiteLocale }) {
  const t = useTranslations('site.home.pricing');
  const { spots } = useFoundingSpots();
  const key = locale === 'tr' ? 'try' : 'usd';

  return (
    <div>
      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <Heading title={t('title')} lead={t('lead')} />
        <Link prefetch={false} href="/fiyatlandirma" className="btn-ghost shrink-0">{t('cta')}</Link>
      </div>
      {spots ? (
        <p className="mt-8 inline-flex rounded-full border border-kx/30 bg-kx-wash px-4 py-2 text-sm font-semibold text-kx-deep" role="status">
          {t('founding', { percent: spots.percentOff ?? FOUNDING_PERCENT_OFF, remaining: spots.remaining })}
        </p>
      ) : null}
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => (
          <li key={plan} className={`rounded-2xl border bg-white p-6 ${plan === 'growth' ? 'border-ink shadow-[0_20px_40px_-28px_rgba(14,26,43,.5)]' : 'border-line'}`}>
            <p className="text-sm font-semibold uppercase tracking-[.12em] text-ink-mute">{plan.charAt(0).toUpperCase() + plan.slice(1)}</p>
            <p className="mt-3">
              <span className="display text-[40px] text-ink">{money(locale, PLAN_PRICES[plan][key].month)}</span>
              <span className="ml-1 text-ink-mute">{t('perMonth')}</span>
            </p>
            <p className="mt-3 text-ink-soft">{t(`plans.${plan}`)}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
