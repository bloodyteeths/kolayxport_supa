// lib/research/hooks/useListingSales.ts — estimated monthly sales/revenue for Product finder's top listings
// (GET /api/research/sales, same engine as the extension's search cards). Loads after the search result, so the
// answer card and the list render first; ids still `pending` (shop data loading, capped per call) are re-polled with
// `poll=1` a few times. Etsy only (other marketplaces return `unsupported`).
import * as React from 'react';
import type { ResearchMkt, TopListing } from '@/lib/research/types';

export type SalesKind = 'measured' | 'estimated' | 'insufficient' | 'pending';

export interface ListingSales {
  kind: SalesKind;
  confidence: 'high' | 'medium' | 'low' | null;
  monthlySales: number | null;
  monthlySalesUpperBound: number | null;
  monthlyRevenue: number | null;
  currency: string | null;
}

const POLL_DELAYS_MS = [2000, 3000, 4000, 6000, 9000];

async function fetchSales(ids: string[], poll: boolean): Promise<{ listings: Record<string, ListingSales>; pendingIds: string[] } | null> {
  const res = await fetch(`/api/research/sales?mkt=etsy&ids=${ids.join(',')}${poll ? '&poll=1' : ''}`, { credentials: 'same-origin' });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  const data = body?.data;
  if (!data || typeof data !== 'object') return null;
  return { listings: data.listings ?? {}, pendingIds: Array.isArray(data.pendingIds) ? data.pendingIds : [] };
}

/** Sales per listing id (undefined while loading). */
export function useListingSales(mkt: ResearchMkt, rows: TopListing[]): { sales: Record<string, ListingSales>; loading: boolean } {
  const ids = React.useMemo(() => (mkt === 'etsy' ? rows.map((r) => r.id).filter((id) => /^\d{4,20}$/.test(id)).slice(0, 48) : []), [mkt, rows]);
  const key = ids.join(',');
  const [sales, setSales] = React.useState<Record<string, ListingSales>>({});
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    setSales({});
    if (!key) return undefined;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    setLoading(true);
    const run = async (want: string[], attempt: number) => {
      const r = await fetchSales(want, attempt > 0).catch(() => null);
      if (cancelled) return;
      if (r) setSales((prev) => ({ ...prev, ...r.listings }));
      const pending = r?.pendingIds?.filter((id) => want.includes(id)) ?? [];
      if (pending.length && attempt < POLL_DELAYS_MS.length) {
        timers.push(setTimeout(() => void run(pending, attempt + 1), POLL_DELAYS_MS[attempt]));
      } else {
        setLoading(false);
      }
    };
    void run(key.split(','), 0);
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [key]);

  return { sales, loading };
}

/**
 * Pure: revenue in the listing's display currency. The server returns revenue in the listing's own currency; when
 * the row has a converted price, the same rate converts the revenue.
 */
export function displayRevenue(row: TopListing, s: ListingSales | undefined): { amount: number; currency: string } | null {
  if (!s || s.monthlyRevenue == null) return null;
  const own = row.price;
  const conv = row.priceConverted;
  if (conv && own && own.amount > 0) return { amount: Math.round((s.monthlyRevenue * conv.amount) / own.amount), currency: conv.currency };
  return { amount: Math.round(s.monthlyRevenue), currency: s.currency || own?.currency || 'USD' };
}

/** Pure: totals over the listings that have a number (for the answer card's market tile). */
export function marketTotals(rows: TopListing[], sales: Record<string, ListingSales>): { counted: number; monthlySales: number; revenue: number | null; currency: string | null; measured: number } {
  let counted = 0;
  let monthlySales = 0;
  let revenue = 0;
  let currency: string | null = null;
  let mixed = false;
  let measured = 0;
  for (const r of rows) {
    const s = sales[r.id];
    if (!s || s.monthlySales == null || (s.kind !== 'measured' && s.kind !== 'estimated')) continue;
    counted++;
    monthlySales += s.monthlySales;
    if (s.kind === 'measured') measured++;
    const rev = displayRevenue(r, s);
    if (rev) {
      if (currency && currency !== rev.currency) mixed = true;
      currency = currency ?? rev.currency;
      revenue += rev.amount;
    }
  }
  return { counted, monthlySales: Math.round(monthlySales), revenue: mixed || !currency ? null : Math.round(revenue), currency: mixed ? null : currency, measured };
}
