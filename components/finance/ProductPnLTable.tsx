import React, { useState, useMemo } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, Typography, Chip, TextField, InputAdornment, IconButton,
  Tooltip, useMediaQuery, useTheme, Paper, Collapse,
} from '@mui/material';
import { Search, ChevronDown, ChevronUp, Download } from 'lucide-react';
import useFinanceStore, { ProductBreakdown } from '@/lib/stores/useFinanceStore';

type SortKey = keyof ProductBreakdown;
type SortDir = 'asc' | 'desc';

function formatTRY(val: number): string {
  return `₺${val.toFixed(2)}`;
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

export default function ProductPnLTable({ products }: { products: ProductBreakdown[] }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const { updateProductCost } = useFinanceStore();

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
      list = list.filter(p => p.productName.toLowerCase().includes(q) || p.barcode?.toLowerCase().includes(q));
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
    const headers = ['Ürün', 'Barkod', 'Satış', 'Gelir', 'Komisyon', 'Kargo', 'Maliyet', 'Kâr', 'Marj %'];
    const rows = filtered.map(p => [
      p.productName, p.barcode, p.unitsSold, p.revenue.toFixed(2),
      p.commission.toFixed(2), p.shipping.toFixed(2), p.cogs.toFixed(2),
      p.profit.toFixed(2), p.margin.toFixed(1),
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
          Henüz ürün verisi yok. Önce verileri senkronize edin.
        </Typography>
      </Box>
    );
  }

  // Mobile: expandable cards
  if (isMobile) {
    return (
      <Box sx={{ p: 1 }}>
        <TextField
          size="small" fullWidth placeholder="Ürün ara..."
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
                <Typography variant="caption" color="text.secondary">{p.unitsSold} satış</Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, color: p.profit >= 0 ? '#15803d' : '#dc2626' }}>
                  {formatTRY(p.profit)}
                </Typography>
                <Chip
                  label={`%${p.margin.toFixed(0)}`}
                  size="small"
                  sx={{ height: 20, fontSize: '0.65rem', fontWeight: 700, bgcolor: marginBg(p.margin), color: marginColor(p.margin) }}
                />
                {expandedRow === p.barcode ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </Box>
            </Box>
            <Collapse in={expandedRow === p.barcode}>
              <Box sx={{ px: 1.5, pb: 1.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                <Box><Typography variant="caption" color="text.secondary">Gelir</Typography><Typography variant="body2" fontWeight={600}>{formatTRY(p.revenue)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Komisyon</Typography><Typography variant="body2" fontWeight={600} color="warning.main">{formatTRY(p.commission)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Kargo</Typography><Typography variant="body2" fontWeight={600} color="info.main">{formatTRY(p.shipping)}</Typography></Box>
                <Box><Typography variant="caption" color="text.secondary">Maliyet</Typography><Typography variant="body2" fontWeight={600} color="secondary.main">{formatTRY(p.cogs)}</Typography></Box>
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
          size="small" placeholder="Ürün ara..."
          value={search} onChange={e => setSearch(e.target.value)}
          InputProps={{ startAdornment: <InputAdornment position="start"><Search size={16} /></InputAdornment> }}
          sx={{ width: 250 }}
        />
        <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
          {filtered.length} ürün
        </Typography>
        <Tooltip title="CSV İndir">
          <IconButton size="small" onClick={handleExportCSV}><Download size={16} /></IconButton>
        </Tooltip>
      </Box>
      <TableContainer sx={{ maxHeight: 400 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700, fontSize: '0.75rem' }}>Ürün</TableCell>
              {[
                { key: 'unitsSold' as SortKey, label: 'Satış' },
                { key: 'revenue' as SortKey, label: 'Gelir' },
                { key: 'commission' as SortKey, label: 'Komisyon' },
                { key: 'shipping' as SortKey, label: 'Kargo' },
                { key: 'cogs' as SortKey, label: 'Maliyet' },
                { key: 'profit' as SortKey, label: 'Kâr' },
                { key: 'margin' as SortKey, label: 'Marj %' },
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
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem">{p.unitsSold}</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem" fontWeight={600}>{formatTRY(p.revenue)}</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem" color="warning.main">{formatTRY(p.commission)}</Typography></TableCell>
                <TableCell align="right"><Typography variant="body2" fontSize="0.8rem" color="info.main">{formatTRY(p.shipping)}</Typography></TableCell>
                <TableCell align="right">
                  {editingCost === p.barcode ? (
                    <TextField
                      size="small" autoFocus
                      value={costValue}
                      onChange={e => setCostValue(e.target.value)}
                      onBlur={() => handleCostSave(p.barcode)}
                      onKeyDown={e => e.key === 'Enter' && handleCostSave(p.barcode)}
                      sx={{ width: 80, '& input': { fontSize: '0.8rem', textAlign: 'right' } }}
                      InputProps={{ startAdornment: <InputAdornment position="start" sx={{ '& p': { fontSize: '0.75rem' } }}>₺</InputAdornment> }}
                    />
                  ) : (
                    <Typography
                      variant="body2" fontSize="0.8rem" color="secondary.main"
                      sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
                      onClick={() => { setEditingCost(p.barcode); setCostValue(String(p.cogs || 0)); }}
                    >
                      {p.cogs > 0 ? formatTRY(p.cogs) : '—'}
                    </Typography>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Typography variant="body2" fontSize="0.8rem" fontWeight={700} sx={{ color: p.profit >= 0 ? '#15803d' : '#dc2626' }}>
                    {formatTRY(p.profit)}
                  </Typography>
                </TableCell>
                <TableCell align="right">
                  <Chip
                    label={`%${p.margin.toFixed(1)}`}
                    size="small"
                    sx={{
                      height: 22, fontSize: '0.7rem', fontWeight: 700,
                      bgcolor: marginBg(p.margin), color: marginColor(p.margin),
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
