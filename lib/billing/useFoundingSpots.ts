// lib/billing/useFoundingSpots.ts — settings §2.4 / §10.6: the founding-member counter on the pricing page.
// SWR over the public `GET /api/billing/founding-spots` (`refreshInterval: 60s`), never retried on error.
// The UI never shows a counter that did not come from this endpoint: an error, a 404 (endpoint not shipped
// yet), `active: false` or `remaining: 0` all read as "no founding offer" (the line and the founding
// prices are hidden).
import useSWR from 'swr';
import type { FoundingSpots } from './types';

export const FOUNDING_SPOTS_KEY = '/api/billing/founding-spots';

/** Validates the endpoint body; null when it is not a usable `FoundingSpots`. */
export function normalizeFoundingSpots(raw: unknown): FoundingSpots | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const total = int(r.total);
  const remaining = int(r.remaining);
  const percentOff = typeof r.percentOff === 'number' && r.percentOff > 0 && r.percentOff < 100 ? r.percentOff : null;
  if (total === null || remaining === null || percentOff === null) return null;
  return { active: r.active === true, total, remaining: Math.min(remaining, total), percentOff };
}

/** true when the offer may be shown (active and at least one spot left). */
export function foundingOpen(spots: FoundingSpots | null | undefined): spots is FoundingSpots {
  return !!spots && spots.active && spots.remaining > 0 && spots.total > 0;
}

async function fetchSpots(url: string): Promise<FoundingSpots | null> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return normalizeFoundingSpots(await res.json());
}

export interface UseFoundingSpotsResult {
  /** The offer when it is open; null when it is off, full, failed or unknown. */
  spots: FoundingSpots | null;
  /** First response not in yet (render a reserved-height skeleton, no layout jump). */
  isLoading: boolean;
  mutate: () => Promise<unknown>;
}

export function useFoundingSpots(options: { enabled?: boolean } = {}): UseFoundingSpotsResult {
  const enabled = options.enabled ?? true;
  const swr = useSWR<FoundingSpots | null>(enabled ? FOUNDING_SPOTS_KEY : null, fetchSpots, {
    refreshInterval: 60_000,
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const spots = swr.error ? null : swr.data ?? null;
  return {
    spots: foundingOpen(spots) ? spots : null,
    isLoading: enabled && swr.data === undefined && !swr.error,
    mutate: () => swr.mutate(),
  };
}

export default useFoundingSpots;
