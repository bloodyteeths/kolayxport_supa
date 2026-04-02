import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer, Box, Typography, TextField, Button, IconButton,
  InputAdornment, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, CircularProgress, Divider,
  Select, MenuItem, FormControl, InputLabel, Tabs, Tab, Autocomplete,
} from '@mui/material';
import { X, Search, Save, Upload, Plus, Package } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import useFinanceStore from '@/lib/stores/useFinanceStore';
import type { SoldProduct } from '@/lib/stores/useFinanceStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function CostEntryDrawer({ open, onClose }: Props) {
  const t = useTranslations('financials');
  const {
    marketplace, productCosts, costsLoading,
    soldProducts, soldProductsLoading,
    fetchProductCosts, createProductCost, updateProductCost, bulkCreateCosts,
    fetchSoldProducts,
  } = useFinanceStore();

  const [search, setSearch] = useState('');
  const [tab, setTab] = useState(0); // 0 = individual, 1 = bulk CSV
  const [csvText, setCsvText] = useState('');

  // New entry form
  const [newBarcode, setNewBarcode] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<SoldProduct | null>(null);
  const [newName, setNewName] = useState('');
  const [newCost, setNewCost] = useState('');
  const [newCurrency, setNewCurrency] = useState('TRY');
  const [newNotes, setNewNotes] = useState('');

  // Inline edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCost, setEditCost] = useState('');
  const [editShipping, setEditShipping] = useState('');

  useEffect(() => {
    if (open) {
      fetchProductCosts(search);
      fetchSoldProducts();
    }
  }, [open, marketplace]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = useCallback(() => {
    fetchProductCosts(search);
  }, [search, fetchProductCosts]);

  const handleCreate = async () => {
    if (!newCost.trim()) {
      toast.error(t('barcodeAndCostRequired'));
      return;
    }
    const productName = newName.trim() || newBarcode.trim() || '';
    if (!productName) {
      toast.error(t('barcodeAndCostRequired'));
      return;
    }
    try {
      await createProductCost({
        barcode: newBarcode.trim() || null,
        productName,
        costAmount: parseFloat(newCost),
        costCurrency: newCurrency,
        shippingCost: null,
        notes: newNotes || null,
      });
      toast.success(t('costAdded'));
      setNewBarcode(''); setNewName(''); setNewCost(''); setNewNotes('');
      setSelectedProduct(null);
      fetchProductCosts(search);
    } catch {
      toast.error(t('costAddFailed'));
    }
  };

  const handleInlineSave = async (id: string) => {
    try {
      await updateProductCost(id, parseFloat(editCost), editShipping ? parseFloat(editShipping) : undefined);
      toast.success(t('updated'));
      setEditingId(null);
      fetchProductCosts(search);
    } catch {
      toast.error(t('updateFailed'));
    }
  };

  const handleBulkImport = async () => {
    const lines = csvText.trim().split('\n').filter(l => l.trim());
    if (lines.length === 0) { toast.error(t('csvEmpty')); return; }

    const items = lines.map(line => {
      const parts = line.split(',').map(s => s.trim());
      return {
        barcode: parts[0],
        productName: parts[1] || parts[0],
        costAmount: parseFloat(parts[2] || '0'),
        shippingCost: parts[3] ? parseFloat(parts[3]) : null,
        costCurrency: 'TRY',
      };
    }).filter(item => item.barcode && !isNaN(item.costAmount));

    if (items.length === 0) { toast.error(t('noValidRows')); return; }

    try {
      await bulkCreateCosts(items);
      toast.success(`${items.length} ${t('bulkSaved')}`);
      setCsvText('');
      fetchProductCosts(search);
    } catch {
      toast.error(t('bulkFailed'));
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 520 }, p: 0 } }}
    >
      {/* Header */}
      <Box sx={{
        p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid #f1f5f9',
        background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Package size={20} color="#8b5cf6" />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{t('productCosts')}</Typography>
        </Box>
        <IconButton size="small" onClick={onClose}><X size={18} /></IconButton>
      </Box>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ px: 2, borderBottom: '1px solid #f1f5f9' }}>
        <Tab label={t('individual')} sx={{ textTransform: 'none', fontWeight: 600 }} />
        <Tab label={t('bulkCSV')} sx={{ textTransform: 'none', fontWeight: 600 }} />
      </Tabs>

      <Box sx={{ overflow: 'auto', flex: 1 }}>
        {tab === 0 ? (
          <Box sx={{ p: 2 }}>
            {/* New Entry Form */}
            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mb: 1, display: 'block' }}>
              {t('addNewCost')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1, mb: 1.5 }}>
              <Autocomplete
                sx={{ gridColumn: '1 / -1' }}
                size="small"
                freeSolo
                options={soldProducts}
                loading={soldProductsLoading}
                loadingText={t('loadingSoldProducts')}
                noOptionsText={t('noSoldProducts')}
                value={selectedProduct}
                inputValue={newName}
                onInputChange={(_, value) => setNewName(value)}
                onChange={(_, value) => {
                  if (value && typeof value !== 'string') {
                    setSelectedProduct(value);
                    setNewName(value.productName);
                    if (value.barcode) setNewBarcode(value.barcode);
                  } else {
                    setSelectedProduct(null);
                    if (typeof value === 'string') setNewName(value);
                  }
                }}
                getOptionLabel={(option) =>
                  typeof option === 'string' ? option : option.productName
                }
                renderOption={(props, option) => (
                  <li {...props} key={`${option.barcode}-${option.productName}`}>
                    <Box>
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {option.productName}
                      </Typography>
                      {option.barcode && (
                        <Typography variant="caption" color="text.secondary">
                          {option.barcode}
                        </Typography>
                      )}
                    </Box>
                  </li>
                )}
                isOptionEqualToValue={(option, value) =>
                  option.barcode === value.barcode && option.productName === value.productName
                }
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('selectOrTypeProduct')}
                    placeholder={t('productName')}
                  />
                )}
                slotProps={{
                  popper: { sx: { zIndex: 1500 } },
                }}
              />
              <TextField size="small" label={t('barcodeRequired')} value={newBarcode} onChange={e => setNewBarcode(e.target.value)} />
              <TextField
                size="small" label={t('costRequired')} type="number" value={newCost}
                onChange={e => setNewCost(e.target.value)}
                InputProps={{ startAdornment: <InputAdornment position="start">₺</InputAdornment> }}
              />
              <FormControl size="small">
                <InputLabel>{t('currency')}</InputLabel>
                <Select value={newCurrency} onChange={e => setNewCurrency(e.target.value)} label={t('currency')}>
                  <MenuItem value="TRY">₺ TRY</MenuItem>
                  <MenuItem value="USD">$ USD</MenuItem>
                  <MenuItem value="EUR">€ EUR</MenuItem>
                </Select>
              </FormControl>
              <TextField size="small" label={t('note')} value={newNotes} onChange={e => setNewNotes(e.target.value)} />
            </Box>
            <Button
              size="small" variant="contained" fullWidth
              startIcon={<Plus size={14} />}
              onClick={handleCreate}
              sx={{ mb: 2, background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', borderRadius: '8px', textTransform: 'none' }}
            >
              {t('add')}
            </Button>

            <Divider sx={{ mb: 2 }} />

            {/* Existing Costs */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <TextField
                size="small" fullWidth placeholder={t('searchProductOrBarcode')}
                value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                InputProps={{ startAdornment: <InputAdornment position="start"><Search size={14} /></InputAdornment> }}
              />
              <Button size="small" variant="outlined" onClick={handleSearch} sx={{ minWidth: 'auto', px: 1.5 }}>
                {t('search')}
              </Button>
            </Box>

            {costsLoading ? (
              <Box sx={{ py: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>
            ) : productCosts.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
                {t('noCostRecords')}
              </Typography>
            ) : (
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('product')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('cost')}</TableCell>
                      <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('shipping')}</TableCell>
                      <TableCell align="center" sx={{ fontWeight: 700, fontSize: '0.7rem' }}></TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {productCosts.map(pc => (
                      <TableRow key={pc.id} hover>
                        <TableCell sx={{ maxWidth: 180 }}>
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {pc.productName}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.6rem' }}>
                            {pc.barcode}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {editingId === pc.id ? (
                            <TextField
                              size="small" autoFocus value={editCost}
                              onChange={e => setEditCost(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleInlineSave(pc.id)}
                              sx={{ width: 80, '& input': { fontSize: '0.75rem', textAlign: 'right' } }}
                            />
                          ) : (
                            <Typography
                              variant="body2" sx={{ fontSize: '0.75rem', cursor: 'pointer', '&:hover': { color: '#8b5cf6' } }}
                              onClick={() => { setEditingId(pc.id); setEditCost(String(pc.costAmount)); setEditShipping(String(pc.shippingCost || 0)); }}
                            >
                              ₺{pc.costAmount}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right">
                          {editingId === pc.id ? (
                            <TextField
                              size="small" value={editShipping}
                              onChange={e => setEditShipping(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && handleInlineSave(pc.id)}
                              sx={{ width: 70, '& input': { fontSize: '0.75rem', textAlign: 'right' } }}
                            />
                          ) : (
                            <Typography variant="body2" sx={{ fontSize: '0.75rem' }}>
                              {pc.shippingCost ? `₺${pc.shippingCost}` : '—'}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="center">
                          {editingId === pc.id && (
                            <IconButton size="small" onClick={() => handleInlineSave(pc.id)} color="primary">
                              <Save size={14} />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
        ) : (
          /* Bulk CSV Tab */
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {t('csvHelp')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1.5, display: 'block' }}>
              {t('csvExample')}
            </Typography>
            <TextField
              multiline rows={10} fullWidth
              placeholder={t('csvPlaceholder')}
              value={csvText} onChange={e => setCsvText(e.target.value)}
              sx={{ mb: 2, '& textarea': { fontFamily: 'monospace', fontSize: '0.8rem' } }}
            />
            <Button
              variant="contained" fullWidth
              startIcon={<Upload size={16} />}
              onClick={handleBulkImport}
              disabled={!csvText.trim()}
              sx={{ background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', borderRadius: '8px', textTransform: 'none' }}
            >
              {t('bulkImport')}
            </Button>
          </Box>
        )}
      </Box>
    </Drawer>
  );
}
