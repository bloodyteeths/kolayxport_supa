import React from 'react';
import {
  Box, Typography, Button, IconButton, Tooltip, CircularProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  useMediaQuery, useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReplayIcon from '@mui/icons-material/Replay';
import HistoryIcon from '@mui/icons-material/History';
import StatusBadge from '@/components/ui/StatusBadge';
import EmptyState from '@/components/ui/EmptyState';
import { useTranslations } from 'next-intl';

interface SyncHistoryListProps {
  rows: any[];
  loading: boolean;
  error: string | null;
  ended: boolean;
  onLoadMore: () => void;
  onRetry: (id: string) => void;
  retryingId: string | null;
  onShowErrors: (errors: any) => void;
  formatDateTime: (v: string) => string;
}

type Variant = 'success' | 'error' | 'info' | 'neutral';

function statusMeta(status: string, t: any): { label: string; variant: Variant } {
  if (status === 'completed') return { label: t('syncStatusCompleted'), variant: 'success' };
  if (status === 'failed') return { label: t('syncStatusFailed'), variant: 'error' };
  if (status === 'in_progress') return { label: t('syncStatusInProgress'), variant: 'info' };
  return { label: status, variant: 'neutral' };
}

export default function SyncHistoryList(props: SyncHistoryListProps) {
  const { rows, loading, error, ended, onLoadMore, onRetry, retryingId, onShowErrors, formatDateTime } = props;
  const t = useTranslations('settings');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const loadMore = (
    <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
      {loading && <CircularProgress size={24} />}
      {!loading && rows.length > 0 && !ended && (
        <Button variant="outlined" onClick={onLoadMore} startIcon={<ExpandMoreIcon />} sx={{ textTransform: 'none' }}>
          {t('loadMore')}
        </Button>
      )}
      {!loading && ended && rows.length > 0 && (
        <Typography sx={{ color: 'text.secondary' }}>{t('noMoreRecords')}</Typography>
      )}
    </Box>
  );

  if (error) return <Typography color="error">{error}</Typography>;
  if (!loading && rows.length === 0) {
    return <EmptyState icon={<HistoryIcon sx={{ fontSize: 32 }} />} title={t('noSyncHistory')} />;
  }

  const errorsCell = (row: any) => (
    row.errors && row.errors.length > 0
      ? <Button size="small" color="error" onClick={() => onShowErrors(row.errors)} sx={{ minWidth: 0 }}>{row.errors.length}</Button>
      : <span>0</span>
  );
  const retryBtn = (row: any) => (
    row.status === 'failed' && (
      <Tooltip title={t('retrySync')}>
        <span>
          <IconButton size="small" color="primary" onClick={() => onRetry(row.id)} disabled={retryingId === row.id}>
            <ReplayIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
    )
  );

  if (isMobile) {
    return (
      <Box>
        {rows.map((row) => {
          const s = statusMeta(row.status, t);
          return (
            <Paper key={row.id} elevation={0} sx={{ p: 1.5, mb: 1, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{row.type}</Typography>
                <StatusBadge variant={s.variant} label={s.label} />
              </Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, fontSize: '0.8rem' }}>
                <Typography variant="caption" color="text.secondary">{t('syncTableHeaders.start')}: {row.startedAt ? formatDateTime(row.startedAt) : '-'}</Typography>
                <Typography variant="caption" color="text.secondary">{t('syncTableHeaders.end')}: {row.endedAt ? formatDateTime(row.endedAt) : '-'}</Typography>
                <Typography variant="caption" color="text.secondary">{t('syncTableHeaders.processed')}: {row.processedOrders}</Typography>
                <Typography variant="caption" color="text.secondary">{t('syncTableHeaders.successful')}: {row.successfulOrders}</Typography>
                <Typography variant="caption" color="text.secondary">{t('syncTableHeaders.failed')}: {row.failedOrders}</Typography>
                <Typography variant="caption" color="text.secondary">{t('syncTableHeaders.errors')}: {errorsCell(row)}</Typography>
              </Box>
              {row.status === 'failed' && <Box sx={{ mt: 0.5 }}>{retryBtn(row)}</Box>}
            </Paper>
          );
        })}
        {loadMore}
      </Box>
    );
  }

  return (
    <Box>
      <TableContainer sx={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', maxWidth: '100%' }}>
        <Table size="small" sx={{ minWidth: 700 }}>
          <TableHead>
            <TableRow>
              <TableCell>{t('syncTableHeaders.syncType')}</TableCell>
              <TableCell>{t('syncTableHeaders.status')}</TableCell>
              <TableCell>{t('syncTableHeaders.start')}</TableCell>
              <TableCell>{t('syncTableHeaders.end')}</TableCell>
              <TableCell>{t('syncTableHeaders.processed')}</TableCell>
              <TableCell>{t('syncTableHeaders.successful')}</TableCell>
              <TableCell>{t('syncTableHeaders.failed')}</TableCell>
              <TableCell>{t('syncTableHeaders.errors')}</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const s = statusMeta(row.status, t);
              return (
                <TableRow key={row.id} hover>
                  <TableCell>{row.type}</TableCell>
                  <TableCell><StatusBadge variant={s.variant} label={s.label} /></TableCell>
                  <TableCell>{row.startedAt ? formatDateTime(row.startedAt) : '-'}</TableCell>
                  <TableCell>{row.endedAt ? formatDateTime(row.endedAt) : '-'}</TableCell>
                  <TableCell>{row.processedOrders}</TableCell>
                  <TableCell>{row.successfulOrders}</TableCell>
                  <TableCell>{row.failedOrders}</TableCell>
                  <TableCell>{errorsCell(row)}</TableCell>
                  <TableCell>{retryBtn(row)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {loadMore}
    </Box>
  );
}
