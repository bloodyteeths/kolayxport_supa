import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Box, Button, CircularProgress, TextField, IconButton, Typography, Paper, Chip,
  InputAdornment, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel, GridRenderCellParams } from '@mui/x-data-grid';
import { Refresh as RefreshIcon, Search as SearchIcon, Add as AddIcon, Delete as DeleteIcon, Sync as SyncIcon } from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useTranslations } from 'next-intl';

function WixProductsPage() {
  const t = useTranslations('wixListings');
  const tc = useTranslations('common');

  const [products, setProducts] = useState<any[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [createOpen, setCreateOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: '', price: '', sku: '', description: '' });

  const fetchProducts = useCallback(async (fromCache = true) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/wix/products?action=list&fromCache=${fromCache}&page=${paginationModel.page}&size=${paginationModel.pageSize}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setProducts(data.content || []);
      setTotalElements(data.totalElements || 0);
    } catch (err: any) {
      toast.error(err.message || t('fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [paginationModel, t]);

  useEffect(() => { fetchProducts(true); }, [fetchProducts]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/wix/products?action=sync', { method: 'POST' });
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      toast.success(`${t('syncSuccess')} (${data.synced})`);
      fetchProducts(true);
    } catch (err: any) {
      toast.error(err.message || t('syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const handleCreate = async () => {
    try {
      const res = await fetch('/api/wix/products?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newProduct.name,
          priceData: newProduct.price ? { price: parseFloat(newProduct.price) } : undefined,
          sku: newProduct.sku || undefined,
          description: newProduct.description || undefined,
          visible: true,
        }),
      });
      if (!res.ok) throw new Error('Create failed');
      toast.success(t('createSuccess'));
      setCreateOpen(false);
      setNewProduct({ name: '', price: '', sku: '', description: '' });
      fetchProducts(false);
    } catch (err: any) {
      toast.error(err.message || t('createFailed'));
    }
  };

  const handleDelete = async (productId: string) => {
    if (!window.confirm(t('deleteConfirm'))) return;
    try {
      const res = await fetch(`/api/wix/products?action=delete&productId=${productId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(t('deleteSuccess'));
      fetchProducts(true);
    } catch (err: any) {
      toast.error(err.message || t('deleteFailed'));
    }
  };

  const filteredProducts = useMemo(() => {
    if (!searchTerm.trim()) return products;
    const term = searchTerm.toLowerCase();
    return products.filter((p: any) =>
      (p.title || '').toLowerCase().includes(term) ||
      (p.sku || '').toLowerCase().includes(term)
    );
  }, [products, searchTerm]);

  const columns: GridColDef[] = useMemo(() => [
    {
      field: 'thumbnailUrl', headerName: '', width: 60, sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
          <img
            src={params.value || '/placeholder.png'}
            alt=""
            style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.png'; }}
          />
        </Box>
      ),
    },
    { field: 'title', headerName: t('columnTitle'), flex: 2, minWidth: 200 },
    { field: 'sku', headerName: 'SKU', width: 120 },
    {
      field: 'price', headerName: t('columnPrice'), width: 100, type: 'number',
      renderCell: (params: GridRenderCellParams) => {
        const val = params.value != null ? Number(params.value) : null;
        const currency = params.row.currency || 'USD';
        return val != null ? `${val.toFixed(2)} ${currency}` : '—';
      },
    },
    { field: 'quantity', headerName: t('columnStock'), width: 80, type: 'number' },
    {
      field: 'visible', headerName: t('columnStatus'), width: 100,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value ? t('visible') : t('hidden')}
          size="small"
          color={params.value ? 'success' : 'default'}
          variant="outlined"
        />
      ),
    },
    {
      field: 'actions', headerName: '', width: 60, sortable: false,
      renderCell: (params: GridRenderCellParams) => (
        <IconButton size="small" color="error" onClick={() => handleDelete(params.row.wixProductId || params.row.id)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      ),
    },
  ], [t]);

  return (
    <AppLayout title={t('pageTitle')}>
      <Toaster position="top-right" />
      <Box sx={{ maxWidth: 1400, mx: 'auto', width: '100%', p: { xs: 0.5, sm: 1, md: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="h6" fontWeight="bold">{t('pageTitle')}</Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button size="small" variant="outlined" startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon />} onClick={handleSync} disabled={syncing}>
              {t('syncProducts')}
            </Button>
            <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreateOpen(true)}>
              {t('createProduct')}
            </Button>
          </Box>
        </Box>

        <Paper sx={{ p: 1, mb: 1 }}>
          <TextField
            size="small" fullWidth placeholder={t('searchPlaceholder')} value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
            sx={{ '& .MuiInputBase-root': { height: 36, fontSize: '0.85rem' } }}
          />
        </Paper>

        <Paper sx={{ width: '100%' }}>
          <DataGrid
            rows={filteredProducts}
            columns={columns}
            rowCount={totalElements}
            loading={loading}
            pageSizeOptions={[25, 50, 100]}
            paginationModel={paginationModel}
            onPaginationModelChange={setPaginationModel}
            getRowId={(row) => row.id || row.wixProductId}
            rowHeight={56}
            disableRowSelectionOnClick
            autoHeight
            sx={{
              border: 0,
              fontSize: '0.85rem',
              '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f5f5f5' },
            }}
          />
        </Paper>

        {/* Create Product Dialog */}
        <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="sm" fullWidth>
          <DialogTitle>{t('createProduct')}</DialogTitle>
          <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 2 }}>
            <TextField label={t('columnTitle')} value={newProduct.name} onChange={(e) => setNewProduct(p => ({ ...p, name: e.target.value }))} fullWidth required />
            <TextField label={t('columnPrice')} value={newProduct.price} onChange={(e) => setNewProduct(p => ({ ...p, price: e.target.value }))} type="number" fullWidth />
            <TextField label="SKU" value={newProduct.sku} onChange={(e) => setNewProduct(p => ({ ...p, sku: e.target.value }))} fullWidth />
            <TextField label={t('description')} value={newProduct.description} onChange={(e) => setNewProduct(p => ({ ...p, description: e.target.value }))} multiline rows={3} fullWidth />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCreateOpen(false)}>{tc('cancel')}</Button>
            <Button variant="contained" onClick={handleCreate} disabled={!newProduct.name.trim()}>{tc('save')}</Button>
          </DialogActions>
        </Dialog>
      </Box>
    </AppLayout>
  );
}

export default withAuth(WixProductsPage);
