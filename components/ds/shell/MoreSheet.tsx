// components/ds/shell/MoreSheet.tsx — the mobile "More" sheet (shell-nav §4.2; DS §3.1 "Mobile").
//
// A `BottomSheet` titled "Menu" holding the same `navConfig` groups as the sidebar (same logos, same
// badges), minus the rows already in the tab bar, then the plan meter (slot, same content as the desktop
// SideNavFooter), the account row, the language switch and Sign out. Rows are 48px with ≥ 44px targets;
// a tap navigates and closes the sheet (the shell also closes it on route change).
//
// Differences from the sidebar, by spec: a listing row that needs reconnecting shows the words
// "Reconnect needed" instead of the dot (there is room on mobile); when the page's TopBar shows ⋯ instead
// of the bell (`notificationsFirst`), the Notifications row moves to the top with its unread count.
import * as React from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { BottomSheet } from '@/components/ds/overlay/BottomSheet';
import { LogoTile } from '@/components/ds/data/LogoTile';
import { Avatar } from '@/components/ds/data/Avatar';
import { SegmentedControl } from '@/components/ds/inputs/SegmentedControl';
import { icons } from '@/lib/ds/icons';
import { accent, neutral as n, tone, type as typeScale } from '@/lib/ds/tokens';
import { useAuth } from '@/lib/auth-context';
import useLocaleStore, { type AppLocale } from '@/lib/stores/useLocaleStore';
import LiveSoundToggle from '@/components/live/LiveSoundToggle';
import { useNotifications } from '@/lib/hooks/useNotifications';
import type { MobileTab, NavGroup, NavItem } from '@/lib/nav/useNavModel';
import { useShellStore } from '@/lib/nav/useShellStore';
import { clearNavConnCache } from './AccountMenu';
import type { AppShellContext } from './AppShell';
import { CountPill } from './MobileTabBar';
import { useMobileTopBarState } from './MobileTopBar';
import { notificationBadgeTone } from './NotificationsButton';

/** Endonyms: data, not message keys (shell-nav §10). */
export const LOCALE_ENDONYMS: Record<AppLocale, string> = { en: 'English', tr: 'Türkçe' };

/** Nav rows the tab bar already shows (never repeated in the sheet). Listing rows stay: the tab is a shortcut. */
export function tabItemIds(tabs: readonly MobileTab[]): Set<string> {
  const ids = new Set<string>();
  for (const tab of tabs) if (tab.id !== 'listings') ids.add(tab.id);
  return ids;
}

/**
 * Pure: the sheet's groups. Drops tab-bar rows and empty groups; with `notificationsFirst` the Notifications
 * row is lifted out into its own leading group.
 */
export function buildMoreSheetGroups(
  groups: readonly NavGroup[],
  tabs: readonly MobileTab[],
  opts: { notificationsFirst?: boolean } = {},
): NavGroup[] {
  const skip = tabItemIds(tabs);
  let lifted: NavItem | undefined;
  const out: NavGroup[] = [];
  for (const g of groups) {
    const items = g.items.filter((i) => {
      if (skip.has(i.id)) return false;
      if (opts.notificationsFirst && i.id === 'notifications') {
        lifted = i;
        return false;
      }
      return true;
    });
    if (items.length) out.push({ ...g, items });
  }
  if (lifted) out.unshift({ id: 'account', bottom: false, items: [lifted] });
  return out;
}

export type MoreSheetProps = {
  /** `useNavModel().groups`. */
  groups: NavGroup[];
  /** `useNavModel().tabs`, so tab-bar rows are not repeated. */
  tabs: MobileTab[];
  /** The page's TopBar shows ⋯ (no bell): Notifications becomes the first row, with its unread count. */
  notificationsFirst?: boolean;
  /** Unread notifications (`useNotifications().unreadCount`); shown on the Notifications row. */
  notificationsUnread?: number | null;
  /**
   * Tone of the Notifications row pill: `notificationBadgeTone(items)` (danger while an unread item has
   * severity `error`), so the bell's urgency survives when the bell is parked here. Default neutral.
   */
  notificationsTone?: 'neutral' | 'danger';
  /** Plan meter (the same UsageMeter content as the desktop SideNavFooter). Not rendered when absent. */
  usage?: React.ReactNode;
  /** Extra account-section controls, e.g. `<LiveSoundToggle />`. */
  accountExtras?: React.ReactNode;
  /** Default: clears the nav connections cache, then `useAuth().supabaseSignOut()`. */
  onSignOut?: () => void | Promise<void>;
  /** Default: `useShellStore` `moreOpen` / `setMoreOpen(false)`. */
  open?: boolean;
  onClose?: () => void;
  'data-testid'?: string;
};

