import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, IconButton, CircularProgress } from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import SettingsSection from './SettingsSection';
import SyncHistoryList from './SyncHistoryList';
import ErrorDetailsDialog from './ErrorDetailsDialog';

export default function SyncPanel() {
  const t = useTranslations('settings');
  const { formatDateTime } = useLocale();

  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [fullSyncLoading, setFullSyncLoading] = useState(false);
  const [errorDialog, setErrorDialog] = useState<{ open: boolean; errors: any }>({ open: false, errors: null });
  const cursorRef = useRef<string | null>(null);

  const fetchHistory = useCallback(async (opts: { append?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      const cursor = opts.append ? cursorRef.current : null;
      if (cursor) params.append('cursor', cursor);
      const res = await fetch(`/api/sync/history?${params.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setRows(prev => (opts.append ? [...prev, ...data.syncs] : data.syncs));
        cursorRef.current = data.nextCursor;
        setEnded(!data.nextCursor || data.syncs.length === 0);
      } else {
        setError(data.error || t('syncHistoryFailed'));
      }
    } catch (err: any) {
      setError(err.message || t('syncHistoryFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const handleRefresh = () => { cursorRef.current = null; setEnded(false); fetchHistory(); };

  const handleFullSync = async () => {
    if (!window.confirm(t('fullSyncConfirm'))) return;
    setFullSyncLoading(true);
    try {
      const res = await fetch('/api/orders/fullSync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('fullSyncFailed'));
      toast.success(t('fullSyncStarted'));
      handleRefresh();
    } catch (err: any) {
      toast.error(err.message || t('fullSyncFailed'));
    } finally {
      setFullSyncLoading(false);
    }
  };

  const handleRetry = async (syncId: string) => {
    if (!window.confirm(t('retrySyncConfirm'))) return;
    setRetryingId(syncId);
    try {
      const res = await fetch(`/api/sync/retry?id=${encodeURIComponent(syncId)}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('retryFailed'));
      handleRefresh();
    } catch (err: any) {
      toast.error(err.message || t('retryFailed'));
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <>
      <SettingsSection
        title={t('syncHistory')}
        action={
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <Button
              variant="contained" color="secondary" onClick={handleFullSync} disabled={fullSyncLoading}
              startIcon={fullSyncLoading ? <CircularProgress size={18} color="inherit" /> : <ReplayIcon />}
              sx={{ textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
            >
              {fullSyncLoading ? t('syncing') : t('fullSync')}
            </Button>
            <IconButton onClick={handleRefresh} disabled={loading}><RefreshIcon /></IconButton>
          </Box>
        }
      >
        <SyncHistoryList
          rows={rows}
          loading={loading}
          error={error}
          ended={ended}
          onLoadMore={() => fetchHistory({ append: true })}
          onRetry={handleRetry}
          retryingId={retryingId}
          onShowErrors={(errors) => setErrorDialog({ open: true, errors })}
          formatDateTime={formatDateTime}
        />
      </SettingsSection>

      <ErrorDetailsDialog open={errorDialog.open} errors={errorDialog.errors} onClose={() => setErrorDialog({ open: false, errors: null })} />
    </>
  );
}
