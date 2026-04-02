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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import ScheduleIcon from '@mui/icons-material/Schedule';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EbayScheduledChanges {
  price?: number;
  quantity?: number;
  action_type: 'update_offer' | 'update_inventory_item';
}

export interface EbayScheduledUpdate {
  id: string;
  sku: string;
  offer_id?: string;
  listing_title: string;
  scheduled_at: string; // ISO string
  changes: EbayScheduledChanges;
  created_at: string; // ISO string
  user_id: string;
}

interface ScheduledUpdateDialogProps {
  open: boolean;
  onClose: () => void;
  listings: any[];
  userId: string;
  onExecuted: () => void;
}

// ---------------------------------------------------------------------------
// localStorage helpers
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'ebay_scheduled_updates';

function getScheduledUpdates(): EbayScheduledUpdate[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveScheduledUpdates(updates: EbayScheduledUpdate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updates));
}

export function getScheduledUpdatesForSku(sku: string): EbayScheduledUpdate[] {
  return getScheduledUpdates().filter((u) => u.sku === sku);
}

export function cancelScheduledUpdate(id: string) {
  const updates = getScheduledUpdates().filter((u) => u.id !== id);
  saveScheduledUpdates(updates);
}

// ---------------------------------------------------------------------------
// Hook: polls every 30s and executes due updates
// ---------------------------------------------------------------------------

