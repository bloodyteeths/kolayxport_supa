import React, { useState, useMemo, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControlLabel,
  Checkbox,
  Switch,
  Button,
  LinearProgress,
  Typography,
  Box,
  Alert,
  Chip,
} from '@mui/material';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrendyolProduct {
  id: string;
  barcode: string;
  title: string;
  description: string;
  stockCode: string;
  // Trendyol update API requires ALL fields, so we keep the originals
  listPrice?: number | string | { toNumber?: () => number }; // Prisma Decimal
  salePrice?: number | string | { toNumber?: () => number };
  vatRate?: number | null;
  quantity?: number;
}

export interface TrendyolFindReplaceProps {
  open: boolean;
  onClose: () => void;
  products: Array<{
    id: string;
    barcode: string;
    title: string;
    description: string;
    stockCode: string;
    listPrice?: any;
    salePrice?: any;
    vatRate?: number | null;
    quantity?: number;
  }>;
  onRefresh: () => void;
}

type Scope = 'title' | 'description' | 'stockCode';

interface AffectedProduct {
  product: TrendyolProduct;
  changes: {
    title?: string;
    description?: string;
    stockCode?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRENDYOL_ORANGE = '#F27A1A';
const RATE_LIMIT_DELAY = 150;
const MAX_PREVIEW = 10;
const BATCH_SIZE = 20;

const SCOPE_KEYS: Record<Scope, string> = {
  title: 'scopeTitle',
  description: 'scopeDescription',
  stockCode: 'scopeStockCode',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatches(
  text: string,
  search: string,
  caseSensitive: boolean
): React.ReactNode {
  if (!search) return text;

  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(`(${escapeRegExp(search)})`, flags);
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <span
        key={i}
        style={{
          backgroundColor: '#fff176',
          padding: '0 1px',
          borderRadius: 2,
        }}
      >
        {part}
      </span>
    ) : (
      part
    )
  );
}

function replaceInString(
  text: string,
  search: string,
  replace: string,
  caseSensitive: boolean
): string {
  if (!search) return text;
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegExp(search), flags);
  return text.replace(regex, replace);
}

function hasMatch(
  text: string,
  search: string,
  caseSensitive: boolean
): boolean {
  if (!search || !text) return false;
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegExp(search), flags);
  return regex.test(text);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Safely convert Prisma Decimal / string / number to a plain number */
