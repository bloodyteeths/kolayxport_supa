import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Box, Typography, Paper, Chip, Alert, Divider, Button, TextField,
  CircularProgress, LinearProgress, Tooltip, Pagination, Drawer,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel,
  IconButton, useMediaQuery, Collapse, Skeleton, Card, CardContent,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Store, Star, Users, ExternalLink, Search, ShoppingCart,
  Eye, Heart, ShoppingBag, Sparkles, DollarSign, Target, Calendar,
  Zap, MessageSquare, ThumbsUp, ThumbsDown, Flame, Copy, Clock,
  TrendingUp, BarChart3, Link,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useTranslations } from 'next-intl';
import { useEtsyResearchStore, useComputedShopStats, useComputedDeepDive } from '@/lib/stores/useEtsyResearchStore';
import { StatCard, ScoreRing, GradientBar, PremiumEmptyState, GRADIENTS, glassCard } from './shared/ui';
import { fmt, pct, sortArray } from './shared/utils';
import type { SortDir } from './shared/types';

const LISTINGS_PER_PAGE = 25;

function shopAge(createdTimestamp: number): string {
  if (!createdTimestamp) return '-';
  const created = new Date(createdTimestamp * 1000);
  const now = new Date();
  const months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
  if (months >= 12) {
    const years = Math.floor(months / 12);
    const rem = months % 12;
    return rem > 0 ? `${years}y ${rem}m` : `${years}y`;
  }
  return `${months}m`;
}

function estimateMonthlySales(listing: any): number {
  if (!listing.created_timestamp) return 0;
  const ageMonths = Math.max(1, (Date.now() / 1000 - listing.created_timestamp) / (30 * 86400));
  return Math.round((listing.num_favorers / ageMonths) * 0.03 * 10) / 10;
}

