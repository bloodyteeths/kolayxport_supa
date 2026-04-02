import React, { useMemo } from 'react';
import {
  Box, Typography, Paper, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  useMediaQuery, Chip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { Tag, BarChart2, DollarSign, PieChart } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useTrendyolResearchStore } from '@/lib/stores/useTrendyolResearchStore';
import { useTableSort } from '@/components/etsy/research/shared/ui';
import { StatCard, GradientBar, GRADIENTS, glassCard } from '@/components/etsy/research/shared/ui';

function fmtTry(n: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export default function TrendyolBrandAnalyzer() {
  const t = useTranslations('trendyolResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const analysis = useTrendyolResearchStore(s => s.analysis);

  const topBrands = analysis?.topBrands ?? [];
  const totalProducts = useMemo(
    () => topBrands.reduce((s, b) => s + b.count, 0),
    [topBrands],
  );
  const maxCount = useMemo(
    () => Math.max(...topBrands.map(b => b.count), 1),
    [topBrands],
  );

  // Brands with market share
  const brandsWithShare = useMemo(
    () => topBrands.map(b => ({
      ...b,
      marketShare: totalProducts > 0 ? (b.count / totalProducts) * 100 : 0,
    })),
    [topBrands, totalProducts],
  );

  const { sorted, sortKey, sortDir, handleSort } = useTableSort(brandsWithShare, 'count');

  // Top-3 concentration
  const top3Pct = useMemo(() => {
    const top3 = [...topBrands].sort((a, b) => b.count - a.count).slice(0, 3);
    const top3Sum = top3.reduce((s, b) => s + b.count, 0);
    return totalProducts > 0 ? (top3Sum / totalProducts) * 100 : 0;
  }, [topBrands, totalProducts]);

  if (!analysis || topBrands.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        <Tag size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
        <Typography>{t('noProducts')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Summary stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 1.5, mb: 2 }}>
        <StatCard label={t('uniqueBrands')} value={`${analysis.uniqueBrands}`} color="#7B1FA2" icon={<Tag size={18} />} />
        <StatCard label={t('topBrands')} value={topBrands[0]?.name ?? '-'} color="#2196F3" icon={<BarChart2 size={18} />} />
        <StatCard
          label="Top 3"
          value={pct(top3Pct)}
          color={top3Pct > 60 ? '#f44336' : '#11998e'}
          icon={<PieChart size={18} />}
        />
      </Box>

      {/* Concentration bar chart */}
      <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
          {t('brands')} - {t('competition')}
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {brandsWithShare.slice(0, 10).map((b, i) => (
            <Box key={b.name} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography
                variant="body2"
                sx={{
                  width: isMobile ? 80 : 140,
                  fontWeight: i < 3 ? 700 : 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                {b.name}
              </Typography>
              <Box sx={{ flex: 1 }}>
                <Tooltip title={`${b.count} ${t('products')} (${pct(b.marketShare)})`}>
                  <Box sx={{
                    height: 24,
                    width: `${Math.max((b.count / maxCount) * 100, 4)}%`,
                    background: i < 3 ? GRADIENTS.primary : GRADIENTS.info,
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    px: 1,
                    transition: 'width 0.5s ease-out',
                  }}>
                    <Typography variant="caption" sx={{ color: '#fff', fontWeight: 700, fontSize: '0.65rem' }}>
                      {b.count}
                    </Typography>
                  </Box>
                </Tooltip>
              </Box>
              <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', minWidth: 40, textAlign: 'right' }}>
                {pct(b.marketShare)}
              </Typography>
            </Box>
          ))}
        </Box>
      </Paper>

      {/* Brand table / mobile cards */}
      {isMobile ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {sorted.map((b, i) => (
            <Paper key={b.name} sx={{ ...glassCard, p: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{b.name}</Typography>
                <Chip label={pct(b.marketShare)} size="small" color={b.marketShare > 10 ? 'primary' : 'default'} sx={{ fontWeight: 600 }} />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                <Typography variant="caption" color="text.secondary">
                  {b.count} {t('products')}
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {fmtTry(b.avgPrice)}
                </Typography>
              </Box>
              <Box sx={{ mt: 0.5 }}>
                <GradientBar value={b.marketShare} max={100} />
              </Box>
            </Paper>
          ))}
        </Box>
      ) : (
        <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                  <TableCell>
                    <TableSortLabel active={sortKey === 'name'} direction={sortDir} onClick={() => handleSort('name')}>
                      {t('brand')}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">
                    <TableSortLabel active={sortKey === 'count'} direction={sortDir} onClick={() => handleSort('count')}>
                      {t('products')}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">
                    <TableSortLabel active={sortKey === 'avgPrice'} direction={sortDir} onClick={() => handleSort('avgPrice')}>
                      {t('avgPrice')}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">
                    <TableSortLabel active={sortKey === 'marketShare'} direction={sortDir} onClick={() => handleSort('marketShare')}>
                      %
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: '25%' }}>{t('priceDistribution')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map((b) => (
                  <TableRow key={b.name} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>{b.name}</Typography>
                    </TableCell>
                    <TableCell align="center">{b.count}</TableCell>
                    <TableCell align="center">{fmtTry(b.avgPrice)}</TableCell>
                    <TableCell align="center">{pct(b.marketShare)}</TableCell>
                    <TableCell>
                      <GradientBar value={b.marketShare} max={100} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
