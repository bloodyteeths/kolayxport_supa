// lib/research/hooks/useDoctor.ts — Listing doctor data (research.md §7, §10, R1-D).
//
// Reads (SWR, DB-only on the server for the list):
//   GET /api/research/listings              → useDoctorList   (`ResearchResponse<DoctorData>`, R1-A)
//   GET /api/research/listings/[id]/peers   → useDoctorPeers  (`ResearchResponse<PeersData>`, Etsy only)
// Writes (staging only, never a send):
//   useDoctorStaging → one draft per listing through the listings staging adapters
//   (`components/domain/listings/useStagedChanges` etsyAdapter / ebayAdapter, import only).
// AI (1 credit): requestTitleSuggestion → POST /api/ai/etsy `optimize_title` (English title; the caller validates).
import * as React from 'react';
import useSWR from 'swr';
import { useAsyncRegion, type AsyncState } from '@/lib/ds/useAsyncState';
import { LIMIT_UI_HEADER } from '@/lib/http/limitInterceptor';
import type {
  DoctorData,
  DoctorRow,
  DoctorSort,
  PeersData,
  ResearchResponse,
  ResearchSectionError,
  SourceNoteProps,
} from '@/lib/research/types';
import type { StagePatch } from '@/lib/listings/types';
import { ebayAdapter, etsyAdapter, StagingError } from '@/components/domain/listings/useStagedChanges';
import type { DoctorHealthBand, DoctorMkt } from '@/components/domain/research/listings/doctorModel';

export type { DoctorData, DoctorRow, PeersData };

/** Peers payload as the panel reads it (R1-A `PeersData`; an empty `listingChecks` falls back to the row's stored health in `buildDoctorScore`). */
export type DoctorPeersData = PeersData;

export type DoctorListQuery = {
  mkt: DoctorMkt;
  shop?: string;
  sort: DoctorSort;
  issue?: string;
  health?: DoctorHealthBand;
  q?: string;
  page: number;
  size: number;
};

// ─── Keys (pure) ────────────────────────────────────────────────────────────

export const DOCTOR_LIST_PATH = '/api/research/listings';

/** Stable key: fixed param order, defaults omitted (sort `opportunity`, page 1, size 50). */
export function doctorListUrl(q: DoctorListQuery): string {
  const p = new URLSearchParams();
  p.set('mkt', q.mkt);
  if (q.shop) p.set('shop', q.shop);
  if (q.sort !== 'opportunity') p.set('sort', q.sort);
  if (q.issue) p.set('issue', q.issue);
  if (q.health) p.set('health', q.health);
  if (q.q) p.set('q', q.q);
  if (q.page !== 1) p.set('page', String(q.page));
  if (q.size !== 50) p.set('size', String(q.size));
  return `${DOCTOR_LIST_PATH}?${p.toString()}`;
}

export function doctorPeersUrl(id: string, opts: { shop?: string | null; keyword?: string | null }): string {
  const p = new URLSearchParams();
  if (opts.shop) p.set('shop', opts.shop);
  if (opts.keyword) p.set('keyword', opts.keyword);
  const qs = p.toString();
  return `${DOCTOR_LIST_PATH}/${encodeURIComponent(id)}/peers${qs ? `?${qs}` : ''}`;
}

