import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  Tooltip,
  LinearProgress,
} from '@mui/material';
import {
  Restore as RestoreIcon,
  DeleteSweep as DeleteSweepIcon,
  Backup as BackupIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrendyolBackupProduct {
  barcode: string;
  title: string;
  description: string;
  listPrice: number;
  salePrice: number;
  quantity: number;
  stockCode: string;
}

export interface TrendyolBackupEntry {
  id: string;
  timestamp: number;
  operation_type: string;
  products: TrendyolBackupProduct[];
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'trendyol_backups';
const MAX_BACKUPS = 20;

function loadBackups(): TrendyolBackupEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as TrendyolBackupEntry[];
  } catch {
    return [];
  }
}

function saveBackups(backups: TrendyolBackupEntry[]): void {
  const trimmed = backups.slice(0, MAX_BACKUPS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/**
 * Creates a backup of Trendyol products before a bulk operation.
 * Call this from any component before performing destructive changes.
 */
export function createTrendyolBackup(
  products: any[],
  operationType: string
): void {
  const entry: TrendyolBackupEntry = {
    id: `trendyol_backup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    timestamp: Date.now(),
    operation_type: operationType,
    products: products.map((p) => ({
      barcode: p.barcode ?? '',
      title: p.title ?? '',
      description: p.description ?? '',
      listPrice: typeof p.listPrice === 'number' ? p.listPrice : 0,
      salePrice: typeof p.salePrice === 'number' ? p.salePrice : 0,
      quantity: typeof p.quantity === 'number' ? p.quantity : 0,
      stockCode: p.stockCode ?? '',
    })),
  };

  const existing = loadBackups();
  existing.unshift(entry);
  saveBackups(existing);
}

// ---------------------------------------------------------------------------
// Operation type labels
// ---------------------------------------------------------------------------

const OPERATION_KEYS: Record<string, string> = {
  bulk_price: 'opBulkPrice',
  bulk_stock: 'opBulkStock',
  bulk_archive: 'opBulkArchive',
  find_replace: 'opFindReplace',
  ai_optimize: 'opAiOptimize',
  manual: 'opManual',
};

const TRENDYOL_ORANGE = '#F27A1A';

function formatDate(ts: number): string {
  try {
    return new Intl.DateTimeFormat('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TrendyolBackupManagerProps {
  open: boolean;
  onClose: () => void;
  products: Array<any>;
  onRefresh: () => void;
}

export default function TrendyolBackupManager({
  open,
  onClose,
  products,
  onRefresh,
}: TrendyolBackupManagerProps) {
  const t = useTranslations('trendyolListings');
  const [backups, setBackups] = useState<TrendyolBackupEntry[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);

  const refresh = useCallback(() => {
    setBackups(loadBackups());
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // ---- Create manual backup ----
  const handleCreateBackup = () => {
    if (!products || products.length === 0) {
      toast.error(t('backupNoProducts'));
      return;
    }
    createTrendyolBackup(products, 'manual');
    refresh();
    toast.success(t('backupCreated', { count: products.length }));
  };

  // ---- Restore a backup ----
  const handleRestore = async (backup: TrendyolBackupEntry) => {
    if (backup.products.length === 0) {
      toast.error(t('backupEmpty'));
      return;
    }

    setRestoring(true);
    setRestoreProgress(0);

    let succeeded = 0;
    let failed = 0;
    const batchSize = 50;

    // Process in batches to avoid oversized payloads
    for (let i = 0; i < backup.products.length; i += batchSize) {
      const batch = backup.products.slice(i, i + batchSize);

      const items = batch.map((p) => ({
        barcode: p.barcode,
        title: p.title,
        description: p.description,
        listPrice: p.listPrice,
        salePrice: p.salePrice,
        quantity: p.quantity,
        stockCode: p.stockCode,
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
        if (res.ok) {
          succeeded += batch.length;
        } else {
          failed += batch.length;
        }
      } catch {
        failed += batch.length;
      }

      const processed = Math.min(i + batchSize, backup.products.length);
      setRestoreProgress((processed / backup.products.length) * 100);

      // Rate limit between batches
      if (i + batchSize < backup.products.length) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    setRestoring(false);
    setRestoreProgress(0);

    if (failed === 0) {
      toast.success(t('restoreComplete', { count: succeeded }));
    } else {
      toast.error(t('restorePartial', { success: succeeded, failed }));
    }

    onRefresh();
  };

  // ---- Delete one backup ----
  const handleDeleteOne = (id: string) => {
    const updated = backups.filter((b) => b.id !== id);
    saveBackups(updated);
    setBackups(updated);
  };

  // ---- Clear all ----
  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setBackups([]);
    toast.success(t('backupAllCleared'));
  };

  return (
    <Dialog
      open={open}
      onClose={restoring ? undefined : onClose}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <BackupIcon sx={{ color: TRENDYOL_ORANGE }} />
        {t('backupTitle')}
        {backups.length > 0 && (
          <Chip
            label={t('backupCount', { count: backups.length })}
            size="small"
            sx={{
              ml: 1,
              bgcolor: TRENDYOL_ORANGE,
              color: '#fff',
            }}
          />
        )}
      </DialogTitle>

      <DialogContent>
        {/* Progress bar during restore */}
        {restoring && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {t('backupRestoreInProgress')}
            </Typography>
            <LinearProgress
              variant="determinate"
              value={restoreProgress}
              sx={{
                mt: 0.5,
                '& .MuiLinearProgress-bar': { bgcolor: TRENDYOL_ORANGE },
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {Math.round(restoreProgress)}%
            </Typography>
          </Box>
        )}

        {/* Create manual backup button */}
        <Box sx={{ mb: 2 }}>
          <Button
            variant="outlined"
            startIcon={<AddIcon />}
            onClick={handleCreateBackup}
            disabled={restoring || !products || products.length === 0}
            sx={{
              borderColor: TRENDYOL_ORANGE,
              color: TRENDYOL_ORANGE,
              '&:hover': {
                borderColor: TRENDYOL_ORANGE,
                bgcolor: `${TRENDYOL_ORANGE}10`,
              },
            }}
          >
            {t('backupCreateNow')}
          </Button>
        </Box>

        {/* Backup list */}
        {backups.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              {t('backupNone')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('backupAutoHint')}
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('backupDateColumn')}</TableCell>
                  <TableCell>{t('backupOperationType')}</TableCell>
                  <TableCell>{t('backupProductCount')}</TableCell>
                  <TableCell align="right">{t('backupActions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.map((backup) => (
                  <TableRow key={backup.id}>
                    <TableCell>
                      <Typography variant="body2">
                        {formatDate(backup.timestamp)}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={
                          OPERATION_KEYS[backup.operation_type]
                            ? t(OPERATION_KEYS[backup.operation_type])
                            : backup.operation_type
                        }
                        size="small"
                        variant="outlined"
                        sx={{ borderColor: TRENDYOL_ORANGE, color: TRENDYOL_ORANGE }}
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {t('backupProductItem', { count: backup.products.length })}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box
                        sx={{
                          display: 'flex',
                          gap: 0.5,
                          justifyContent: 'flex-end',
                        }}
                      >
                        <Tooltip title={t('backupRestore')}>
                          <IconButton
                            size="small"
                            disabled={restoring}
                            onClick={() => handleRestore(backup)}
                            sx={{ color: TRENDYOL_ORANGE }}
                          >
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('backupDeleteOne')}>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={restoring}
                            onClick={() => handleDeleteOne(backup.id)}
                          >
                            <DeleteSweepIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </DialogContent>

      <DialogActions>
        {backups.length > 0 && (
          <Button
            color="error"
            onClick={handleClear}
            disabled={restoring}
            startIcon={<DeleteSweepIcon />}
            sx={{ mr: 'auto' }}
          >
            {t('backupClearAll')}
          </Button>
        )}
        <Button onClick={onClose} disabled={restoring}>
          {t('backupClose')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
