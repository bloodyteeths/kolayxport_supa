// /admin/partners — referral partners and their report (docs/gtm/referral-spec.md §4). Admin only (the APIs check
// role === 'admin'). Counts and money only; partners never see who signed up. Desktop table is fine here.
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

type Money = Record<string, number>;
interface PartnerRow {
  partnerId: string | null; code: string; name: string; status: string;
  signups: number; activated: number; activatedStore: number; activatedProxy: number; trialing: number; paying: number;
  netRevenue: Money; commissionPending: Money; commissionPayable: Money; commissionPaid: Money;
}
interface Report {
  month: string | null;
  partners: PartnerRow[];
  unattributed: Array<{ utmSource: string; signups: number; activated: number; paying: number }>;
  totals: { signups: number; activated: number; paying: number };
}
interface Partner { id: string; code: string; name: string; type: string; status: string; stripePromotionCode: string | null; promoCodeText: string | null; userId: string | null; stripeRecipientId: string | null }
interface PayoutLine { partnerId: string; code: string; name: string; currency: string; amountMinor: number; rowIds: string[]; skip: 'missing_bank_details' | 'non_positive' | null }
interface PayoutRun { dryRun: boolean; provider: 'stripe_global' | 'manual'; period: string; lines: PayoutLine[]; results?: Array<{ partnerId: string; currency: string; payoutId: string; status: string; error?: string }>; csv?: string }
interface PayoutRow { id: string; code: string | null; period: string; amountMinor: number; currency: string; provider: string; status: string; externalId: string | null; error: string | null; paidAt: string | null }

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 403) throw new Error('forbidden');
  if (!r.ok) throw new Error('error');
  return r.json();
});

const TYPES = ['fb_admin', 'tg_admin', 'x_voice', 'youtube', 'musavir', 'other'] as const;

function fmtMoney(m: Money): string {
  const parts = Object.entries(m).filter(([, v]) => v);
  return parts.length ? parts.map(([c, v]) => `${(v / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2 })} ${c.toUpperCase()}`).join(' + ') : '—';
}

const thisMonth = () => new Date().toISOString().slice(0, 7);

