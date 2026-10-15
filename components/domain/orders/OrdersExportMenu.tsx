// components/domain/orders/OrdersExportMenu.tsx (orders G2) — "Export ▾" (orders §2.3, §11.3): CSV · Excel · PDF
// for "N selected" and "All N matching filters", through the unchanged `POST /api/orders/export`.
// "All matching" exports by ids: the ids are read from `/api/orders` with the list's own query, so the file
// holds exactly the orders the list counts. The export API's filter scope does not understand the new
// views or the normalized status keys yet (BUILD_PLAN §6 request), so filters are never sent to it.
// Desktop: a menu under a DS secondary button. Mobile: a BottomSheet with 44px rows.
// Port of the legacy `components/labels/ExportMenu.tsx` behavior (gesture-safe download on iOS/WebViews,
// 413 → "too many", empty export → info), with DS parts and the `orders.export.*` keys.
import * as React from 'react';
import Box from '@mui/material/Box';
import Divider from '@mui/material/Divider';
import ListSubheader from '@mui/material/ListSubheader';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ds/inputs/Button';
import { BottomSheet } from '@/components/ds/overlay/BottomSheet';
import { useIsMobile } from '@/components/ds/page/useViewport';
import { useToast } from '@/components/ds/feedback/toast';
import { icons, ICON_STROKE } from '@/lib/ds/icons';
import { neutral, zIndex } from '@/lib/ds/tokens';
import { ORDERS_API, ordersApiParams } from '@/lib/hooks/useOrdersList';
import type { OrdersQuery } from '@/lib/orders/types';

/** Mirrors EXPORT_MAX_ORDERS in lib/export/orders.ts (server-only module, not imported). */
export const EXPORT_MAX = 1000;
const MAX_GET_URL = 6000;
/** `/api/orders` page size cap (A1). */
const ID_PAGE_SIZE = 250;

export type ExportFormat = 'csv' | 'xlsx' | 'pdf';
export type ExportScope = 'selected' | 'filters';

const FORMATS: { format: ExportFormat; key: 'csv' | 'excel' | 'pdf' }[] = [
  { format: 'csv', key: 'csv' },
  { format: 'xlsx', key: 'excel' },
  { format: 'pdf', key: 'pdf' },
];

/**
 * Ids of every order matching the list query (same `/api/orders` params as the list), at most `max`.
 * Returns null when a page request fails.
 */
export async function fetchMatchingIds(
  query: OrdersQuery,
  max: number = EXPORT_MAX,
  fetcher: typeof fetch = fetch,
): Promise<string[] | null> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (let page = 1; ids.length < max; page++) {
    const p = ordersApiParams({ ...query, page, size: ID_PAGE_SIZE });
    p.delete('include');
    let body: { orders?: { id?: unknown }[]; total?: unknown } | null = null;
    try {
      const res = await fetcher(`${ORDERS_API}?${p.toString()}`, { credentials: 'same-origin' });
      if (!res.ok) return null;
      body = await res.json();
    } catch {
      return null;
    }
    const orders = body && Array.isArray(body.orders) ? body.orders : [];
    for (const o of orders) {
      if (typeof o?.id === 'string' && !seen.has(o.id)) {
        seen.add(o.id);
        ids.push(o.id);
      }
    }
    const total = typeof body?.total === 'number' ? body.total : null;
    if (orders.length < ID_PAGE_SIZE || (total !== null && page * ID_PAGE_SIZE >= total)) break;
  }
  return ids.slice(0, max);
}

/** iOS Safari / PWA / in-app WebViews ignore a blob download that fires after the tap (gesture expired). */
function needsGestureDownload(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  let standalone = false;
  try {
    standalone = window.matchMedia('(display-mode: standalone)').matches;
  } catch {
    /* ignore */
  }
  return iOS || standalone || /FBAN|FBAV|Instagram|Line\/|; wv\)/.test(ua);
}

