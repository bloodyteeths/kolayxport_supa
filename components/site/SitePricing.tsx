import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Minus } from 'lucide-react';
import { CARD_FEATURES, COMPARE_ROWS, PRICING_PLANS, RECOMMENDED_PLAN, cardPrice, limitFor, reviewerFacts, type CompareCell } from '@/components/domain/pricing/pricingModel';
import { useFoundingSpots } from '@/lib/billing/useFoundingSpots';
import type { Currency, Interval } from '@/lib/billing/types';
import { localePath, SIGNUP_HREF, type SiteLocale } from '@/lib/site/routes';
import { faqPage, softwareApplication } from '@/lib/site/schema';
import SiteLayout from './SiteLayout';
import SitePricingV2 from './SitePricingV2';
import { Section, CtaBand } from './Blocks';

/**
 * Public pricing page (fast, server-rendered, no MUI). Same data as the in-app checkout page
 * (components/domain/pricing/pricingModel.ts, lib/billing/price.ts). Signed-in visitors are forwarded to
 * /plan, which runs the real checkout / plan-change flows (PricingPage).
 */
export default function SitePricing({ locale, v2 = false }: { locale: SiteLocale; v2?: boolean }) {
  return (
    <SiteLayout
      locale={locale}
      seo={{
        title: locale === 'tr' ? 'Fiyatlandırma · KolayXport' : 'Pricing · KolayXport',
        description: v2
          ? locale === 'tr'
            ? 'Aylık ₺2.999 veya yıllık paketler ₺29.990\'dan. 14 gün ücretsiz, kart gerekmez. Fiyatlar nihaidir; KDV eklenmez.'
            : 'From ₺2,999 a month, or yearly packages from ₺29,990. 14 days free, no card needed. Final prices, no VAT added.'
          : locale === 'tr'
            ? 'Aylık ₺2.499 fiyatından başlayan planlar. 14 gün ücretsiz, kart gerekmez. Aylık ödeme, istediğiniz zaman iptal.'
            : 'Plans from $59 a month. 14 days free, no card needed. Monthly billing, cancel anytime.',
        path: '/fiyatlandirma',
        hasTwin: true,
      }}
      jsonLd={[softwareApplication(locale)]}
    >
      <Body locale={locale} v2={v2} />
    </SiteLayout>
  );
}

function fmt(locale: SiteLocale, currency: Currency, n: number) {
  return currency === 'TRY' ? `₺${n.toLocaleString('tr-TR')}` : `$${n.toLocaleString('en-US')}`;
}