export class ResearchHttpError extends Error {
  status: number;
  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`);
    this.status = status;
  }
}

async function envelopeFetcher<T>(url: string): Promise<ResearchResponse<T>> {
  const res = await fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } });
  if (!res.ok) throw new ResearchHttpError(res.status, url);
  const body = (await res.json()) as unknown;
  if (!body || typeof body !== 'object' || !('data' in (body as Record<string, unknown>))) {
    throw new ResearchHttpError(502, url);
  }
  return body as ResearchResponse<T>;
}

/** First error of a section (`peers`, `stats`, …). */
export function sectionError(errors: ResearchSectionError[] | undefined, section: string): ResearchSectionError | undefined {
  return errors?.find((e) => e.section === section);
}

/** The Etsy budget circuit breaker answered from cache (research §3.6). */
export function isBudgetError(errors: ResearchSectionError[] | undefined): boolean {
  return Boolean(errors?.some((e) => e.key === 'research.error.budget'));
}

// ─── List ───────────────────────────────────────────────────────────────────

export type UseDoctorList = {
  data: DoctorData | null;
  rows: DoctorRow[];
  total: number;
  source: SourceNoteProps | null;
  errors: ResearchSectionError[];
  /** `useAsyncState` of the region; `empty` = the server answered with no rows (or `data: null`). */
  state: AsyncState;
  isValidating: boolean;
  retry: () => void;
  mutate: () => Promise<unknown>;
};

const EMPTY_ROWS: DoctorRow[] = [];

export function useDoctorList(query: DoctorListQuery | null): UseDoctorList {
  const key = query ? doctorListUrl(query) : null;
  const swr = useSWR<ResearchResponse<DoctorData>>(key, envelopeFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
  });
  const region = useAsyncRegion(swr, { isEmpty: (d) => !d?.data || d.data.rows.length === 0 });
  const data = swr.data?.data ?? null;
  const mutate = swr.mutate;
  return {
    data,
    rows: data?.rows ?? EMPTY_ROWS,
    total: data?.total ?? 0,
    source: swr.data?.source ?? null,
    errors: swr.data?.errors ?? [],
    state: region.state,
    isValidating: swr.isValidating,
    retry: region.retry,
    mutate: React.useCallback(() => mutate(), [mutate]),
  };
}

// ─── Peers (one listing) ────────────────────────────────────────────────────

export type UseDoctorPeers = {
  data: DoctorPeersData | null;
  source: SourceNoteProps | null;
  errors: ResearchSectionError[];
  state: AsyncState;
  retry: () => void;
};

export function useDoctorPeers(id: string | null, opts: { mkt: DoctorMkt; shop?: string | null; keyword?: string | null }): UseDoctorPeers {
  // Peers come from Etsy search (research §10); eBay listings show their stored checks only.
  const key = id && opts.mkt === 'etsy' ? doctorPeersUrl(id, { shop: opts.shop, keyword: opts.keyword }) : null;
  const swr = useSWR<ResearchResponse<DoctorPeersData>>(key, envelopeFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
    shouldRetryOnError: false,
  });
  const region = useAsyncRegion(swr, { isEmpty: (d) => !d?.data, idle: 'empty' });
  return {
    data: swr.data?.data ?? null,
    source: swr.data?.source ?? null,
    errors: swr.data?.errors ?? [],
    state: region.state,
    retry: region.retry,
  };
}

/** Imperative peers read for bulk actions (same URL, so the server's shared 24 h cache applies). */
export async function fetchDoctorPeers(id: string, opts: { shop?: string | null; keyword?: string | null }): Promise<ResearchResponse<DoctorPeersData>> {
  return envelopeFetcher<DoctorPeersData>(doctorPeersUrl(id, opts));
}

// ─── Staging (drafts only) ──────────────────────────────────────────────────

export type StageOutcome = { staged: string[]; failed: { id: string; errorKey?: string; status?: number }[] };

/**
 * One draft per listing. Etsy → `stageEtsyDraft` (etsyAdapter), eBay → `stageEbayDraft` (ebayAdapter).
 * Never sends: the listings page's "Send N changes" picks the drafts up.
 */
export function useDoctorStaging(opts: { mkt: DoctorMkt; shopId: string | null; currencyOf?: (id: string) => string | undefined }) {
  const { mkt, shopId, currencyOf } = opts;
  const adapter = React.useMemo(
    () =>
      mkt === 'etsy'
        ? etsyAdapter({ marketplace: 'etsy', storeId: shopId })
        : ebayAdapter({ marketplace: 'ebay', storeId: shopId, currencyOf }),
    [mkt, shopId, currencyOf],
  );
  const stageMany = React.useCallback(
    async (items: { id: string; patch: StagePatch }[]): Promise<StageOutcome> => {
      const out: StageOutcome = { staged: [], failed: [] };
      for (const { id, patch } of items) {
        if (!Object.keys(patch).length) continue;
        try {
          await adapter.stage(id, patch);
          out.staged.push(id);
        } catch (err) {
          const e = err instanceof StagingError ? err : null;
          out.failed.push({ id, errorKey: e?.key, status: e?.status });
        }
      }
      return out;
    },
    [adapter],
  );
  return { stageMany };
}

// ─── AI title (1 credit) ────────────────────────────────────────────────────

/**
 * `POST /api/ai/etsy { action: 'optimize_title' }` with the inline-limit header (a 402 shows on the button,
 * not the global dialog; CRITIQUE C6). Returns the raw fields; `cleanAiTitle` validates the title.
 */
export async function requestTitleSuggestion(input: { title: string; tags?: string[]; keyword?: string | null }): Promise<{
  status: number;
  title?: unknown;
  explanation?: unknown;
}> {
  const res = await fetch('/api/ai/etsy', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', [LIMIT_UI_HEADER]: 'inline' },
    body: JSON.stringify({
      action: 'optimize_title',
      title: input.title,
      tags: input.tags,
      keywords: input.keyword ? [input.keyword] : undefined,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, title: body.optimized_title, explanation: body.explanation };
}
