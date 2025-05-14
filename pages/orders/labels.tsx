import React, { useState, useEffect } from 'react';
import { Box, Button, Checkbox, CircularProgress, Tooltip, Dialog, DialogTitle, DialogContent, Snackbar, Alert } from '@mui/material';
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

interface HealthCheckResult {
  ok: boolean;
  message?: string;
  config?: {
    VEEQO: string;
    Shippo: string;
    FedEx: string;
  };
  error?: string;
}

export default function LabelsPage() {
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 20 });
  const { orders, total, isLoading, isError, mutate } = useOrders(
    paginationModel.page + 1, // API is 1-indexed
    paginationModel.pageSize
  );
  const [loadingIds, setLoadingIds] = useState<string[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthSnackbar, setHealthSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [detailJson, setDetailJson] = useState<Record<string, any> | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [resyncingIds, setResyncingIds] = useState<string[]>([]);

  const syncOrders = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/orders/sync', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Sync failed');
      toast.success('Senkronizasyon tamamlandı');
      await mutate(); 
    } catch (err: any) {
      toast.error(`Senkronizasyon hatası: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleHealthCheck = async () => {
    setHealthChecking(true);
    try {
      const res = await fetch('/api/health');
      const data: HealthCheckResult = await res.json();
      if (res.ok && data.ok) {
        setHealthSnackbar({ open: true, message: data.message || 'Sağlık durumu: İyi', severity: 'success' });
      } else {
        throw new Error(data.message || data.error || 'Sağlık kontrolü başarısız.');
      }
    } catch (err: any) {
      setHealthSnackbar({ open: true, message: `Sağlık Kontrolü Hatası: ${err.message}`, severity: 'error' });
    } finally {
      setHealthChecking(false);
    }
  };

  const handleGenerate = async (id: string) => {
    setLoadingIds(prev => [...prev, id]);
    try {
      const res = await fetch(`/api/orders/${id}/generateFedexLabel`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error generating label');
      toast.success(`Label generated for ${id}`);
      await mutate();
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setLoadingIds(prev => prev.filter(x => x !== id));
    }
  };

  const showRawData = (row: UIOrder) => {
    setDetailJson(row.rawData || null);
    setDialogOpen(true);
  };
  
  const handleResync = async (id: string, marketplace: string, marketplaceKey: string) => {
    setResyncingIds(prev => [...prev, id]);
    try {
      const res = await fetch(`/api/orders/${id}/resync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketplace, marketplaceKey }),
      });
      if (!res.ok) throw new Error('Senkronize hatası');
      toast.success('Sipariş yeniden senkronize edildi');
      await mutate();
    } catch (err: any) {
      toast.error(`Hata: ${err.message}`);
    } finally {
      setResyncingIds(prev => prev.filter(x => x !== id));
    }
  };

  if (isError) return <Box p={2}>Hata: Siparişler yüklenemedi.</Box>;

  const columns: GridColDef<UIOrder>[] = [
    { field: 'id', headerName: 'Sipariş ID', width: 150 },
    {
      field: 'thumbnail',
      headerName: 'Thumbnail',
      width: 100,
      renderCell: (params: any) => (
        <img
          src={params.row.images?.[0] || ''}
          alt="thumb"
          style={{ width: 50, height: 50 }}
        />
      ),
    },
    { field: 'customerName', headerName: 'Customer Name', width: 150 },
    { field: 'status', headerName: 'Sipariş Durumu', width: 130 },
    {
      field: 'serviceType',
      headerName: 'Servis Tipi',
      width: 130,
      valueGetter: (params: any) => params.row.fedexServiceType || ''
    },
    {
      field: 'packageType',
      headerName: 'Paket Tipi',
      width: 130,
      valueGetter: (params: any) => params.row.fedexPackagingType || ''
    },
    {
      field: 'commercialInvoice',
      headerName: 'Ticari Fatura (ETD)',
      width: 150,
      renderCell: (params: any) => (
        <Checkbox checked={!!params.row.sendCommercialInvoiceViaEtd} disabled />
      )
    },
    {
      field: 'generate',
      headerName: 'Etiket Oluştur',
      width: 150,
      renderCell: (params: any) => {
        const id = params.row.id;
        const isRowLoading = loadingIds.includes(id);
        const canGenerate =
          !!params.row.fedexServiceType &&
          !!params.row.fedexPackagingType &&
          !!params.row.fedexPickupType &&
          !!params.row.fedexDutiesPaymentType &&
          !!params.row.commodityDesc &&
          !!params.row.harmonizedCode;

        const btn = (
          <Button
            variant="contained"
            size="small"
            disabled={!canGenerate || isRowLoading}
            onClick={() => handleGenerate(id)}
          >
            {isRowLoading ? <CircularProgress size={20} /> : 'Etiket Oluştur'}
          </Button>
        );

        return (
          <Tooltip title={!canGenerate ? "FedEx seçeneklerini ayarlayın" : "Etiket oluştur"}>
            <span>{btn}</span>
          </Tooltip>
        );
      }
    },
    { field: 'trackingNumber', headerName: 'Takip No', width: 180 },
    {
      field: 'label',
      headerName: 'Etiket',
      width: 80,
      renderCell: (params: any) =>
        params.row.shippingLabelUrl ? (
          <a href={params.row.shippingLabelUrl} target="_blank" rel="noopener noreferrer">
            PDF
          </a>
        ) : null,
    },
    {
      field: 'viewRaw',
      headerName: 'Ham Veri',
      width: 100,
      renderCell: (params: any) => (
        <Button size="small" onClick={() => showRawData(params.row)}>
          Görüntüle
        </Button>
      ),
    },
    {
      field: 'syncedAt',
      headerName: 'Senkr Tarihi',
      width: 160,
      valueGetter: (params: any) => formatDate(params.row.syncedAt),
    },
    {
      field: 'syncStatus',
      headerName: 'Senkr Durumu',
      width: 130,
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
    {
      field: 'resync',
      headerName: 'Yeniden Senkronize Et',
      width: 180,
      renderCell: (params: any) => {
        const id = params.row.id;
        const isResyncing = resyncingIds.includes(id);
        return (
          <Button
            size="small"
            disabled={isResyncing}
            onClick={() => handleResync(id, params.row.marketplace, params.row.marketplaceKey)}
          >
            {isResyncing ? <CircularProgress size={20} /> : 'Yeniden Senkronize Et'}
          </Button>
        );
      },
    },
  ];

  return (
    <Box p={2}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
        <Button
          variant="outlined"
          onClick={syncOrders}
          disabled={syncing || healthChecking}
          startIcon={syncing ? <Spinner size={16} /> : null}
        >
          {syncing ? 'Senkronize ediliyor...' : 'Siparişleri Senkronize Et'}
        </Button>
        <Button
          variant="contained"
          color="secondary"
          onClick={handleHealthCheck}
          disabled={syncing || healthChecking}
          startIcon={healthChecking ? <Spinner size={16} /> : null}
        >
          {healthChecking ? 'Kontrol Ediliyor...' : 'Sağlık Kontrolü'}
        </Button>
      </Box>
      <Box sx={{ height: 'calc(80vh - 40px)', width: '100%' }}>
        <DataGrid<UIOrder>
          rows={orders}
          columns={columns}
          rowCount={total}
          loading={isLoading || syncing || healthChecking}
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
      <Snackbar 
        open={healthSnackbar.open} 
        autoHideDuration={6000} 
        onClose={() => setHealthSnackbar({...healthSnackbar, open: false})} 
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setHealthSnackbar({...healthSnackbar, open: false})} severity={healthSnackbar.severity} sx={{ width: '100%' }}>
          {healthSnackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
} 