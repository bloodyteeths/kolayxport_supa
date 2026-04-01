import React, { useState } from 'react';
import {
  Box, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, TablePagination, Paper, Typography, Chip, IconButton,
  TextField, InputAdornment, Collapse, useMediaQuery, useTheme, Avatar,
  Tooltip,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { useTranslations } from 'next-intl';
import type { ArbitrageResult } from '../../../../lib/arbitrage/types';
import useLocaleStore from '../../../../lib/stores/useLocaleStore';
import { formatCurrency, formatPercent, getVerdictConfig } from './arbitrageConstants';
import { useArbitrageStore } from './useArbitrageStore';

interface Props {
  results: ArbitrageResult[];
  onViewDetail: (idx: number) => void;
}

export default function ArbitrageResultsTable({ results, onViewDetail }: Props) {
  const ta = useTranslations('ebay.research.arbitrage');
  const locale = useLocaleStore(s => s.locale);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const { sortField, sortDirection, setSortField, toggleSortDirection, searchText, setSearchText } = useArbitrageStore();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const paginatedResults = results.slice(page * rowsPerPage, (page + 1) * rowsPerPage);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      toggleSortDirection();
    } else {
      setSortField(field);
    }
  };

  if (results.length === 0) {
    return (
      <Paper sx={{ p: 3, textAlign: 'center' }} variant="outlined">
        <Typography color="text.secondary">{ta('noResultsFound')}</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      {/* Search */}
      <TextField
        size="small"
        placeholder={ta('searchProducts')}
        value={searchText}
        onChange={(e) => setSearchText(e.target.value)}
        sx={{ mb: 1.5, maxWidth: 300 }}
        InputProps={{
          startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
        }}
        fullWidth={isMobile}
      />

      {isMobile ? (
        // Mobile: Expandable cards
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {paginatedResults.map((r, idx) => {
            const globalIdx = page * rowsPerPage + idx;
            const vc = getVerdictConfig(r.verdict);
            const isExpanded = expandedRow === globalIdx;

            return (
              <Paper key={globalIdx} variant="outlined" sx={{ overflow: 'hidden' }}>
                <Box
                  sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, cursor: 'pointer' }}
                  onClick={() => setExpandedRow(isExpanded ? null : globalIdx)}
                >
                  <Avatar
                    src={r.trendyol.imageUrl}
                    variant="rounded"
                    sx={{ width: 48, height: 48 }}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {r.trendyol.brand ? `${r.trendyol.brand} — ` : ''}{r.trendyol.name}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5 }}>
                      <Typography variant="caption">
                        {formatCurrency(r.trendyol.priceTry, 'TRY', locale)} → {formatCurrency(r.ebay.medianPrice, 'USD', locale)}
                      </Typography>
                      <Chip
                        label={`${ta(vc.label)} ${r.score}`}
                        size="small"
                        sx={{ fontSize: '0.65rem', height: 20, bgcolor: vc.bg, color: vc.color, fontWeight: 700 }}
                      />
                    </Box>
                  </Box>
                  <Box sx={{ textAlign: 'right', minWidth: 50 }}>
                    <Typography variant="body2" sx={{ fontWeight: 700, color: r.financials.profitUsd > 0 ? '#2e7d32' : '#c62828' }}>
                      {formatCurrency(r.financials.profitUsd, 'USD', locale)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {formatPercent(r.financials.roiPercent)}
                    </Typography>
                  </Box>
                  {isExpanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                </Box>

                <Collapse in={isExpanded}>
                  <Box sx={{ px: 1.5, pb: 1.5, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5, fontSize: '0.75rem' }}>
                    <Typography variant="caption">{ta("costLabel")}: {formatCurrency(r.financials.costUsd, 'USD', locale)}</Typography>
                    <Typography variant="caption">{ta("shippingLabel")}: {formatCurrency(r.financials.shippingUsd, 'USD', locale)}</Typography>
                    <Typography variant="caption">{ta("ebayFeeLabel")}: {formatCurrency(r.financials.ebayFeeUsd, 'USD', locale)}</Typography>
                    <Typography variant="caption">{ta("paymentLabel")}: {formatCurrency(r.financials.paymentFeeUsd, 'USD', locale)}</Typography>
                    <Typography variant="caption">{ta("totalCostLabel")}: {formatCurrency(r.financials.totalCostUsd, 'USD', locale)}</Typography>
                    <Typography variant="caption">{ta("marginLabel")}: {formatPercent(r.financials.marginPercent)}</Typography>
                    {r.matchTier && (
                      <Typography variant="caption">{ta("matchLabel")}: {r.matchTier === 'gtin' ? 'GTIN' : r.matchTier === 'gemini' ? 'AI' : 'Fallback'}</Typography>
                    )}
                    {r.translatedQuery && (
                      <Typography variant="caption">{ta("queryLabel")}: {r.translatedQuery}</Typography>
                    )}
                    <Box sx={{ gridColumn: '1 / -1', display: 'flex', gap: 1, mt: 0.5 }}>
                      <Chip
                        label={ta("detail")}
                        size="small"
                        variant="outlined"
                        onClick={() => onViewDetail(globalIdx)}
                        sx={{ fontSize: '0.7rem' }}
                      />
                      <Chip
                        label="Trendyol"
                        size="small"
                        variant="outlined"
                        component="a"
                        href={r.trendyol.url}
                        target="_blank"
                        clickable
                        sx={{ fontSize: '0.7rem' }}
                      />
                    </Box>
                  </Box>
                </Collapse>
              </Paper>
            );
          })}
        </Box>
      ) : (
        // Desktop: Sortable table
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow sx={{ '& th': { fontWeight: 700, fontSize: '0.75rem' } }}>
                <TableCell sx={{ width: 48 }} />
                <TableCell>{ta("product")}</TableCell>
                <TableCell>{ta("brand")}</TableCell>
                <TableCell align="right">Trendyol</TableCell>
                <TableCell align="right">
                  <TableSortLabel
                    active={sortField === 'suggestedPriceUsd'}
                    direction={sortField === 'suggestedPriceUsd' ? sortDirection : 'desc'}
                    onClick={() => handleSort('suggestedPriceUsd')}
                  >
                    eBay
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">
                  <TableSortLabel
                    active={sortField === 'profitUsd'}
                    direction={sortField === 'profitUsd' ? sortDirection : 'desc'}
                    onClick={() => handleSort('profitUsd')}
                  >
                    {ta("profit")}
                  </TableSortLabel>
                </TableCell>
                <TableCell align="right">
                  <TableSortLabel
                    active={sortField === 'roiPercent'}
                    direction={sortField === 'roiPercent' ? sortDirection : 'desc'}
                    onClick={() => handleSort('roiPercent')}
                  >
                    ROI
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center">
                  <TableSortLabel
                    active={sortField === 'score'}
                    direction={sortField === 'score' ? sortDirection : 'desc'}
                    onClick={() => handleSort('score')}
                  >
                    {ta("scoreLabel")}
                  </TableSortLabel>
                </TableCell>
                <TableCell align="center" sx={{ width: 80 }}>{ta("action")}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {paginatedResults.map((r, idx) => {
                const globalIdx = page * rowsPerPage + idx;
                const vc = getVerdictConfig(r.verdict);
                return (
                  <TableRow key={globalIdx} hover sx={{ cursor: 'pointer' }} onClick={() => onViewDetail(globalIdx)}>
                    <TableCell>
                      <Avatar src={r.trendyol.imageUrl} variant="rounded" sx={{ width: 40, height: 40 }} />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" noWrap sx={{ maxWidth: 200, fontSize: '0.8rem' }}>
                        {r.trendyol.name}
                      </Typography>
                      {r.translatedQuery && (
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ maxWidth: 200, display: 'block' }}>
                          {r.translatedQuery}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption">{r.trendyol.brand}</Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                        {formatCurrency(r.trendyol.priceTry, 'TRY', locale)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>
                        {formatCurrency(r.ebay.medianPrice, 'USD', locale)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{
                        fontWeight: 700, fontSize: '0.8rem',
                        color: r.financials.profitUsd > 0 ? '#2e7d32' : '#c62828',
                      }}>
                        {formatCurrency(r.financials.profitUsd, 'USD', locale)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" sx={{
                        fontSize: '0.8rem',
                        color: r.financials.roiPercent > 0 ? '#2e7d32' : '#c62828',
                      }}>
                        {formatPercent(r.financials.roiPercent)}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Chip
                        label={`${r.score}`}
                        size="small"
                        sx={{ fontSize: '0.7rem', height: 22, bgcolor: vc.bg, color: vc.color, fontWeight: 700, minWidth: 40 }}
                      />
                    </TableCell>
                    <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                      <Tooltip title={ta("detail")}>
                        <IconButton size="small" onClick={() => onViewDetail(globalIdx)}>
                          <VisibilityIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Trendyol">
                        <IconButton size="small" component="a" href={r.trendyol.url} target="_blank">
                          <OpenInNewIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TablePagination
        component="div"
        count={results.length}
        page={page}
        onPageChange={(_, newPage) => setPage(newPage)}
        rowsPerPage={rowsPerPage}
        onRowsPerPageChange={(e) => { setRowsPerPage(parseInt(e.target.value)); setPage(0); }}
        rowsPerPageOptions={[10, 25, 50]}
        labelRowsPerPage={ta("rowsPerPage")}
        labelDisplayedRows={({ from, to, count }) => `${from}-${to} / ${count}`}
        sx={{ borderTop: 'none' }}
      />
    </Box>
  );
}
