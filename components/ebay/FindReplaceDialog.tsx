import React, { useState, useMemo, useCallback } from 'react';
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
} from '@mui/material';
import FindReplaceIcon from '@mui/icons-material/FindReplace';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EbayListingRow {
  sku: string;
  title: string;
  description: string;
}

interface FindReplaceDialogProps {
  open: boolean;
  onClose: () => void;
  listings: EbayListingRow[];
  userId: string;
  onCompleted: () => void;
}

type Scope = 'title' | 'description';

interface AffectedListing {
  listing: EbayListingRow;
  changes: {
    title?: string;
    description?: string;
  };
}

const RATE_LIMIT_DELAY = 100;
const MAX_PREVIEW = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightMatches(text: string, search: string, caseSensitive: boolean): React.ReactNode {
  if (!search) return text;

  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(`(${escapeRegExp(search)})`, flags);
  const parts = text.split(regex);

  return parts.map((part, i) =>
    regex.test(part) ? (
      <span key={i} style={{ backgroundColor: '#fff176', padding: '0 1px', borderRadius: 2 }}>
        {part}
      </span>
    ) : (
      part
    )
  );
}

function replaceInString(text: string, search: string, replace: string, caseSensitive: boolean): string {
  if (!search) return text;
  const flags = caseSensitive ? 'g' : 'gi';
  const regex = new RegExp(escapeRegExp(search), flags);
  return text.replace(regex, replace);
}

