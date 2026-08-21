import React, { useState } from 'react';
import { Box, Popover, TextField, MenuItem, Button, Typography, Chip } from '@mui/material';
import { useTranslations } from 'next-intl';
import { toast } from 'react-hot-toast';

const CURRENCY_SYMBOLS: Record<string, string> = { TRY: '₺', USD: '$', EUR: '€', GBP: '£' };

interface Props {
  orderId: string;
  cost: number | null;
  currency: string | null;
  size?: 'small' | 'medium';
}

/**
 * Inline editor for the order's actual carrier cost. Carriers only reveal the
 * real price on their invoice, so this is manual by design. Used by both the
 * desktop DataGrid column and the mobile order cards.
 */
export default function ShippingCostCell({ orderId, cost, currency, size = 'small' }: Props) {
  const t = useTranslations('labels');
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [value, setValue] = useState<{ cost: number | null; currency: string | null }>({ cost, currency });
  const [draft, setDraft] = useState('');
  const [draftCurrency, setDraftCurrency] = useState('TRY');
  const [saving, setSaving] = useState(false);

  const open = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    setDraft(value.cost != null ? String(value.cost) : '');
    setDraftCurrency(value.currency || 'TRY');
    setAnchorEl(e.currentTarget);
  };

  const persist = async (newCost: number | null, newCurrency: string | null) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/shipping-cost`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ cost: newCost, currency: newCurrency }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setValue({ cost: data.manualShippingCost, currency: data.manualShippingCostCurrency });
      setAnchorEl(null);
      toast.success(t('shippingCostSaved'));
    } catch (err: any) {
      toast.error(err.message || 'Error');
    } finally {
      setSaving(false);
    }
  };

  const handleSave = () => {
    const parsed = parseFloat(draft.replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      toast.error(t('shippingCostInvalid'));
      return;
    }
    persist(parsed, draftCurrency);
  };

  const symbol = CURRENCY_SYMBOLS[value.currency || ''] || value.currency || '';

  return (
    <>
      {value.cost != null ? (
        <Chip
          label={`🚚 ${symbol}${Number(value.cost).toFixed(2)}`}
          size="small"
          onClick={open}
          sx={{ height: 18, fontSize: '0.6rem', fontWeight: 700, cursor: 'pointer', bgcolor: '#e0f2fe', color: '#0369a1' }}
        />
      ) : (
        <Button size="small" onClick={open} sx={{ minWidth: 0, textTransform: 'none', fontSize: '0.62rem', lineHeight: 1, color: 'text.secondary', border: '1px dashed', borderColor: 'divider', borderRadius: '9px', px: 0.6, py: 0.2 }}>
          {t('addShippingCost')}
        </Button>
      )}
      <Popover
        open={!!anchorEl}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 1.5, width: 240 }}>
          <Typography variant="caption" color="text.secondary">{t('shippingCostHint')}</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              autoFocus
              size="small"
              type="number"
              inputProps={{ min: 0, step: '0.01' }}
              label={t('shippingCostLabel')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              sx={{ flex: 1 }}
            />
            <TextField select size="small" value={draftCurrency} onChange={(e) => setDraftCurrency(e.target.value)} sx={{ width: 84 }}>
              {Object.keys(CURRENCY_SYMBOLS).map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
            {value.cost != null && (
              <Button size="small" color="error" disabled={saving} onClick={() => persist(null, null)}>
                {t('shippingCostClear')}
              </Button>
            )}
            <Button size="small" variant="contained" disabled={saving} onClick={handleSave}>
              {t('shippingCostSave')}
            </Button>
          </Box>
        </Box>
      </Popover>
    </>
  );
}
