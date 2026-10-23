// components/site/tools/TrendyolProfitCalculator.tsx — /araclar/trendyol-komisyon-ve-kar-hesaplama (TR + EN).
// Client-side only, no login. Rules: lib/tools/trendyolProfit.ts (checked on real Trendyol settlements); the Etsy
// side-by-side uses lib/tools/etsyFees.ts. After a calculation with a category, a teaser of the category's top 3
// estimated best-sellers loads from /api/tools/trendyol-bestsellers (the rest is behind a free signup and never
// sent to the browser). Copy: docs/gtm/partners/seo-tool-pages-copy-2026-10.md §5.
import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Lock } from 'lucide-react';
import { trendyolProfit, TRENDYOL_RULES_CHECKED_ON, TRENDYOL_TR } from '@/lib/tools/trendyolProfit';
import { etsyFees } from '@/lib/tools/etsyFees';
import { signupHref, type SiteLocale } from '@/lib/site/routes';
import { whatsappUrl } from '@/lib/site/company';
import { track } from '@/lib/tracking/events';
import { Section, CtaBand } from '../Blocks';

const SLUG = 'trendyol-komisyon-ve-kar-hesaplama';
interface Teaser { categoryName: string; top: Array<{ title: string; price: number | null; salesPerDay: number }>; more: number }

