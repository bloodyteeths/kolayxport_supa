/**
 * Amazon marketplace details (selection list + current seller id) from GET /api/integrations/amazon/status.
 * Moved from the legacy ConnectionsPanel unchanged, including the reconnect guard: until the stored
 * selection has loaded, a reconnect would fall back to the default and drop the user's other marketplaces.
 */
import { useCallback, useEffect, useState } from 'react';
// @ts-ignore -- same import as the legacy panel
import axios from 'axios';
import { AMAZON_DEFAULT_MARKETPLACES } from '@/lib/settings/integrations';

export type AmazonMarketplaceOpt = { id: string; code: string; name: string; domain: string; region: string };

export interface AmazonDetails {
  sellerId: string | null;
  marketplaces: AmazonMarketplaceOpt[];
  available: AmazonMarketplaceOpt[];
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  loading: boolean;
  error: unknown;
  /** True while a reconnect would drop stored marketplaces (`loading || error`). */
  reconnectBlocked: boolean;
  refetch: () => Promise<void>;
  reset: () => void;
}

export function useAmazonDetails(refreshKey: number): AmazonDetails {
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [marketplaces, setMarketplaces] = useState<AmazonMarketplaceOpt[]>([]);
  const [available, setAvailable] = useState<AmazonMarketplaceOpt[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([...AMAZON_DEFAULT_MARKETPLACES]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await axios.get('/api/integrations/amazon/status');
      setSellerId(r.data.sellerId || null);
      setMarketplaces(r.data.marketplaces || []);
      setAvailable(r.data.availableMarketplaces || []);
      if (r.data.marketplaceIds?.length) setSelectedIds(r.data.marketplaceIds);
    } catch (e) {
      setError(e);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void refetch(); }, [refreshKey, refetch]);

  const reset = useCallback(() => { setSellerId(null); setMarketplaces([]); }, []);

  return {
    sellerId, marketplaces, available, selectedIds, setSelectedIds, loading, error,
    reconnectBlocked: loading || !!error, refetch, reset,
  };
}
