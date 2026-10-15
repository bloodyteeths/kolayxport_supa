import React, { useState } from 'react';
import {
  Box,
  Button,
  Divider,
  Drawer,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import FileDownloadRoundedIcon from '@mui/icons-material/FileDownloadRounded';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import GridOnRoundedIcon from '@mui/icons-material/GridOnRounded';
import PictureAsPdfOutlinedIcon from '@mui/icons-material/PictureAsPdfOutlined';
import { useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';
import { notify } from '@/lib/notify';
import useLocaleStore from '@/lib/stores/useLocaleStore';

/** Mirrors EXPORT_MAX_ORDERS in lib/export/orders.ts (not imported: that module is server-only). */
export const EXPORT_MAX = 1000;
/** Above this many orders a "preparing" toast is shown while the file builds. */
const LARGE_EXPORT = 50;

type Format = 'csv' | 'xlsx' | 'pdf';
type Scope = 'selected' | 'filters';

export interface ExportMenuProps {
  /** Order ids (Order.id) currently selected; empty = only "all matching filters". */
  selectedIds: string[];
  /** The same filter object the page passes to useOrders. */
  filters?: Record<string, unknown>;
  /** Total orders matching `filters` (from /api/orders). */
  matchingTotal?: number;
  /** 'chip' = compact pill used when nothing is selected. */
  variant?: 'button' | 'chip';
}

const FORMATS: Array<{ format: Format; icon: React.ReactNode; key: 'csv' | 'excel' | 'pdf' }> = [
  { format: 'csv', icon: <DescriptionOutlinedIcon fontSize="small" />, key: 'csv' },
  { format: 'xlsx', icon: <GridOnRoundedIcon fontSize="small" />, key: 'excel' },
  { format: 'pdf', icon: <PictureAsPdfOutlinedIcon fontSize="small" />, key: 'pdf' },
];

/** Drop empty values; arrays stay arrays (the API reads repeated params). */
function cleanFilters(filters: Record<string, unknown> | undefined): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (!filters) return out;
  for (const [k, v] of Object.entries(filters)) {
    if (v === undefined || v === null || v === '') continue;
    if (Array.isArray(v)) {
      const list = v.filter(x => x !== undefined && x !== null && x !== '').map(String);
      if (list.length > 0) out[k] = list;
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

/** Conservative: well under nginx's 8 KB request-line limit. */
const MAX_GET_URL = 6000;

/**
 * iOS Safari and in-app / PWA WebViews may ignore a script-driven blob
 * <a download> that fires seconds after the tap (gesture expired). There we
 * navigate to the GET endpoint synchronously inside the click instead; the
 * Content-Disposition: attachment response downloads without leaving the page.
 */
function needsGestureDownload(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1);
  let standalone = false;
  try { standalone = window.matchMedia('(display-mode: standalone)').matches; } catch { /* ignore */ }
  const inApp = /FBAN|FBAV|Instagram|Line\/|; wv\)/.test(ua);
  return iOS || standalone || inApp;
}

function buildGetUrl(params: { format: Format; locale: string; tz?: string; ids?: string[]; filters?: Record<string, string | string[]> }): string {
  const sp = new URLSearchParams();
  sp.set('format', params.format);
  sp.set('locale', params.locale);
  if (params.tz) sp.set('tz', params.tz);
  if (params.ids) {
    sp.set('ids', params.ids.join(','));
  } else {
    const f = new URLSearchParams();
    for (const [k, v] of Object.entries(params.filters || {})) {
      if (Array.isArray(v)) v.forEach(x => f.append(k, x));
      else f.set(k, v);
    }
    sp.set('filters', f.toString());
  }
  return `/api/orders/export?${sp.toString()}`;
}

function filenameFrom(res: Response, format: Format): string {
  const cd = res.headers.get('Content-Disposition') || '';
  const m = /filename="?([^";]+)"?/i.exec(cd);
  if (m?.[1]) return m[1];
  return `orders-${new Date().toISOString().slice(0, 10)}.${format}`;
}

/**
 * Export button + menu (CSV / Excel / PDF × selected / all matching filters).
 * Desktop: anchored menu. Mobile: bottom sheet with 44px rows.
 *
 * The file is fetched (POST, JSON — 1000 ids do not fit in a URL) and saved
 * through a blob <a download>. On iOS / WebViews (gesture-sensitive) the GET
 * endpoint is navigated to synchronously from the tap when the URL is short
 * enough; see needsGestureDownload. A download is not a pop-up, so blockers do not
 * apply, and server errors (413 too many, 401) surface as toasts instead of a
 * downloaded error page.
 */
