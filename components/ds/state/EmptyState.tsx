import React from 'react';
import Box from '@mui/material/Box';
import { neutral as n, radius } from '@/lib/ds/tokens';
import { ActionButton, type ActionSpec } from '../overlay/actions';
import { ConnectIcon, LockedIcon, NoResultsIcon, SuccessIcon, type LucideIcon } from '../overlay/icons.internal';
import { LogoTile } from '../data/LogoTile';

export type EmptyStateKind = 'first-use' | 'no-results' | 'done' | 'locked';

export interface EmptyStateProps {
  /**
   * first-use: connect / create something (primary action, optional brand tile).
   * no-results: filters match nothing (secondary "Clear filters").
   * done: queue is empty, quiet check, no action.
   * locked: feature not in the plan (pro-gating §3): `LockKeyhole` tile (icon/brand ignored),
   *         one primary ("See plans") or none (neutral locked for shopify_free).
   */
  kind: EmptyStateKind;
  /**
   * A registry icon, or an already-rendered element (legacy shims; forced to 20px in the tile).
   * `null` renders no icon tile at all. Ignored for `locked`.
   */
  icon?: LucideIcon | React.ReactElement | null;
  brand?: string;
  title: string;
  /** ≤ 2 lines. */
  body?: React.ReactNode;
  action?: ActionSpec;
  /** An already-rendered action (legacy shims). Used only when `action` is not given. One action only. */
  actionNode?: React.ReactNode;
  /** Caption under the action, e.g. locked "Your trial included it until 29 Oct." */
  footnote?: React.ReactNode;
  /** Smaller padding for use inside a card / table body ("No sales in the last 7 days"). */
  compact?: boolean;
  /** Rendered below (e.g. `<FeaturePreview>` on a locked page). */
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

const DEFAULT_ICON: Record<EmptyStateKind, LucideIcon> = {
  'first-use': ConnectIcon, 'no-results': NoResultsIcon, done: SuccessIcon, locked: LockedIcon,
};

/** DS §3.13 EmptyState: 40px neutral-100 icon tile, 14/600 title, ≤ 2-line body, one action. */
export function EmptyState({ kind, icon, brand, title, body, action, actionNode, footnote, compact, children, className, ...rest }: EmptyStateProps) {
  const iconElement = kind !== 'locked' && React.isValidElement(icon) ? icon : null;
  const Icon: LucideIcon | null =
    kind === 'locked' ? LockedIcon : iconElement || icon === null ? null : (icon as LucideIcon | undefined) ?? DEFAULT_ICON[kind];
  const showBrand = !!brand && kind !== 'locked';
  const showTile = showBrand || !!Icon || !!iconElement;
  const actionVariant = kind === 'no-results' ? 'secondary' : 'primary';

  return (
    <Box
      className={className}
      data-testid={rest['data-testid'] ?? `empty-${kind}`}
      data-kind={kind}
      sx={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', width: '100%',
        pt: compact ? '24px' : '48px', pb: compact ? '24px' : '48px', px: '16px', boxSizing: 'border-box',
      }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', maxWidth: kind === 'locked' ? 560 : 480 }}>
      {showBrand ? (
        <LogoTile brand={brand!} size={40} data-testid={`brand-${brand}`} />
      ) : showTile ? (
        <Box
          aria-hidden
          sx={{
            width: 40, height: 40, borderRadius: `${radius.md}px`, bgcolor: n[100], color: n[500],
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            '& svg': { width: 20, height: 20, fontSize: 20 },
          }}
        >
          {iconElement ?? (Icon ? <Icon size={20} strokeWidth={1.75} /> : null)}
        </Box>
      ) : null}
      <Box component="h3" sx={{ m: 0, mt: showTile ? '12px' : 0, fontSize: 14, lineHeight: '20px', fontWeight: 600, color: n[900] }}>
        {title}
      </Box>
      {body && (
        <Box
          sx={{
            mt: '4px', fontSize: 13, lineHeight: '18px', color: n[500], maxWidth: 420,
            display: '-webkit-box', WebkitLineClamp: kind === 'locked' ? 3 : 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
          }}
        >
          {body}
        </Box>
      )}
      {action ? (
        <Box sx={{ mt: '16px' }}>
          <ActionButton action={action} variant={actionVariant} size={compact ? 'md' : 'lg'} />
        </Box>
      ) : actionNode ? (
        <Box sx={{ mt: '16px' }}>{actionNode}</Box>
      ) : null}
      {footnote && <Box sx={{ mt: '8px', fontSize: 12, lineHeight: '16px', color: n[500] }}>{footnote}</Box>}
      </Box>
      {children && <Box sx={{ mt: '32px', width: '100%', maxWidth: 880 }}>{children}</Box>}
    </Box>
  );
}

export default EmptyState;
