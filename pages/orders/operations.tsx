import React, { useState, useEffect } from 'react';
import { Box, Button, TextField, Select, MenuItem, FormControl, InputLabel, CircularProgress, Dialog, DialogTitle, DialogContent } from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel } from '@mui/x-data-grid';
import toast from 'react-hot-toast';
import { useOrders, UIOrder } from '../../lib/hooks/useOrders';
import { CircularProgress as Spinner } from '@mui/material';

// Helper to format ISO dates as YYYY-MM-DD HH:mm
function formatDate(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OperationsPage() {
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 20 });
  const { orders, total, isLoading, isError, mutate } = useOrders(
    paginationModel.page + 1, // API is 1-indexed
    paginationModel.pageSize
  );
  const [editing, setEditing] = useState<Record<string, { packingStatus?: string; productionNotes?: string }>>({}); // Made fields optional
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [detailJson, setDetailJson] = useState<Record<string, any> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleFieldChange = (id: string, field: 'packingStatus' | 'productionNotes', value: string) => {
    setEditing(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        packingStatus: field === 'packingStatus' ? value : prev[id]?.packingStatus,
        productionNotes: field === 'productionNotes' ? value : prev[id]?.productionNotes,
      }
    }));
  };

  const handleSave = async (id: string) => {
    const editData = editing[id];
    if (!editData || (editData.packingStatus === undefined && editData.productionNotes === undefined)) return;
    
    const payload: any = {};
    if (editData.packingStatus !== undefined) payload.packingStatus = editData.packingStatus;
    if (editData.productionNotes !== undefined) payload.productionNotes = editData.productionNotes;

    setSavingIds(prev => [...prev, id]);
    try {
      const res = await fetch(`/api/orders/${id}/updateProductionStatus`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Kaydetme hatası');
      toast.success('Başarılı: Kaydedildi');
      setEditing(prev => { // Clear editing state for this row after save
        const newState = {...prev};
        delete newState[id];
        return newState;
      });
      await mutate();
    } catch (error: any) {
      toast.error(`Hata: ${error.message}`);
    } finally {
      setSavingIds(prev => prev.filter(x => x !== id));
    }
  };

  if (isError) return <Box p={2}>Hata: Siparişler yüklenemedi.</Box>;

  const syncOrders = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/orders/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync hatası');
      toast.success('Senkronizasyon tamamlandı');
      await mutate();
    } catch (err: any) {
      toast.error(`Senkronizasyon hatası: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };
  
  const showRawData = (row: UIOrder) => {
    setDetailJson(row.rawData || null);
    setDialogOpen(true);
  };
  
  const packingOptions = ['Pending', 'Packed', 'Shipped', 'Cancelled', 'On Hold']; // Added more options

  const columns: GridColDef<UIOrder>[] = [
    { field: 'id', headerName: 'Sipariş ID', width: 150 },
    {
      field: 'thumbnail',
      headerName: 'Görsel',
      width: 80,
      renderCell: (params: any) => (
        <img
          src={params.row.images?.[0] || ''}
          alt="thumb"
          style={{ width: 50, height: 50, objectFit: 'contain' }}
        />
      ),
    },
    { field: 'status', headerName: 'Sipariş Durumu', width: 130 }, // Added order status
    {
      field: 'packingStatus',
      headerName: 'Paket Durumu',
      width: 180,
      renderCell: (params: any) => {
        const id = params.row.id;
        // Use original value from row.packingStatus as default, then apply editing[id] if it exists
        const value = editing[id]?.packingStatus !== undefined ? editing[id].packingStatus : params.row.packingStatus || '';
        return (
          <FormControl fullWidth size="small">
            <InputLabel id={`packing-status-label-${id}`}>Paket Durumu</InputLabel>
            <Select
              labelId={`packing-status-label-${id}`}
              value={value}
              label="Paket Durumu"
              onChange={e => handleFieldChange(id, 'packingStatus', e.target.value)}
            >
              {packingOptions.map(opt => (
                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
              ))}
            </Select>
          </FormControl>
        );
      },
    },
    {
      field: 'productionNotes',
      headerName: 'Üretim Notları',
      width: 250,
      renderCell: (params: any) => {
        const id = params.row.id;
        const value = editing[id]?.productionNotes !== undefined ? editing[id].productionNotes : params.row.productionNotes || '';
        return (
          <TextField
            fullWidth
            size="small"
            variant="outlined"
            value={value}
            onChange={e => handleFieldChange(id, 'productionNotes', e.target.value)}
            placeholder="Üretim notu ekle"
          />
        );
      },
    },
    {
      field: 'actions',
      headerName: 'İşlemler',
      width: 120,
      renderCell: (params: any) => {
        const id = params.row.id;
        const isSaving = savingIds.includes(id);
        return (
          <Button variant="contained" size="small" disabled={isSaving || !editing[id]} onClick={() => handleSave(id)}>
            {isSaving ? <CircularProgress size={20} /> : 'Kaydet'}
          </Button>
        );
      },
    },
    {
      field: 'viewRaw',
      headerName: 'Ham Veri',
      width: 100,
      renderCell: (params: any) => (
        <Button size="small" onClick={() => showRawData(params.row)}>
          Görüntüle
        </Button>
      )
    },
    {
      field: 'syncedAt',
      headerName: 'Son Senkr.',
      width: 160,
      valueGetter: (params: any) => formatDate(params.row.syncedAt)
    },
    {
      field: 'syncStatus',
      headerName: 'Senkr Durumu',
      width: 120,
    },
    {
      field: 'packingEditedAt',
      headerName: 'Paket Düzenlendi',
      width: 160,
      valueGetter: (params: any) => params.row.packingEditedAt ? formatDate(params.row.packingEditedAt) : '—'
    },
    {
      field: 'productionEditedAt',
      headerName: 'Üretim Düzenlendi',
      width: 160,
      valueGetter: (params: any) => params.row.productionEditedAt ? formatDate(params.row.productionEditedAt) : '—'
    },
     {
      field: 'shipmentStatus',
      headerName: 'Gönderi Durumu',
      width: 140,
    },
    {
      field: 'shippedAt',
      headerName: 'Etiket Tarihi',
      width: 160,
      valueGetter: (params: any) => formatDate(params.row.shippedAt),
    },
  ];

  return (
    <Box p={2}>
      <Button
        variant="outlined"
        onClick={syncOrders}
        disabled={syncing}
        startIcon={syncing ? <Spinner size={16} /> : null}
        sx={{ mb: 2 }}
      >
        {syncing ? 'Senkronize ediliyor...' : 'Siparişleri Senkronize Et'}
      </Button>
      <Box sx={{ height: '80vh', width: '100%' }}>
        <DataGrid<UIOrder>
          rows={orders}
          columns={columns}
          rowCount={total}
          loading={isLoading}
          pageSizeOptions={[10, 20, 50]}
          paginationModel={paginationModel}
          paginationMode="server"
          onPaginationModelChange={setPaginationModel}
          getRowId={row => row.id}
        />
      </Box>
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Ham API Verisi</DialogTitle>
        <DialogContent>
          <Box component="pre" sx={{ overflowX: 'auto', fontSize: 12 }}>
            {JSON.stringify(detailJson, null, 2)}
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
} 