export function MoreSheet({
  groups, tabs, notificationsFirst, notificationsUnread, notificationsTone = 'neutral', usage, accountExtras, onSignOut, open: openProp, onClose: onCloseProp, ...rest
}: MoreSheetProps) {
  const t = useTranslations('shell');
  const storeOpen = useShellStore((s) => s.moreOpen);
  const setMoreOpen = useShellStore((s) => s.setMoreOpen);
  const open = openProp ?? storeOpen;
  const onClose = onCloseProp ?? (() => setMoreOpen(false));
  const { user, supabaseSignOut } = useAuth() as {
    user?: { name?: string | null; email?: string | null; image?: string | null } | null;
    supabaseSignOut?: () => Promise<void>;
  };
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);

  const sheetGroups = React.useMemo(
    () => buildMoreSheetGroups(groups, tabs, { notificationsFirst }),
    [groups, tabs, notificationsFirst],
  );

  const signOut = async () => {
    onClose();
    if (onSignOut) {
      await onSignOut();
      return;
    }
    clearNavConnCache();
    await supabaseSignOut?.();
  };

  const accountName = user?.name || user?.email || '';
  const unread = notificationsUnread && notificationsUnread > 0 ? notificationsUnread : 0;

  return (
    <BottomSheet open={open} onClose={onClose} title={t('mobile.menu')} data-testid={rest['data-testid'] ?? 'more-sheet'}>
      <Box component="nav" aria-label={t('mainNav')} sx={{ py: '4px' }}>
        {sheetGroups.map((g, gi) => (
          <Box key={`${g.id}-${gi}`} sx={gi > 0 && g.bottom ? { borderTop: `1px solid ${n[100]}`, mt: '4px', pt: '4px' } : undefined}>
            {g.label && (
              <Box sx={{ px: '16px', pt: '12px', pb: '4px', fontSize: typeScale.caption[0], lineHeight: `${typeScale.caption[1]}px`, fontWeight: 500, color: n[500] }}>
                {g.label}
              </Box>
            )}
            <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
              {g.items.map((item) => (
                <Box component="li" key={item.id}>
                  <SheetNavRow item={item} onNavigate={onClose} unread={item.id === 'notifications' ? unread : 0} unreadTone={notificationsTone} reconnectText={t('badge.reconnectShort')} unreadLabel={unread ? t('badge.unread', { count: unread }) : undefined} />
                </Box>
              ))}
            </Box>
          </Box>
        ))}
      </Box>

      {usage && (
        <Box data-testid="more-sheet-usage" sx={{ borderTop: `1px solid ${n[100]}`, px: '16px', py: '12px' }}>
          {usage}
        </Box>
      )}

      <Box sx={{ borderTop: `1px solid ${n[100]}`, py: '4px' }}>
        {user && (
          <RowBase href="/ayarlar" onClick={onClose} ariaLabel={`${t('account.settings')}: ${accountName}`} testId="more-sheet-account">
            <Avatar name={accountName || '?'} src={user.image ?? null} size={28} />
            <Box component="span" sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
              <Box component="span" sx={ellipsis}>{user.name || user.email}</Box>
              {user.name && user.email && (
                <Box component="span" sx={{ ...ellipsis, fontSize: typeScale.caption[0], lineHeight: `${typeScale.caption[1]}px`, color: n[500] }}>{user.email}</Box>
              )}
            </Box>
          </RowBase>
        )}
        <Box sx={{ minHeight: 48, display: 'flex', alignItems: 'center', gap: '12px', px: '16px' }}>
          <Box component="span" sx={{ display: 'inline-flex', color: n[500] }}>
            <icons.language size={18} strokeWidth={1.75} aria-hidden />
          </Box>
          <Box component="span" sx={{ flex: 1, fontSize: typeScale.body[0], color: n[800] }}>
            {t('account.language')}
          </Box>
          <SegmentedControl<AppLocale>
            aria-label={t('account.language')}
            value={locale}
            onChange={(v) => setLocale(v)}
            options={[
              { value: 'en', label: LOCALE_ENDONYMS.en },
              { value: 'tr', label: LOCALE_ENDONYMS.tr },
            ]}
            data-testid="more-sheet-language"
          />
        </Box>
        {accountExtras && (
          <Box data-testid="more-sheet-extras" sx={{ minHeight: 48, display: 'flex', alignItems: 'center', gap: '8px', px: '16px' }}>
            {accountExtras}
          </Box>
        )}
        <RowBase onClick={() => void signOut()} ariaLabel={t('account.signOut')} testId="more-sheet-signout">
          <Box component="span" sx={{ display: 'inline-flex', color: n[500] }}>
            <icons.signOut size={18} strokeWidth={1.75} aria-hidden />
          </Box>
          <Box component="span" sx={{ flex: 1 }}>{t('account.signOut')}</Box>
        </RowBase>
      </Box>
    </BottomSheet>
  );
}

