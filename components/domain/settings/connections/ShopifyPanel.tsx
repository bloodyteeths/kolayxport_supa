/**
 * Shopify panel (§4.4): connected stores (if any) + "Store address" with the `.myshopify.com` suffix.
 * "Connect Shopify" is the same href navigation as the legacy form (`/api/integrations/shopify/connect?shop=`).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay';
import { LogoTile } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { FormField, TextField } from '@/components/ds/inputs';
import { useFormatters } from '@/lib/format';
import { px, space } from '@/lib/ds/tokens';
import type { ConnectionAccount } from '@/lib/integrations/connectionStatus';
import type { ConnectionStatusKey } from '@/lib/ds/status/vocabulary';
import { normalizeShopifySubdomain, shopifyConnectHref } from '@/lib/settings/integrations';
import { ListRow } from './ListRow';

export interface ShopifyPanelProps {
  open: boolean;
  onClose: () => void;
  accounts: ConnectionAccount[];
  status?: ConnectionStatusKey | null;
}

export function ShopifyPanel({ open, onClose, accounts, status }: ShopifyPanelProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const f = useFormatters();
  const [domain, setDomain] = useState('');
  const sub = domain.trim();
  // App Store rule 2.3.1: a Shopify-installed account never types a myshopify domain;
  // further stores are added by installing from the App Store.
  const hasShop = accounts.length > 0;

  return (
    <SidePanel padded
      open={open}
      onClose={onClose}
      size="sm"
      title="Shopify"
      leading={<LogoTile brand="shopify" size={32} />}
      status={status ? <StatusPill domain="connection" status={status} /> : undefined}
      secondary={{ id: 'shopify-cancel', label: t('credentials.cancel'), onClick: onClose }}
      primary={hasShop ? undefined : {
        id: 'shopify-connect',
        label: tc('shopifyPanel.connect'),
        href: sub ? shopifyConnectHref(sub) : undefined,
        disabled: !sub,
        disabledReason: !sub ? tc('shopifyPanel.enterAddress') : undefined,
      }}
      data-testid="shopify-panel"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
        {accounts.length > 0 && (
          <div>
            {accounts.map((s, i) => (
              <ListRow
                key={s.id}
                divider={i > 0}
                title={s.name}
                status={<StatusPill domain="connection" status={s.needsReauth ? 'needs_reconnect' : 'connected'} size="sm" />}
                caption={[s.externalId && s.externalId !== s.name ? s.externalId : null, s.lastSyncAt ? tc('meta.refreshed', { time: f.relative(s.lastSyncAt) }) : null].filter(Boolean).join(' · ')}
              />
            ))}
          </div>
        )}
        {hasShop ? (
          <p style={{ margin: 0 }}>{tc('shopifyPanel.addAnotherViaAppStore')}</p>
        ) : (
        <FormField label={tc('shopifyPanel.storeAddress')}>
          <TextField
            value={domain}
            onChange={(v) => setDomain(normalizeShopifySubdomain(v))}
            placeholder={t('shopifyShopDomainPlaceholder')}
            suffix=".myshopify.com"
            autoComplete="off"
            autoFocus
            data-testid="shopify-domain"
          />
        </FormField>
        )}
      </div>
    </SidePanel>
  );
}

export default ShopifyPanel;
