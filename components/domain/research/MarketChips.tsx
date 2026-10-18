// components/domain/research/MarketChips.tsx — the marketplace picker of every Research tool, always on screen
// (phone and desktop). Replaces the corner FilterButton / mobile ⋯ items, which hid the choice on phones.
// Big tappable chips (logo + name, 40px), wrapping instead of scrolling; a disabled marketplace stays visible and
// tapping it shows its reason (e.g. Amazon eligibility) in an inline note under the row.
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { accent, neutral, radius, focusRing } from '@/lib/ds/tokens';
import type { FilterOption } from '@/components/ds/toolbar/types';
import { isResearchMkt, type ResearchMkt } from '@/lib/research/types';

export type MarketChipsProps = {
  value: ResearchMkt;
  options: FilterOption[];
  onChange: (mkt: ResearchMkt) => void;
};

export function MarketChips({ value, options, onChange }: MarketChipsProps) {
  const t = useTranslations('research');
  const [note, setNote] = React.useState<string | null>(null);
  return (
    <Box sx={{ mb: '12px' }}>
      <Box
        role="radiogroup"
        aria-label={t('mkt.label')}
        sx={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}
        data-testid="research-mkt"
      >
        {options.map((o) => {
          const v = String(o.value);
          const selected = v === value;
          const disabled = Boolean(o.disabledReason);
          return (
            <ButtonBase
              key={v}
              role="radio"
              aria-checked={selected}
              aria-disabled={disabled || undefined}
              onClick={() => {
                if (disabled) {
                  setNote(o.disabledReason ?? null);
                  return;
                }
                setNote(null);
                if (isResearchMkt(v)) onChange(v);
              }}
              data-testid={`research-mkt-${v}`}
              sx={{
                height: 40,
                px: '14px',
                gap: '8px',
                borderRadius: `${radius.full}px`,
                border: `1px solid ${selected ? accent[600] : neutral[200]}`,
                bgcolor: selected ? accent[50] : neutral[0],
                color: disabled ? neutral[400] : selected ? accent[700] : neutral[800],
                fontSize: 14,
                fontWeight: selected ? 600 : 500,
                opacity: disabled ? 0.7 : 1,
                '&:focus-visible': { boxShadow: focusRing },
              }}
            >
              {o.leading}
              <span>{o.label}</span>
            </ButtonBase>
          );
        })}
      </Box>
      {note ? (
        <Typography variant="caption" component="p" sx={{ mt: '6px', color: neutral[600] }} data-testid="research-mkt-note">
          {note}
        </Typography>
      ) : null}
    </Box>
  );
}

export function marketChipLeading(mkt: ResearchMkt) {
  return <LogoTile brand={mkt} size={20} />;
}

export default MarketChips;
