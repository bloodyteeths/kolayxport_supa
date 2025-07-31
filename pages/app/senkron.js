import React, { useState, useEffect, useMemo } from 'react';
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
import { useOrders } from '../../lib/hooks/useOrders';
import InputAdornment from '@mui/material/InputAdornment';
import SearchIcon from '@mui/icons-material/Search';
import PrintIcon from '@mui/icons-material/Print';
import EditIcon from '@mui/icons-material/Edit';
import SaveIcon from '@mui/icons-material/Save';
import IconButton from '@mui/material/IconButton';
import Chip from '@mui/material/Chip';
import Pagination from '@mui/material/Pagination';
import Stack from '@mui/material/Stack';
import withAuth from '../../components/withAuth';

const DURUM_OPTIONS = ['Çıkmadı', 'Çıktı', 'İptal', 'Üretimde', 'Sipariş Verildi', 'Hazırlanıyor', 'Kargoya Verildi', 'Teslim Edildi'];

// Status mapping from English to Turkish (matching labels page)
const orderStatusOptions = [
  { value: 'UNSHIPPED', label: 'Hazırlanıyor' },
  { value: 'AWAITING_FULFILLMENT', label: 'Onaylandı' },
  { value: 'PAID', label: 'Onaylandı' },
  { value: 'CREATED', label: 'Onaylandı' },
  { value: 'PARTIALLY_SHIPPED', label: 'Kısmen Kargolandı' },
  { value: 'SHIPPED', label: 'Kargolandı' },
  { value: 'DELIVERED', label: 'Teslim Edildi' },
  { value: 'CANCELLED', label: 'İptal Edildi' },
  { value: 'REFUNDED', label: 'İade Edildi' },
  { value: 'ON_HOLD', label: 'Askıya Alındı' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'FAILED', label: 'Başarısız Oldu' },
];

// Status colors for Kargo Durumu column (matching labels page)
const statusColors = {
  'UNSHIPPED': { bg: '#87CEEB', text: '#000' }, // Baby Blue
  'AWAITING_FULFILLMENT': { bg: '#87CEEB', text: '#000' }, // Baby Blue
  'PAID': { bg: '#87CEEB', text: '#000' }, // Baby Blue
  'CREATED': { bg: '#87CEEB', text: '#000' }, // Baby Blue (Onaylandı)
  'PARTIALLY_SHIPPED': { bg: '#ADD8E6', text: '#000' }, // Light Blue
  'SHIPPED': { bg: '#90EE90', text: '#000' }, // Light Green
  'DELIVERED': { bg: '#32CD32', text: '#fff' }, // Lime Green
  'CANCELLED': { bg: '#F08080', text: '#fff' }, // Light Coral
  'REFUNDED': { bg: '#DDA0DD', text: '#000' }, // Plum
  'ON_HOLD': { bg: '#FFA500', text: '#000' }, // Orange
  'COMPLETED': { bg: '#388e3c', text: '#fff' }, // Dark Green
  'LABEL_GENERATED': { bg: '#8A2BE2', text: '#fff' }, // BlueViolet
  'FAILED': { bg: '#DC143C', text: '#fff' }, // Crimson
};

// Helper function to extract customer note (same logic as labels page)
const extractCustomerNote = (order) => {
  try {
    let rawData = order.rawData;
    if (typeof rawData === 'string') {
      try { rawData = JSON.parse(rawData); } catch { rawData = {}; }
    }
    if (!rawData) rawData = {};
    
    // Check for Etsy personalization notes
    const notes = rawData.notes || '';
    if (notes && notes.includes('Personalization:')) {
      const personalizationMatch = notes.match(/Personalization:\s*(.+?)(?:\n|$)/);
      if (personalizationMatch) {
        return personalizationMatch[1].trim();
      }
    }
    
    return '';
  } catch (error) {
    console.error('Error extracting customer note:', error);
    return '';
  }
};