function toNumber(value: any): number {
  if (value == null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && typeof value.toNumber === 'function') {
    return value.toNumber();
  }
  return parseFloat(String(value)) || 0;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TrendyolFindReplace({
  open,
  onClose,
  products,
  onRefresh,
}: TrendyolFindReplaceProps) {
  const t = useTranslations('trendyolListings');

  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({
    title: true,
    description: true,
    stockCode: false,
  });
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{
    success: number;
    errors: number;
  } | null>(null);

  // -----------------------------------------------------------------------
  // Derived state
  // -----------------------------------------------------------------------

  const activeScopes = useMemo(
    () => (Object.keys(scopes) as Scope[]).filter((s) => scopes[s]),
    [scopes]
  );

  const hasActiveScope = activeScopes.length > 0;

  const toggleScope = useCallback((scope: Scope) => {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }, []);

  const affectedProducts = useMemo((): AffectedProduct[] => {
    if (!searchTerm || !hasActiveScope) return [];

    const results: AffectedProduct[] = [];

    for (const product of products) {
      let affected = false;
      const changes: AffectedProduct['changes'] = {};

      if (
        scopes.title &&
        hasMatch(product.title, searchTerm, caseSensitive)
      ) {
        affected = true;
        changes.title = replaceInString(
          product.title,
          searchTerm,
          replaceTerm,
          caseSensitive
        );
      }
      if (
        scopes.description &&
        hasMatch(product.description, searchTerm, caseSensitive)
      ) {
        affected = true;
        changes.description = replaceInString(
          product.description,
          searchTerm,
          replaceTerm,
          caseSensitive
        );
      }
      if (
        scopes.stockCode &&
        hasMatch(product.stockCode, searchTerm, caseSensitive)
      ) {
        affected = true;
        changes.stockCode = replaceInString(
          product.stockCode,
          searchTerm,
          replaceTerm,
          caseSensitive
        );
      }

      if (affected) {
        results.push({ product: product as TrendyolProduct, changes });
      }
    }

    return results;
  }, [products, searchTerm, replaceTerm, scopes, caseSensitive, hasActiveScope]);

  // -----------------------------------------------------------------------
  // Replace handler — batch update via Trendyol API
  // -----------------------------------------------------------------------

  const handleReplaceAll = async () => {
    if (affectedProducts.length === 0) return;

    setIsProcessing(true);
    setProgress(0);
    setResult(null);

    let success = 0;
    let errors = 0;
    const total = affectedProducts.length;

    // Process in batches for rate-limiting
    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = affectedProducts.slice(i, i + BATCH_SIZE);

      const items = batch.map(({ product, changes }) => ({
        barcode: product.barcode,
        title: changes.title ?? product.title,
        description: changes.description ?? product.description,
        stockCode: changes.stockCode ?? product.stockCode,
        listPrice: toNumber(product.listPrice),
        salePrice: toNumber(product.salePrice),
        vatRate: product.vatRate ?? 10,
        quantity: product.quantity ?? 0,
      }));

      try {
        const res = await fetch(
          '/api/trendyol/products?action=update',
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        success += batch.length;
      } catch (err) {
        errors += batch.length;
        console.error('Trendyol find/replace batch failed:', err);
      }

      setProgress(Math.min(((i + BATCH_SIZE) / total) * 100, 100));

      // Rate-limit between batches
      if (i + BATCH_SIZE < total) {
        await delay(RATE_LIMIT_DELAY);
      }
    }

    setIsProcessing(false);
    setResult({ success, errors });

    if (errors === 0) {
      toast.success(
        t('findReplace.toastSuccess', { count: success })
      );
    } else {
      toast.error(
        t('findReplace.toastPartialError', { success, errors })
      );
    }

    onRefresh();
  };

  // -----------------------------------------------------------------------
  // Close handler
  // -----------------------------------------------------------------------

  const handleClose = () => {
    if (isProcessing) return;
    setSearchTerm('');
    setReplaceTerm('');
    setScopes({ title: true, description: true, stockCode: false });
    setCaseSensitive(false);
    setProgress(0);
    setResult(null);
    onClose();
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  const previewProducts = affectedProducts.slice(0, MAX_PREVIEW);
  const remaining = affectedProducts.length - MAX_PREVIEW;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          color: TRENDYOL_ORANGE,
        }}
      >
        <FindReplaceIcon />
        {t('findReplace.dialogTitle')}
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Search and Replace inputs */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label={t('findReplace.searchLabel')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              fullWidth
              size="small"
              disabled={isProcessing}
              autoFocus
            />
            <TextField
              label={t('findReplace.replaceLabel')}
              value={replaceTerm}
              onChange={(e) => setReplaceTerm(e.target.value)}
              fullWidth
              size="small"
              disabled={isProcessing}
            />
          </Box>

          {/* Scope checkboxes and case toggle */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 1,
            }}
          >
            {(Object.keys(SCOPE_KEYS) as Scope[]).map((scope) => (
              <FormControlLabel
                key={scope}
                control={
                  <Checkbox
                    checked={scopes[scope]}
                    onChange={() => toggleScope(scope)}
                    size="small"
                    disabled={isProcessing}
                    sx={{
                      '&.Mui-checked': { color: TRENDYOL_ORANGE },
                    }}
                  />
                }
                label={t(`findReplace.${SCOPE_KEYS[scope]}`)}
              />
            ))}
            <Box sx={{ ml: 'auto' }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={caseSensitive}
                    onChange={(e) => setCaseSensitive(e.target.checked)}
                    size="small"
                    disabled={isProcessing}
                    sx={{
                      '& .MuiSwitch-switchBase.Mui-checked': {
                        color: TRENDYOL_ORANGE,
                      },
                      '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track':
                        {
                          backgroundColor: TRENDYOL_ORANGE,
                        },
                    }}
                  />
                }
                label={t('findReplace.caseSensitive')}
              />
            </Box>
          </Box>

          {!hasActiveScope && (
            <Alert severity="warning">
              {t('findReplace.scopeWarning')}
            </Alert>
          )}

          {/* Affected count chip */}
          {searchTerm && hasActiveScope && !isProcessing && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                label={t('findReplace.matchCount', {
                  count: affectedProducts.length,
                })}
                size="small"
                sx={{
                  backgroundColor:
                    affectedProducts.length > 0
                      ? TRENDYOL_ORANGE
                      : undefined,
                  color:
                    affectedProducts.length > 0 ? '#fff' : undefined,
                }}
              />
            </Box>
          )}

          {/* Progress */}
          {isProcessing && (
            <Box>
              <LinearProgress
                variant="determinate"
                value={progress}
                sx={{
                  '& .MuiLinearProgress-bar': {
                    backgroundColor: TRENDYOL_ORANGE,
                  },
                }}
              />
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ mt: 0.5 }}
              >
                {t('findReplace.progressPercent', {
                  percent: Math.round(progress),
                })}
              </Typography>
            </Box>
          )}

          {/* Result summary */}
          {result && (
            <Alert
              severity={result.errors === 0 ? 'success' : 'warning'}
            >
              {result.errors === 0
                ? t('findReplace.resultSuccess', {
                    count: result.success,
                  })
                : t('findReplace.resultWithErrors', {
                    count: result.success,
                    errors: result.errors,
                  })}
            </Alert>
          )}

          {/* Preview section */}
          {searchTerm && hasActiveScope && !isProcessing && (
            <Box>
              {affectedProducts.length === 0 && (
                <Typography variant="subtitle2" color="text.secondary">
                  {t('findReplace.noMatch')}
                </Typography>
              )}

              {previewProducts.map(({ product, changes }) => (
                <Box
                  key={product.id}
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    fontSize: '0.875rem',
                  }}
                >
                  <Typography variant="caption" color="text.secondary">
                    {product.barcode}
                  </Typography>

                  {changes.title !== undefined && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" fontWeight={600}>
                        {t('findReplace.previewTitleLabel')}
                      </Typography>
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.25,
                          ml: 1,
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            textDecoration: 'line-through',
                            color: 'text.secondary',
                          }}
                        >
                          {highlightMatches(
                            product.title,
                            searchTerm,
                            caseSensitive
                          )}
                        </Typography>
                        <Typography variant="body2">
                          {changes.title}
                        </Typography>
                      </Box>
                    </Box>
                  )}

                  {changes.description !== undefined && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" fontWeight={600}>
                        {t('findReplace.previewDescriptionLabel')}
                      </Typography>
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.25,
                          ml: 1,
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            textDecoration: 'line-through',
                            color: 'text.secondary',
                            maxHeight: 60,
                            overflow: 'hidden',
                          }}
                        >
                          {highlightMatches(
                            product.description.length > 200
                              ? product.description.slice(0, 200) +
                                '...'
                              : product.description,
                            searchTerm,
                            caseSensitive
                          )}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ maxHeight: 60, overflow: 'hidden' }}
                        >
                          {changes.description &&
                          changes.description.length > 200
                            ? changes.description.slice(0, 200) + '...'
                            : changes.description}
                        </Typography>
                      </Box>
                    </Box>
                  )}

                  {changes.stockCode !== undefined && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" fontWeight={600}>
                        {t('findReplace.previewStockCodeLabel')}
                      </Typography>
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 0.25,
                          ml: 1,
                        }}
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            textDecoration: 'line-through',
                            color: 'text.secondary',
                          }}
                        >
                          {highlightMatches(
                            product.stockCode,
                            searchTerm,
                            caseSensitive
                          )}
                        </Typography>
                        <Typography variant="body2">
                          {changes.stockCode}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                </Box>
              ))}

              {remaining > 0 && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 1 }}
                >
                  {t('findReplace.andMore', { count: remaining })}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isProcessing}>
          {t('findReplace.closeBtn')}
        </Button>
        <Button
          variant="contained"
          onClick={handleReplaceAll}
          disabled={
            isProcessing ||
            affectedProducts.length === 0 ||
            !hasActiveScope
          }
          startIcon={<FindReplaceIcon />}
          sx={{
            backgroundColor: TRENDYOL_ORANGE,
            '&:hover': { backgroundColor: '#e06b10' },
          }}
        >
          {isProcessing
            ? t('findReplace.processing')
            : t('findReplace.replaceAllBtn', {
                count: affectedProducts.length,
              })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
