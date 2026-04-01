import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Button, TextField, InputAdornment,
  FormControlLabel, Switch, Alert, Tooltip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Chip, IconButton, Autocomplete,
  Avatar, CircularProgress, LinearProgress, Tabs, Tab, useMediaQuery,
  Collapse, Skeleton,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Info, CheckCircle, XCircle, Copy, TrendingUp, Target,
  ShoppingBag, Trash2, Search, Zap, Link, AlertTriangle, Lightbulb,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';

import {
  useEtsyResearchStore,
  useComputedPrices,
  useComputedSeo,
  useComputedKeywords,
} from '@/lib/stores/useEtsyResearchStore';
import type { FeeProfile, ProfitCalc } from './shared/types';
import { fmt, pct } from './shared/utils';
import {
  ScoreRing, glassCard, GRADIENTS, pillTabsSx, PremiumEmptyState, TrendChart,
} from './shared/ui';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
interface ListingSEOProps {
  shopId?: string;
  userListings?: any[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ListingSEO({ shopId, userListings }: ListingSEOProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations('etsy.research');
  const { config, formatDate, formatNumber } = useLocale();
  // ---- sub-tab state (0=Profit, 1=SEO, 2=Rank) ----
  const [tab, setTab] = useState(0);

  // ---- Profit Calculator local state ----
  const [purchaseCost, setPurchaseCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [includeOffsiteAds, setIncludeOffsiteAds] = useState(false);
  const [shopRegion, setShopRegion] = useState<'us' | 'tr'>(config.defaultEtsyFeeRegion);
  const [etsyAdsRoas, setEtsyAdsRoas] = useState('');

  // ---- Store selectors ----
  const myTitle = useEtsyResearchStore(s => s.myTitle);
  const loading = useEtsyResearchStore(s => s.loading);
  const trackedKeywords = useEtsyResearchStore(s => s.trackedKeywords);
  const rankLoading = useEtsyResearchStore(s => s.rankLoading);
  const rankKeywordInput = useEtsyResearchStore(s => s.rankKeywordInput);
  const rankListingId = useEtsyResearchStore(s => s.rankListingId);
  const rankAddLoading = useEtsyResearchStore(s => s.rankAddLoading);
  const expandedRankId = useEtsyResearchStore(s => s.expandedRankId);
  const rankHistory = useEtsyResearchStore(s => s.rankHistory);

  // ---- Listing Analyzer ----
  const [analyzeInput, setAnalyzeInput] = useState('');
  const listingAnalysis = useEtsyResearchStore(s => s.listingAnalysis);
  const listingAnalysisLoading = useEtsyResearchStore(s => s.listingAnalysisLoading);
  const listingAudit = useEtsyResearchStore(s => s.listingAudit);
  const listingAuditLoading = useEtsyResearchStore(s => s.listingAuditLoading);
  const fetchListingAnalysis = useEtsyResearchStore(s => s.fetchListingAnalysis);
  const fetchListingAudit = useEtsyResearchStore(s => s.fetchListingAudit);

  const extractListingId = (input: string) => {
    const match = input.match(/listing\/(\d+)/);
    return match ? match[1] : input.replace(/\D/g, '');
  };

  const fetchTrackedKeywords = useEtsyResearchStore(s => s.fetchTrackedKeywords);
  const addTrackedKeyword = useEtsyResearchStore(s => s.addTrackedKeyword);
  const removeTrackedKeyword = useEtsyResearchStore(s => s.removeTrackedKeyword);
  const discoveryData = useEtsyResearchStore(s => s.discoveryData);
  const discoveryLoading = useEtsyResearchStore(s => s.discoveryLoading);
  const fetchRankHistory = useEtsyResearchStore(s => s.fetchRankHistory);
  const setRankKeywordInput = useEtsyResearchStore(s => s.setRankKeywordInput);
  const setRankListingId = useEtsyResearchStore(s => s.setRankListingId);
  const setExpandedRankId = useEtsyResearchStore(s => s.setExpandedRankId);

  // ---- Computed hooks ----
  const { priceStats } = useComputedPrices();
  const seoResult = useComputedSeo(userListings);
  const { enrichedKeywords } = useComputedKeywords();

  // ---- Fee profiles ----
  const FEE_PROFILES: Record<'us' | 'tr', FeeProfile> = useMemo(() => ({
    us: {
      label: t('usShop'),
      currency: '$',
      listingFee: 0.20,
      transactionRate: 0.065,
      paymentProcessingRate: 0.03,
      paymentProcessingFixed: 0.25,
      offsiteAdsRate: 0.15,
      regulatoryFee: 0,
      vatRate: 0,
      notes: t('etsyFeeNotesUS'),
    },
    tr: {
      label: t('turkeyShop'),
      currency: '$',
      listingFee: 0.20,
      transactionRate: 0.065,
      paymentProcessingRate: 0.065,
      paymentProcessingFixed: 0.17,
      offsiteAdsRate: 0.15,
      regulatoryFee: 0.0227,
      vatRate: 0,
      notes: t('etsyFeeNotesTR'),
    },
  }), [t]);

  // ---- Profit calculation ----
  const profitCalc: ProfitCalc = useMemo(() => {
    const fees = FEE_PROFILES[shopRegion];
    const cost = parseFloat(purchaseCost) || 0;
    const sell = parseFloat(sellingPrice) || (priceStats?.avg || 0);
    const ship = parseFloat(shippingCost) || 0;
    const roas = parseFloat(etsyAdsRoas) || 0;
    const listingFee = fees.listingFee;
    const transactionFee = sell * fees.transactionRate;
    const paymentProcessing = sell * fees.paymentProcessingRate + fees.paymentProcessingFixed;
    const regulatoryFee = sell * fees.regulatoryFee;
    const offsiteAdsFee = includeOffsiteAds ? sell * fees.offsiteAdsRate : 0;
    const etsyAdsCost = roas > 0 ? sell / roas : 0;
    const totalFees = listingFee + transactionFee + paymentProcessing + regulatoryFee + offsiteAdsFee;
    const profit = sell - cost - ship - totalFees - etsyAdsCost;
    const margin = sell > 0 ? (profit / sell) * 100 : 0;
    const compare = [-20, 0, 20].map(delta => {
      const p = sell * (1 + delta / 100);
      const tf = p * fees.transactionRate;
      const pp = p * fees.paymentProcessingRate + fees.paymentProcessingFixed;
      const rf = p * fees.regulatoryFee;
      const oa = includeOffsiteAds ? p * fees.offsiteAdsRate : 0;
      const adCost = roas > 0 ? p / roas : 0;
      const pr = p - cost - ship - fees.listingFee - tf - pp - rf - oa - adCost;
      return {
        label: delta === 0 ? t('average') : delta < 0 ? `${delta}%` : `+${delta}%`,
        price: p, profit: pr, margin: p > 0 ? (pr / p) * 100 : 0,
      };
    });
    return { cost, sell, ship, listingFee, transactionFee, paymentProcessing, regulatoryFee, offsiteAdsFee, etsyAdsCost, roas, totalFees, profit, margin, compare, fees };
  }, [purchaseCost, sellingPrice, shippingCost, priceStats, includeOffsiteAds, shopRegion, FEE_PROFILES, etsyAdsRoas]);

  // =========================================================================
  // RENDER
  // =========================================================================
  return (
    <Box>
      {/* Listing Analyzer */}
      <Paper sx={{ ...glassCard, p: 2.5, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Link size={16} color="#667eea" /> {t('listingAnalysisTool')}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          {t('listingAnalysisDesc')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <TextField
            value={analyzeInput} onChange={e => setAnalyzeInput(e.target.value)}
            size="small" sx={{ flex: 1, minWidth: isMobile ? '100%' : 'auto' }}
            placeholder={t('urlPlaceholder')}
            onKeyDown={e => e.key === 'Enter' && fetchListingAnalysis(extractListingId(analyzeInput))}
          />
          <Button variant="contained" onClick={() => fetchListingAnalysis(extractListingId(analyzeInput))}
            disabled={listingAnalysisLoading || !analyzeInput.trim()}
            startIcon={listingAnalysisLoading ? <CircularProgress size={14} /> : <Search size={14} />}
            sx={{ background: GRADIENTS.primary, borderRadius: '10px', ...(isMobile && { width: '100%' }) }}>
            {t('analyzeButton')}
          </Button>
        </Box>
      </Paper>

      {listingAnalysisLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

      {listingAnalysis && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 3 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>
            {listingAnalysis.listing?.title || 'Listing'}
          </Typography>

          {/* SEO Score breakdown */}
          {listingAnalysis.seoScore && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1.5, flexDirection: isMobile ? 'column' : 'row' }}>
                <ScoreRing score={listingAnalysis.seoScore.total} size={isMobile ? 70 : 80} label="SEO" />
                <Box sx={{ flex: 1 }}>
                  {[
                    { label: t('title'), value: listingAnalysis.seoScore.title, max: 25 },
                    { label: t('tags'), value: listingAnalysis.seoScore.tags, max: 25 },
                    { label: t('description'), value: listingAnalysis.seoScore.description, max: 25 },
                    { label: t('images'), value: listingAnalysis.seoScore.images, max: 25 },
                  ].map(s => (
                    <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Typography variant="caption" sx={{ minWidth: 70, fontWeight: 600 }}>{s.label}</Typography>
                      <Box sx={{ flex: 1, bgcolor: '#f0f0f0', borderRadius: 3, height: 6, overflow: 'hidden' }}>
                        <Box sx={{ width: `${(s.value / s.max) * 100}%`, height: 6, borderRadius: 3,
                          bgcolor: s.value / s.max > 0.7 ? '#4caf50' : s.value / s.max > 0.4 ? '#ff9800' : '#f44336' }} />
                      </Box>
                      <Typography variant="caption" sx={{ minWidth: 35, fontWeight: 700 }}>{s.value}/{s.max}</Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Box>
          )}

          {/* Velocity estimate */}
          {listingAnalysis.velocity && (
            <Alert severity="info" sx={{ mb: 2, borderRadius: '12px' }}>
              <Typography variant="body2">
                {t('estMonthlySales')}: <strong>{listingAnalysis.velocity.estMonthlySales?.toFixed(1)}</strong> |
                {t('age')}: <strong>{listingAnalysis.velocity.ageMonths?.toFixed(0)} {t('ageMonths')}</strong> |
                {t('favorite')}: <strong>{formatNumber(listingAnalysis.listing?.num_favorers ?? 0)}</strong>
              </Typography>
            </Alert>
          )}

          {/* Tags display */}
          {listingAnalysis.listing?.tags?.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                {t('tagsCount', { count: listingAnalysis.listing.tags.length })}
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {listingAnalysis.listing.tags.map((tag: string, i: number) => (
                  <Chip key={i} label={tag} size="small" variant="outlined"
                    onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('copied')); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }} />
                ))}
              </Box>
            </Box>
          )}

          {/* AI Audit button */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="contained" size="small" onClick={fetchListingAudit}
              disabled={listingAuditLoading}
              startIcon={listingAuditLoading ? <CircularProgress size={14} /> : <Zap size={14} />}
              sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}>
              {listingAudit ? t('reAudit') : t('aiAudit')}
            </Button>
          </Box>

          {listingAuditLoading && <LinearProgress sx={{ mt: 1, borderRadius: 4, height: 3 }} />}

          {listingAudit && (
            <Box sx={{ mt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                <Typography variant="h3" sx={{ fontWeight: 900,
                  color: (listingAudit.overall_score ?? 0) >= 70 ? '#4caf50' : (listingAudit.overall_score ?? 0) >= 50 ? '#2196F3' : '#ff9800' }}>
                  {listingAudit.overall_score}
                </Typography>
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('overallScore')}: {listingAudit.overall_score}/100</Typography>
                </Box>
              </Box>

              {/* Per-category scores */}
              {[
                { label: t('title'), score: listingAudit.title_score, feedback: listingAudit.title_feedback },
                { label: t('tags'), score: listingAudit.tags_score, feedback: listingAudit.tags_feedback },
                { label: t('description'), score: listingAudit.description_score, feedback: listingAudit.description_feedback },
                { label: t('price'), score: listingAudit.pricing_score, feedback: listingAudit.pricing_feedback },
                { label: t('images'), score: listingAudit.image_score, feedback: listingAudit.image_feedback },
              ].map(cat => (
                <Box key={cat.label} sx={{ mb: 1.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.3 }}>
                    {cat.score >= 70 ? <CheckCircle size={14} color="#4caf50" /> : cat.score >= 40 ? <AlertTriangle size={14} color="#ff9800" /> : <XCircle size={14} color="#f44336" />}
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{cat.label}: {cat.score}/100</Typography>
                  </Box>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', ml: 2.5 }}>{cat.feedback}</Typography>
                </Box>
              ))}

              {/* Quick wins */}
              {listingAudit.quick_wins?.length > 0 && (
                <Alert severity="success" sx={{ mt: 2, borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('quickWins')}</Typography>
                  {listingAudit.quick_wins.map((item: string, i: number) => (
                    <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem' }}>• {item}</Typography>
                  ))}
                </Alert>
              )}

              {/* Suggested tags */}
              {listingAudit.suggested_tags?.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('suggestedTags')}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {listingAudit.suggested_tags.map((tag: string, i: number) => (
                      <Chip key={i} label={tag} size="small" color="primary" variant="outlined"
                        onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('copied')); }}
                        sx={{ cursor: 'pointer', borderRadius: '8px' }} />
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          )}
        </Paper>
      )}

      {/* Sub-tab pills */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={pillTabsSx} variant="scrollable" scrollButtons="auto">
        <Tab label={t('profitCalculator')} />
        <Tab label={t('seoComparison')} />
        <Tab label={t('rankTracking')} />
      </Tabs>

      {/* ================================================================ */}
      {/* TAB 0: PROFIT CALCULATOR                                         */}
      {/* ================================================================ */}
      {tab === 0 && (
        <Box>
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('etsyProfitCalculator')}
              </Typography>
              {/* Region selector */}
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                <Button
                  size="small"
                  variant={shopRegion === 'tr' ? 'contained' : 'outlined'}
                  onClick={() => setShopRegion('tr')}
                  sx={{
                    borderRadius: '10px', textTransform: 'none', fontSize: '0.75rem', px: 2,
                    ...(shopRegion === 'tr' ? { background: GRADIENTS.primary } : {}),
                  }}
                >
                  {t('turkeyShop')}
                </Button>
                <Button
                  size="small"
                  variant={shopRegion === 'us' ? 'contained' : 'outlined'}
                  onClick={() => setShopRegion('us')}
                  sx={{
                    borderRadius: '10px', textTransform: 'none', fontSize: '0.75rem', px: 2,
                    ...(shopRegion === 'us' ? { background: GRADIENTS.primary } : {}),
                  }}
                >
                  {t('usShop')}
                </Button>
              </Box>
            </Box>
            <Alert severity="info" sx={{ mb: 2, borderRadius: '10px', py: 0.5 }}>
              <Typography variant="caption">{profitCalc.fees.notes}</Typography>
            </Alert>
            <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: isMobile ? 1.5 : 2, mb: 2 }}>
              <TextField label={t('purchaseCost')} value={purchaseCost}
                onChange={e => setPurchaseCost(e.target.value)}
                size="small" type="number" fullWidth
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
              <TextField label={t('sellingPrice')} value={sellingPrice || (priceStats?.avg.toFixed(2) || '')}
                onChange={e => setSellingPrice(e.target.value)}
                size="small" type="number" fullWidth
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
                helperText={priceStats ? `${t('marketAverage')}: ${fmt(priceStats.avg)}` : t('enterPrice')}
              />
              <TextField label={t('shippingCost')} value={shippingCost}
                onChange={e => setShippingCost(e.target.value)}
                size="small" type="number" fullWidth
                InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              />
            </Box>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1 }}>
              <TextField label={t('etsyAdsRoas')} value={etsyAdsRoas}
                onChange={e => setEtsyAdsRoas(e.target.value)}
                size="small" type="number" sx={{ flex: 1, minWidth: 140 }}
                placeholder={t('roasExample')}
                helperText={etsyAdsRoas && parseFloat(etsyAdsRoas) > 0
                  ? t('roasHintWithValue', { roas: etsyAdsRoas, cost: fmt(profitCalc.etsyAdsCost) })
                  : t('roasHint')
                }
              />
            </Box>
            <FormControlLabel
              control={<Switch checked={includeOffsiteAds} onChange={e => setIncludeOffsiteAds(e.target.checked)} size="small" />}
              label={<Typography variant="body2">{t('offsiteAdsSwitch')}</Typography>}
            />
          </Paper>

          <Paper sx={{ ...glassCard, overflow: 'hidden', mb: 2 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                {t('feeDetails')} ({shopRegion === 'tr' ? t('turkeyLabel') : t('usLabel')} {t('feeDetailsSuffix')})
              </Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableBody>
                  <TableRow>
                    <TableCell>{t('salePrice')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 700 }}>{fmt(profitCalc.sell)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {t('listingFee')} <Tooltip title={t('listingFeeTooltip')}><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.listingFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {t('transactionCommission')} <Tooltip title={t('transactionCommissionTooltip')}><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.transactionFee)}</TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        {t('paymentProcessing')} ({shopRegion === 'tr' ? '%6.5 + 3₺' : '%3 + $0.25'})
                        <Tooltip title={shopRegion === 'tr'
                          ? t('paymentProcessingTR')
                          : t('paymentProcessingUS')
                        }><Info size={14} color="#999" /></Tooltip>
                      </Box>
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.paymentProcessing)}</TableCell>
                  </TableRow>
                  {shopRegion === 'tr' && profitCalc.regulatoryFee > 0 && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {t('regulatoryFee')}
                          <Tooltip title={t('regulatoryFeeTooltip')}><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.regulatoryFee)}</TableCell>
                    </TableRow>
                  )}
                  {includeOffsiteAds && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {t('offsiteAdsLabel')}
                          <Tooltip title={t('offsiteAdsTooltip')}><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.offsiteAdsFee)}</TableCell>
                    </TableRow>
                  )}
                  {profitCalc.roas > 0 && (
                    <TableRow>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                          {t('etsyAdsCost')} (ROAS: {profitCalc.roas}x)
                          <Tooltip title={t('etsyAdsCostTooltip', { roas: String(profitCalc.roas), sell: fmt(profitCalc.sell), cost: fmt(profitCalc.etsyAdsCost) })}><Info size={14} color="#999" /></Tooltip>
                        </Box>
                      </TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.etsyAdsCost)}</TableCell>
                    </TableRow>
                  )}
                  <TableRow><TableCell>{t('purchaseCostRow')}</TableCell><TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.cost)}</TableCell></TableRow>
                  <TableRow><TableCell>{t('shippingCostRow')}</TableCell><TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(profitCalc.ship)}</TableCell></TableRow>
                  <TableRow sx={{
                    background: profitCalc.profit >= 0
                      ? 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)'
                      : 'linear-gradient(135deg, rgba(235,51,73,0.08) 0%, rgba(244,92,67,0.08) 100%)',
                  }}>
                    <TableCell sx={{ fontWeight: 800 }}>{t('netProfit')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: profitCalc.profit >= 0 ? '#11998e' : '#eb3349' }}>
                      {fmt(profitCalc.profit)}
                    </TableCell>
                  </TableRow>
                  <TableRow sx={{
                    background: profitCalc.profit >= 0
                      ? 'linear-gradient(135deg, rgba(17,153,142,0.08) 0%, rgba(56,239,125,0.08) 100%)'
                      : 'linear-gradient(135deg, rgba(235,51,73,0.08) 0%, rgba(244,92,67,0.08) 100%)',
                  }}>
                    <TableCell sx={{ fontWeight: 800 }}>{t('profitMargin')}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 800, color: profitCalc.profit >= 0 ? '#11998e' : '#eb3349' }}>
                      {pct(profitCalc.margin)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('differentPricePoints')}</Typography>
            </Box>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                    <TableCell>{t('scenario')}</TableCell>
                    <TableCell align="right">{t('priceColumn')}</TableCell>
                    <TableCell align="right">{t('profitColumn')}</TableCell>
                    <TableCell align="right">{t('marginColumn')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {profitCalc.compare.map(c => (
                    <TableRow key={c.label} hover sx={{ '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}>
                      <TableCell sx={{ fontWeight: 600 }}>{c.label}</TableCell>
                      <TableCell align="right">{fmt(c.price)}</TableCell>
                      <TableCell align="right" sx={{ color: c.profit >= 0 ? '#11998e' : '#eb3349', fontWeight: 700 }}>
                        {fmt(c.profit)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: c.margin >= 0 ? '#11998e' : '#eb3349' }}>
                        {pct(c.margin)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 1: SEO COMPARISON                                            */}
      {/* ================================================================ */}
      {tab === 1 && (
        <Box>
          {seoResult ? (
            <>
              <Paper sx={{ ...glassCard, p: isMobile ? 2 : 3, mb: 2, textAlign: 'center' }}>
                <ScoreRing score={seoResult.score} size={isMobile ? 100 : 140} label="SEO" />
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                  {t('keywordCoverage')} ({seoResult.coveredKw}/{seoResult.totalKw}) + {t('tagCoverage')} ({seoResult.coveredTags}/{seoResult.totalTags}) {t('coverage')}
                </Typography>
              </Paper>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('scoreDetails')}</Typography>
                {[
                  { label: t('keywordCoverageLabel'), score: seoResult.kwScore, max: 30 },
                  { label: t('tagCoverageLabel'), score: seoResult.tagScore, max: 30 },
                  { label: t('titleLength'), score: seoResult.lengthScore, max: 20 },
                  { label: t('tagCount'), score: seoResult.hasTagsScore, max: 20 },
                ].map(b => (
                  <Box key={b.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="body2" sx={{ minWidth: 120, fontWeight: 500 }}>{b.label}</Typography>
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ width: '100%', bgcolor: '#f0f0f0', borderRadius: 4, height: 8, overflow: 'hidden' }}>
                        <Box sx={{
                          width: `${(b.score / b.max) * 100}%`, height: 8, borderRadius: 4,
                          background: b.score / b.max >= 0.7 ? GRADIENTS.success : b.score / b.max >= 0.4 ? GRADIENTS.warning : GRADIENTS.danger,
                        }} />
                      </Box>
                    </Box>
                    <Typography variant="caption" sx={{ minWidth: 40, fontWeight: 600 }}>{b.score}/{b.max}</Typography>
                  </Box>
                ))}
              </Paper>

              <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('titleLength')}</Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">{t('mine')}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{myTitle.length} {t('chars')}</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">{t('competitorAvg')}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>{seoResult.avgLen} {t('chars')}</Typography>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 120, borderRadius: '12px' }}>
                    <Typography variant="caption" color="text.secondary">{t('optimal')}</Typography>
                    <Typography variant="h6" sx={{ fontWeight: 800, color: '#11998e' }}>100-140</Typography>
                  </Paper>
                </Box>
              </Paper>

              {seoResult.recommendations.length > 0 && (
                <Alert severity={seoResult.score >= 70 ? 'success' : 'warning'} sx={{ mb: 2, borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>{t('recommendations')}</Typography>
                  {seoResult.recommendations.map((rec, i) => (
                    <Typography key={i} variant="body2">• {rec}</Typography>
                  ))}
                </Alert>
              )}

              {enrichedKeywords.length > 0 && (
                <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
                  <TableContainer sx={{ maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow sx={{ '& .MuiTableCell-head': { bgcolor: '#fafbfe', fontWeight: 700 } }}>
                          <TableCell>{t('keywordColumn')}</TableCell>
                          <TableCell align="center">{t('usagePct')}</TableCell>
                          <TableCell align="center">{t('inMyTitle')}</TableCell>
                          <TableCell align="center">{t('copyColumn')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {enrichedKeywords.slice(0, 20).map(kw => (
                          <TableRow key={kw.keyword} sx={{
                            bgcolor: kw.inMyTitle ? 'rgba(17,153,142,0.06)' : 'transparent',
                            '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' },
                          }}>
                            <TableCell><Typography variant="body2" sx={{ fontWeight: kw.inMyTitle ? 700 : 400 }}>{kw.keyword}</Typography></TableCell>
                            <TableCell align="center">
                              <Chip label={`%${kw.pct}`} size="small" sx={{
                                fontWeight: 600, borderRadius: '6px',
                                bgcolor: kw.pct >= 50 ? '#ffebee' : kw.pct >= 25 ? '#fff3e0' : '#fafafa',
                                color: kw.pct >= 50 ? '#c62828' : kw.pct >= 25 ? '#e65100' : '#999',
                              }} />
                            </TableCell>
                            <TableCell align="center">
                              {kw.inMyTitle ? <CheckCircle size={18} color="#11998e" /> : <XCircle size={18} color="#ddd" />}
                            </TableCell>
                            <TableCell align="center">
                              {!kw.inMyTitle && (
                                <IconButton size="small" onClick={() => {
                                  navigator.clipboard.writeText(kw.keyword); toast.success(t('keywordCopied', { keyword: kw.keyword }));
                                }}><Copy size={14} /></IconButton>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </Paper>
              )}
            </>
          ) : !loading && (
            <>
              {/* SEO seasonal tips from discovery */}
              {discoveryLoading && (
                <Box sx={{ mb: 2 }}>
                  <Skeleton variant="text" width={200} height={28} sx={{ mb: 1 }} />
                  {[1, 2, 3].map(i => (
                    <Skeleton key={i} variant="text" width="80%" height={20} sx={{ mb: 0.5 }} />
                  ))}
                </Box>
              )}

              {discoveryData?.seasonalTips?.length > 0 && (
                <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Lightbulb size={16} color="#ff9800" /> {t('seoSeasonalTips')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    {t('seoSeasonalTipsDesc')}
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                    {discoveryData.seasonalTips.map((tip: string, i: number) => (
                      <Typography key={i} variant="body2" sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                        <Box component="span" sx={{ color: '#ff9800', fontWeight: 700, mt: '2px' }}>•</Box>
                        {tip}
                      </Typography>
                    ))}
                  </Box>
                </Paper>
              )}

              <PremiumEmptyState
                icon={<TrendingUp size={48} />}
                title={t('seoComparison')}
                desc={userListings?.length
                  ? t('seoEmptyWithListings')
                  : t('seoEmptyNoListings')
                }
                steps={userListings?.length
                  ? [
                      t('seoStep1WithListings'),
                      t('seoStep2WithListings'),
                      t('seoStep3WithListings'),
                    ]
                  : [
                      t('seoStep1NoListings'),
                      t('seoStep2NoListings'),
                      t('seoStep3NoListings'),
                      t('seoStep4NoListings'),
                    ]
                }
              />
            </>
          )}
        </Box>
      )}

      {/* ================================================================ */}
      {/* TAB 2: RANK TRACKER                                              */}
      {/* ================================================================ */}
      {tab === 2 && (
        <Box>
          {/* Add keyword form */}
          <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
              <Target size={16} color="#667eea" /> {t('addKeywordToTrack')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <Autocomplete
                options={userListings || []}
                getOptionLabel={(opt: any) => opt.title || `Listing #${opt.listing_id || opt.id}`}
                value={userListings?.find((l: any) => (l.listing_id || l.id) === rankListingId) || null}
                onChange={(_, val: any) => setRankListingId(val ? (val.listing_id || val.id) : null)}
                renderOption={(props, opt: any) => (
                  <li {...props} key={opt.listing_id || opt.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Avatar
                        src={opt.thumbnail?.url_75x75 || ''}
                        variant="rounded"
                        sx={{ width: 32, height: 32, bgcolor: '#f5f5f5' }}
                      >
                        <ShoppingBag size={14} />
                      </Avatar>
                      <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: isMobile ? 180 : 300 }}>
                        {opt.title || `#${opt.listing_id || opt.id}`}
                      </Typography>
                    </Box>
                  </li>
                )}
                renderInput={(params) => (
                  <TextField {...params} size="small" label={t('selectListing')} placeholder={t('searchListing')} />
                )}
                isOptionEqualToValue={(opt: any, val: any) => (opt.listing_id || opt.id) === (val.listing_id || val.id)}
                sx={{ flex: 2, minWidth: isMobile ? '100%' : 200 }}
              />
              <TextField
                size="small"
                label={t('keywordLabel')}
                placeholder="baby blanket, crochet dress..."
                value={rankKeywordInput}
                onChange={(e) => setRankKeywordInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && shopId) addTrackedKeyword(shopId, userListings); }}
                sx={{ flex: 1, minWidth: 150 }}
              />
              <Button
                variant="contained"
                onClick={() => shopId && addTrackedKeyword(shopId, userListings)}
                disabled={rankAddLoading || !rankKeywordInput.trim() || !rankListingId}
                startIcon={rankAddLoading ? <CircularProgress size={14} /> : <Target size={14} />}
                sx={{
                  background: GRADIENTS.primary, borderRadius: '10px', textTransform: 'none',
                  fontWeight: 600, whiteSpace: 'nowrap',
                  ...(isMobile && { width: '100%' }),
                }}
              >
                {t('trackButton')}
              </Button>
            </Box>
          </Paper>

          {/* Tracked keywords table */}
          {rankLoading ? (
            <Box sx={{ textAlign: 'center', py: 4 }}><CircularProgress size={32} /></Box>
          ) : trackedKeywords.length === 0 ? (
            <PremiumEmptyState
              icon={<Target size={64} />}
              title={t('rankTracking')}
              desc={t('rankTrackingDesc')}
              steps={[
                t('rankStep1'),
                t('rankStep2'),
                t('rankStep3'),
                t('rankStep4'),
              ]}
            />
          ) : (
            <Paper sx={{ ...glassCard, overflow: 'hidden' }}>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: 'rgba(102,126,234,0.06)' }}>
                      <TableCell sx={{ fontWeight: 700 }}>{t('keywordColumn')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>{t('listingColumn')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('rankColumn')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('pageColumn')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('changeColumn')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">{t('lastCheckColumn')}</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center" />
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {trackedKeywords.map((kw) => {
                      const rankColor = kw.rank == null ? '#eb3349'
                        : kw.rank <= 10 ? '#11998e'
                        : kw.rank <= 48 ? '#F2994A'
                        : kw.rank <= 96 ? '#e67e22'
                        : '#eb3349';
                      const changeIcon = kw.change == null ? ''
                        : kw.change > 0 ? `↑${kw.change}`
                        : kw.change < 0 ? `↓${Math.abs(kw.change)}`
                        : '—';
                      const changeColor = kw.change > 0 ? '#11998e' : kw.change < 0 ? '#eb3349' : '#999';

                      return (
                        <React.Fragment key={kw.id}>
                          <TableRow
                            hover
                            onClick={() => shopId && fetchRankHistory(kw.id, shopId)}
                            sx={{ cursor: 'pointer', '&:hover': { bgcolor: 'rgba(102,126,234,0.04)' } }}
                          >
                            <TableCell>
                              <Chip label={kw.keyword} size="small" sx={{ fontWeight: 600 }} />
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption" sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                                {kw.listingTitle || `#${kw.etsyListingId}`}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Chip
                                label={kw.rank != null ? `#${kw.rank}` : t('notFound')}
                                size="small"
                                sx={{
                                  bgcolor: rankColor, color: '#fff', fontWeight: 700,
                                  fontSize: '0.75rem', minWidth: 48,
                                }}
                              />
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" fontWeight={600}>
                                {kw.page != null ? kw.page : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="body2" sx={{ color: changeColor, fontWeight: 700 }}>
                                {changeIcon || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <Typography variant="caption" color="text.secondary">
                                {kw.checkedAt ? formatDate(new Date(kw.checkedAt), { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                              </Typography>
                            </TableCell>
                            <TableCell align="center">
                              <IconButton size="small" onClick={(e) => { e.stopPropagation(); if (shopId) removeTrackedKeyword(kw.id, shopId); }}>
                                <Trash2 size={14} color="#e53935" />
                              </IconButton>
                            </TableCell>
                          </TableRow>
                          {/* Expanded rank history */}
                          {expandedRankId === kw.id && (
                            <TableRow>
                              <TableCell colSpan={7} sx={{ bgcolor: 'rgba(102,126,234,0.03)', py: 2 }}>
                                {rankHistory.length > 1 ? (
                                  <Box>
                                    <Typography variant="caption" fontWeight={700} sx={{ mb: 1, display: 'block' }}>
                                      {t('rankHistory30Days')}
                                    </Typography>
                                    <Box sx={{ height: 120 }}>
                                      <TrendChart
                                        data={rankHistory.map((s: any) => ({
                                          date: formatDate(new Date(s.checkedAt), { day: '2-digit', month: '2-digit' }),
                                          value: s.rank != null ? Math.max(1, 500 - s.rank) : 0,
                                        }))}
                                        height={120}
                                        color={rankColor}
                                      />
                                    </Box>
                                    <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                                      {rankHistory.slice(-5).reverse().map((s: any, i: number) => (
                                        <Chip
                                          key={i}
                                          size="small"
                                          variant="outlined"
                                          label={`${formatDate(new Date(s.checkedAt), { day: '2-digit', month: '2-digit' })}: ${s.rank != null ? `#${s.rank}` : t('rankNotAvailable')}`}
                                          sx={{ fontSize: '0.7rem' }}
                                        />
                                      ))}
                                    </Box>
                                  </Box>
                                ) : (
                                  <Typography variant="caption" color="text.secondary">
                                    {t('rankNotEnoughData')}
                                  </Typography>
                                )}
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}

          {/* Rank legend */}
          <Box sx={{ display: 'flex', gap: 1.5, mt: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
            {[
              { label: t('rankLegendPage1'), color: '#11998e' },
              { label: t('rankLegendPage2'), color: '#e67e22' },
              { label: t('rankLegend96Plus'), color: '#eb3349' },
            ].map((item) => (
              <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: item.color }} />
                <Typography variant="caption" color="text.secondary">{item.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}
