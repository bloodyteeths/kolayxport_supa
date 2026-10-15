// components/ds/shell/SideNav.tsx — the desktop sidebar (shell-nav §3.1, §3.2, §7; DS §3.1).
//
// One element covers three states:
//   wide + expanded   240 px in the flow (pushes the content), labels, group labels, plan card.
//   wide + collapsed  64 px rail in the flow; width animates 240 ↔ 64 over motion.base (CSS only).
//   narrow (900–1199) 64 px rail in the flow; "expand" opens the 240 px panel as an OVERLAY above the
//                     content (z sidebar 1150, e3, no backdrop). It closes on Esc (AppShell), outside
//                     click and navigation. It never pushes the content.
// The outer box reserves the in-flow width; the inner <nav> is absolutely positioned and may be wider.
// Below 900 the sidebar is not rendered at all (AppShell).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ClickAwayListener from '@mui/material/ClickAwayListener';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Bone, useDelayedVisible, SKELETON_DELAY_MS } from '@/components/ds/state/Skeletons';
import { elevation, focusRing, layout, neutral as n, px, radius, zIndex } from '@/lib/ds/tokens';
import { HOME_HREF } from '@/lib/nav/navConfig';
import type { NavGroup, NavModel } from '@/lib/nav/useNavModel';
import type { ShellViewport } from '@/lib/nav/useShellStore';
import { SideNavItem } from './SideNavItem';
import { SideNavFooter, type ShellUsage } from './SideNavFooter';

/** Product name (proper noun, not translated). */
export const BRAND_NAME = 'KolayXport';
const noop = () => {};
/** The flat `KX` app icon (shell-nav §1). */
export const BRAND_ICON_SRC = '/icon-192x192.png';

export type SideNavProps = {
  /** null while the session / model is loading: brand row + 8 skeleton rows. */
  model: Pick<NavModel, 'topGroups' | 'bottomGroups'> | null;
  viewport: Exclude<ShellViewport, 'mobile'>;
  /** In-flow mode (`resolveSidebarMode`). */
  mode: 'rail' | 'expanded';
  /** 900–1199: the overlay panel is open. */
  overlayOpen?: boolean;
  /** Apply the width without the transition (first paint after hydration). */
  instant?: boolean;
  /** `undefined` loading, `null` hidden. */
  usage?: ShellUsage | null;
  /** `[` / footer button (AppShell passes `toggleSidebar(viewport)`). */
  onToggle: () => void;
  /** Close the overlay (outside click, navigation). */
  onCloseOverlay?: () => void;
};

export function SideNav({ model, viewport, mode, overlayOpen = false, instant = false, usage, onToggle, onCloseOverlay }: SideNavProps) {
  const t = useTranslations('shell');
  const overlay = viewport === 'narrow' && overlayOpen;
  const expanded = mode === 'expanded' || overlay;
  const rail = !expanded;
  const inflowWidth = mode === 'expanded' ? layout.sidebar : layout.sidebarRail;
  const navWidth = expanded ? layout.sidebar : layout.sidebarRail;
  const transition = instant ? 'none' : 'width var(--kx-dur-base) cubic-bezier(.2,0,0,1)';
  const onNavigate = overlay ? onCloseOverlay : undefined;
  const overlayActive = overlay && Boolean(onCloseOverlay);

  const nav = (
    <Box
      component="nav"
      aria-label={t('mainNav')}
      data-testid="sidenav"
      data-mode={overlay ? 'overlay' : mode}
      sx={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: px(navWidth),
        transition,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: n[50],
        borderRight: `1px solid ${n[200]}`,
        overflow: 'hidden',
        zIndex: overlay ? zIndex.sidebar : 'auto',
        boxShadow: overlay ? elevation.e3 : 'none',
      }}
    >
      <BrandRow rail={rail} onNavigate={onNavigate} />
      {model ? (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            pb: px(8),
          }}
        >
          {model.topGroups.map((g, i) => (
            <NavGroupList key={g.id} group={g} rail={rail} first={i === 0} onNavigate={onNavigate} />
          ))}
          {model.bottomGroups.length ? (
            <Box sx={{ mt: 'auto', pt: px(16) }}>
              <Box
                aria-hidden
                sx={{ borderTop: `1px solid ${n[200]}`, mx: rail ? 'auto' : px(8), width: rail ? 24 : 'auto', mb: px(8) }}
              />
              {model.bottomGroups.map((g) => (
                <NavGroupList key={g.id} group={g} rail={rail} first onNavigate={onNavigate} />
              ))}
            </Box>
          ) : null}
        </Box>
      ) : (
        <NavSkeleton rail={rail} />
      )}
      <SideNavFooter
        expanded={expanded}
        usage={model ? usage : undefined}
        onToggle={onToggle}
        toggleAction={expanded ? 'collapse' : 'expand'}
      />
    </Box>
  );

  return (
    <Box
      data-testid="sidenav-slot"
      sx={{ position: 'relative', flexShrink: 0, width: px(inflowWidth), height: '100%', transition }}
    >
      {/* Always mounted (inert while the overlay is closed) so opening / closing it keeps the <nav> tree:
          focus stays on the toggle, the scroll position survives and the width transition plays. */}
      <ClickAwayListener
        onClickAway={overlayActive && onCloseOverlay ? onCloseOverlay : noop}
        mouseEvent={overlayActive ? 'onClick' : false}
        touchEvent={overlayActive ? 'onTouchEnd' : false}
      >
        {nav}
      </ClickAwayListener>
    </Box>
  );
}

