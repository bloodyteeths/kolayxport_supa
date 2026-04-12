import React, { useMemo, useState } from 'react';
import {
  Box, Typography, Paper, Alert, Chip, Button, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TableSortLabel, Tooltip, IconButton, CircularProgress, LinearProgress,
  useMediaQuery, Collapse, Skeleton, Card, CardMedia, CardContent,
  TextField, InputAdornment,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  DollarSign, BarChart2, Target, TrendingUp, ShoppingBag,
  Heart, Gauge, Info, ExternalLink, Zap, AlertTriangle,
  CheckCircle, XCircle, Pin, Flame, Star, Search, Compass,
  Hash, Tag, Copy, Activity, Calendar, Lightbulb, ArrowRight,
  Clock, Trash2,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

import {
  useEtsyResearchStore,
  useComputedPrices,
  useComputedKeywords,
  useComputedTags,
  useComputedDemandScore,
} from '@/lib/stores/useEtsyResearchStore';
import { fmt, pct } from './shared/utils';
import {
  ScoreRing, StatCard, GradientBar, SourceBadge, Sparkline,
  TrendChart, PremiumEmptyState, GRADIENTS, glassCard,
  KeywordCard, DemandCompetitionGauge, StickyScoreBar, useTableSort,
} from './shared/ui';
import ComparisonPanel from './ComparisonPanel';

interface UnifiedResearchProps {
  userListings?: any[];
  onNavigateToShopIntel?: () => void;
}

export default function UnifiedResearch({ userListings, onNavigateToShopIntel }: UnifiedResearchProps) {
  const t = useTranslations('etsyResearch');
  const tNiche = useTranslations('etsy.nicheAnalyzer');
  const tKw = useTranslations('etsy.keywordIntel');
  const tTrend = useTranslations('etsy.trendAnalyzer');
  const tDash = useTranslations('etsy.researchDashboard');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [expandedCard, setExpandedCard] = useState<number | null>(null);

  // Store state
  const items = useEtsyResearchStore(s => s.items);
  const totalResults = useEtsyResearchStore(s => s.totalResults);
  const query = useEtsyResearchStore(s => s.query);
  const loading = useEtsyResearchStore(s => s.loading);
  const compSort = useEtsyResearchStore(s => s.compSort);
  const visibleCount = useEtsyResearchStore(s => s.visibleCount);
  const setCompSort = useEtsyResearchStore(s => s.setCompSort);
  const setVisibleCount = useEtsyResearchStore(s => s.setVisibleCount);
  const nicheAnalysis = useEtsyResearchStore(s => s.nicheAnalysis);
  const nicheAnalysisLoading = useEtsyResearchStore(s => s.nicheAnalysisLoading);
  const nicheAiReport = useEtsyResearchStore(s => s.nicheAiReport);
  const nicheAiReportLoading = useEtsyResearchStore(s => s.nicheAiReportLoading);
  const fetchNicheAiReport = useEtsyResearchStore(s => s.fetchNicheAiReport);
  const pinListing = useEtsyResearchStore(s => s.pinListing);
  const pinnedListing = useEtsyResearchStore(s => s.pinnedListing);
  const trendData = useEtsyResearchStore(s => s.trendData);
  const trendLoading = useEtsyResearchStore(s => s.trendLoading);
  const seasonalData = useEtsyResearchStore(s => s.seasonalData);
  const kwSuggestions = useEtsyResearchStore(s => s.kwSuggestions);
  const kwExplorerLoading = useEtsyResearchStore(s => s.kwExplorerLoading);
  const discoveryData = useEtsyResearchStore(s => s.discoveryData);
  const discoveryLoading = useEtsyResearchStore(s => s.discoveryLoading);
  const savedSearches = useEtsyResearchStore(s => s.savedSearches);
  const setQuery = useEtsyResearchStore(s => s.setQuery);
  const searchMarket = useEtsyResearchStore(s => s.searchMarket);
  const loadSearch = useEtsyResearchStore(s => s.loadSearch);
  const deleteSaved = useEtsyResearchStore(s => s.deleteSaved);
  const initSavedSearches = useEtsyResearchStore(s => s.initSavedSearches);
  const parallelSearch = useEtsyResearchStore(s => s.parallelSearch);
  const exportCSV = useEtsyResearchStore(s => s.exportCSV);
  const fetchTrends = useEtsyResearchStore(s => s.fetchTrends);

  // Computed hooks
  const { priceStats, histogram, maxBucketCount, priceRangeBreakdown, sweetSpot } = useComputedPrices();
  const demandScore = useComputedDemandScore();
  const { enrichedKeywords, bigrams, trigrams } = useComputedKeywords();
  const { enrichedTags, tagGaps, myTagsSet, tagCombos } = useComputedTags(userListings);

  const { sorted: sortedTagCombos, sortKey: tagComboSortKey, sortDir: tagComboSortDir, handleSort: handleTagComboSort } =
    useTableSort(tagCombos, 'count', 'desc');

  React.useEffect(() => { initSavedSearches(); }, [initSavedSearches]);

  const hasData = items.length > 0;

  // Quick stats
  const avgFav = hasData ? Math.round(items.reduce((s, i) => s + i.num_favorers, 0) / items.length) : 0;
  const avgPrice = hasData ? Math.round(items.reduce((s, i) => s + i.price, 0) / items.length * 100) / 100 : 0;
  const uniqueShops = hasData ? new Set(items.map(i => i.shop_id)).size : 0;

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

  // ========== PRE-SEARCH STATE ==========
  if (!hasData && !loading) {
    return (
      <Box>
        {/* Saved Searches */}
        {savedSearches.length > 0 && (
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Clock size={16} color="#667eea" /> {tDash('savedSearches')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {savedSearches.map((s, i) => (
                <Chip key={i} label={s.query} onClick={() => { loadSearch(s); setTimeout(() => parallelSearch(), 50); }}
                  onDelete={() => deleteSaved(i)} deleteIcon={<Trash2 size={12} />}
                  sx={{ borderRadius: '10px', fontWeight: 600, fontSize: '0.78rem', '&:hover': { bgcolor: 'rgba(102,126,234,0.08)' } }}
                  variant="outlined"
                />
              ))}
            </Box>
          </Paper>
        )}

        {/* Discovery: Trending Niches */}
        {discoveryLoading && (
          <Box sx={{ mb: 3 }}>
            <Skeleton variant="text" width={200} height={32} sx={{ mb: 1.5 }} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
              {[1, 2, 3].map(i => <Skeleton key={i} variant="rounded" height={220} sx={{ borderRadius: '16px' }} />)}
            </Box>
          </Box>
        )}

        {discoveryData?.trendingNiches?.length > 0 && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Flame size={18} color="#f44336" /> {tDash('trendingNiches')}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
              {discoveryData.trendingNiches.map((niche: any) => (
                <Card key={niche.query} sx={{
                  ...glassCard, cursor: 'pointer', overflow: 'hidden',
                  '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' },
                  transition: 'all 0.2s',
                }} onClick={() => { setQuery(niche.query); setTimeout(() => parallelSearch(), 50); }}>
                  {niche.topItems?.[0]?.image_url && (
                    <CardMedia component="img" height={140} image={niche.topItems[0].image_url}
                      alt={niche.query} sx={{ objectFit: 'cover' }} />
                  )}
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5, textTransform: 'capitalize' }}>
                      {niche.query}
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                      <Typography variant="caption" color="text.secondary">
                        {niche.totalResults?.toLocaleString()} {tDash('results')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ${niche.priceStats?.avg?.toFixed(2)} {tDash('avgLabel')}
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#e91e63', display: 'flex', alignItems: 'center', gap: 0.3 }}>
                        <Star size={10} /> {niche.avgFavorites} {tDash('favLabel')}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>
        )}

        {/* Hot Keywords */}
        {discoveryData?.hotKeywords?.length > 0 && (
          <Paper sx={{ ...glassCard, p: 2.5, mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <TrendingUp size={16} color="#667eea" /> {tDash('hotKeywords')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
              {discoveryData.hotKeywords.map((kw: any) => (
                <Chip key={kw.keyword} label={`${kw.keyword} (${kw.count})`} size="small" variant="outlined"
                  onClick={() => { setQuery(kw.keyword); setTimeout(() => parallelSearch(), 50); }}
                  sx={{ cursor: 'pointer', borderRadius: '10px', fontWeight: 600, fontSize: '0.78rem', '&:hover': { bgcolor: 'rgba(102,126,234,0.08)', borderColor: '#667eea' } }}
                />
              ))}
            </Box>
          </Paper>
        )}

        {/* Seasonal Tips */}
        {discoveryData?.seasonalTips?.length > 0 && (
          <Paper sx={{ ...glassCard, p: 2.5, mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Lightbulb size={16} color="#ff9800" /> {tDash('seasonalTips')}
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {discoveryData.seasonalTips.map((tip: string, i: number) => (
                <Typography key={i} variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                  <Box component="span" sx={{ color: '#ff9800', fontWeight: 700, mt: '2px' }}>•</Box>
                  {tip}
                </Typography>
              ))}
            </Box>
          </Paper>
        )}

        {/* Empty state */}
        {!discoveryLoading && !discoveryData && savedSearches.length === 0 && (
          <PremiumEmptyState
            icon={<Search size={48} />}
            title={tDash('researchCenter')}
            desc={tDash('researchCenterDesc')}
            steps={[t('ur_step1'), t('ur_step2'), t('ur_step3')]}
          />
        )}
      </Box>
    );
  }

  // ========== LOADING STATE ==========
  if (loading && !hasData) {
    return (
      <Box>
        <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />
        <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1.5, mb: 2 }}>
          {[1, 2, 3, 4].map(i => <Skeleton key={i} variant="rounded" height={80} sx={{ borderRadius: '16px' }} />)}
        </Box>
        <Skeleton variant="rounded" height={200} sx={{ borderRadius: '16px', mb: 2 }} />
        <Skeleton variant="rounded" height={140} sx={{ borderRadius: '16px' }} />
      </Box>
    );
  }

  // ========== RESULTS STATE ==========
  return (
    <Box>
      {loading && <LinearProgress sx={{ mb: 1, borderRadius: 4, height: 3 }} />}

      {/* ── Section 1: Score Summary Bar (sticky) ── */}
      <StickyScoreBar metrics={[
        { label: t('ur_results'), value: totalResults.toLocaleString(), color: '#9c27b0' },
        { label: t('ur_avgPrice'), value: `$${avgPrice}`, color: '#11998e' },
        { label: t('ur_avgFav'), value: String(avgFav), color: '#e91e63' },
        { label: t('ur_shops'), value: String(uniqueShops), color: '#2196F3' },
        ...(demandScore ? [{ label: t('ur_opportunity'), value: `${demandScore.score}/100`, color: demandScore.score >= 70 ? '#4caf50' : demandScore.score >= 40 ? '#ff9800' : '#f44336' }] : []),
      ]} />

      {/* ── Section 2: Demand vs Competition Gauges ── */}
      {demandScore && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'center', flexWrap: 'wrap' }}>
            <DemandCompetitionGauge
              demand={demandScore.score}
              competition={nicheAnalysis?.competition?.saturationIndex || Math.round((1 - demandScore.score / 100) * 70 + 10)}
              size={isMobile ? 70 : 90}
            />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', flex: 1, minWidth: 200 }}>
              {[
                { label: tNiche('totalResults'), value: demandScore.totalResults.toLocaleString() },
                { label: tNiche('uniqueShop'), value: String(demandScore.uniqueShops) },
                { label: tNiche('avgFavorite'), value: String(demandScore.avgFavorites) },
                { label: tNiche('engagement'), value: `${demandScore.avgEngagement}%` },
                { label: tNiche('priceSpread'), value: `${demandScore.priceSpread}x` },
              ].map(m => (
                <Paper key={m.label} sx={{ ...glassCard, p: 1, flex: 1, minWidth: isMobile ? '45%' : 80, textAlign: 'center' }}>
                  <Typography variant="caption" sx={{ opacity: 0.7, fontSize: '0.65rem' }}>{m.label}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 800 }}>{m.value}</Typography>
                </Paper>
              ))}
            </Box>
          </Box>
        </Paper>
      )}

      {/* ── Section 3: Price Analysis ── */}
      {priceStats && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <DollarSign size={18} color="#11998e" /> {tNiche('priceDistribution')}
          </Typography>

          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 1, mb: 1.5 }}>
            <StatCard label={tNiche('minimum')} value={fmt(priceStats.min)} color="#11998e" icon={<DollarSign size={16} />} />
            <StatCard label={tNiche('average')} value={fmt(priceStats.avg)} color="#2196F3" icon={<BarChart2 size={16} />} />
            <StatCard label={tNiche('median')} value={fmt(priceStats.median)} color="#ff9800" icon={<Target size={16} />} />
            <StatCard label={tNiche('maximum')} value={fmt(priceStats.max)} color="#f44336" icon={<TrendingUp size={16} />} />
            <StatCard label={tNiche('result')} value={`${priceStats.count}`} color="#9c27b0" icon={<ShoppingBag size={16} />} />
          </Box>

          {sweetSpot && (
            <Alert severity="success" sx={{ mb: 1.5, borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)',
              border: '1px solid rgba(17,153,142,0.2)',
            }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {tNiche('priceSweetSpot')}: {sweetSpot.label}
              </Typography>
              <Typography variant="body2">
                {tNiche('sweetSpotDesc', { avgFav: sweetSpot.avgFav, count: sweetSpot.count })}
              </Typography>
            </Alert>
          )}

          {/* Histogram */}
          {histogram.length > 1 && (
            <Paper sx={{ ...glassCard, p: 2, mb: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: '3px', height: 120 }}>
                {histogram.map((b, i) => (
                  <Tooltip key={i} title={`${b.label}: ${b.count} ${tNiche('products')}`}>
                    <Box sx={{
                      flex: 1, minWidth: 0,
                      height: `${Math.max((b.count / maxBucketCount) * 100, 3)}%`,
                      background: GRADIENTS.primary,
                      borderRadius: '6px 6px 0 0',
                      transition: 'height 0.3s', cursor: 'pointer',
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
        </Box>
      )}

      {/* ── Section 4: Top Tags (Keyword Scorecard) ── */}
      {enrichedTags.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Hash size={18} color="#667eea" /> {tKw('topUsedTags', { count: enrichedTags.length })}
          </Typography>

          {tagGaps.length > 0 && myTagsSet.size > 0 && (
            <Alert severity="warning" sx={{ mb: 1.5, borderRadius: '12px',
              background: 'linear-gradient(135deg, rgba(242,153,74,0.08) 0%, rgba(242,201,76,0.08) 100%)',
              border: '1px solid rgba(242,153,74,0.2)',
            }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {tKw('missingTagsDetected', { count: tagGaps.length })}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
                {tagGaps.slice(0, 10).map(tg => (
                  <Chip key={tg.tag} label={`${tg.tag} (%${tg.pct})`} size="small" color="warning"
                    onClick={() => { navigator.clipboard.writeText(tg.tag); toast.success(tKw('copied')); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>
            </Alert>
          )}

          {/* Tag density bars */}
          <Paper sx={{ ...glassCard, p: 2, mb: 1.5 }}>
            {enrichedTags.slice(0, 15).map(tg => (
              <Box key={tg.tag} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <Typography variant="body2" sx={{ minWidth: isMobile ? 80 : 130, fontSize: isMobile ? '0.75rem' : undefined, fontWeight: tg.inMyTags ? 700 : 400 }}>
                  {tg.inMyTags && <CheckCircle size={12} color="#4caf50" style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                  {tg.tag}
                </Typography>
                <Box sx={{ flex: 1 }}><GradientBar value={tg.pct} max={100} /></Box>
                <Typography variant="caption" sx={{ minWidth: 35, fontWeight: 600 }}>{tg.pct}%</Typography>
              </Box>
            ))}
          </Paper>

          {/* Tag chips */}
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
            {enrichedTags.slice(0, 30).map(tg => (
              <Chip key={tg.tag}
                label={`${tg.tag} (%${tg.pct})`} size="small"
                color={tg.inMyTags ? 'success' : tg.pct >= 30 ? 'error' : tg.pct >= 15 ? 'warning' : 'default'}
                variant={tg.inMyTags ? 'filled' : 'outlined'}
                onClick={() => { navigator.clipboard.writeText(tg.tag); toast.success(tKw('copied')); }}
                sx={{ cursor: 'pointer', borderRadius: '8px' }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* ── Section 5: Keywords ── */}
      {enrichedKeywords.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tag size={18} color="#667eea" /> {tKw('keywords')}
          </Typography>

          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
            {enrichedKeywords.slice(0, 30).map(kw => (
              <Chip key={kw.keyword}
                label={`${kw.keyword} (${kw.pct}%)`} size="small"
                color={kw.pct >= 40 ? 'error' : kw.pct >= 20 ? 'warning' : 'default'}
                variant={kw.inMyTitle ? 'filled' : 'outlined'}
                onClick={() => { navigator.clipboard.writeText(kw.keyword); toast.success(tKw('copied')); }}
                sx={{ cursor: 'pointer', borderRadius: '8px' }}
              />
            ))}
          </Box>

          {bigrams.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{tKw('bigramPhrases')}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
                {bigrams.slice(0, 20).map(b => (
                  <Chip key={b.phrase} label={`${b.phrase} (${b.count})`} size="small"
                    color={b.percentage >= 30 ? 'primary' : 'default'} variant="outlined"
                    onClick={() => { navigator.clipboard.writeText(b.phrase); toast.success(tKw('copied')); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>
            </>
          )}

          {trigrams.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{tKw('longTail')}</Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1.5 }}>
                {trigrams.slice(0, 15).map(tg => (
                  <Chip key={tg.phrase} label={`${tg.phrase} (${tg.count})`} size="small"
                    color="secondary" variant="outlined"
                    onClick={() => { navigator.clipboard.writeText(tg.phrase); toast.success(tKw('copied')); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }}
                  />
                ))}
              </Box>
            </>
          )}
        </Box>
      )}

      {/* ── Section 6: Trend Snapshot ── */}
      {(trendData || trendLoading) && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Activity size={18} color="#11998e" /> {tTrend('title')}
          </Typography>
          {trendLoading && <LinearProgress sx={{ mb: 1, borderRadius: 4, height: 3 }} />}
          {trendData && (
            <>
              <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1, mb: 1.5 }}>
                <StatCard label={tTrend('avgInterest')} value={String(trendData.averageInterest)} color="#2196F3" icon={<BarChart2 size={16} />} />
                <StatCard label={tTrend('peakValue')} value={String(trendData.peakValue)} color="#4caf50" icon={<TrendingUp size={16} />} />
                <StatCard label={tTrend('peakDate')} value={trendData.peakDate || '-'} color="#ff9800" icon={<Calendar size={16} />} />
                <StatCard label={tTrend('direction')} value={
                  trendData.trendDirection === 'rising' ? tTrend('rising') :
                  trendData.trendDirection === 'declining' ? tTrend('declining') : tTrend('stable')
                } color={
                  trendData.trendDirection === 'rising' ? '#4caf50' :
                  trendData.trendDirection === 'declining' ? '#f44336' : '#ff9800'
                } icon={<Activity size={16} />} />
              </Box>

              {trendData.timeline.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2, mb: 1.5 }}>
                  <TrendChart data={trendData.timeline} />
                </Paper>
              )}

              {/* Rising & top queries side by side */}
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5, mb: 1.5 }}>
                {trendData.risingQueries.length > 0 && (
                  <Paper sx={{ ...glassCard, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#4caf50' }}>
                      {tTrend('risingQueries')}
                    </Typography>
                    {trendData.risingQueries.slice(0, 8).map(q => (
                      <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                          onClick={() => { setQuery(q.query); toast.success(tTrend('addedToSearch', { query: q.query })); }}>
                          {q.query}
                        </Typography>
                        <Chip label={q.value} size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontWeight: 600 }} />
                      </Box>
                    ))}
                  </Paper>
                )}
                {trendData.topQueries.length > 0 && (
                  <Paper sx={{ ...glassCard, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#2196F3' }}>
                      {tTrend('topRelatedQueries')}
                    </Typography>
                    {trendData.topQueries.slice(0, 8).map(q => (
                      <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                        <Typography variant="body2" sx={{ cursor: 'pointer', '&:hover': { color: 'primary.main' } }}
                          onClick={() => { setQuery(q.query); toast.success(tTrend('addedToSearch', { query: q.query })); }}>
                          {q.query}
                        </Typography>
                        <GradientBar value={q.value} max={100} height={6} />
                      </Box>
                    ))}
                  </Paper>
                )}
              </Box>
            </>
          )}
        </Box>
      )}

      {/* Seasonal calendar */}
      {seasonalData?.hasData && (
        <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{tTrend('seasonalCalendar')}</Typography>
          {seasonalData.peakMonth && (
            <Alert severity="success" sx={{ mb: 1.5, borderRadius: '12px', py: 0.5 }}>
              {tTrend('peakMonth')}: <strong>{seasonalData.peakMonth}</strong> | {tTrend('lowMonth')}: <strong>{seasonalData.lowMonth}</strong>
            </Alert>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(auto-fill, minmax(70px, 1fr))', gap: isMobile ? 0.5 : 1 }}>
            {(seasonalData.monthlyTrends.length > 0 ? seasonalData.monthlyTrends : seasonalData.wikiPageviews.map((w: any) => ({ month: w.month, value: w.views }))).map((m: any) => {
              const maxVal = Math.max(...(seasonalData.monthlyTrends.length > 0 ? seasonalData.monthlyTrends : seasonalData.wikiPageviews.map((w: any) => ({ month: w.month, value: w.views }))).map((x: any) => x.value), 1);
              const intensity = m.value / maxVal;
              const isPeak = m.month === seasonalData.peakMonth;
              const isLow = m.month === seasonalData.lowMonth;
              return (
                <Paper key={m.month} sx={{
                  p: 1, textAlign: 'center', borderRadius: '12px',
                  border: isPeak ? '2px solid #4caf50' : isLow ? '2px solid #f44336' : '1px solid #eee',
                  bgcolor: `rgba(102,126,234,${intensity * 0.15})`,
                }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>{m.month}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: isPeak ? '#4caf50' : isLow ? '#f44336' : '#333' }}>{m.value}</Typography>
                </Paper>
              );
            })}
          </Box>
        </Paper>
      )}

      {/* ── Section 7: Keyword Suggestions (from keyword discovery) ── */}
      {kwSuggestions.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Compass size={18} color="#2196F3" /> {t('ur_longTailSuggestions')} ({kwSuggestions.length})
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 1 }}>
            {kwSuggestions.slice(0, 20).map((s, i) => (
              <Paper key={s.keyword} sx={{
                ...glassCard, p: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                borderLeft: i < 3 ? '3px solid #667eea' : 'none',
              }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>{s.keyword}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.3 }}>
                    {s.sources.map(src => <SourceBadge key={src} source={src} />)}
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Chip label={s.score} size="small" sx={{
                    fontWeight: 700,
                    bgcolor: s.score >= 60 ? '#e8f5e9' : s.score >= 30 ? '#fff3e0' : '#fafafa',
                    color: s.score >= 60 ? '#2e7d32' : s.score >= 30 ? '#e65100' : '#999',
                  }} />
                  <IconButton size="small" onClick={() => { navigator.clipboard.writeText(s.keyword); toast.success(t('kd_copied', { keyword: s.keyword })); }}>
                    <Copy size={14} />
                  </IconButton>
                  <IconButton size="small" onClick={() => { setQuery(s.keyword); setTimeout(() => parallelSearch(), 50); }}>
                    <ArrowRight size={14} />
                  </IconButton>
                </Box>
              </Paper>
            ))}
          </Box>
        </Box>
      )}

      {/* ── Section 8: Advanced Competition (Backend Niche Intelligence) ── */}
      {nicheAnalysis && (
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Target size={18} color="#667eea" /> {tNiche('advancedCompetitionAnalysis')}
          </Typography>

          {nicheAnalysis.competition && (
            <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1, mb: 1.5 }}>
              <StatCard label={tNiche('saturation')} value={`${nicheAnalysis.competition.saturationIndex}/100`}
                color={nicheAnalysis.competition.saturationIndex > 70 ? '#f44336' : nicheAnalysis.competition.saturationIndex > 40 ? '#ff9800' : '#4caf50'}
                icon={<BarChart2 size={16} />} />
              <StatCard label={tNiche('top5Concentration')} value={`%${nicheAnalysis.competition.topConcentration}`}
                color="#9c27b0" icon={<Target size={16} />} />
              <StatCard label={tNiche('newSellerSuccess')} value={`%${nicheAnalysis.competition.newSellerSuccessRate}`}
                color="#2196F3" icon={<TrendingUp size={16} />} />
              <StatCard label={tNiche('entryDifficulty')} value={`${nicheAnalysis.competition.entryDifficulty}/100`}
                color={nicheAnalysis.competition.entryDifficulty > 70 ? '#f44336' : '#4caf50'}
                icon={<AlertTriangle size={16} />} />
            </Box>
          )}

          {nicheAnalysis.velocity && (
            <Paper sx={{ ...glassCard, p: 2, mb: 1.5 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{tNiche('salesVelocityEstimate')}</Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                {[
                  { label: tNiche('avgMonthlySales'), value: nicheAnalysis.velocity.avgMonthlySales?.toFixed(1) || '0', color: '#11998e' },
                  { label: tNiche('median'), value: nicheAnalysis.velocity.medianMonthlySales?.toFixed(1) || '0', color: '#2196F3' },
                  { label: tNiche('highest'), value: nicheAnalysis.velocity.maxMonthlySales?.toFixed(1) || '0', color: '#ff9800' },
                ].map(m => (
                  <Paper key={m.label} sx={{ ...glassCard, p: 1.5, flex: 1, minWidth: 90, textAlign: 'center' }}>
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>{m.label}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: m.color }}>{m.value}</Typography>
                    <Typography variant="caption" color="text.secondary">{tNiche('salesPerMonth')}</Typography>
                  </Paper>
                ))}
              </Box>
            </Paper>
          )}
        </Box>
      )}
      {nicheAnalysisLoading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress sx={{ borderRadius: 4, height: 4 }} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {tNiche('advancedAnalysisLoading')}
          </Typography>
        </Box>
      )}

      {/* ── Section 9: AI Quick Insights ── */}
      <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: nicheAiReport ? 1.5 : 0 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Zap size={16} color="#ff9800" /> {tNiche('whatShouldIDo')}
          </Typography>
          <Button variant="contained" size="small" onClick={fetchNicheAiReport}
            disabled={nicheAiReportLoading || !hasData}
            startIcon={nicheAiReportLoading ? <CircularProgress size={14} /> : <Zap size={14} />}
            sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}
          >
            {nicheAiReport ? tNiche('reAnalyze') : tNiche('getAiReport')}
          </Button>
        </Box>
        {nicheAiReportLoading && <LinearProgress sx={{ mt: 1, borderRadius: 4, height: 3 }} />}

        {nicheAiReport && (
          <Box sx={{ mt: 1 }}>
            <Alert
              severity={['ENTER'].includes(nicheAiReport.verdict?.toUpperCase()) ? 'success' : ['AVOID'].includes(nicheAiReport.verdict?.toUpperCase()) ? 'error' : 'warning'}
              icon={['ENTER'].includes(nicheAiReport.verdict?.toUpperCase()) ? <CheckCircle size={18} /> : ['AVOID'].includes(nicheAiReport.verdict?.toUpperCase()) ? <XCircle size={18} /> : <AlertTriangle size={18} />}
              sx={{ mb: 1.5, borderRadius: '12px' }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                {nicheAiReport.verdict} ({tNiche('confidence')}: %{nicheAiReport.confidence})
              </Typography>
              <Typography variant="body2">{nicheAiReport.summary}</Typography>
            </Alert>

            <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 1, mb: 1.5 }}>
              {[
                { title: tNiche('strengths'), items: nicheAiReport.strengths, color: '#4caf50', icon: <CheckCircle size={14} /> },
                { title: tNiche('weaknesses'), items: nicheAiReport.weaknesses, color: '#f44336', icon: <XCircle size={14} /> },
                { title: tNiche('opportunities'), items: nicheAiReport.opportunities, color: '#2196F3', icon: <TrendingUp size={14} /> },
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

            {nicheAiReport.pricing_recommendation && (
              <Alert severity="info" sx={{ mb: 1.5, borderRadius: '12px' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{tNiche('priceSuggestion')}</Typography>
                <Typography variant="body2">
                  {tNiche('sweetSpot')}: <strong>${nicheAiReport.pricing_recommendation.sweet_spot}</strong> ({tNiche('range')}: ${nicheAiReport.pricing_recommendation.min} - ${nicheAiReport.pricing_recommendation.max})
                </Typography>
              </Alert>
            )}

            {nicheAiReport.action_items?.length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{tNiche('actionItems')}</Typography>
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

      {/* ── Section 10: Top Competitors Preview ── */}
      {hasData && (
        <Box sx={{ mb: 2 }}>
          <ComparisonPanel />

          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, mt: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <ShoppingBag size={18} color="#667eea" /> {tNiche('competitorProducts')} ({items.length})
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            {(['none', 'price_asc', 'price_desc', 'favorites', 'views', 'engagement'] as const).map(s => (
              <Chip key={s}
                label={{ none: tNiche('sortDefault'), price_asc: tNiche('sortPriceAsc'), price_desc: tNiche('sortPriceDesc'), favorites: tNiche('sortFavorites'), views: tNiche('sortViews'), engagement: tNiche('sortEngagement') }[s]}
                size="small" variant={compSort === s ? 'filled' : 'outlined'}
                color={compSort === s ? 'primary' : 'default'}
                onClick={() => setCompSort(s)} sx={{ cursor: 'pointer', borderRadius: '8px' }}
              />
            ))}
            <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
              <Button size="small" variant="outlined" onClick={exportCSV} sx={{ borderRadius: '8px', textTransform: 'none' }}>
                CSV
              </Button>
            </Box>
          </Box>

          {/* Product cards — mobile first */}
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
                        <img src={item.image_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)', flexShrink: 0 }} />
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
                          <Chip label={`${engagement.toFixed(1)}%`} size="small" sx={{ fontWeight: 600, borderRadius: '6px', height: 20, fontSize: '0.7rem', bgcolor: engagement > 5 ? '#e8f5e9' : '#fafafa', color: engagement > 5 ? '#2e7d32' : '#999' }} />
                        </Box>
                      </Box>
                    </Box>
                    <Collapse in={isExpanded}>
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary">
                          {tNiche('viewsLabel')}: {item.views.toLocaleString()}
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
                      <TableCell>{tNiche('titleCol')}</TableCell>
                      <TableCell align="right">
                        <TableSortLabel active={compSort === 'price_asc' || compSort === 'price_desc'} direction={compSort === 'price_asc' ? 'asc' : 'desc'}
                          onClick={() => setCompSort(compSort === 'price_desc' ? 'price_asc' : 'price_desc')}>
                          {tNiche('priceCol')}
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center">
                        <TableSortLabel active={compSort === 'favorites'} direction="desc" onClick={() => setCompSort('favorites')}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><Heart size={12} /> {tNiche('favCol')}</Box>
                        </TableSortLabel>
                      </TableCell>
                      <TableCell align="center">
                        <TableSortLabel active={compSort === 'engagement'} direction="desc" onClick={() => setCompSort('engagement')}>
                          {tNiche('engCol')}
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
                              <img src={item.image_url} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }} />
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
                              <Tooltip title={pinnedListing?.listing_id === item.listing_id ? tNiche('unpinListing') : tNiche('compareListing')}>
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
                {tNiche('loadMore', { remaining: items.length - visibleCount })}
              </Button>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
