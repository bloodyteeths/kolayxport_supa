/**
 * Etsy shops panel (§4.4): the Etsy API restriction as a one-line info Banner (moved from the page top),
 * one row per shop (name, mono shop id, last refresh, pill, row ⋯ Reconnect / Disconnect…), footer
 * "Close" · "Connect another shop" (hidden when the store meter is full).
 */
import { useTranslations } from 'next-intl';
import { SidePanel, OverflowMenu } from '@/components/ds/overlay';
import { Banner } from '@/components/ds/feedback';
import { LogoTile } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { EmptyState, ListSkeleton } from '@/components/ds/state';
import { Button } from '@/components/ds/inputs';
import { useFormatters } from '@/lib/format';
import { neutral as n, px, space, type as typeScale } from '@/lib/ds/tokens';
import { icons } from '@/lib/ds/icons';
import { ETSY_CONNECT_HREF } from '@/lib/settings/integrations';
import type { ConnectionAccount } from '@/lib/integrations/connectionStatus';
import { ListRow } from './ListRow';

export interface EtsyShopsPanelProps {
  open: boolean;
  onClose: () => void;
  accounts: ConnectionAccount[];
  loading?: boolean;
  /** Store meter full: hide "Connect another shop", show the caption instead. */
  storesFull?: boolean;
  /** `entitlement.stripeUpsell === true` (the "Compare plans" link). */
  showCompare?: boolean;
  onDisconnect: (account: ConnectionAccount) => void;
  /** `etsy:<accountId>` while a disconnect is in flight. */
  busyKey?: string | null;
  isPhone?: boolean;
}

export function EtsyShopsPanel({ open, onClose, accounts, loading, storesFull, showCompare, onDisconnect, busyKey, isPhone }: EtsyShopsPanelProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const f = useFormatters();
  const [cs, cl] = typeScale.caption;

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      size="sm"
      title={tc('etsyPanel.title')}
      leading={<LogoTile brand="etsy" size={32} />}
      secondary={{ id: 'etsy-close', label: t('connections.panel.close'), onClick: onClose }}
      primary={storesFull ? undefined : { id: 'etsy-connect-another', label: tc('etsyPanel.connectAnother'), href: ETSY_CONNECT_HREF, icon: icons.add }}
      headerSlot={<Banner tone="info" title={t('etsyApiLimited')}>{t('etsyApiLimitedDesc')}</Banner>}
      data-testid="etsy-shops-panel"
    >
      {loading ? (
        <ListSkeleton rows={3} leading="thumb" />
      ) : accounts.length === 0 ? (
        <EmptyState
          kind="first-use"
          brand="etsy"
          compact
          title={tc('etsyPanel.empty')}
          action={{ id: 'etsy-connect-first', label: tc('action.connect', { provider: 'Etsy' }), href: ETSY_CONNECT_HREF }}
        />
      ) : (
        <div>
          {accounts.map((shop, i) => (
            <ListRow
              key={shop.id}
              divider={i > 0}
              stacked={isPhone}
              data-testid={`etsy-shop-${shop.id}`}
              title={shop.name}
              status={<StatusPill domain="connection" status={shop.needsReauth ? 'needs_reconnect' : 'connected'} size="sm" />}
              caption={[
                shop.externalId ? tc('etsyPanel.shopId', { id: shop.externalId }) : null,
                shop.lastSyncAt ? tc('meta.refreshed', { time: f.relative(shop.lastSyncAt) }) : null,
              ].filter(Boolean).join(' · ')}
              captionMono
              trailing={
                <OverflowMenu
                  label={tc('menu.more', { provider: shop.name })}
                  data-testid={`etsy-shop-${shop.id}-more`}
                  itemTestIdPrefix={`etsy-shop-${shop.id}-menu-`}
                  items={[
                    { id: 'reconnect', label: tc('action.reconnect'), href: ETSY_CONNECT_HREF, icon: icons.pull },
                    'divider',
                    {
                      id: 'disconnect', label: tc('menu.disconnect', { provider: shop.name }), tone: 'danger',
                      loading: busyKey === `etsy:${shop.id}`, onClick: () => onDisconnect(shop),
                    },
                  ]}
                />
              }
            />
          ))}
        </div>
      )}
      {storesFull && (
        <div style={{ marginTop: px(space[4]), display: 'flex', alignItems: 'center', gap: px(space[2]), flexWrap: 'wrap', fontSize: cs, lineHeight: px(cl), color: n[500] }} data-testid="etsy-store-limit">
          <span>{tc('etsyPanel.limitReached')}</span>
          {showCompare && (
            <Button variant="ghost" size="sm" href="/fiyatlandirma">{tc('comparePlans')}</Button>
          )}
        </div>
      )}
    </SidePanel>
  );
}

export default EtsyShopsPanel;
