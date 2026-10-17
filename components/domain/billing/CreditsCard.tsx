// components/domain/billing/CreditsCard.tsx — Settings → Billing "AI kredisi": balance (this month's plan credits +
// purchased packs), when the plan credits renew, the last generations / purchases, and "Kredi al".
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { ActionButton } from '@/components/ds/overlay';
import { neutral, tone } from '@/lib/ds/tokens';
import { useFormatters } from '@/lib/format';
import { showCreditsDialog } from '@/lib/billing/creditsDialogStore';
import { useCredits } from '@/components/domain/credits/useCredits';
import { CardHeader, DetailRow, Divider, Line } from './parts';

export function CreditsCard() {
  const t = useTranslations('credits');
  const f = useFormatters();
  const { balance } = useCredits();
  if (!balance) return null;
  const m = balance.monthly;
  const label = (kind: string, feature: string | null) =>
    kind === 'purchase' ? t('entry.purchase') : kind === 'refund' ? t('entry.refund') : kind === 'adjust' ? t('entry.adjust') : feature === 'image' ? t('entry.image') : t('entry.video');
  return (
    <Section variant="card" data-testid="billing-credits-card">
      <CardHeader
        title={t('cardTitle')}
        trailing={balance.channel ? <ActionButton action={{ id: 'buy-credits', label: t('buyShort'), onClick: () => showCreditsDialog() }} variant="secondary" size="sm" /> : null}
      />
      <Line variant="caption">{t('cardHint')}</Line>
      <div style={{ marginTop: 8 }}>
        <DetailRow label={t('balance')} value={<b>{balance.total === null ? t('unlimited') : f.num(balance.total)}</b>} />
        {m.allowance !== null ? <DetailRow label={t('planCredits')} value={t('monthly', { left: f.num(m.remaining ?? 0), of: f.num(m.allowance), date: f.date(m.renewsAt, 'date') })} /> : null}
        <DetailRow label={t('packCredits')} value={f.num(balance.packs)} />
      </div>
      {balance.recent.length ? (
        <>
          <Divider />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {balance.recent.slice(0, 6).map((e) => (
              <div key={e.id} style={{ display: 'flex', gap: 8, fontSize: 13, color: neutral[700] }}>
                <span style={{ flex: 1, minWidth: 0 }}>{label(e.kind, e.feature)}</span>
                <span style={{ color: neutral[500] }}>{f.date(e.createdAt, 'datetime')}</span>
                <span style={{ width: 64, textAlign: 'right', fontWeight: 600, color: e.delta > 0 ? tone.success.fg : neutral[800] }}>{e.delta > 0 ? '+' : ''}{f.num(e.delta)}</span>
              </div>
            ))}
          </div>
        </>
      ) : null}
    </Section>
  );
}

export default CreditsCard;
