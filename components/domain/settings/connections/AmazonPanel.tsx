/**
 * Amazon panel (§4.4): marketplace multiselect + current seller id. "Connect Amazon" / "Save marketplaces"
 * both re-run the existing OAuth entry point with the selected marketplaces (same as the legacy
 * handleConnectAmazon). Keeps the `loading || error` guard so a reconnect never drops stored marketplaces.
 */
import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { SidePanel } from '@/components/ds/overlay';
import { LogoTile } from '@/components/ds/data';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Combobox, FormField, type ComboboxOption } from '@/components/ds/inputs';
import { ErrorState, ListSkeleton } from '@/components/ds/state';
import { neutral as n, px, space, type as typeScale } from '@/lib/ds/tokens';
import type { ConnectionStatusKey } from '@/lib/ds/status/vocabulary';
import { amazonConnectHref } from '@/lib/settings/integrations';
import type { AmazonDetails } from './useAmazonDetails';

export interface AmazonPanelProps {
  open: boolean;
  onClose: () => void;
  details: AmazonDetails;
  connected: boolean;
  status?: ConnectionStatusKey | null;
  /** Seller id from /api/integrations/status when the Amazon endpoint has not answered. */
  fallbackSellerId?: string | null;
  /** Navigates to the OAuth URL (window.location.assign in the app; injectable for tests). */
  navigate?: (href: string) => void;
}

export function AmazonPanel({ open, onClose, details, connected, status, fallbackSellerId, navigate }: AmazonPanelProps) {
  const t = useTranslations('settings');
  const tc = useTranslations('settings.connections');
  const [cs, cl] = typeScale.caption;

  const options = useMemo<ComboboxOption[]>(
    () => details.available.map((m) => ({ value: m.id, label: `${m.code} · ${m.domain}`, description: m.name })),
    [details.available],
  );
  const value = useMemo<ComboboxOption[]>(
    () => details.selectedIds.map((id) => options.find((o) => o.value === id) ?? { value: id, label: id }),
    [details.selectedIds, options],
  );

  const sellerId = details.sellerId || fallbackSellerId || null;
  const noneSelected = details.selectedIds.length === 0;
  const go = () => {
    const href = amazonConnectHref(details.selectedIds);
    if (navigate) navigate(href);
    else window.location.href = href;
  };

  return (
    <SidePanel padded
      open={open}
      onClose={onClose}
      size="sm"
      title="Amazon"
      leading={<LogoTile brand="amazon" size={32} />}
      status={status ? <StatusPill domain="connection" status={status} /> : undefined}
      meta={sellerId ? `${t('amazonSellerId')}: ${sellerId}` : undefined}
      secondary={{ id: 'amazon-cancel', label: t('credentials.cancel'), onClick: onClose }}
      primary={{
        id: 'amazon-connect',
        label: connected ? tc('amazonPanel.save') : tc('amazonPanel.connect'),
        onClick: go,
        disabled: noneSelected || details.reconnectBlocked,
        disabledReason: noneSelected ? t('amazonSelectMarketplaceFirst') : details.error ? t('amazonDetailsLoadFailed') : undefined,
        loading: details.loading,
      }}
      data-testid="amazon-panel"
    >
      {details.error ? (
        <ErrorState variant="inline" title={t('amazonDetailsLoadFailed')} onRetry={() => void details.refetch()} retrying={details.loading} />
      ) : details.loading && details.available.length === 0 ? (
        <ListSkeleton rows={2} leading="none" />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: px(space[4]) }}>
          <span style={{ fontSize: cs, lineHeight: px(cl), color: n[500] }}>{t('amazonSelectMarketplacesHelp')}</span>
          <FormField label={t('amazonMarketplaces')} helper={t('amazonMarketplacesHelp')}>
            <Combobox
              multiple
              options={options}
              value={value}
              onChange={(next) => details.setSelectedIds(next.map((o) => o.value))}
              data-testid="amazon-marketplaces"
            />
          </FormField>
        </div>
      )}
    </SidePanel>
  );
}

export default AmazonPanel;
