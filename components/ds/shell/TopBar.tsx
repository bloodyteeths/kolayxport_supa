// components/ds/shell/TopBar.tsx — the desktop TopBar, ≥ 900 px (shell-nav §3.3; DS §3.1).
//
// 52 px, neutral-0, 1 px bottom border, 24 px side padding, z topBar 1100. A `1fr auto 1fr` grid keeps the
// search centred whatever the breadcrumb length: breadcrumbs | SearchTrigger | live sound · bell · avatar.
// It never shows the page title (PageHeader owns it) and never adds "- KolayXport".
// `<LiveSoundToggle/>` (backend, components/live, import only) sits next to the notifications bell inside
// `SoundToggleHost` (./SoundToggleHost, shared with the mobile chrome), which restyles it like the DS
// `IconButton` (32 px, radius sm, neutral icons) and keeps a DS warning-tone icon for "needs a click".
import * as React from 'react';
import Box from '@mui/material/Box';
import LiveSoundToggle from '@/components/live/LiveSoundToggle';
import { layout, neutral as n, px, zIndex } from '@/lib/ds/tokens';
import type { NavCrumb } from '@/lib/nav/useNavModel';
import { AccountMenu, type AccountUser } from './AccountMenu';
import { Breadcrumbs } from './Breadcrumbs';
import { NotificationsButton } from './NotificationsButton';
import { SearchTrigger } from './SearchTrigger';
import { SoundToggleHost } from './SoundToggleHost';

export { SoundToggleHost } from './SoundToggleHost';

export type TopBarProps = {
  /** `mergeBreadcrumbs(model.breadcrumbs, usePageMeta()?.breadcrumbs)`. */
  breadcrumbs: NavCrumb[];
  /** Session user (null while loading: avatar skeleton, no bell, no sound toggle). */
  user: AccountUser | null;
  /** Signed in: enables polling, the bell and the live sound toggle. */
  signedIn: boolean;
  shopifyFree?: boolean;
  paletteOpen?: boolean;
  onOpenPalette: () => void;
  onShowShortcuts: () => void;
  onSignOut: () => void | Promise<void>;
};

export function TopBar({ breadcrumbs, user, signedIn, shopifyFree, paletteOpen, onOpenPalette, onShowShortcuts, onSignOut }: TopBarProps) {
  return (
    <Box
      component="header"
      data-testid="topbar"
      sx={{
        position: 'relative',
        zIndex: zIndex.topBar,
        flexShrink: 0,
        height: px(layout.topBar),
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
        alignItems: 'center',
        columnGap: px(16),
        px: px(layout.gutter),
        bgcolor: n[0],
        borderBottom: `1px solid ${n[200]}`,
      }}
    >
      <Breadcrumbs items={breadcrumbs} />
      <Box sx={{ display: 'flex', justifyContent: 'center', minWidth: 0 }}>
        <SearchTrigger onOpen={onOpenPalette} expanded={paletteOpen} />
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: px(4), minWidth: 0 }}>
        {signedIn ? (
          <SoundToggleHost data-testid="topbar-sound-host">
            <LiveSoundToggle size="small" />
          </SoundToggleHost>
        ) : null}
        {signedIn ? <NotificationsButton enabled mobile={false} size="sm" /> : null}
        <AccountMenu user={user} shopifyFree={shopifyFree} onShowShortcuts={onShowShortcuts} onSignOut={onSignOut} />
      </Box>
    </Box>
  );
}

export default TopBar;