function hasMatch(text: string, search: string, caseSensitive: boolean): boolean {
  if (!search) return false;
  const regex = new RegExp(escapeRegExp(search), caseSensitive ? 'g' : 'gi');
  return regex.test(text);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FindReplaceDialog({
  open,
  onClose,
  listings,
  userId,
  onCompleted,
}: FindReplaceDialogProps) {
  const t = useTranslations('ebay.findReplace');

  const SCOPE_LABELS: Record<Scope, string> = {
    title: t('title'),
    description: t('description'),
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [scopes, setScopes] = useState<Record<Scope, boolean>>({
    title: true,
    description: true,
  });
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ success: number; errors: number } | null>(null);

  const activeScopes = useMemo(
    () => (Object.keys(scopes) as Scope[]).filter((s) => scopes[s]),
    [scopes]
  );

  const hasActiveScope = activeScopes.length > 0;

  const toggleScope = useCallback((scope: Scope) => {
    setScopes((prev) => ({ ...prev, [scope]: !prev[scope] }));
  }, []);

  const affectedListings = useMemo((): AffectedListing[] => {
    if (!searchTerm || !hasActiveScope) return [];

    const results: AffectedListing[] = [];

    for (const listing of listings) {
      let affected = false;
      const changes: AffectedListing['changes'] = {};

      if (scopes.title && hasMatch(listing.title, searchTerm, caseSensitive)) {
        affected = true;
        changes.title = replaceInString(listing.title, searchTerm, replaceTerm, caseSensitive);
      }
      if (scopes.description && hasMatch(listing.description, searchTerm, caseSensitive)) {
        affected = true;
        changes.description = replaceInString(listing.description, searchTerm, replaceTerm, caseSensitive);
      }

      if (affected) {
        results.push({ listing, changes });
      }
    }

    return results;
  }, [listings, searchTerm, replaceTerm, scopes, caseSensitive, hasActiveScope]);

  const handleReplaceAll = async () => {
    if (affectedListings.length === 0) return;

    setIsProcessing(true);
    setProgress(0);
    setResult(null);

    let success = 0;
    let errors = 0;
    const total = affectedListings.length;

    for (let i = 0; i < total; i++) {
      const { listing, changes } = affectedListings[i];

      try {
        // Build product update payload
        const productPayload: Record<string, any> = {};
        if (changes.title !== undefined) productPayload.title = changes.title;
        if (changes.description !== undefined) productPayload.description = changes.description;

        const res = await fetch(
          `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(listing.sku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              product: productPayload,
            }),
          }
        );

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        success++;
      } catch (err) {
        errors++;
        console.error(`${t('updateFailed', { sku: listing.sku })}:`, err);
      }

      setProgress(((i + 1) / total) * 100);

      if (i < total - 1) {
        await delayMs(RATE_LIMIT_DELAY);
      }
    }

    setIsProcessing(false);
    setResult({ success, errors });

    if (errors === 0) {
      toast.success(t('successMessage', { count: success }));
    } else {
      toast.error(t('partialSuccess', { success, errors }));
    }

    onCompleted();
  };

  const handleClose = () => {
    if (isProcessing) return;
    setSearchTerm('');
    setReplaceTerm('');
    setScopes({ title: true, description: true });
    setCaseSensitive(false);
    setProgress(0);
    setResult(null);
    onClose();
  };

  const previewListings = affectedListings.slice(0, MAX_PREVIEW);
  const remaining = affectedListings.length - MAX_PREVIEW;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FindReplaceIcon />
        {t('dialogTitle')}
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Search and Replace inputs */}
          <Box sx={{ display: 'flex', gap: 2 }}>
            <TextField
              label={t('searchLabel')}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              fullWidth
              size="small"
              disabled={isProcessing}
              autoFocus
            />
            <TextField
              label={t('replaceLabel')}
              value={replaceTerm}
              onChange={(e) => setReplaceTerm(e.target.value)}
              fullWidth
              size="small"
              disabled={isProcessing}
            />
          </Box>

          {/* Scope checkboxes and case toggle */}
          <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            {(Object.keys(SCOPE_LABELS) as Scope[]).map((scope) => (
              <FormControlLabel
                key={scope}
                control={
                  <Checkbox
                    checked={scopes[scope]}
                    onChange={() => toggleScope(scope)}
                    size="small"
                    disabled={isProcessing}
                  />
                }
                label={SCOPE_LABELS[scope]}
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
                  />
                }
                label={t('caseSensitive')}
              />
            </Box>
          </Box>

          {!hasActiveScope && (
            <Alert severity="warning">{t('selectAtLeastOneScope')}</Alert>
          )}

          {/* Progress */}
          {isProcessing && (
            <Box>
              <LinearProgress variant="determinate" value={progress} />
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                {t('progressPercent', { percent: Math.round(progress) })}
              </Typography>
            </Box>
          )}

          {/* Result summary */}
          {result && (
            <Alert severity={result.errors === 0 ? 'success' : 'warning'}>
              {t('successMessage', { count: result.success })}
              {result.errors > 0 && `, ${t('errorsOccurred', { count: result.errors })}`}
            </Alert>
          )}

          {/* Preview section */}
          {searchTerm && hasActiveScope && !isProcessing && (
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                {affectedListings.length === 0
                  ? t('noMatchFound')
                  : t('listingsAffected', { count: affectedListings.length })}
              </Typography>

              {previewListings.map(({ listing, changes }) => (
                <Box
                  key={listing.sku}
                  sx={{
                    mb: 1.5,
                    p: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    fontSize: '0.875rem',
                  }}
                >
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    SKU: {listing.sku}
                  </Typography>

                  {changes.title !== undefined && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" fontWeight={600}>{t('title')}:</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, ml: 1 }}>
                        <Typography variant="body2" sx={{ textDecoration: 'line-through', color: 'text.secondary' }}>
                          {highlightMatches(listing.title, searchTerm, caseSensitive)}
                        </Typography>
                        <Typography variant="body2">{changes.title}</Typography>
                      </Box>
                    </Box>
                  )}

                  {changes.description !== undefined && (
                    <Box sx={{ mt: 0.5 }}>
                      <Typography variant="caption" fontWeight={600}>{t('description')}:</Typography>
                      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, ml: 1 }}>
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
                            listing.description.length > 200
                              ? listing.description.slice(0, 200) + '...'
                              : listing.description,
                            searchTerm,
                            caseSensitive
                          )}
                        </Typography>
                        <Typography
                          variant="body2"
                          sx={{ maxHeight: 60, overflow: 'hidden' }}
                        >
                          {changes.description && changes.description.length > 200
                            ? changes.description.slice(0, 200) + '...'
                            : changes.description}
                        </Typography>
                      </Box>
                    </Box>
                  )}
                </Box>
              ))}

              {remaining > 0 && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t('andMore', { count: remaining })}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Button onClick={handleClose} disabled={isProcessing}>
          {t('close')}
        </Button>
        <Button
          variant="contained"
          onClick={handleReplaceAll}
          disabled={isProcessing || affectedListings.length === 0 || !hasActiveScope}
          startIcon={<FindReplaceIcon />}
        >
          {isProcessing ? t('processing') : `${t('replaceAll')} (${affectedListings.length})`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
