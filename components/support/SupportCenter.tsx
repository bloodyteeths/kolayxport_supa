// components/support/SupportCenter.tsx — /app/destek: open a support ticket, read the team's answers, reply, close.
// Data: /api/support/tickets (lib/support/tickets.ts). ?t=KX-1001 opens that ticket (links in the answer email).
// Mobile first: one column; the thread replaces the list on phones.
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import useSWR from 'swr';
import Box from '@mui/material/Box';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { Button, FormField, Select, TextArea, TextField } from '@/components/ds/inputs';
import { neutral as n, accent, tone } from '@/lib/ds/tokens';
import WhatsAppHelp from './WhatsAppHelp';

interface Msg { id: string; author: 'user' | 'staff'; body: string; createdAt: string }
interface Ticket { id: string; ref: string; subject: string; category: string; status: 'open' | 'answered' | 'closed'; createdAt: string; updatedAt: string; messages: Msg[] }

const CATEGORIES = ['connection', 'orders', 'labels', 'billing', 'other'] as const;
const fetcher = (u: string) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

function StatusChip({ status }: { status: Ticket['status'] }) {
  const t = useTranslations('support.tickets');
  const c = status === 'answered' ? tone.success : status === 'open' ? tone.info : tone.neutral;
  return <Box component="span" sx={{ px: '8px', py: '2px', borderRadius: '999px', fontSize: 12, fontWeight: 600, bgcolor: c.bg, color: c.fg, border: `1px solid ${c.border}`, whiteSpace: 'nowrap' }}>{t(`status.${status}`)}</Box>;
}

async function send(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || String(r.status));
  return j;
}

export default function SupportCenter() {
  const t = useTranslations('support.tickets');
  const router = useRouter();
  const { data, mutate, error } = useSWR<{ tickets: Ticket[] }>('/api/support/tickets', fetcher);
  const tickets = useMemo(() => data?.tickets ?? [], [data]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ subject: '', category: 'connection' as string, body: '' });
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  // ?t=KX-1001 (email link) opens that ticket.
  useEffect(() => {
    const ref = typeof router.query.t === 'string' ? router.query.t : null;
    if (ref && tickets.length) {
      const hit = tickets.find((x) => x.ref === ref || x.id === ref);
      if (hit) setOpenId(hit.id);
    }
  }, [router.query.t, tickets]);

  const current = tickets.find((x) => x.id === openId) ?? null;
  const errText = (code: string) => (['subject_required', 'body_required', 'too_long', 'rate_limited'].includes(code) ? t(`errors.${code}`) : t('errors.generic'));

  const create = async () => {
    setBusy(true);
    try {
      const r = await send('/api/support/tickets', 'POST', form);
      toast.success(t('created', { ref: r.ref }));
      setForm({ subject: '', category: 'connection', body: '' });
      setCreating(false);
      await mutate();
      setOpenId(r.id);
    } catch (e) {
      toast.error(errText((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const sendReply = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await send(`/api/support/tickets/${current.id}`, 'POST', { body: reply });
      setReply('');
      toast.success(t('replied'));
      await mutate();
    } catch (e) {
      toast.error(errText((e as Error).message));
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    if (!current) return;
    setBusy(true);
    try {
      await send(`/api/support/tickets/${current.id}`, 'PATCH', { status: 'closed' });
      await mutate();
    } catch {
      toast.error(t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const card = { p: '16px', borderRadius: '12px', border: `1px solid ${n[200]}`, bgcolor: '#fff' } as const;

  if (current) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="support-thread">
        <Box><Button variant="ghost" size="sm" onClick={() => setOpenId(null)}>{t('back')}</Button></Box>
        <Box sx={{ ...card, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <Box sx={{ flex: '1 1 200px', minWidth: 0 }}>
            <Box sx={{ fontSize: 12, color: n[500] }}>{current.ref} · {t(`category.${current.category}`)}</Box>
            <Box sx={{ fontSize: 16, fontWeight: 600, color: n[900], overflowWrap: 'anywhere' }}>{current.subject}</Box>
          </Box>
          <StatusChip status={current.status} />
        </Box>
        {current.messages.map((m) => (
          <Box key={m.id} sx={{ ...card, bgcolor: m.author === 'staff' ? accent[50] : '#fff', borderColor: m.author === 'staff' ? accent[200] : n[200] }}>
            <Box sx={{ fontSize: 12, color: n[500], mb: '6px' }}>{m.author === 'staff' ? t('fromTeam') : t('fromYou')} · {when(m.createdAt)}</Box>
            <Box sx={{ fontSize: 14, color: n[900], whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{m.body}</Box>
          </Box>
        ))}
        <Box sx={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <FormField label={current.status === 'closed' ? t('replyReopens') : t('reply')}>
            <TextArea value={reply} onChange={setReply} minRows={3} maxRows={10} />
          </FormField>
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button onClick={sendReply} loading={busy} disabled={!reply.trim()} disabledReason={t('typeFirst')}>{t('send')}</Button>
            {current.status !== 'closed' && <Button variant="secondary" onClick={close} disabled={busy}>{t('close')}</Button>}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }} data-testid="support-center">
      <WhatsAppHelp variant="help" />
      {creating ? (
        <Box sx={{ ...card, display: 'flex', flexDirection: 'column', gap: '12px' }} data-testid="support-new">
          <FormField label={t('subject')}>
            <TextField value={form.subject} onChange={(v) => setForm((f) => ({ ...f, subject: v }))} maxLength={140} />
          </FormField>
          <FormField label={t('categoryLabel')}>
            <Select value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} options={CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))} />
          </FormField>
          <FormField label={t('message')} helper={t('messageHelper')}>
            <TextArea value={form.body} onChange={(v) => setForm((f) => ({ ...f, body: v }))} minRows={5} maxRows={14} />
          </FormField>
          <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <Button onClick={create} loading={busy} disabled={!form.subject.trim() || !form.body.trim()} disabledReason={t('fillBoth')}>{t('submit')}</Button>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={busy}>{t('cancel')}</Button>
          </Box>
        </Box>
      ) : (
        <Box><Button onClick={() => setCreating(true)}>{t('new')}</Button></Box>
      )}
      {error && <Box sx={{ color: tone.danger.fg, fontSize: 14 }}>{t('errors.load')}</Box>}
      {data && tickets.length === 0 && !creating && <Box sx={{ color: n[600], fontSize: 14 }}>{t('empty')}</Box>}
      {tickets.map((x) => (
        <Box key={x.id} component="button" type="button" onClick={() => setOpenId(x.id)}
          sx={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '12px', font: 'inherit', '&:hover': { borderColor: n[300] }, '&:focus-visible': { outline: `2px solid ${accent[500]}`, outlineOffset: 2 } }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ fontSize: 12, color: n[500] }}>{x.ref} · {when(x.updatedAt)}</Box>
            <Box sx={{ fontSize: 14, fontWeight: 600, color: n[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{x.subject}</Box>
          </Box>
          <StatusChip status={x.status} />
        </Box>
      ))}
    </Box>
  );
}