const num = (s: string) => {
  const n = Number(String(s).replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export default function TrendyolProfitCalculator({ locale, usdTry }: { locale: SiteLocale; usdTry: number | null }) {
  const t = useTranslations('site.tools.trendyolProfit');
  const tc = useTranslations('site.tools.common');
  const money = (n: number, cur = 'TRY') => n.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US', { style: 'currency', currency: cur, maximumFractionDigits: 2 });
  const [f, setF] = useState({ price: '', commission: '18', vat: '20', cost: '', cargo: '', fee: String(TRENDYOL_TR.platformFeeTry).replace('.', ','), category: '' });
  const [etsy, setEtsy] = useState({ priceUsd: '', shipUsd: '', shipCostTry: '' });
  const [done, setDone] = useState(false);
  const [cats, setCats] = useState<Array<{ id: string; name: string }>>([]);
  const [teaser, setTeaser] = useState<Teaser | null | 'loading' | 'none'>(null);

  useEffect(() => {
    fetch('/api/tools/trendyol-bestsellers').then((r) => (r.ok ? r.json() : null)).then((j) => j?.categories && setCats(j.categories)).catch(() => {});
  }, []);

  const r = useMemo(() => trendyolProfit({
    salePriceTry: num(f.price), commissionPct: num(f.commission), vatPct: num(f.vat), productCostTry: num(f.cost), cargoTry: num(f.cargo), platformFeeTry: num(f.fee),
  }), [f]);
  const e = useMemo(() => (usdTry && num(etsy.priceUsd) > 0 ? etsyFees({ itemUsd: num(etsy.priceUsd), shippingUsd: num(etsy.shipUsd), usdTry, productCostTry: num(f.cost), shippingCostTry: num(etsy.shipCostTry) }) : null), [etsy, f.cost, usdTry]);

  const calculate = (ev: React.FormEvent) => {
    ev.preventDefault();
    setDone(true);
    track('cta_click', { label: 'tool_calculate', placement: SLUG });
    if (f.category) {
      setTeaser('loading');
      fetch(`/api/tools/trendyol-bestsellers?c=${encodeURIComponent(f.category)}`)
        .then((x) => (x.ok ? x.json() : null))
        .then((j) => setTeaser(j?.teaser ?? 'none'))
        .catch(() => setTeaser('none'));
    } else setTeaser(null);
  };

  const input = (key: keyof typeof f, label: string, help?: string, suffix?: string) => (
    <label className="block">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className="mt-2 flex min-h-[48px] items-center rounded-xl border border-line bg-white px-4 focus-within:border-kx">
        <input inputMode="decimal" value={f[key]} onChange={(x) => setF({ ...f, [key]: x.target.value })} className="w-full bg-transparent text-[16px] outline-none" />
        {suffix ? <span className="ml-2 text-sm text-ink-mute">{suffix}</span> : null}
      </span>
      {help ? <span className="mt-1 block text-xs text-ink-mute">{help}</span> : null}
    </label>
  );
  const row = (label: string, value: string, strong = false, note?: string) => (
    <div className={`flex items-baseline justify-between gap-4 border-b border-line py-2 ${strong ? 'font-semibold text-ink' : 'text-ink-soft'}`}>
      <span>{label}{note ? <span className="ml-1 text-xs text-ink-mute">({note})</span> : null}</span><span className="tabular-nums">{value}</span>
    </div>
  );
  const cta = (placement: string) => (
    <a href={signupHref(`arac-${SLUG}`)} onClick={() => track('cta_click', { label: 'tool_signup', placement })}
      className="inline-flex min-h-[48px] items-center rounded-full bg-kx px-6 font-semibold text-white hover:opacity-90">{tc('signup')}</a>
  );

  return (
    <>
      <Section>
        <h1 className="display max-w-4xl text-[36px] md:text-[56px]">{t('title')}</h1>
        <p className="mt-5 max-w-3xl text-lg text-ink-soft">{t('intro')}</p>

        <form onSubmit={calculate} className="mt-10 grid gap-6 rounded-2xl border border-line bg-white p-5 md:grid-cols-2 md:p-8" data-testid="ty-form">
          {input('price', t('price'), t('priceHelp'), '₺')}
          <label className="block">
            <span className="text-sm font-semibold text-ink">{t('category')}</span>
            <select value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })} className="mt-2 min-h-[48px] w-full rounded-xl border border-line bg-white px-4 text-[16px] outline-none focus:border-kx">
              <option value="">{t('categoryAny')}</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-ink-mute">{t('categoryHelp')}</span>
          </label>
          {input('commission', t('commission'), t('commissionHelp'), '%')}
          <label className="block">
            <span className="text-sm font-semibold text-ink">{t('vat')}</span>
            <select value={f.vat} onChange={(x) => setF({ ...f, vat: x.target.value })} className="mt-2 min-h-[48px] w-full rounded-xl border border-line bg-white px-4 text-[16px] outline-none focus:border-kx">
              {['20', '10', '1'].map((v) => <option key={v} value={v}>%{v}</option>)}
            </select>
          </label>
          {input('cost', t('cost'), t('costHelp'), '₺')}
          {input('cargo', t('cargo'), t('cargoHelp'), '₺')}
          {input('fee', t('fee'), t('feeHelp'), '₺')}
          <div className="flex items-end">
            <button type="submit" className="min-h-[48px] w-full rounded-full bg-ink px-6 font-semibold text-paper hover:opacity-90">{t('calculate')}</button>
          </div>
        </form>

        {done && (
          <div className="mt-8 grid gap-6 md:grid-cols-2" data-testid="ty-result">
            <div className="rounded-2xl border border-line bg-white p-5 md:p-8">
              <h2 className="text-xl font-semibold text-ink">{t('result')}</h2>
              <div className="mt-4">
                {row(t('rCommission'), `− ${money(r.commission)}`)}
                {row(t('rFee'), `− ${money(r.platformFee)}`)}
                {row(t('rCargo'), `− ${money(r.cargo)}`)}
                {row(t('rStopaj'), `− ${money(r.stopaj)}`, false, t('rStopajNote'))}
                {row(t('rPayout'), money(r.payout), true)}
                {row(t('rCost'), `− ${money(num(f.cost))}`)}
                {row(t('rVat'), `− ${money(r.netVat)}`)}
                {row(t('rProfit'), money(r.profit), true)}
                {row(t('rMargin'), `%${r.marginPct.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US')}`, true)}
              </div>
              <p className="mt-3 text-xs text-ink-mute">{tc('estimateNote')}</p>
            </div>

            {usdTry ? <div className="rounded-2xl border border-line bg-white p-5 md:p-8">
              <h2 className="text-xl font-semibold text-ink">{t('etsyTitle')}</h2>
              <p className="mt-1 text-sm text-ink-soft">{t('etsyIntro')}</p>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {(['priceUsd', 'shipUsd', 'shipCostTry'] as const).map((k) => (
                  <label key={k} className="block">
                    <span className="text-xs font-semibold text-ink">{t(`etsy.${k}`)}</span>
                    <input inputMode="decimal" value={etsy[k]} onChange={(x) => setEtsy({ ...etsy, [k]: x.target.value })} className="mt-1 min-h-[44px] w-full rounded-xl border border-line bg-white px-3 text-[16px] outline-none focus:border-kx" />
                  </label>
                ))}
              </div>
              {e && (
                <div className="mt-4">
                  {row(t('etsyFees'), `− ${money(e.totalFeesUsd, 'USD')}`)}
                  {row(t('etsyNet'), money(e.netTry))}
                  {row(t('etsyProfit'), money(e.profitTry ?? 0), true)}
                  {row(t('etsyVsTrendyol'), `${(e.profitTry ?? 0) - r.profit >= 0 ? '+' : '−'} ${money(Math.abs((e.profitTry ?? 0) - r.profit))}`, true)}
                  <p className="mt-2 text-xs text-ink-mute">{t('etsyRate', { rate: usdTry.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US', { maximumFractionDigits: 2 }) })}</p>
                </div>
              )}
            </div> : null}
          </div>
        )}

        {done && teaser && (
          <div className="mt-8 rounded-2xl border border-line bg-white p-5 md:p-8" data-testid="ty-teaser">
            {teaser === 'loading' ? <p className="text-sm text-ink-mute">{tc('loading')}</p> : teaser === 'none' ? <p className="text-sm text-ink-mute">{t('teaserNone')}</p> : (
              <>
                <h2 className="text-xl font-semibold text-ink">{t('teaserTitle', { category: teaser.categoryName })}</h2>
                <ol className="mt-4 divide-y divide-line">
                  {teaser.top.map((p, i) => (
                    <li key={i} className="flex items-center justify-between gap-4 py-3">
                      <span className="min-w-0 truncate text-ink">{i + 1}. {p.title}</span>
                      <span className="shrink-0 text-right text-sm tabular-nums text-ink-soft">
                        {t('perDay', { n: p.salesPerDay.toLocaleString(locale === 'tr' ? 'tr-TR' : 'en-US') })}{p.price ? ` · ${money(p.price)}` : ''}
                      </span>
                    </li>
                  ))}
                  {teaser.more > 0 && Array.from({ length: 3 }).map((_, i) => (
                    <li key={`l${i}`} aria-hidden className="flex items-center justify-between gap-4 py-3 blur-[5px] select-none">
                      <span className="text-ink">{i + 4}. ██████ █████ ████████</span><span className="text-sm text-ink-soft">██ / gün · ███ ₺</span>
                    </li>
                  ))}
                </ol>
                <p className="mt-3 text-xs text-ink-mute">{t('teaserLabel')}</p>
                {teaser.more > 0 && (
                  <div className="mt-5 flex flex-wrap items-center gap-4 rounded-xl bg-paper-2 p-4">
                    <Lock size={18} className="text-ink-soft" aria-hidden />
                    <span className="flex-1 text-ink">{t('teaserMore', { n: teaser.more })}</span>
                    {cta('teaser')}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <p className="mt-8 text-xs text-ink-mute">{t('sources', { date: TRENDYOL_RULES_CHECKED_ON })}</p>
        <p className="mt-2 text-sm text-ink-soft">
          {tc('help')}{' '}
          <a href="/app/destek" className="underline">{tc('ticket')}</a>{' · '}
          <a href={whatsappUrl(tc('whatsappText')) ?? '#'} target="_blank" rel="noopener noreferrer" className="underline">{tc('whatsapp')}</a>
        </p>
      </Section>
      <CtaBand title={t('ctaTitle')} text={t('ctaText')} />
    </>
  );
}
