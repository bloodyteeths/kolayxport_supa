import React, { useEffect, useState } from 'react';
import {
  Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography,
  useMediaQuery, useTheme,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/ui/ErrorState';
import { notify } from '@/lib/notify';
import StockPreviewPanel from './StockPreviewPanel';
import { stockErrorKey, stockFetch, type PreviewResponse } from './stockClient';

export type GoLiveDialogProps = { open: boolean; onClose: () => void; onDone: () => void };

/**
 * Go Live: loads a LIVE preview (fresh marketplace reads + 15-min confirm
 * token), shows the plan, requires the typed word when listings would be
 * deactivated or variations turned off, then PUT dryRun:false.
 */
export default function GoLiveDialog({ open, onClose, onDone }: GoLiveDialogProps) {
  const t = useTranslations('stockSync');
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [typed, setTyped] = useState('');
  const [saving, setSaving] = useState(false);
  const word = t('goLive.word');

  const load = async () => {
    setLoading(true);
    setError(null);
    setTyped('');
    try {
      setPreview(await stockFetch<PreviewResponse>('/api/stock/preview?live=1', { method: 'POST' }));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) void load();
    else setPreview(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsTyped = !!preview?.requiresTypedConfirm;
  const canConfirm = !!preview?.confirmToken && (!needsTyped || typed.trim().toLocaleUpperCase() === word.toLocaleUpperCase());

  const confirm = async () => {
    if (!preview?.confirmToken) return;
    setSaving(true);
    try {
      await stockFetch('/api/stock/settings', { method: 'PUT', body: { dryRun: false, confirmToken: preview.confirmToken, typedConfirm: typed.trim() } });
      notify.success(t('goLive.success'));
      onDone();
      onClose();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
      const code = String((err as any)?.code || '');
      // The plan changed (or now needs the typed word): show the fresh preview.
      if (code.startsWith('token') || code === 'plan_changed' || (code === 'typed_confirm_required' && !needsTyped)) void load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="md" sx={{ zIndex: 1500 }}>
      <DialogTitle>{t('goLive.title')}</DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('goLive.intro')}
        </Typography>
        {loading && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 3 }}>
            <CircularProgress size={22} />
            <Typography variant="body2">{t('preview.liveRead')}</Typography>
          </Box>
        )}
        {!!error && <ErrorState error={error} onRetry={load} compact />}
        {preview && !loading && (
          <>
            <StockPreviewPanel preview={preview} />
            {needsTyped && (
              <Box sx={{ mt: 2 }}>
                <Alert severity="warning" sx={{ mb: 1.5 }}>
                  {t('goLive.typeToConfirm', { word })}
                </Alert>
                <TextField fullWidth size="small" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={word} autoComplete="off" />
              </Box>
            )}
          </>
        )}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={load} disabled={loading || saving}>
          {t('goLive.refreshPreview')}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" color="primary" onClick={confirm} disabled={!canConfirm || saving || loading}>
          {t('goLive.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
