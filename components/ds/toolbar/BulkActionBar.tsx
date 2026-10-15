// DS §3.3 / §4.3 BulkActionBar: with a selection it replaces the Toolbar row in place, same height:
// "12 selected · [Primary] [action] [action] ⋯ · Select all 248 in this view · Clear (Esc)".
// While it is shown its primary is the view primary (P1); the page demotes its header primary.
// Mobile: rendered as the StickyActionBar ("5 selected · [secondary] [Primary]", 50/50 at 48px).
// Slots carry split/menu buttons (orders: "[Create 4 labels] [Print ▾] [Export ▾] ⋯" on desktop,
// "5 selected · [Print ▾] [Create 4 labels]" on mobile). While count > 0 the bar never disappears:
// at minimum it shows the count, ⋯ and Clear.
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { useShortcuts } from '@/lib/ds/useShortcuts';
import { accent, neutral, radius, zIndex } from '@/lib/ds/tokens';
import { ActionButton } from '../page/ActionButton';
import { ActionMenu } from '../page/ActionMenu';
import { StickyActionBar } from '../page/StickyActionBar';
import type { ActionSpec, DsBaseProps } from '../page/types';
import { useIsMobile } from '../page/useViewport';

export type BulkSelectAll = {
  /** Total rows matching the current view (server count). */
  total: number;
  /** True when "all in this view" is selected (not only the visible ids). */
  active: boolean;
  onChange: (active: boolean) => void;
  /** Surface wording, e.g. listings "Select all 248 listings in this view". Default DS wording. */
  label?: string;
};

export type BulkActionBarProps = DsBaseProps & {
  count: number;
  primary?: ActionSpec;
  /**
   * Replaces `primary` with custom content, e.g. M1-b's <SplitButton> ("Print ▾") when no selected row
   * can be labelled. Rendered in both the desktop bar and the mobile sticky bar (pass `size="xl"` on mobile).
   */
  primarySlot?: React.ReactNode;
  /**
   * Split/menu secondaries (e.g. "Print ▾" "Export ▾") rendered right after the primary on desktop.
   * On mobile it is the one visible secondary (50/50 with the primary); ActionSpec `actions` then go to ⋯.
   */
  secondarySlot?: React.ReactNode;
  actions?: ActionSpec[];
  overflow?: ActionSpec[];
  onClear: () => void;
  /** listings-grid §6.3 "Select all {count} in this view". */
  selectAll?: BulkSelectAll;
  /** Force a layout; default follows the viewport. */
  variant?: 'auto' | 'bar' | 'sticky';
  /** Bind Esc to onClear (default true). */
  escToClear?: boolean;
};

export function BulkActionBar({
  count,
  primary,
  primarySlot,
  secondarySlot,
  actions = [],
  overflow = [],
  onClear,
  selectAll,
  variant = 'auto',
  escToClear = true,
  className,
  ...rest
}: BulkActionBarProps) {
  const t = useTranslations('ds.bulk');
  const isMobile = useIsMobile();
  const sticky = variant === 'sticky' || (variant === 'auto' && isMobile);
  const shownCount = selectAll?.active ? selectAll.total : count;

  useShortcuts({ Escape: { handler: () => onClear(), description: t('clear') } }, { scope: 'page', enabled: escToClear && count > 0 });

  if (count <= 0) return null;
  const selectedText = t('selected', { count: shownCount });
  const testId = rest['data-testid'] ?? 'bulk-action-bar';
  const clearAction: ActionSpec = { id: 'bulk-clear', label: t('clear'), onClick: onClear };

  if (sticky) {
    // Fill the two 50/50 cells in order: primary (ActionSpec or slot), secondary (slot or first action).
    // With no primary of any kind the first available secondary carries the primary cell (P1 allows none).
    let rest = actions;
    // The slot wins over `primary` (same as the desktop bar).
    let primaryAction: ActionSpec | undefined = primarySlot ? undefined : primary;
    let pSlot: React.ReactNode = primarySlot;
    let secondaryAction: ActionSpec | undefined;
    let sSlot: React.ReactNode = secondarySlot;
    if (!primaryAction && !pSlot) {
      if (sSlot) {
        pSlot = sSlot;
        sSlot = undefined;
      } else if (rest.length) {
        primaryAction = rest[0];
        rest = rest.slice(1);
      }
    }
    if (!sSlot && rest.length) {
      secondaryAction = rest[0];
      rest = rest.slice(1);
    }
    return (
      <StickyActionBar
        data-testid={testId}
        className={className}
        status={selectedText}
        ariaLabel={selectedText}
        primary={primaryAction}
        primarySlot={pSlot}
        secondary={secondaryAction}
        secondarySlot={sSlot}
        overflow={[...rest, ...overflow, clearAction]}
        variant="mobile"
      />
    );
  }

  const canSelectAll = selectAll && selectAll.total > count;

  return (
    <Box
      role="toolbar"
      aria-label={selectedText}
      className={className}
      data-testid={testId}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minHeight: 40,
        px: '8px',
        bgcolor: accent[50],
        border: `1px solid ${accent[100]}`,
        borderRadius: `${radius.md}px`,
        zIndex: zIndex.stickyToolbar,
        minWidth: 0,
        flexWrap: 'wrap',
      }}
    >
      <Typography variant="label" component="span" className="tnum" sx={{ color: neutral[900], px: '4px', whiteSpace: 'nowrap' }} data-testid="bulk-count">
        {selectedText}
      </Typography>
      {primarySlot ?? (primary ? <ActionButton action={primary} variant="primary" size="sm" /> : null)}
      {secondarySlot}
      {actions.map((a) => (
        <ActionButton key={a.id} action={a} variant="secondary" size="sm" />
      ))}
      <ActionMenu items={overflow} />
      <Box sx={{ flex: 1 }} />
      {canSelectAll || selectAll?.active ? (
        <ButtonBase
          onClick={() => selectAll!.onChange(!selectAll!.active)}
          data-testid="bulk-select-all"
          sx={{ fontSize: 13, fontWeight: 500, color: accent[600], px: '4px', borderRadius: '4px', whiteSpace: 'nowrap' }}
        >
          {selectAll!.active ? t('selectOnlyPage', { count }) : (selectAll!.label ?? t('selectAllInView', { count: selectAll!.total }))}
        </ButtonBase>
      ) : null}
      <ButtonBase
        onClick={onClear}
        aria-keyshortcuts="Escape"
        data-testid="bulk-clear"
        sx={{ fontSize: 13, fontWeight: 500, color: neutral[700], px: '6px', height: 32, borderRadius: '4px', whiteSpace: 'nowrap', '&:hover': { bgcolor: accent[100] } }}
      >
        {t('clearWithKey')}
      </ButtonBase>
    </Box>
  );
}

/** Task alias: "BulkBar" = DS BulkActionBar. */
export const BulkBar = BulkActionBar;
export type BulkBarProps = BulkActionBarProps;