export type MoreSheetConnectedProps = {
  ctx: Pick<AppShellContext, 'model' | 'signedIn' | 'signOut'>;
  /** Plan meter content (same as the desktop SideNavFooter meter). */
  usage?: React.ReactNode;
};

/**
 * Rendered as JSX from AppShell `renderMoreSheet` (see the wiring contract in MobileTopBar.tsx). Owns its
 * hooks: `showBell` from the shared page meta, unread count + tone from the app-wide notifications key.
 * The account section carries `<LiveSoundToggle/>` (backend, import only), as the TopBar does on desktop.
 */
export function MoreSheetConnected({ ctx, usage }: MoreSheetConnectedProps) {
  const { showBell } = useMobileTopBarState();
  const { items, unreadCount } = useNotifications(ctx.signedIn);
  return (
    <MoreSheet
      groups={ctx.model.groups}
      tabs={ctx.model.tabs}
      notificationsFirst={!showBell}
      notificationsUnread={unreadCount}
      notificationsTone={notificationBadgeTone(items)}
      usage={usage}
      accountExtras={<LiveSoundToggle />}
      onSignOut={ctx.signOut}
    />
  );
}

const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;

type RowBaseProps = {
  href?: string;
  onClick?: () => void;
  ariaLabel?: string;
  active?: boolean;
  testId?: string;
  children: React.ReactNode;
};

function RowBase({ href, onClick, ariaLabel, active, testId, children }: RowBaseProps) {
  const linkProps = href
    ? { component: NextLink, href, 'aria-current': active ? ('page' as const) : undefined }
    : { type: 'button' as const };
  return (
    <ButtonBase
      {...(linkProps as Record<string, unknown>)}
      onClick={onClick}
      aria-label={ariaLabel}
      data-testid={testId}
      sx={{
        width: '100%',
        minHeight: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: '12px',
        px: '16px',
        textAlign: 'left',
        fontSize: typeScale.body[0],
        lineHeight: `${typeScale.body[1]}px`,
        fontWeight: active ? 600 : 400,
        color: n[active ? 900 : 800],
        bgcolor: active ? n[50] : 'transparent',
        '&:active': { bgcolor: n[100] },
        '&.Mui-focusVisible': { outline: `2px solid ${accent[500]}`, outlineOffset: '-2px' },
      }}
    >
      {children}
    </ButtonBase>
  );
}

function SheetNavRow({
  item, onNavigate, unread, unreadTone = 'neutral', reconnectText, unreadLabel,
}: { item: NavItem; onNavigate: () => void; unread: number; unreadTone?: 'neutral' | 'danger'; reconnectText: string; unreadLabel?: string }) {
  const Icon = item.icon;
  const count = item.count && item.count > 0 ? item.count : unread > 0 ? unread : 0;
  const countTone = item.count ? item.countTone : unreadTone;
  const countLabel = item.count ? item.countLabel : unreadLabel;
  const reconnectInline = item.listingRow && item.dot === 'warning';
  const parts = [item.ariaLabel];
  if (count && countLabel) parts.push(countLabel);
  if (item.dot && item.dotLabel) parts.push(item.dotLabel);
  return (
    <RowBase href={item.href} onClick={onNavigate} active={item.active} ariaLabel={parts.join(', ')} testId={`more-row-${item.id}`}>
      <Box component="span" sx={{ width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: item.active ? n[900] : n[500], flexShrink: 0 }}>
        {item.brand ? <LogoTile brand={item.brand} size={24} /> : Icon ? <Icon size={18} strokeWidth={1.75} aria-hidden /> : null}
      </Box>
      <Box component="span" sx={{ flex: 1, minWidth: 0, ...ellipsis }}>{item.label}</Box>
      {reconnectInline ? (
        <Box component="span" aria-hidden data-testid={`more-row-${item.id}-reconnect`} sx={{ fontSize: typeScale.caption[0], lineHeight: `${typeScale.caption[1]}px`, color: tone.warning.fg, flexShrink: 0 }}>
          {reconnectText}
        </Box>
      ) : count ? (
        <CountPill count={count} tone={countTone} inline />
      ) : item.dot ? (
        <Box
          component="span"
          aria-hidden
          data-testid={`more-row-${item.id}-dot`}
          data-dot={item.dot}
          sx={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, bgcolor: item.dot === 'danger' ? tone.danger.solid : item.dot === 'attention' ? tone.attention.solid : tone.warning.solid }}
        />
      ) : null}
    </RowBase>
  );
}

export default MoreSheet;
