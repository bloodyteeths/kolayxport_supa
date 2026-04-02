import React, { useState, useMemo } from 'react';
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

  const handlePriceSubmit = async () => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) { toast.error(t('toastEnterValidAmount')); return; }

    setPriceDialogOpen(false);
    setProcessing(true);
    setProgress(0);
    setProgressLabel(t('updatingPrices'));

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

    try {
      const res = await fetch('/api/trendyol/products?action=update_price_inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(t('toastBatchSubmitted', { count: items.length, batchId: data.batchRequestId || '' }));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t('toastUpdateFailed'));
      }
    } catch {
      toast.error(t('toastUpdateFailed'));
    }

    setProcessing(false);
    setProgress(100);
    setPriceAmount('');
    setPriceMode('percent_increase');
    onRefresh();
  };

  const handleStockSubmit = async () => {
    const qty = parseInt(stockQuantity, 10);
    if (isNaN(qty) || qty < 0) { toast.error(t('toastEnterValidQuantity')); return; }

    setStockDialogOpen(false);
    setProcessing(true);
    setProgress(0);
    setProgressLabel(t('updatingStock'));

    const items = selectedProducts.map((p) => ({
      barcode: p.barcode,
      listPrice: toFloat(p.listPrice),
      salePrice: toFloat(p.salePrice),
      quantity: qty,
    }));

    try {
      const res = await fetch('/api/trendyol/products?action=update_price_inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(t('toastBatchSubmitted', { count: items.length, batchId: data.batchRequestId || '' }));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t('toastUpdateFailed'));
      }
    } catch {
      toast.error(t('toastUpdateFailed'));
    }

    setProcessing(false);
    setProgress(100);
    setStockQuantity('');
    onRefresh();
  };

  const handleArchiveSubmit = async () => {
    setArchiveDialogOpen(false);
    setProcessing(true);
    setProgress(0);
    setProgressLabel(t('archiving'));

    const items = selectedProducts.map((p) => ({ barcode: p.barcode }));

    try {
      const res = await fetch('/api/trendyol/products?action=archive', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(t('toastBatchSubmitted', { count: items.length, batchId: data.batchRequestId || '' }));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t('toastArchiveFailed'));
      }
    } catch {
      toast.error(t('toastArchiveFailed'));
    }

    setProcessing(false);
    setProgress(100);
    onRefresh();
  };

  const handleUnarchiveSubmit = async () => {
    setUnarchiveDialogOpen(false);
    setProcessing(true);
    setProgress(0);
    setProgressLabel(t('unarchiving'));

    const items = selectedProducts.map((p) => ({ barcode: p.barcode }));

    try {
      const res = await fetch('/api/trendyol/products?action=unarchive', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(t('toastBatchSubmitted', { count: items.length, batchId: data.batchRequestId || '' }));
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t('toastUnarchiveFailed'));
      }
    } catch {
      toast.error(t('toastUnarchiveFailed'));
    }

    setProcessing(false);
    setProgress(100);
    onRefresh();
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

  if (!hasSelection && !isProcessing) return null;

  // --- More menu items ---
  const moreMenuItems = [
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
      label: t('findReplace'),
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
            variant="determinate"
            value={currentProgress}
            sx={{
              height: 6,
              borderRadius: 3,
              '& .MuiLinearProgress-bar': { bgcolor: TRENDYOL_ORANGE },
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {Math.round(currentProgress)}%
          </Typography>
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
              <ListItemText primary={t('findReplace')} />
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
    </>
  );
}
