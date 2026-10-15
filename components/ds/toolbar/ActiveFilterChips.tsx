// DS §4.3 ActiveFilterChips: removable chips + "Clear all" (there is no separate "Reset" button).
// CRITIQUE X4: the result count may be passed as `trailing` so it sits at the right end of this row.
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import { useTranslations } from 'next-intl';
import { accent, neutral } from '@/lib/ds/tokens';
import { dsIcons, ICON_STROKE } from '../page/icons';
import { coarseHitArea } from '../page/touch';
import type { DsBaseProps } from '../page/types';

export type FilterChip = { key: string; label: string; onRemove: () => void };

export type ActiveFilterChipsProps = DsBaseProps & {
  chips: FilterChip[];
  onClearAll: () => void;
  /** Right-aligned content (e.g. the result count). The row renders when chips or trailing exist. */
  trailing?: React.ReactNode;
};

export function ActiveFilterChips({ chips, onClearAll, trailing, className, ...rest }: ActiveFilterChipsProps) {
  const t = useTranslations('ds.toolbar');
  if (!chips.length && !trailing) return null;
  const RemoveIcon = dsIcons.clear;
  return (
    <Box
      className={className}
      data-testid={rest['data-testid'] ?? 'active-filter-chips'}
      sx={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', minHeight: 28, mt: '8px' }}
    >
      {chips.map((c) => (
        <Chip
          key={c.key}
          size="small"
          label={c.label}
          onDelete={c.onRemove}
          data-testid={`filter-chip-${c.key}`}
          deleteIcon={
            <Box component="span" role="button" aria-label={t('removeFilter', { label: c.label })} data-testid={`filter-chip-remove-${c.key}`} sx={{ display: 'inline-flex', ...coarseHitArea }}>
              <RemoveIcon size={12} strokeWidth={ICON_STROKE} aria-hidden />
            </Box>
          }
          sx={{ bgcolor: neutral[100], color: neutral[800], fontSize: 12, maxWidth: 280 }}
        />
      ))}
      {chips.length ? (
        <ButtonBase
          onClick={onClearAll}
          data-testid="filter-chips-clear-all"
          sx={{ fontSize: 12, fontWeight: 500, color: accent[600], px: '4px', borderRadius: '4px', '@media (pointer: coarse)': { minHeight: 44 } }}
        >
          {t('clearAll')}
        </ButtonBase>
      ) : null}
      {trailing ? <Box sx={{ ml: 'auto', display: 'inline-flex', alignItems: 'center' }}>{trailing}</Box> : null}
    </Box>
  );
}
