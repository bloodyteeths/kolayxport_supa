import React, { useCallback, useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import RestoreRoundedIcon from '@mui/icons-material/RestoreRounded';
import { useFormatter, useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import { notify } from '@/lib/notify';
import { useLiveEvent } from '@/components/live/useLiveEvent';
import AttributionChip from './AttributionChip';
import VersionDiffView from './VersionDiffView';
import { fetchJson, type ListingVersionItem } from './types';

export interface ListingHistoryPanelProps {
  shopId: string;
  listingId: string | number;
  /** Called with the staged draft after "Restore as draft" (e.g. to reload the editor's draft state). */
  onRestored?: (draft: any) => void;
}

type VersionsResponse = { items: ListingVersionItem[]; nextCursor: string | null };

/**
 * History tab of the listing editor: timeline of changes with who made them,
 * before/after diff, and "Restore as draft" (stages a draft; never writes to Etsy).
 * Refreshes itself when a live listing event for this listing arrives.
 */
export default function ListingHistoryPanel({ shopId, listingId, onRestored }: ListingHistoryPanelProps) {
  const t = useTranslations('listingHistory');
  const format = useFormatter();
  const [items, setItems] = useState<ListingVersionItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ListingVersionItem | null>(null);
  const [restoring, setRestoring] = useState(false);

  const base = `/api/etsy/listings/${encodeURIComponent(String(listingId))}/versions?shop_id=${encodeURIComponent(shopId)}`;

  const load = useCallback(async () => {
    try {
      const data = await fetchJson<VersionsResponse>(base);
      setItems(data.items);
      setCursor(data.nextCursor);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    setLoading(true);
    setItems([]);
    setExpanded(null);
    void load();
  }, [load]);

  useLiveEvent(['listing.changed', 'listing.removed'], (event) => {
    if (event.type === 'listing' && event.shopId === shopId && event.listingId === String(listingId)) void load();
  });

  const loadMore = async () => {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchJson<VersionsResponse>(`${base}&cursor=${encodeURIComponent(cursor)}`);
      setItems((prev) => [...prev, ...data.items.filter((i) => !prev.some((p) => p.id === i.id))]);
      setCursor(data.nextCursor);
    } catch (err) {
      notify.error(err, 'listingHistory.errors.loadFailed');
    } finally {
      setLoadingMore(false);
    }
  };

  const restore = async () => {
    if (!confirming) return;
    setRestoring(true);
    try {
      const data = await fetchJson<{ draft: any; restoredKeys: string[]; unrestorable: Array<{ key: string; reason: string }>; nothingToRestore: boolean }>(
        `/api/etsy/listings/${encodeURIComponent(String(listingId))}/versions/${encodeURIComponent(confirming.id)}/restore?shop_id=${encodeURIComponent(shopId)}`,
        { method: 'POST' },
      );
      if (data.nothingToRestore) {
        notify.info(t('history.nothingToRestore'));
      } else if (data.unrestorable.length) {
        const parts = Array.from(new Set(data.unrestorable.map((u) => u.reason)))
          .map((r) => (t.has(`history.unrestorable.${r}`) ? t(`history.unrestorable.${r}`) : r))
          .join(', ');
        notify.success(t('history.restoredPartial', { parts }), { duration: 6000 });
      } else {
        notify.success(t('history.restored'));
      }
      if (data.draft) onRestored?.(data.draft);
      setConfirming(null);
    } catch (err: any) {
      notify.error(err, err?.key || 'listingHistory.history.restoreFailed');
    } finally {
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }
  if (error) return <ErrorState compact error={error} title={t('errors.loadFailed')} onRetry={load} />;
  if (items.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        {t('history.empty')}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {items.map((v) => {
        const open = expanded === v.id;
        const keys = v.isTombstone ? ['deleted'] : v.changedKeys;
        return (
          <Paper key={v.id} variant="outlined" sx={{ borderRadius: '12px', overflow: 'hidden' }}>
            <Box
              role="button"
              tabIndex={0}
              onClick={() => setExpanded(open ? null : v.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') setExpanded(open ? null : v.id);
              }}
              sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, cursor: 'pointer', minHeight: 48 }}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                  <AttributionChip attribution={v.attribution} />
                  <Typography variant="caption" color="text.secondary">
                    {format.relativeTime(new Date(v.capturedAt), new Date())}
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600 }} noWrap>
                  {keys.map((k) => (t.has(`keys.${k}`) ? t(`keys.${k}`) : k)).join(', ')}
                </Typography>
              </Box>
              <IconButton size="small" aria-label="expand" sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
                <ExpandMoreRoundedIcon fontSize="small" />
              </IconButton>
            </Box>
            <Collapse in={open} unmountOnExit>
              <Box sx={{ px: 1.25, pb: 1.25, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
                <VersionDiffView changedKeys={v.changedKeys} diff={v.diff} isTombstone={v.isTombstone} />
                {v.restorable && (
                  <Box>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<RestoreRoundedIcon fontSize="small" />}
                      onClick={() => setConfirming(v)}
                      sx={{ textTransform: 'none', minHeight: 40 }}
                    >
                      {t('history.restore')}
                    </Button>
                  </Box>
                )}
              </Box>
            </Collapse>
          </Paper>
        );
      })}
      {cursor && (
        <Button onClick={loadMore} disabled={loadingMore} sx={{ textTransform: 'none', minHeight: 44 }}>
          {loadingMore ? <CircularProgress size={18} /> : t('history.loadMore')}
        </Button>
      )}

      {/* Own dialog (not the global ConfirmProvider) so it stacks above the editor drawer/dialogs. */}
      <Dialog open={!!confirming} onClose={() => !restoring && setConfirming(null)} sx={{ zIndex: 1550 }} fullWidth maxWidth="xs">
        <DialogTitle sx={{ fontWeight: 700 }}>{t('history.restoreTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {t('history.restoreBody')}
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirming(null)} disabled={restoring} sx={{ textTransform: 'none' }}>
            {t('history.restoreCancel')}
          </Button>
          <Button variant="contained" onClick={restore} disabled={restoring} sx={{ textTransform: 'none' }}>
            {restoring ? <CircularProgress size={18} color="inherit" /> : t('history.restoreConfirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
