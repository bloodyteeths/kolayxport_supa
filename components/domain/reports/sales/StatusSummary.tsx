// components/domain/reports/sales/StatusSummary.tsx — finance-analytics §2.1 "Orders by status" (M9 Group C).
// The API returns raw statuses per marketplace; the client maps them with `orderStatus(raw, marketplace)` into the DS
// order keys and sums per key, so the pill and its color come from `StatusPill` (no rainbow bars, no API colors).
// Each 48px row links to Orders filtered by that status in the same range.
import * as React from 'react';
import Box from '@mui/material/Box';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { StatusPill } from '@/components/ds/data/StatusPill';
import { Num } from '@/components/ds/format/Num';
import { Section } from '@/components/ds/page/Section';
import { orderStatus } from '@/lib/ds/status/orders';
import type { OrderStatusKey } from '@/lib/ds/status/vocabulary';
import { icons } from '@/lib/ds/icons';
import { accent, neutral, px, radius, space } from '@/lib/ds/tokens';
import type { LinkFlags } from '@/lib/nav/links';
import type { SalesStatusRow } from '@/lib/reports/useSalesReport';
import { reportOrdersHref } from './StoreTable';

/** Display order (§2.1): live first, then closed. */
export const STATUS_ORDER: readonly OrderStatusKey[] = ['to_ship', 'on_hold', 'problem', 'shipped', 'delivered', 'cancelled', 'refunded'];

export interface StatusCount {
  key: OrderStatusKey;
  count: number;
  /** Raw values that mapped here, for the pill tooltip ("Etsy: paid · Trendyol: Created"). */
  raw: string[];
}

/** Pure: raw rows → one count per DS key, in display order, zero counts dropped. */
export function summarizeStatuses(rows: SalesStatusRow[]): StatusCount[] {
  const map = new Map<OrderStatusKey, StatusCount>();
  for (const r of rows) {
    if (!(r.count > 0)) continue;
    const key = orderStatus(r.raw, r.marketplace);
    const entry = map.get(key) ?? { key, count: 0, raw: [] };
    entry.count += r.count;
    const label = r.marketplace ? `${r.marketplace}: ${r.raw}` : r.raw;
    if (r.raw && !entry.raw.includes(label)) entry.raw.push(label);
    map.set(key, entry);
  }
  const order = (k: OrderStatusKey) => {
    const i = STATUS_ORDER.indexOf(k);
    return i < 0 ? STATUS_ORDER.length : i;
  };
  return Array.from(map.values()).sort((a, b) => order(a.key) - order(b.key));
}

export interface StatusSummaryProps {
  rows: SalesStatusRow[];
  from: string;
  to: string;
  flags: LinkFlags;
}

export function StatusSummary({ rows, from, to, flags }: StatusSummaryProps) {
  const t = useTranslations('reports');
  const counts = React.useMemo(() => summarizeStatuses(rows), [rows]);
  const Next = icons.next;

  return (
    <Section title={t('sales.status.title')} variant="card" flush data-testid="sales-statuses">
      {counts.length === 0 ? (
        <Box sx={{ p: px(space[4]), color: neutral[500], fontSize: 14 }}>{t('empty.noOrders.title')}</Box>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>
          {counts.map((c, i) => (
            <Box component="li" key={c.key} sx={{ borderTop: i === 0 ? 'none' : `1px solid ${neutral[100]}` }}>
              <Box
                component={NextLink}
                href={reportOrdersHref({ from, to, status: c.key }, flags)}
                data-testid={`status-row-${c.key}`}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: px(space[2]),
                  minHeight: 48,
                  px: px(space[4]),
                  color: 'inherit',
                  textDecoration: 'none',
                  borderRadius: px(radius.sm),
                  '&:hover': { bgcolor: neutral[50] },
                  '&:focus-visible': { outline: `2px solid ${accent[600]}`, outlineOffset: -2 },
                }}
              >
                <StatusPill domain="order" status={c.key} raw={c.raw.slice(0, 6).join(' · ') || undefined} />
                <Box component="span" sx={{ ml: 'auto', color: neutral[900], fontVariantNumeric: 'tabular-nums' }}>
                  <Num value={c.count} />
                </Box>
                <Next size={16} strokeWidth={1.75} aria-hidden color={neutral[400]} />
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Section>
  );
}

export default StatusSummary;
