// components/domain/research/shops/shopColumns.tsx (research R3-B) — Shop tracker table (research.md §8.1) and its
// cards below 900 px (§8.2): logo · Shop · Mkt · Sales / day (7d · Measured) · vs previous 7 days · Active ·
// New in 7 days · Price change (median) · ⋯. Every number is a `Metric` with its kind; a guarded value renders "—"
// with the reason ("First reading taken today. Daily sales appear tomorrow.").
import * as React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { Column } from '@/components/ds/data';
import { Avatar } from '@/components/ds/data/Avatar';
import { LogoTile } from '@/components/ds/data/LogoTile';
import type { DsFormat } from '@/components/ds/data/fmt';
import { Metric } from '@/components/ds/research/Metric';
import { neutral as n } from '@/lib/ds/tokens';
import type { Guarded } from '@/lib/research/types';
import { TRACKED_ITEMS_KEY, type WatchSummary } from '@/lib/research/hooks/useWatches';
import { cardMeta, cardSubtitle, deltaText, itemLine, newCountText, salesText, soldAllTime, trackedItems, usable, type ShopT } from './shopModel';

const guardOf = (g: Guarded<number>) => ({ ok: g.guard.ok, reasonKey: g.guard.reasonKey, reasonParams: g.guard.reasonParams });

/**
 * A passed value's server qualifier (research §3.1: a lower bound or a partial base is said, not hidden), for the
 * tooltip. `skip` leaves out keys the cell already says another way.
 */
function qualifier(g: Guarded<number>, t: ShopT, skip: readonly string[] = []): string | undefined {
  const k = g.guard.reasonKey;
  if (!g.guard.ok || !k || skip.includes(k) || !t.has(k)) return undefined;
  return t(k, g.guard.reasonParams ?? {});
}

/** The sales cell: Measured rate, or "—" with the reason; eBay before two readings adds "N items sold (all time)". */
export function SalesCell({ row, t, fmt }: { row: WatchSummary; t: ShopT; fmt: DsFormat }) {
  const g = row.metrics.salesPerDay;
  const text = salesText(row, fmt);
  const sold = text === null ? soldAllTime(row) : null;
  const flagged = row.metrics.droppedPoints > 0 ? t('research.shops.droppedPoints', { count: row.metrics.droppedPoints }) : undefined;
  // eBay: the rate covers only the user's tracked items of that seller, never the whole seller — said under the number.
  const items = text !== null ? trackedItems(g) : null;
  const extra = qualifier(g, t, [TRACKED_ITEMS_KEY, 'research.shops.pointsDropped']);
  return (
    <Box component="span" sx={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end' }}>
      <Metric value={text} kind={g.kind} guard={guardOf(g)} tooltip={[t('research.shops.salesHint'), extra, flagged].filter(Boolean).join(' · ')} data-testid="shop-sales" />
      {items !== null ? (
        <Typography variant="caption" component="span" sx={{ color: n[500] }} data-testid="shop-sales-items">
          {t('research.shops.fromTrackedItems', { count: items })}
        </Typography>
      ) : null}
      {sold !== null ? (
        <Typography variant="caption" component="span" sx={{ color: n[500] }}>
          {t('research.shops.ebaySoldAllTime', { count: sold, value: fmt.num(sold) })}
        </Typography>
      ) : null}
    </Box>
  );
}

function DeltaCell({ g, t, fmt }: { g: Guarded<number>; t: ShopT; fmt: DsFormat }) {
  // A competitor's change is neither good nor bad for the viewer: neutral text, the arrow carries the direction.
  return <Metric value={deltaText(g, fmt)} kind={g.kind} guard={guardOf(g)} tooltip={qualifier(g, t)} />;
}

/** Counts; `signed` = "New in 7 days" ("+9", or "≥ +9" when the shop's listing fetch was truncated). */
function CountCell({ g, t, fmt, signed, testId }: { g: Guarded<number>; t: ShopT; fmt: DsFormat; signed?: boolean; testId?: string }) {
  const v = signed ? newCountText(g, fmt) : usable(g) ? fmt.num(g.value) : null;
  return <Metric value={v} kind={g.kind} guard={guardOf(g)} tooltip={qualifier(g, t)} data-testid={testId} />;
}

export function shopColumns({ t, fmt }: { t: ShopT; fmt: DsFormat }): Column<WatchSummary>[] {
  return [
    {
      key: 'logo',
      header: '',
      width: 56,
      mobile: 'media',
      render: (r) => <Avatar name={r.label} src={r.iconUrl ?? r.shop?.iconUrl ?? null} size={32} />,
    },
    {
      key: 'shop',
      header: t('research.shops.col.shop'),
      minWidth: 200,
      mobile: 'title',
      render: (r) => {
        // eBay item rows: the item's own price and lifetime sold count under its title.
        const line = itemLine(r, t, fmt);
        return (
          <Box component="span" sx={{ display: 'block', minWidth: 0 }}>
            <Typography variant="dense" component="span" sx={{ color: n[900], display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.label}>
              {r.label}
            </Typography>
            {line ? (
              <Typography variant="caption" component="span" sx={{ color: n[500], display: 'block' }} data-testid="shop-item-line">
                {line}
              </Typography>
            ) : null}
          </Box>
        );
      },
      mobileRender: (r) => r.label,
    },
    {
      key: 'mkt',
      header: t('research.shops.col.mkt'),
      width: 64,
      mobile: 'hidden',
      render: (r) => <LogoTile brand={r.marketplace} size={20} />,
    },
    {
      key: 'card',
      header: t('research.shops.col.salesDay'),
      desktop: false,
      mobile: 'subtitle',
      render: (r) => cardSubtitle(r, t, fmt),
    },
    {
      key: 'cardMeta',
      header: t('research.shops.col.active'),
      desktop: false,
      mobile: 'meta',
      render: (r) => cardMeta(r, t, fmt),
    },
    {
      key: 'salesDay',
      header: t('research.shops.col.salesDay7'),
      width: 140,
      align: 'right',
      mobile: 'hidden',
      render: (r) => <SalesCell row={r} t={t} fmt={fmt} />,
    },
    {
      key: 'vsPrev',
      header: t('research.shops.col.vsPrev'),
      width: 132,
      align: 'right',
      mobile: 'hidden',
      render: (r) => <DeltaCell g={r.metrics.salesVsPrev} t={t} fmt={fmt} />,
    },
    {
      key: 'active',
      header: t('research.shops.col.active'),
      width: 96,
      align: 'right',
      mobile: 'hidden',
      render: (r) => <CountCell g={r.metrics.active} t={t} fmt={fmt} />,
    },
    {
      key: 'new7',
      header: t('research.shops.col.new7'),
      width: 112,
      align: 'right',
      mobile: 'hidden',
      render: (r) => <CountCell g={r.metrics.new7d} t={t} fmt={fmt} signed testId="shop-new7" />,
    },
    {
      key: 'priceDelta',
      header: t('research.shops.col.priceDelta'),
      width: 148,
      align: 'right',
      mobile: 'hidden',
      hideable: true,
      render: (r) => <DeltaCell g={r.metrics.priceChange} t={t} fmt={fmt} />,
    },
  ];
}
