// "English keywords: (wooden baby keepsake box ✕) (personalized memory box ✕) from "ahşap anı kutusu"" (research.md
// §3.3, §5.1): seeds from a Turkish query (POST /api/research/seeds, 1 AI credit). Keywords stay English (P5).
// The active seed is the current search; picking another searches it; ✕ removes a seed.
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { icons } from '@/lib/ds/icons';
import { accent, neutral, radius } from '@/lib/ds/tokens';

export type SeedChipsProps = {
  from: string;
  seeds: string[];
  active: string;
  onPick: (seed: string) => void;
  onRemove: (seed: string) => void;
};

export function SeedChips({ from, seeds, active, onPick, onRemove }: SeedChipsProps) {
  const t = useTranslations('research');
  if (!seeds.length) return null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '6px', mb: '8px' }} data-testid="research-seeds">
      <Typography variant="caption" component="span" sx={{ color: neutral[600] }}>{t('translate.label')}</Typography>
      {seeds.map((seed) => {
        const on = seed === active;
        return (
          <Box
            key={seed}
            sx={{
              display: 'inline-flex', alignItems: 'center', borderRadius: `${radius.full}px`, border: `1px solid ${on ? accent[600] : neutral[300]}`,
              bgcolor: on ? accent[50] : 'transparent', pl: '10px', pr: '2px', minHeight: 28,
            }}
          >
            <ButtonBase onClick={() => onPick(seed)} aria-pressed={on} sx={{ fontSize: 13, color: on ? accent[700] : neutral[800] }}>
              {seed}
            </ButtonBase>
            <ButtonBase onClick={() => onRemove(seed)} aria-label={t('translate.remove', { seed })} sx={{ ml: '2px', p: '4px', borderRadius: `${radius.full}px`, color: neutral[500] }}>
              <icons.close size={14} aria-hidden />
            </ButtonBase>
          </Box>
        );
      })}
      <Typography variant="caption" component="span" sx={{ color: neutral[500] }}>{t('translate.from', { text: from })}</Typography>
    </Box>
  );
}

export default SeedChips;
