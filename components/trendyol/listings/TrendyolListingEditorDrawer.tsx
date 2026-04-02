import React, { useState, useEffect, useCallback } from 'react';
import {
  SwipeableDrawer,
  Box,
  Typography,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  CircularProgress,
  Chip,
  Alert,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  InputAdornment,
  LinearProgress,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SaveIcon from '@mui/icons-material/Save';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import ImageIcon from '@mui/icons-material/Image';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrendyolListingEditorDrawerProps {
  open: boolean;
  onClose: () => void;
  productId: string | null;
  onSaved?: () => void;
}

interface TrendyolImage {
  url: string;
}

interface TrendyolProductData {
  id: string;
  barcode: string;
  title: string;
  description: string;
  stockCode: string;
  brandName: string;
  categoryName: string;
  listPrice: number;
  salePrice: number;
  vatRate: number;
  quantity: number;
  images: TrendyolImage[];
  approved: boolean;
  onSale: boolean;
  rejected: boolean;
  archived: boolean;
  rejectReasons: string[];
  hasActiveCampaign?: boolean;
  // for update payload
  productMainId?: string;
}

interface EditableFields {
  title: string;
  description: string;
  stockCode: string;
  listPrice: string;
  salePrice: string;
  vatRate: number;
  quantity: number;
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

function computeHealthScore(product: TrendyolProductData): number {
  let score = 0;
  const maxScore = 100;

  // Title quality (30 points)
  if (product.title) {
    const titleLen = product.title.length;
    if (titleLen >= 40 && titleLen <= 100) score += 30;
    else if (titleLen >= 20) score += 20;
    else if (titleLen > 0) score += 10;
  }

  // Description (20 points)
  if (product.description) {
    const descLen = product.description.length;
    if (descLen >= 100) score += 20;
    else if (descLen >= 30) score += 10;
    else if (descLen > 0) score += 5;
  }

  // Images (20 points)
  const imgCount = product.images?.length ?? 0;
  if (imgCount >= 5) score += 20;
  else if (imgCount >= 3) score += 15;
  else if (imgCount >= 1) score += 10;

  // Price sanity (15 points)
  if (product.salePrice > 0 && product.listPrice >= product.salePrice) {
    score += 15;
  } else if (product.salePrice > 0) {
    score += 8;
  }

  // Stock (15 points)
  if (product.quantity > 0) score += 15;

  return Math.min(score, maxScore);
}

function getHealthColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 50) return '#ff9800';
  return '#f44336';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRENDYOL_ORANGE = '#F27A1A';
const VAT_RATES = [0, 1, 10, 20];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrendyolListingEditorDrawer({
  open,
  onClose,
  productId,
  onSaved,
}: TrendyolListingEditorDrawerProps) {
  const t = useTranslations('trendyolListings');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // State
  const [loading, setLoading] = useState(false);
  const [product, setProduct] = useState<TrendyolProductData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fields, setFields] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState<Record<string, boolean>>({});

  // ---------------------------------------------------------------------------
  // Fetch product detail
  // ---------------------------------------------------------------------------

  const fetchProduct = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch(`/api/trendyol/products?action=detail&id=${productId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const p: TrendyolProductData = data.product ?? data;
      setProduct(p);
      setFields({
        title: p.title ?? '',
        description: p.description ?? '',
        stockCode: p.stockCode ?? '',
        listPrice: String(p.listPrice ?? 0),
        salePrice: String(p.salePrice ?? 0),
        vatRate: p.vatRate ?? 0,
        quantity: p.quantity ?? 0,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setFetchError(msg);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    if (open && productId) {
      fetchProduct();
      setBatchId(null);
      setBatchStatus(null);
    }
    if (!open) {
      setProduct(null);
      setFields(null);
      setFetchError(null);
    }
  }, [open, productId, fetchProduct]);

  // ---------------------------------------------------------------------------
  // Batch status polling
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!batchId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/trendyol/products?action=batch-status&batchRequestId=${batchId}`);
        if (!res.ok) return;
        const data = await res.json();
        const status = data.status ?? data.batchRequestStatus;
        if (!cancelled) {
          setBatchStatus(status);
          if (status === 'COMPLETED' || status === 'FAILED') {
            setBatchId(null);
          }
        }
      } catch {
        // ignore polling errors
      }
    };
    const interval = setInterval(poll, 3000);
    poll();
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [batchId]);

  // ---------------------------------------------------------------------------
  // Field helpers
  // ---------------------------------------------------------------------------

  const updateField = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) => {
    setFields((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  // ---------------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    if (!product || !fields) return;
    setSaving(true);
    try {
      const payload = {
        products: [
          {
            barcode: product.barcode,
            title: fields.title,
            description: fields.description,
            stockCode: fields.stockCode,
            listPrice: parseFloat(fields.listPrice) || 0,
            salePrice: parseFloat(fields.salePrice) || 0,
            vatRate: fields.vatRate,
            quantity: fields.quantity,
          },
        ],
      };
      const res = await fetch('/api/trendyol/products?action=update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.batchRequestId) {
        setBatchId(data.batchRequestId);
        setBatchStatus('IN_PROGRESS');
        toast.success(t('title') + ' — batch submitted');
      } else {
        toast.success(t('title') + ' — saved');
      }
      onSaved?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  // ---------------------------------------------------------------------------
  // AI actions
  // ---------------------------------------------------------------------------

  const handleAiAction = async (action: 'optimize_title' | 'optimize_description') => {
    if (!product || !fields) return;
    const key = action;
    setAiLoading((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch('/api/ai/trendyol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          title: fields.title,
          description: fields.description,
          brandName: product.brandName,
          categoryName: product.categoryName,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (action === 'optimize_title' && data.title) {
        updateField('title', data.title);
        toast.success(t('aiOptimizeTitle') + ' ✓');
      } else if (action === 'optimize_description' && data.description) {
        updateField('description', data.description);
        toast.success(t('aiOptimizeDescription') + ' ✓');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI error';
      toast.error(msg);
    } finally {
      setAiLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  // ---------------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------------

  const getStatusChip = () => {
    if (!product) return null;
    if (product.rejected)
      return <Chip label={t('rejected')} color="error" size="small" />;
    if (product.archived)
      return <Chip label={t('archived')} size="small" sx={{ bgcolor: '#9e9e9e', color: '#fff' }} />;
    if (product.onSale)
      return <Chip label={t('onSale')} size="small" sx={{ bgcolor: '#4caf50', color: '#fff' }} />;
    if (product.approved)
      return <Chip label={t('approved')} size="small" sx={{ bgcolor: '#2196f3', color: '#fff' }} />;
    return null;
  };

  const healthScore = product ? computeHealthScore(product) : 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <SwipeableDrawer
      anchor="right"
      open={open}
      onClose={onClose}
      onOpen={() => {}}
      disableSwipeToOpen
      PaperProps={{
        sx: {
          width: isMobile ? '100%' : 500,
          maxWidth: '100vw',
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pt: { xs: 'calc(env(safe-area-inset-top, 0px) + 8px)', sm: 1 },
          pb: 1,
          px: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, mr: 1 }}>
          <IconButton onClick={onClose} sx={{ mr: 1, minWidth: 44, minHeight: 44 }}>
            <ArrowBackIcon />
          </IconButton>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography
              variant="subtitle1"
              fontWeight={600}
              noWrap
              title={product?.title}
              sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {product?.title || t('editProduct')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              {getStatusChip()}
            </Box>
          </Box>
        </Box>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      {/* Loading state */}
      {loading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
          <CircularProgress sx={{ color: TRENDYOL_ORANGE }} />
        </Box>
      )}

      {/* Error state */}
      {fetchError && (
        <Box sx={{ p: 3 }}>
          <Alert severity="error">{fetchError}</Alert>
        </Box>
      )}

      {/* Batch status banner */}
      {batchStatus && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Alert
            severity={
              batchStatus === 'COMPLETED' ? 'success' : batchStatus === 'FAILED' ? 'error' : 'info'
            }
            onClose={() => setBatchStatus(null)}
          >
            Batch: {batchStatus}
          </Alert>
        </Box>
      )}

      {/* Body */}
      {!loading && !fetchError && product && fields && (
        <Box
          sx={{
            flex: 1,
            overflowY: 'auto',
            px: 2,
            py: 2,
            pb: 12,
          }}
        >
          {/* ---- Health Score ---- */}
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
              {t('healthScore')}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <LinearProgress
                variant="determinate"
                value={healthScore}
                sx={{
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  bgcolor: '#e0e0e0',
                  '& .MuiLinearProgress-bar': { bgcolor: getHealthColor(healthScore), borderRadius: 4 },
                }}
              />
              <Typography variant="body2" fontWeight={700} sx={{ color: getHealthColor(healthScore) }}>
                {healthScore}/100
              </Typography>
            </Box>
          </Box>

          {/* ---- Basic Info ---- */}
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography fontWeight={600}>{t('title')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label={t('title')}
                value={fields.title}
                onChange={(e) => updateField('title', e.target.value)}
                fullWidth
                required
                size="small"
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={aiLoading['optimize_title'] ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
                onClick={() => handleAiAction('optimize_title')}
                disabled={aiLoading['optimize_title']}
                sx={{
                  textTransform: 'none',
                  borderColor: TRENDYOL_ORANGE,
                  color: TRENDYOL_ORANGE,
                  '&:hover': { borderColor: TRENDYOL_ORANGE, bgcolor: 'rgba(242,122,26,0.04)' },
                }}
              >
                {t('aiOptimizeTitle')}
              </Button>

              <TextField
                label={t('description')}
                value={fields.description}
                onChange={(e) => updateField('description', e.target.value)}
                fullWidth
                multiline
                rows={4}
                size="small"
              />
              <Button
                size="small"
                variant="outlined"
                startIcon={aiLoading['optimize_description'] ? <CircularProgress size={16} /> : <AutoFixHighIcon />}
                onClick={() => handleAiAction('optimize_description')}
                disabled={aiLoading['optimize_description']}
                sx={{
                  textTransform: 'none',
                  borderColor: TRENDYOL_ORANGE,
                  color: TRENDYOL_ORANGE,
                  '&:hover': { borderColor: TRENDYOL_ORANGE, bgcolor: 'rgba(242,122,26,0.04)' },
                }}
              >
                {t('aiOptimizeDescription')}
              </Button>

              <TextField
                label={t('barcode')}
                value={product.barcode ?? ''}
                fullWidth
                disabled
                size="small"
              />

              <TextField
                label={t('stockCode')}
                value={fields.stockCode}
                onChange={(e) => updateField('stockCode', e.target.value)}
                fullWidth
                size="small"
              />
            </AccordionDetails>
          </Accordion>

          {/* ---- Pricing & Stock ---- */}
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography fontWeight={600}>{t('listPrice')} / {t('quantity')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField
                label={t('listPrice')}
                value={fields.listPrice}
                onChange={(e) => updateField('listPrice', e.target.value)}
                fullWidth
                type="number"
                size="small"
                InputProps={{
                  startAdornment: <InputAdornment position="start">₺</InputAdornment>,
                }}
              />
              <TextField
                label={t('salePrice')}
                value={fields.salePrice}
                onChange={(e) => updateField('salePrice', e.target.value)}
                fullWidth
                type="number"
                size="small"
                InputProps={{
                  startAdornment: <InputAdornment position="start">₺</InputAdornment>,
                }}
              />
              <FormControl fullWidth size="small">
                <InputLabel>{t('vatRate')}</InputLabel>
                <Select
                  value={fields.vatRate}
                  label={t('vatRate')}
                  onChange={(e) => updateField('vatRate', Number(e.target.value))}
                >
                  {VAT_RATES.map((rate) => (
                    <MenuItem key={rate} value={rate}>
                      {rate}%
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label={t('quantity')}
                value={fields.quantity}
                onChange={(e) => updateField('quantity', Math.max(0, parseInt(e.target.value) || 0))}
                fullWidth
                type="number"
                size="small"
              />
            </AccordionDetails>
          </Accordion>

          {/* ---- Brand & Category (read-only) ---- */}
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography fontWeight={600}>{t('brand')} / {t('category')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {product.brandName && (
                <Chip
                  label={`${t('brand')}: ${product.brandName}`}
                  variant="outlined"
                  size="small"
                />
              )}
              {product.categoryName && (
                <Chip
                  label={`${t('category')}: ${product.categoryName}`}
                  variant="outlined"
                  size="small"
                />
              )}
            </AccordionDetails>
          </Accordion>

          {/* ---- Images ---- */}
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <ImageIcon fontSize="small" />
                <Typography fontWeight={600}>
                  {t('images')} ({product.images?.length ?? 0})
                </Typography>
              </Box>
            </AccordionSummary>
            <AccordionDetails>
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  overflowX: 'auto',
                  pb: 1,
                }}
              >
                {(product.images ?? []).map((img, idx) => (
                  <Box
                    key={idx}
                    component="img"
                    src={img.url}
                    alt={`${product.title} ${idx + 1}`}
                    sx={{
                      width: 80,
                      height: 80,
                      objectFit: 'cover',
                      borderRadius: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      flexShrink: 0,
                    }}
                  />
                ))}
                {(!product.images || product.images.length === 0) && (
                  <Typography variant="body2" color="text.secondary">
                    —
                  </Typography>
                )}
              </Box>
            </AccordionDetails>
          </Accordion>

          {/* ---- Status & Reject Reasons ---- */}
          {product.rejected && product.rejectReasons?.length > 0 && (
            <Alert severity="error" sx={{ mt: 2 }}>
              <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
                {t('rejectReason')}
              </Typography>
              {product.rejectReasons.map((reason, i) => (
                <Typography key={i} variant="body2">
                  • {reason}
                </Typography>
              ))}
            </Alert>
          )}
        </Box>
      )}

      {/* Footer */}
      {!loading && !fetchError && product && fields && (
        <Box
          sx={{
            position: 'sticky',
            bottom: 0,
            zIndex: 10,
            display: 'flex',
            gap: 1,
            p: 2,
            pb: { xs: 'calc(env(safe-area-inset-bottom, 0px) + 16px)', sm: 2 },
            borderTop: '1px solid',
            borderColor: 'divider',
            bgcolor: 'background.paper',
          }}
        >
          <Button variant="outlined" onClick={onClose} sx={{ flex: 1, textTransform: 'none' }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            sx={{
              flex: 2,
              textTransform: 'none',
              bgcolor: TRENDYOL_ORANGE,
              '&:hover': { bgcolor: '#e06c10' },
              '&.Mui-disabled': { bgcolor: '#e0e0e0', color: '#9e9e9e' },
            }}
          >
            {saving ? '...' : 'Save'}
          </Button>
        </Box>
      )}
    </SwipeableDrawer>
  );
}
