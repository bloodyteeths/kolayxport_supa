// Product finder "Buyer words (tags used by top 48)" (research.md §5.1): tag · share, Measured. "Add 5 tags to a
// listing…" stages the top 5 (rules in tagMerge.ts). Etsy only: eBay has no tags.
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { Button } from '@/components/ds/inputs/Button';
import { useDsFormat } from '@/components/ds/data/fmt';
import { neutral, radius } from '@/lib/ds/tokens';
import type { BuyerWord } from '@/lib/research/types';
import { KindNote } from './cardParts';

export const BUYER_WORDS_SHOWN = 20;
export const BUYER_WORDS_ADD = 5;

export type BuyerWordsCardProps = {
  words: BuyerWord[];
  onAddTags?: (tags: string[]) => void;
};

/** Pure: the tags "Add 5 tags" proposes (top by share, ≤ 20 characters). */
export function topBuyerTags(words: BuyerWord[], n = BUYER_WORDS_ADD): string[] {
  return [...words].sort((a, b) => b.share - a.share).map((w) => w.tag).filter((tag) => tag.length <= 20).slice(0, n);
}

export function BuyerWordsCard({ words, onAddTags }: BuyerWordsCardProps) {
  const t = useTranslations('research');
  const fmt = useDsFormat();
  const shown = [...words].sort((a, b) => b.share - a.share).slice(0, BUYER_WORDS_SHOWN);
  const add = topBuyerTags(words);
  return (
    <Section variant="card" title={t('card.buyerWords')} data-testid="research-card-buyerwords">
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
        {shown.map((w) => (
          <Box
            component="li"
            key={w.tag}
            sx={{ display: 'inline-flex', gap: '6px', alignItems: 'baseline', px: '8px', py: '2px', borderRadius: `${radius.full}px`, bgcolor: neutral[100] }}
          >
            <Typography variant="body2" component="span" sx={{ color: neutral[900] }}>{w.tag}</Typography>
            <Typography variant="caption" component="span" sx={{ color: neutral[600], fontVariantNumeric: 'tabular-nums' }}>{fmt.percent(w.share)}</Typography>
          </Box>
        ))}
      </Box>
      <KindNote kind="measured" />
      {onAddTags && add.length > 0 ? (
        <Box sx={{ mt: '12px' }}>
          <Button variant="secondary" size="sm" onClick={() => onAddTags(add)} data-testid="research-add-tags">
            {t('action.addTags', { count: add.length })}
          </Button>
        </Box>
      ) : null}
    </Section>
  );
}

export default BuyerWordsCard;
