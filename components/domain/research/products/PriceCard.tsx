// Product finder "Price" card (research.md §5.1, §3.1): p25 · median · p75 through the DS PriceBand (robust stats
// from lib/research/stats; n < 5 "Not enough data", n < 20 range only). "Use $49 in a listing" stages the median
// on one of the user's listings (only when a median can be shown).
import Box from '@mui/material/Box';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { PriceBand, priceBandMode } from '@/components/ds/research/PriceBand';
import { useDsFormat } from '@/components/ds/data/fmt';
import type { PriceSummary } from '@/lib/research/types';
import { KindNote } from './cardParts';

export type PriceCardProps = {
  price: PriceSummary;
  /** Absent = no staging for this marketplace (Amazon, Trendyol). */
  onUsePrice?: (amount: number, currency: string) => void;
};

export function PriceCard({ price, onUsePrice }: PriceCardProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const implausible = price.quality === 'implausible';
  const mode = priceBandMode({ p25: price.p25, median: price.median, p75: price.p75, n: price.n, implausible });
  const median = mode === 'full' ? price.median : null;
  return (
    <Section variant="card" id="price" title={t('card.price')} data-testid="research-card-price" sx={{ mb: 0, height: '100%' }}>
      <PriceBand p25={price.p25} median={price.median} p75={price.p75} currency={price.currency} n={price.n} implausible={implausible} />
      <KindNote kind="measured">{t('card.pctMedian')}</KindNote>
      {onUsePrice && median !== null ? (
        <Box sx={{ mt: '12px' }}>
          <Button variant="secondary" size="sm" onClick={() => onUsePrice(median, price.currency)} data-testid="research-use-price">
            {t('action.usePrice', { price: fmt.money(median, price.currency) })}
          </Button>
        </Box>
      ) : null}
    </Section>
  );
}

export default PriceCard;
