import React, { useState, useMemo } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, Typography, Chip, TextField, InputAdornment, IconButton,
  Tooltip, useMediaQuery, useTheme, Paper, Collapse,
} from '@mui/material';
import { Search, ChevronDown, ChevronUp, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import useFinanceStore, { ProductBreakdown } from '@/lib/stores/useFinanceStore';

type SortKey = keyof ProductBreakdown;
type SortDir = 'asc' | 'desc';

const CURRENCY_SYMBOLS: Record<string, string> = {
  trendyol: '₺',
  etsy: '$',
  ebay: '$',
};

function formatMoney(val: number, symbol = '₺'): string {
  return `${symbol}${(val ?? 0).toFixed(2)}`;
}

function marginColor(margin: number): string {
  if (margin >= 20) return '#15803d';
  if (margin >= 10) return '#ca8a04';
  return '#dc2626';
}

function marginBg(margin: number): string {
  if (margin >= 20) return '#dcfce7';
  if (margin >= 10) return '#fef9c3';
  return '#fecaca';
}

function getMargin(p: ProductBreakdown): number {
  return p.revenue > 0 ? (p.netProfit / p.revenue) * 100 : 0;
}

export default function ProductPnLTable({ products }: { products: ProductBreakdown[] }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { updateProductCost, marketplace } = useFinanceStore();
  const t = useTranslations('financials');
  const cs = CURRENCY_SYMBOLS[marketplace] || '$';
  const fmt = (val: number) => formatMoney(val, cs);

  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('revenue');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [editingCost, setEditingCost] = useState<string | null>(null);
  const [costValue, setCostValue] = useState('');
  const [expandedRow, setExpandedRow] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = products;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(p => (p.productName || '').toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q));
    }
    list = [...list].sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return list;
  }, [products, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  const handleCostSave = async (barcode: string) => {
    const val = parseFloat(costValue);
    if (isNaN(val) || val < 0) return;
    try {
      await updateProductCost(barcode, val);
      setEditingCost(null);
    } catch { /* toast handled in store */ }
  };

  const handleExportCSV = () => {
    const headers = [t('product'), t('barcode'), t('sales'), t('revenue'), t('commission'), t('shipping'), t('cost'), t('profit'), t('margin')];
    const rows = filtered.map(p => [
      p.productName, p.barcode, p.quantity, Number(p.revenue).toFixed(2),
      Number(p.commissions).toFixed(2), Number(p.shipping).toFixed(2), Number(p.cogs).toFixed(2),
      Number(p.netProfit).toFixed(2), getMargin(p).toFixed(1),
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `urun-kar-zarar-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (products.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {t('noProductData')}
        </Typography>
      </Box>
    );
  }

  // Mobile: expandable cards
  if (isMobile) {
    return (
      <Box sx={{ p: 1 }}>
        <TextField
          size="small" fullWidth placeholder={t('searchProduct')}
          value={search} onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
          sx={{ mb: 1 }}
        />
        {filtered.map(p => (
          <Paper key={p.barcode} sx={{ mb: 1, overflow: 'hidden', borderRadius: '10px', border: '1px solid #f1f5f9' }}>
            <Box
              sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
              onClick={() => setExpandedRow(expandedRow === p.barcode ? null : p.barcode)}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.productName}
                </Typography>
                <Typography variant="caption" color="text.secondary">{p.quantity} {t('sales')}</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: p.netProfit >= 0 ? '#15803d' : '#dc2626' }}>
                  {fmt(p.netProfit)}
                </Typography>
                <Chip
                  label={`%${getMargin(p).toFixed(0)}`}
                  size="small"
                  sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: marginBg(getMargin(p)), color: marginColor(getMargin(p)) }}
                />
                {expandedRow === p.barcode ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </Box>
            </Box>
            <Collapse in={expandedRow === p.barcode}>
              <Box sx={{ px: 1.5, pb: 1.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                <Box><Typography variant="caption" color="text.secondary">{t('revenue')}</Typography><Typography variant="body2" fontWeight={600}>{fmt(p.revenue)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('commission')}</Typography><Typography variant="body2" fontWeight={600} color="warning.main">{fmt(p.commissions)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('shipping')}</Typography><Typography variant="body2" fontWeight={600} color="info.main">{fmt(p.shipping)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">{t('cost')}</Typography><Typography variant="body2" fontWeight={600} color="secondary.main">{fmt(p.cogs)}</Typography></Box>
              </Box>
            </Collapse>
          </Paper>
        ))}
      </Box>
    );
  }

  // Desktop: sortable table
  return (
    <Box>
      <Box sx={{ px: 2, pt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TextField
          size="small" placeholder={t('searchProduct')}
          value={search} onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
          sx={{ width: 250 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {filtered.length} {t('products')}
        </Typography>
        <Tooltip title={t('downloadCSV')}>
          <IconButton size="small" onClick={handleExportCSV}><Download size={16} /></IconButton>
        </Tooltip>
      </Box>
      <TableContainer sx={{ maxHeight: 400 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>{t('product')}</TableCell>
              {[
                { key: 'quantity' as SortKey, label: t('sales') },
                { key: 'revenue' as SortKey, label: t('revenue') },
                { key: 'commissions' as SortKey, label: t('commission') },
                { key: 'shipping' as SortKey, label: t('shipping') },
                { key: 'cogs' as SortKey, label: t('cost') },
                { key: 'netProfit' as SortKey, label: t('profit') },
                { key: 'netProfit' as SortKey, label: t('margin') },
              ].map(col => (
                <TableCell key={col.key} align="right" sx={{ fontWeight: 700, fontSize: '0.75rem' }}>
                  <TableSortLabel
                    active={sortKey === col.key}
                    direction={sortKey === col.key ? sortDir : 'desc'}
                    onClick={() => handleSort(col.key)}
                  >
                    {col.label}
                  </TableSortLabel>
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map(p => (
              <TableRow key={p.barcode} hover sx={{ '&:hover': { bgcolor: '#f8fafc' } }}>
                <TableCell sx={{ maxWidth: 200 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.8rem' }}>
                    {p.productName}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>
                    {p.barcode}
                  </Typography>
                </TableCell>
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem">{p.quantity}</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem" fontWeight={600}>{fmt(p.revenue)}</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem" color="warning.main">{fmt(p.commissions)}</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem" color="info.main">{fmt(p.shipping)}</Typography></TableCell>
                <TableCell align="right">
                  {editingCost === p.barcode ? (
                    <TextField
                      size="small" autoFocus
                      value={costValue}
                      onChange={e => setCostValue(e.target.value)}
                      onBlur={() => handleCostSave(p.barcode || '')}
                      onKeyDown={e => e.key === 'Enter' && handleCostSave(p.barcode || '')}
                      sx={{ width: 80, '& input': { fontSize: '0.8rem', textAlign: 'right' } }}
                      InputProps={{ startAdornment: <InputAdornment position="start" sx={{ '& p': { fontSize: '0.75rem' } }}>{cs}</InputAdornment> }}
                    />
                  ) : (
                    <Typography
                      variant="body2" fontSize="0.8rem" color="secondary.main"
                      sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                      onClick={() => { setEditingCost(p.barcode); setCostValue(String(p.cogs || 0)); }}
                    >
                      {p.cogs > 0 ? fmt(p.cogs) : '—'}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" fontSize="0.8rem" fontWeight={700} sx={{ color: p.netProfit >= 0 ? '#15803d' : '#dc2626' }}>
                    {fmt(p.netProfit)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Chip
                    label={`%${getMargin(p).toFixed(1)}`}
                    size="small"
                    sx={{
                      height: 22, fontSize: '0.7rem', fontWeight: 700,
                      bgcolor: marginBg(getMargin(p)), color: marginColor(getMargin(p)),
                    }}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
