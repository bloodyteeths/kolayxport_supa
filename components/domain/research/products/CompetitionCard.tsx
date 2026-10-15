// Product finder "Competition" card (research.md §5.1): competing listings (Measured supply) and the share of the
// top 48 held by the 5 biggest shops. "See top shops" scrolls to the Top listings table.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { Metric } from '@/components/ds/research/Metric';
import { useDsFormat } from '@/components/ds/data/fmt';
import { neutral } from '@/lib/ds/tokens';
import type { Guarded } from '@/lib/research/types';
import { KindNote } from './cardParts';

export type CompetitionCardProps = {
  total: Guarded<number>;
  top5Share: Guarded<number>;
  /** eBay: "active listings" wording. */
  activeOnly?: boolean;
  onSeeTopShops?: () => void;
};

export function CompetitionCard({ total, top5Share, activeOnly, onSeeTopShops }: CompetitionCardProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  return (
    <Section variant="card" title={t('card.competition')} data-testid="research-card-competition" sx={{ mb: 0, height: '100%' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: '6px', flexWrap: 'wrap' }}>
        <Metric value={total.value === null ? null : fmt.num(total.value)} kind={total.kind} guard={total.guard} size="titleMd" />
        <Typography variant="body2" component="span" sx={{ color: neutral[600] }}>
          {activeOnly ? t('card.activeListings') : t('card.listings')}
        </Typography>
      </Box>
      {top5Share.guard.ok && top5Share.value !== null ? (
        <Typography variant="caption" component="p" sx={{ m: 0, mt: '4px', color: neutral[700] }}>
          {t('card.top5Share', { pct: fmt.percent(top5Share.value) })}
        </Typography>
      ) : null}
      <KindNote kind={total.kind} />
      {onSeeTopShops ? (
        <Box sx={{ mt: '12px' }}>
          <Button variant="ghost" size="sm" onClick={onSeeTopShops}>{t('card.seeTopShops')}</Button>
        </Box>
      ) : null}
    </Section>
  );
}

export default CompetitionCard;
