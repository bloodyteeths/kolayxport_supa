import React, { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemText, Radio,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Typography, useMediaQuery, useTheme,
} from '@mui/material';
import { useTranslations } from 'next-intl';
import { notify } from '@/lib/notify';
import { memberOf, stockErrorKey, stockFetch, swrStockFetcher, type Candidate, type StockItemView } from './stockClient';
import { channelLabel, CHANNEL_COLORS } from './labels';

export type SkuMappingDialogProps = {
  candidate: Candidate | null;
  open: boolean;
  onClose: () => void;
  onLinked: () => void;
};

/** Link one unmatched listing to an existing product, or create a new product SKU for it. */
export default function SkuMappingDialog({ candidate, open, onClose, onLinked }: SkuMappingDialogProps) {
  const t = useTranslations('stockSync');
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [newSku, setNewSku] = useState('');
  const [saving, setSaving] = useState(false);

  const key = open ? `/api/stock/items?limit=1000${q.trim() ? `&q=${encodeURIComponent(q.trim())}` : ''}` : null;
  const { data } = useSWR<{ items: StockItemView[] }>(key, swrStockFetcher, { keepPreviousData: true });

  useEffect(() => {
    if (open) {
      setSelected(null);
      setQ('');
      setNewSku(candidate?.sku || '');
      setMode('existing');
    }
  }, [open, candidate]);

  const items = useMemo(() => (data?.items || []).slice(0, 50), [data]);
  const canSave = !!candidate && (mode === 'existing' ? !!selected : newSku.trim().length > 0);

  const save = async () => {
    if (!candidate || !canSave) return;
    setSaving(true);
    try {
      await stockFetch('/api/stock/links', {
        method: 'POST',
        body: { action: 'link', member: { ...memberOf(candidate), matchType: 'manual' }, ...(mode === 'existing' ? { stockItemId: selected } : { sku: newSku.trim() }) },
      });
      notify.success(t('mapping.success'));
      onLinked();
      onClose();
    } catch (err) {
      notify.error(err, t(stockErrorKey(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} fullScreen={fullScreen} fullWidth maxWidth="sm" sx={{ zIndex: 1550 }}>
      <DialogTitle>{t('mapping.title')}</DialogTitle>
      <DialogContent dividers>
        {candidate && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, minWidth: 0 }}>
            <Chip size="small" label={channelLabel(t as any, candidate.channel)} sx={{ bgcolor: CHANNEL_COLORS[candidate.channel] || 'grey.300', color: '#fff' }} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {candidate.title}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap component="div">
                {[candidate.variantLabel, candidate.sku, t('common.units', { count: candidate.quantity })].filter(Boolean).join(' · ')}
              </Typography>
            </Box>
          </Box>
        )}
        <ToggleButtonGroup exclusive fullWidth size="small" value={mode} onChange={(_, v) => v && setMode(v)} sx={{ mb: 2 }}>
          <ToggleButton value="existing">{t('mapping.existing')}</ToggleButton>
          <ToggleButton value="new">{t('mapping.create')}</ToggleButton>
        </ToggleButtonGroup>
        {mode === 'existing' ? (
          <Stack spacing={1}>
            <TextField size="small" fullWidth placeholder={t('mapping.searchItems')} value={q} onChange={(e) => setQ(e.target.value)} />
            <List dense sx={{ maxHeight: { xs: 'none', sm: 320 }, overflow: 'auto' }}>
              {items.map((it) => (
                <ListItemButton key={it.id} selected={selected === it.id} onClick={() => setSelected(it.id)}>
                  <Radio size="small" checked={selected === it.id} tabIndex={-1} />
                  <ListItemText
                    primary={it.displaySku}
                    secondary={`${it.title || ''}${it.links.length ? ` · ${Array.from(new Set(it.links.map((l) => channelLabel(t as any, l.channel)))).join(', ')}` : ''}`}
                    primaryTypographyProps={{ noWrap: true }}
                    secondaryTypographyProps={{ noWrap: true }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Stack>
        ) : (
          <TextField fullWidth label={t('mapping.newSku')} value={newSku} onChange={(e) => setNewSku(e.target.value)} inputProps={{ maxLength: 120 }} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          {t('common.cancel')}
        </Button>
        <Button variant="contained" onClick={save} disabled={!canSave || saving}>
          {t('mapping.link')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
