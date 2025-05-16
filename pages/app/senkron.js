import React, { useState, useEffect } from 'react';
import AppLayout from '../../components/AppLayout';
import { NextSeo } from 'next-seo';
import { motion } from 'framer-motion';
import { ShoppingCart } from 'lucide-react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Paper from '@mui/material/Paper';
import TextField from '@mui/material/TextField';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Typography from '@mui/material/Typography';
import axios from 'axios';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import SyncIcon from '@mui/icons-material/Sync';

const DURUM_OPTIONS = ['Çıkmadı', 'Çıktı'];

export default function SenkronPage() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [editState, setEditState] = useState({}); // { [orderId]: { not, durum } }
  const [search, setSearch] = useState('');
  const [filterDurum, setFilterDurum] = useState('');
  const [filterMarketplace, setFilterMarketplace] = useState('');
  const [filterStartDate, setFilterStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [filterEndDate, setFilterEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [sortOrder, setSortOrder] = useState('desc');
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [total, setTotal] = useState(0);
  const [marketplaceOptions, setMarketplaceOptions] = useState([]);

  // Fetch orders with all filters
  useEffect(() => {
    setLoading(true);
    axios.get('/api/orders', {
      params: {
        page,
        limit: pageSize,
        startDate: filterStartDate,
        endDate: filterEndDate,
        status: filterDurum,
        marketplace: filterMarketplace,
        search,
        sort: sortOrder,
      },
    })
      .then(res => {
        setOrders(res.data.orders || []);
        setTotal(res.data.total || 0);
        // Auto-populate marketplace options
        const uniqueMarketplaces = Array.from(new Set((res.data.orders || []).map(o => o.marketplace).filter(Boolean)));
        setMarketplaceOptions(uniqueMarketplaces);
      })
      .catch(err => {
        setError(err.response?.data?.error || err.message);
      })
      .finally(() => setLoading(false));
  }, [page, pageSize, filterStartDate, filterEndDate, filterDurum, filterMarketplace, search, sortOrder]);

  const handleEditChange = (orderId, field, value) => {
    setEditState(prev => ({
      ...prev,
      [orderId]: {
        ...prev[orderId],
        [field]: value,
      },
    }));
  };

  const handleSave = async (orderId) => {
    const { not, durum } = editState[orderId] || {};
    setLoading(true);
    setError(null);
    try {
      await axios.post(`/api/orders/${orderId}/updateNoteAndStatus`, { not, durum });
      // Refetch orders
      const res = await axios.get('/api/orders', { params: { page, limit: pageSize } });
      setOrders(res.data.orders || []);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSyncOrders = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      await axios.post('/api/orders/sync-recent');
      setSyncMessage('Son 7 günün siparişleri başarıyla senkronize edildi!');
      // Refetch orders
      const res = await axios.get('/api/orders', { params: { page, limit: pageSize } });
      setOrders(res.data.orders || []);
    } catch (err) {
      setSyncMessage('Senkronizasyon sırasında hata oluştu: ' + (err.response?.data?.error || err.message));
    } finally {
      setSyncing(false);
    }
  };

  // No additional filtering needed; all filtering is done server-side
  const filteredOrders = orders; // for compatibility with existing rendering

  // Count orders with null/empty orderNumber for debug
  const nullOrderNumberCount = orders.filter(o => !o.orderNumber || o.orderNumber === 'null').length;

  const columns = [
    {
      field: 'orderNumber',
      headerName: 'Sipariş No',
      width: 120,
      renderCell: ({ row }) => (
        !row.orderNumber || row.orderNumber === 'null' ? (
          <span style={{ color: 'red', fontWeight: 'bold' }}>
            Eksik <span style={{ background: '#ffe0e0', color: '#b71c1c', borderRadius: 4, padding: '2px 6px', marginLeft: 4, fontSize: 11 }}>Order No</span>
          </span>
        ) : row.orderNumber
      ),
    },
    {
      field: 'items',
      headerName: 'Görsel',
      renderCell: ({ row }) =>
        row.items[0]?.image
          ? <img src={row.items[0].image} width={240} height={240} style={{ objectFit:'cover', borderRadius: 12 }} />
          : '—',
    },
    {
      field: 'customerName',
      headerName: 'Müşteri Adı',
      width: 200,
    },
    {
      field: 'variantInfo',
      headerName: 'Varyant',
      valueGetter: ({ row }) => row.items[0]?.variantInfo || '—',
    },
    {
      field: 'notes',
      headerName: 'Not',
      renderCell: ({ row }) => (
        <TextField
          defaultValue={row.items[0]?.notes || ''}
          variant="outlined"
          size="small"
        />
      ),
    },
    {
      field: 'status',
      headerName: 'Durum',
      width: 200,
      renderCell: ({ row }) => (
        <div style={{ minWidth: 180, minHeight: 48, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {row.status}
        </div>
      ),
    },
    {
      field: 'shipBy',
      headerName: 'Ship-by',
      width: 120,
      valueGetter: ({ row }) => row.shipBy || '—',
    },
    {
      field: 'marketplace',
      headerName: 'Marketplace',
      renderCell: ({ row }) => row.marketplace || '—',
      width: 120,
    },
    {
      field: 'id',
      headerName: 'Sipariş No',
      width: 120,
    },
  ];

  return (
    <AppLayout title="Senkron – Siparişler">
      <NextSeo title="Senkron – KolayXport" />
      <motion.section
        className="py-6 px-0 w-full min-h-screen bg-slate-50"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <div className="w-screen px-0">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-4">
              <Button
                variant="contained"
                color="primary"
                startIcon={<SyncIcon />}
                onClick={handleSyncOrders}
                disabled={syncing}
                sx={{ minWidth: 220, fontWeight: 600 }}
              >
                {syncing ? 'Senkronize Ediliyor...' : 'Siparişleri Senkronize Et'}
              </Button>
              {syncMessage && <Alert severity={syncMessage.startsWith('Siparişler') ? 'success' : 'error'} sx={{ ml: 2 }}>{syncMessage}</Alert>}
            </div>
          </div>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 justify-between items-center mb-6 bg-white p-4 rounded shadow">
            <TextField
              label="Sipariş No / Müşteri Ara"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              size="small"
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 220 }}
            />
            <Select
              value={filterDurum}
              onChange={e => { setFilterDurum(e.target.value); setPage(1); }}
              displayEmpty
              size="small"
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">Tüm Durumlar</MenuItem>
              {DURUM_OPTIONS.map(opt => (
                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
              ))}
            </Select>
            <Select
              value={filterMarketplace}
              onChange={e => { setFilterMarketplace(e.target.value); setPage(1); }}
              displayEmpty
              size="small"
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="">Tüm Mağazalar</MenuItem>
              {marketplaceOptions.map(opt => (
                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
              ))}
            </Select>
            <TextField
              label="Başlangıç Tarihi"
              type="date"
              value={filterStartDate}
              onChange={e => { setFilterStartDate(e.target.value); setPage(1); }}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 180 }}
            />
            <TextField
              label="Bitiş Tarihi"
              type="date"
              value={filterEndDate}
              onChange={e => { setFilterEndDate(e.target.value); setPage(1); }}
              size="small"
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 180 }}
            />
            <Select
              value={sortOrder}
              onChange={e => { setSortOrder(e.target.value); setPage(1); }}
              size="small"
              sx={{ minWidth: 160 }}
            >
              <MenuItem value="desc">Yeniden Eskiye</MenuItem>
              <MenuItem value="asc">Eskiden Yeniye</MenuItem>
            </Select>
            <Button
              variant="outlined"
              color="secondary"
              onClick={() => {
                setSearch('');
                setFilterDurum('');
                setFilterMarketplace('');
                const d = new Date();
                d.setDate(d.getDate() - 7);
                setFilterStartDate(d.toISOString().slice(0, 10));
                setFilterEndDate(new Date().toISOString().slice(0, 10));
                setSortOrder('desc');
                setPage(1);
              }}
              sx={{ minWidth: 120, fontWeight: 600 }}
            >
              Filtreleri Sıfırla
            </Button>
          </div>
          {/* Warning for missing order numbers */}
          {orders.some(o => !o.orderNumber) && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              {orders.filter(o => !o.orderNumber).length} adet siparişin <b>orderNumber</b> alanı eksik! Eksik olanlar tabloda kırmızı olarak işaretlenmiştir.
            </Alert>
          )}
          <div className="flex flex-row items-center gap-4 mb-2">
            <Typography sx={{ fontWeight: 600 }}>Sayfa Boyutu:</Typography>
            <Select
              value={pageSize}
              onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              size="small"
              sx={{ minWidth: 90 }}
            >
              {[15, 25, 50, 100].map(opt => (
                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
              ))}
            </Select>
            <Typography sx={{ ml: 2 }}>
              Toplam: {total}
            </Typography>
          </div>
          <div className="w-full overflow-x-auto">
            <TableContainer component={Paper} sx={{ mt: 2, width: '100vw', px: 3 }}>
              <Table>
                <TableHead>
                  <TableRow>
                    <TableCell>Görsel</TableCell>
                    <TableCell>Müşteri Adı</TableCell>
                    <TableCell>Varyant</TableCell>
                    <TableCell>Not</TableCell>
                    <TableCell>Durum</TableCell>
                    <TableCell>Son Kargo Tarihi</TableCell>
                    <TableCell>Mağaza</TableCell>
                    <TableCell>Sipariş No</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} align="center">
                        <Typography>Sonuç bulunamadı.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders.map(order => {
                      const item = order.items?.[0] || {};
                      const edit = editState[order.id] || {};
                      return (
                        <TableRow key={order.id} sx={{ height: 120 }}>
                          <TableCell sx={{ p: 2, width: 200, verticalAlign: 'middle' }}>
                            {item.image
                              ? <img src={item.image} width={180} height={180} style={{ objectFit:'cover', borderRadius: 12, display: 'block', margin: '0 auto' }} />
                              : '—'}
                          </TableCell>
                          <TableCell sx={{ p: 2, fontSize: 16 }}>{order.customerName || '—'}</TableCell>
                          <TableCell sx={{ p: 2, minWidth: 340, fontSize: 16 }}>{item.variantInfo || '—'}</TableCell>
                          <TableCell sx={{ p: 2, minWidth: 340, fontSize: 16 }}>
                            <TextField
                              value={edit.not ?? item.notes ?? ''}
                              onChange={e => handleEditChange(order.id, 'not', e.target.value)}
                              variant="outlined"
                              fullWidth
                              multiline
                              minRows={4}
                              maxRows={6}
                              inputProps={{ style: { fontSize: 16, padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' } }}
                              sx={{ minWidth: 320 }}
                            />
                            {(edit.not !== undefined && edit.not !== item.notes) || (edit.durum !== undefined && edit.durum !== order.status) ? (
                              <Button
                                variant="contained"
                                color="success"
                                size="small"
                                sx={{ mt: 1, fontWeight: 600 }}
                                onClick={() => handleSave(order.id)}
                                disabled={loading}
                              >
                                Kaydet
                              </Button>
                            ) : null}
                          </TableCell>
                          <TableCell sx={{ p: 2, minWidth: 180, fontSize: 20, fontWeight: 600, textAlign: 'center' }}>
                            <Select
                              value={edit.durum ?? order.status ?? 'Çıkmadı'}
                              onChange={e => handleEditChange(order.id, 'durum', e.target.value)}
                              size="small"
                            >
                              {DURUM_OPTIONS.map(opt => (
                                <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                              ))}
                            </Select>
                          </TableCell>
                          <TableCell sx={{ p: 2, fontSize: 16 }}>{order.shipByDate ? new Date(order.shipByDate).toLocaleDateString('tr-TR') : '—'}</TableCell>
                          <TableCell sx={{ p: 2, fontSize: 16 }}>{order.marketplace || '—'}</TableCell>
                          <TableCell sx={{ p: 2, fontSize: 16 }}>
                            {order.orderNumber
                              ? order.orderNumber
                              : <span style={{ color: 'red', fontWeight: 'bold' }}>
                                  Eksik <span style={{ background: '#ffe0e0', color: '#b71c1c', borderRadius: 4, padding: '2px 6px', marginLeft: 4, fontSize: 11 }}>Order No</span>
                                </span>
                            }
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </div>
          {/* Pagination Controls */}
          <div className="flex flex-row flex-wrap items-center justify-center gap-2 mt-4">
            <Button
              variant="outlined"
              size="small"
              onClick={() => setPage(page - 1)}
              disabled={page === 1}
            >Önceki</Button>
            {Array.from({ length: Math.ceil(total / pageSize) }, (_, i) => (
              <Button
                key={i + 1}
                variant={page === i + 1 ? 'contained' : 'outlined'}
                size="small"
                onClick={() => setPage(i + 1)}
                sx={{ mb: 1 }}
              >{i + 1}</Button>
            ))}
            <Button
              variant="outlined"
              size="small"
              onClick={() => setPage(page + 1)}
              disabled={page === Math.ceil(total / pageSize)}
            >Sonraki</Button>
          </div>
        </div>
      </motion.section>
    </AppLayout>
  );
}