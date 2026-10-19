// Partner dashboard (/app/ortaklik, docs/gtm/referral-spec.md §4.2): the partner's link and code, totals, masked
// referrals as expandable cards (app mobile pattern), payout history and the Stripe-hosted bank details button.
import React, { useState } from 'react';
import useSWR from 'swr';
import { useRouter } from 'next/router';
import { useLocale, useTranslations } from 'next-intl';
import Box from '@mui/material/Box';
import { Section } from '@/components/ds/page';
import { KpiTile } from '@/components/ds/data/KpiTile';
import { Banner } from '@/components/ds/feedback';
import { Button } from '@/components/ds/inputs/Button';
import { icons } from '@/lib/ds/icons';
import { toast } from 'react-hot-toast';

type Money = Record<string, number>;
interface Referral {
  key: string;
  name: string;
  plan: string | null;
  interval: string | null;
  status: 'deneme' | 'aktif' | 'odedi' | 'iptal';
  signedUpAt: string;
  bounty: { amountMinor: number; currency: string; status: string; payableAt: string | null } | null;
}
interface Payout { id: string; period: string; amountMinor: number; currency: string; status: string; paidAt: string | null; createdAt: string }
interface DashboardData {
  partner: { code: string; name: string; status: string; promoCode: string | null };
  link: string;
  bank: { provider: 'stripe_global' | 'manual'; connected: boolean };
  totals: { signups: number; activated: number; paying: number; pending: Money; payable: Money; paid: Money };
  referrals: Referral[];
  payouts: Payout[];
  generatedAt: string;
}

const fetcher = async (url: string) => {
  const r = await fetch(url, { credentials: 'same-origin' });
  if (r.status === 404) throw Object.assign(new Error('not_found'), { status: 404 });
  if (!r.ok) throw new Error('error');
  return r.json();
};

const STATUS_TONE: Record<Referral['status'], { bg: string; fg: string }> = {
  deneme: { bg: '#F1F5F9', fg: '#334155' },
  aktif: { bg: '#E0F2FE', fg: '#075985' },
  odedi: { bg: '#DCFCE7', fg: '#166534' },
  iptal: { bg: '#FEE2E2', fg: '#991B1B' },
};

function useMoney() {
  const locale = useLocale();
  return (minor: number, currency: string) =>
    new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-GB', { style: 'currency', currency: currency.toUpperCase(), maximumFractionDigits: 2 }).format(minor / 100);
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useTranslations('partners.dashboard');
  const Copy = icons.copy;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', py: 0.75 }}>
      <Box sx={{ fontSize: 13, color: 'text.secondary', minWidth: 96 }}>{label}</Box>
      <Box component="code" sx={{ fontSize: 14, wordBreak: 'break-all', flex: '1 1 200px' }}>{value}</Box>
      <Button
        variant="secondary"
        size="sm"
        icon={Copy}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => toast.success(t('copied')), () => toast.error(t('copyFailed')));
        }}
      >
        {t('copy')}
      </Button>
    </Box>
  );
}

