// DS §3.2 PageHeader: one 56px title row (title + count pill · ≤2 secondaries · ⋯ · 1 primary), a
// one-line subtitle and `meta` (freshness / pull / sync progress, usually <SyncMeta/>).
// Mobile (< 900): the title row moves to the shell TopBar when `Page shellManaged` (M2). Until then a
// compact title row is kept; secondaries + overflow collapse into one ⋯ and the primary goes to the
// StickyActionBar (state-driven) or into ⋯ (creation), per `mobilePrimary`.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useFormatter, useTranslations } from 'next-intl';
import { neutral, radius } from '@/lib/ds/tokens';
import { ActionButton } from './ActionButton';
import { ActionMenu } from './ActionMenu';
import { actionsKey, withLiveHandler } from './actionSignature';
import { dsIcons, ICON_SIZE, ICON_STROKE } from './icons';
import { usePageContext } from './PageContext';
import { StickyActionBar } from './StickyActionBar';
import type { ActionSpec, DsBaseProps } from './types';
import { useIsMobile } from './useViewport';

export type PageHeaderProps = DsBaseProps & {
  title: string;
  /** Count pill next to the title (e.g. total in view). */
  count?: number;
  /** One line, optional. */
  subtitle?: React.ReactNode;
  /** Freshness, pull and sync progress (e.g. <SyncMeta/>). Never a permanent banner (P6). */
  meta?: React.ReactNode;
  /** Inline after the title (e.g. the editor's StatusPills). */
  titleAdornment?: React.ReactNode;
  /** Control placed before the secondaries (e.g. research's marketplace FilterButton, editor ‹ ›). */
  actionsSlot?: React.ReactNode;
  primaryAction?: ActionSpec;
  /** At most 2 render; extras move to the front of the overflow (P1). */
  secondaryActions?: ActionSpec[];
  overflowActions?: ActionSpec[];
  /** Desktop "← {backLabel}" link above the title. Falls back to `Page backHref`. */
  backHref?: string;
  backLabel?: string;
  /** Mobile placement of the primary when the shell does not own it. Default 'sticky'. */
  mobilePrimary?: 'sticky' | 'menu' | 'none';
};

export const MAX_SECONDARY = 2;

/** P1: ≤ 2 visible secondaries; the rest are prepended to the overflow. */
export function splitHeaderActions(secondary: ActionSpec[] = [], overflow: ActionSpec[] = []) {
  return { visible: secondary.slice(0, MAX_SECONDARY), overflow: [...secondary.slice(MAX_SECONDARY), ...overflow] };
}

