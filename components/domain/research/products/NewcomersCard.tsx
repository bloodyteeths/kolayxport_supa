// Product finder "Newcomers" card (research.md §5.1): share of the top-48 shops opened < 1 year ago (Etsy).
// eBay shows "N of top 50 have sold at least 1 (all time)" in its place (§5.1 eBay columns), passed as `soldOnce`.
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Metric } from '@/components/ds/research/Metric';
import { useDsFormat } from '@/components/ds/data/fmt';
import { neutral } from '@/lib/ds/tokens';
import type { Guarded } from '@/lib/research/types';
import { KindNote } from './cardParts';

export type NewcomersCardProps = {
  newcomers: Guarded<number>;
  /** eBay: count of the top 50 with at least one sale (all time). */
  soldOnce?: { count: Guarded<number>; of: number };
};

export function NewcomersCard({ newcomers, soldOnce }: NewcomersCardProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  if (soldOnce) {
    return (
      <Section variant="card" title={t('card.soldOnce')} data-testid="research-card-soldonce" sx={{ mb: 0, height: '100%' }}>
        <Metric value={soldOnce.count.value === null ? null : fmt.num(soldOnce.count.value)} kind={soldOnce.count.kind} guard={soldOnce.count.guard} size="titleMd" />
        <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: neutral[700] }}>{t('card.soldOnceValue', { of: soldOnce.of })}</Typography>
        <KindNote kind={soldOnce.count.kind} />
      </Section>
    );
  }
  return (
    <Section variant="card" title={t('card.newcomers')} data-testid="research-card-newcomers" sx={{ mb: 0, height: '100%' }}>
      <Metric value={newcomers.value === null ? null : fmt.percent(newcomers.value)} kind={newcomers.kind} guard={newcomers.guard} size="titleMd" />
      <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: neutral[700] }}>{t('card.newcomersValue')}</Typography>
      <KindNote kind={newcomers.kind} />
    </Section>
  );
}

export default NewcomersCard;
