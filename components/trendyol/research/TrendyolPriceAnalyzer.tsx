import React, { useMemo } from 'react';
import {
  Box, Typography, Paper, Tooltip, Alert,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  useMediaQuery, Chip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  DollarSign, BarChart2, Target, TrendingUp, TrendingDown, Percent, Tag,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useTrendyolResearchStore } from '@/lib/stores/useTrendyolResearchStore';
import { StatCard, GradientBar, GRADIENTS, glassCard } from '@/components/etsy/research/shared/ui';

function fmtTry(n: number): string {
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(n);
}

function pct(n: number): string {
  return `${n.toFixed(1)}%`;
}

export default function TrendyolPriceAnalyzer() {
  const t = useTranslations('trendyolResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const analysis = useTrendyolResearchStore(s => s.analysis);

  const priceStats = analysis?.priceStats ?? null;
  const histogram = analysis?.priceHistogram ?? [];
  const maxBucketCount = useMemo(
    () => Math.max(...histogram.map(b => b.count), 1),
    [histogram],
  );

  // Determine sweet spot bucket (highest count)
  const sweetSpot = useMemo(() => {
    if (histogram.length === 0) return null;
    const best = [...histogram].sort((a, b) => b.count - a.count)[0];
    return best;
  }, [histogram]);

  if (!analysis || !priceStats) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        <DollarSign size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
        <Typography>{t('noProducts')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Stats grid */}
      <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(6, 1fr)', gap: 1.5, mb: 2 }}>
        <StatCard label={t('minPrice')} value={fmtTry(priceStats.min)} color="#11998e" icon={<TrendingDown size={18} />} />
        <StatCard label={t('avgPrice')} value={fmtTry(priceStats.avg)} color="#2196F3" icon={<BarChart2 size={18} />} />
        <StatCard label={t('medianPrice')} value={fmtTry(priceStats.median)} color="#ff9800" icon={<Target size={18} />} />
        <StatCard label={t('maxPrice')} value={fmtTry(priceStats.max)} color="#f44336" icon={<TrendingUp size={18} />} />
        <StatCard label="P25" value={fmtTry(priceStats.p25)} color="#7B1FA2" icon={<DollarSign size={18} />} />
        <StatCard label="P75" value={fmtTry(priceStats.p75)} color="#E040FB" icon={<DollarSign size={18} />} />
      </Box>

      {/* Sweet spot */}
      {sweetSpot && (
        <Alert severity="success" sx={{
          mb: 2, borderRadius: '12px',
          background: 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)',
          border: '1px solid rgba(17,153,142,0.2)',
        }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {t('sweetSpot')}: {sweetSpot.range}
          </Typography>
          <Typography variant="body2">
            {sweetSpot.count} {t('products')} ({pct((sweetSpot.count / histogram.reduce((s, b) => s + b.count, 0)) * 100)})
          </Typography>
        </Alert>
      )}

      {/* Discount analysis */}
      {analysis.avgDiscount > 0 && (
        <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Percent size={18} color="#F2994A" />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('avgDiscount')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="h4" sx={{ fontWeight: 800, color: '#F2994A' }}>
              {pct(analysis.avgDiscount)}
            </Typography>
            <GradientBar value={analysis.avgDiscount} max={100} height={12} />
          </Box>
        </Paper>
      )}

      {/* Histogram */}
      {histogram.length > 1 && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
            {t('priceDistribution')}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 140 }}>
            {histogram.map((b, i) => {
              const isSweetSpot = sweetSpot && b.range === sweetSpot.range;
              return (
                <Tooltip key={i} title={`${b.range}: ${b.count} ${t('products')}`}>
                  <Box sx={{
                    flex: 1, minWidth: 0,
                    height: `${Math.max((b.count / maxBucketCount) * 100, 3)}%`,
                    background: isSweetSpot ? GRADIENTS.success : GRADIENTS.primary,
                    borderRadius: '6px 6px 0 0',
                    transition: 'height 0.3s, transform 0.2s',
                    cursor: 'pointer',
                    '&:hover': { transform: 'scaleY(1.05)', opacity: 0.85 },
                  }} />
                </Tooltip>
              );
            })}
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{fmtTry(priceStats.min)}</Typography>
            <Typography variant="caption" color="text.secondary">{fmtTry(priceStats.max)}</Typography>
          </Box>
        </Paper>
      )}

      {/* Price range table / mobile cards */}
      {isMobile ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {histogram.map((b, i) => {
            const total = histogram.reduce((s, h) => s + h.count, 0);
            const bucketPct = total > 0 ? (b.count / total) * 100 : 0;
            return (
              <Paper key={i} sx={{ ...glassCard, p: 1.5 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{b.range}</Typography>
                  <Chip label={`${b.count} ${t('products')}`} size="small" sx={{ fontWeight: 600 }} />
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">{pct(bucketPct)}</Typography>
                </Box>
                <GradientBar value={bucketPct} max={100} />
              </Paper>
            );
          })}
        </Box>
      ) : (
        <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                  <TableCell>{t('priceRange')}</TableCell>
                  <TableCell align="center">{t('products')}</TableCell>
                  <TableCell align="center">%</TableCell>
                  <TableCell sx={{ width: '30%' }}>{t('priceDistribution')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {histogram.map((b, i) => {
                  const total = histogram.reduce((s, h) => s + h.count, 0);
                  const bucketPct = total > 0 ? (b.count / total) * 100 : 0;
                  return (
                    <TableRow key={i} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>{b.range}</Typography>
                      </TableCell>
                      <TableCell align="center">{b.count}</TableCell>
                      <TableCell align="center">{pct(bucketPct)}</TableCell>
                      <TableCell>
                        <GradientBar value={bucketPct} max={100} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}
