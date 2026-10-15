// components/ds/shell/AccountMenu.tsx — avatar + ⌄ and the account menu (shell-nav §3.5; CRITIQUE C9).
//
// 260 px menu anchored right: name + email, Account settings, Plan & billing (Shopify-free: "Plan", the
// settings tab explains it is included with the Shopify app), Language radio rows (endonyms, never
// translated; the menu stays open so the user sees the switch), Keyboard shortcuts (not under
// `pointer: coarse`), Help, Sign out (a ghost row: signing out is not destructive). Sign out clears the
// per-user nav cache (`kx.nav.connections.v1`) before `supabaseSignOut()` (legacy AppLayout.js:480–483).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Divider from '@mui/material/Divider';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTranslations } from 'next-intl';
import { Avatar } from '@/components/ds/data/Avatar';
import { Kbd } from '@/components/ds/format/Kbd';
import { Bone } from '@/components/ds/state/Skeletons';
import { ICON_STROKE, icons, type LucideIcon } from '@/lib/ds/icons';
import { elevation, focusRing, neutral as n, px, radius, zIndex } from '@/lib/ds/tokens';
import { NAV_CONN_CACHE_KEY } from '@/lib/nav/useNavModel';
import useLocaleStore, { type AppLocale } from '@/lib/stores/useLocaleStore';
import { BILLING_HREF } from './SideNavFooter';

/** Language rows: endonyms (data, not message keys; shell-nav §10). */
export const LANGUAGE_OPTIONS: readonly { value: AppLocale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'tr', label: 'Türkçe' },
];

export const ACCOUNT_SETTINGS_HREF = '/ayarlar';
export const HELP_HREF = '/app/nasil-kullanirim';

export type AccountUser = { name?: string | null; email?: string | null; image?: string | null };

export type AccountMenuProps = {
  /** NextAuth `session.user`; null while the session loads (avatar skeleton). */
  user: AccountUser | null;
  /** Shopify-free accounts: the billing row reads "Plan". */
  shopifyFree?: boolean;
  onShowShortcuts: () => void;
  onSignOut: () => void | Promise<void>;
  className?: string;
  'data-testid'?: string;
};

/** Removes the per-user nav cache (try/catch: blocked storage is fine). */
export function clearNavConnCache(): void {
  try {
    window.localStorage.removeItem(NAV_CONN_CACHE_KEY);
  } catch {
    // ignore
  }
}

export function displayName(user: AccountUser | null): string {
  return (user?.name || user?.email || '').trim();
}

