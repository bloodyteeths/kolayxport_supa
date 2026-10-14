import React from 'react';
import Link from 'next/link';
import { Button, CircularProgress } from '@mui/material';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import { useTranslations } from 'next-intl';
import { useConnections, type ConnectionProvider } from '@/lib/hooks/useConnections';

const PROVIDER_NAMES: Record<string, string> = {
  etsy: 'Etsy', ebay: 'eBay', amazon: 'Amazon', shopify: 'Shopify', wix: 'Wix',
  trendyol: 'Trendyol', hepsiburada: 'Hepsiburada', veeqo: 'Veeqo', shippo: 'Shippo',
  fedex: 'FedEx', ups: 'UPS', mng: 'DHL eCommerce', parasut: 'Paraşüt',
};

/** Settings tab where each provider is connected (OAuth vs pasted API keys). */
const KEY_BASED: readonly string[] = ['trendyol', 'hepsiburada', 'veeqo', 'shippo', 'fedex', 'ups', 'mng', 'parasut'];

export interface ConnectEmptyStateProps {
  provider: ConnectionProvider;
  /** Optional extra line under the title, e.g. what the page does once connected. */
  description?: string;
  className?: string;
}

/** Shown on a provider-specific page when that provider is not connected. */
export default function ConnectEmptyState({ provider, description, className = '' }: ConnectEmptyStateProps) {
  const t = useTranslations('ui');
  const name = PROVIDER_NAMES[provider] || provider;
  const tab = KEY_BASED.includes(provider) ? 'apiKeys' : 'connections';

  return (
    <div className={`flex flex-col items-center justify-center py-14 px-6 text-center ${className}`}>
      <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center mb-4 bg-slate-100">
        <LinkRoundedIcon sx={{ color: '#475569', fontSize: 30 }} />
      </div>
      <h3 className="text-base sm:text-lg font-semibold text-slate-800 mb-1.5" style={{ letterSpacing: '-0.01em' }}>
        {t('connectEmpty.title', { name })}
      </h3>
      <p className="text-sm text-slate-500 max-w-sm mb-5">{description || t('connectEmpty.description', { name })}</p>
      <Button
        component={Link}
        href={`/ayarlar?tab=${tab}`}
        variant="contained"
        disableElevation
        sx={{ minHeight: 44, textTransform: 'none', borderRadius: 2 }}
      >
        {t('connectEmpty.cta', { name })}
      </Button>
    </div>
  );
}

/**
 * Wraps a provider page: renders children when connected (or while the status
 * is still loading / errored, so a transient failure never hides a connected
 * user's data), and ConnectEmptyState when definitely not connected.
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
    return (
      <div className="flex justify-center py-16">
        <CircularProgress size={28} />
      </div>
    );
  }
  return <>{children}</>;
}

export { ConnectEmptyState };
