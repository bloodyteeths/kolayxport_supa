import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Check, Minus } from 'lucide-react';
import { useFoundingSpots } from '@/lib/billing/useFoundingSpots';
import { localePath, SIGNUP_HREF, type SiteLocale } from '@/lib/site/routes';
import { faqPage, softwareApplication } from '@/lib/site/schema';
import SiteLayout from './SiteLayout';
import { Section } from './Blocks';
import { PRICING_V2_DRAFT, BASE_FEATURES, CREDIT_PACKS, MODULES, MONTHLY, RECOMMENDED_YEARLY, YEARLY, YEARLY_PLANS, foundingPrice, perMonth, type YearlyPlan } from './pricingV2Draft';

/**
 * DRAFT of the pricing v2 page (docs/gtm/pricing-v2.md §4 P4): yearly packages first (installments), one
 * monthly plan, modules. Numbers come from ./pricingV2Draft (placeholders, not wired to checkout). Not linked
 * from the live site until Atilla confirms the prices and the seller-of-record / KDV question is settled.
 */
export default function SitePricingYearly({ locale, draft = PRICING_V2_DRAFT }: { locale: SiteLocale; draft?: boolean }) {
  const t = useTranslations('marketing.pricingYearly');
  return (
    <SiteLayout
      locale={locale}
      seo={{ title: t('seo.title'), description: t('seo.description'), path: '/fiyatlandirma', hasTwin: true, noindex: draft }}
      jsonLd={[softwareApplication(locale)]}
    >
      <Body locale={locale} draft={draft} />
    </SiteLayout>
  );
}

