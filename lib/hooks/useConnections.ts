/**
 * useConnections — client hook over GET /api/integrations/status.
 *
 * One SWR key for the whole app, so the nav, dashboards and settings share a
 * single cached request (dedupingInterval 30s, revalidated on window focus,
 * keepPreviousData so a revalidation never blanks the UI).
 *
 * Tri-state pattern (avoid nav flicker):
 *   has('etsy') === undefined  -> still loading the first snapshot: render a
 *                                 skeleton / keep the previous layout; do NOT
 *                                 hide or show provider-specific nav yet.
 *   has('etsy') === true       -> connected (may still need re-auth: check
 *                                 connections.etsy.needsReauth).
 *   has('etsy') === false      -> definitely not connected.
 * `anyMarketplace` follows the same undefined/true/false rule.
 * On a fetch error with no cached data, has() keeps returning undefined, so a
 * transient failure never hides features from a connected user.
 *
 * After connecting/disconnecting a provider, call `mutate()` (or the global
 * `mutate(CONNECTIONS_KEY)` from 'swr') so every consumer refreshes.
 */
import useSWR from 'swr';
import { useCallback, useMemo } from 'react';
import type {
  ConnectionEntry,
  ConnectionProvider,
  ConnectionStatusResponse,
  ConnectionsMap,
  ExtensionStatus,
} from '@/lib/integrations/connectionStatus';

export type {
  ConnectionAccount,
  ConnectionEntry,
  ConnectionProvider,
  ConnectionReason,
  ConnectionStatusResponse,
  ConnectionsMap,
  ExtensionStatus,
} from '@/lib/integrations/connectionStatus';

export const CONNECTIONS_KEY = '/api/integrations/status';

// Duplicated from the server module on purpose: importing a runtime value from
// connectionStatus.ts would pull Prisma into the client bundle (type imports are erased).
const MARKETPLACES: readonly ConnectionProvider[] = [
  'etsy',
  'ebay',
  'amazon',
  'shopify',
  'wix',
  'trendyol',
  'hepsiburada',
  'veeqo',
  'shippo',
];

class ConnectionsFetchError extends Error {
  status: number;
  constructor(status: number) {
    super(`Failed to load integration status (${status})`);
    this.status = status;
  }
}

const fetcher = async (url: string): Promise<ConnectionStatusResponse> => {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new ConnectionsFetchError(res.status);
  return res.json();
};

export interface UseConnectionsResult {
  /** null until the first successful response. */
  connections: ConnectionsMap | null;
  extension: ExtensionStatus | null;
  /** True only while there is no data yet (first load). */
  isLoading: boolean;
  /** True while any request (incl. background revalidation) is in flight. */
  isValidating: boolean;
  error: Error | undefined;
  /** undefined while unknown (loading / errored without data); see header comment. */
  has: (provider: ConnectionProvider) => boolean | undefined;
  /** Entry for one provider, or undefined while unknown. */
  get: (provider: ConnectionProvider) => ConnectionEntry | undefined;
  /** Any order/listing source connected; undefined while unknown. */
  anyMarketplace: boolean | undefined;
  /** Providers that are connected but need the user to re-authorise. */
  needsReauth: ConnectionProvider[];
  mutate: () => Promise<ConnectionStatusResponse | undefined>;
}

export function useConnections(): UseConnectionsResult {
  const { data, error, isLoading, isValidating, mutate } = useSWR<ConnectionStatusResponse>(
    CONNECTIONS_KEY,
    fetcher,
    {
      revalidateOnFocus: true,
      dedupingInterval: 30_000,
      keepPreviousData: true,
      shouldRetryOnError: (err: unknown) => !(err instanceof ConnectionsFetchError && err.status === 401),
      errorRetryCount: 3,
    },
  );

  const connections = data?.connections ?? null;

  const has = useCallback(
    (provider: ConnectionProvider): boolean | undefined =>
      connections ? Boolean(connections[provider]?.connected) : undefined,
    [connections],
  );

  const get = useCallback(
    (provider: ConnectionProvider): ConnectionEntry | undefined => connections?.[provider],
    [connections],
  );

  const anyMarketplace = useMemo<boolean | undefined>(
    () => (connections ? MARKETPLACES.some((p) => connections[p]?.connected) : undefined),
    [connections],
  );

  const needsReauth = useMemo<ConnectionProvider[]>(
    () =>
      connections
        ? (Object.keys(connections) as ConnectionProvider[]).filter(
            (p) => connections[p]?.connected && connections[p]?.needsReauth,
          )
        : [],
    [connections],
  );

  const refresh = useCallback(() => mutate(), [mutate]);

  return {
    connections,
    extension: data?.extension ?? null,
    isLoading: isLoading && !data,
    isValidating,
    error: error as Error | undefined,
    has,
    get,
    anyMarketplace,
    needsReauth,
    mutate: refresh,
  };
}

export default useConnections;