function Body({ locale, v2 }: { locale: SiteLocale; v2: boolean }) {
  const t = useTranslations('marketing.pricingV2');
  const c = useTranslations('site.common');
  const f = useTranslations('site.home.final');
  const router = useRouter();
  const [interval, setInterval] = useState<Interval>('month');
  const [currency, setCurrency] = useState<Currency>(locale === 'tr' ? 'TRY' : 'USD');
  const { spots } = useFoundingSpots();
  const foundingPercent = spots ? spots.percentOff : null;

  // Signed-in sellers get the real checkout / plan-change page.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (alive && s?.user) void router.replace(`/plan${window.location.search}`); })
      .catch(() => {});
    return () => { alive = false; };
  }, [router]);

  // Pricing v2 (PRICING_V2 on): the v2 packages; the signed-in redirect above still applies.
  if (v2) return <SitePricingV2 locale={locale} />;

  const faqKeys = ['trial', 'limits', 'founding', 'change', 'currency', 'data'] as const;
  const faq = faqKeys.map((k) => ({
    q: t(`faq.${k}.q`),
    a: t(`faq.${k}.a`, { total: spots?.total ?? 20, percent: foundingPercent ?? 40 }),
  }));

  const toggle = (active: boolean) => `min-h-[44px] rounded-full px-4 text-sm font-semibold transition-colors ${active ? 'bg-ink text-paper' : 'text-ink-soft hover:text-ink'}`;
  const cell = (v: CompareCell) => {
    if (v.kind === 'num') return v.value === null ? '∞' : v.value.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US');
    if (v.kind === 'check') return v.on ? <Check size={18} className="inline text-[#0F7A4A]" aria-label="✓" /> : <Minus size={18} className="inline text-ink-mute" aria-label="—" />;
    return t(v.key);
  };
  const signup = (plan: string) => `${SIGNUP_HREF}&plan=${plan}&interval=${interval}&currency=${currency.toLowerCase()}`;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage(faq)).replace(/</g, '\\u003c') }} />
      <Section>
        <h1 className="display text-[44px] md:text-[64px]">{t('title')}</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft md:text-[20px]">{t('subtitle')}</p>
        <p className="mt-2 font-semibold text-ink">{t('trialLine')}</p>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t('interval.label')} className="inline-flex rounded-full border border-line bg-white p-1">
            <button type="button" className={toggle(interval === 'month')} aria-pressed={interval === 'month'} onClick={() => setInterval('month')}>{t('interval.monthly')}</button>
            <button type="button" className={toggle(interval === 'year')} aria-pressed={interval === 'year'} onClick={() => setInterval('year')}>{t('interval.yearly')}</button>
          </div>
          <div role="group" aria-label={t('currency.label')} className="inline-flex rounded-full border border-line bg-white p-1">
            <button type="button" className={toggle(currency === 'TRY')} aria-pressed={currency === 'TRY'} onClick={() => setCurrency('TRY')}>{t('currency.try')}</button>
            <button type="button" className={toggle(currency === 'USD')} aria-pressed={currency === 'USD'} onClick={() => setCurrency('USD')}>{t('currency.usd')}</button>
          </div>
        </div>

        <p className="mt-6 min-h-[40px]" role="status">
          {spots ? (
            <span className="inline-flex rounded-full border border-kx/30 bg-kx-wash px-4 py-2 text-sm font-semibold text-kx-deep">
              {t('founding.offer', { total: spots.total, percent: spots.percentOff })} · {t('founding.count', { total: spots.total, remaining: spots.remaining })}
            </span>
          ) : null}
        </p>

        <ul className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {PRICING_PLANS.map((plan) => {
            const price = cardPrice(plan, interval, currency, foundingPercent);
            const rec = plan === RECOMMENDED_PLAN;
            return (
              <li key={plan} id={`plan-${plan}`} className={`flex flex-col rounded-2xl border bg-white p-6 ${rec ? 'border-ink shadow-[0_20px_40px_-28px_rgba(14,26,43,.5)] max-lg:order-first' : 'border-line'}`}>
                <p className="flex items-center justify-between text-sm font-semibold uppercase tracking-[.12em] text-ink-mute">
                  {t(`plans.${plan}.name`)}
                  {rec ? <span className="rounded-full bg-kx-wash px-2 py-0.5 text-[11px] tracking-normal text-kx-deep normal-case">{t('mostPopular')}</span> : null}
                </p>
                <p className="mt-1 min-h-[44px] text-sm text-ink-soft">{t(`plans.${plan}.tagline`)}</p>
                <div className="mt-4 min-h-[86px]">
                  {price ? (
                    <>
                      <p>
                        <span className="display text-[40px]">{fmt(locale, currency, price.amount)}</span>
                        <span className="ml-1 text-ink-mute">{interval === 'month' ? t('perMonth') : t('perYear')}</span>
                      </p>
                      {price.struck ? <p className="text-sm text-ink-mute line-through">{t('listPrice', { price: fmt(locale, currency, price.struck) })}</p> : null}
                      {price.perMonth ? <p className="text-sm text-ink-soft">{t('monthlyEquivalent', { price: fmt(locale, currency, Math.round(price.perMonth)) })}</p> : null}
                    </>
                  ) : (
                    <p className="display text-[32px]">{t('customPrice')}</p>
                  )}
                </div>
                <ul className="mt-4 grid gap-2 text-[15px]">
                  {(['orders', 'labels', 'connectedStores', 'aiCredits'] as const).map((m) => {
                    const v = limitFor(plan, m);
                    const key = { orders: v === null ? 'limit.unlimitedOrders' : 'limit.orders', labels: v === null ? 'limit.unlimitedLabels' : 'limit.labels', connectedStores: v === null ? 'limit.unlimitedStores' : 'limit.stores', aiCredits: v === null ? 'limit.unlimitedAi' : 'limit.ai' }[m];
                    return <li key={m}>{t(key, { count: (v ?? 0).toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US'), n: v ?? 0 })}</li>;
                  })}
                  {CARD_FEATURES[plan].map((feat, i) => (
                    <li key={i} className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-kx" aria-hidden />{feat.key === 'everythingIn' ? t('feature.everythingIn', { plan: t(`plans.${feat.plan}.name`) }) : t(`feature.${feat.key}`)}</li>
                  ))}
                </ul>
                <div className="mt-auto pt-6">
                  {plan === 'enterprise' ? (
                    <Link prefetch={false} href={`${localePath(locale, '/iletisim')}?subject=enterprise`} className="btn-ghost w-full">{t('cta.talk')}</Link>
                  ) : (
                    <Link prefetch={false} href={signup(plan)} className={rec ? 'btn-kx w-full' : 'btn-ghost w-full'}>{t('cta.startTrial')}</Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-sm text-ink-mute">{c('trialLine')}</p>
      </Section>

      <Section tone="white">
        <h2 className="display text-[30px] md:text-[40px]">{t('compare.title')}</h2>
        <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead className="bg-paper-2 text-sm">
              <tr>
                <th scope="col" className="px-5 py-4">{t('compare.feature')}</th>
                {PRICING_PLANS.map((p) => <th key={p} scope="col" className="px-5 py-4 text-center">{t(`plans.${p}.name`)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {COMPARE_ROWS.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="px-5 py-3 font-medium">{t(row.labelKey)}</th>
                  {PRICING_PLANS.map((p) => <td key={p} className="px-5 py-3 text-center">{cell(row.cell(p))}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <div className="grid gap-10 md:grid-cols-[1fr_2fr]">
          <h2 className="display text-[30px] md:text-[40px]">{t('faq.title')}</h2>
          <dl className="divide-y divide-line border-y border-line">
            {faq.map((it) => (
              <div key={it.q} className="py-5">
                <dt className="text-[17px] font-semibold">{it.q}</dt>
                <dd className="mt-2 max-w-[64ch] text-ink-soft">{it.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Section>

      {/* English plan summary (Shopify App Store review requirement): list prices from lib/billing/price.ts. */}
      <Section tone="paper-2">
        <div lang="en">
          <h2 className="text-lg font-semibold">Plan summary (English)</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead><tr className="text-ink-mute"><th className="py-2 pr-4">Plan</th><th className="py-2 pr-4">Monthly</th><th className="py-2 pr-4">Yearly</th><th className="py-2 pr-4">Orders / mo</th><th className="py-2 pr-4">Labels / mo</th><th className="py-2">Stores</th></tr></thead>
              <tbody>
                {reviewerFacts().map((r) => (
                  <tr key={r.plan} className="border-t border-line">
                    <td className="py-2 pr-4 font-medium capitalize">{r.plan}</td>
                    <td className="py-2 pr-4">₺{r.monthTry.toLocaleString('en-US')} / ${r.monthUsd}</td>
                    <td className="py-2 pr-4">₺{r.yearTry.toLocaleString('en-US')} / ${r.yearUsd}</td>
                    <td className="py-2 pr-4">{r.orders ?? 'Unlimited'}</td>
                    <td className="py-2 pr-4">{r.labels ?? 'Unlimited'}</td>
                    <td className="py-2">{r.stores ?? 'Unlimited'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ink-soft">14-day free trial without a card. Billed monthly or yearly (2 months free); cancel anytime. Shopify App Store installs use the free Shopify tier.</p>
        </div>
      </Section>

      <CtaBand title={f('title')} text={f('text')} />
    </>
  );
}
