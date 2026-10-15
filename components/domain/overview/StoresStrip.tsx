// components/domain/overview/StoresStrip.tsx (overview G6, §3.5) — one chip per connected store account (Etsy
// shops are separate accounts): LogoTile + name + connection StatusPill + "refreshed …". Needs-reconnect first,
// then alphabetical. A failed connections check reads "Couldn't check", never "Not connected". Not-connected
// providers and carriers are not listed (Settings and the setup checklist own them).
import * as React from 'react';
import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';
import { Section } from '@/components/ds/page';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { LogoTile } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { useFormatters } from '@/lib/format';
import { Bone } from '@/components/ds/state/Skeletons';
import { connectionStatus } from '@/lib/ds/status/connections';
import { getLogo } from '@/lib/ds/logos';
import { icons } from '@/lib/ds/icons';
import { settingsHref } from '@/lib/nav/links';
import { accent, neutral, px, radius, space } from '@/lib/ds/tokens';
import type { ConnectionProvider, ConnectionsMap } from '@/lib/hooks/useConnections';

/** Order/listing sources shown here (lib/integrations/connectionStatus MARKETPLACE_PROVIDERS; duplicated so the
 * client bundle never imports that server module). Carriers are excluded. */
export const STORE_PROVIDERS: readonly ConnectionProvider[] = ['etsy', 'ebay', 'amazon', 'shopify', 'wix', 'trendyol', 'hepsiburada', 'veeqo', 'shippo'];

export interface StoreChip {
  id: string;
  provider: ConnectionProvider;
  name: string;
  status: 'connected' | 'needs_reconnect' | 'incomplete' | 'check_failed';
  lastSyncAt: string | null;
}

/** Pure: chips for every connected (or reconnect / incomplete) account, needs_reconnect first, then by name. */
export function storeChips(connections: ConnectionsMap | null | undefined): StoreChip[] {
  if (!connections) return [];
  const out: StoreChip[] = [];
  for (const p of STORE_PROVIDERS) {
    const e = connections[p];
    if (!e) continue;
    const providerName = getLogo(p)?.name ?? p;
    const entryStatus = connectionStatus(e);
    if (entryStatus === 'not_connected' || entryStatus === 'check_failed') continue;
    const accounts = e.accounts?.length ? e.accounts : [{ id: p, name: providerName, externalId: null }];
    for (const a of accounts) {
      const accStatus = a.needsReauth ? 'needs_reconnect' : entryStatus === 'needs_reconnect' && e.accounts.length <= 1 ? 'needs_reconnect' : entryStatus;
      out.push({
        id: `${p}:${a.id}`,
        provider: p,
        name: a.name?.trim() || providerName,
        status: accStatus,
        lastSyncAt: a.lastSyncAt ?? null,
      });
    }
  }
  const rank = (s: StoreChip['status']) => (s === 'needs_reconnect' ? 0 : 1);
  return out.sort((a, b) => rank(a.status) - rank(b.status) || a.name.localeCompare(b.name));
}

export interface StoresStripProps {
  connections: ConnectionsMap | null;
  loading: boolean;
  /** The connections request errored with no data. */
  checkFailed: boolean;
}

function Chip({ chip, mobile }: { chip: StoreChip; mobile: boolean }) {
  const t = useTranslations('overview');
  const fmt = useFormatters();
  const Chevron = icons.disclosure;
  return (
    <Box
      component={NextLink}
      href={settingsHref('connections', chip.provider)}
      data-testid={`store-chip-${chip.provider}`}
      data-status={chip.status}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: px(space[2]),
        minHeight: mobile ? 48 : 32,
        px: mobile ? 0 : px(space[2]),
        border: mobile ? 'none' : `1px solid ${neutral[200]}`,
        borderBottom: mobile ? `1px solid ${neutral[100]}` : undefined,
        borderRadius: mobile ? 0 : px(radius.full),
        color: neutral[800],
        textDecoration: 'none',
        bgcolor: neutral[0],
        minWidth: 0,
        '&:hover': { bgcolor: neutral[50] },
        '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: 2 },
      }}
    >
      <LogoTile brand={chip.provider} size={20} />
      <Typography variant="label" component="span" noWrap sx={{ minWidth: 0, flexShrink: 1 }}>
        {chip.name}
      </Typography>
      <StatusPill domain="connection" status={chip.status} size="sm" />
      {chip.lastSyncAt && chip.status === 'connected' ? (
        <Typography variant="caption" component="span" noWrap sx={{ color: neutral[500] }}>
          {t('stores.refreshed', { time: fmt.relative(chip.lastSyncAt) })}
        </Typography>
      ) : null}
      {mobile ? (
        <Box component="span" sx={{ ml: 'auto', display: 'inline-flex', color: neutral[400] }}>
          <Chevron size={16} aria-hidden />
        </Box>
      ) : null}
    </Box>
  );
}

export function StoresStrip({ connections, loading, checkFailed }: StoresStripProps) {
  const t = useTranslations('overview');
  const mobile = useIsMobile();
  const chips = React.useMemo(() => storeChips(connections), [connections]);
  const connectedCount = chips.length;

  const links = (
    <Box sx={{ display: 'inline-flex', gap: px(space[3]), alignItems: 'center' }}>
      {!loading && !checkFailed && connectedCount < 2 ? (
        <Link component={NextLink} href={settingsHref('connections')} variant="dense" underline="hover" data-testid="stores-connect">
          {t('stores.connect')}
        </Link>
      ) : null}
      <Link component={NextLink} href={settingsHref('connections')} variant="dense" underline="hover" data-testid="stores-manage">
        {t('stores.manage')}
      </Link>
    </Box>
  );

  let body: React.ReactNode;
  if (loading && !connections) {
    body = (
      <Box sx={{ display: 'flex', gap: px(space[2]), flexWrap: 'wrap' }} data-testid="stores-loading">
        {[0, 1, 2].map((i) => (
          <Bone key={i} w={160} h={32} r={radius.full} />
        ))}
      </Box>
    );
  } else if (checkFailed && !connections) {
    body = (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: px(space[2]) }} data-testid="stores-check-failed">
        <StatusPill domain="connection" status="check_failed" />
      </Box>
    );
  } else if (!chips.length) {
    body = null;
  } else {
    body = (
      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, display: mobile ? 'block' : 'flex', flexWrap: 'wrap', gap: px(space[2]) }}
      >
        {chips.map((c) => (
          <Box component="li" key={c.id} sx={{ minWidth: 0 }}>
            <Chip chip={c} mobile={mobile} />
          </Box>
        ))}
      </Box>
    );
  }

  return (
    <Section title={t('stores.title')} headerSlot={links} data-testid="overview-stores">
      {body}
    </Section>
  );
}

export default StoresStrip;
