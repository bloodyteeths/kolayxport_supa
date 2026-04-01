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
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupListing {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  price: number | null;
  quantity: number;
}

export interface BackupEntry {
  id: string;
  timestamp: number;
  operation_type: string;
  listings: BackupListing[];
}

// ---------------------------------------------------------------------------
// Storage helpers (exported for use in other components)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'etsy_bulk_backups';
const MAX_BACKUPS = 20;

function loadBackups(): BackupEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as BackupEntry[];
  } catch {
    return [];
  }
}

function saveBackups(backups: BackupEntry[]): void {
  // Keep only the most recent MAX_BACKUPS
  const trimmed = backups.slice(0, MAX_BACKUPS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/**
 * Creates a backup of listings before a bulk operation.
 * Call this before performing any bulk update.
 */
export function createBackup(
  operationType: string,
  listings: {
    listing_id: number;
    title: string;
    description: string;
    tags: string[];
    price: any;
    quantity: number;
  }[]
): void {
  const entry: BackupEntry = {
    id: `backup_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    timestamp: Date.now(),
    operation_type: operationType,
    listings: listings.map((l) => ({
      listing_id: l.listing_id,
      title: l.title,
      description: l.description,
      tags: l.tags,
      price:
        l.price && typeof l.price === 'object' && 'amount' in l.price
          ? l.price.amount / l.price.divisor
          : typeof l.price === 'number'
            ? l.price
            : null,
      quantity: l.quantity,
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
  bulk_update: 'opBulkUpdate',
  find_replace: 'opFindReplace',
  csv_import: 'opCsvImport',
  merge: 'opMerge',
  bulk_delete: 'opBulkDelete',
  bulk_price: 'opBulkPrice',
  bulk_tags: 'opBulkTags',
  bulk_state: 'opBulkState',
  bulk_section: 'opBulkSection',
};

function formatDate(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface BackupManagerProps {
  open: boolean;
  onClose: () => void;
  shopId: string;
  onRestored: () => void;
}

export default function BackupManager({
  open,
  onClose,
  shopId,
  onRestored,
}: BackupManagerProps) {
  const t = useTranslations('etsy.backup');
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [restoring, setRestoring] = useState(false);
  const [restoreProgress, setRestoreProgress] = useState(0);

  const refresh = useCallback(() => {
    setBackups(loadBackups());
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleRestore = async (backup: BackupEntry) => {
    if (!shopId) {
      toast.error(t('noShopSelected'));
      return;
    }

    setRestoring(true);
    setRestoreProgress(0);

    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < backup.listings.length; i++) {
      const listing = backup.listings[i];
      const body: Record<string, any> = {
        title: listing.title,
        description: listing.description,
        tags: listing.tags,
      };
      if (listing.price !== null) body.price = listing.price;
      if (listing.quantity !== undefined) body.quantity = listing.quantity;

      try {
        const res = await fetch(
          `/api/clawd/etsy?action=update_listing&listing_id=${listing.listing_id}&shop_id=${shopId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          }
        );
        if (res.ok) succeeded++;
        else failed++;
      } catch {
        failed++;
      }

      setRestoreProgress(((i + 1) / backup.listings.length) * 100);

      // Rate limit
      if (i < backup.listings.length - 1) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    setRestoring(false);
    setRestoreProgress(0);

    if (failed === 0) {
      toast.success(t('restoreComplete', { count: succeeded }));
    } else {
      toast.error(t('restorePartial', { success: succeeded, failed }));
    }

    onRestored();
  };

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setBackups([]);
    toast.success(t('allCleared'));
  };

  const handleDeleteOne = (id: string) => {
    const updated = backups.filter((b) => b.id !== id);
    saveBackups(updated);
    setBackups(updated);
  };

  return (
    <Dialog open={open} onClose={restoring ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <BackupIcon sx={{ color: 'info.main' }} />
        {t('title')}
        {backups.length > 0 && (
          <Chip label={t('backupCount', { count: backups.length })} size="small" color="info" sx={{ ml: 1 }} />
        )}
      </DialogTitle>
      <DialogContent>
        {restoring && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" color="text.secondary">
              {t('restoreInProgress')}
            </Typography>
            <LinearProgress variant="determinate" value={restoreProgress} sx={{ mt: 0.5 }} />
            <Typography variant="caption" color="text.secondary">
              {t('percentComplete', { pct: Math.round(restoreProgress) })}
            </Typography>
          </Box>
        )}

        {backups.length === 0 ? (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body1" color="text.secondary">
              {t('noBackups')}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t('autoBackupHint')}
            </Typography>
          </Box>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('dateColumn')}</TableCell>
                  <TableCell>{t('operationType')}</TableCell>
                  <TableCell>{t('listingCount')}</TableCell>
                  <TableCell align="right">{t('actionsColumn')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {backups.map((backup) => (
                  <TableRow key={backup.id}>
                    <TableCell>
                      <Typography variant="body2">{formatDate(backup.timestamp)}</Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={
                          OPERATION_KEYS[backup.operation_type] ? t(OPERATION_KEYS[backup.operation_type]) : backup.operation_type
                        }
                        size="small"
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {t('listingItem', { count: backup.listings.length })}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                        <Tooltip title={t('restore')}>
                          <IconButton
                            size="small"
                            color="primary"
                            disabled={restoring}
                            onClick={() => handleRestore(backup)}
                          >
                            <RestoreIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title={t('deleteOne')}>
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
            {t('clearAll')}
          </Button>
        )}
        <Button onClick={onClose} disabled={restoring}>
          {t('close')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