export function PageHeader({
  title,
  count,
  subtitle,
  meta,
  titleAdornment,
  actionsSlot,
  primaryAction,
  secondaryActions,
  overflowActions,
  backHref,
  backLabel,
  mobilePrimary = 'sticky',
  className,
  ...rest
}: PageHeaderProps) {
  const t = useTranslations('ds.page');
  const format = useFormatter();
  const page = usePageContext();
  const mobile = useIsMobile();
  const { visible, overflow } = splitHeaderActions(secondaryActions, overflowActions);
  const effectiveBack = backHref ?? page?.backHref;

  // Report actions upward (Page → shell / ⌘K). Keyed on every displayed field (not identity) so a new
  // array on every parent render does not loop; the reported specs call the latest handler via a ref,
  // so a new onClick closure (e.g. Export capturing current filters) is never stale.
  const report = page?.reportHeaderActions;
  const all = [primaryAction, ...(secondaryActions ?? []), ...(overflowActions ?? [])];
  const actionKey = `${mobilePrimary}:${actionsKey(all)}`;
  const latest = React.useRef({ primaryAction, visible, overflow, byId: new Map<string, ActionSpec>() });
  latest.current = {
    primaryAction,
    visible,
    overflow,
    byId: new Map(all.filter((a): a is ActionSpec => Boolean(a)).map((a) => [a.id, a])),
  };
  React.useEffect(() => {
    if (!report) return;
    const l = latest.current;
    const live = (a: ActionSpec) => withLiveHandler(a, (id) => latest.current.byId.get(id));
    report({
      primary: l.primaryAction ? live(l.primaryAction) : undefined,
      secondary: l.visible.map(live),
      overflow: l.overflow.map(live),
      mobilePrimary,
    });
    return () => report(null);
  }, [report, actionKey, mobilePrimary]);

  const testId = rest['data-testid'] ?? 'page-header';
  const BackIcon = dsIcons.back;

  const countPill =
    typeof count === 'number' ? (
      <Box
        component="span"
        data-testid="page-header-count"
        className="tnum"
        sx={{
          ml: '8px',
          px: '8px',
          height: 20,
          display: 'inline-flex',
          alignItems: 'center',
          borderRadius: `${radius.full}px`,
          bgcolor: neutral[100],
          color: neutral[600],
          fontSize: 12,
          fontWeight: 500,
          flexShrink: 0,
        }}
      >
        {format.number(count)}
      </Box>
    ) : null;

  const subtitleRow =
    subtitle || meta ? (
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: '8px', rowGap: '2px', minHeight: 20 }}>
        {subtitle ? (
          <Typography variant="caption" component="p" noWrap sx={{ m: 0, maxWidth: '100%' }} data-testid="page-header-subtitle">
            {subtitle}
          </Typography>
        ) : null}
        {subtitle && meta ? (
          <Typography variant="caption" component="span" aria-hidden>
            {'·'}
          </Typography>
        ) : null}
        {meta ? (
          <Box component="div" sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }} data-testid="page-header-meta">
            {meta}
          </Box>
        ) : null}
      </Box>
    ) : null;

  if (mobile) {
    const menuItems = [
      ...(mobilePrimary === 'menu' && primaryAction ? [primaryAction] : []),
      ...visible,
      ...overflow,
    ];
    const shellOwnsTitle = Boolean(page?.shellManaged);
    return (
      <Box component="header" className={className} data-testid={testId} data-layout="mobile" sx={{ mb: '12px' }}>
        {shellOwnsTitle ? null : (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', minHeight: 44 }}>
            <Typography variant="titleMd" component="h1" noWrap sx={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center' }}>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {title}
              </Box>
              {countPill}
            </Typography>
            {actionsSlot}
            <ActionMenu items={menuItems} size="md" />
          </Box>
        )}
        {titleAdornment ? <Box sx={{ display: 'flex', gap: '6px', flexWrap: 'wrap', mb: '4px' }}>{titleAdornment}</Box> : null}
        {subtitleRow}
        {primaryAction && mobilePrimary === 'sticky' ? <StickyActionBar primary={primaryAction} /> : null}
      </Box>
    );
  }

  return (
    <Box component="header" className={className} data-testid={testId} data-layout="desktop" sx={{ mb: '16px' }}>
      {effectiveBack ? (
        <Link
          component={NextLink}
          href={effectiveBack}
          underline="hover"
          data-testid="page-header-back"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: 13, color: neutral[600], mb: '2px' }}
        >
          <BackIcon size={ICON_SIZE} strokeWidth={ICON_STROKE} aria-hidden />
          {backLabel ?? t('back')}
        </Link>
      ) : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', height: 56 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          <Typography variant="titleLg" component="h1" noWrap sx={{ minWidth: 0 }}>
            {title}
          </Typography>
          {countPill}
          {titleAdornment}
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {actionsSlot}
          {visible.map((a) => (
            <ActionButton key={a.id} action={a} variant="secondary" size="sm" />
          ))}
          <ActionMenu items={overflow} />
          {primaryAction ? <ActionButton action={primaryAction} variant="primary" size="sm" /> : null}
        </Box>
      </Box>
      {subtitleRow}
    </Box>
  );
}
