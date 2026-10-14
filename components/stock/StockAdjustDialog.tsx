import React, { useEffect, useState } from 'react';
import {
  Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';
import { stockErrorKey, stockFetch, type StockItemView } from './stockClient';

export type StockAdjustDialogProps = {
  item: StockItemView | null;
  open: boolean;
  onClose: () => void;
  onSaved?: (onHand: number) => void;
};

/** Set the real count (or add/remove) for a product. First count of a 'needs review' item seeds it. */
export default function StockAdjustDialog({ item, open, onClose, onSaved }: StockAdjustDialogProps) {
  const t = useTranslations('stockSync');
  const firstCount = !!item && !item.seededAt;
  const [mode, setMode] = useState<'set' | 'delta'>('set');
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && item) {
      setMode('set');
      setValue(item.seededAt ? String(item.onHand) : '');
      setNote('');
    }
  }, [open, item]);

  const n = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(n) && (mode === 'set' ? n >= 0 : n !== 0);

  const save = async () => {
    if (!item || !valid) return;
    setSaving(true);
    try {
      const r = await stockFetch<{ onHand: number }>('/api/stock/adjust', {
        method: 'POST',
        body: { stockItemId: item.id, ...(mode === 'set' ? { setTo: n } : { delta: n }), note: note.trim() || undefined },
      });
      notify.success(t('adjust.success', { onHand: r.onHand }));
      onSaved?.(r.onHand);
      onClose();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullWidth maxWidth="xs" sx={{ zIndex: 1550 }}>
      <DialogTitle>{firstCount ? t('items.enterCount') : t('adjust.title')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {item && (
            <Typography variant="body2" color="text.secondary" sx={{ wordBreak: 'break-word' }}>
              {item.displaySku}
              {item.title ? ` · ${item.title}` : ''}
            </Typography>
          )}
          {!firstCount && (
            <ToggleButtonGroup exclusive size="small" value={mode} onChange={(_, v) => v && setMode(v)} fullWidth>
              <ToggleButton value="set">{t('adjust.modeSet')}</ToggleButton>
              <ToggleButton value="delta">{t('adjust.modeDelta')}</ToggleButton>
            </ToggleButtonGroup>
          )}
          <TextField
            autoFocus
            type="number"
            inputMode="numeric"
            label={mode === 'set' ? t('adjust.setTo') : t('adjust.delta')}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
            fullWidth
          />
          <TextField label={t('adjust.note')} value={note} onChange={(e) => setNote(e.target.value)} fullWidth size="small" inputProps={{ maxLength: 200 }} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={save} disabled={!valid || saving}>
          {t('adjust.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
