import React, { useMemo } from 'react';
import {
  Box, Typography, Paper, Chip, Tooltip,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Store, Star, Users, ShoppingBag, Heart, Eye, Award, Zap, Truck, Shield,
} from 'lucide-react';
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

const BADGE_ICONS: Record<string, React.ReactNode> = {
  fastSeller: <Zap size={14} color="#F2994A" />,
  authorizedSeller: <Shield size={14} color="#2196F3" />,
  rushDelivery: <Truck size={14} color="#11998e" />,
  sameDayShipping: <Truck size={14} color="#7B1FA2" />,
};

const BADGE_COLORS: Record<string, string> = {
  fastSeller: '#FFF3E0',
  authorizedSeller: '#E3F2FD',
  rushDelivery: '#E0F2F1',
  sameDayShipping: '#F3E5F5',
};

export default function TrendyolSellerIntelligence() {
  const t = useTranslations('trendyolResearch');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const analysis = useTrendyolResearchStore(s => s.analysis);

  const topMerchants = analysis?.topMerchants ?? [];
  const badgeDistribution = analysis?.badgeDistribution ?? {};
  const socialProof = analysis?.socialProofSummary ?? { withFavorites: 0, withOrders: 0, withViews: 0 };

  const totalProducts = useMemo(
    () => topMerchants.reduce((s, m) => s + m.count, 0),
    [topMerchants],
  );
  const maxCount = useMemo(
    () => Math.max(...topMerchants.map(m => m.count), 1),
    [topMerchants],
  );

  const merchantsWithShare = useMemo(
    () => topMerchants.map(m => ({
      ...m,
      marketShare: totalProducts > 0 ? (m.count / totalProducts) * 100 : 0,
    })),
    [topMerchants, totalProducts],
  );

  const { sorted, sortKey, sortDir, handleSort } = useTableSort(merchantsWithShare, 'count');

  const totalBadges = useMemo(
    () => Object.values(badgeDistribution).reduce((s, v) => s + v, 0),
    [badgeDistribution],
  );

  if (!analysis || topMerchants.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, color: 'text.secondary' }}>
        <Store size={48} style={{ opacity: 0.3, marginBottom: 8 }} />
        <Typography>{t('noProducts')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Summary stats */}
      <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1.5, mb: 2 }}>
        <StatCard label={t('uniqueSellers')} value={`${analysis.uniqueMerchants}`} color="#7B1FA2" icon={<Store size={18} />} />
        <StatCard label={t('avgRating')} value={analysis.avgRating.toFixed(1)} color="#F2994A" icon={<Star size={18} />} />
        <StatCard label={t('freeShippingPct')} value={pct(analysis.freeShippingPct)} color="#11998e" icon={<Truck size={18} />} />
        <StatCard label={t('products')} value={`${totalProducts}`} color="#2196F3" icon={<ShoppingBag size={18} />} />
      </Box>

      {/* Social proof summary */}
      <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Users size={18} />
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('demandSignals')}</Typography>
        </Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Heart size={16} color="#e91e63" />
            <Box>
              <Typography variant="caption" color="text.secondary">{t('favorites')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{socialProof.withFavorites} {t('products')}</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShoppingBag size={16} color="#11998e" />
            <Box>
              <Typography variant="caption" color="text.secondary">{t('orders')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{socialProof.withOrders} {t('products')}</Typography>
            </Box>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Eye size={16} color="#2196F3" />
            <Box>
              <Typography variant="caption" color="text.secondary">{t('views')}</Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>{socialProof.withViews} {t('products')}</Typography>
            </Box>
          </Box>
        </Box>
      </Paper>

      {/* Badge distribution */}
      {Object.keys(badgeDistribution).length > 0 && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Award size={18} />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('badges')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {Object.entries(badgeDistribution).map(([badge, count]) => {
              const badgePct = totalBadges > 0 ? (count / totalBadges) * 100 : 0;
              const badgeKey = badge as string;
              const translationKey = badgeKey in BADGE_ICONS ? badgeKey : 'fastSeller';
              return (
                <Tooltip key={badge} title={`${count} ${t('products')} (${pct(badgePct)})`}>
                  <Chip
                    icon={<>{BADGE_ICONS[badge] || <Award size={14} />}</>}
                    label={`${t(translationKey as any)} (${count})`}
                    size="small"
                    sx={{
                      fontWeight: 600,
                      bgcolor: BADGE_COLORS[badge] || '#f5f5f5',
                      '& .MuiChip-icon': { ml: 0.5 },
                    }}
                  />
                </Tooltip>
              );
            })}
          </Box>
        </Paper>
      )}

      {/* Merchant table / mobile cards */}
      {isMobile ? (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {sorted.map((m) => (
            <Paper key={m.id} sx={{ ...glassCard, p: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {t('seller')} #{m.id}
                </Typography>
                <Chip label={pct(m.marketShare)} size="small" sx={{ fontWeight: 600 }} />
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {m.count} {t('products')}
                </Typography>
                <Typography variant="caption" sx={{ fontWeight: 600 }}>
                  {fmtTry(m.avgPrice)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Star size={12} color="#F2994A" />
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>{m.avgRating.toFixed(1)}</Typography>
                </Box>
              </Box>
              <GradientBar value={m.marketShare} max={100} />
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
                    <TableSortLabel active={sortKey === 'id'} direction={sortDir} onClick={() => handleSort('id')}>
                      {t('seller')} ID
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
                    <TableSortLabel active={sortKey === 'avgRating'} direction={sortDir} onClick={() => handleSort('avgRating')}>
                      {t('avgRating')}
                    </TableSortLabel>
                  </TableCell>
                  <TableCell align="center">
                    <TableSortLabel active={sortKey === 'marketShare'} direction={sortDir} onClick={() => handleSort('marketShare')}>
                      %
                    </TableSortLabel>
                  </TableCell>
                  <TableCell sx={{ width: '20%' }}>{t('priceDistribution')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map((m) => (
                  <TableRow key={m.id} sx={{ '&:last-child td': { borderBottom: 0 } }}>
                    <TableCell>
                      <Typography variant="body2" sx={{ fontWeight: 600 }}>#{m.id}</Typography>
                    </TableCell>
                    <TableCell align="center">{m.count}</TableCell>
                    <TableCell align="center">{fmtTry(m.avgPrice)}</TableCell>
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                        <Star size={14} color="#F2994A" />
                        {m.avgRating.toFixed(1)}
                      </Box>
                    </TableCell>
                    <TableCell align="center">{pct(m.marketShare)}</TableCell>
                    <TableCell>
                      <GradientBar value={m.marketShare} max={100} />
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