export default function AdminPartnersPage() {
  const t = useTranslations('admin.partners');
  const [month, setMonth] = useState<string>(thisMonth());
  const [allTime, setAllTime] = useState(false);
  const q = allTime ? '' : `?month=${month}`;
  const report = useSWR<Report>(`/api/admin/partners/report${q}`, fetcher);
  const list = useSWR<{ partners: Partner[] }>('/api/admin/partners', fetcher);
  const [form, setForm] = useState({ code: '', name: '', type: 'fb_admin', email: '', userEmail: '', createPromo: false });
  const payoutList = useSWR<{ payouts: PayoutRow[] }>('/api/admin/partners/payouts', fetcher);
  const [run, setRun] = useState<PayoutRun | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  if (report.error?.message === 'forbidden' || list.error?.message === 'forbidden') {
    return <div className="p-8 text-gray-700">{t('forbidden')}</div>;
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch('/api/admin/partners', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'error');
      toast.success(t('created', { code: d.partner.code }));
      setForm({ code: '', name: '', type: 'fb_admin', email: '', userEmail: '', createPromo: false });
      void list.mutate();
      void report.mutate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error'));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (body: Record<string, unknown>) => {
    const r = await fetch('/api/admin/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast.success(t('updated')); void list.mutate(); void report.mutate(); } else toast.error(d.error || t('error'));
  };

  // The admin types the e-mail into an inline field (no browser prompt dialogs in this app).
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const [linkEmail, setLinkEmail] = useState('');

  const doRun = async (confirm: boolean) => {
    setRunBusy(true);
    try {
      const r = await fetch(`/api/admin/partners/payouts/run?month=${month}${confirm ? '&confirm=true' : ''}`, { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'error');
      setRun(d);
      if (confirm) { toast.success(t('payouts.done')); void payoutList.mutate(); void report.mutate(); }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error'));
    } finally {
      setRunBusy(false);
    }
  };

  const [refFor, setRefFor] = useState<string | null>(null);
  const [refText, setRefText] = useState('');
  const markPaid = async (payoutId: string) => {
    const r = await fetch('/api/admin/partners/payouts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payoutId, reference: refText }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { toast.success(t('updated')); setRefFor(null); setRefText(''); void payoutList.mutate(); void report.mutate(); } else toast.error(d.error || t('error'));
  };

  const setStatus = async (id: string, status: string) => {
    const r = await fetch('/api/admin/partners', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }) });
    if (r.ok) { toast.success(t('updated')); void list.mutate(); void report.mutate(); } else toast.error(t('error'));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Head><title>{t('title')}</title></Head>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/admin" className="text-sm text-blue-600 hover:underline">{t('back')}</Link>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-sm text-gray-500">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={allTime} onChange={(e) => setAllTime(e.target.checked)} /> {t('allTime')}
            </label>
            {!allTime ? (
              <input type="month" value={month} onChange={(e) => setMonth(e.target.value || thisMonth())} className="rounded border border-gray-300 px-2 py-1 text-sm" aria-label={t('month')} />
            ) : null}
            <a href={`/api/admin/partners/report${q}${q ? '&' : '?'}format=csv`} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">{t('csv')}</a>
          </div>
        </div>

        <section className="grid grid-cols-3 gap-4">
          {(['signups', 'activated', 'paying'] as const).map((k) => (
            <div key={k} className="rounded-xl border border-gray-200 bg-white p-4">
              <p className="text-sm text-gray-500">{t(`totals.${k}`)}</p>
              <p className="text-2xl font-bold text-gray-900">{report.data?.totals[k] ?? '—'}</p>
            </div>
          ))}
        </section>

        <section className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-left text-gray-600">
              <tr>
                {['code', 'name', 'status', 'signups', 'activated', 'trialing', 'paying', 'netRevenue', 'pending', 'payable', 'paid', 'actions'].map((c) => (
                  <th key={c} className="px-3 py-2 font-medium">{t(`col.${c}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(report.data?.partners ?? []).map((p) => (
                <tr key={p.partnerId ?? p.code} className="border-t border-gray-100">
                  <td className="px-3 py-2 font-mono">{p.code}</td>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2">{t(`statusValue.${p.status}`)}</td>
                  <td className="px-3 py-2">{p.signups}</td>
                  <td className="px-3 py-2" title={t('activatedSplit', { store: p.activatedStore, proxy: p.activatedProxy })}>{p.activated}</td>
                  <td className="px-3 py-2">{p.trialing}</td>
                  <td className="px-3 py-2">{p.paying}</td>
                  <td className="px-3 py-2">{fmtMoney(p.netRevenue)}</td>
                  <td className="px-3 py-2">{fmtMoney(p.commissionPending)}</td>
                  <td className="px-3 py-2">{fmtMoney(p.commissionPayable)}</td>
                  <td className="px-3 py-2">{fmtMoney(p.commissionPaid)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.partnerId && p.status !== 'active' ? <button type="button" className="text-blue-600 hover:underline" onClick={() => setStatus(p.partnerId!, 'active')}>{t('action.activate')}</button> : null}
                    {p.partnerId && p.status === 'active' ? <button type="button" className="text-amber-600 hover:underline" onClick={() => setStatus(p.partnerId!, 'paused')}>{t('action.pause')}</button> : null}
                    {p.partnerId && p.status !== 'terminated' ? <button type="button" className="ml-3 text-red-600 hover:underline" onClick={() => setStatus(p.partnerId!, 'terminated')}>{t('action.terminate')}</button> : null}
                    {p.partnerId ? (
                      <button type="button" className="ml-3 text-gray-700 hover:underline" onClick={() => { setLinkFor(p.partnerId); setLinkEmail(''); }}>
                        {(list.data?.partners ?? []).find((x) => x.id === p.partnerId)?.userId ? t('action.relink') : t('action.link')}
                      </button>
                    ) : null}
                    {linkFor === p.partnerId ? (
                      <span className="ml-3 inline-flex items-center gap-2">
                        <input type="email" value={linkEmail} onChange={(e) => setLinkEmail(e.target.value)} placeholder={t('new.userEmail')} className="rounded border border-gray-300 px-2 py-0.5" />
                        <button type="button" className="text-blue-600 hover:underline" onClick={() => { void patch({ id: p.partnerId, userEmail: linkEmail }); setLinkFor(null); }}>{t('action.save')}</button>
                        <button type="button" className="text-gray-500 hover:underline" onClick={() => setLinkFor(null)}>{t('action.cancel')}</button>
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
              {report.data && !report.data.partners.length ? (
                <tr><td colSpan={12} className="px-3 py-6 text-center text-gray-500">{t('empty')}</td></tr>
              ) : null}
            </tbody>
          </table>
          <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">{t('footnote')}</p>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 font-semibold text-gray-900">{t('unattributed')}</h2>
          <table className="text-sm">
            <thead className="text-left text-gray-600"><tr><th className="pr-6">{t('col.source')}</th><th className="pr-6">{t('col.signups')}</th><th className="pr-6">{t('col.activated')}</th><th>{t('col.paying')}</th></tr></thead>
            <tbody>
              {(report.data?.unattributed ?? []).map((u) => (
                <tr key={u.utmSource}><td className="pr-6 font-mono">{u.utmSource}</td><td className="pr-6">{u.signups}</td><td className="pr-6">{u.activated}</td><td>{u.paying}</td></tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-1 font-semibold text-gray-900">{t('payouts.title')}</h2>
          <p className="mb-3 text-xs text-gray-500">{t('payouts.hint')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={runBusy} onClick={() => doRun(false)} className="rounded border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-50">{t('payouts.dryRun', { month })}</button>
            {run?.dryRun && run.lines.some((l) => !l.skip) ? (
              <button type="button" disabled={runBusy} onClick={() => doRun(true)} className="rounded bg-red-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">
                {t(run.provider === 'stripe_global' ? 'payouts.confirmStripe' : 'payouts.confirmManual', { count: run.lines.filter((l) => !l.skip).length })}
              </button>
            ) : null}
            {run ? <span className="text-xs text-gray-500">{t(`payouts.provider.${run.provider}`)}</span> : null}
          </div>
          {run ? (
            <div className="mt-3 overflow-x-auto">
              <table className="text-sm">
                <thead className="text-left text-gray-600"><tr><th className="pr-6">{t('col.code')}</th><th className="pr-6">{t('payouts.amount')}</th><th className="pr-6">{t('payouts.rows')}</th><th>{t('col.status')}</th></tr></thead>
                <tbody>
                  {run.lines.map((l) => (
                    <tr key={`${l.partnerId}-${l.currency}`}>
                      <td className="pr-6 font-mono">{l.code}</td>
                      <td className="pr-6">{fmtMoney({ [l.currency]: l.amountMinor })}</td>
                      <td className="pr-6">{l.rowIds.length}</td>
                      <td>{l.skip ? t(`payouts.skip.${l.skip}`) : run.results?.find((x) => x.partnerId === l.partnerId && x.currency === l.currency)?.status ?? t('payouts.toPay')}</td>
                    </tr>
                  ))}
                  {!run.lines.length ? <tr><td colSpan={4} className="py-2 text-gray-500">{t('payouts.nothing')}</td></tr> : null}
                </tbody>
              </table>
            </div>
          ) : null}
          <h3 className="mb-2 mt-4 text-sm font-semibold text-gray-900">{t('payouts.history')}</h3>
          <div className="overflow-x-auto">
            <table className="text-sm">
              <tbody>
                {(payoutList.data?.payouts ?? []).map((p) => (
                  <tr key={p.id} className="border-t border-gray-100">
                    <td className="py-1 pr-6 font-mono">{p.code}</td>
                    <td className="pr-6">{p.period}</td>
                    <td className="pr-6">{fmtMoney({ [p.currency]: p.amountMinor })}</td>
                    <td className="pr-6">{t(`payouts.provider.${p.provider === 'stripe_global' ? 'stripe_global' : 'manual'}`)}</td>
                    <td className="pr-6">{p.status}{p.error ? `: ${p.error}` : ''}</td>
                    <td>
                      {p.provider === 'manual' && p.status !== 'paid' ? (
                        refFor === p.id ? (
                          <span className="inline-flex items-center gap-2">
                            <input value={refText} onChange={(e) => setRefText(e.target.value)} placeholder={t('payouts.reference')} className="rounded border border-gray-300 px-2 py-0.5" />
                            <button type="button" disabled={!refText.trim()} className="text-blue-600 hover:underline disabled:opacity-50" onClick={() => markPaid(p.id)}>{t('payouts.markPaid')}</button>
                          </span>
                        ) : (
                          <button type="button" className="text-blue-600 hover:underline" onClick={() => { setRefFor(p.id); setRefText(''); }}>{t('payouts.markPaid')}</button>
                        )
                      ) : null}
                    </td>
                  </tr>
                ))}
                {!(payoutList.data?.payouts ?? []).length ? <tr><td className="py-1 text-gray-500">{t('payouts.none')}</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-3 font-semibold text-gray-900">{t('new.title')}</h2>
          <form onSubmit={create} className="grid grid-cols-1 gap-3 md:grid-cols-6">
            <input required placeholder={t('new.code')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} className="rounded border border-gray-300 px-2 py-1.5 font-mono" maxLength={20} />
            <input required placeholder={t('new.name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5" />
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5" aria-label={t('new.type')}>
              {TYPES.map((ty) => <option key={ty} value={ty}>{t(`type.${ty}`)}</option>)}
            </select>
            <input type="email" placeholder={t('new.email')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5" />
            <input type="email" placeholder={t('new.userEmail')} value={form.userEmail} onChange={(e) => setForm({ ...form, userEmail: e.target.value })} className="rounded border border-gray-300 px-2 py-1.5" />
            <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-white disabled:opacity-50">{t('new.submit')}</button>
            <label className="flex items-center gap-2 text-sm text-gray-700 md:col-span-6">
              <input type="checkbox" checked={form.createPromo} onChange={(e) => setForm({ ...form, createPromo: e.target.checked })} /> {t('new.createPromo')}
            </label>
          </form>
          <p className="mt-2 text-xs text-gray-500">{t('new.linkHint')}</p>
          {(list.data?.partners ?? []).some((p) => p.stripePromotionCode) ? (
            <ul className="mt-3 text-xs text-gray-600">
              {(list.data?.partners ?? []).filter((p) => p.stripePromotionCode).map((p) => (
                <li key={p.id}><span className="font-mono">{p.code}</span>: {t('promoLine', { promo: p.promoCodeText ?? p.code })}</li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </div>
  );
}
