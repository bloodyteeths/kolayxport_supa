import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  IconButton,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Chip,
  Divider,
  TextField,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { stageEtsyDraft } from '@/lib/etsy/draftClient';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScheduledChanges {
  title?: string;
  description?: string;
  tags?: string[];
  price?: string;
  quantity?: number;
}

export interface ScheduledUpdate {
  id: string;
  listing_id: string;
  shop_id: string;
  scheduled_at: string; // ISO string
  changes: ScheduledChanges;
  created_at: string; // ISO string
}

interface ScheduledUpdateDialogProps {
  open: boolean;
  onClose: () => void;
  listingId: string;
  shopId: string;
  listingTitle?: string;
  changes: ScheduledChanges;
  onScheduled: () => void;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'etsy_scheduled_updates';

function getScheduledUpdates(): ScheduledUpdate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveScheduledUpdates(updates: ScheduledUpdate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updates));
}

export function getScheduledUpdatesForListing(listingId: string): ScheduledUpdate[] {
  return getScheduledUpdates().filter((u) => u.listing_id === listingId);
}

export function cancelScheduledUpdate(id: string) {
  const updates = getScheduledUpdates().filter((u) => u.id !== id);
  saveScheduledUpdates(updates);
}

// ---------------------------------------------------------------------------
// Hook: polls every 30s and executes due updates
// ---------------------------------------------------------------------------

export function useScheduledUpdateExecutor() {
  const t = useTranslations('etsy.scheduledUpdate');

  useEffect(() => {
    const execute = async () => {
      const updates = getScheduledUpdates();
      const now = new Date().getTime();
      const due = updates.filter((u) => new Date(u.scheduled_at).getTime() <= now);

      if (due.length === 0) return;

      for (const update of due) {
        try {
          const payload: Record<string, any> = {};
          if (update.changes.title !== undefined) payload.title = update.changes.title;
          if (update.changes.description !== undefined) payload.description = update.changes.description;
          if (update.changes.tags !== undefined) payload.tags = update.changes.tags;
          if (update.changes.price !== undefined) payload.price = update.changes.price;
          if (update.changes.quantity !== undefined) payload.quantity = update.changes.quantity;

          await stageEtsyDraft({ shopId: update.shop_id, listingId: update.listing_id, fields: payload });

          toast.success(t('toastApplied', { listingId: update.listing_id }));
        } catch (err: any) {
          toast.error(t('toastFailed', { message: err.message }));
        }
      }

      // Remove executed updates
      const remaining = updates.filter((u) => new Date(u.scheduled_at).getTime() > now);
      saveScheduledUpdates(remaining);
    };

    // Run immediately, then every 30 seconds
    execute();
    const interval = setInterval(execute, 30_000);
    return () => clearInterval(interval);
  }, [t]);
}

