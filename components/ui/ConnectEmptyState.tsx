import React from 'react';
import { useTranslations } from 'next-intl';
import { useConnections, type ConnectionProvider } from '@/lib/hooks/useConnections';
import { ConnectState } from '@/components/ds/state/ConnectState';
import { PanelSkeleton } from '@/components/ds/state/Skeletons';

/**
 * M1-f shim → `components/ds/state/ConnectState` (DESIGN_SYSTEM §3.13 `first-use`, §4.5; deleted in M10).
 *
 * Adapter (legacy prop → DS prop):
 * - `provider` → `brand` (real logo from `lib/ds/logos.ts`; `mng` resolves to the DHL mark)
 * - title `ui.connectEmpty.title` → `title`; `description` or `ui.connectEmpty.description` → `body`
 * - `ui.connectEmpty.cta` → `actionLabel`; settings tab by provider → `connectHref`
 * - `className`, `data-testid` pass through
 * Legacy `ui.*` copy is kept so the shim does not depend on the `ds.state.connect` keys being merged.
 */

/** Proper nouns (not translated). `mng` is shown as "DHL eCommerce" (DS §3.19 glossary). */
export const PROVIDER_NAMES: Record<string, string> = {
  etsy: 'Etsy', ebay: 'eBay', amazon: 'Amazon', shopify: 'Shopify', wix: 'Wix',
  trendyol: 'Trendyol', hepsiburada: 'Hepsiburada', veeqo: 'Veeqo', shippo: 'Shippo',
  fedex: 'FedEx', ups: 'UPS', mng: 'DHL eCommerce', parasut: 'Paraşüt',
};

/** Settings tab where each provider is connected (OAuth vs pasted API keys). */
const KEY_BASED: readonly string[] = ['trendyol', 'hepsiburada', 'veeqo', 'shippo', 'fedex', 'ups', 'mng', 'parasut'];

export function connectHrefFor(provider: string): string {
  return `/ayarlar?tab=${KEY_BASED.includes(provider) ? 'apiKeys' : 'connections'}`;
}

export interface ConnectEmptyStateProps {
  provider: ConnectionProvider;
  /** Optional extra line under the title, e.g. what the page does once connected. */
  description?: string;
  className?: string;
  'data-testid'?: string;
}

/** Shown on a provider-specific page when that provider is not connected. */
export default function ConnectEmptyState({ provider, description, className, 'data-testid': testId }: ConnectEmptyStateProps) {
  const t = useTranslations('ui');
  const name = PROVIDER_NAMES[provider] || provider;
  return (
    <ConnectState
      brand={provider}
      title={t('connectEmpty.title', { name })}
      body={description || t('connectEmpty.description', { name })}
      actionLabel={t('connectEmpty.cta', { name })}
      connectHref={connectHrefFor(provider)}
      className={className}
      data-testid={testId}
    />
  );
}

/**
 * Wraps a provider page: renders children when connected (or while the status is still loading / errored, so
 * a transient failure never hides a connected user's data), and ConnectEmptyState when definitely not
 * connected. Loading shows the DS PanelSkeleton, delayed 200ms (DS §3.13: no flash, spinners only inside buttons).
 */
export function RequireConnection({
  provider,
  description,
  children,
}: ConnectEmptyStateProps & { children: React.ReactNode }) {
  const { has, isLoading } = useConnections();
  const connected = has(provider);
  if (connected === false) return <ConnectEmptyState provider={provider} description={description} />;
  if (connected === undefined && isLoading) {
    // DS skeleton: appears only after SKELETON_DELAY_MS (200ms) so fast connection checks never flash.
    return <PanelSkeleton sections={2} data-testid="require-connection-loading" />;
  }
  return <>{children}</>;
}

export { ConnectEmptyState };
