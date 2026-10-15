import React from 'react';
import { useTranslations } from 'next-intl';
import { getLogo } from '@/lib/ds/logos';
import type { ActionSpec } from '../overlay/actions';
import { EmptyState } from './EmptyState';

export type MarketplaceKey = 'etsy' | 'ebay' | 'amazon' | 'shopify' | 'wix' | 'trendyol' | 'hepsiburada' | 'n11';

export interface ConnectStateProps {
  /** Marketplace (or carrier / service key known to `lib/ds/logos.ts`). */
  brand: MarketplaceKey | (string & {});
  /** "Connect Etsy to see your listings" */
  title: string;
  body?: React.ReactNode;
  /** Where the connect flow starts, e.g. `/ayarlar?tab=connections`. */
  connectHref: string;
  /** Default: "Connect {name}". */
  actionLabel?: string;
  /** Optional click hook (analytics / OAuth popup) in addition to the href navigation. */
  onConnect?: () => void;
  className?: string;
  'data-testid'?: string;
}

/**
 * DS §3.13 `first-use` for a disconnected marketplace. Replaces the **whole page body**, never a
 * half-empty table. Absorbs `components/ui/ConnectEmptyState`.
 */
export function ConnectState({ brand, title, body, connectHref, actionLabel, onConnect, className, ...rest }: ConnectStateProps) {
  const t = useTranslations('ds.state.connect');
  const name = getLogo(brand)?.name ?? brand;
  const action: ActionSpec = { id: `connect-${brand}`, label: actionLabel ?? t('cta', { name }), href: connectHref, onClick: onConnect };
  return (
    <EmptyState
      kind="first-use"
      brand={brand}
      title={title}
      body={body}
      action={action}
      className={className}
      data-testid={rest['data-testid'] ?? `connect-${brand}`}
    />
  );
}

export default ConnectState;