export default function ExportMenu({ selectedIds, filters, matchingTotal, variant = 'button' }: ExportMenuProps) {
  const t = useTranslations('labels');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const locale = useLocaleStore(s => s.locale);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const selectedCount = selectedIds.length;
  const total = typeof matchingTotal === 'number' ? matchingTotal : null;
  const selectedTooMany = selectedCount > EXPORT_MAX;
  const filtersTooMany = total !== null && total > EXPORT_MAX;
  const filtersEmpty = total === 0;

  const close = () => {
    setAnchor(null);
    setSheetOpen(false);
  };

  const run = async (format: Format, scope: Scope) => {
    close();
    if (busy) return;
    const count = scope === 'selected' ? selectedCount : total;
    if (count !== null && count > EXPORT_MAX) {
      notify.error(new Error(''), t('export.tooMany', { max: EXPORT_MAX }));
      return;
    }
    let timeZone: string | undefined;
    try { timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* default on server */ }
    const target = scope === 'selected' ? { ids: selectedIds } : { filters: cleanFilters(filters) };

    // Synchronous, still inside the tap: no await before the navigation.
    if (needsGestureDownload()) {
      const url = buildGetUrl({ format, locale, tz: timeZone, ...target });
      if (url.length <= MAX_GET_URL) {
        notify.info(t('export.preparing', { count: count ?? 0 }));
        window.location.assign(url);
        return;
      }
      // Too long for a URL (large selection): fall through to fetch + blob.
    }

    setBusy(true);
    const large = count === null || count > LARGE_EXPORT;
    const toastId = large ? toast.loading(t('export.preparing', { count: count ?? 0 })) : undefined;
    try {
      const body = { format, locale, tz: timeZone, ...target };
      const res = await fetch('/api/orders/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        if (res.status === 413) {
          notify.error(new Error(''), t('export.tooMany', { max: EXPORT_MAX }));
        } else {
          notify.error(new Error(''), t('export.failed'));
        }
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
      // iOS Safari reads the blob after click returns; revoke later.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      if (exported === 0) notify.info(t('export.empty'));
      else notify.success(t('export.done', { count: exported }));
    } catch (err) {
      notify.error(err, t('export.failed'));
    } finally {
      if (toastId) toast.dismiss(toastId);
      setBusy(false);
    }
  };

  const itemSx = { minHeight: 44 } as const;

  const section = (scope: Scope) => {
    const isSel = scope === 'selected';
    const disabled = busy || (isSel ? selectedTooMany || selectedCount === 0 : filtersTooMany || filtersEmpty);
    const title = isSel
      ? t('export.selected', { count: selectedCount })
      : total !== null
        ? t('export.allMatchingCount', { count: total })
        : t('export.allMatching');
    const hint = isSel
      ? (selectedTooMany ? t('export.tooMany', { max: EXPORT_MAX }) : null)
      : (filtersTooMany ? t('export.tooMany', { max: EXPORT_MAX }) : filtersEmpty ? t('export.empty') : null);
    return [
      <ListSubheader key={`${scope}-h`} sx={{ lineHeight: '32px', bgcolor: 'background.paper', fontWeight: 700, fontSize: '0.75rem' }}>
        {title}
      </ListSubheader>,
      hint ? (
        <Typography key={`${scope}-hint`} variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pb: 0.5, maxWidth: 280 }}>
          {hint}
        </Typography>
      ) : null,
      ...FORMATS.map(f => (
        <MenuItem key={`${scope}-${f.format}`} disabled={disabled} onClick={() => run(f.format, scope)} sx={itemSx}>
          <ListItemIcon>{f.icon}</ListItemIcon>
          <ListItemText primary={t(`export.${f.key}`)} primaryTypographyProps={{ fontSize: '0.85rem' }} />
        </MenuItem>
      )),
    ];
  };

  const content = [
    ...(selectedCount > 0 ? [...section('selected'), <Divider key="div" />] : []),
    ...section('filters'),
  ];

  const open = (e: React.MouseEvent<HTMLElement>) => {
    if (isMobile) setSheetOpen(true);
    else setAnchor(e.currentTarget);
  };

  return (
    <>
      <Button
        size="small"
        variant={variant === 'chip' ? 'contained' : 'outlined'}
        color={variant === 'chip' ? 'inherit' : 'primary'}
        startIcon={<FileDownloadRoundedIcon />}
        onClick={open}
        disabled={busy}
        aria-haspopup="menu"
        aria-label={t('export.button')}
        sx={{
          textTransform: 'none',
          minHeight: { xs: 44, md: 32 },
          ...(variant === 'chip' ? { borderRadius: 999, bgcolor: 'background.paper', boxShadow: 3, px: 1.75 } : {}),
        }}
      >
        {busy ? t('export.preparingShort') : t('export.button')}
      </Button>

      {!isMobile && (
        <Menu
          anchorEl={anchor}
          open={!!anchor}
          onClose={close}
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          sx={{ zIndex: 1500 }}
          MenuListProps={{ dense: true, sx: { minWidth: 240 } }}
        >
          {content}
        </Menu>
      )}

      {isMobile && (
        <Drawer
          anchor="bottom"
          open={sheetOpen}
          onClose={close}
          sx={{ zIndex: 1500 }}
          PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '85vh', pb: 'env(safe-area-inset-bottom)' } }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'center', pt: 1 }}>
            <Box sx={{ width: 36, height: 4, borderRadius: 2, bgcolor: 'divider' }} />
          </Box>
          <Typography variant="subtitle1" fontWeight={700} sx={{ px: 2, pt: 1 }}>
            {t('export.title')}
          </Typography>
          <Box role="menu" sx={{ py: 1 }}>{content}</Box>
          <Box sx={{ px: 2, pb: 1.5 }}>
            <Button fullWidth onClick={close} sx={{ minHeight: 44, textTransform: 'none' }}>
              {t('export.cancel')}
            </Button>
          </Box>
        </Drawer>
      )}
    </>
  );
}
