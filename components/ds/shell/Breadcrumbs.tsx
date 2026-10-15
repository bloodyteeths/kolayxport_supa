// components/ds/shell/Breadcrumbs.tsx — desktop TopBar trail (shell-nav §2.3, §3.3).
//
// `caption` 13/500 neutral-500, the last item neutral-900 (`aria-current="page"`), ChevronRight 14 between
// items. At most 3 items are visible: with more, the first stays, the middle collapses to "…" and the
// last two stay. A brand crumb shows its `LogoTile` 16. A crumb with `menu` options opens a menu (the
// shop switcher, supplied by the page). A crumb with an empty label is page data still loading: a 120 px
// skeleton. Items truncate with an ellipsis before they can push the centred search.
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useTranslations } from 'next-intl';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Bone } from '@/components/ds/state/Skeletons';
import { ICON_STROKE, icons } from '@/lib/ds/icons';
import { elevation, focusRing, neutral as n, px, radius, zIndex } from '@/lib/ds/tokens';
import type { NavCrumb } from '@/lib/nav/useNavModel';

export type BreadcrumbsProps = {
  items: NavCrumb[];
  className?: string;
  'data-testid'?: string;
};

export const MAX_VISIBLE_CRUMBS = 3;

export type VisibleCrumb = { kind: 'crumb'; crumb: NavCrumb; index: number } | { kind: 'ellipsis' };

/** Pure: which crumbs render (first + "…" + last two when there are more than 3). */
export function visibleCrumbs(items: NavCrumb[], max = MAX_VISIBLE_CRUMBS): VisibleCrumb[] {
  const all = items.map((crumb, index) => ({ kind: 'crumb' as const, crumb, index }));
  if (items.length <= max) return all;
  return [all[0], { kind: 'ellipsis' }, ...all.slice(items.length - (max - 1))];
}

const textSx = {
  fontSize: 13,
  lineHeight: '18px',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
} as const;

export function Breadcrumbs({ items, className, 'data-testid': testId = 'breadcrumbs' }: BreadcrumbsProps) {
  const t = useTranslations('shell');
  if (!items.length) return <Box className={className} data-testid={testId} sx={{ minWidth: 0 }} />;
  const visible = visibleCrumbs(items);
  const Sep = icons.next;
  return (
    <Box component="nav" aria-label={t('breadcrumbs')} className={className} data-testid={testId} sx={{ minWidth: 0, overflow: 'hidden' }}>
      <Box component="ol" sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', alignItems: 'center', gap: px(4), minWidth: 0 }}>
        {visible.map((v, i) => (
          <Box
            component="li"
            key={v.kind === 'crumb' ? `c${v.index}` : 'ellipsis'}
            sx={{ display: 'flex', alignItems: 'center', gap: px(4), minWidth: 0, flexShrink: i === visible.length - 1 ? 1 : 2 }}
          >
            {i > 0 ? <Sep size={14} strokeWidth={ICON_STROKE} aria-hidden color={n[400]} style={{ flexShrink: 0 }} /> : null}
            {v.kind === 'ellipsis' ? (
              <Box component="span" aria-hidden sx={{ ...textSx, color: n[500] }}>
                …
              </Box>
            ) : (
              <CrumbItem crumb={v.crumb} last={v.index === items.length - 1} />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function CrumbItem({ crumb, last }: { crumb: NavCrumb; last: boolean }) {
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const color = last ? n[900] : n[500];
  if (!crumb.label) return <Bone w={120} h={14} />;

  const content = (
    <>
      {/* Decorative: the label follows as text, so the tile must not announce the name a second time. */}
      {crumb.brand ? (
        <Box component="span" aria-hidden sx={{ display: 'inline-flex', flexShrink: 0 }}>
          <LogoTile brand={crumb.brand} size={16} label={crumb.label} />
        </Box>
      ) : null}
      <Box component="span" sx={{ ...textSx, color }}>
        {crumb.label}
      </Box>
    </>
  );

  if (crumb.menu && crumb.menu.length) {
    const Chevron = icons.disclosure;
    return (
      <>
        <ButtonBase
          onClick={(e) => setAnchor(e.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={Boolean(anchor)}
          aria-current={last ? 'page' : undefined}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: px(4), minWidth: 0, borderRadius: px(radius.xs), px: px(2), '&.Mui-focusVisible': { boxShadow: focusRing } }}
        >
          {content}
          <Chevron size={14} strokeWidth={ICON_STROKE} aria-hidden color={n[500]} style={{ flexShrink: 0 }} />
        </ButtonBase>
        <Menu
          anchorEl={anchor}
          open={Boolean(anchor)}
          onClose={() => setAnchor(null)}
          sx={{ zIndex: zIndex.popover }}
          slotProps={{ paper: { sx: { borderRadius: px(radius.md), boxShadow: elevation.e2, minWidth: 200 } } }}
        >
          {crumb.menu.map((opt) => (
            <MenuItem key={opt.href} component={NextLink} href={opt.href} onClick={() => setAnchor(null)} sx={{ fontSize: 13 }}>
              {opt.label}
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  }

  if (last || !crumb.href) {
    return (
      <Box component="span" aria-current={last ? 'page' : undefined} sx={{ display: 'inline-flex', alignItems: 'center', gap: px(6), minWidth: 0 }}>
        {content}
      </Box>
    );
  }
  return (
    <Box
      component={NextLink}
      href={crumb.href}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: px(6),
        minWidth: 0,
        textDecoration: 'none',
        borderRadius: px(radius.xs),
        '&:hover span': { color: n[800] },
        '&:focus-visible': { outline: 'none', boxShadow: focusRing },
      }}
    >
      {content}
    </Box>
  );
}

export default Breadcrumbs;
