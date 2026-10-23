// components/site/tools/EtsyFeeCalculator.tsx — /araclar/etsy-komisyon-hesaplama (TR + EN). Client-side only.
// Fees: lib/tools/etsyFees.ts (Türkiye rates from Etsy Help, checked 2026-10-23). Copy: seo-tool-pages-copy §1.
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { etsyFees, ETSY_FEES_CHECKED_ON } from '@/lib/tools/etsyFees';
import { signupHref, type SiteLocale } from '@/lib/site/routes';
import { whatsappUrl } from '@/lib/site/company';
import { track } from '@/lib/tracking/events';
import { Section, CtaBand } from '../Blocks';

const SLUG = 'etsy-komisyon-hesaplama';
const num = (s: string) => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export default function EtsyFeeCalculator({ locale, usdTry }: { locale: SiteLocale; usdTry: number | null }) {
  const t = useTranslations('site.tools.etsyFees');
  const tc = useTranslations('site.tools.common');
  const loc = locale === 'tr' ? 'tr-TR' : 'en-US';
  const money = (n: number, cur: string) => n.toLocaleString(loc, { style: 'currency', currency: cur, maximumFractionDigits: 2 });
  const [f, setF] = useState({ item: '', ship: '', tax: '', rate: usdTry ? String(usdTry).replace('.', ',') : '', ads: 'none', vatId: false, cost: '', shipCost: '' });
  const [done, setDone] = useState(false);
  const r = useMemo(() => etsyFees({
    itemUsd: num(f.item), shippingUsd: num(f.ship), buyerTaxUsd: num(f.tax), usdTry: num(f.rate) || 1,
    offsiteAdsRate: f.ads === '15' ? 0.15 : f.ads === '12' ? 0.12 : null, hasVatId: f.vatId,
    productCostTry: f.cost ? num(f.cost) : undefined, shippingCostTry: f.shipCost ? num(f.shipCost) : undefined,
  }), [f]);

  const field = (key: 'item' | 'ship' | 'tax' | 'rate' | 'cost' | 'shipCost', label: string, suffix: string, help?: string) => (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className="mt-2 flex min-h-[48px] items-center rounded-xl border border-line bg-white px-4 focus-within:border-kx">
        <input inputMode="decimal" value={f[key]} onChange={(x) => setF({ ...f, [key]: x.target.value })} className="w-full bg-transparent text-[16px] outline-none" />
        <span className="ml-2 text-sm text-ink-mute">{suffix}</span>
      </span>
      {help ? <span className="mt-1 block text-xs text-ink-mute">{help}</span> : null}
    </label>
  );
  const row = (label: string, value: string, strong = false) => (
    <div className={`flex items-baseline justify-between gap-4 border-b border-line py-2 ${strong ? 'font-semibold text-ink' : 'text-ink-soft'}`}><span>{label}</span><span className="tabular-nums">{value}</span></div>
  );

  return (
    <>
      <Section>
        <h1 className="display max-w-4xl text-[36px] md:text-[56px]">{t('title')}</h1>
        <p className="mt-5 max-w-3xl text-lg text-ink-soft">{t('intro')}</p>
        <form onSubmit={(e) => { e.preventDefault(); setDone(true); track('cta_click', { label: 'tool_calculate', placement: SLUG }); }}
          className="mt-10 grid gap-6 rounded-2xl border border-line bg-white p-5 md:grid-cols-2 md:p-8" data-testid="etsy-form">
          {field('item', t('item'), '$', t('itemHelp'))}
          {field('ship', t('ship'), '$', t('shipHelp'))}
          {field('tax', t('tax'), '$', t('taxHelp'))}
          {field('rate', t('rate'), '₺', usdTry ? t('rateHelp') : t('rateHelpManual'))}
          <label className="block">
            <span className="text-sm font-semibold text-ink">{t('ads')}</span>
            <select value={f.ads} onChange={(x) => setF({ ...f, ads: x.target.value })} className="mt-2 min-h-[48px] w-full rounded-xl border border-line bg-white px-4 text-[16px] outline-none focus:border-kx">
              <option value="none">{t('adsNone')}</option><option value="15">{t('ads15')}</option><option value="12">{t('ads12')}</option>
            </select>
          </label>
          <label className="flex min-h-[48px] items-center gap-3 self-end">
            <input type="checkbox" checked={f.vatId} onChange={(x) => setF({ ...f, vatId: x.target.checked })} className="h-5 w-5" />
            <span className="text-sm text-ink">{t('vatId')}</span>
          </label>
          {field('cost', t('cost'), '₺', t('optional'))}
          {field('shipCost', t('shipCost'), '₺', t('optional'))}
          <div className="md:col-span-2"><button type="submit" className="min-h-[48px] w-full rounded-full bg-ink px-6 font-semibold text-paper hover:opacity-90 md:w-auto">{t('calculate')}</button></div>
        </form>

        {done && (
          <div className="mt-8 rounded-2xl border border-line bg-white p-5 md:p-8" data-testid="etsy-result">
            <h2 className="text-xl font-semibold text-ink">{t('result')}</h2>
            <div className="mt-4">
              {row(t('rRevenue'), money(r.revenueUsd, 'USD'))}
              {row(t('rListing'), `− ${money(r.fees.listing, 'USD')}`)}
              {row(t('rTransaction'), `− ${money(r.fees.transaction, 'USD')}`)}
              {row(t('rProcessing'), `− ${money(r.fees.processing, 'USD')}`)}
              {row(t('rRegulatory'), `− ${money(r.fees.regulatory, 'USD')}`)}
              {r.fees.offsiteAds ? row(t('rAds'), `− ${money(r.fees.offsiteAds, 'USD')}`) : null}
              {row(t('rVat'), `− ${money(r.fees.vat, 'USD')}`)}
              {row(t('rFees'), `− ${money(r.totalFeesUsd, 'USD')}`, true)}
              {row(t('rNet'), `${money(r.netUsd, 'USD')} · ${money(r.netTry, 'TRY')}`, true)}
              {r.profitTry !== null ? row(t('rProfit'), money(r.profitTry, 'TRY'), true) : null}
              {r.marginPct !== null ? row(t('rMargin'), `%${r.marginPct.toLocaleString(loc)}`, true) : null}
            </div>
            <p className="mt-3 text-xs text-ink-mute">{tc('estimateNote')}</p>
          </div>
        )}

        <p className="mt-8 text-xs text-ink-mute">
          {t('sources', { date: ETSY_FEES_CHECKED_ON })}{' '}
          <a className="underline" href="https://help.etsy.com/hc/en-us/articles/115015628847" target="_blank" rel="noopener noreferrer">{t('srcProcessing')}</a>{' · '}
          <a className="underline" href="https://help.etsy.com/hc/en-us/articles/1500011073202" target="_blank" rel="noopener noreferrer">{t('srcRegulatory')}</a>{' · '}
          <a className="underline" href="https://help.etsy.com/hc/en-us/articles/360040584433" target="_blank" rel="noopener noreferrer">{t('srcVat')}</a>
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          <a className="underline" href={signupHref(`arac-${SLUG}`)} onClick={() => track('cta_click', { label: 'tool_signup', placement: SLUG })}>{tc('signup')}</a>{' · '}
          {tc('help')}{' '}<a href="/app/destek" className="underline">{tc('ticket')}</a>{' · '}
          <a href={whatsappUrl(tc('whatsappText')) ?? '#'} target="_blank" rel="noopener noreferrer" className="underline">{tc('whatsapp')}</a>
        </p>
      </Section>
      <CtaBand title={t('ctaTitle')} text={t('ctaText')} />
    </>
  );
}
