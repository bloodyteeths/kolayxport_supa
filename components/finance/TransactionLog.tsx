import React, { useState, useEffect } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, Chip, Select, MenuItem, FormControl, InputLabel,
  IconButton, CircularProgress, useMediaQuery, useTheme, Paper, Collapse,
} from '@mui/material';
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useFinanceStore from '@/lib/stores/useFinanceStore';

const TYPE_COLORS: Record<string, { bg: string; color: string }> = {
  // Etsy real ledger types
  EtsyFee: { bg: '#fef3c7', color: '#92400e' },
  AdSpend: { bg: '#fce7f3', color: '#be185d' },
  Disbursement: { bg: '#e0f2fe', color: '#0369a1' },
  SalesTax: { bg: '#f1f5f9', color: '#64748b' },
  SellerCredit: { bg: '#dcfce7', color: '#15803d' },
  // Generic / other marketplaces (substring match)
  Sale: { bg: '#dcfce7', color: '#15803d' },
  Commission: { bg: '#fef3c7', color: '#92400e' },
  Return: { bg: '#fecaca', color: '#dc2626' },
  Refund: { bg: '#fecaca', color: '#dc2626' },
  Cargo: { bg: '#dbeafe', color: '#1d4ed8' },
  Kargo: { bg: '#dbeafe', color: '#1d4ed8' },
  Reklam: { bg: '#fce7f3', color: '#be185d' },
  Discount: { bg: '#fce7f3', color: '#be185d' },
  default: { bg: '#f1f5f9', color: '#475569' },
};

function getTypeColor(type: string) {
  for (const [key, val] of Object.entries(TYPE_COLORS)) {
    if (type.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return TYPE_COLORS.default;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  trendyol: '₺',
  etsy: '$',
  ebay: '$',
};

export default function TransactionLog() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations('financials');
  const {
    transactions, transactionsLoading, transactionsTotal,
    fetchTransactions, marketplace, dashboardData,
  } = useFinanceStore();
  const cs = CURRENCY_SYMBOLS[marketplace] || '$';

  const [page, setPage] = useState(0);
  const [typeFilter, setTypeFilter] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  // Real, exact transaction types present in the current period (the API
  // filters by exact match). Derived from the dashboard's type summary so the
  // dropdown always matches what actually exists — Etsy: Sale/EtsyFee/AdSpend/
  // Refund/Disbursement/SalesTax..., Trendyol: Satış/Komisyon Faturası/... —
  // instead of hardcoded generic labels that matched nothing.
  const typeOptions = React.useMemo(() => {
    const summary = dashboardData?.transactionTypeSummary || [];
    return [...summary]
      .filter(s => s.type && s.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(s => ({ type: s.type, count: s.count }));
  }, [dashboardData]);

  // If the current filter no longer exists in this period, reset to All.
  useEffect(() => {
    if (typeFilter && typeOptions.length > 0 && !typeOptions.some(o => o.type === typeFilter)) {
      setTypeFilter('');
    }
  }, [typeOptions]); // eslint-disable-line react-hooks/exhaustive-deps

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
          <InputLabel>{t('transactionType')}</InputLabel>
          <Select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setPage(0); }} label={t('transactionType')}>
            <MenuItem value="">{t('all')}</MenuItem>
            {typeOptions.map(o => (
              <MenuItem key={o.type} value={o.type}>{o.type} ({o.count})</MenuItem>
            ))}
          </Select>
        </FormControl>
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {transactionsTotal} {t('transactions')}
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
          <Typography variant="body2" color="text.secondary">{t('noTransactions')}</Typography>
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
                    <Typography variant="body2" sx={{ fontWeight: 700, color: Number(tx.amount) >= 0 ? '#15803d' : '#dc2626' }}>
                      {Number(tx.amount) >= 0 ? '+' : ''}{cs}{Number(tx.amount).toFixed(2)}
                    </Typography>
                    {expandedRow === tx.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </Box>
                </Box>
                <Collapse in={expandedRow === tx.id}>
                  <Box sx={{ px: 1.5, pb: 1.5, fontSize: '0.75rem' }}>
                    {tx.productName && <Typography variant="caption" display="block">{t('product')}: {tx.productName}</Typography>}
                    {tx.orderNumber && <Typography variant="caption" display="block">{t('order')}: {tx.orderNumber}</Typography>}
                    {tx.barcode && <Typography variant="caption" display="block">{t('barcode')}: {tx.barcode}</Typography>}
                    {tx.commission != null && <Typography variant="caption" display="block">{t('commission')}: {cs}{Number(tx.commission).toFixed(2)}</Typography>}
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
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('date')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('type')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('product')}</TableCell>
                <TableCell sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('order')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('amount')}</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{t('commission')}</TableCell>
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
                      <Typography variant="body2" sx={{ fontSize: '0.75rem', fontWeight: 600, color: Number(tx.amount) >= 0 ? '#15803d' : '#dc2626' }}>
                        {Number(tx.amount) >= 0 ? '+' : ''}{cs}{Number(tx.amount).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ fontSize: '0.75rem' }}>
                      {tx.commission != null ? `${cs}${Number(tx.commission).toFixed(2)}` : '—'}
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
