import React, { useState } from 'react';
import {
  Box, Button, Typography, Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, ToggleButton, ToggleButtonGroup, CircularProgress,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import InventoryIcon from '@mui/icons-material/Inventory';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import DownloadIcon from '@mui/icons-material/Download';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

interface WixBulkOperationsBarProps {
  selectedCount: number;
  selectedProducts: any[];
  onCompleted: () => void;
  onClearSelection: () => void;
}

export default function WixBulkOperationsBar({
  selectedCount, selectedProducts, onCompleted, onClearSelection,
}: WixBulkOperationsBarProps) {
  const t = useTranslations('wixListings');
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [priceMode, setPriceMode] = useState<'set' | 'percent'>('set');
  const [priceValue, setPriceValue] = useState('');
  const [stockValue, setStockValue] = useState('');
  const [processing, setProcessing] = useState(false);

  const productIds = selectedProducts.map(p => p.wixProductId || p.id);

  const handleBulkUpdate = async (updates: Record<string, any>) => {
    setProcessing(true);
    try {
      const res = await fetch('/api/wix/products?action=bulk_update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds, updates }),
      });
      if (!res.ok) throw new Error('Bulk update failed');
      const data = await res.json();
      if (data.failed > 0) {
        toast.error(t('bulkFailed'));
      } else {
        toast.success(t('bulkSuccess', { count: data.succeeded }));
      }
      onCompleted();
      onClearSelection();
    } catch (err: any) {
      toast.error(err.message || t('bulkFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handleBulkDelete = async () => {
    setProcessing(true);
    try {
      const res = await fetch('/api/wix/products?action=bulk_delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productIds }),
      });
      if (!res.ok) throw new Error('Bulk delete failed');
      const data = await res.json();
      toast.success(t('bulkDeleteSuccess', { count: data.succeeded }));
      setDeleteDialogOpen(false);
      onCompleted();
      onClearSelection();
    } catch (err: any) {
      toast.error(err.message || t('bulkFailed'));
    } finally {
      setProcessing(false);
    }
  };

  const handlePriceSubmit = () => {
    const val = parseFloat(priceValue);
    if (isNaN(val)) return;
    if (priceMode === 'set') {
      handleBulkUpdate({ price: val });
    } else {
      // Adjust by percentage — handled server-side or we compute per-product
      const updates = selectedProducts.map(p => ({
        productId: p.wixProductId || p.id,
        price: Math.round(((p.price || 0) * (1 + val / 100)) * 100) / 100,
      }));
      // For percentage, we need individual updates, so do it one by one
      handleBulkUpdate({ pricePercent: val });
    }
    setPriceDialogOpen(false);
    setPriceValue('');
  };

  const handleStockSubmit = () => {
    const val = parseInt(stockValue);
    if (isNaN(val)) return;
    handleBulkUpdate({ quantity: val });
    setStockDialogOpen(false);
    setStockValue('');
  };

  const handleCsvExport = () => {
    const headers = ['Title', 'SKU', 'Price', 'Stock', 'Visible', 'Description'];
    const rows = selectedProducts.map(p => [
      `"${(p.title || '').replace(/"/g, '""')}"`,
      p.sku || '',
      p.price || '',
      p.quantity || 0,
      p.visible ? 'true' : 'false',
      `"${(p.description || '').replace(/"/g, '""').substring(0, 200)}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wix-products-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (selectedCount === 0) return null;

  return (
    <>
      <Box sx={{
        display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1,
        bgcolor: 'primary.main', color: '#fff', borderRadius: 1, mb: 1,
        flexWrap: 'wrap',
      }}>
        <Typography variant="body2" fontWeight={600} sx={{ mr: 1 }}>
          {t('selected', { count: selectedCount })}
        </Typography>
        <Button size="small" variant="outlined" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
          startIcon={<AttachMoneyIcon />} onClick={() => setPriceDialogOpen(true)}>
          {t('bulkPriceUpdate')}
        </Button>
        <Button size="small" variant="outlined" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
          startIcon={<InventoryIcon />} onClick={() => setStockDialogOpen(true)}>
          {t('bulkStockUpdate')}
        </Button>
        <Button size="small" variant="outlined" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
          startIcon={<VisibilityIcon />} onClick={() => handleBulkUpdate({ visible: true })}>
          {t('bulkMakeVisible')}
        </Button>
        <Button size="small" variant="outlined" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
          startIcon={<VisibilityOffIcon />} onClick={() => handleBulkUpdate({ visible: false })}>
          {t('bulkMakeHidden')}
        </Button>
        <Button size="small" variant="outlined" sx={{ color: '#fff', borderColor: 'rgba(255,255,255,0.5)' }}
          startIcon={<DownloadIcon />} onClick={handleCsvExport}>
          {t('csvDownload')}
        </Button>
        <Button size="small" variant="outlined" sx={{ color: '#ff8a80', borderColor: 'rgba(255,138,128,0.5)' }}
          startIcon={<DeleteIcon />} onClick={() => setDeleteDialogOpen(true)}>
          {t('bulkDelete')}
        </Button>
      </Box>

      {/* Price Dialog */}
      <Dialog open={priceDialogOpen} onClose={() => setPriceDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('bulkPriceUpdate')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
          <ToggleButtonGroup
            value={priceMode}
            exclusive
            onChange={(_, v) => v && setPriceMode(v)}
            size="small"
            fullWidth
          >
            <ToggleButton value="set">{t('bulkSetPrice')}</ToggleButton>
            <ToggleButton value="percent">{t('bulkAdjustPrice')}</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            value={priceValue}
            onChange={(e) => setPriceValue(e.target.value)}
            type="number"
            size="small"
            label={priceMode === 'set' ? t('productPrice') : '%'}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPriceDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={handlePriceSubmit} disabled={!priceValue || processing}>
            {processing ? <CircularProgress size={16} /> : t('save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Stock Dialog */}
      <Dialog open={stockDialogOpen} onClose={() => setStockDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('bulkStockUpdate')}</DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <TextField
            value={stockValue}
            onChange={(e) => setStockValue(e.target.value)}
            type="number"
            size="small"
            label={t('stockQuantity')}
            fullWidth
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStockDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={handleStockSubmit} disabled={!stockValue || processing}>
            {processing ? <CircularProgress size={16} /> : t('save')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle color="error">{t('bulkDelete')}</DialogTitle>
        <DialogContent>
          <Typography>{t('bulkDeleteConfirm', { count: selectedCount })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleBulkDelete} disabled={processing}>
            {processing ? <CircularProgress size={16} /> : t('delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
