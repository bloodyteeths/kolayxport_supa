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

          const res = await fetch(
            `/api/clawd/etsy?action=update_listing&listing_id=${update.listing_id}&shop_id=${update.shop_id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            },
          );

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
          }

          toast.success(`Zamanlanmis guncelleme uygulandi (Listing ${update.listing_id})`);
        } catch (err: any) {
          toast.error(`Zamanlanmis guncelleme basarisiz: ${err.message}`);
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
  }, []);
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

function formatChangeSummary(changes: ScheduledChanges): string {
  const parts: string[] = [];
  if (changes.title !== undefined) parts.push('baslik');
  if (changes.description !== undefined) parts.push('aciklama');
  if (changes.tags !== undefined) parts.push('etiketler');
  if (changes.price !== undefined) parts.push('fiyat');
  if (changes.quantity !== undefined) parts.push('stok');
  return parts.join(', ');
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

  const handleSchedule = useCallback(() => {
    if (!scheduledAt) {
      toast.error('Lutfen bir tarih ve saat secin');
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate.getTime() <= Date.now()) {
      toast.error('Zamanlama gelecekte olmalidir');
      return;
    }

    if (!hasChangeFields) {
      toast.error('Zamanlanacak degisiklik yok');
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
    toast.success('Guncelleme zamanlandi');
    onScheduled();
    onClose();
  }, [scheduledAt, changes, listingId, shopId, hasChangeFields, onScheduled, onClose]);

  const handleCancel = useCallback((id: string) => {
    cancelScheduledUpdate(id);
    setPendingUpdates((prev) => prev.filter((u) => u.id !== id));
    toast.success('Zamanlanmis guncelleme iptal edildi');
  }, []);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <ScheduleIcon color="primary" />
        <Box sx={{ flex: 1 }}>Guncellemeyi Zamanla</Box>
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
              Zamanlanacak degisiklikler:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {changes.title !== undefined && <Chip label="Baslik" size="small" color="primary" variant="outlined" />}
              {changes.description !== undefined && <Chip label="Aciklama" size="small" color="primary" variant="outlined" />}
              {changes.tags !== undefined && <Chip label="Etiketler" size="small" color="primary" variant="outlined" />}
              {changes.price !== undefined && <Chip label={`Fiyat: ${changes.price}`} size="small" color="primary" variant="outlined" />}
              {changes.quantity !== undefined && <Chip label={`Stok: ${changes.quantity}`} size="small" color="primary" variant="outlined" />}
            </Box>

            <TextField
              label="Tarih & Saat"
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
            Zamanlanacak degisiklik yok. Oncelikle alanlarda degisiklik yapin.
          </Typography>
        )}

        {/* Pending scheduled updates */}
        {pendingUpdates.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              Zamanlanan Guncellemeler ({pendingUpdates.length})
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
                      title="Iptal Et"
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
        <Button onClick={onClose}>Iptal Et</Button>
        <Button
          variant="contained"
          onClick={handleSchedule}
          disabled={!hasChangeFields || !scheduledAt}
          startIcon={<ScheduleIcon />}
        >
          Zamanla
        </Button>
      </DialogActions>
    </Dialog>
  );
}