function BrandRow({ rail, onNavigate }: { rail: boolean; onNavigate?: () => void }) {
  return (
    <Box
      sx={{
        height: px(layout.topBar),
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        px: rail ? 0 : px(16),
        justifyContent: rail ? 'center' : 'flex-start',
      }}
    >
      <Box
        component={NextLink}
        href={HOME_HREF}
        onClick={onNavigate}
        aria-label={BRAND_NAME}
        data-testid="sidenav-brand"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: px(8),
          textDecoration: 'none',
          borderRadius: px(radius.sm),
          '&:focus-visible': { outline: 'none', boxShadow: focusRing },
        }}
      >
        <Box
          component="img"
          src={BRAND_ICON_SRC}
          alt=""
          aria-hidden
          sx={{ width: 24, height: 24, borderRadius: px(radius.sm), display: 'block', flexShrink: 0 }}
        />
        {rail ? null : (
          <Typography component="span" variant="titleSm" sx={{ color: n[900], whiteSpace: 'nowrap' }}>
            {BRAND_NAME}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function NavGroupList({ group, rail, first, onNavigate }: { group: NavGroup; rail: boolean; first: boolean; onNavigate?: () => void }) {
  const labelId = `kx-nav-group-${group.id}`;
  const showLabel = !rail && Boolean(group.label);
  return (
    <Box data-testid={`nav-group-${group.id}`} sx={{ mt: first ? 0 : rail ? px(8) : showLabel ? px(24) : px(16) }}>
      {rail && !first ? (
        <Box aria-hidden sx={{ width: 24, mx: 'auto', borderTop: `1px solid ${n[200]}`, mb: px(8) }} />
      ) : null}
      {showLabel ? (
        <Typography
          id={labelId}
          component="div"
          variant="caption"
          sx={{ display: 'block', color: n[500], fontWeight: 500, px: px(16), mb: px(4), whiteSpace: 'nowrap' }}
        >
          {group.label}
        </Typography>
      ) : null}
      <Box
        component="ul"
        aria-labelledby={showLabel ? labelId : undefined}
        aria-label={!showLabel && group.label ? group.label : undefined}
        sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: rail ? px(4) : px(2) }}
      >
        {group.items.map((item) => (
          <SideNavItem key={item.id} item={item} rail={rail} onNavigate={onNavigate} />
        ))}
      </Box>
    </Box>
  );
}

function NavSkeleton({ rail }: { rail: boolean }) {
  const visible = useDelayedVisible(SKELETON_DELAY_MS);
  return (
    <Box data-testid="sidenav-skeleton" aria-hidden sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: px(4), px: rail ? 0 : px(8), alignItems: rail ? 'center' : 'stretch' }}>
      {visible ? Array.from({ length: 8 }, (_, i) => <Bone key={i} w={rail ? 40 : '100%'} h={32} r={radius.sm} />) : null}
    </Box>
  );
}

export default SideNav;
