import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  RadioGroup,
  Radio,
  FormControlLabel,
  LinearProgress,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  SwipeableDrawer,
  List,
  ListItem,
  ListItemButton,
  useMediaQuery,
  useTheme,
  Divider,
  IconButton,
  Tooltip,
  Chip,
  Alert,
} from '@mui/material';
import {
  AttachMoneyOutlined,
  Inventory2Outlined,
  ArchiveOutlined,
  UnarchiveOutlined,
  AutoFixHigh,
  FileDownload as FileDownloadIcon,
  DataObject as DataObjectIcon,
  FindReplace as FindReplaceIcon,
  ContentCopy as DuplicateIcon,
  MoreHoriz as MoreHorizIcon,
  Close as CloseIcon,
  TitleOutlined,
  DescriptionOutlined,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';

// --- Types ---

interface TrendyolProduct {
  id: string;
  barcode: string;
  title: string;
  listPrice: any;
  salePrice: any;
  quantity: number;
  stockCode: string;
  description: string;
  brandName: string;
  categoryName: string;
}

interface TrendyolBulkOpsBarProps {
  selectedProducts: TrendyolProduct[];
  onClearSelection: () => void;
  onRefresh: () => void;
  allProducts: Array<any>;
  onOpenFindReplace?: () => void;
}

type PriceMode = 'percent_increase' | 'percent_decrease' | 'fixed_add' | 'fixed_subtract';

type BatchKind = 'price' | 'stock' | 'archive' | 'unarchive';

interface BatchFailure {
  barcode: string;
  title: string;
  reasons: string[];
}

interface BatchSummary {
  kind: BatchKind;
  total: number;
  succeededBarcodes: string[];
  failures: BatchFailure[];
  /** Items Trendyol had not reported on when we stopped polling. */
  pending: number;
  timedOut: boolean;
}

const BATCH_POLL_MS = 3000;
const BATCH_MAX_POLLS = 100; // ~5 minutes
const BATCH_MAX_CONSECUTIVE_FAILURES = 5;
// Bulk AI title/description optimize only fetches suggestions from
// /api/ai/trendyol and has no review/apply step, so it changes nothing while
// reporting success. Hidden until a review-and-stage flow exists.
const BULK_AI_OPTIMIZE_ENABLED = false;

const TRENDYOL_ORANGE = '#F27A1A';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Safely parse Prisma Decimal or number to float */
function toFloat(value: any): number {
  if (value == null) return 0;
  return parseFloat(String(value));
}

/** Jaccard similarity between two sets of tokens */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Tokenize a title for duplicate detection (Turkish-aware) */
function tokenize(title: string): Set<string> {
  return new Set(
    title
      .toLocaleLowerCase('tr-TR')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .split(/\s+/)
      .filter((t) => t.length > 1)
  );
}

/** Turn Trendyol failureReasons (strings or objects) into short safe strings. */
function reasonToString(r: unknown): string | null {
  if (r == null) return null;
  if (typeof r === 'string') return r.trim().slice(0, 300) || null;
  if (typeof r === 'number') return String(r);
  if (typeof r === 'object') {
    const o = r as Record<string, unknown>;
    for (const k of ['message', 'reason', 'description', 'errorMessage', 'key']) {
      if (typeof o[k] === 'string' && (o[k] as string).trim()) return (o[k] as string).trim().slice(0, 300);
    }
  }
  return null;
}

function itemBarcode(item: any): string {
  const ri = item?.requestItem;
  const v = ri?.barcode ?? ri?.product?.barcode ?? item?.barcode ?? '';
  return typeof v === 'string' ? v : String(v || '');
}

/** Build a per-item summary from a Trendyol batch-request result. */
function summarizeBatch(
  data: any,
  submittedBarcodes: string[],
  titleByBarcode: Map<string, string>
): BatchSummary {
  const resultItems: any[] = Array.isArray(data?.items) ? data.items : [];
  const succeeded = new Set<string>();
  const failures: BatchFailure[] = [];

  for (const it of resultItems) {
    const barcode = itemBarcode(it);
    const status = String(it?.status || '').toUpperCase();
    if (status === 'SUCCESS') {
      if (barcode) succeeded.add(barcode);
    } else if (status === 'FAILED') {
      const raw: unknown[] = Array.isArray(it?.failureReasons) ? it.failureReasons : [];
      const reasons = raw.map(reasonToString).filter((x): x is string => Boolean(x));
      failures.push({ barcode, title: titleByBarcode.get(barcode) || '', reasons });
    }
  }

  // Whole batch failed without per-item detail.
  const batchStatus = String(data?.status ?? data?.batchRequestStatus ?? '').toUpperCase();
  if (resultItems.length === 0 && batchStatus === 'FAILED') {
    for (const b of submittedBarcodes) failures.push({ barcode: b, title: titleByBarcode.get(b) || '', reasons: [] });
  }

  // Anything submitted that is not yet final (unreported or reported with a
  // non-final status) is still processing.
  const failedSet = new Set(failures.map((f) => f.barcode));
  const pending = submittedBarcodes.filter((b) => !succeeded.has(b) && !failedSet.has(b)).length;

  return {
    kind: 'price',
    total: submittedBarcodes.length,
    succeededBarcodes: Array.from(succeeded),
    failures,
    pending,
    timedOut: false,
  };
}

// --- Component ---

export default function TrendyolBulkOpsBar({
  selectedProducts,
  onClearSelection,
  onRefresh,
  allProducts,
  onOpenFindReplace,
}: TrendyolBulkOpsBarProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations('trendyolListings');

  const selectedCount = selectedProducts.length;
  const hasSelection = selectedCount > 0;

  // --- Dialog states ---
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [unarchiveDialogOpen, setUnarchiveDialogOpen] = useState(false);
  const [aiTitleDialogOpen, setAiTitleDialogOpen] = useState(false);
  const [aiDescDialogOpen, setAiDescDialogOpen] = useState(false);
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);

  // --- Price state ---
  const [priceMode, setPriceMode] = useState<PriceMode>('percent_increase');
  const [priceAmount, setPriceAmount] = useState('');

  // --- Stock state ---
  const [stockQuantity, setStockQuantity] = useState('');

  // --- Processing state ---
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [progressIndeterminate, setProgressIndeterminate] = useState(false);
  const [batchResult, setBatchResult] = useState<BatchSummary | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // --- AI state ---
  const [aiResult, setAiResult] = useState<{ success: number; failed: number } | null>(null);

  // --- Duplicate state ---
  const [duplicateMatches, setDuplicateMatches] = useState<
    Array<{ a: TrendyolProduct; b: TrendyolProduct; score: number }>
  >([]);

  // --- Menu state ---
  const [moreMenuAnchor, setMoreMenuAnchor] = useState<null | HTMLElement>(null);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  // --- Price preview ---
  const pricePreview = useMemo(() => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) return [];
    return selectedProducts.slice(0, 5).map((p) => {
      const currentList = toFloat(p.listPrice);
      const currentSale = toFloat(p.salePrice);
      const calcNew = (current: number) => {
        let newPrice: number;
        switch (priceMode) {
          case 'percent_increase': newPrice = current * (1 + amt / 100); break;
          case 'percent_decrease': newPrice = current * (1 - amt / 100); break;
          case 'fixed_add': newPrice = current + amt; break;
          case 'fixed_subtract': newPrice = current - amt; break;
        }
        return Math.max(0, Math.round(newPrice * 100) / 100);
      };
      return {
        title: p.title.length > 40 ? p.title.slice(0, 40) + '...' : p.title,
        currentList,
        currentSale,
        newList: calcNew(currentList),
        newSale: calcNew(currentSale),
      };
    });
  }, [selectedProducts, priceMode, priceAmount]);

  // --- Handlers ---

  // --- Batch submit + poll ---

  /**
   * Submit a Trendyol batch, poll its result (same endpoint the editor drawer
   * polls), then mirror successful items into the local cache and refresh.
   * Trendyol is only touched here, after the user confirmed a dialog.
   */
  const runBatch = async ({
    kind,
    action,
    items,
    label,
    failKey,
  }: {
    kind: BatchKind;
    action: 'update_price_inventory' | 'archive';
    items: Array<Record<string, any> & { barcode: string }>;
    label: string;
    failKey: string;
  }) => {
    setProcessing(true);
    setProgress(0);
    setProgressIndeterminate(true);
    setProgressLabel(label);
    setBatchResult(null);

    const titleByBarcode = new Map(selectedProducts.map((p) => [p.barcode, p.title]));
    const itemByBarcode = new Map(items.map((it) => [it.barcode, it]));

    let batchRequestId: string | null = null;
    try {
      const res = await fetch(`/api/trendyol/products?action=${action}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        notify.error({ status: res.status, data }, `trendyolListings.${failKey}`);
        return;
      }
      batchRequestId = typeof data?.batchRequestId === 'string' && data.batchRequestId ? data.batchRequestId : null;
      if (!batchRequestId) {
        notify.error(null, `trendyolListings.${failKey}`);
        return;
      }
    } catch (err) {
      notify.error(err, `trendyolListings.${failKey}`);
      return;
    } finally {
      if (!batchRequestId && mountedRef.current) {
        setProcessing(false);
        setProgressIndeterminate(false);
      }
    }

    setProgressLabel(t('batchPolling', { count: items.length }));

    // Poll every 3s for up to ~5 minutes. Polling (and the cache write below)
    // keeps going if the page unmounts — the batch is already at Trendyol and
    // the cache should still get the accepted values; only setState is skipped.
    let finalData: any = null;
    let timedOut = true;
    let consecutiveFailures = 0;
    for (let attempt = 0; attempt < BATCH_MAX_POLLS; attempt++) {
      await delay(attempt === 0 ? 1500 : BATCH_POLL_MS);
      try {
        const res = await fetch(
          `/api/trendyol/products?action=batch_status&batchRequestId=${encodeURIComponent(batchRequestId)}`
        );
        if (!res.ok) {
          // Permanent client errors (unknown batch, expired session, limit):
          // stop instead of spinning for 5 minutes. notify skips 402s.
          if (res.status >= 400 && res.status < 500 && res.status !== 429) {
            const body = await res.json().catch(() => ({}));
            if (mountedRef.current) notify.error({ status: res.status, data: body }, `trendyolListings.${failKey}`);
            break;
          }
          if (++consecutiveFailures >= BATCH_MAX_CONSECUTIVE_FAILURES) break;
          continue;
        }
        consecutiveFailures = 0;
        const data = await res.json();
        finalData = data;
        const resultItems: any[] = Array.isArray(data?.items) ? data.items : [];
        const total = Number(data?.itemCount) || resultItems.length || items.length;
        const done = resultItems.filter((it) => {
          const s = String(it?.status || '').toUpperCase();
          return s === 'SUCCESS' || s === 'FAILED';
        }).length;
        if (mountedRef.current && total > 0 && resultItems.length > 0) {
          setProgressIndeterminate(false);
          setProgress(Math.min(100, (done / total) * 100));
          setProgressLabel(t('batchProgress', { done, total }));
        }
        const status = String(data?.status ?? data?.batchRequestStatus ?? '').toUpperCase();
        if (status === 'COMPLETED' || status === 'FAILED' || (resultItems.length > 0 && done >= total)) {
          timedOut = false;
          break;
        }
      } catch {
        /* transient network error — keep polling, but not forever */
        if (++consecutiveFailures >= BATCH_MAX_CONSECUTIVE_FAILURES) break;
      }
    }

    const summary = summarizeBatch(finalData, items.map((it) => it.barcode), titleByBarcode);
    summary.kind = kind;
    summary.timedOut = timedOut;

    // Mirror successes into the local cache so the refreshed list shows the
    // values Trendyol accepted (price/stock). Archive state needs a full sync.
    if (kind === 'price' || kind === 'stock') {
      const cacheItems = summary.succeededBarcodes
        .map((b) => itemByBarcode.get(b))
        .filter(Boolean)
        .map((it: any) => ({
          barcode: it.barcode,
          listPrice: it.listPrice,
          salePrice: it.salePrice,
          quantity: it.quantity,
        }));
      if (cacheItems.length > 0) {
        try {
          await fetch('/api/trendyol/products?action=update_cache', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items: cacheItems }),
          });
        } catch {
          /* cache refresh is best-effort; Sync fixes it */
        }
      }
    }

    if (!mountedRef.current) return;
    setProcessing(false);
    setProgressIndeterminate(false);
    setProgress(100);
    setBatchResult(summary);
    onRefresh();
  };

  const handlePriceSubmit = async () => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) { toast.error(t('toastEnterValidAmount')); return; }

    setPriceDialogOpen(false);

    const items = selectedProducts.map((p) => {
      const currentList = toFloat(p.listPrice);
      const currentSale = toFloat(p.salePrice);
      const calcNew = (current: number) => {
        let newPrice: number;
        switch (priceMode) {
          case 'percent_increase': newPrice = current * (1 + amt / 100); break;
          case 'percent_decrease': newPrice = current * (1 - amt / 100); break;
          case 'fixed_add': newPrice = current + amt; break;
          case 'fixed_subtract': newPrice = current - amt; break;
        }
        return Math.max(0.01, Math.round(newPrice * 100) / 100);
      };
      return {
        barcode: p.barcode,
        listPrice: calcNew(currentList),
        salePrice: calcNew(currentSale),
        quantity: p.quantity,
      };
    });

    setPriceAmount('');
    setPriceMode('percent_increase');
    await runBatch({ kind: 'price', action: 'update_price_inventory', items, label: t('updatingPrices'), failKey: 'toastUpdateFailed' });
  };

  const handleStockSubmit = async () => {
    const qty = parseInt(stockQuantity, 10);
    if (isNaN(qty) || qty < 0) { toast.error(t('toastEnterValidQuantity')); return; }

    setStockDialogOpen(false);

    const items = selectedProducts.map((p) => ({
      barcode: p.barcode,
      listPrice: toFloat(p.listPrice),
      salePrice: toFloat(p.salePrice),
      quantity: qty,
    }));

    setStockQuantity('');
    await runBatch({ kind: 'stock', action: 'update_price_inventory', items, label: t('updatingStock'), failKey: 'toastUpdateFailed' });
  };

  const handleArchiveSubmit = async () => {
    setArchiveDialogOpen(false);
    const items = selectedProducts.map((p) => ({ barcode: p.barcode, archived: true }));
    await runBatch({ kind: 'archive', action: 'archive', items, label: t('archiving'), failKey: 'toastArchiveFailed' });
  };

  const handleUnarchiveSubmit = async () => {
    setUnarchiveDialogOpen(false);
    // The API has no separate "unarchive" action; Trendyol's archive endpoint
    // takes archived:false per item.
    const items = selectedProducts.map((p) => ({ barcode: p.barcode, archived: false }));
    await runBatch({ kind: 'unarchive', action: 'archive', items, label: t('unarchiving'), failKey: 'toastUnarchiveFailed' });
  };

  const handleAiOptimizeTitles = async () => {
    setAiTitleDialogOpen(false);
    setProcessing(true);
    setProgress(0);
    setProgressLabel(t('aiOptimizingTitles'));
    setAiResult(null);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < selectedProducts.length; i++) {
      const product = selectedProducts[i];
      try {
        const res = await fetch('/api/ai/trendyol?action=optimize_title', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            barcode: product.barcode,
            title: product.title,
            brandName: product.brandName,
            categoryName: product.categoryName,
          }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
      setProgress(((i + 1) / selectedProducts.length) * 100);
      setProgressLabel(t('processingProgress', { current: i + 1, total: selectedProducts.length }));
      if (i < selectedProducts.length - 1) await delay(200);
    }

    setAiResult({ success, failed });
    setProcessing(false);

    if (failed === 0) {
      toast.success(t('toastAiSuccess', { count: success }));
    } else {
      toast.error(t('toastAiPartial', { succeeded: success, failed }));
    }

    onRefresh();
  };

  const handleAiOptimizeDescriptions = async () => {
    setAiDescDialogOpen(false);
    setProcessing(true);
    setProgress(0);
    setProgressLabel(t('aiOptimizingDescriptions'));
    setAiResult(null);

    let success = 0;
    let failed = 0;

    for (let i = 0; i < selectedProducts.length; i++) {
      const product = selectedProducts[i];
      try {
        const res = await fetch('/api/ai/trendyol?action=optimize_description', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            barcode: product.barcode,
            title: product.title,
            description: product.description,
            brandName: product.brandName,
            categoryName: product.categoryName,
          }),
        });
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
      setProgress(((i + 1) / selectedProducts.length) * 100);
      setProgressLabel(t('processingProgress', { current: i + 1, total: selectedProducts.length }));
      if (i < selectedProducts.length - 1) await delay(200);
    }

    setAiResult({ success, failed });
    setProcessing(false);

    if (failed === 0) {
      toast.success(t('toastAiSuccess', { count: success }));
    } else {
      toast.error(t('toastAiPartial', { succeeded: success, failed }));
    }

    onRefresh();
  };

  const handleExportCSV = () => {
    if (selectedProducts.length === 0) return;
    const headers = ['barcode', 'title', 'brand', 'category', 'listPrice', 'salePrice', 'quantity', 'stockCode'];
    const rows = selectedProducts.map((p) =>
      [
        p.barcode,
        `"${p.title.replace(/"/g, '""')}"`,
        `"${(p.brandName || '').replace(/"/g, '""')}"`,
        `"${(p.categoryName || '').replace(/"/g, '""')}"`,
        toFloat(p.listPrice).toFixed(2),
        toFloat(p.salePrice).toFixed(2),
        p.quantity,
        p.stockCode || '',
      ].join(',')
    );
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trendyol-products-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('toastExported', { count: selectedProducts.length }));
  };

  const handleExportJSON = () => {
    if (selectedProducts.length === 0) return;
    const data = selectedProducts.map((p) => ({
      barcode: p.barcode,
      stockCode: p.stockCode,
      title: p.title,
      description: p.description,
      brandName: p.brandName,
      categoryName: p.categoryName,
      listPrice: toFloat(p.listPrice),
      salePrice: toFloat(p.salePrice),
      quantity: p.quantity,
    }));
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trendyol-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(t('toastExportedJson', { count: selectedProducts.length }));
  };

  const handleDuplicateDetect = () => {
    const products = selectedProducts.length > 1 ? selectedProducts : allProducts;
    const tokenized = products.map((p) => ({
      product: p,
      tokens: tokenize(p.title || ''),
    }));

    const matches: Array<{ a: TrendyolProduct; b: TrendyolProduct; score: number }> = [];

    for (let i = 0; i < tokenized.length; i++) {
      for (let j = i + 1; j < tokenized.length; j++) {
        const score = jaccardSimilarity(tokenized[i].tokens, tokenized[j].tokens);
        if (score >= 0.6) {
          matches.push({
            a: tokenized[i].product,
            b: tokenized[j].product,
            score: Math.round(score * 100),
          });
        }
      }
    }

    matches.sort((a, b) => b.score - a.score);
    setDuplicateMatches(matches);
    setDuplicateDialogOpen(true);
  };

  const isProcessing = processing;
  const currentProgress = progress;

  // --- Shared button style ---
  const btnSx = {
    minHeight: 36,
    textTransform: 'none' as const,
    fontWeight: 600,
    borderRadius: '8px',
    fontSize: '0.82rem',
    px: isMobile ? 1 : 2,
  };

  const trendyolBtnSx = {
    ...btnSx,
    borderColor: TRENDYOL_ORANGE,
    color: TRENDYOL_ORANGE,
    '&:hover': {
      borderColor: TRENDYOL_ORANGE,
      bgcolor: `${TRENDYOL_ORANGE}10`,
    },
  };

  if (!hasSelection && !isProcessing && !batchResult) return null;

  // --- More menu items ---
  const moreMenuItems = [
    ...(BULK_AI_OPTIMIZE_ENABLED ? [
      {
        icon: <TitleOutlined fontSize="small" sx={{ color: TRENDYOL_ORANGE }} />,
        label: t('aiOptimizeTitles'),
        onClick: () => { setAiResult(null); setAiTitleDialogOpen(true); },
      },
      {
        icon: <DescriptionOutlined fontSize="small" sx={{ color: TRENDYOL_ORANGE }} />,
        label: t('aiOptimizeDescriptions'),
        onClick: () => { setAiResult(null); setAiDescDialogOpen(true); },
      },
      { divider: true },
    ] : []),
    {
      icon: <UnarchiveOutlined fontSize="small" />,
      label: t('unarchive'),
      onClick: () => setUnarchiveDialogOpen(true),
    },
    { divider: true },
    {
      icon: <FileDownloadIcon fontSize="small" />,
      label: t('exportCsv'),
      onClick: handleExportCSV,
    },
    {
      icon: <DataObjectIcon fontSize="small" />,
      label: t('exportJson'),
      onClick: handleExportJSON,
    },
    { divider: true },
    {
      icon: <FindReplaceIcon fontSize="small" />,
      label: t('findReplace.title'),
      onClick: () => onOpenFindReplace?.(),
    },
    {
      icon: <DuplicateIcon fontSize="small" />,
      label: t('duplicateDetector'),
      onClick: handleDuplicateDetect,
    },
  ];

  return (
    <>
      {/* Processing overlay */}
      {isProcessing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
            bgcolor: 'white',
            borderTop: `2px solid ${TRENDYOL_ORANGE}`,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1, fontWeight: 600 }}>
            {progressLabel}
          </Typography>
          <LinearProgress
            variant={progressIndeterminate ? 'indeterminate' : 'determinate'}
            value={currentProgress}
            sx={{
              height: 6,
              borderRadius: 3,
              '& .MuiLinearProgress-bar': { bgcolor: TRENDYOL_ORANGE },
            }}
          />
          {!progressIndeterminate && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              {Math.round(currentProgress)}%
            </Typography>
          )}
        </Paper>
      )}

      {/* Fixed bottom bar */}
      {!isProcessing && hasSelection && (
        isMobile ? (
          // Mobile: SwipeableDrawer trigger bar
          <Paper
            elevation={8}
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1300,
              px: 2,
              py: 1.5,
              bgcolor: 'white',
              borderTop: `2px solid ${TRENDYOL_ORANGE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={t('selectedCount', { count: selectedCount })}
                size="small"
                sx={{ bgcolor: TRENDYOL_ORANGE, color: 'white', fontWeight: 700 }}
              />
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Button
                size="small"
                variant="outlined"
                sx={trendyolBtnSx}
                onClick={() => setPriceDialogOpen(true)}
              >
                <AttachMoneyOutlined fontSize="small" />
              </Button>
              <Button
                size="small"
                variant="outlined"
                sx={trendyolBtnSx}
                onClick={() => setStockDialogOpen(true)}
              >
                <Inventory2Outlined fontSize="small" />
              </Button>
              <Button
                size="small"
                variant="outlined"
                sx={trendyolBtnSx}
                onClick={() => setArchiveDialogOpen(true)}
              >
                <ArchiveOutlined fontSize="small" />
              </Button>
              <IconButton
                size="small"
                onClick={() => setMobileDrawerOpen(true)}
                sx={{
                  border: '1px solid',
                  borderColor: 'divider',
                  borderRadius: '8px',
                  width: 36,
                  height: 36,
                }}
              >
                <MoreHorizIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" onClick={onClearSelection}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Box>
          </Paper>
        ) : (
          // Desktop: Fixed bottom bar
          <Paper
            elevation={8}
            sx={{
              position: 'fixed',
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 1300,
              px: 3,
              py: 1.5,
              bgcolor: 'white',
              borderTop: `2px solid ${TRENDYOL_ORANGE}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Chip
                label={t('selectedCount', { count: selectedCount })}
                size="small"
                sx={{ bgcolor: TRENDYOL_ORANGE, color: 'white', fontWeight: 700, fontSize: '0.85rem' }}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
              {/* Price */}
              <Tooltip title={t('bulkPriceChange')}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AttachMoneyOutlined />}
                  onClick={() => setPriceDialogOpen(true)}
                  disabled={isProcessing}
                  sx={trendyolBtnSx}
                >
                  {t('priceBtn')}
                </Button>
              </Tooltip>

              {/* Stock */}
              <Tooltip title={t('bulkStockUpdate')}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<Inventory2Outlined />}
                  onClick={() => setStockDialogOpen(true)}
                  disabled={isProcessing}
                  sx={trendyolBtnSx}
                >
                  {t('stockBtn')}
                </Button>
              </Tooltip>

              {/* Archive */}
              <Tooltip title={t('archive')}>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<ArchiveOutlined />}
                  onClick={() => setArchiveDialogOpen(true)}
                  disabled={isProcessing}
                  sx={trendyolBtnSx}
                >
                  {t('archiveBtn')}
                </Button>
              </Tooltip>

              {/* More actions */}
              <Tooltip title={t('moreActions')}>
                <IconButton
                  size="small"
                  disabled={isProcessing}
                  onClick={(e) => setMoreMenuAnchor(e.currentTarget)}
                  sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: '8px',
                    width: 36,
                    height: 36,
                  }}
                >
                  <MoreHorizIcon fontSize="small" />
                </IconButton>
              </Tooltip>

              {/* Close selection */}
              <Tooltip title={t('clearSelection')}>
                <IconButton size="small" onClick={onClearSelection}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          </Paper>
        )
      )}

      {/* Desktop more menu */}
      <Menu
        anchorEl={moreMenuAnchor}
        open={Boolean(moreMenuAnchor)}
        onClose={() => setMoreMenuAnchor(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        {moreMenuItems.map((item, idx) =>
          'divider' in item && item.divider ? (
            <Divider key={`divider-${idx}`} />
          ) : (
            <MenuItem
              key={idx}
              onClick={() => {
                setMoreMenuAnchor(null);
                (item as any).onClick?.();
              }}
            >
              <ListItemIcon>{(item as any).icon}</ListItemIcon>
              <ListItemText>{(item as any).label}</ListItemText>
            </MenuItem>
          )
        )}
      </Menu>

      {/* Mobile overflow drawer */}
      <SwipeableDrawer
        anchor="bottom"
        open={mobileDrawerOpen}
        onClose={() => setMobileDrawerOpen(false)}
        onOpen={() => setMobileDrawerOpen(true)}
        sx={{ zIndex: 1400 }}
        PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, pb: 2, maxHeight: '70vh' } }}
      >
        <Box sx={{ width: 40, height: 4, bgcolor: 'grey.400', borderRadius: 2, mx: 'auto', mt: 1.5, mb: 1 }} />
        <Typography variant="subtitle2" sx={{ px: 2, pb: 1, fontWeight: 700, color: TRENDYOL_ORANGE }}>
          {t('quickActions')}
        </Typography>
        <List>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setPriceDialogOpen(true); }}>
              <ListItemIcon><AttachMoneyOutlined sx={{ color: TRENDYOL_ORANGE }} /></ListItemIcon>
              <ListItemText primary={t('bulkPriceChange')} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setStockDialogOpen(true); }}>
              <ListItemIcon><Inventory2Outlined sx={{ color: TRENDYOL_ORANGE }} /></ListItemIcon>
              <ListItemText primary={t('bulkStockUpdate')} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setArchiveDialogOpen(true); }}>
              <ListItemIcon><ArchiveOutlined /></ListItemIcon>
              <ListItemText primary={t('archive')} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); setUnarchiveDialogOpen(true); }}>
              <ListItemIcon><UnarchiveOutlined /></ListItemIcon>
              <ListItemText primary={t('unarchive')} />
            </ListItemButton>
          </ListItem>
          {BULK_AI_OPTIMIZE_ENABLED && (
            <>
              <Divider sx={{ my: 0.5 }} />
              <ListItem disablePadding>
                <ListItemButton onClick={() => { setMobileDrawerOpen(false); setAiResult(null); setAiTitleDialogOpen(true); }}>
                  <ListItemIcon><TitleOutlined sx={{ color: TRENDYOL_ORANGE }} /></ListItemIcon>
                  <ListItemText primary={t('aiOptimizeTitles')} />
                </ListItemButton>
              </ListItem>
              <ListItem disablePadding>
                <ListItemButton onClick={() => { setMobileDrawerOpen(false); setAiResult(null); setAiDescDialogOpen(true); }}>
                  <ListItemIcon><DescriptionOutlined sx={{ color: TRENDYOL_ORANGE }} /></ListItemIcon>
                  <ListItemText primary={t('aiOptimizeDescriptions')} />
                </ListItemButton>
              </ListItem>
            </>
          )}
          <Divider sx={{ my: 0.5 }} />
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); handleExportCSV(); }}>
              <ListItemIcon><FileDownloadIcon /></ListItemIcon>
              <ListItemText primary={t('exportCsv')} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); handleExportJSON(); }}>
              <ListItemIcon><DataObjectIcon /></ListItemIcon>
              <ListItemText primary={t('exportJson')} />
            </ListItemButton>
          </ListItem>
          <Divider sx={{ my: 0.5 }} />
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); onOpenFindReplace?.(); }}>
              <ListItemIcon><FindReplaceIcon /></ListItemIcon>
              <ListItemText primary={t('findReplace.title')} />
            </ListItemButton>
          </ListItem>
          <ListItem disablePadding>
            <ListItemButton onClick={() => { setMobileDrawerOpen(false); handleDuplicateDetect(); }}>
              <ListItemIcon><DuplicateIcon /></ListItemIcon>
              <ListItemText primary={t('duplicateDetector')} />
            </ListItemButton>
          </ListItem>
        </List>
      </SwipeableDrawer>

      {/* ---- Dialogs ---- */}

      {/* Price Dialog */}
      <Dialog open={priceDialogOpen} onClose={() => setPriceDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AttachMoneyOutlined sx={{ color: TRENDYOL_ORANGE }} />
          {t('bulkPriceChange')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('trendyolAsyncNote')}
          </Alert>
          <RadioGroup value={priceMode} onChange={(e) => setPriceMode(e.target.value as PriceMode)}>
            <FormControlLabel value="percent_increase" control={<Radio sx={{ '&.Mui-checked': { color: TRENDYOL_ORANGE } }} />} label={t('pricePercentIncrease')} />
            <FormControlLabel value="percent_decrease" control={<Radio sx={{ '&.Mui-checked': { color: TRENDYOL_ORANGE } }} />} label={t('pricePercentDecrease')} />
            <FormControlLabel value="fixed_add" control={<Radio sx={{ '&.Mui-checked': { color: TRENDYOL_ORANGE } }} />} label={t('priceFixedAdd')} />
            <FormControlLabel value="fixed_subtract" control={<Radio sx={{ '&.Mui-checked': { color: TRENDYOL_ORANGE } }} />} label={t('priceFixedSubtract')} />
          </RadioGroup>
          <TextField
            label={priceMode.startsWith('percent') ? t('pricePercentageLabel') : t('priceAmountLabel')}
            type="number"
            value={priceAmount}
            onChange={(e) => setPriceAmount(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
            inputProps={{ min: 0, step: 0.01 }}
          />
          {pricePreview.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('pricePreview')} ({pricePreview.length})
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('tableProduct')}</TableCell>
                      <TableCell align="right">{t('tableCurrentList')}</TableCell>
                      <TableCell align="right">{t('tableNewList')}</TableCell>
                      <TableCell align="right">{t('tableCurrentSale')}</TableCell>
                      <TableCell align="right">{t('tableNewSale')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pricePreview.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {p.title}
                        </TableCell>
                        <TableCell align="right">{p.currentList.toFixed(2)} TL</TableCell>
                        <TableCell align="right" sx={{ color: p.newList !== p.currentList ? TRENDYOL_ORANGE : 'inherit', fontWeight: 600 }}>
                          {p.newList.toFixed(2)} TL
                        </TableCell>
                        <TableCell align="right">{p.currentSale.toFixed(2)} TL</TableCell>
                        <TableCell align="right" sx={{ color: p.newSale !== p.currentSale ? TRENDYOL_ORANGE : 'inherit', fontWeight: 600 }}>
                          {p.newSale.toFixed(2)} TL
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPriceDialogOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="contained"
            onClick={handlePriceSubmit}
            disabled={!priceAmount || parseFloat(priceAmount) <= 0}
            sx={{ bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#D96A15' } }}
          >
            {t('apply')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stock Dialog */}
      <Dialog open={stockDialogOpen} onClose={() => setStockDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Inventory2Outlined sx={{ color: TRENDYOL_ORANGE }} />
          {t('bulkStockUpdate')}
        </DialogTitle>
        <DialogContent>
          <Alert severity="info" sx={{ mb: 2 }}>
            {t('trendyolAsyncNote')}
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('stockHelperText', { count: selectedCount })}
          </Typography>
          <TextField
            label={t('newQuantity')}
            type="number"
            value={stockQuantity}
            onChange={(e) => setStockQuantity(e.target.value)}
            fullWidth
            inputProps={{ min: 0, step: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStockDialogOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleStockSubmit}
            disabled={stockQuantity === '' || parseInt(stockQuantity, 10) < 0 || isNaN(parseInt(stockQuantity, 10))}
            sx={{ bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#D96A15' } }}
          >
            {t('apply')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Archive Confirmation */}
      <Dialog open={archiveDialogOpen} onClose={() => setArchiveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ArchiveOutlined />
          {t('confirmArchive')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('confirmArchiveText', { count: selectedCount })}
          </Typography>
          <Alert severity="warning" sx={{ mt: 2 }}>
            {t('trendyolAsyncNote')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setArchiveDialogOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="contained"
            color="warning"
            onClick={handleArchiveSubmit}
          >
            {t('archiveBtn')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Unarchive Confirmation */}
      <Dialog open={unarchiveDialogOpen} onClose={() => setUnarchiveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <UnarchiveOutlined />
          {t('confirmUnarchive')}
        </DialogTitle>
        <DialogContent>
          <Typography>
            {t('confirmUnarchiveText', { count: selectedCount })}
          </Typography>
          <Alert severity="info" sx={{ mt: 2 }}>
            {t('trendyolAsyncNote')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnarchiveDialogOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleUnarchiveSubmit}
            sx={{ bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#D96A15' } }}
          >
            {t('unarchiveBtn')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Optimize Titles Dialog */}
      <Dialog open={aiTitleDialogOpen} onClose={() => setAiTitleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHigh sx={{ color: TRENDYOL_ORANGE }} />
          {t('aiOptimizeTitles')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('aiOptimizeTitlesDesc', { count: selectedCount })}
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">- {t('aiTitleBenefit1')}</Typography>
            <Typography variant="body2" color="text.secondary">- {t('aiTitleBenefit2')}</Typography>
            <Typography variant="body2" color="text.secondary">- {t('aiTitleBenefit3')}</Typography>
          </Box>
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('aiOptimizeWarning')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiTitleDialogOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="contained"
            startIcon={<AutoFixHigh />}
            onClick={handleAiOptimizeTitles}
            sx={{ bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#D96A15' } }}
          >
            {t('optimize')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* AI Optimize Descriptions Dialog */}
      <Dialog open={aiDescDialogOpen} onClose={() => setAiDescDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <AutoFixHigh sx={{ color: TRENDYOL_ORANGE }} />
          {t('aiOptimizeDescriptions')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('aiOptimizeDescriptionsDesc', { count: selectedCount })}
          </Typography>
          <Box sx={{ pl: 2, mb: 2 }}>
            <Typography variant="body2" color="text.secondary">- {t('aiDescBenefit1')}</Typography>
            <Typography variant="body2" color="text.secondary">- {t('aiDescBenefit2')}</Typography>
            <Typography variant="body2" color="text.secondary">- {t('aiDescBenefit3')}</Typography>
          </Box>
          <Alert severity="warning" sx={{ mt: 1 }}>
            {t('aiOptimizeWarning')}
          </Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAiDescDialogOpen(false)}>{t('cancel')}</Button>
          <Button
            variant="contained"
            startIcon={<AutoFixHigh />}
            onClick={handleAiOptimizeDescriptions}
            sx={{ bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#D96A15' } }}
          >
            {t('optimize')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Duplicate Detector Dialog */}
      <Dialog
        open={duplicateDialogOpen}
        onClose={() => setDuplicateDialogOpen(false)}
        maxWidth="md"
        fullWidth
        PaperProps={{ sx: { maxHeight: '80vh' } }}
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <DuplicateIcon />
          {t('duplicateDetector')}
        </DialogTitle>
        <DialogContent>
          {duplicateMatches.length === 0 ? (
            <Alert severity="success" sx={{ mt: 1 }}>
              {t('noDuplicatesFound')}
            </Alert>
          ) : (
            <>
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t('duplicatesFound', { count: duplicateMatches.length })}
              </Alert>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('tableProductA')}</TableCell>
                      <TableCell>{t('tableProductB')}</TableCell>
                      <TableCell align="center">{t('tableSimilarity')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {duplicateMatches.slice(0, 50).map((match, idx) => (
                      <TableRow key={idx}>
                        <TableCell sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <Typography variant="body2" noWrap>{match.a.title}</Typography>
                          <Typography variant="caption" color="text.secondary">{match.a.barcode}</Typography>
                        </TableCell>
                        <TableCell sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <Typography variant="body2" noWrap>{match.b.title}</Typography>
                          <Typography variant="caption" color="text.secondary">{match.b.barcode}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip
                            label={`${match.score}%`}
                            size="small"
                            color={match.score >= 80 ? 'error' : 'warning'}
                            variant="outlined"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              {duplicateMatches.length > 50 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {t('showingFirst50', { total: duplicateMatches.length })}
                </Typography>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDuplicateDialogOpen(false)}>{t('close')}</Button>
        </DialogActions>
      </Dialog>

      {/* Batch result summary */}
      <Dialog
        open={Boolean(batchResult)}
        onClose={() => setBatchResult(null)}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        sx={{ zIndex: 1500 }}
      >
        {batchResult && (
          <>
            <DialogTitle>{t('batchResultTitle')}</DialogTitle>
            <DialogContent>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
                <Chip
                  color="success"
                  variant="outlined"
                  label={t('batchResultUpdated', { count: batchResult.succeededBarcodes.length })}
                  sx={{ fontWeight: 600 }}
                />
                {batchResult.failures.length > 0 && (
                  <Chip
                    color="error"
                    variant="outlined"
                    label={t('batchResultFailed', { count: batchResult.failures.length })}
                    sx={{ fontWeight: 600 }}
                  />
                )}
                {batchResult.pending > 0 && (
                  <Chip
                    color="warning"
                    variant="outlined"
                    label={t('batchResultPending', { count: batchResult.pending })}
                    sx={{ fontWeight: 600 }}
                  />
                )}
              </Box>
              {batchResult.timedOut && (
                <Alert severity="warning" sx={{ mb: 2 }}>{t('batchResultTimedOut')}</Alert>
              )}
              {(batchResult.kind === 'archive' || batchResult.kind === 'unarchive') &&
                batchResult.succeededBarcodes.length > 0 && (
                  <Alert severity="info" sx={{ mb: 2 }}>{t('batchResultSyncHint')}</Alert>
                )}
              {batchResult.failures.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                    {t('batchResultFailuresTitle')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {batchResult.failures.slice(0, 100).map((f, idx) => (
                      <Paper key={`${f.barcode}-${idx}`} variant="outlined" sx={{ p: 1.25, borderRadius: 1.5 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, wordBreak: 'break-word' }}>
                          {f.title || f.barcode || '\u2014'}
                        </Typography>
                        {f.title && f.barcode && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-all' }}>
                            {f.barcode}
                          </Typography>
                        )}
                        {(f.reasons.length > 0 ? f.reasons : [t('batchResultNoReason')]).map((r, i) => (
                          <Typography key={i} variant="caption" color="error" sx={{ display: 'block', wordBreak: 'break-word' }}>
                            {r}
                          </Typography>
                        ))}
                      </Paper>
                    ))}
                  </Box>
                  {batchResult.failures.length > 100 && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      {t('findReplace.andMore', { count: batchResult.failures.length - 100 })}
                    </Typography>
                  )}
                </Box>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setBatchResult(null)} sx={{ minHeight: 44 }}>{t('close')}</Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </>
  );
}