function SenkronPage() {
  const [error, setError] = useState(null);
  const [editState, setEditState] = useState({}); // { [orderId]: { not, durum } }
  const [editingNotes, setEditingNotes] = useState({}); // { [orderId]: true/false }
  const [noteValues, setNoteValues] = useState({}); // { [orderId]: 'note text' }
  const [savingNotes, setSavingNotes] = useState({}); // { [orderId]: true/false }
  const [search, setSearch] = useState('');
  const [filterDurum, setFilterDurum] = useState('');
  const [filterMarketplace, setFilterMarketplace] = useState('');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [marketplaceOptions, setMarketplaceOptions] = useState([]);
  
  // Set default filter to last 7 days in Turkish time
  const getTodayTR = () => {
    const now = new Date();
    now.setHours(now.getHours() + 3); // UTC+3 for Turkey
    return now.toISOString().slice(0, 10);
  };
  const get7DaysAgoTR = () => {
    const now = new Date();
    now.setHours(now.getHours() + 3);
    now.setDate(now.getDate() - 7);
    return now.toISOString().slice(0, 10);
  };
  const [filterStartDate, setFilterStartDate] = useState(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return sevenDaysAgo.toISOString().slice(0, 10);
  });
  const [filterEndDate, setFilterEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  
  // Use the same hook as labels page
  const { orders, total, isLoading: loading, isError, mutate } = useOrders(
    page,
    pageSize,
    {
      search,
      startDate: filterStartDate,
      endDate: filterEndDate,
      status: filterDurum,
      marketplace: filterMarketplace,
      sort: sortOrder
    },
    'senkronPage'
  );

  // Auto-populate marketplace options
  useEffect(() => {
    if (orders && orders.length > 0) {
      const uniqueMarketplaces = Array.from(new Set(orders.map(o => o.marketplace).filter(Boolean)));
      setMarketplaceOptions(uniqueMarketplaces);
    }
  }, [orders]);


  const handleEditNote = (orderId) => {
    const order = orders.find(o => o.id === orderId);
    const existingNote = order?.senkronData?.internalNote || '';
    
    // Always initialize/update note value when starting to edit
    setNoteValues(prev => ({ ...prev, [orderId]: existingNote }));
    setEditingNotes(prev => ({ ...prev, [orderId]: true }));
  };

  const handleSaveNote = async (orderId) => {
    setSavingNotes(prev => ({ ...prev, [orderId]: true }));
    try {
      const noteValue = noteValues[orderId] || '';
      const order = orders.find(o => o.id === orderId);
      const currentStatus = order?.senkronData?.customStatus || null;
      
      await axios.post(`/api/orders/${orderId}/updateNoteAndStatus`, { 
        not: noteValue, 
        durum: currentStatus 
      });
      
      // Trigger re-fetch
      await mutate();
      
      setEditingNotes(prev => ({ ...prev, [orderId]: false }));
    } catch (err) {
      console.error('Error saving note:', err);
      setError(err.response?.data?.error || err.message);
    } finally {
      setSavingNotes(prev => ({ ...prev, [orderId]: false }));
    }
  };

  const handleSaveStatus = async (orderId, newStatus) => {
    try {
      const order = orders.find(o => o.id === orderId);
      const currentNote = order?.senkronData?.internalNote || null;
      
      await axios.post(`/api/orders/${orderId}/updateNoteAndStatus`, { 
        not: currentNote, 
        durum: newStatus 
      });
      
      // Trigger re-fetch
      await mutate();
    } catch (err) {
      console.error('Error saving status:', err);
      setError(err.response?.data?.error || err.message);
    }
  };


  // Flatten orders to individual line item rows (like labels page)
  const flattenOrdersToRows = useMemo(() => {
    if (!orders || !Array.isArray(orders)) return [];
    
    const rows = [];
    for (const order of orders) {
      const lineItems = order.line_items && order.line_items.length > 0 
        ? order.line_items 
        : (order.items || []);
      
      if (lineItems.length === 0) {
        // If no line items, create a single row for the order
        rows.push({
          ...order,
          lineItem: null,
          rowKey: order.id,
          orderDate: order.marketplaceOrderDate || order.createdAt
        });
      } else {
        // Create a row for each line item
        lineItems.forEach((item, index) => {
          rows.push({
            ...order,
            lineItem: item,
            rowKey: `${order.id}-${item.id || index}`,
            orderDate: order.marketplaceOrderDate || order.createdAt
          });
        });
      }
    }
    
    // Sort by order date (newest first)
    rows.sort((a, b) => {
      const dateA = new Date(a.orderDate || 0);
      const dateB = new Date(b.orderDate || 0);
      return dateB.getTime() - dateA.getTime();
    });
    
    return rows;
  }, [orders]);
  
  const filteredOrders = flattenOrdersToRows; // Now using flattened and sorted rows

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
                variant="outlined"
                color="secondary"
                onClick={() => window.print()}
                sx={{ minWidth: 56, fontWeight: 600 }}
              >
                <PrintIcon />
              </Button>
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
                const now = new Date();
                const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                setFilterStartDate(sevenDaysAgo.toISOString().slice(0, 10));
                setFilterEndDate(now.toISOString().slice(0, 10));
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
                    <TableCell sx={{ minWidth: 120, width: 120 }}>Görsel</TableCell>
                    <TableCell>Müşteri Adı</TableCell>
                    <TableCell>Sipariş Tarihi</TableCell>
                    <TableCell>Varyant</TableCell>
                    <TableCell>Müşteri Notu</TableCell>
                    <TableCell sx={{ minWidth: 180 }}>Not</TableCell>
                    <TableCell>Durum</TableCell>
                    <TableCell>Kargo Durumu</TableCell>
                    <TableCell>Son Kargo Tarihi</TableCell>
                    <TableCell>Mağaza</TableCell>
                    <TableCell>Sipariş No</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredOrders.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} align="center">
                        <Typography>Sonuç bulunamadı.</Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredOrders.map(row => {
                      const order = row;
                      const item = row.lineItem;
                      
                      console.log('[Senkron] Processing row:', row.rowKey);
                      
                      // If no line item, this is an order-only row
                      if (!item) {
                        console.log('[Senkron] No line items found for order:', order.id);
                        const orderDate = order.marketplaceOrderDate || order.createdAt;
                        const orderDateTR = orderDate ? new Date(orderDate).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour12: false }) : '—';
                        const shipByDateTR = order.shipByDate ? new Date(order.shipByDate).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour12: false }) : '—';
                        
                        const customerNote = extractCustomerNote(order);
                        
                        return (
                          <TableRow key={row.rowKey} sx={{ height: 80 }}>
                            <TableCell sx={{ p: 1, minWidth: 120, width: 120, verticalAlign: 'middle' }}>—</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{order.customerName || '—'}</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{orderDateTR}</TableCell>
                            <TableCell sx={{ p: 1, minWidth: 120, fontSize: 14 }}>—</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14, maxWidth: 150 }}>
                              {customerNote ? (
                                <div style={{ 
                                  maxHeight: 60,
                                  overflowY: 'auto',
                                  padding: '4px 8px',
                                  backgroundColor: '#f5f5f5',
                                  borderRadius: 4,
                                  fontSize: 14,
                                  border: '1px solid #ddd'
                                }}>
                                  {customerNote}
                                </div>
                              ) : (
                                <span style={{ color: '#999' }}>—</span>
                              )}
                            </TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14, minWidth: 180 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                                {editingNotes[order.id] ? (
                                  <>
                                    <TextField
                                      value={noteValues[order.id] || ''}
                                      variant="outlined"
                                      size="small"
                                      multiline
                                      rows={2}
                                      onChange={e => setNoteValues(prev => ({ ...prev, [order.id]: e.target.value }))}
                                      sx={{ 
                                        flexGrow: 1,
                                        backgroundColor: 'white',
                                        '& .MuiOutlinedInput-root': {
                                          fontSize: 14,
                                          backgroundColor: 'white',
                                        },
                                        '& .MuiOutlinedInput-input': {
                                          padding: '8px',
                                          color: '#000',
                                        }
                                      }}
                                      placeholder="Not ekleyin..."
                                      inputProps={{
                                        style: {
                                          minHeight: '40px',
                                          resize: 'vertical'
                                        }
                                      }}
                                    />
                                    <IconButton
                                      size="small"
                                      color="primary"
                                      onClick={() => handleSaveNote(order.id)}
                                      disabled={savingNotes[order.id]}
                                    >
                                      {savingNotes[order.id] ? <CircularProgress size={16} /> : <SaveIcon />}
                                    </IconButton>
                                  </>
                                ) : (
                                  <>
                                    <div style={{ flexGrow: 1, minHeight: 40, display: 'flex', alignItems: 'center' }}>
                                      {order.senkronData?.internalNote || <span style={{ color: '#999' }}>—</span>}
                                    </div>
                                    <IconButton
                                      size="small"
                                      onClick={() => handleEditNote(order.id)}
                                    >
                                      <EditIcon />
                                    </IconButton>
                                  </>
                                )}
                              </div>
                            </TableCell>
                            <TableCell sx={{ p: 1, minWidth: 140, fontSize: 16, fontWeight: 600, textAlign: 'center' }}>
                              <Select
                                value={order.senkronData?.customStatus ?? 'Çıkmadı'}
                                onChange={e => handleSaveStatus(order.id, e.target.value)}
                                size="small"
                              >
                                {DURUM_OPTIONS.map(opt => (
                                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                                ))}
                              </Select>
                            </TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>
                              {(() => {
                                const status = (order.status || order.externalStatus || 'UNKNOWN').toUpperCase();
                                const config = statusColors[status] || { bg: '#ccc', text: '#000' };
                                const statusOption = orderStatusOptions.find(opt => opt.value === status);
                                const label = statusOption?.label || status.replace(/_/g, ' ');
                                
                                return (
                                  <Chip 
                                    label={label} 
                                    size="small"
                                    style={{
                                      backgroundColor: config.bg,
                                      color: config.text,
                                      fontWeight: 600,
                                      fontSize: 12
                                    }}
                                  />
                                );
                              })()}
                            </TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{shipByDateTR}</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{order.marketplace || '—'}</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>
                              {order.orderNumber
                                ? order.orderNumber
                                : <span style={{ color: 'red', fontWeight: 'bold' }}>
                                    Eksik <span style={{ background: '#ffe0e0', color: '#b71c1c', borderRadius: 4, padding: '2px 6px', marginLeft: 4, fontSize: 11 }}>Order No</span>
                                  </span>
                              }
                            </TableCell>
                          </TableRow>
                        );
                      }

                      // This is a line item row
                      const orderDate = order.marketplaceOrderDate || order.createdAt;
                      const orderDateTR = orderDate ? new Date(orderDate).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour12: false }) : '—';
                      // Check item.shipBy first (for Trendyol), then fall back to order.shipByDate
                      const shipByDateTR = (item.shipBy || order.shipByDate) ? new Date(item.shipBy || order.shipByDate).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul', hour12: false }) : '—';
                      const customerNote = extractCustomerNote(order);
                      
                      return (
                        <TableRow key={row.rowKey} sx={{ height: 120 }}>
                            <TableCell sx={{ p: 1, minWidth: 120, width: 120, verticalAlign: 'middle' }}>
                              {item.image
                                ? <img src={item.image} width={100} height={100} style={{ objectFit:'cover', borderRadius: 12, display: 'block', margin: '0 auto' }} />
                                : '—'}
                            </TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{order.customerName || '—'}</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{orderDateTR}</TableCell>
                            <TableCell sx={{ p: 1, minWidth: 120, fontSize: 14 }}>{item.variantInfo || '—'}</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14, maxWidth: 150 }}>
                              {customerNote ? (
                                <div style={{ 
                                  maxHeight: 60,
                                  overflowY: 'auto',
                                  padding: '4px 8px',
                                  backgroundColor: '#f5f5f5',
                                  borderRadius: 4,
                                  fontSize: 14,
                                  border: '1px solid #ddd'
                                }}>
                                  {customerNote}
                                </div>
                              ) : (
                                <span style={{ color: '#999' }}>—</span>
                              )}
                            </TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14, minWidth: 180 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                                {editingNotes[order.id] ? (
                                  <>
                                    <TextField
                                      value={noteValues[order.id] || ''}
                                      variant="outlined"
                                      size="small"
                                      multiline
                                      rows={2}
                                      onChange={e => setNoteValues(prev => ({ ...prev, [order.id]: e.target.value }))}
                                      sx={{ 
                                        flexGrow: 1,
                                        backgroundColor: 'white',
                                        '& .MuiOutlinedInput-root': {
                                          fontSize: 14,
                                          backgroundColor: 'white',
                                        },
                                        '& .MuiOutlinedInput-input': {
                                          padding: '8px',
                                          color: '#000',
                                        }
                                      }}
                                      placeholder="Not ekleyin..."
                                      inputProps={{
                                        style: {
                                          minHeight: '40px',
                                          resize: 'vertical'
                                        }
                                      }}
                                    />
                                    <IconButton
                                      size="small"
                                      color="primary"
                                      onClick={() => handleSaveNote(order.id)}
                                      disabled={savingNotes[order.id]}
                                    >
                                      {savingNotes[order.id] ? <CircularProgress size={16} /> : <SaveIcon />}
                                    </IconButton>
                                  </>
                                ) : (
                                  <>
                                    <div style={{ flexGrow: 1, minHeight: 40, display: 'flex', alignItems: 'center' }}>
                                      {order.senkronData?.internalNote || <span style={{ color: '#999' }}>—</span>}
                                    </div>
                                    <IconButton
                                      size="small"
                                      onClick={() => handleEditNote(order.id)}
                                    >
                                      <EditIcon />
                                    </IconButton>
                                  </>
                                )}
                              </div>
                            </TableCell>
                            <TableCell sx={{ p: 1, minWidth: 140, fontSize: 16, fontWeight: 600, textAlign: 'center' }}>
                              <Select
                                value={order.senkronData?.customStatus ?? 'Çıkmadı'}
                                onChange={e => handleSaveStatus(order.id, e.target.value)}
                                size="small"
                              >
                                {DURUM_OPTIONS.map(opt => (
                                  <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                                ))}
                              </Select>
                            </TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>
                              {(() => {
                                const status = (order.status || order.externalStatus || 'UNKNOWN').toUpperCase();
                                const config = statusColors[status] || { bg: '#ccc', text: '#000' };
                                const statusOption = orderStatusOptions.find(opt => opt.value === status);
                                const label = statusOption?.label || status.replace(/_/g, ' ');
                                
                                return (
                                  <Chip 
                                    label={label} 
                                    size="small"
                                    style={{
                                      backgroundColor: config.bg,
                                      color: config.text,
                                      fontWeight: 600,
                                      fontSize: 12
                                    }}
                                  />
                                );
                              })()}
                            </TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{shipByDateTR}</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>{order.marketplace || '—'}</TableCell>
                            <TableCell sx={{ p: 1, fontSize: 14 }}>
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
          <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ mt: 4 }}>
            <Pagination
              count={Math.ceil(total / pageSize)}
              page={page}
              onChange={(e, value) => setPage(value)}
              color="primary"
              shape="rounded"
              siblingCount={1}
              boundaryCount={1}
              showFirstButton
              showLastButton
            />
            <Typography sx={{ ml: 2, minWidth: 100 }}>
              {`${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)}/${total}`}
            </Typography>
          </Stack>
        </div>
      </motion.section>
    </AppLayout>
  );
}

export default withAuth(SenkronPage);