function Body({ locale, draft }: { locale: SiteLocale; draft: boolean }) {
  const t = useTranslations('marketing.pricingYearly');
  const router = useRouter();
  const { spots } = useFoundingSpots();
  const nf = (n: number) => n.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US');
  const tl = (n: number) => `₺${nf(n)}`;

  // Signed-in sellers get the in-app plan page, same as the live pricing page.
  useEffect(() => {
    let alive = true;
    fetch('/api/auth/session', { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => { if (alive && s?.user) void router.replace(`/plan${window.location.search}`); })
      .catch(() => {});
    return () => { alive = false; };
  }, [router]);

  const faqKeys = ['taksit', 'kdv', 'trial', 'monthlyVsYearly', 'modules', 'founding'] as const;
  const faq = faqKeys.map((k) => ({ q: t(`faq.${k}.q`), a: t(`faq.${k}.a`, { total: spots?.total ?? 20, percent: spots?.percentOff ?? 40 }) }));
  const signup = (plan: string) => `${SIGNUP_HREF}&plan=${plan}&currency=try`;
  const on = <Check size={18} className="inline text-[#0F7A4A]" aria-label="✓" />;
  const off = <Minus size={18} className="inline text-ink-mute" aria-label="—" />;

  const compareRows: Array<{ id: string; label: string; cell: (p: YearlyPlan) => React.ReactNode }> = [
    { id: 'stores', label: t('compare.stores'), cell: (p) => (YEARLY[p].stores === null ? t('compare.custom') : nf(YEARLY[p].stores!)) },
    { id: 'orders', label: t('compare.ordersYear'), cell: (p) => (YEARLY[p].ordersYear === null ? t('compare.custom') : nf(YEARLY[p].ordersYear!)) },
    { id: 'labels', label: t('compare.labelsYear'), cell: (p) => (YEARLY[p].labelsYear === null ? t('compare.custom') : nf(YEARLY[p].labelsYear!)) },
    { id: 'ai', label: t('compare.aiMonth'), cell: (p) => nf(YEARLY[p].aiCreditsMonth) },
    { id: 'taksit', label: t('compare.taksit'), cell: (p) => (YEARLY[p].taksit === null ? t('compare.custom') : t('compare.upTo', { n: YEARLY[p].taksit! })) },
    ...(['financials', 'arbitrage', 'bulkPhotoStudio'] as const).map((k) => ({ id: k, label: t(`compare.${k}`), cell: (p: YearlyPlan) => (YEARLY[p].proFeatures ? on : t('compare.module')) })),
    { id: 'priority', label: t('compare.priority'), cell: (p) => (YEARLY[p].prioritySupport ? on : off) },
  ];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqPage(faq)).replace(/</g, '\\u003c') }} />
      {draft ? (
        <div role="note" className="border-b border-[#E8C36A] bg-[#FFF6DD] px-4 py-3 text-center text-sm font-semibold text-[#6B4E00]">{t('draftBanner')}</div>
      ) : null}

      <Section>
        <h1 className="display text-[44px] md:text-[64px]">{t('title')}</h1>
        <p className="mt-4 max-w-2xl text-lg text-ink-soft md:text-[20px]">{t('subtitle')}</p>
        <p className="mt-2 font-semibold text-ink">{t('trialLine')}</p>
        <p className="mt-1 text-sm text-ink-mute">{t('taxNote')}</p>

        <p className="mt-6 min-h-[40px]" role="status">
          {spots ? (
            <span className="inline-flex rounded-full border border-kx/30 bg-kx-wash px-4 py-2 text-sm font-semibold text-kx-deep">
              {t('founding.offer', { total: spots.total, percent: spots.percentOff })} · {t('founding.count', { total: spots.total, remaining: spots.remaining })}
            </span>
          ) : null}
        </p>

        <h2 className="mt-4 text-sm font-semibold uppercase tracking-[.12em] text-ink-mute">{t('yearlyHeading')}</h2>
        <ul className="mt-3 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {YEARLY_PLANS.map((plan) => {
            const f = YEARLY[plan];
            const rec = plan === RECOMMENDED_YEARLY;
            return (
              <li key={plan} id={`plan-${plan}`} className={`flex flex-col rounded-2xl border bg-white p-6 ${rec ? 'border-ink shadow-[0_20px_40px_-28px_rgba(14,26,43,.5)] max-lg:order-first' : 'border-line'}`}>
                <p className="flex items-center justify-between text-sm font-semibold uppercase tracking-[.12em] text-ink-mute">
                  {t(`plans.${plan}.name`)}
                  {rec ? <span className="rounded-full bg-kx-wash px-2 py-0.5 text-[11px] tracking-normal text-kx-deep normal-case">{t('recommended')}</span> : null}
                </p>
                <p className="mt-1 min-h-[44px] text-sm text-ink-soft">{t(`plans.${plan}.tagline`)}</p>
                <div className="mt-4 min-h-[112px]">
                  {f.priceYear !== null ? (
                    <>
                      <p><span className="display text-[40px] tabular-nums">{tl(f.priceYear)}</span><span className="ml-1 text-ink-mute">{t('perYear')}</span></p>
                      <p className="text-sm text-ink-soft">{t('perMonthApprox', { price: tl(perMonth(f.priceYear)) })} · {t('taksit', { n: f.taksit! })}</p>
                      {spots ? <p className="mt-1 text-sm font-semibold text-kx-deep">{t('founding.price', { price: tl(foundingPrice(f.priceYear, spots.percentOff)) })}</p> : null}
                    </>
                  ) : (
                    <>
                      <p><span className="display text-[40px] tabular-nums">{tl(f.fromYear!)}</span><span className="ml-1 text-ink-mute">{t('perYear')}</span></p>
                      <p className="text-sm text-ink-soft">{t('fromNote')} · {t('taksitCustom')}</p>
                    </>
                  )}
                </div>
                <ul className="mt-4 grid gap-2 text-[15px]">
                  {f.stores === null ? <li>{t('limit.custom')}</li> : (
                    <>
                      <li>{t('limit.stores', { count: nf(f.stores) })}</li>
                      <li>{t('limit.ordersYear', { count: nf(f.ordersYear!) })}</li>
                      <li>{t('limit.labelsYear', { count: nf(f.labelsYear!) })}</li>
                    </>
                  )}
                  <li>{t('limit.aiMonth', { count: nf(f.aiCreditsMonth) })}</li>
                  <li className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-kx" aria-hidden />{f.proFeatures ? t('pro.included') : t('pro.asModule')}</li>
                  {f.prioritySupport ? <li className="flex gap-2"><Check size={16} className="mt-1 shrink-0 text-kx" aria-hidden />{t('pro.priority')}</li> : null}
                </ul>
                <div className="mt-auto pt-6">
                  {plan === 'kurumsal' ? (
                    <Link prefetch={false} href={`${localePath(locale, '/iletisim')}?subject=enterprise`} className="btn-ghost w-full">{t('cta.talk')}</Link>
                  ) : (
                    <Link prefetch={false} href={signup(`${plan}_yil`)} className={rec ? 'btn-kx w-full' : 'btn-ghost w-full'}>{t('cta.trial')}</Link>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-soft" aria-label={t('base.listingStudio')}>
          {BASE_FEATURES.filter((k) => k !== 'aiText').map((k) => (
            <li key={k} className="flex items-center gap-1.5"><Check size={14} className="text-kx" aria-hidden />{t(`base.${k}`)}</li>
          ))}
        </ul>

        <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-line bg-white p-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <h3 className="text-lg font-semibold">{t('monthly.heading')}</h3>
            <p className="mt-1"><span className="display text-[28px] tabular-nums">{t('monthly.price', { price: tl(MONTHLY.priceMonth) })}</span></p>
            <p className="mt-2 text-[15px] text-ink-soft">{t('monthly.includes', { stores: MONTHLY.stores, orders: nf(MONTHLY.ordersMonth), labels: nf(MONTHLY.labelsMonth), ai: nf(MONTHLY.aiCreditsMonth) })}</p>
            <p className="mt-2 text-sm text-ink-mute">{t('monthly.why')}</p>
          </div>
          <Link prefetch={false} href={signup('aylik')} className="btn-ghost shrink-0">{t('cta.monthly')}</Link>
        </div>
      </Section>

      <Section tone="white">
        <h2 className="display text-[30px] md:text-[40px]">{t('modules.heading')}</h2>
        <p className="mt-3 max-w-2xl text-ink-soft">{t('modules.intro')}</p>
        <div className="mt-8 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[560px] text-left text-[15px]">
            <thead className="bg-paper-2 text-sm">
              <tr>
                <th scope="col" className="px-5 py-4">{t('modules.colModule')}</th>
                <th scope="col" className="px-5 py-4">{t('modules.colMonthly')}</th>
                <th scope="col" className="px-5 py-4">{t('modules.colYearly')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {MODULES.map((m) => (
                <tr key={m.key}>
                  <th scope="row" className="px-5 py-3 font-medium">
                    {t(`modules.${m.key}`)}
                    {['financials', 'arbitrage', 'bulkPhotoStudio'].includes(m.key) ? <span className="block text-sm font-normal text-ink-mute">{t('modules.includedPro')}</span> : null}
                  </th>
                  <td className="px-5 py-3">{t('modules.perMonth', { price: tl(m.month) })}</td>
                  <td className="px-5 py-3">{t('modules.perYear', { price: tl(m.year) })}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="px-5 py-3 font-medium">{t('modules.credits')}<span className="block text-sm font-normal text-ink-mute">{t('modules.creditsNote')}</span></th>
                <td className="px-5 py-3" colSpan={2}>
                  <ul className="flex flex-wrap gap-x-5 gap-y-1">
                    {CREDIT_PACKS.map((p) => <li key={p.id}>{t('modules.creditsLine', { credits: nf(p.credits), price: tl(p.price.TRY) })}</li>)}
                  </ul>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <h2 className="display text-[30px] md:text-[40px]">{t('compare.title')}</h2>
        <div className="mt-8 overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[640px] text-left text-[15px]">
            <thead className="bg-paper-2 text-sm">
              <tr>
                <th scope="col" className="px-5 py-4">{t('compare.feature')}</th>
                {YEARLY_PLANS.map((p) => <th key={p} scope="col" className="px-5 py-4 text-center">{t(`plans.${p}.name`)}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {compareRows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="px-5 py-3 font-medium">{row.label}</th>
                  {YEARLY_PLANS.map((p) => <td key={p} className="px-5 py-3 text-center">{row.cell(p)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section tone="white">
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
        {draft ? <p className="mt-10 rounded-xl border border-dashed border-line p-4 text-sm text-ink-mute">{t('draftNotes')}</p> : null}
      </Section>
    </>
  );
}
