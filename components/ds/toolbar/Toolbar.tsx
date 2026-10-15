// DS §3.3 / §4.3 Toolbar (sticky under the TopBar):
// [⌕ Search /] [Filter ▾]×≤3 [Filters • n]   View: [To ship ▾] [density]   142 results
// chips · Clear all
// With a selection the row is replaced in place by BulkActionBar (desktop) or the StickyActionBar
// (mobile). Data refresh is never a toolbar button (it is SyncMeta in the PageHeader meta).
import * as React from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useTranslations } from 'next-intl';
import { accent, neutral, zIndex } from '@/lib/ds/tokens';
import { dsIcons, ICON_SIZE, ICON_STROKE } from '../page/icons';
import { coarseSize } from '../page/touch';
import type { DsBaseProps } from '../page/types';
import { useIsMobile } from '../page/useViewport';
import { BulkActionBar, type BulkActionBarProps } from './BulkActionBar';
import { FilterBar, type FilterBarProps } from './FilterBar';
import { SavedViews, type SavedViewsProps } from './SavedViews';

export type Density = 'standard' | 'compact';

export type ToolbarProps = Omit<FilterBarProps, 'trailing' | 'mobileSecondRow'> & {
  views?: SavedViewsProps;
  density?: { value: Density; onChange: (d: Density) => void };
  /** With `count > 0` the BulkActionBar replaces the row. */
  selection?: BulkActionBarProps;
  /** Extra controls at the end of the row (before density), e.g. finance's currency Select. */
  trailing?: React.ReactNode;
  /** Default true. */
  sticky?: boolean;
  /** CSS `top` for the sticky row; default `var(--kx-toolbar-top, 0px)`. */
  stickyTop?: string | number;
} & DsBaseProps;

export function Toolbar({
  views,
  density,
  selection,
  trailing,
  sticky = true,
  stickyTop = 'var(--kx-toolbar-top, 0px)',
  className,
  ...filterBar
}: ToolbarProps) {
  const t = useTranslations('ds.toolbar');
  const isMobile = useIsMobile();
  const testId = filterBar['data-testid'] ?? 'toolbar';
  const selecting = Boolean(selection && selection.count > 0);
  const DensityIcon = dsIcons.density;

  const densityToggle =
    density && !isMobile ? (
      <Tooltip title={t('compactRows')} PopperProps={{ sx: { zIndex: zIndex.tooltip } }}>
        <IconButton
          size="small"
          aria-label={t('compactRows')}
          aria-pressed={density.value === 'compact'}
          onClick={() => density.onChange(density.value === 'compact' ? 'standard' : 'compact')}
          data-testid="toolbar-density"
          sx={{
            border: `1px solid ${neutral[300]}`,
            ...coarseSize,
            ...(density.value === 'compact' ? { bgcolor: accent[50], color: accent[700], borderColor: accent[200] } : {}),
          }}
        >
          <DensityIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
        </IconButton>
      </Tooltip>
    ) : null;

  const savedViews = views ? <SavedViews {...views} /> : null;

  return (
    <Box
      role="search"
      className={className}
      data-testid={testId}
      data-selecting={selecting || undefined}
      sx={{
        ...(sticky ? { position: 'sticky', top: stickyTop, zIndex: zIndex.stickyToolbar } : {}),
        bgcolor: neutral[50],
        py: '8px',
        mb: '8px',
      }}
    >
      {selecting && !isMobile ? (
        <BulkActionBar {...selection!} variant="bar" />
      ) : (
        <FilterBar
          {...filterBar}
          data-testid={`${testId}-filters`}
          trailing={
            savedViews || densityToggle || trailing ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {trailing}
                {isMobile ? null : savedViews}
                {densityToggle}
              </Box>
            ) : undefined
          }
          mobileSecondRow={isMobile ? savedViews : undefined}
        />
      )}
      {selecting && isMobile ? <BulkActionBar {...selection!} variant="sticky" /> : null}
    </Box>
  );
}