function listingAgeLabel(ts: number): string {
  if (!ts) return '-';
  const days = Math.floor((Date.now() / 1000 - ts) / 86400);
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}m`;
  return `${Math.floor(days / 365)}y ${Math.floor((days % 365) / 30)}m`;
}

function buildPriceBuckets(listings: any[]): { range: string; count: number; revenue: number; min: number; max: number }[] {
  const prices = listings.map(l => l.price).filter(p => p > 0).sort((a, b) => a - b);
  if (prices.length === 0) return [];
  const minP = prices[0];
  const maxP = prices[prices.length - 1];
  const span = maxP - minP;
  if (span === 0) return [{ range: `$${minP.toFixed(0)}`, count: prices.length, revenue: prices.reduce((s, p) => s + p, 0), min: minP, max: maxP }];
  // Aim for 6-8 buckets with nice round sizes
  const rawSize = span / 7;
  const bucketSize = rawSize <= 5 ? 5 : rawSize <= 10 ? 10 : rawSize <= 25 ? 25 : rawSize <= 50 ? 50 : Math.ceil(rawSize / 10) * 10;
  const buckets: { range: string; count: number; revenue: number; min: number; max: number }[] = [];
  const startFloor = Math.floor(minP / bucketSize) * bucketSize;
  for (let start = startFloor; start < maxP + bucketSize; start += bucketSize) {
    const end = start + bucketSize;
    const inBucket = listings.filter(l => l.price >= start && l.price < end);
    buckets.push({
      range: `$${start}-$${end}`,
      count: inBucket.length,
      revenue: inBucket.reduce((s, l) => s + l.price, 0),
      min: start, max: end,
    });
    if (buckets.length >= 10) break; // safety cap
  }
  return buckets;
}

export default function CompetitorIntelligence() {
  const t = useTranslations('etsy.competitor');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [expandedShopIdx, setExpandedShopIdx] = useState<number | null>(null);
  const [expandedListingIdx, setExpandedListingIdx] = useState<number | null>(null);
  const deepDiveRef = useRef<HTMLDivElement>(null);
  const [drawerListingId, setDrawerListingId] = useState<number | null>(null);
  const [drawerData, setDrawerData] = useState<any>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerAudit, setDrawerAudit] = useState<any>(null);
  const [drawerAuditLoading, setDrawerAuditLoading] = useState(false);
  // ---------------------------------------------------------------------------
  // Store
  // ---------------------------------------------------------------------------
  const {
    shopsLoading, shopDiscoveryFailed, serverShopIds,
    deepDiveShopId, deepDiveShop, deepDiveLoading, deepDiveListings,
    aiAnalysis, aiLoading, items, discoveredShops,
    discoverShops, setDeepDiveShopId, searchShopDeepDive, generateAiInsights,
  } = useEtsyResearchStore();

  const analyzeShop = useEtsyResearchStore(s => s.analyzeShop);
  const shopSpyReport = useEtsyResearchStore(s => s.shopSpyReport);
  const shopSpyReportLoading = useEtsyResearchStore(s => s.shopSpyReportLoading);
  const shopReviews = useEtsyResearchStore(s => s.shopReviews);
  const shopReviewsLoading = useEtsyResearchStore(s => s.shopReviewsLoading);
  const reviewSentiment = useEtsyResearchStore(s => s.reviewSentiment);
  const reviewSentimentLoading = useEtsyResearchStore(s => s.reviewSentimentLoading);
  const fetchShopSpyReport = useEtsyResearchStore(s => s.fetchShopSpyReport);
  const fetchShopReviews = useEtsyResearchStore(s => s.fetchShopReviews);
  const fetchReviewSentiment = useEtsyResearchStore(s => s.fetchReviewSentiment);
  const discoveryData = useEtsyResearchStore(s => s.discoveryData);
  const discoveryLoading = useEtsyResearchStore(s => s.discoveryLoading);
  const setQuery = useEtsyResearchStore(s => s.setQuery);
  const searchMarket = useEtsyResearchStore(s => s.searchMarket);

  const shopStats = useComputedShopStats();
  const deepDiveStats = useComputedDeepDive();

  const hasData = items.length > 0;

  // ---------------------------------------------------------------------------
  // Local sort state
  // ---------------------------------------------------------------------------
  const [shopSortKey, setShopSortKey] = useState('num_sales');
  const [shopSortDir, setShopSortDir] = useState<SortDir>('desc');
  const [bestListingSortKey, setBestListingSortKey] = useState('num_favorers');
  const [bestListingSortDir, setBestListingSortDir] = useState<SortDir>('desc');
  const [listingPage, setListingPage] = useState(1);

  const toggleSort = useCallback((key: string, currentKey: string, currentDir: SortDir, setKey: (k: string) => void, setDir: (d: SortDir) => void) => {
    if (currentKey === key) setDir(currentDir === 'asc' ? 'desc' : 'asc');
    else { setKey(key); setDir('desc'); }
  }, []);

  const sortedShops = useMemo(
    () => shopStats ? sortArray(shopStats.shops, shopSortKey, shopSortDir) : [],
    [shopStats, shopSortKey, shopSortDir],
  );

  // All listings (not top 10), sorted + paginated
  const allListingsSorted = useMemo(() => {
    if (!deepDiveListings || deepDiveListings.length === 0) return [];
    const withEstSales = deepDiveListings.map(l => ({ ...l, estMonthlySales: estimateMonthlySales(l) }));
    return sortArray(withEstSales, bestListingSortKey, bestListingSortDir);
  }, [deepDiveListings, bestListingSortKey, bestListingSortDir]);

  const totalListingPages = Math.ceil(allListingsSorted.length / LISTINGS_PER_PAGE);
  const pagedListings = useMemo(
    () => allListingsSorted.slice((listingPage - 1) * LISTINGS_PER_PAGE, listingPage * LISTINGS_PER_PAGE),
    [allListingsSorted, listingPage],
  );

  // Reset page when listings change
  useEffect(() => { setListingPage(1); }, [deepDiveListings]);

  // Tag cloud data (all tags, not just 20)
  const allTags = useMemo(() => {
    if (!deepDiveListings || deepDiveListings.length === 0) return [];
    const tagMap: Record<string, { count: number; totalFav: number }> = {};
    deepDiveListings.forEach(l => {
      (l.tags || []).forEach((t: string) => {
        const key = t.toLowerCase();
        if (!tagMap[key]) tagMap[key] = { count: 0, totalFav: 0 };
        tagMap[key].count++;
        tagMap[key].totalFav += l.num_favorers || 0;
      });
    });
    return Object.entries(tagMap)
      .sort(([, a], [, b]) => b.count - a.count)
      .map(([tag, data]) => ({
        tag,
        count: data.count,
        pct: Math.round((data.count / deepDiveListings.length) * 100),
        avgFav: Math.round(data.totalFav / data.count),
      }));
  }, [deepDiveListings]);

  // Price distribution buckets
  const priceBuckets = useMemo(() => buildPriceBuckets(deepDiveListings || []), [deepDiveListings]);

  // Estimated monthly revenue
  const estMonthlyRevenue = useMemo(() => {
    if (!deepDiveListings || deepDiveListings.length === 0 || !deepDiveShop) return 0;
    const totalEstSales = allListingsSorted.reduce((s, l) => s + Math.max(0, l.estMonthlySales || 0), 0);
    const avgPrice = deepDiveListings.reduce((s, l) => s + l.price, 0) / deepDiveListings.length;
    return Math.max(0, Math.round(totalEstSales * avgPrice));
  }, [deepDiveListings, deepDiveShop, allListingsSorted]);

  const estMonthlySales = useMemo(() => {
    return Math.max(0, Math.round(allListingsSorted.reduce((s, l) => s + Math.max(0, l.estMonthlySales || 0), 0)));
  }, [allListingsSorted]);

  // Handle analyze with scroll
  const handleAnalyzeShop = useCallback(async (shopId: string) => {
    analyzeShop(shopId);
    setTimeout(() => {
      deepDiveRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  }, [analyzeShop]);

  // Open listing detail drawer
  const openListingDrawer = useCallback(async (listingId: number) => {
    setDrawerListingId(listingId);
    setDrawerData(null);
    setDrawerAudit(null);
    setDrawerLoading(true);
    try {
      const res = await fetch(`/api/clawd/etsy?action=analyze_listing_url&listing_id=${listingId}`);
      if (!res.ok) throw new Error('Failed to load listing');
      const data = await res.json();
      setDrawerData(data);
    } catch (err: any) { toast.error(err.message); }
    finally { setDrawerLoading(false); }
  }, []);

  // AI strategy analysis for drawer listing
  const analyzeDrawerStrategy = useCallback(async () => {
    if (!drawerData) return;
    setDrawerAuditLoading(true);
    try {
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'listing_audit',
          title: drawerData.title,
          description: drawerData.description || '',
          tags: drawerData.tags,
          price: drawerData.price,
          favorites: drawerData.num_favorers,
          views: drawerData.views,
          imageCount: drawerData.imageCount,
          seoScore: drawerData.seoScore?.total,
          marketAvgPrice: deepDiveStats?.priceAvg || null,
          marketAvgFavorites: deepDiveStats?.avgFav || null,
        }),
      });
      if (!res.ok) throw new Error('AI analysis failed');
      const data = await res.json();
      setDrawerAudit(data.report);
    } catch (err: any) { toast.error(err.message); }
    finally { setDrawerAuditLoading(false); }
  }, [drawerData, deepDiveStats]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Box>
      {/* ================================================================ */}
      {/* SHOP DISCOVERY                                                    */}
      {/* ================================================================ */}
      {shopsLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}
      {shopStats && shopStats.shops.length > 0 ? (
        <>
          <Paper sx={{ ...glassCard, p: isMobile ? 1.5 : 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('shopConcentration')}</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(3, 1fr)', gap: 1.5, mb: 2 }}>
              <StatCard label={t('totalShops')} value={String(shopStats.shops.length)} color="#667eea" icon={<Store size={18} />} />
              <StatCard label={t('avgRating')} value={`${shopStats.avgRating}`} color="#ff9800" icon={<Star size={18} />} />
              <StatCard label={t('top5Share')} value={shopStats.totalListings > 0 ? pct((shopStats.top5Sales / shopStats.totalListings) * 100) : '0%'} color="#9c27b0" icon={<Users size={18} />} />
            </Box>

            {/* Concentration bar */}
            <Box sx={{ display: 'flex', height: 24, borderRadius: '12px', overflow: 'hidden' }}>
              <Box sx={{
                width: `${shopStats.totalListings ? (shopStats.top5Sales / shopStats.totalListings) * 100 : 0}%`,
                background: GRADIENTS.primary, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.82rem', fontWeight: 600 }}>Top 5</Typography>
              </Box>
              <Box sx={{ flex: 1, bgcolor: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="caption" sx={{ fontSize: '0.82rem' }}>{t('other')}</Typography>
              </Box>
            </Box>
          </Paper>

          {isMobile ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {sortedShops.map((s, i) => {
                const isExpanded = expandedShopIdx === i;
                return (
                  <Paper key={s.shop_id} sx={{
                    ...glassCard, p: 1.5, cursor: 'pointer',
                    borderLeft: i < 3 ? '3px solid #667eea' : 'none',
                  }} onClick={() => setExpandedShopIdx(isExpanded ? null : i)}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>{s.shop_name}</Typography>
                        <Box sx={{ display: 'flex', gap: 1, mt: 0.3, alignItems: 'center', flexWrap: 'wrap' }}>
                          <Typography variant="caption" sx={{ fontWeight: 600 }}>{s.num_sales.toLocaleString()} {t('salesLabel')}</Typography>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                            <Star size={10} color="#ff9800" fill="#ff9800" />
                            <Typography variant="caption">{s.review_average.toFixed(1)}</Typography>
                          </Box>
                          {s.avgPrice && <Typography variant="caption" color="text.secondary">{fmt(s.avgPrice)}</Typography>}
                        </Box>
                      </Box>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: i < 3 ? '#667eea' : '#999' }}>#{i + 1}</Typography>
                    </Box>
                    <Collapse in={isExpanded}>
                      <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box sx={{ display: 'flex', gap: 1.5 }}>
                          <Typography variant="caption" color="text.secondary">{t('reviews')}: {s.review_count.toLocaleString()}</Typography>
                          <Typography variant="caption" color="text.secondary">{t('products')}: {s.listing_active_count}</Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); handleAnalyzeShop(String(s.shop_id)); }}
                            sx={{ borderRadius: '8px', fontSize: '0.85rem' }}>{t('analyze')}</Button>
                          <IconButton size="small" onClick={(e) => { e.stopPropagation(); window.open(s.url, '_blank'); }}>
                            <ExternalLink size={14} />
                          </IconButton>
                        </Box>
                      </Box>
                    </Collapse>
                  </Paper>
                );
              })}
            </Box>
          ) : (
          <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
            <TableContainer sx={{ maxHeight: 500 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                    <TableCell>#</TableCell>
                    <TableCell>{t('shop')}</TableCell>
                    <TableCell align="center"><TableSortLabel active={shopSortKey==='num_sales'} direction={shopSortKey==='num_sales'?shopSortDir:'desc'} onClick={()=>toggleSort('num_sales',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('sales')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={shopSortKey==='review_average'} direction={shopSortKey==='review_average'?shopSortDir:'desc'} onClick={()=>toggleSort('review_average',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('rating')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={shopSortKey==='review_count'} direction={shopSortKey==='review_count'?shopSortDir:'desc'} onClick={()=>toggleSort('review_count',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('reviews')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={shopSortKey==='listingCount'} direction={shopSortKey==='listingCount'?shopSortDir:'desc'} onClick={()=>toggleSort('listingCount',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('products')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={shopSortKey==='avgPrice'} direction={shopSortKey==='avgPrice'?shopSortDir:'desc'} onClick={()=>toggleSort('avgPrice',shopSortKey,shopSortDir,setShopSortKey,setShopSortDir)}>{t('avgPrice')}</TableSortLabel></TableCell>
                    <TableCell sx={{ width: 40 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sortedShops.map((s, i) => (
                    <TableRow key={s.shop_id} hover sx={{
                      '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                      borderLeft: i < 3 ? '3px solid #667eea' : 'none',
                    }}>
                      <TableCell>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: i < 3 ? '#667eea' : '#999' }}>
                          {i + 1}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" sx={{
                          fontWeight: 600, cursor: 'pointer',
                          '&:hover': { textDecoration: 'underline', color: 'primary.main' },
                        }} onClick={() => handleAnalyzeShop(String(s.shop_id))}>
                          {s.shop_name}
                        </Typography>
                      </TableCell>
                      <TableCell align="center"><Typography variant="body2" sx={{ fontWeight: 700 }}>{s.num_sales.toLocaleString()}</Typography></TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.3 }}>
                          <Star size={12} color="#ff9800" fill="#ff9800" /> {s.review_average.toFixed(1)}
                        </Box>
                      </TableCell>
                      <TableCell align="center">{s.review_count.toLocaleString()}</TableCell>
                      <TableCell align="center">{s.listing_active_count}</TableCell>
                      <TableCell align="center">{s.avgPrice ? fmt(s.avgPrice) : '-'}</TableCell>
                      <TableCell>
                        <IconButton size="small" onClick={() => window.open(s.url, '_blank')}>
                          <ExternalLink size={14} />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
          )}
        </>
      ) : !shopsLoading && (
        shopDiscoveryFailed && serverShopIds.length > 0
          ? <Alert severity="error" sx={{ borderRadius: '12px', mb: 2 }}
              action={<Button color="inherit" size="small" onClick={() => discoverShops(serverShopIds)}>{t('retry')}</Button>}
            >
              {t('shopInfoFailed')}
            </Alert>
          : hasData
            ? <Alert severity="info" sx={{ borderRadius: '12px' }}>{t('shopInfoLoading')}</Alert>
            : (
              <>
                {/* Discovery: top items from trending niches as competitor preview */}
                {discoveryLoading && (
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 2 }}>
                    {[1, 2, 3, 4].map(i => (
                      <Skeleton key={i} variant="rounded" height={120} sx={{ borderRadius: '16px' }} />
                    ))}
                  </Box>
                )}

                {discoveryData?.trendingNiches?.length > 0 ? (
                  <Box sx={{ mb: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Flame size={18} color="#f44336" /> {t('topListingsTrending')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                      {t('clickNicheCompetitor')}
                    </Typography>
                    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
                      {discoveryData.trendingNiches.map((niche: any) => (
                        <Card key={niche.query} sx={{
                          ...glassCard, cursor: 'pointer',
                          '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' },
                          transition: 'all 0.2s',
                        }} onClick={() => { setQuery(niche.query); setTimeout(() => searchMarket(), 50); }}>
                          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, textTransform: 'capitalize', mb: 1 }}>
                              {niche.query}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 1 }}>
                              <Chip label={`${niche.totalResults?.toLocaleString()} ${t('resultsLabel')}`} size="small" variant="outlined" sx={{ fontSize: '0.85rem', height: 26 }} />
                              <Chip label={`$${niche.priceStats?.avg?.toFixed(2)} ${t('avgLabel')}`} size="small" variant="outlined" sx={{ fontSize: '0.85rem', height: 26 }} />
                            </Box>
                            {niche.topItems?.slice(0, 3).map((item: any) => (
                              <Box key={item.listing_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                                {item.image_url && (
                                  <Box component="img" src={item.image_url} alt="" sx={{ width: 28, height: 28, borderRadius: '6px', objectFit: 'cover' }} />
                                )}
                                <Typography variant="caption" sx={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {item.title}
                                </Typography>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: '#667eea' }}>${item.price}</Typography>
                              </Box>
                            ))}
                          </CardContent>
                        </Card>
                      ))}
                    </Box>
                  </Box>
                ) : !discoveryLoading && (
                  <PremiumEmptyState icon={<Users size={48} />} title={t('shopAnalysis')}
                    desc={t('shopAnalysisDesc')}
                    steps={[t('shopStep1'), t('shopStep2'), t('shopStep3')]}
                  />
                )}
              </>
            )
      )}

      {/* ================================================================ */}
      {/* SHOP DEEP DIVE                                                    */}
      {/* ================================================================ */}
      <Divider sx={{ my: 3 }} />
      <div ref={deepDiveRef} />
      <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('shopDeepAnalysis')}</Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField label={t('shopId')} value={deepDiveShopId}
            onChange={e => setDeepDiveShopId(e.target.value)} size="small"
            sx={{ flex: 1, minWidth: isMobile ? 0 : 200 }} placeholder={t('shopIdPlaceholder')}
            onKeyDown={e => e.key === 'Enter' && handleAnalyzeShop(deepDiveShopId)}
          />
          <Button variant="contained" onClick={() => handleAnalyzeShop(deepDiveShopId)}
            disabled={deepDiveLoading || !deepDiveShopId.trim()}
            startIcon={deepDiveLoading ? <CircularProgress size={16} /> : <Search size={16} />}
            sx={{ background: GRADIENTS.primary, borderRadius: '10px', ...(isMobile && { width: '100%' }) }}
          >
            {t('analyze')}
          </Button>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          {t('shopIdHint')}
        </Typography>
      </Paper>

      {deepDiveLoading && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress sx={{ mb: 1, borderRadius: 4, height: 4 }} />
          <Typography variant="caption" color="text.secondary">{t('autoAnalyzing')}</Typography>
        </Box>
      )}

      {/* ================================================================ */}
      {/* ENHANCED SHOP HEADER                                              */}
      {/* ================================================================ */}
      {deepDiveShop && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', mb: 2, flexWrap: 'wrap' }}>
            {deepDiveShop.icon_url && (
              <Box component="img" src={deepDiveShop.icon_url} alt={deepDiveShop.shop_name}
                sx={{ width: 64, height: 64, borderRadius: '16px', objectFit: 'cover', border: '2px solid rgba(102,126,234,0.2)' }}
              />
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>{deepDiveShop.shop_name}</Typography>
                {deepDiveShop.url && (
                  <IconButton size="small" onClick={() => window.open(deepDiveShop.url, '_blank')}
                    sx={{ bgcolor: 'rgba(102,126,234,0.08)', '&:hover': { bgcolor: 'rgba(102,126,234,0.15)' } }}>
                    <Link size={14} color="#667eea" />
                  </IconButton>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 0.5 }}>
                {deepDiveShop.created_timestamp && (
                  <Chip size="small" icon={<Clock size={12} />} label={shopAge(deepDiveShop.created_timestamp)}
                    variant="outlined" sx={{ fontSize: '0.85rem', height: 26 }} />
                )}
                {estMonthlyRevenue > 0 && (
                  <Chip size="small" icon={<TrendingUp size={12} />} label={`~$${estMonthlyRevenue.toLocaleString()}/mo`}
                    sx={{ fontSize: '0.85rem', height: 26, bgcolor: 'rgba(76,175,80,0.1)', color: '#4caf50', fontWeight: 700 }} />
                )}
                {estMonthlySales > 0 && (
                  <Chip size="small" icon={<ShoppingCart size={12} />} label={`~${estMonthlySales} sales/mo`}
                    sx={{ fontSize: '0.85rem', height: 26, bgcolor: 'rgba(33,150,243,0.1)', color: '#2196F3', fontWeight: 700 }} />
                )}
              </Box>
            </Box>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1.5 }}>
            <StatCard label={t('totalSales')} value={deepDiveShop.num_sales.toLocaleString()} color="#11998e" icon={<ShoppingCart size={18} />} />
            <StatCard label={t('rating')} value={`${deepDiveShop.review_average.toFixed(1)}`} color="#ff9800" icon={<Star size={18} />} />
            <StatCard label={t('reviews')} value={deepDiveShop.review_count.toLocaleString()} color="#2196F3" icon={<Eye size={18} />} />
            <StatCard label={t('activeProducts')} value={String(deepDiveShop.listing_active_count)} color="#9c27b0" icon={<ShoppingBag size={18} />} />
          </Box>
        </Paper>
      )}

      {deepDiveStats && (
        <>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(5, 1fr)', gap: 1.5, mb: 2 }}>
            <StatCard label={t('minPrice')} value={fmt(deepDiveStats.priceMin)} color="#11998e" />
            <StatCard label={t('avgPriceLabel')} value={fmt(deepDiveStats.priceAvg)} color="#2196F3" />
            <StatCard label={t('maxPrice')} value={fmt(deepDiveStats.priceMax)} color="#f44336" />
            <StatCard label={t('avgFavorites')} value={String(deepDiveStats.avgFav)} color="#e91e63" icon={<Heart size={18} />} />
            <StatCard label={t('avgViews')} value={String(deepDiveStats.avgViews)} color="#ff9800" icon={<Eye size={18} />} />
          </Box>

          {/* ================================================================ */}
          {/* PRICE DISTRIBUTION                                               */}
          {/* ================================================================ */}
          {priceBuckets.length > 1 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <BarChart3 size={16} color="#2196F3" /> {t('priceDistribution')}
              </Typography>
              {(() => {
                const maxCount = Math.max(...priceBuckets.map(bb => bb.count));
                const BAR_AREA = 100; // px available for bars
                return (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end', pt: 2, pb: 1 }}>
                    {priceBuckets.map((b, i) => {
                      const barH = maxCount > 0 ? Math.max(6, Math.round((b.count / maxCount) * BAR_AREA)) : 6;
                      return (
                        <Tooltip key={i} title={`${b.range}: ${b.count} ${t('listings')} — $${Math.round(b.revenue)} ${t('revenue')}`}>
                          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <Typography variant="caption" sx={{ fontSize: '0.85rem', fontWeight: 700, mb: 0.5 }}>{b.count}</Typography>
                            <Box sx={{
                              width: '80%', height: barH, minHeight: 6,
                              background: GRADIENTS.primary, borderRadius: '6px 6px 0 0',
                            }} />
                            <Typography variant="caption" sx={{ fontSize: '0.82rem', mt: 0.5, whiteSpace: 'nowrap', color: 'text.secondary' }}>{b.range}</Typography>
                          </Box>
                        </Tooltip>
                      );
                    })}
                  </Box>
                );
              })()}
            </Paper>
          )}

          {/* ================================================================ */}
          {/* TAG CLOUD                                                         */}
          {/* ================================================================ */}
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('topUsedTags')}</Typography>
              {allTags.length > 0 && (
                <Button size="small" variant="outlined" startIcon={<Copy size={12} />}
                  onClick={() => {
                    navigator.clipboard.writeText(allTags.map(t => t.tag).join(', '));
                    toast.success(t('tagsCopied'));
                  }}
                  sx={{ borderRadius: '8px', fontSize: '0.85rem' }}>
                  {t('copyAllTags')}
                </Button>
              )}
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {allTags.map(tg => {
                const isHigh = tg.avgFav > (deepDiveStats?.avgFav || 0);
                const sizeScale = Math.min(1.2, 0.7 + (tg.count / (deepDiveListings?.length || 1)) * 2);
                return (
                  <Chip key={tg.tag} label={`${tg.tag} (${tg.pct}%)`} size="small" variant="outlined"
                    onClick={() => { navigator.clipboard.writeText(tg.tag); toast.success(t('copied')); }}
                    sx={{
                      cursor: 'pointer', borderRadius: '8px',
                      fontSize: `${sizeScale * 0.75}rem`,
                      height: Math.round(sizeScale * 24),
                      borderColor: isHigh ? '#4caf50' : '#bdbdbd',
                      color: isHigh ? '#2e7d32' : 'text.secondary',
                      fontWeight: isHigh ? 600 : 400,
                    }}
                  />
                );
              })}
            </Box>
          </Paper>

          {/* ================================================================ */}
          {/* ALL LISTINGS TABLE (with images, pagination, sort)               */}
          {/* ================================================================ */}
          {isMobile ? (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {t('allListings')} ({allListingsSorted.length})
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {pagedListings.map((l, i) => {
                  const globalIdx = (listingPage - 1) * LISTINGS_PER_PAGE + i;
                  const isExpanded = expandedListingIdx === globalIdx;
                  return (
                    <Paper key={l.listing_id} sx={{
                      ...glassCard, p: 1.5, cursor: 'pointer',
                      borderLeft: globalIdx < 3 ? '3px solid #667eea' : 'none',
                    }} onClick={() => setExpandedListingIdx(isExpanded ? null : globalIdx)}>
                      <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                        {l.image_url && (
                          <Box component="img" src={l.image_url} alt="" loading="lazy"
                            sx={{ width: 48, height: 48, borderRadius: '8px', objectFit: 'cover', flexShrink: 0 }} />
                        )}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {l.title}
                          </Typography>
                          <Box sx={{ display: 'flex', gap: 1, mt: 0.3, alignItems: 'center', flexWrap: 'wrap' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>{fmt(l.price)}</Typography>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                              <Heart size={10} color="#e91e63" />
                              <Typography variant="caption" sx={{ fontWeight: 600 }}>{l.num_favorers.toLocaleString()}</Typography>
                            </Box>
                            {l.estMonthlySales > 0 && (
                              <Typography variant="caption" sx={{ color: '#4caf50', fontWeight: 600 }}>~{l.estMonthlySales}/mo</Typography>
                            )}
                          </Box>
                        </Box>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: globalIdx < 3 ? '#667eea' : '#999' }}>#{globalIdx + 1}</Typography>
                      </Box>
                      <Collapse in={isExpanded}>
                        <Box sx={{ mt: 1, pt: 1, borderTop: '1px solid rgba(0,0,0,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Box sx={{ display: 'flex', gap: 1 }}>
                            <Typography variant="caption" color="text.secondary">{t('viewsLabel')}: {l.views.toLocaleString()}</Typography>
                            <Typography variant="caption" color="text.secondary">{listingAgeLabel(l.created_timestamp)}</Typography>
                          </Box>
                          <Box sx={{ display: 'flex', gap: 0.5 }}>
                            <Button size="small" variant="contained" onClick={(e) => { e.stopPropagation(); openListingDrawer(l.listing_id); }}
                              startIcon={<Search size={12} />} sx={{ borderRadius: '8px', fontSize: '0.85rem', background: GRADIENTS.primary }}>{t('analyze')}</Button>
                            <Button size="small" variant="outlined" onClick={(e) => { e.stopPropagation(); window.open(l.url, '_blank'); }}
                              startIcon={<ExternalLink size={12} />} sx={{ borderRadius: '8px', fontSize: '0.85rem' }}>Etsy</Button>
                          </Box>
                        </Box>
                      </Collapse>
                    </Paper>
                  );
                })}
              </Box>
              {totalListingPages > 1 && (
                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                  <Pagination count={totalListingPages} page={listingPage} onChange={(_, p) => setListingPage(p)}
                    size="small" color="primary" />
                </Box>
              )}
            </Box>
          ) : (
          <Paper sx={{ ...glassCard, overflow: 'hidden', mb: 2 }}>
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('allListings')} ({allListingsSorted.length})
              </Typography>
              {totalListingPages > 1 && (
                <Typography variant="caption" color="text.secondary">
                  {t('page')} {listingPage} {t('of')} {totalListingPages}
                </Typography>
              )}
            </Box>
            <TableContainer sx={{ maxHeight: 600 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                    <TableCell>#</TableCell>
                    <TableCell sx={{ width: 50 }}>{t('image')}</TableCell>
                    <TableCell>{t('titleCol')}</TableCell>
                    <TableCell align="right"><TableSortLabel active={bestListingSortKey==='price'} direction={bestListingSortKey==='price'?bestListingSortDir:'desc'} onClick={()=>toggleSort('price',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('priceCol')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={bestListingSortKey==='num_favorers'} direction={bestListingSortKey==='num_favorers'?bestListingSortDir:'desc'} onClick={()=>toggleSort('num_favorers',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('favoriteCol')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={bestListingSortKey==='views'} direction={bestListingSortKey==='views'?bestListingSortDir:'desc'} onClick={()=>toggleSort('views',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('viewsCol')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={bestListingSortKey==='estMonthlySales'} direction={bestListingSortKey==='estMonthlySales'?bestListingSortDir:'desc'} onClick={()=>toggleSort('estMonthlySales',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('estSales')}</TableSortLabel></TableCell>
                    <TableCell align="center"><TableSortLabel active={bestListingSortKey==='created_timestamp'} direction={bestListingSortKey==='created_timestamp'?bestListingSortDir:'desc'} onClick={()=>toggleSort('created_timestamp',bestListingSortKey,bestListingSortDir,setBestListingSortKey,setBestListingSortDir)}>{t('listingAge')}</TableSortLabel></TableCell>
                    <TableCell sx={{ width: 40 }} />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {pagedListings.map((l, i) => {
                    const globalIdx = (listingPage - 1) * LISTINGS_PER_PAGE + i;
                    return (
                      <TableRow key={l.listing_id} hover onClick={() => openListingDrawer(l.listing_id)} sx={{
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                        borderLeft: globalIdx < 3 ? '3px solid #667eea' : 'none',
                      }}>
                        <TableCell>
                          <Typography variant="caption" sx={{ fontWeight: 700, color: globalIdx < 3 ? '#667eea' : '#999' }}>{globalIdx + 1}</Typography>
                        </TableCell>
                        <TableCell>
                          {l.image_url ? (
                            <Box component="img" src={l.image_url} alt="" loading="lazy"
                              sx={{ width: 40, height: 40, borderRadius: '6px', objectFit: 'cover' }} />
                          ) : (
                            <Box sx={{ width: 40, height: 40, borderRadius: '6px', bgcolor: '#f5f5f5', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ShoppingBag size={16} color="#ccc" />
                            </Box>
                          )}
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {l.title}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">{fmt(l.price)}</TableCell>
                        <TableCell align="center">
                          <Typography sx={{ fontWeight: 700, color: l.num_favorers > 100 ? '#11998e' : '#ff9800' }}>
                            {l.num_favorers.toLocaleString()}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">{l.views.toLocaleString()}</TableCell>
                        <TableCell align="center">
                          <Typography variant="body2" sx={{ color: '#4caf50', fontWeight: 600 }}>
                            {l.estMonthlySales > 0 ? l.estMonthlySales : '-'}
                          </Typography>
                        </TableCell>
                        <TableCell align="center">
                          <Typography variant="caption" color="text.secondary">{listingAgeLabel(l.created_timestamp)}</Typography>
                        </TableCell>
                        <TableCell>
                          <IconButton size="small" onClick={() => window.open(l.url, '_blank')}><ExternalLink size={14} /></IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
            {totalListingPages > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 1.5 }}>
                <Pagination count={totalListingPages} page={listingPage} onChange={(_, p) => setListingPage(p)}
                  size="small" color="primary" />
              </Box>
            )}
          </Paper>
          )}
        </>
      )}

      {/* ================================================================ */}
      {/* SHOP SPY AI REPORT + REVIEWS (auto-triggered)                    */}
      {/* ================================================================ */}
      {deepDiveShop && (
        <Box sx={{ mt: 2 }}>
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: shopSpyReport ? 2 : 0, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Zap size={16} color="#ff9800" />{t('aiShopReport')}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, ...(isMobile && { width: '100%' }) }}>
                <Button size="small" variant="outlined" onClick={fetchShopReviews}
                  disabled={shopReviewsLoading}
                  startIcon={shopReviewsLoading ? <CircularProgress size={14} /> : <MessageSquare size={14} />}
                  sx={{ borderRadius: '10px', ...(isMobile && { flex: 1 }) }}>
                  {t('loadReviews')}
                </Button>
                <Button size="small" variant="contained" onClick={fetchShopSpyReport}
                  disabled={shopSpyReportLoading || !deepDiveStats}
                  startIcon={shopSpyReportLoading ? <CircularProgress size={14} /> : <Zap size={14} />}
                  sx={{ background: GRADIENTS.primary, borderRadius: '10px', ...(isMobile && { flex: 1 }) }}>
                  {t('aiReport')}
                </Button>
              </Box>
            </Box>

            {(shopSpyReportLoading || shopReviewsLoading) && (
              <Box sx={{ mb: 1 }}>
                <LinearProgress sx={{ mb: 0.5, borderRadius: 4, height: 3 }} />
                <Typography variant="caption" color="text.secondary">
                  {shopSpyReportLoading && t('loadingAiReport')}
                  {shopSpyReportLoading && shopReviewsLoading && ' + '}
                  {shopReviewsLoading && t('loadingReviews')}
                </Typography>
              </Box>
            )}

            {shopSpyReport && (
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h3" sx={{ fontWeight: 900, color: (shopSpyReport.shop_score ?? 0) >= 70 ? '#4caf50' : (shopSpyReport.shop_score ?? 0) >= 50 ? '#2196F3' : '#ff9800' }}>
                      {shopSpyReport.shop_score}
                    </Typography>
                    <Typography variant="caption">{t('shopScore')}</Typography>
                  </Box>
                  <Divider orientation="vertical" flexItem />
                  <Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {t('estMonthlyRevenue')}: ${shopSpyReport.estimated_monthly_revenue?.toLocaleString()}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">{shopSpyReport.revenue_reasoning}</Typography>
                  </Box>
                </Box>

                <Typography variant="body2" sx={{ mb: 2 }}>{shopSpyReport.strategy_summary}</Typography>

                <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 1.5, mb: 2 }}>
                  {[
                    { title: t('strengths'), items: shopSpyReport.strengths, color: '#4caf50', icon: <ThumbsUp size={14} /> },
                    { title: t('weaknesses'), items: shopSpyReport.weaknesses, color: '#f44336', icon: <ThumbsDown size={14} /> },
                  ].map(section => (
                    <Paper key={section.title} sx={{ ...glassCard, p: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: section.color, display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                        {section.icon} {section.title}
                      </Typography>
                      {(section.items || []).map((item: string, i: number) => (
                        <Typography key={i} variant="body2" sx={{ fontSize: '0.875rem', mb: 0.3 }}>• {item}</Typography>
                      ))}
                    </Paper>
                  ))}
                </Box>

                {shopSpyReport.what_to_learn?.length > 0 && (
                  <Alert severity="success" sx={{ mb: 1.5, borderRadius: '12px' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('whatToLearn')}</Typography>
                    {shopSpyReport.what_to_learn.map((item: string, i: number) => (
                      <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem' }}>• {item}</Typography>
                    ))}
                  </Alert>
                )}
                {shopSpyReport.what_to_avoid?.length > 0 && (
                  <Alert severity="warning" sx={{ borderRadius: '12px' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('whatToAvoid')}</Typography>
                    {shopSpyReport.what_to_avoid.map((item: string, i: number) => (
                      <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem' }}>• {item}</Typography>
                    ))}
                  </Alert>
                )}
              </Box>
            )}
          </Paper>

          {/* Review Sentiment */}
          {shopReviews && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <MessageSquare size={16} color="#2196F3" />{t('customerReviews')} ({shopReviews.reviews?.length || 0})
                </Typography>
                <Button size="small" variant="contained" onClick={fetchReviewSentiment}
                  disabled={reviewSentimentLoading || !shopReviews.reviews?.length}
                  startIcon={reviewSentimentLoading ? <CircularProgress size={14} /> : <Zap size={14} />}
                  sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}>
                  {t('sentimentAnalysis')}
                </Button>
              </Box>

              {/* Rating distribution */}
              {shopReviews.ratingDistribution && (
                <Box sx={{ mb: 2 }}>
                  {[5, 4, 3, 2, 1].map(star => {
                    const count = shopReviews.ratingDistribution[star] || 0;
                    const total = shopReviews.reviews?.length || 1;
                    const pctVal = (count / total) * 100;
                    return (
                      <Box key={star} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
                        <Typography variant="caption" sx={{ minWidth: 20, fontWeight: 600 }}>{star}★</Typography>
                        <Box sx={{ flex: 1, bgcolor: '#f0f0f0', borderRadius: 3, height: 8, overflow: 'hidden' }}>
                          <Box sx={{ width: `${pctVal}%`, height: 8, borderRadius: 3, bgcolor: star >= 4 ? '#4caf50' : star === 3 ? '#ff9800' : '#f44336' }} />
                        </Box>
                        <Typography variant="caption" sx={{ minWidth: 30 }}>{count}</Typography>
                      </Box>
                    );
                  })}
                </Box>
              )}

              {reviewSentimentLoading && <LinearProgress sx={{ mb: 1, borderRadius: 4, height: 3 }} />}

              {reviewSentiment && (
                <Box>
                  <Alert severity={reviewSentiment.sentiment_score > 70 ? 'success' : reviewSentiment.sentiment_score > 40 ? 'warning' : 'error'}
                    sx={{ mb: 2, borderRadius: '12px' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {reviewSentiment.overall_sentiment} ({t('score')}: {reviewSentiment.sentiment_score}/100)
                    </Typography>
                  </Alert>

                  <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 1.5, mb: 2 }}>
                    <Paper sx={{ ...glassCard, p: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#4caf50', mb: 0.5, display: 'block' }}>
                        <ThumbsUp size={12} />{t('buyersLove')}
                      </Typography>
                      {(reviewSentiment.buyer_loves || []).map((item: string, i: number) => (
                        <Typography key={i} variant="body2" sx={{ fontSize: '0.875rem', mb: 0.3 }}>• {item}</Typography>
                      ))}
                    </Paper>
                    <Paper sx={{ ...glassCard, p: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#f44336', mb: 0.5, display: 'block' }}>
                        <ThumbsDown size={12} />{t('complaints')}
                      </Typography>
                      {(reviewSentiment.buyer_complaints || []).map((item: string, i: number) => (
                        <Typography key={i} variant="body2" sx={{ fontSize: '0.875rem', mb: 0.3 }}>• {item}</Typography>
                      ))}
                    </Paper>
                  </Box>

                  {reviewSentiment.product_insights?.length > 0 && (
                    <Alert severity="info" sx={{ borderRadius: '12px' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('productOpportunities')}</Typography>
                      {reviewSentiment.product_insights.map((item: string, i: number) => (
                        <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem' }}>• {item}</Typography>
                      ))}
                    </Alert>
                  )}
                </Box>
              )}
            </Paper>
          )}
        </Box>
      )}

      {!deepDiveLoading && !deepDiveShop && !discoveredShops.length && !shopsLoading && (
        <PremiumEmptyState icon={<Store size={48} />} title={t('shopAiTitle')}
          desc={t('shopAiDesc')}
          steps={[t('shopAiStep1'), t('shopAiStep2'), t('shopAiStep3')]} />
      )}

      {/* ================================================================ */}
      {/* AI MARKET ANALYSIS                                                */}
      {/* ================================================================ */}
      <Box sx={{ mt: 3 }}>
        <Divider sx={{ mb: 2 }} />
        <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Sparkles size={18} color="#9c27b0" />{t('aiMarketAnalysis')}
        </Typography>
        <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('aiMarketDesc')}
          </Typography>
          <Button variant="contained" onClick={generateAiInsights}
            disabled={aiLoading || items.length === 0} size="large"
            startIcon={aiLoading ? <CircularProgress size={16} /> : <Sparkles size={16} />}
            sx={{
              background: GRADIENTS.purple, borderRadius: '12px', px: 4,
              boxShadow: '0 4px 12px rgba(123,31,162,0.3)',
            }}
          >
            {aiLoading ? t('analyzing') : t('startAiAnalysis')}
          </Button>
          {items.length === 0 && (
            <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
              {t('doSearchFirst')}
            </Typography>
          )}
        </Paper>

        {aiLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

        {aiAnalysis && (
          <>
            <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
              <ScoreRing score={aiAnalysis.opportunity_score} size={140} label={t('opportunity')} />
              <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
                {t('level')}: <strong>{aiAnalysis.opportunity_level}</strong>
              </Typography>
            </Paper>

            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('marketSummary')}</Typography>
              <Typography variant="body2">{aiAnalysis.market_summary}</Typography>
            </Paper>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
              {[
                { title: t('pricingStrategy'), text: aiAnalysis.pricing_strategy, color: '#2196F3', icon: <DollarSign size={16} /> },
                { title: t('nichePositioning'), text: aiAnalysis.niche_positioning, color: '#9c27b0', icon: <Target size={16} /> },
                { title: t('competitionAnalysis'), text: aiAnalysis.competition_analysis, color: '#eb3349', icon: <Users size={16} /> },
                { title: t('seasonalAdvice'), text: aiAnalysis.seasonal_advice, color: '#ff9800', icon: <Calendar size={16} /> },
              ].map(card => (
                <Paper key={card.title} sx={{ ...glassCard, p: 2.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Box sx={{
                      width: 28, height: 28, borderRadius: '8px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', bgcolor: `${card.color}15`,
                    }}>{card.icon}</Box>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, color: card.color }}>{card.title}</Typography>
                  </Box>
                  <Typography variant="body2">{card.text}</Typography>
                </Paper>
              ))}
            </Box>

            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('titleOptimization')}</Typography>
              <Typography variant="body2">{aiAnalysis.title_recommendations}</Typography>
            </Paper>

            {aiAnalysis.tag_recommendations?.length > 0 && (
              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('suggestedTags')}</Typography>
                <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                  {aiAnalysis.tag_recommendations.map((tag: string, i: number) => (
                    <Chip key={i} label={tag} size="small" variant="outlined"
                      onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('copied')); }}
                      sx={{ cursor: 'pointer', borderRadius: '8px', borderColor: '#9c27b0', color: '#9c27b0' }}
                    />
                  ))}
                </Box>
              </Paper>
            )}

            {aiAnalysis.action_items?.length > 0 && (
              <Paper sx={{ ...glassCard, p: 2.5 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#11998e' }}>
                  {t('todoList')}
                </Typography>
                {aiAnalysis.action_items.map((item: string, i: number) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'flex-start' }}>
                    <Box sx={{
                      width: 22, height: 26, borderRadius: '6px', display: 'flex',
                      alignItems: 'center', justifyContent: 'center', background: GRADIENTS.success,
                      flexShrink: 0, mt: 0.2,
                    }}>
                      <Typography variant="caption" sx={{ color: '#fff', fontWeight: 700, fontSize: '0.82rem' }}>{i + 1}</Typography>
                    </Box>
                    <Typography variant="body2">{item}</Typography>
                  </Box>
                ))}
              </Paper>
            )}
          </>
        )}
      </Box>

      {/* ================================================================ */}
      {/* LISTING DETAIL DRAWER                                             */}
      {/* ================================================================ */}
      <Drawer
        anchor={isMobile ? 'bottom' : 'right'}
        open={drawerListingId !== null}
        onClose={() => { setDrawerListingId(null); setDrawerData(null); setDrawerAudit(null); }}
        PaperProps={{ sx: {
          width: isMobile ? '100%' : 520,
          maxHeight: isMobile ? '90vh' : '100vh',
          borderRadius: isMobile ? '16px 16px 0 0' : 0,
        }}}
      >
        <Box sx={{ p: 2.5, overflowY: 'auto' }}>
          {/* Header */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>{t('listingDetails')}</Typography>
            <IconButton size="small" onClick={() => { setDrawerListingId(null); setDrawerData(null); setDrawerAudit(null); }}>
              <Typography sx={{ fontSize: 18, lineHeight: 1 }}>✕</Typography>
            </IconButton>
          </Box>

          {drawerLoading && (
            <Box sx={{ textAlign: 'center', py: 6 }}>
              <CircularProgress size={32} />
            </Box>
          )}

          {drawerData && (
            <>
              {/* Title + actions */}
              <Typography variant="body1" sx={{ fontWeight: 700, mb: 1, lineHeight: 1.4 }}>
                {drawerData.title}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, mb: 2, flexWrap: 'wrap' }}>
                <Button size="small" variant="outlined" startIcon={<Copy size={12} />}
                  onClick={() => { navigator.clipboard.writeText(drawerData.title); toast.success(t('copied')); }}
                  sx={{ borderRadius: '8px', fontSize: '0.85rem' }}>{t('copyTitle')}</Button>
                <Button size="small" variant="outlined" startIcon={<ExternalLink size={12} />}
                  onClick={() => window.open(drawerData.url, '_blank')}
                  sx={{ borderRadius: '8px', fontSize: '0.85rem' }}>{t('viewOnEtsy')}</Button>
              </Box>

              {/* Stats grid */}
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mb: 2 }}>
                <StatCard label={t('priceCol')} value={fmt(drawerData.price)} color="#2196F3" icon={<DollarSign size={14} />} />
                <StatCard label={t('favoriteCol')} value={drawerData.num_favorers?.toLocaleString()} color="#e91e63" icon={<Heart size={14} />} />
                <StatCard label={t('viewsCol')} value={drawerData.views?.toLocaleString()} color="#ff9800" icon={<Eye size={14} />} />
              </Box>

              {/* SEO Score breakdown */}
              {drawerData.seoScore && (
                <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('seoScoreLabel')}</Typography>
                    <Chip label={`${drawerData.seoScore.total}/100`} size="small"
                      sx={{
                        fontWeight: 700,
                        bgcolor: drawerData.seoScore.total >= 70 ? 'rgba(76,175,80,0.1)' : drawerData.seoScore.total >= 40 ? 'rgba(255,152,0,0.1)' : 'rgba(244,67,54,0.1)',
                        color: drawerData.seoScore.total >= 70 ? '#4caf50' : drawerData.seoScore.total >= 40 ? '#ff9800' : '#f44336',
                      }}
                    />
                  </Box>
                  {[
                    { label: t('titleScoreLabel'), score: drawerData.seoScore.title, max: 25 },
                    { label: t('tagScoreLabel'), score: drawerData.seoScore.tags, max: 25 },
                    { label: t('descScoreLabel'), score: drawerData.seoScore.description, max: 25 },
                    { label: t('imageScoreLabel'), score: drawerData.seoScore.images, max: 25 },
                  ].map(item => (
                    <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="caption" sx={{ minWidth: 80 }}>{item.label}</Typography>
                      <Box sx={{ flex: 1, bgcolor: '#f0f0f0', borderRadius: 3, height: 6, overflow: 'hidden' }}>
                        <Box sx={{
                          width: `${(item.score / item.max) * 100}%`, height: 6, borderRadius: 3,
                          bgcolor: item.score >= item.max * 0.8 ? '#4caf50' : item.score >= item.max * 0.5 ? '#ff9800' : '#f44336',
                        }} />
                      </Box>
                      <Typography variant="caption" sx={{ minWidth: 30, textAlign: 'right', fontWeight: 600 }}>{item.score}/{item.max}</Typography>
                    </Box>
                  ))}
                </Paper>
              )}

              {/* Velocity */}
              {drawerData.velocity && (
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, mb: 2 }}>
                  <StatCard label={t('favRate')} value={String(drawerData.velocity.favRate)} color="#e91e63" />
                  <StatCard label={t('estSalesMonth')} value={String(drawerData.velocity.estMonthlySales)} color="#4caf50" />
                  <StatCard label={t('listingAgeMonths')} value={`${drawerData.ageMonths}m`} color="#9e9e9e" icon={<Clock size={14} />} />
                </Box>
              )}

              {/* Tags */}
              {drawerData.tags?.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                      {t('topUsedTags')} ({drawerData.tags.length})
                    </Typography>
                    <Button size="small" variant="outlined" startIcon={<Copy size={12} />}
                      onClick={() => { navigator.clipboard.writeText(drawerData.tags.join(', ')); toast.success(t('tagsCopied')); }}
                      sx={{ borderRadius: '8px', fontSize: '0.85rem' }}>{t('copyTags')}</Button>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {drawerData.tags.map((tag: string) => (
                      <Chip key={tag} label={tag} size="small" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('copied')); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px', fontSize: '0.85rem' }}
                      />
                    ))}
                  </Box>
                </Paper>
              )}

              {/* Description */}
              <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('description')}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem', whiteSpace: 'pre-wrap' }}>
                  {drawerData.description || t('noDescription')}
                </Typography>
              </Paper>

              {/* AI Strategy Analysis */}
              <Divider sx={{ my: 2 }} />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Zap size={16} color="#ff9800" /> {t('aiStrategyAnalysis')}
                </Typography>
                <Button size="small" variant="contained" onClick={analyzeDrawerStrategy}
                  disabled={drawerAuditLoading}
                  startIcon={drawerAuditLoading ? <CircularProgress size={14} /> : <Sparkles size={14} />}
                  sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}>
                  {t('analyzeStrategy')}
                </Button>
              </Box>

              {drawerAuditLoading && (
                <Box sx={{ mb: 2 }}>
                  <LinearProgress sx={{ mb: 0.5, borderRadius: 4, height: 3 }} />
                  <Typography variant="caption" color="text.secondary">{t('strategyLoading')}</Typography>
                </Box>
              )}

              {drawerAudit && (
                <Box>
                  {drawerAudit.overall_assessment && (
                    <Alert severity="info" sx={{ mb: 2, borderRadius: '12px' }}>
                      <Typography variant="body2">{drawerAudit.overall_assessment}</Typography>
                    </Alert>
                  )}

                  {drawerAudit.title_analysis && (
                    <Paper sx={{ ...glassCard, p: 1.5, mb: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#2196F3', mb: 0.5, display: 'block' }}>
                        {t('titleScoreLabel')}
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{drawerAudit.title_analysis}</Typography>
                    </Paper>
                  )}

                  {drawerAudit.tag_analysis && (
                    <Paper sx={{ ...glassCard, p: 1.5, mb: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#9c27b0', mb: 0.5, display: 'block' }}>
                        {t('tagScoreLabel')}
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{drawerAudit.tag_analysis}</Typography>
                    </Paper>
                  )}

                  {drawerAudit.pricing_analysis && (
                    <Paper sx={{ ...glassCard, p: 1.5, mb: 1.5 }}>
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#11998e', mb: 0.5, display: 'block' }}>
                        {t('pricingStrategy')}
                      </Typography>
                      <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>{drawerAudit.pricing_analysis}</Typography>
                    </Paper>
                  )}

                  <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.5, mb: 1.5 }}>
                    {drawerAudit.strengths?.length > 0 && (
                      <Paper sx={{ ...glassCard, p: 1.5 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#4caf50', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                          <ThumbsUp size={12} /> {t('strengths')}
                        </Typography>
                        {drawerAudit.strengths.map((s: string, i: number) => (
                          <Typography key={i} variant="body2" sx={{ fontSize: '0.875rem', mb: 0.3 }}>• {s}</Typography>
                        ))}
                      </Paper>
                    )}
                    {drawerAudit.weaknesses?.length > 0 && (
                      <Paper sx={{ ...glassCard, p: 1.5 }}>
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#f44336', display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
                          <ThumbsDown size={12} /> {t('weaknesses')}
                        </Typography>
                        {drawerAudit.weaknesses.map((s: string, i: number) => (
                          <Typography key={i} variant="body2" sx={{ fontSize: '0.875rem', mb: 0.3 }}>• {s}</Typography>
                        ))}
                      </Paper>
                    )}
                  </Box>

                  {drawerAudit.recommendations?.length > 0 && (
                    <Alert severity="success" sx={{ borderRadius: '12px' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('whatToLearn')}</Typography>
                      {drawerAudit.recommendations.map((r: string, i: number) => (
                        <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem' }}>• {r}</Typography>
                      ))}
                    </Alert>
                  )}
                </Box>
              )}
            </>
          )}
        </Box>
      </Drawer>
    </Box>
  );
}
