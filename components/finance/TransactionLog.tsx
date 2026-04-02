import React, { useState, useEffect } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Chip, Select, MenuItem, FormControl, InputLabel,
  IconButton, CircularProgress, useMediaQuery, useTheme, Paper, Collapse,
} from '@mui/material';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import useFinanceStore from '@/lib/stores/useFinanceStore';

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  Sale: { bg: '#dcfce7', color: '#15803d' },
  Commission: { bg: '#fef3c7', color: '#92400e' },
  Return: { bg: '#fecaca', color: '#dc2626' },
  Cargo: { bg: '#dbeafe', color: '#1d4ed8' },
  Discount: { bg: '#fce7f3', color: '#be185d' },
  default: { bg: '#f1f5f9', color: '#475569' },
};

function getTypeColor(type: string) {
  for (const [key, val] of Object.entries(TYPE_COLORS)) {
    if (type.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return TYPE_COLORS.default;
}

export default function TransactionLog() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const {
    transactions, transactionsLoading, transactionsTotal,
    fetchTransactions,
  } = useFinanceStore();

  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  useEffect(() => {
    fetchTransactions(page, typeFilter || undefined);
  }, [page, typeFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(transactionsTotal / 50);

  if (transactionsLoading && transactions.length === 0) {
    return <Box sx={{ p: 3, textAlign: 'center' }}><CircularProgress size={24} /></Box>;
  }

  return (
    <Box sx={{ borderTop: '1px solid #f1f5f9' }}>
      {/* Filters */}
      <Box sx={{ p: 1.5, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel>İşlem Tipi</InputLabel>
          <Select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0); }} label="İşlem Tipi">
            <MenuItem value="">Tümü</MenuItem>
            <MenuItem value="Sale">Satış</MenuItem>
            <MenuItem value="Commission">Komisyon</MenuItem>
            <MenuItem value="Return">İade</MenuItem>
            <MenuItem value="Cargo">Kargo</MenuItem>
            <MenuItem value="Discount">İndirim</MenuItem>
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {transactionsTotal} işlem
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <IconButton size="small" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={16} />
          </IconButton>
          <Typography variant="caption">{page + 1} / {totalPages || 1}</Typography>
          <IconButton size="small" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={16} />
          </IconButton>
        </Box>
      </Box>

      {transactions.length === 0 ? (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">İşlem bulunamadı</Typography>
        </Box>
      ) : isMobile ? (
        /* Mobile cards */
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          {transactions.map(tx => {
            const tc = getTypeColor(tx.transactionType);
            return (
              <Paper key={tx.id} sx={{ mb: 1, overflow: 'hidden', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                <Box
                  sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
                  onClick={() => setExpandedRow(expandedRow === tx.id ? null : tx.id)}
                >
                  <Box>
                    <Chip
                      label={tx.transactionType}
                      size="small"
                      sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700, bgcolor: tc.bg, color: tc.color, mb: 0.5 }}
                    />
                    <Typography variant="caption" color="text.secondary" display="block">
                      {new Date(tx.transactionDate).toLocaleDateString('tr-TR')}
                    </Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: tx.amount >= 0 ? '#15803d' : '#dc2626' }}>
                      {tx.amount >= 0 ? '+' : ''}₺{tx.amount.toFixed(2)}
                    </Typography>
                    {expandedRow === tx.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </Box>
                </Box>
                <Collapse in={expandedRow === tx.id}>
                  <Box sx={{ px: 1.5, pb: 1.5, fontSize: '0.75rem' }}>
                    {tx.productName && <Typography variant="caption" display="block">Ürün: {tx.productName}</Typography>}
                    {tx.orderNumber && <Typography variant="caption" display="block">Sipariş: {tx.orderNumber}</Typography>}
                    {tx.barcode && <Typography variant="caption" display="block">Barkod: {tx.barcode}</Typography>}
                    {tx.commission != null && <Typography variant="caption" display="block">Komisyon: ₺{tx.commission}</Typography>}
                  </Box>
                </Collapse>
              </Paper>
            );
          })}
        </Box>
      ) : (
        /* Desktop table */
        <TableContainer sx={{ maxHeight: 400 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>Tarih</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>Tip</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>Ürün</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>Sipariş</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>Tutar</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>Komisyon</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {transactions.map(tx => {
                const tc = getTypeColor(tx.transactionType);
                return (
                  <TableRow key={tx.id} hover>
                    <TableCell sx={{ fontSize: '0.75rem' }}>
                      {new Date(tx.transactionDate).toLocaleDateString('tr-TR')}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={tx.transactionType}
                        size="small"
                        sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700, bgcolor: tc.bg, color: tc.color }}
                      />
                    </TableCell>
                    <TableCell sx={{ maxWidth: 180, fontSize: '0.75rem' }}>
                      <Typography variant="body2" sx={{ fontSize: '0.75rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tx.productName || '—'}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ fontSize: '0.75rem' }}>{tx.orderNumber || '—'}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontSize: '0.75rem', fontWeight: 600, color: tx.amount >= 0 ? '#15803d' : '#dc2626' }}>
                        {tx.amount >= 0 ? '+' : ''}₺{tx.amount.toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.75rem' }}>
                      {tx.commission != null ? `₺${tx.commission}` : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
