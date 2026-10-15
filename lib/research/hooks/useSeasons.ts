// lib/research/hooks/useSeasons.ts (research R1-C) — Home "Upcoming seasons" (research.md §4.1).
//
// GET /api/research/seasons?country&productionDays → `ResearchResponse<SeasonsData>` (R1-A: lib/research/seasons.ts
// event table + the user's own `Shipment` transit medians). Production days are a per-viewer preference in v1
// (localStorage `kx.research.productionDays`, default 3, try/catch). The request carries them; the client also
// re-bases `listBy` on them (`listBy − (mine − row.productionDays)`), so an edit shows at once and stays right even
// if the server ignores the parameter.
import useSWR from 'swr';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAsyncRegion } from '@/lib/ds/useAsyncState';
import type { ResearchResponse, SeasonRow, SeasonsData } from '@/lib/research/types';
import { errorsOf, fetchResearch } from './useResearchProducts';

export const PRODUCTION_DAYS_KEY = 'kx.research.productionDays';
export const DEFAULT_PRODUCTION_DAYS = 3;
export const MAX_PRODUCTION_DAYS = 60;

function clampDays(n: number): number {
  return Math.max(0, Math.min(MAX_PRODUCTION_DAYS, Math.round(n)));
}

export function readProductionDays(): number {
  try {
    const raw = window.localStorage.getItem(PRODUCTION_DAYS_KEY);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampDays(n) : DEFAULT_PRODUCTION_DAYS;
  } catch {
    return DEFAULT_PRODUCTION_DAYS;
  }
}

export function writeProductionDays(days: number): void {
  try {
    window.localStorage.setItem(PRODUCTION_DAYS_KEY, String(clampDays(days)));
  } catch {
    /* storage blocked: the value applies to this page view only */
  }
}

const DAY_MS = 86_400_000;

function parseDay(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T00:00:00Z` : iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pure: whole UTC days from `now` to `date` (0 = today, negative = past). */
export function daysUntil(date: Date, now: Date = new Date()): number {
  const a = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const b = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((b - a) / DAY_MS);
}

export type SeasonView = SeasonRow & { listByDate: Date | null; daysLeft: number | null };

/** Pure: re-base a server row on the viewer's production days. */
export function rebaseSeason(row: SeasonRow, productionDays: number, now: Date = new Date()): SeasonView {
  const base = parseDay(row.listBy);
  const serverDays = Number.isFinite(row.productionDays) ? row.productionDays : DEFAULT_PRODUCTION_DAYS;
  const listByDate = base ? new Date(base.getTime() - (clampDays(productionDays) - serverDays) * DAY_MS) : null;
  return { ...row, listByDate, daysLeft: listByDate ? daysUntil(listByDate, now) : null };
}

/** Pure: future events, soonest list-by first. */
export function seasonViews(events: SeasonRow[], productionDays: number, now: Date = new Date(), limit = 5): SeasonView[] {
  return events
    .filter((e) => {
      const d = parseDay(e.date);
      return d ? daysUntil(d, now) > 0 : false;
    })
    .map((e) => rebaseSeason(e, productionDays, now))
    .sort((a, b) => (a.listByDate?.getTime() ?? Infinity) - (b.listByDate?.getTime() ?? Infinity))
    .slice(0, limit);
}

/** Production days (per viewer, localStorage). Renders the default on the server and the first client render. */
export function useProductionDays(): [number, (days: number) => void] {
  const [days, setDays] = useState(DEFAULT_PRODUCTION_DAYS);
  useEffect(() => setDays(readProductionDays()), []);
  const update = useCallback((d: number) => {
    const v = clampDays(d);
    setDays(v);
    writeProductionDays(v);
  }, []);
  return [days, update];
}

export function seasonsKey(country?: string, productionDays?: number): string {
  const sp = new URLSearchParams();
  if (country) sp.set('country', country);
  if (typeof productionDays === 'number') sp.set('productionDays', String(productionDays));
  const qs = sp.toString();
  return qs ? `/api/research/seasons?${qs}` : '/api/research/seasons';
}

export function useSeasons(country?: string, now?: Date) {
  const [productionDays, setProductionDays] = useProductionDays();
  const swr = useSWR<ResearchResponse<SeasonsData>>(seasonsKey(country, productionDays), (u: string) => fetchResearch<SeasonsData>(u), {
    revalidateOnFocus: false,
    keepPreviousData: true,
    dedupingInterval: 3_600_000,
    shouldRetryOnError: false,
  });
  const events = useMemo<SeasonRow[]>(() => (Array.isArray(swr.data?.data?.events) ? swr.data!.data!.events : []), [swr.data]);
  const rows = useMemo(() => seasonViews(events, productionDays, now), [events, productionDays, now]);
  const region = useAsyncRegion({ data: swr.data ? rows : undefined, error: swr.error, isLoading: swr.isLoading, isValidating: swr.isValidating, mutate: swr.mutate });
  return { rows, source: swr.data?.source, errors: errorsOf(swr.data), region, productionDays, setProductionDays };
}