function ReferralCard({ r }: { r: Referral }) {
  const t = useTranslations('partners.dashboard');
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const Disclosure = icons.disclosure;
  const tone = STATUS_TONE[r.status];
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper' }}>
      <Box
        component="button"
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        sx={{ all: 'unset', boxSizing: 'border-box', width: '100%', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1.5, px: 1.5, py: 1.25 }}
      >
        <Box sx={{ fontWeight: 600, fontSize: 14, flex: 1 }}>{r.name}</Box>
        <Box sx={{ fontSize: 12, px: 1, py: 0.25, borderRadius: 999, bgcolor: tone.bg, color: tone.fg }}>{t(`status.${r.status}`)}</Box>
        <Box sx={{ fontSize: 14, fontVariantNumeric: 'tabular-nums', minWidth: 80, textAlign: 'right' }}>
          {r.bounty && r.bounty.status !== 'void' ? money(r.bounty.amountMinor, r.bounty.currency) : '—'}
        </Box>
        <Disclosure size={16} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 120ms' }} aria-hidden />
      </Box>
      {open ? (
        <Box sx={{ px: 1.5, pb: 1.5, display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 2, rowGap: 0.5, fontSize: 13 }}>
          <Box sx={{ color: 'text.secondary' }}>{t('field.plan')}</Box>
          <Box>{r.plan ? `${r.plan}${r.interval ? ` · ${t(`interval.${r.interval === 'year' ? 'year' : 'month'}`)}` : ''}` : '—'}</Box>
          <Box sx={{ color: 'text.secondary' }}>{t('field.signedUp')}</Box>
          <Box>{new Date(r.signedUpAt).toLocaleDateString()}</Box>
          <Box sx={{ color: 'text.secondary' }}>{t('field.bounty')}</Box>
          <Box>{r.bounty ? `${money(r.bounty.amountMinor, r.bounty.currency)} · ${t(`bountyStatus.${r.bounty.status}`)}` : t('noBounty')}</Box>
          {r.bounty?.status === 'pending' && r.bounty.payableAt ? (
            <>
              <Box sx={{ color: 'text.secondary' }}>{t('field.payableAt')}</Box>
              <Box>{new Date(r.bounty.payableAt).toLocaleDateString()}</Box>
            </>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

export default function PartnerDashboard() {
  const t = useTranslations('partners.dashboard');
  const money = useMoney();
  const router = useRouter();
  const { data, error, isLoading } = useSWR<DashboardData>('/api/partner/dashboard', fetcher, { revalidateOnFocus: false });
  const [bankBusy, setBankBusy] = useState(false);

  React.useEffect(() => {
    if ((error as { status?: number } | undefined)?.status === 404) void router.replace('/app');
  }, [error, router]);

  if (error) return (error as { status?: number }).status === 404 ? null : <Banner tone="danger" title={t('loadError')} />;
  if (isLoading || !data) return <Box sx={{ color: 'text.secondary', fontSize: 14, py: 4 }}>{t('loading')}</Box>;

  const sum = (m: Money) => {
    const parts = Object.entries(m).filter(([, v]) => v);
    return parts.length ? parts.map(([c, v]) => money(v, c)).join(' + ') : money(0, 'try');
  };

  const openBank = async () => {
    setBankBusy(true);
    try {
      const r = await fetch('/api/partner/payout-onboarding', { method: 'POST', credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.url) throw new Error(d.error || 'error');
      window.location.assign(d.url);
    } catch {
      toast.error(t('bank.error'));
      setBankBusy(false);
    }
  };

  const bankDone = router.query.bank === 'done';
  const asOf = new Date(data.generatedAt);

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      {bankDone ? <Banner tone="success" title={t('bank.returned')} /> : null}
      {data.partner.status === 'paused' ? <Banner tone="warning" title={t('paused')} /> : null}

      <Section title={t('linkTitle')} description={t('linkHint')} variant="card">
        <CopyRow label={t('link')} value={data.link} />
        <CopyRow label={t('code')} value={data.partner.code} />
        {data.partner.promoCode ? <CopyRow label={t('promoCode')} value={data.partner.promoCode} /> : null}
      </Section>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
        <KpiTile label={t('totals.signups')} value={data.totals.signups} source={t('totals.source')} asOf={asOf} />
        <KpiTile label={t('totals.activated')} value={data.totals.activated} source={t('totals.source')} asOf={asOf} />
        <KpiTile label={t('totals.paying')} value={data.totals.paying} source={t('totals.source')} asOf={asOf} />
        <KpiTile label={t('totals.pending')} value={sum(data.totals.pending)} caption={t('totals.pendingHint')} source={t('totals.source')} asOf={asOf} />
        <KpiTile label={t('totals.payable')} value={sum(data.totals.payable)} source={t('totals.source')} asOf={asOf} />
        <KpiTile label={t('totals.paid')} value={sum(data.totals.paid)} source={t('totals.source')} asOf={asOf} />
      </Box>

      <Section title={t('referralsTitle')} description={t('referralsHint')}>
        {data.referrals.length ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {data.referrals.map((r) => <ReferralCard key={r.key} r={r} />)}
          </Box>
        ) : (
          <Box sx={{ color: 'text.secondary', fontSize: 14 }}>{t('noReferrals')}</Box>
        )}
      </Section>

      <Section title={t('bank.title')} description={data.bank.provider === 'stripe_global' ? t('bank.hint') : t('bank.manualHint')} variant="card">
        {data.bank.provider === 'stripe_global' ? (
          <Button variant="primary" loading={bankBusy} onClick={openBank}>
            {data.bank.connected ? t('bank.update') : t('bank.enter')}
          </Button>
        ) : null}
      </Section>

      <Section title={t('payoutsTitle')}>
        {data.payouts.length ? (
          <Box sx={{ display: 'grid', gap: 1 }}>
            {data.payouts.map((p) => (
              <Box key={p.id} sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap', border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1, fontSize: 14 }}>
                <Box sx={{ fontWeight: 600 }}>{p.period}</Box>
                <Box sx={{ flex: 1, fontVariantNumeric: 'tabular-nums' }}>{money(p.amountMinor, p.currency)}</Box>
                <Box sx={{ color: 'text.secondary', fontSize: 13 }}>{t(`payoutStatus.${p.status === 'sent' || p.status === 'paid' ? 'paid' : p.status === 'failed' ? 'failed' : 'processing'}`)}</Box>
              </Box>
            ))}
          </Box>
        ) : (
          <Box sx={{ color: 'text.secondary', fontSize: 14 }}>{t('noPayouts')}</Box>
        )}
      </Section>

      <Box sx={{ color: 'text.secondary', fontSize: 12 }}>{t('privacyNote')}</Box>
    </Box>
  );
}