export function AccountMenu({ user, shopifyFree = false, onShowShortcuts, onSignOut, className, 'data-testid': testId = 'account-menu' }: AccountMenuProps) {
  const t = useTranslations('shell');
  const tNav = useTranslations('nav.items');
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const coarse = useMediaQuery('(pointer: coarse)');
  const [anchor, setAnchor] = React.useState<HTMLElement | null>(null);
  const menuId = React.useId();
  const open = Boolean(anchor);
  const close = () => setAnchor(null);

  if (!user) {
    return (
      <Box className={className} data-testid={`${testId}-skeleton`} aria-hidden sx={{ display: 'inline-flex' }}>
        <Bone w={28} h={28} circle />
      </Box>
    );
  }

  const name = displayName(user);
  const Chevron = icons.disclosure;

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label={t('topbar.account')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        className={className}
        data-testid={testId}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: px(4),
          height: 32,
          pl: px(2),
          pr: px(4),
          borderRadius: px(radius.full),
          color: n[500],
          '&:hover': { bgcolor: n[50] },
          '&.Mui-focusVisible': { boxShadow: focusRing },
        }}
      >
        <Avatar name={name || '?'} src={user.image ?? null} size={28} />
        <Chevron size={14} strokeWidth={ICON_STROKE} aria-hidden />
      </ButtonBase>
      <Menu
        id={menuId}
        anchorEl={anchor}
        open={open}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        sx={{ zIndex: zIndex.popover }}
        slotProps={{
          paper: { sx: { mt: px(8), width: 260, borderRadius: px(radius.md), boxShadow: elevation.e2, border: `1px solid ${n[200]}` } },
        }}
        MenuListProps={{ 'aria-label': t('topbar.account'), dense: true }}
      >
        <Box sx={{ px: px(16), pt: px(8), pb: px(8) }} data-testid="account-header">
          {user.name ? (
            <Typography component="div" variant="titleSm" sx={{ color: n[900], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.name}
            </Typography>
          ) : null}
          {user.email ? (
            <Typography component="div" variant="caption" sx={{ color: n[500], overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.email}
            </Typography>
          ) : null}
        </Box>
        <Divider />
        <MenuRow icon={icons.settings} label={t('account.settings')} href={ACCOUNT_SETTINGS_HREF} onClick={close} testId="account-settings" />
        <MenuRow
          icon={icons.billing}
          label={shopifyFree ? t('account.plan') : t('account.billing')}
          href={BILLING_HREF}
          onClick={close}
          testId="account-billing"
        />
        <Divider />
        <Typography component="div" variant="caption" sx={{ px: px(16), pt: px(4), pb: px(2), color: n[500] }} id={`${menuId}-lang`}>
          {t('account.language')}
        </Typography>
        {LANGUAGE_OPTIONS.map((opt) => {
          const checked = locale === opt.value;
          const Check = icons.check;
          return (
            <MenuItem
              key={opt.value}
              role="menuitemradio"
              aria-checked={checked}
              lang={opt.value}
              data-testid={`account-lang-${opt.value}`}
              onClick={() => setLocale(opt.value)}
              sx={rowSx}
            >
              <Box component="span" sx={{ width: 18, display: 'inline-flex', color: n[700] }}>
                {checked ? <Check size={16} strokeWidth={ICON_STROKE} aria-hidden /> : null}
              </Box>
              <Box component="span" sx={{ flex: 1 }}>
                {opt.label}
              </Box>
            </MenuItem>
          );
        })}
        <Divider />
        {coarse ? null : (
          <MenuItem
            data-testid="account-shortcuts"
            onClick={() => {
              close();
              onShowShortcuts();
            }}
            sx={rowSx}
          >
            <RowIcon icon={icons.shortcuts} />
            <Box component="span" sx={{ flex: 1 }}>
              {t('account.shortcuts')}
            </Box>
            <Kbd keys="?" />
          </MenuItem>
        )}
        <MenuRow icon={icons.help} label={tNav('help')} href={HELP_HREF} onClick={close} testId="account-help" />
        <Divider />
        <MenuItem
          data-testid="account-signout"
          onClick={() => {
            close();
            clearNavConnCache();
            void onSignOut();
          }}
          sx={rowSx}
        >
          <RowIcon icon={icons.signOut} />
          <Box component="span" sx={{ flex: 1 }}>
            {t('account.signOut')}
          </Box>
        </MenuItem>
      </Menu>
    </>
  );
}

const rowSx = {
  gap: px(8),
  minHeight: 36,
  px: px(16),
  fontSize: 13,
  lineHeight: '18px',
  color: n[800],
} as const;

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <Box component="span" sx={{ width: 18, display: 'inline-flex', color: n[500] }}>
      <Icon size={16} strokeWidth={ICON_STROKE} aria-hidden />
    </Box>
  );
}

function MenuRow({ icon, label, href, onClick, testId }: { icon: LucideIcon; label: string; href: string; onClick: () => void; testId: string }) {
  return (
    <MenuItem component={NextLink} href={href} onClick={onClick} data-testid={testId} sx={rowSx}>
      <RowIcon icon={icon} />
      <Box component="span" sx={{ flex: 1 }}>
        {label}
      </Box>
    </MenuItem>
  );
}

export default AccountMenu;
