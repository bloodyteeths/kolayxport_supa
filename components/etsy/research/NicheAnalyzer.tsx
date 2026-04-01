import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Alert, Chip, Button, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, Tooltip, IconButton, CircularProgress, LinearProgress,
  useMediaQuery, Collapse, Skeleton, Card, CardMedia, CardContent,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  DollarSign, BarChart2, Target, TrendingUp, ShoppingBag,
  Heart, Gauge, Info, ExternalLink, Zap, AlertTriangle, CheckCircle, XCircle, Pin, Flame, Star,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useEtsyResearchStore, useComputedPrices, useComputedDemandScore } from '@/lib/stores/useEtsyResearchStore';
import { fmt, pct } from './shared/utils';
import { ScoreRing, StatCard, GradientBar, PremiumEmptyState, GRADIENTS, glassCard } from './shared/ui';
import ComparisonPanel from './ComparisonPanel';

export default function NicheAnalyzer() {
  const t = useTranslations('etsy.nicheAnalyzer');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const items = useEtsyResearchStore(s => s.items);
  const totalResults = useEtsyResearchStore(s => s.totalResults);
  const compSort = useEtsyResearchStore(s => s.compSort);
  const visibleCount = useEtsyResearchStore(s => s.visibleCount);
  const query = useEtsyResearchStore(s => s.query);
  const loading = useEtsyResearchStore(s => s.loading);
  const setCompSort = useEtsyResearchStore(s => s.setCompSort);
  const setVisibleCount = useEtsyResearchStore(s => s.setVisibleCount);
  const exportCSV = useEtsyResearchStore(s => s.exportCSV);
  const saveSearch = useEtsyResearchStore(s => s.saveSearch);
  const nicheAnalysis = useEtsyResearchStore(s => s.nicheAnalysis);
  const nicheAnalysisLoading = useEtsyResearchStore(s => s.nicheAnalysisLoading);
  const nicheAiReport = useEtsyResearchStore(s => s.nicheAiReport);
  const nicheAiReportLoading = useEtsyResearchStore(s => s.nicheAiReportLoading);
  const fetchNicheAiReport = useEtsyResearchStore(s => s.fetchNicheAiReport);
  const pinListing = useEtsyResearchStore(s => s.pinListing);
  const pinnedListing = useEtsyResearchStore(s => s.pinnedListing);
  const discoveryData = useEtsyResearchStore(s => s.discoveryData);
  const discoveryLoading = useEtsyResearchStore(s => s.discoveryLoading);
  const setQuery = useEtsyResearchStore(s => s.setQuery);
  const searchMarket = useEtsyResearchStore(s => s.searchMarket);

  const { priceStats, histogram, maxBucketCount, priceRangeBreakdown, sweetSpot } = useComputedPrices();
  const demandScore = useComputedDemandScore();

  const hasData = items.length > 0;

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    switch (compSort) {
      case 'price_asc': sorted.sort((a, b) => a.price - b.price); break;
      case 'price_desc': sorted.sort((a, b) => b.price - a.price); break;
      case 'favorites': sorted.sort((a, b) => b.num_favorers - a.num_favorers); break;
      case 'views': sorted.sort((a, b) => b.views - a.views); break;
      case 'engagement': sorted.sort((a, b) => {
        const rA = a.views > 0 ? a.num_favorers / a.views : 0;
        const rB = b.views > 0 ? b.num_favorers / b.views : 0;
        return rB - rA;
      }); break;
    }
    return sorted;
  }, [items, compSort]);

  return (
    <Box>
      {priceStats ? (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 1.5, mb: 2 }}>
            <StatCard label={t('minimum')} value={fmt(priceStats.min)} color="#11998e" icon={<DollarSign size={18} />} />
            <StatCard label={t('average')} value={fmt(priceStats.avg)} color="#2196F3" icon={<BarChart2 size={18} />} />
            <StatCard label={t('median')} value={fmt(priceStats.median)} color="#ff9800" icon={<Target size={18} />} />
            <StatCard label={t('maximum')} value={fmt(priceStats.max)} color="#f44336" icon={<TrendingUp size={18} />} />
            <StatCard label={t('result')} value={`${priceStats.count}`} color="#9c27b0" icon={<ShoppingBag size={18} />} />
          </Box>

          {sweetSpot && (
            <Alert severity="success" sx={{ mb: 2, borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)',
              border: '1px solid rgba(17,153,142,0.2)',
            }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('priceSweetSpot')}: {sweetSpot.label}
              </Typography>
              <Typography variant="body2">
                {t('sweetSpotDesc', { avgFav: sweetSpot.avgFav, count: sweetSpot.count })}
              </Typography>
            </Alert>
          )}

          {/* Gradient Histogram */}
          {histogram.length > 1 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('priceDistribution')}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 140 }}>
                {histogram.map((b, i) => (
                  <Tooltip key={i} title={`${b.label}: ${b.count} ${t('products')}`}>
                    <Box sx={{
                      flex: 1, minWidth: 0,
                      height: `${Math.max((b.count / maxBucketCount) * 100, 3)}%`,
                      background: GRADIENTS.primary,
                      borderRadius: '6px 6px 0 0',
                      transition: 'height 0.3s, transform 0.2s', cursor: 'pointer',
                      '&:hover': { transform: 'scaleY(1.05)', opacity: 0.85 },
                    }} />
                  </Tooltip>
                ))}
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">{fmt(priceStats.min)}</Typography>
                <Typography variant="caption" color="text.secondary">{fmt(priceStats.max)}</Typography>
              </Box>
            </Paper>
          )}

          {/* Price range table / mobile cards */}
          {isMobile ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
              {priceRangeBreakdown.map(r => {
                const inRange = items.filter(i => i.price >= r.min && i.price < r.max);
                const avgFav = inRange.length > 0 ? Math.round(inRange.reduce((s, i) => s + i.num_favorers, 0) / inRange.length) : 0;
                return (
                  <Paper key={r.label} sx={{ ...glassCard, p: 1.5 }}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{r.label}</Typography>
                      <Chip label={`${r.count} ${t('products')}`} size="small" sx={{ fontWeight: 600 }} />
                    </Box>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                      <Typography variant="caption" color="text.secondary">{t('ratio')}: {pct(r.pct)}</Typography>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Heart size={12} color="#e91e63" />
                        <Typography variant="caption" sx={{ fontWeight: 600 }}>{avgFav}</Typography>
                      </Box>
                    </Box>
                    <GradientBar value={r.pct} max={100} />
                  </Paper>
                );
              })}
            </Box>
          ) : (
            <Paper sx={{ ...glassCard, overflow: 'hidden', mb: 2 }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                      <TableCell>{t('priceRange')}</TableCell>
                      <TableCell align="center">{t('product')}</TableCell>
                      <TableCell align="center">{t('ratio')}</TableCell>
                      <TableCell align="center">{t('avgFavorite')}</TableCell>
                      <TableCell sx={{ width: '25%' }}>{t('distribution')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {priceRangeBreakdown.map(r => {
                      const inRange = items.filter(i => i.price >= r.min && i.price < r.max);
                      const avgFav = inRange.length > 0 ? Math.round(inRange.reduce((s, i) => s + i.num_favorers, 0) / inRange.length) : 0;
                      return (
                        <TableRow key={r.label} hover sx={{ '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}>
                          <TableCell sx={{ fontWeight: 600 }}>{r.label}</TableCell>
                          <TableCell align="center">{r.count}</TableCell>
                          <TableCell align="center">{pct(r.pct)}</TableCell>
                          <TableCell align="center">
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5 }}>
                              <Heart size={12} color="#e91e63" /> {avgFav}
                            </Box>
                          </TableCell>
                          <TableCell><GradientBar value={r.pct} max={100} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      ) : !loading && (
        <>
          {/* Discovery trending niches as clickable starting points */}
          {discoveryLoading && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2, mb: 2 }}>
              {[1, 2, 3].map(i => (
                <Skeleton key={i} variant="rounded" height={200} sx={{ borderRadius: '16px' }} />
              ))}
            </Box>
          )}

          {discoveryData?.trendingNiches?.length > 0 ? (
            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Flame size={18} color="#f44336" /> {t('trendingNichesHeading')}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                {discoveryData.trendingNiches.map((niche: any) => (
                  <Card key={niche.query} sx={{
                    ...glassCard, cursor: 'pointer', overflow: 'hidden',
                    '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' },
                    transition: 'all 0.2s',
                  }} onClick={() => { setQuery(niche.query); setTimeout(() => searchMarket(), 50); }}>
                    {niche.topItems?.[0]?.image_url && (
                      <CardMedia component="img" height={130} image={niche.topItems[0].image_url}
                        alt={niche.query} sx={{ objectFit: 'cover' }} />
                    )}
                    <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'capitalize', mb: 0.5 }}>
                        {niche.query}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip label={`${niche.totalResults?.toLocaleString()} ${t('resultsLabel')}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 22 }} />
                        <Chip label={`$${niche.priceStats?.avg?.toFixed(2)} ${t('avgLabel')}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem', height: 22 }} />
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                          <Star size={11} color="#e91e63" />
                          <Typography variant="caption" sx={{ color: '#e91e63', fontWeight: 600 }}>{niche.avgFavorites}</Typography>
                        </Box>
                      </Box>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          ) : !discoveryLoading && (
            <PremiumEmptyState icon={<BarChart2 size={48} />} title={t('marketResults')}
              desc={t('marketResultsDesc')}
              steps={[t('emptyStep1'), t('emptyStep2'), t('emptyStep3')]}
            />
          )}
        </>
      )}

      {/* --- Demand Score --- */}
      {demandScore && (
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Gauge size={18} color="#667eea" /> {t('demandOpportunityScore')}
          </Typography>
          <Paper sx={{ ...glassCard, p: isMobile ? 2 : 3, mb: 2, textAlign: 'center' }}>
            <ScoreRing score={demandScore.score} size={isMobile ? 90 : 120} label={t('opportunity')} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
              {demandScore.score >= 70 ? t('scoreHigh') :
                demandScore.score >= 40 ? t('scoreMedium') :
                  t('scoreLow')}
            </Typography>

            {/* Score Breakdown Bars */}
            {(() => {
              const bd = demandScore.breakdown;
              const components = [
                { key: 'supply', label: t('supplyScore'), value: bd.supplyScore, max: 25, weakness: t('supplyWeakness') },
                { key: 'competition', label: t('competitionScore'), value: bd.compScore, max: 25, weakness: t('competitionWeakness') },
                { key: 'demand', label: t('demandScore'), value: bd.demandPts, max: 20, weakness: t('demandWeakness') },
                { key: 'engagement', label: t('engagementScore'), value: bd.engScore, max: 15, weakness: t('engagementWeakness') },
                { key: 'variety', label: t('priceVariety'), value: bd.spreadScore, max: 15, weakness: t('varietyWeakness') },
              ];
              const weakest = components.reduce((min, c) => (c.value / c.max) < (min.value / min.max) ? c : min, components[0]);

              return (
                <Box sx={{ textAlign: 'left', mt: 1 }}>
                  {components.map(c => {
                    const pctVal = (c.value / c.max) * 100;
                    const barColor = pctVal > 70 ? '#11998e' : pctVal >= 40 ? '#F2994A' : '#eb3349';
                    return (
                      <Box key={c.key} sx={{ mb: 1 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.3 }}>
                          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary' }}>{c.label}</Typography>
                          <Typography variant="caption" sx={{ fontWeight: 700, color: barColor }}>{c.value}/{c.max}</Typography>
                        </Box>
                        <Box sx={{ width: '100%', bgcolor: '#f0f0f0', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                          <Box sx={{
                            width: `${pctVal}%`, height: 8, borderRadius: 3,
                            bgcolor: barColor,
                            transition: 'width 0.5s ease-out',
                          }} />
                        </Box>
                      </Box>
                    );
                  })}
                  <Alert severity="info" icon={<Info size={16} />} sx={{ mt: 1.5, borderRadius: '10px', py: 0.3, '& .MuiAlert-message': { fontSize: '0.78rem' } }}>
                    <strong>{t('weakestArea')}:</strong> {weakest.label} — {weakest.weakness}
                  </Alert>
                </Box>
              );
            })()}
          </Paper>
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: t('totalResults'), value: demandScore.totalResults.toLocaleString(), desc: t('supplyAmount') },
              { label: t('uniqueShop'), value: String(demandScore.uniqueShops), desc: t('competition') },
              { label: t('avgFavorite'), value: String(demandScore.avgFavorites), desc: t('demandSignal') },
              { label: t('avgViews'), value: String(demandScore.avgViews), desc: t('visibility') },
              { label: t('engagement'), value: `${demandScore.avgEngagement}%`, desc: t('favViewRatio') },
              { label: t('priceSpread'), value: `${demandScore.priceSpread}x`, desc: t('variety') },
            ].map(m => (
              <Paper key={m.label} sx={{ ...glassCard, p: 1.5, flex: 1, minWidth: isMobile ? '45%' : 100 }}>
                <Typography variant="caption" sx={{ opacity: 0.7, fontWeight: 500 }}>{m.label}</Typography>
                <Typography variant={isMobile ? 'body1' : 'subtitle1'} sx={{ fontWeight: 800 }}>{m.value}</Typography>
                <Typography variant="caption" color="text.secondary">{m.desc}</Typography>
              </Paper>
            ))}
          </Box>
        </Box>
      )}

      {/* --- Backend Niche Intelligence --- */}
      {nicheAnalysis && (
        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Target size={18} color="#667eea" /> {t('advancedCompetitionAnalysis')}
          </Typography>

          {/* Competition metrics */}
          {nicheAnalysis.competition && (
            <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1.5, mb: 2 }}>
              <StatCard label={t('saturation')} value={`${nicheAnalysis.competition.saturationIndex}/100`}
                color={nicheAnalysis.competition.saturationIndex > 70 ? '#f44336' : nicheAnalysis.competition.saturationIndex > 40 ? '#ff9800' : '#4caf50'}
                icon={<BarChart2 size={18} />} />
              <StatCard label={t('top5Concentration')} value={`%${nicheAnalysis.competition.topConcentration}`}
                color="#9c27b0" icon={<Target size={18} />} />
              <StatCard label={t('newSellerSuccess')} value={`%${nicheAnalysis.competition.newSellerSuccessRate}`}
                color="#2196F3" icon={<TrendingUp size={18} />} />
              <StatCard label={t('entryDifficulty')} value={`${nicheAnalysis.competition.entryDifficulty}/100`}
                color={nicheAnalysis.competition.entryDifficulty > 70 ? '#f44336' : '#4caf50'}
                icon={<AlertTriangle size={18} />} />
            </Box>
          )}

          {/* Sales velocity */}
          {nicheAnalysis.velocity && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('salesVelocityEstimate')}</Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {[
                  { label: t('avgMonthlySales'), value: nicheAnalysis.velocity.avgMonthlySales?.toFixed(1) || '0', color: '#11998e' },
                  { label: t('median'), value: nicheAnalysis.velocity.medianMonthlySales?.toFixed(1) || '0', color: '#2196F3' },
                  { label: t('highest'), value: nicheAnalysis.velocity.maxMonthlySales?.toFixed(1) || '0', color: '#ff9800' },
                ].map(m => (
                  <Paper key={m.label} sx={{ ...glassCard, p: 1.5, flex: 1, minWidth: 100, textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>{m.label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: m.color }}>{m.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{t('salesPerMonth')}</Typography>
                  </Paper>
                ))}
              </Box>
            </Paper>
          )}

          {/* Price tier analysis */}
          {nicheAnalysis.competition?.priceTiers && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('priceSegmentAnalysis')}</Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {nicheAnalysis.competition.priceTiers.map((tier: any) => (
                  <Paper key={tier.tier} sx={{ ...glassCard, p: 1.5, flex: 1, minWidth: 120 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>{tier.tier}</Typography>
                    <Typography variant="body2">{tier.count} {t('products')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('avgFavShort')}: {tier.avgFavorites}
                    </Typography>
                    <Box sx={{ mt: 0.5 }}>
                      <Chip size="small" label={`$${tier.priceRange?.[0]?.toFixed(0) || '?'}-$${tier.priceRange?.[1]?.toFixed(0) || '?'}`}
                        sx={{ borderRadius: '6px', fontWeight: 600 }} />
                    </Box>
                  </Paper>
                ))}
              </Box>
            </Paper>
          )}

          {/* AI Report Button + Display */}
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: nicheAiReport ? 2 : 0 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Zap size={16} color="#ff9800" /> {t('whatShouldIDo')}
              </Typography>
              <Button
                variant="contained" size="small"
                onClick={fetchNicheAiReport}
                disabled={nicheAiReportLoading}
                startIcon={nicheAiReportLoading ? <CircularProgress size={14} /> : <Zap size={14} />}
                sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}
              >
                {nicheAiReport ? t('reAnalyze') : t('getAiReport')}
              </Button>
            </Box>

            {nicheAiReportLoading && <LinearProgress sx={{ mt: 1, borderRadius: 4, height: 3 }} />}

            {nicheAiReport && (
              <Box sx={{ mt: 1 }}>
                {/* Verdict */}
                <Alert
                  severity={['ENTER', t('enter')].includes(nicheAiReport.verdict) ? 'success' : ['CAUTION', t('caution')].includes(nicheAiReport.verdict) ? 'warning' : 'error'}
                  icon={['ENTER', t('enter')].includes(nicheAiReport.verdict) ? <CheckCircle size={20} /> : ['AVOID', t('avoid')].includes(nicheAiReport.verdict) ? <XCircle size={20} /> : <AlertTriangle size={20} />}
                  sx={{ mb: 2, borderRadius: '12px' }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                    {nicheAiReport.verdict} ({t('confidence')}: %{nicheAiReport.confidence})
                  </Typography>
                  <Typography variant="body2">{nicheAiReport.summary}</Typography>
                </Alert>

                {/* Strengths / Weaknesses / Opportunities */}
                <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 1.5, mb: 2 }}>
                  {[
                    { title: t('strengths'), items: nicheAiReport.strengths, color: '#4caf50', icon: <CheckCircle size={14} /> },
                    { title: t('weaknesses'), items: nicheAiReport.weaknesses, color: '#f44336', icon: <XCircle size={14} /> },
                    { title: t('opportunities'), items: nicheAiReport.opportunities, color: '#2196F3', icon: <TrendingUp size={14} /> },
                  ].map(section => (
                    <Paper key={section.title} sx={{ ...glassCard, p: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: section.color, display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        {section.icon} {section.title}
                      </Typography>
                      {(section.items || []).map((item: string, i: number) => (
                        <Typography key={i} variant="body2" sx={{ fontSize: '0.78rem', mb: 0.3 }}>• {item}</Typography>
                      ))}
                    </Paper>
                  ))}
                </Box>

                {/* Pricing recommendation */}
                {nicheAiReport.pricing_recommendation && (
                  <Alert severity="info" sx={{ mb: 2, borderRadius: '12px' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('priceSuggestion')}</Typography>
                    <Typography variant="body2">
                      {t('sweetSpot')}: <strong>${nicheAiReport.pricing_recommendation.sweet_spot}</strong> ({t('range')}: ${nicheAiReport.pricing_recommendation.min} - ${nicheAiReport.pricing_recommendation.max})
                    </Typography>
                    <Typography variant="caption" color="text.secondary">{nicheAiReport.pricing_recommendation.reasoning}</Typography>
                  </Alert>
                )}

                {/* Action items */}
                {nicheAiReport.action_items?.length > 0 && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('actionItems')}</Typography>
                    {nicheAiReport.action_items.map((item: string, i: number) => (
                      <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
                        <Chip label={i + 1} size="small" sx={{ minWidth: 24, height: 24, fontWeight: 700, borderRadius: '50%', bgcolor: '#667eea', color: '#fff' }} />
                        <Typography variant="body2" sx={{ fontSize: '0.82rem' }}>{item}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              </Box>
            )}
          </Paper>
        </Box>
      )}

      {nicheAnalysisLoading && (
        <Box sx={{ mt: 2 }}>
          <LinearProgress sx={{ borderRadius: 4, height: 4 }} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {t('advancedAnalysisLoading')}
          </Typography>
        </Box>
      )}

      {/* --- Competitor Products --- */}
      {hasData && (<>
        <ComparisonPanel />

        <Box sx={{ mt: 3 }}>
          <Divider sx={{ mb: 2 }} />
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShoppingBag size={18} color="#667eea" /> {t('competitorProducts')} ({items.length})
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['none', 'price_asc', 'price_desc', 'favorites', 'views', 'engagement'] as const).map(s => (
              <Chip key={s}
                label={{ none: t('sortDefault'), price_asc: t('sortPriceAsc'), price_desc: t('sortPriceDesc'), favorites: t('sortFavorites'), views: t('sortViews'), engagement: t('sortEngagement') }[s]}
                size="small" variant={compSort === s ? 'filled' : 'outlined'}
                color={compSort === s ? 'primary' : 'default'}
                onClick={() => setCompSort(s)} sx={{ cursor: 'pointer', borderRadius: '8px' }}
              />
            ))}
          </Box>
          {isMobile ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {sortedItems.slice(0, visibleCount).map((item, idx) => {
                const engagement = item.views > 0 ? (item.num_favorers / item.views) * 100 : 0;
                const isExpanded = expandedCard === idx;
                return (
                  <Paper key={item.listing_id} sx={{
                    ...glassCard, p: 1.5, cursor: 'pointer',
                    borderLeft: idx < 3 ? '3px solid #667eea' : 'none',
                  }} onClick={() => setExpandedCard(isExpanded ? null : idx)}>
                    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center' }}>
                      {item.image_url && (
                        <img src={item.image_url} alt="" style={{
                          width: 48, height: 48, objectFit: 'cover', borderRadius: 8,
                          boxShadow: '0 2px 8px rgba(0,0,0,0.1)', flexShrink: 0,
                        }} />
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {item.title}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmt(item.price)}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                            <Heart size={12} color="#e91e63" />
                            <Typography variant="caption" sx={{ fontWeight: 600 }}>{item.num_favorers.toLocaleString()}</Typography>
                          </Box>
                          <Chip label={`${engagement.toFixed(1)}%`} size="small" sx={{
                            fontWeight: 600, borderRadius: '6px', height: 20, fontSize: '0.7rem',
                            bgcolor: engagement > 5 ? '#e8f5e9' : '#fafafa',
                            color: engagement > 5 ? '#2e7d32' : '#999',
                          }} />
                        </Box>
                      </Box>
                    </Box>
                    <Collapse in={isExpanded}>
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          {t('viewsLabel')}: {item.views.toLocaleString()}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); pinListing(pinnedListing?.listing_id === item.listing_id ? null : item); }}
                            sx={{ borderRadius: '8px', fontSize: '0.7rem', minWidth: 0, px: 1 }}>
                            <Pin size={12} color={pinnedListing?.listing_id === item.listing_id ? '#667eea' : undefined} />
                          </Button>
                          <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); window.open(item.url, '_blank'); }}
                            startIcon={<ExternalLink size={12} />} sx={{ borderRadius: '8px', fontSize: '0.7rem' }}>
                            Etsy
                          </Button>
                        </Box>
                      </Box>
                    </Collapse>
                  </Paper>
                );
              })}
            </Box>
          ) : (
          <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                    <TableCell sx={{ width: 50 }} />
                    <TableCell>{t('titleCol')}</TableCell>
                    <TableCell align="right">
                      <TableSortLabel active={compSort === 'price_asc' || compSort === 'price_desc'} direction={compSort === 'price_asc' ? 'asc' : 'desc'} onClick={() => setCompSort(compSort === 'price_desc' ? 'price_asc' : 'price_desc')}>
                        {t('priceCol')}
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">
                      <TableSortLabel active={compSort === 'favorites'} direction="desc" onClick={() => setCompSort('favorites')}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Heart size={12} /> {t('favCol')}</Box>
                      </TableSortLabel>
                    </TableCell>
                    <TableCell align="center">
                      <TableSortLabel active={compSort === 'engagement'} direction="desc" onClick={() => setCompSort('engagement')}>
                        {t('engCol')}
                      </TableSortLabel>
                    </TableCell>
                    <TableCell sx={{ width: 40 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedItems.slice(0, visibleCount).map((item, idx) => {
                    const engagement = item.views > 0 ? (item.num_favorers / item.views) * 100 : 0;
                    return (
                      <TableRow key={item.listing_id} hover sx={{
                        '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                        borderLeft: idx < 3 ? '3px solid #667eea' : 'none',
                      }}>
                        <TableCell>
                          {item.image_url && (
                            <img src={item.image_url} alt="" style={{
                              width: 40, height: 40, objectFit: 'cover', borderRadius: 8,
                              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                            }} />
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {item.title}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmt(item.price)}</Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="body2" sx={{ fontWeight: 700, color: item.num_favorers > 100 ? '#11998e' : 'text.secondary' }}>
                            {item.num_favorers.toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Chip label={`${engagement.toFixed(1)}%`} size="small" sx={{
                            fontWeight: 600, borderRadius: '6px',
                            bgcolor: engagement > 5 ? '#e8f5e9' : '#fafafa',
                            color: engagement > 5 ? '#2e7d32' : '#999',
                          }} />
                        </TableCell>
                        <TableCell>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Tooltip title={pinnedListing?.listing_id === item.listing_id ? t('unpinListing') : t('compareListing')}>
                              <IconButton size="small" onClick={() => pinListing(pinnedListing?.listing_id === item.listing_id ? null : item)}>
                                <Pin size={14} color={pinnedListing?.listing_id === item.listing_id ? '#667eea' : undefined}
                                  fill={pinnedListing?.listing_id === item.listing_id ? '#667eea' : 'none'} />
                              </IconButton>
                            </Tooltip>
                            <IconButton size="small" onClick={() => window.open(item.url, '_blank')}>
                              <ExternalLink size={14} />
                            </IconButton>
                          </Box>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
          )}
          {visibleCount < items.length && (
            <Box sx={{ textAlign: 'center', mt: 1.5 }}>
              <Button variant="outlined" size="small" onClick={() => setVisibleCount(visibleCount + 20)}
                sx={{ borderRadius: '10px', ...(isMobile && { width: '100%' }) }}>
                {t('loadMore', { remaining: items.length - visibleCount })}
              </Button>
            </Box>
          )}
        </Box>
      </>)}
    </Box>
  );
}
