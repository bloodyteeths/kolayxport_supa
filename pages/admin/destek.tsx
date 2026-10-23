// /admin/destek — answer support tickets (lib/support/tickets.ts). Admin only (the APIs check role === 'admin').
// An answer emails the user (Reply-To the support inbox). ?t=<ticket id> opens a ticket (team alert email link).
import React, { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

interface Msg { id: string; author: 'user' | 'staff'; body: string; createdAt: string }
interface Ticket { id: string; ref: string; subject: string; category: string; status: string; createdAt: string; updatedAt: string; user: { email: string | null; name: string | null; subscriptionPlan: string | null }; messages: Msg[] }

const fetcher = (url: string) => fetch(url).then((r) => {
  if (r.status === 403) throw new Error('forbidden');
  if (!r.ok) throw new Error('error');
  return r.json();
});
const when = (iso: string) => new Date(iso).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function AdminSupportPage() {
  const t = useTranslations('admin.support');
  const ts = useTranslations('support.tickets');
  const router = useRouter();
  const [status, setStatus] = useState('open');
  const { data, error, mutate } = useSWR<{ tickets: Ticket[] }>(`/api/admin/support?status=${status}`, fetcher);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (typeof router.query.t === 'string') { setOpenId(router.query.t); setStatus('all'); }
  }, [router.query.t]);

  if (error?.message === 'forbidden') return <div className="p-8 text-gray-700">{t('forbidden')}</div>;
  const tickets = data?.tickets ?? [];
  const cur = tickets.find((x) => x.id === openId) ?? null;

  const act = async (method: 'POST' | 'PATCH', body: unknown) => {
    if (!cur) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/admin/support/${cur.id}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error();
      if (method === 'POST') { setReply(''); toast.success(t('sent')); }
      await mutate();
    } catch {
      toast.error(t('failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <Head><title>{t('title')} · KolayXport</title></Head>
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Link href="/admin" className="text-sm text-blue-600 hover:underline">{t('back')}</Link>
            <h1 className="text-2xl font-bold text-gray-900">{t('title')}</h1>
            <p className="text-sm text-gray-500">{t('subtitle')}</p>
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded border border-gray-300 px-2 py-1 text-sm" aria-label={t('filter')}>
            {['open', 'answered', 'closed', 'all'].map((s) => <option key={s} value={s}>{s === 'all' ? t('all') : ts(`status.${s}`)}</option>)}
          </select>
        </div>
        <div className="grid gap-4 md:grid-cols-[320px_1fr]">
          <section className="space-y-2">
            {!data && !error && <p className="text-sm text-gray-500">{t('loading')}</p>}
            {data && tickets.length === 0 && <p className="text-sm text-gray-500">{t('empty')}</p>}
            {tickets.map((x) => (
              <button key={x.id} type="button" onClick={() => setOpenId(x.id)} className={`block w-full rounded-lg border bg-white p-3 text-left ${x.id === openId ? 'border-blue-500' : 'border-gray-200'}`}>
                <div className="text-xs text-gray-500">{x.ref} · {when(x.updatedAt)} · {ts(`status.${x.status}`)}</div>
                <div className="truncate text-sm font-semibold text-gray-900">{x.subject}</div>
                <div className="truncate text-xs text-gray-500">{x.user.name || '—'} · {x.user.email}</div>
              </button>
            ))}
          </section>
          <section className="rounded-lg border border-gray-200 bg-white p-4">
            {!cur ? <p className="text-sm text-gray-500">{t('pick')}</p> : (
              <div className="space-y-3">
                <div>
                  <div className="text-xs text-gray-500">{cur.ref} · {ts(`category.${cur.category}`)} · {cur.user.name || '—'} &lt;{cur.user.email}&gt; · {cur.user.subscriptionPlan || '—'}</div>
                  <h2 className="text-lg font-semibold text-gray-900">{cur.subject}</h2>
                </div>
                {cur.messages.map((m) => (
                  <div key={m.id} className={`rounded border p-3 ${m.author === 'staff' ? 'border-blue-200 bg-blue-50' : 'border-gray-200'}`}>
                    <div className="mb-1 text-xs text-gray-500">{m.author === 'staff' ? t('team') : t('user')} · {when(m.createdAt)}</div>
                    <div className="whitespace-pre-wrap text-sm text-gray-900">{m.body}</div>
                  </div>
                ))}
                <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={5} className="w-full rounded border border-gray-300 p-2 text-sm" placeholder={t('replyPlaceholder')} aria-label={t('reply')} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" disabled={busy || !reply.trim()} onClick={() => act('POST', { body: reply })} className="rounded bg-gray-900 px-3 py-1.5 text-sm text-white disabled:opacity-50">{t('sendAnswer')}</button>
                  {cur.status !== 'closed'
                    ? <button type="button" disabled={busy} onClick={() => act('PATCH', { status: 'closed' })} className="rounded border border-gray-300 px-3 py-1.5 text-sm">{t('close')}</button>
                    : <button type="button" disabled={busy} onClick={() => act('PATCH', { status: 'open' })} className="rounded border border-gray-300 px-3 py-1.5 text-sm">{t('reopen')}</button>}
                </div>
                <p className="text-xs text-gray-500">{t('emailNote')}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