// ---------------------------------------------------------------------------
// Helper: format date for display
// ---------------------------------------------------------------------------

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Minimum datetime (now + 1 minute) for the picker
function getMinDateTime(): string {
  const d = new Date(Date.now() + 60_000);
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ScheduledUpdateDialog({
  open,
  onClose,
  listingId,
  shopId,
  listingTitle,
  changes,
  onScheduled,
}: ScheduledUpdateDialogProps) {
  const t = useTranslations('etsy.scheduledUpdate');
  const [scheduledAt, setScheduledAt] = useState('');
  const [pendingUpdates, setPendingUpdates] = useState<ScheduledUpdate[]>([]);

  // Load pending updates when dialog opens
  useEffect(() => {
    if (open) {
      setPendingUpdates(getScheduledUpdatesForListing(listingId));
      setScheduledAt('');
    }
  }, [open, listingId]);

  const hasChangeFields = Object.keys(changes).length > 0;

  const formatChangeSummary = useCallback((ch: ScheduledChanges): string => {
    const parts: string[] = [];
    if (ch.title !== undefined) parts.push(t('changeSummaryTitle'));
    if (ch.description !== undefined) parts.push(t('changeSummaryDescription'));
    if (ch.tags !== undefined) parts.push(t('changeSummaryTags'));
    if (ch.price !== undefined) parts.push(t('changeSummaryPrice'));
    if (ch.quantity !== undefined) parts.push(t('changeSummaryQuantity'));
    return parts.join(', ');
  }, [t]);

  const handleSchedule = useCallback(() => {
    if (!scheduledAt) {
      toast.error(t('toastSelectDateTime'));
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate.getTime() <= Date.now()) {
      toast.error(t('toastFutureRequired'));
      return;
    }

    if (!hasChangeFields) {
      toast.error(t('toastNoChanges'));
      return;
    }

    const newUpdate: ScheduledUpdate = {
      id: `${listingId}_${Date.now()}`,
      listing_id: listingId,
      shop_id: shopId,
      scheduled_at: scheduledDate.toISOString(),
      changes,
      created_at: new Date().toISOString(),
    };

    const allUpdates = getScheduledUpdates();
    allUpdates.push(newUpdate);
    saveScheduledUpdates(allUpdates);

    setPendingUpdates(getScheduledUpdatesForListing(listingId));
    toast.success(t('toastScheduled'));
    onScheduled();
    onClose();
  }, [scheduledAt, changes, listingId, shopId, hasChangeFields, onScheduled, onClose, t]);

  const handleCancel = useCallback((id: string) => {
    cancelScheduledUpdate(id);
    setPendingUpdates((prev) => prev.filter((u) => u.id !== id));
    toast.success(t('toastCancelled'));
  }, [t]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ScheduleIcon color="primary" />
        <Box sx={{ flex: 1 }}>{t('dialogTitle')}</Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </DialogTitle>

      <DialogContent dividers>
        {/* Current changes to schedule */}
        {hasChangeFields ? (
          <Box sx={{ mb: 3 }}>
            {listingTitle && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {listingTitle}
              </Typography>
            )}
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('changesToSchedule')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {changes.title !== undefined && <Chip label={t('titleChip')} size="small" color="primary" variant="outlined" />}
              {changes.description !== undefined && <Chip label={t('descriptionChip')} size="small" color="primary" variant="outlined" />}
              {changes.tags !== undefined && <Chip label={t('tagsChip')} size="small" color="primary" variant="outlined" />}
              {changes.price !== undefined && <Chip label={t('priceChip', { price: changes.price })} size="small" color="primary" variant="outlined" />}
              {changes.quantity !== undefined && <Chip label={t('quantityChip', { quantity: changes.quantity })} size="small" color="primary" variant="outlined" />}
            </Box>

            <TextField
              label={t('dateTimeLabel')}
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              fullWidth
              sx={{ mt: 2 }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: getMinDateTime() }}
            />
          </Box>
        ) : (
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {t('noChanges')}
          </Typography>
        )}

        {/* Pending scheduled updates */}
        {pendingUpdates.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('pendingUpdates', { count: pendingUpdates.length })}
            </Typography>
            <List dense disablePadding>
              {pendingUpdates.map((update) => (
                <ListItem
                  key={update.id}
                  sx={{
                    bgcolor: 'action.hover',
                    borderRadius: 1,
                    mb: 0.5,
                  }}
                >
                  <ListItemText
                    primary={formatDateTime(update.scheduled_at)}
                    secondary={formatChangeSummary(update.changes)}
                    primaryTypographyProps={{ variant: 'body2', fontWeight: 600 }}
                    secondaryTypographyProps={{ variant: 'caption' }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      color="error"
                      onClick={() => handleCancel(update.id)}
                      title={t('cancelTooltip')}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t('cancelButton')}</Button>
        <Button
          variant="contained"
          onClick={handleSchedule}
          disabled={!hasChangeFields || !scheduledAt}
          startIcon={<ScheduleIcon />}
        >
          {t('scheduleButton')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