function buildGetUrl(p: { format: ExportFormat; locale: string; tz?: string; ids: string[] }): string {
  const sp = new URLSearchParams();
  sp.set('format', p.format);
  sp.set('locale', p.locale);
  if (p.tz) sp.set('tz', p.tz);
  sp.set('ids', p.ids.join(','));
  return `/api/orders/export?${sp.toString()}`;
}

function filenameFrom(res: Response, format: ExportFormat): string {
  const m = /filename="?([^";]+)"?/i.exec(res.headers.get('Content-Disposition') || '');
  return m?.[1] || `orders-${new Date().toISOString().slice(0, 10)}.${format}`;
}

export type OrdersExportMenuProps = {
  /** Order ids currently selected; empty = only "All matching filters". */
  selectedIds: readonly string[];
  /** The list query (same object `useOrdersList` gets). */
  query: OrdersQuery;
  /** Orders matching the query (list `total`). */
  matchingTotal?: number | null;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Controlled open state (mobile bulk bar ⋯ → sheet). Uncontrolled by default. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Render only the menu/sheet (the caller opens it from another control). */
  hideTrigger?: boolean;
  'data-testid'?: string;
};

export function OrdersExportMenu({
  selectedIds,
  query,
  matchingTotal,
  size = 'sm',
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  'data-testid': testId = 'orders-export',
}: OrdersExportMenuProps) {
  const t = useTranslations('orders');
  const locale = useLocale();
  const toast = useToast();
  const mobile = useIsMobile();
  const triggerRef = React.useRef<HTMLDivElement | null>(null);
  const [openState, setOpenState] = React.useState(false);
  const open = openProp ?? openState;
  const setOpen = React.useCallback(
    (next: boolean | ((o: boolean) => boolean)) => {
      const value = typeof next === 'function' ? next(open) : next;
      if (openProp === undefined) setOpenState(value);
      onOpenChange?.(value);
    },
    [open, openProp, onOpenChange],
  );
  const [busy, setBusy] = React.useState(false);

  const selectedCount = selectedIds.length;
  const total = typeof matchingTotal === 'number' ? matchingTotal : null;

  const run = async (format: ExportFormat, scope: ExportScope) => {
    setOpen(false);
    if (busy) return;
    const count = scope === 'selected' ? selectedCount : total;
    if (count !== null && count > EXPORT_MAX) {
      toast.error(t('export.tooMany', { max: EXPORT_MAX }), { persist: false });
      return;
    }
    let tz: string | undefined;
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      /* server default */
    }
    if (scope === 'selected') {
      // Synchronous, still inside the tap: no await before the navigation.
      if (needsGestureDownload()) {
        const url = buildGetUrl({ format, locale, tz, ids: [...selectedIds] });
        if (url.length <= MAX_GET_URL) {
          toast.info(t('export.preparing', { count: selectedCount }));
          window.location.assign(url);
          return;
        }
      }
      await download(format, tz, [...selectedIds], count);
      return;
    }

    setBusy(true);
    toast.info(t('export.preparing', { count: count ?? 0 }));
    const ids = await fetchMatchingIds(query, EXPORT_MAX);
    if (!ids) {
      setBusy(false);
      toast.error(t('export.failed'), { persist: false });
      return;
    }
    if (ids.length === 0) {
      setBusy(false);
      toast.info(t('export.empty'));
      return;
    }
    // A navigation (not a blob click) still downloads on iOS after the await, when the URL fits.
    if (needsGestureDownload()) {
      const url = buildGetUrl({ format, locale, tz, ids });
      if (url.length <= MAX_GET_URL) {
        setBusy(false);
        window.location.assign(url);
        return;
      }
    }
    await download(format, tz, ids, ids.length, true);
  };

  const download = async (format: ExportFormat, tz: string | undefined, ids: string[], count: number | null, announced = false) => {
    setBusy(true);
    if (!announced && (count === null || count > 50)) toast.info(t('export.preparing', { count: count ?? 0 }));
    try {
      const res = await fetch('/api/orders/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ format, locale, tz, ids }),
      });
      if (!res.ok) {
        toast.error(res.status === 413 ? t('export.tooMany', { max: EXPORT_MAX }) : t('export.failed'), { persist: false });
        return;
      }
      const exported = Number(res.headers.get('X-Export-Count') || '0');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filenameFrom(res, format);
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (exported === 0) toast.info(t('export.empty'));
      else toast.success(t('export.done', { count: exported }));
    } catch {
      toast.error(t('export.failed'), { persist: false });
    } finally {
      setBusy(false);
    }
  };

  type Section = { scope: ExportScope; title: string; hint: string | null; disabled: boolean };
  const sections: Section[] = [];
  if (selectedCount > 0) {
    const tooMany = selectedCount > EXPORT_MAX;
    sections.push({
      scope: 'selected',
      title: t('export.selected', { count: selectedCount }),
      hint: tooMany ? t('export.tooMany', { max: EXPORT_MAX }) : null,
      disabled: busy || tooMany,
    });
  }
  {
    const tooMany = total !== null && total > EXPORT_MAX;
    const empty = total === 0;
    sections.push({
      scope: 'filters',
      title: total !== null ? t('export.allMatchingCount', { count: total }) : t('export.allMatching'),
      hint: tooMany ? t('export.tooMany', { max: EXPORT_MAX }) : empty ? t('export.empty') : null,
      disabled: busy || tooMany || empty,
    });
  }

  const DownloadIcon = icons.download;
  const rows = (s: Section, rowH: number) =>
    FORMATS.map((f) => (
      <MenuItem
        key={`${s.scope}-${f.format}`}
        disabled={s.disabled}
        onClick={() => void run(f.format, s.scope)}
        data-testid={`${testId}-${s.scope}-${f.format}`}
        sx={{ minHeight: rowH, gap: '8px', fontSize: 13, color: neutral[800] }}
      >
        <DownloadIcon size={16} strokeWidth={ICON_STROKE} aria-hidden />
        {t(`export.${f.key}`)}
      </MenuItem>
    ));

  const content = sections.flatMap((s, i) => [
    i > 0 ? <Divider key={`d-${s.scope}`} /> : null,
    <ListSubheader key={`h-${s.scope}`} sx={{ lineHeight: '32px', fontSize: 12, fontWeight: 600, color: neutral[600], bgcolor: 'transparent' }}>
      {s.title}
    </ListSubheader>,
    s.hint ? (
      <Typography key={`hint-${s.scope}`} component="p" sx={{ px: '16px', pb: '4px', m: 0, fontSize: 12, color: neutral[500], maxWidth: 280 }}>
        {s.hint}
      </Typography>
    ) : null,
    ...rows(s, mobile ? 44 : 32),
  ]);

  return (
    <>
      <Box ref={triggerRef} sx={{ display: hideTrigger ? 'none' : 'inline-flex' }}>
        <Button
          variant="secondary"
          size={size}
          icon={icons.download}
          trailingIcon={icons.disclosure}
          loading={busy}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          data-testid={testId}
        >
          {t('actions.export')}
        </Button>
      </Box>
      {mobile || hideTrigger ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} title={t('export.title')} data-testid={`${testId}-sheet`}>
          <Box role="menu">{content}</Box>
        </BottomSheet>
      ) : (
        <Menu
          open={open}
          anchorEl={triggerRef.current}
          onClose={() => setOpen(false)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
          sx={{ zIndex: zIndex.popover }}
          slotProps={{ paper: { sx: { mt: '4px', minWidth: 240 } } }}
          data-testid={`${testId}-menu`}
        >
          {content}
        </Menu>
      )}
    </>
  );
}

export default OrdersExportMenu;
