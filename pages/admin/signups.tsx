// /admin/signups — who signed up, where from, and whether they connected a store and got a first order
// (lib/admin/signups.ts). Admin only (the API checks role === 'admin'). Contact details are for onboarding
// follow-up only. Desktop table is fine here.
import React, { useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import useSWR from 'swr';
import { useTranslations } from 'next-intl';

interface Funnel { signups: number; connected: number; withOrder: number; activated: number; connectRate: number; orderRate: number }
interface Row { createdAt: string; name: string | null; email: string; source: string; via: string | null; stores: string[]; firstOrderAt: string | null; activated: boolean; plan: string | null; status: string | null; shopify: boolean; remindersSent: string[] }
interface Report { days: number; rows: Row[]; totals: Funnel; byDay: Array<{ day: string } & Funnel>; bySource: Array<{ source: string } & Funnel> }

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 403) throw new Error('forbidden');
  if (!r.ok) throw new Error('error');
  return r.json();
});
const pct = (v: number) => `${Math.round(v * 100)}%`;
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function FunnelTable({ rows, first, t }: { rows: Array<{ key: string } & Funnel>; first: string; t: ReturnType<typeof useTranslations> }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-left text-gray-500">
        <th className="py-1 pr-3">{first}</th><th className="pr-3">{t('signups')}</th><th className="pr-3">{t('connected')}</th>
        <th className="pr-3">{t('withOrder')}</th><th className="pr-3">{t('connectRate')}</th><th>{t('orderRate')}</th>
      </tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} className="border-t border-gray-100">
            <td className="py-1 pr-3 font-mono">{r.key}</td><td className="pr-3">{r.signups}</td><td className="pr-3">{r.connected}</td>
            <td className="pr-3">{r.withOrder}</td><td className="pr-3">{pct(r.connectRate)}</td><td>{pct(r.orderRate)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AdminSignupsPage() {
  const t = useTranslations('admin.signups');
  const [days, setDays] = useState(30);
  const { data, error } = useSWR<Report>(`/api/admin/signups?days=${days}`, fetcher);
  if (error?.message === 'forbidden') return <div className="p-8 text-gray-700">{t('forbidden')}</div>;
  const tot = data?.totals;
  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Head><title>{t('title')} · KolayXport</title></Head>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/admin" className="text-sm text-blue-600 hover:underline">{t('back')}</Link>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-sm text-gray-500">{t('subtitle')}</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              {t('period')}
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="rounded border border-gray-300 px-2 py-1 text-sm">
                {[1, 7, 30, 90].map((d) => <option key={d} value={d}>{t('days', { count: d })}</option>)}
              </select>
            </label>
            <a href={`/api/admin/signups?days=${days}&format=csv`} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white">{t('csv')}</a>
          </div>
        </div>

        {!data && !error && <p className="text-sm text-gray-500">{t('loading')}</p>}
        {error && error.message !== 'forbidden' && <p className="text-sm text-red-600">{t('loadFailed')}</p>}

        {tot && (
          <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              [t('signups'), String(tot.signups)],
              [t('connected'), `${tot.connected} (${pct(tot.connectRate)})`],
              [t('withOrder'), `${tot.withOrder} (${pct(tot.orderRate)})`],
              [t('activated'), String(tot.activated)],
              [t('target'), `${tot.activated} / 100`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="text-xs text-gray-500">{k}</div><div className="text-xl font-semibold text-gray-900">{v}</div>
              </div>
            ))}
          </section>
        )}

        {data && (
          <div className="grid gap-6 md:grid-cols-2">
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold text-gray-900">{t('byDay')}</h2>
              <FunnelTable rows={data.byDay.map((d) => ({ key: d.day, ...d }))} first={t('day')} t={t} />
            </section>
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h2 className="mb-2 font-semibold text-gray-900">{t('bySource')}</h2>
              <FunnelTable rows={data.bySource.map((d) => ({ key: d.source, ...d }))} first={t('source')} t={t} />
            </section>
          </div>
        )}

        {data && (
          <section className="overflow-x-auto rounded-lg border border-gray-200 bg-white p-4">
            <h2 className="mb-1 font-semibold text-gray-900">{t('people')}</h2>
            <p className="mb-3 text-xs text-gray-500">{t('privacy')}</p>
            {data.rows.length === 0 ? <p className="text-sm text-gray-500">{t('empty')}</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-gray-500">
                  <th className="py-1 pr-3">{t('signedUp')}</th><th className="pr-3">{t('name')}</th><th className="pr-3">{t('email')}</th>
                  <th className="pr-3">{t('source')}</th><th className="pr-3">{t('stores')}</th><th className="pr-3">{t('firstOrder')}</th>
                  <th className="pr-3">{t('plan')}</th><th>{t('reminders')}</th>
                </tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.email + r.createdAt} className="border-t border-gray-100 align-top">
                      <td className="py-1 pr-3 whitespace-nowrap">{when(r.createdAt)}</td>
                      <td className="pr-3">{r.name || '—'}{r.shopify ? <span className="ml-1 rounded bg-green-50 px-1 text-xs text-green-700">Shopify</span> : null}</td>
                      <td className="pr-3"><a href={`mailto:${r.email}`} className="text-blue-600 hover:underline">{r.email}</a></td>
                      <td className="pr-3 font-mono text-xs">{r.source}</td>
                      <td className="pr-3">{r.stores.length ? r.stores.join(', ') : <span className="text-amber-700">{t('noStore')}</span>}</td>
                      <td className="pr-3 whitespace-nowrap">{r.firstOrderAt ? when(r.firstOrderAt) : '—'}</td>
                      <td className="pr-3">{r.plan || '—'}{r.status ? ` · ${r.status}` : ''}</td>
                      <td>{r.remindersSent.length ? r.remindersSent.join(', ') : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