export function useEbayScheduledUpdateExecutor(userId: string, onExecuted?: () => void) {
  useEffect(() => {
    if (!userId) return;

    const execute = async () => {
      const updates = getScheduledUpdates();
      const now = Date.now();
      const due = updates.filter(
        (u) => u.user_id === userId && new Date(u.scheduled_at).getTime() <= now,
      );

      if (due.length === 0) return;

      for (const update of due) {
        try {
          const action = update.changes.action_type;
          let url = `/api/clawd/ebay?action=${action}&user_id=${userId}`;

          const payload: Record<string, any> = {};

          if (action === 'update_offer' && update.offer_id) {
            url += `&offer_id=${update.offer_id}`;
            if (update.changes.price != null) {
              payload.price = update.changes.price;
            }
            if (update.changes.quantity != null) {
              payload.quantity = update.changes.quantity;
            }
          } else if (action === 'update_inventory_item') {
            url += `&sku=${encodeURIComponent(update.sku)}`;
            if (update.changes.quantity != null) {
              payload.quantity = update.changes.quantity;
            }
          }

          const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || `HTTP ${res.status}`);
          }

          // Toast uses raw string here since hook has no access to t()
          toast.success(`Scheduled update applied: ${update.listing_title}`);
        } catch (err: any) {
          toast.error(`Scheduled update failed (${update.listing_title}): ${err.message}`);
        }
      }

      // Remove executed updates
      const remaining = updates.filter(
        (u) => !(u.user_id === userId && new Date(u.scheduled_at).getTime() <= now),
      );
      saveScheduledUpdates(remaining);

      if (onExecuted) onExecuted();
    };

    // Run immediately, then every 30 seconds
    execute();
    const interval = setInterval(execute, 30_000);
    return () => clearInterval(interval);
  }, [userId, onExecuted]);
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
  listings,
  userId,
  onExecuted,
}: ScheduledUpdateDialogProps) {
  const t = useTranslations('ebayScheduled');
  const [scheduledAt, setScheduledAt] = useState('');
  const [selectedSku, setSelectedSku] = useState('');
  const [actionType, setActionType] = useState<'update_offer' | 'update_inventory_item'>('update_offer');
  const [newPrice, setNewPrice] = useState('');
  const [newQuantity, setNewQuantity] = useState('');
  const [pendingUpdates, setPendingUpdates] = useState<EbayScheduledUpdate[]>([]);

  // Load pending updates when dialog opens
  useEffect(() => {
    if (open) {
      setPendingUpdates(getScheduledUpdates().filter((u) => u.user_id === userId));
      setScheduledAt('');
      setSelectedSku('');
      setNewPrice('');
      setNewQuantity('');
      setActionType('update_offer');
    }
  }, [open, userId]);

  const selectedListing = listings.find((l: any) => l.sku === selectedSku);

  const hasChanges = newPrice.trim() !== '' || newQuantity.trim() !== '';

  const formatChangeSummary = useCallback((changes: EbayScheduledChanges): string => {
    const parts: string[] = [];
    if (changes.price != null) parts.push(t('priceLabel', { price: changes.price.toFixed(2) }));
    if (changes.quantity != null) parts.push(t('stockLabel', { quantity: changes.quantity }));
    return parts.join(', ');
  }, [t]);

  const handleSchedule = useCallback(() => {
    if (!scheduledAt) {
      toast.error(t('selectDate'));
      return;
    }

    const scheduledDate = new Date(scheduledAt);
    if (scheduledDate.getTime() <= Date.now()) {
      toast.error(t('futureDate'));
      return;
    }

    if (!selectedSku) {
      toast.error(t('selectListingError'));
      return;
    }

    if (!hasChanges) {
      toast.error(t('noChanges'));
      return;
    }

    const changes: EbayScheduledChanges = {
      action_type: actionType,
    };
    if (newPrice.trim()) changes.price = parseFloat(newPrice);
    if (newQuantity.trim()) changes.quantity = parseInt(newQuantity, 10);

    const newUpdate: EbayScheduledUpdate = {
      id: `${selectedSku}_${Date.now()}`,
      sku: selectedSku,
      offer_id: selectedListing?.offerId,
      listing_title: selectedListing?.title || selectedSku,
      scheduled_at: scheduledDate.toISOString(),
      changes,
      created_at: new Date().toISOString(),
      user_id: userId,
    };

    const allUpdates = getScheduledUpdates();
    allUpdates.push(newUpdate);
    saveScheduledUpdates(allUpdates);

    setPendingUpdates(getScheduledUpdates().filter((u) => u.user_id === userId));
    toast.success(t('updateScheduled'));

    // Reset form
    setNewPrice('');
    setNewQuantity('');
    setScheduledAt('');
    setSelectedSku('');
  }, [scheduledAt, selectedSku, actionType, newPrice, newQuantity, selectedListing, userId, hasChanges, t]);

  const handleCancel = useCallback((id: string) => {
    cancelScheduledUpdate(id);
    setPendingUpdates((prev) => prev.filter((u) => u.id !== id));
    toast.success(t('updateCancelled'));
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
        {/* Select listing */}
        <FormControl fullWidth size="small" sx={{ mb: 2 }}>
          <InputLabel>{t('selectListing')}</InputLabel>
          <Select
            label={t('selectListing')}
            value={selectedSku}
            onChange={(e) => setSelectedSku(e.target.value)}
          >
            {listings.map((listing: any) => (
              <MenuItem key={listing.sku} value={listing.sku}>
                {listing.title ? `${listing.title.substring(0, 60)}` : listing.sku}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {selectedSku && (
          <>
            {/* Action type */}
            <FormControl fullWidth size="small" sx={{ mb: 2 }}>
              <InputLabel>{t('actionType')}</InputLabel>
              <Select
                label={t('actionType')}
                value={actionType}
                onChange={(e) => setActionType(e.target.value as any)}
              >
                <MenuItem value="update_offer">{t('actionUpdateOffer')}</MenuItem>
                <MenuItem value="update_inventory_item">{t('actionUpdateInventory')}</MenuItem>
              </Select>
            </FormControl>

            {/* Price change */}
            {actionType === 'update_offer' && (
              <TextField
                label={t('newPrice')}
                type="number"
                size="small"
                fullWidth
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                sx={{ mb: 2 }}
                inputProps={{ min: 0, step: 0.01 }}
                placeholder={selectedListing?.price ? t('currentPrice', { price: selectedListing.price }) : t('pricePlaceholder')}
              />
            )}

            {/* Quantity change */}
            <TextField
              label={t('newQuantity')}
              type="number"
              size="small"
              fullWidth
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              sx={{ mb: 2 }}
              inputProps={{ min: 0 }}
              placeholder={selectedListing?.quantity != null ? t('currentQuantity', { quantity: selectedListing.quantity }) : t('quantityPlaceholder')}
            />

            {/* Date picker */}
            <TextField
              label={t('dateTime')}
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              fullWidth
              size="small"
              sx={{ mb: 2 }}
              InputLabelProps={{ shrink: true }}
              inputProps={{ min: getMinDateTime() }}
            />

            {/* Change preview */}
            {hasChanges && (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ width: '100%', mb: 0.5 }}>
                  {t('scheduledChanges')}
                </Typography>
                {newPrice.trim() && (
                  <Chip label={t('priceChange', { price: parseFloat(newPrice).toFixed(2) })} size="small" color="primary" variant="outlined" />
                )}
                {newQuantity.trim() && (
                  <Chip label={t('stockChange', { quantity: newQuantity })} size="small" color="primary" variant="outlined" />
                )}
              </Box>
            )}
          </>
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
                    primary={
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="body2" fontWeight={600}>
                          {formatDateTime(update.scheduled_at)}
                        </Typography>
                        <Chip
                          label={update.changes.action_type === 'update_offer' ? t('actionOffer') : t('actionInventory')}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: '0.8rem', height: 24 }}
                        />
                      </Box>
                    }
                    secondary={
                      <Typography variant="caption" color="text.secondary">
                        {update.listing_title.substring(0, 50)}
                        {update.listing_title.length > 50 ? '...' : ''} — {formatChangeSummary(update.changes)}
                      </Typography>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      size="small"
                      color="error"
                      onClick={() => handleCancel(update.id)}
                      title={t('cancelUpdate')}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          </>
        )}

        {pendingUpdates.length === 0 && !selectedSku && (
          <Alert severity="info" sx={{ mt: 1 }}>
            {t('noScheduledUpdates')}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleSchedule}
          disabled={!hasChanges || !scheduledAt || !selectedSku}
          startIcon={<ScheduleIcon />}
        >
          {t('schedule')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
