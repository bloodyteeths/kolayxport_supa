import React, { useState, useMemo } from 'react';
import {
  Box, Typography, Paper, Button, TextField, InputAdornment,
  FormControlLabel, Switch, Alert, Chip, IconButton,
  CircularProgress, LinearProgress, Tabs, Tab, useMediaQuery,
  Tooltip,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  CheckCircle, XCircle, Copy, TrendingUp, Target,
  Search, Zap, Link, AlertTriangle, Lightbulb, Sparkles,
  RefreshCw,
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
import { fmt } from './shared/utils';
import {
  ScoreRing, glassCard, GRADIENTS, pillTabsSx, PremiumEmptyState, BeforeAfter,
} from './shared/ui';

export default function ListingGrader({ shopId, userListings }: { shopId?: string; userListings?: any[] }) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const t = useTranslations('etsy.research');
  const tGrader = useTranslations('etsyResearch');
  const { config, formatNumber } = useLocale();

  const [analyzeInput, setAnalyzeInput] = useState('');
  const [tab, setTab] = useState(0);

  // AI one-click fix state
  const [fixLoading, setFixLoading] = useState<string | null>(null);
  const [fixedTitle, setFixedTitle] = useState<string | null>(null);
  const [fixedTags, setFixedTags] = useState<string[] | null>(null);
  const [fixedDescription, setFixedDescription] = useState<string | null>(null);

  // Profit Calculator
  const [purchaseCost, setPurchaseCost] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [includeOffsiteAds, setIncludeOffsiteAds] = useState(false);
  const [shopRegion, setShopRegion] = useState<'us' | 'tr'>(config.defaultEtsyFeeRegion);
  const [etsyAdsRoas, setEtsyAdsRoas] = useState('');

  // Store
  const listingAnalysis = useEtsyResearchStore(s => s.listingAnalysis);
  const listingAnalysisLoading = useEtsyResearchStore(s => s.listingAnalysisLoading);
  const listingAudit = useEtsyResearchStore(s => s.listingAudit);
  const listingAuditLoading = useEtsyResearchStore(s => s.listingAuditLoading);
  const fetchListingAnalysis = useEtsyResearchStore(s => s.fetchListingAnalysis);
  const fetchListingAudit = useEtsyResearchStore(s => s.fetchListingAudit);
  const trackedKeywords = useEtsyResearchStore(s => s.trackedKeywords);
  const rankLoading = useEtsyResearchStore(s => s.rankLoading);
  const rankKeywordInput = useEtsyResearchStore(s => s.rankKeywordInput);
  const rankListingId = useEtsyResearchStore(s => s.rankListingId);
  const rankAddLoading = useEtsyResearchStore(s => s.rankAddLoading);
  const expandedRankId = useEtsyResearchStore(s => s.expandedRankId);
  const rankHistory = useEtsyResearchStore(s => s.rankHistory);
  const fetchTrackedKeywords = useEtsyResearchStore(s => s.fetchTrackedKeywords);
  const addTrackedKeyword = useEtsyResearchStore(s => s.addTrackedKeyword);
  const removeTrackedKeyword = useEtsyResearchStore(s => s.removeTrackedKeyword);
  const fetchRankHistory = useEtsyResearchStore(s => s.fetchRankHistory);
  const setRankKeywordInput = useEtsyResearchStore(s => s.setRankKeywordInput);
  const setRankListingId = useEtsyResearchStore(s => s.setRankListingId);
  const setExpandedRankId = useEtsyResearchStore(s => s.setExpandedRankId);
  const optimizeField = useEtsyResearchStore(s => s.optimizeField);
  const items = useEtsyResearchStore(s => s.items);

  const { priceStats } = useComputedPrices();
  const seoResult = useComputedSeo(userListings);

  const extractListingId = (input: string) => {
    const match = input.match(/listing\/(\d+)/);
    return match ? match[1] : input.replace(/\D/g, '');
  };

  // Auto-trigger AI audit after analysis loads
  const handleAnalyze = async () => {
    const id = extractListingId(analyzeInput);
    if (!id) return;
    await fetchListingAnalysis(id);
    // Auto-trigger audit
    fetchListingAudit();
  };

  // One-click fix handlers
  const handleFixTitle = async () => {
    if (!listingAnalysis?.listing) return;
    setFixLoading('title');
    try {
      const market_context = items.length > 0 ? {
        avgPrice: priceStats?.avg,
        totalResults: items.length,
        topTags: listingAnalysis.listing.tags?.slice(0, 5),
      } : undefined;

      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'optimize_title',
          title: listingAnalysis.listing.title,
          tags: listingAnalysis.listing.tags || [],
          market_context,
        }),
      });
      const data = await res.json();
      if (data.optimized_title) {
        setFixedTitle(data.optimized_title);
        toast.success(tGrader('lg_titleFixed'));
      }
    } catch (err) {
      toast.error(tGrader('lg_fixError'));
    } finally {
      setFixLoading(null);
    }
  };

  const handleFixTags = async () => {
    if (!listingAnalysis?.listing) return;
    setFixLoading('tags');
    try {
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'suggest_tags',
          title: listingAnalysis.listing.title,
          current_tags: listingAnalysis.listing.tags || [],
          market_context: items.length > 0 ? { topTags: items.flatMap(i => i.tags || []).slice(0, 20) } : undefined,
        }),
      });
      const data = await res.json();
      if (data.suggested_tags?.length > 0) {
        setFixedTags(data.suggested_tags);
        toast.success(tGrader('lg_tagsFixed'));
      }
    } catch (err) {
      toast.error(tGrader('lg_fixError'));
    } finally {
      setFixLoading(null);
    }
  };

  const handleFixDescription = async () => {
    if (!listingAnalysis?.listing) return;
    setFixLoading('description');
    try {
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'generate_description',
          title: listingAnalysis.listing.title,
          tags: listingAnalysis.listing.tags || [],
        }),
      });
      const data = await res.json();
      if (data.description) {
        setFixedDescription(data.description);
        toast.success(tGrader('lg_descFixed'));
      }
    } catch (err) {
      toast.error(tGrader('lg_fixError'));
    } finally {
      setFixLoading(null);
    }
  };

  // Fee profiles
  const FEE_PROFILES: Record<'us' | 'tr', FeeProfile> = useMemo(() => ({
    us: {
      label: t('usShop'), currency: '$', listingFee: 0.20, transactionRate: 0.065,
      paymentProcessingRate: 0.03, paymentProcessingFixed: 0.25, offsiteAdsRate: 0.15,
      regulatoryFee: 0, vatRate: 0, notes: t('etsyFeeNotesUS'),
    },
    tr: {
      label: t('turkeyShop'), currency: '$', listingFee: 0.20, transactionRate: 0.065,
      paymentProcessingRate: 0.065, paymentProcessingFixed: 0.17, offsiteAdsRate: 0.15,
      regulatoryFee: 0.0227, vatRate: 0, notes: t('etsyFeeNotesTR'),
    },
  }), [t]);

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
      return { label: delta === 0 ? t('average') : delta < 0 ? `${delta}%` : `+${delta}%`, price: p, profit: pr, margin: p > 0 ? (pr / p) * 100 : 0 };
    });
    return { cost, sell, ship, listingFee, transactionFee, paymentProcessing, regulatoryFee, offsiteAdsFee, etsyAdsCost, roas, totalFees, profit, margin, compare, fees };
  }, [purchaseCost, sellingPrice, shippingCost, priceStats, includeOffsiteAds, shopRegion, FEE_PROFILES, etsyAdsRoas]);

  return (
    <Box>
      {/* ── Large URL Input ── */}
      <Paper sx={{
        ...glassCard, p: 3, mb: 2, textAlign: 'center',
        background: 'linear-gradient(135deg, rgba(102,126,234,0.04) 0%, rgba(118,75,162,0.04) 100%)',
      }}>
        <Box sx={{ mb: 2 }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '16px', background: GRADIENTS.primary, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', mb: 1.5 }}>
            <Link size={28} color="#fff" />
          </Box>
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 0.5 }}>
            {tGrader('lg_title')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tGrader('lg_subtitle')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', maxWidth: 600, mx: 'auto' }}>
          <TextField
            value={analyzeInput} onChange={e => setAnalyzeInput(e.target.value)}
            size="medium" fullWidth
            placeholder={tGrader('lg_placeholder')}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            InputProps={{
              startAdornment: <InputAdornment position="start"><Link size={18} color="#667eea" /></InputAdornment>,
              sx: { borderRadius: '12px', fontSize: '1rem' },
            }}
          />
          <Button variant="contained" onClick={handleAnalyze} fullWidth
            disabled={listingAnalysisLoading || !analyzeInput.trim()}
            startIcon={listingAnalysisLoading ? <CircularProgress size={18} /> : <Search size={18} />}
            sx={{ background: GRADIENTS.primary, borderRadius: '12px', py: 1.2, fontSize: '1rem', fontWeight: 700, boxShadow: '0 4px 16px rgba(102,126,234,0.4)' }}>
            {tGrader('lg_analyze')}
          </Button>
        </Box>
      </Paper>

      {listingAnalysisLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

      {/* ── Analysis Results ── */}
      {listingAnalysis && (
        <Box>
          {/* Listing title */}
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5 }}>
            {listingAnalysis.listing?.title || 'Listing'}
          </Typography>

          {/* Overall SEO Score — large centered ring */}
          {listingAnalysis.seoScore && (
            <Paper sx={{ ...glassCard, p: 3, mb: 2, textAlign: 'center' }}>
              <ScoreRing score={listingAnalysis.seoScore.total} size={isMobile ? 100 : 130} label="SEO" />
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1.5, mt: 2, maxWidth: 500, mx: 'auto' }}>
                {[
                  { label: t('title'), value: listingAnalysis.seoScore.title, max: 25 },
                  { label: t('tags'), value: listingAnalysis.seoScore.tags, max: 25 },
                  { label: t('description'), value: listingAnalysis.seoScore.description, max: 25 },
                  { label: t('images'), value: listingAnalysis.seoScore.images, max: 25 },
                ].map(s => {
                  const pctVal = (s.value / s.max) * 100;
                  const color = pctVal > 70 ? '#4caf50' : pctVal > 40 ? '#ff9800' : '#f44336';
                  return (
                    <Box key={s.label}>
                      <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 0.5 }}>{s.label}</Typography>
                      <Box sx={{ bgcolor: '#f0f0f0', borderRadius: 3, height: 8, overflow: 'hidden', mb: 0.3 }}>
                        <Box sx={{ width: `${pctVal}%`, height: 8, borderRadius: 3, bgcolor: color, transition: 'width 0.5s' }} />
                      </Box>
                      <Typography variant="caption" sx={{ fontWeight: 700, color }}>{s.value}/{s.max}</Typography>
                    </Box>
                  );
                })}
              </Box>
            </Paper>
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

          {/* Tags */}
          {listingAnalysis.listing?.tags?.length > 0 && (
            <Paper sx={{ ...glassCard, p: 2, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {t('tagsCount', { count: listingAnalysis.listing.tags.length })}
                </Typography>
                <Button size="small" variant="outlined" onClick={handleFixTags}
                  disabled={fixLoading === 'tags'}
                  startIcon={fixLoading === 'tags' ? <CircularProgress size={14} /> : <Sparkles size={14} />}
                  sx={{ borderRadius: '10px', textTransform: 'none', background: fixLoading === 'tags' ? undefined : 'linear-gradient(135deg, rgba(123,31,162,0.08) 0%, rgba(224,64,251,0.08) 100%)' }}>
                  {tGrader('lg_fixTags')}
                </Button>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                {listingAnalysis.listing.tags.map((tag: string, i: number) => (
                  <Chip key={i} label={tag} size="small" variant="outlined"
                    onClick={() => { navigator.clipboard.writeText(tag); toast.success(t('copied')); }}
                    sx={{ cursor: 'pointer', borderRadius: '8px' }} />
                ))}
              </Box>
              {fixedTags && (
                <Box sx={{ mt: 2 }}>
                  <BeforeAfter
                    before={listingAnalysis.listing.tags.join(', ')}
                    after={fixedTags.join(', ')}
                    label={tGrader('lg_tagsComparison')}
                  />
                  <Button size="small" sx={{ mt: 1 }} onClick={() => { navigator.clipboard.writeText(fixedTags.join(', ')); toast.success(t('copied')); }}
                    startIcon={<Copy size={14} />}>
                    {tGrader('lg_copyAll')}
                  </Button>
                </Box>
              )}
            </Paper>
          )}

          {/* AI Audit — auto-triggered, shows loading or results */}
          {listingAuditLoading && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

          {listingAudit && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="h3" sx={{
                    fontWeight: 900,
                    color: (listingAudit.overall_score ?? 0) >= 70 ? '#4caf50' : (listingAudit.overall_score ?? 0) >= 50 ? '#2196F3' : '#ff9800',
                  }}>
                    {listingAudit.overall_score}
                  </Typography>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                    {t('overallScore')}: {listingAudit.overall_score}/100
                  </Typography>
                </Box>
                <Button size="small" variant="outlined" onClick={fetchListingAudit}
                  disabled={listingAuditLoading}
                  startIcon={<RefreshCw size={14} />}
                  sx={{ borderRadius: '10px' }}>
                  {t('reAudit')}
                </Button>
              </Box>

              {/* Per-category with fix buttons */}
              {[
                { key: 'title', label: t('title'), score: listingAudit.title_score, feedback: listingAudit.title_feedback, onFix: handleFixTitle, fixed: fixedTitle },
                { key: 'tags', label: t('tags'), score: listingAudit.tags_score, feedback: listingAudit.tags_feedback, onFix: handleFixTags, fixed: fixedTags ? fixedTags.join(', ') : null },
                { key: 'description', label: t('description'), score: listingAudit.description_score, feedback: listingAudit.description_feedback, onFix: handleFixDescription, fixed: fixedDescription },
                { key: 'price', label: t('price'), score: listingAudit.pricing_score, feedback: listingAudit.pricing_feedback },
                { key: 'images', label: t('images'), score: listingAudit.image_score, feedback: listingAudit.image_feedback },
              ].map(cat => (
                <Box key={cat.key} sx={{ mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {cat.score >= 70 ? <CheckCircle size={14} color="#4caf50" /> : cat.score >= 40 ? <AlertTriangle size={14} color="#ff9800" /> : <XCircle size={14} color="#f44336" />}
                      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{cat.label}: {cat.score}/100</Typography>
                    </Box>
                    {cat.onFix && cat.score < 80 && (
                      <Button size="small" onClick={cat.onFix} disabled={fixLoading === cat.key}
                        startIcon={fixLoading === cat.key ? <CircularProgress size={12} /> : <Sparkles size={12} />}
                        sx={{ borderRadius: '8px', textTransform: 'none', fontSize: '0.75rem',
                          background: 'linear-gradient(135deg, rgba(123,31,162,0.08) 0%, rgba(224,64,251,0.08) 100%)',
                        }}>
                        {tGrader('lg_fix')} {cat.label}
                      </Button>
                    )}
                  </Box>
                  <Typography variant="body2" sx={{ fontSize: '0.8rem', ml: 2.5, mb: 0.5 }}>{cat.feedback}</Typography>
                  {cat.fixed && (
                    <Box sx={{ ml: 2.5 }}>
                      <BeforeAfter
                        before={cat.key === 'title' ? (listingAnalysis.listing?.title || '') : cat.key === 'description' ? (listingAnalysis.listing?.description?.slice(0, 200) || '') : (listingAnalysis.listing?.tags?.join(', ') || '')}
                        after={cat.fixed}
                        label={`${cat.label} — ${tGrader('lg_beforeAfter')}`}
                      />
                      <Button size="small" sx={{ mt: 0.5 }} onClick={() => { navigator.clipboard.writeText(cat.fixed!); toast.success(t('copied')); }}
                        startIcon={<Copy size={12} />}>
                        {tGrader('lg_copyFixed')}
                      </Button>
                    </Box>
                  )}
                </Box>
              ))}

              {/* Quick wins */}
              {listingAudit.quick_wins?.length > 0 && (
                <Alert severity="success" sx={{ mt: 1.5, borderRadius: '12px' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('quickWins')}</Typography>
                  {listingAudit.quick_wins.map((item: string, i: number) => (
                    <Typography key={i} variant="body2" sx={{ fontSize: '0.8rem' }}>• {item}</Typography>
                  ))}
                </Alert>
              )}

              {/* Suggested tags from audit */}
              {listingAudit.suggested_tags?.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
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
            </Paper>
          )}
        </Box>
      )}

      {/* ── Sub-tabs: Profit Calculator / SEO Comparison / Rank Tracker ── */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={pillTabsSx} variant="scrollable" scrollButtons="auto">
        <Tab label={t('profitCalculator')} />
        <Tab label={t('seoComparison')} />
        <Tab label={t('rankTracking')} />
      </Tabs>

      {/* Profit Calculator */}
      {tab === 0 && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{t('etsyProfitCalculator')}</Typography>
            <Box sx={{ display: 'flex', gap: 0.5 }}>
              <Button size="small" variant={shopRegion === 'tr' ? 'contained' : 'outlined'}
                onClick={() => setShopRegion('tr')}
                sx={{ borderRadius: '10px', textTransform: 'none', fontSize: '0.75rem', px: 2, ...(shopRegion === 'tr' ? { background: GRADIENTS.primary } : {}) }}>
                {t('turkeyShop')}
              </Button>
              <Button size="small" variant={shopRegion === 'us' ? 'contained' : 'outlined'}
                onClick={() => setShopRegion('us')}
                sx={{ borderRadius: '10px', textTransform: 'none', fontSize: '0.75rem', px: 2, ...(shopRegion === 'us' ? { background: GRADIENTS.primary } : {}) }}>
                {t('usShop')}
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 1.5, mb: 2 }}>
            <TextField label={t('costPrice')} value={purchaseCost} onChange={e => setPurchaseCost(e.target.value)}
              size="small" type="number" fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
            <TextField label={t('sellingPrice')} value={sellingPrice} onChange={e => setSellingPrice(e.target.value)}
              size="small" type="number" fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
              helperText={priceStats ? `${t('avgMarket')}: ${fmt(priceStats.avg)}` : undefined} />
            <TextField label={t('shippingCost')} value={shippingCost} onChange={e => setShippingCost(e.target.value)}
              size="small" type="number" fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <FormControlLabel
              control={<Switch checked={includeOffsiteAds} onChange={e => setIncludeOffsiteAds(e.target.checked)} size="small" />}
              label={<Typography variant="caption">{t('offsiteAds')} (15%)</Typography>}
            />
            <TextField label={t('etsyAdsRoas')} value={etsyAdsRoas} onChange={e => setEtsyAdsRoas(e.target.value)}
              size="small" type="number" sx={{ width: 120 }}
              helperText={t('roasHelp')} />
          </Box>

          {/* Results */}
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1.5 }}>
            <Paper sx={{ ...glassCard, p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('totalFees')}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: '#f44336' }}>${profitCalc.totalFees.toFixed(2)}</Typography>
            </Paper>
            <Paper sx={{ ...glassCard, p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('netProfit')}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: profitCalc.profit >= 0 ? '#4caf50' : '#f44336' }}>
                ${profitCalc.profit.toFixed(2)}
              </Typography>
            </Paper>
            <Paper sx={{ ...glassCard, p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('profitMargin')}</Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, color: profitCalc.margin >= 30 ? '#4caf50' : profitCalc.margin >= 15 ? '#ff9800' : '#f44336' }}>
                {profitCalc.margin.toFixed(1)}%
              </Typography>
            </Paper>
            {profitCalc.etsyAdsCost > 0 && (
              <Paper sx={{ ...glassCard, p: 1.5, textAlign: 'center' }}>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>{t('adsCost')}</Typography>
                <Typography variant="h6" sx={{ fontWeight: 800, color: '#ff9800' }}>${profitCalc.etsyAdsCost.toFixed(2)}</Typography>
              </Paper>
            )}
          </Box>

          {/* Price comparison */}
          <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            {profitCalc.compare.map(c => (
              <Paper key={c.label} sx={{ ...glassCard, p: 1, flex: 1, minWidth: 80, textAlign: 'center' }}>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>{c.label}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>${c.price.toFixed(2)}</Typography>
                <Typography variant="caption" sx={{ color: c.profit >= 0 ? '#4caf50' : '#f44336', fontWeight: 700 }}>
                  ${c.profit.toFixed(2)} ({c.margin.toFixed(0)}%)
                </Typography>
              </Paper>
            ))}
          </Box>
        </Paper>
      )}

      {/* SEO Comparison — re-use seoResult from existing hook */}
      {tab === 1 && seoResult && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('seoComparison')}</Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <ScoreRing score={seoResult.score} size={isMobile ? 70 : 90} label="SEO" />
            <Box sx={{ flex: 1 }}>
              {[
                { label: t('keywordCoverage'), value: seoResult.kwScore, max: 30 },
                { label: t('tagCoverage'), value: seoResult.tagScore, max: 30 },
                { label: t('titleLength'), value: seoResult.lengthScore, max: 20 },
                { label: t('hasTags'), value: seoResult.hasTagsScore, max: 20 },
              ].map(item => {
                const pctVal = (item.value / item.max) * 100;
                return (
                  <Box key={item.label} sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                    <Typography variant="caption" sx={{ minWidth: 80, fontWeight: 600 }}>{item.label}</Typography>
                    <Box sx={{ flex: 1, bgcolor: '#f0f0f0', borderRadius: 3, height: 6, overflow: 'hidden' }}>
                      <Box sx={{ width: `${pctVal}%`, height: 6, borderRadius: 3,
                        bgcolor: pctVal > 70 ? '#4caf50' : pctVal > 40 ? '#ff9800' : '#f44336' }} />
                    </Box>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>{item.value}/{item.max}</Typography>
                  </Box>
                );
              })}
            </Box>
          </Box>
          {seoResult.recommendations?.map((tip: string, i: number) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 0.5 }}>
              <Lightbulb size={14} color="#ff9800" style={{ flexShrink: 0, marginTop: 3 }} />
              <Typography variant="body2" sx={{ fontSize: '0.82rem' }}>{tip}</Typography>
            </Box>
          ))}
        </Paper>
      )}

      {/* Rank Tracker */}
      {tab === 2 && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>{t('rankTracking')}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('rankTrackingDesc')}
          </Typography>
          {shopId && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
              <TextField value={rankKeywordInput} onChange={e => setRankKeywordInput(e.target.value)}
                size="small" placeholder={t('keywordToTrack')} sx={{ flex: 1, minWidth: 150 }}
                onKeyDown={e => e.key === 'Enter' && addTrackedKeyword(shopId, userListings)} />
              <Button variant="contained" onClick={() => addTrackedKeyword(shopId, userListings)}
                disabled={rankAddLoading || !rankKeywordInput.trim()}
                startIcon={rankAddLoading ? <CircularProgress size={14} /> : <Target size={14} />}
                sx={{ background: GRADIENTS.primary, borderRadius: '10px' }}>
                {t('addKeyword')}
              </Button>
            </Box>
          )}
          {trackedKeywords.length === 0 && !rankLoading && (
            <Alert severity="info" sx={{ borderRadius: '12px' }}>
              {t('noTrackedKeywords')}
            </Alert>
          )}
          {trackedKeywords.map((kw: any) => (
            <Paper key={kw.id} sx={{ ...glassCard, p: 1.5, mb: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>{kw.keyword}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('rank')}: {kw.currentRank ? `#${kw.currentRank}` : '-'}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', gap: 0.5 }}>
                  {shopId && (
                    <IconButton size="small" onClick={() => removeTrackedKeyword(kw.id, shopId)}>
                      <XCircle size={14} />
                    </IconButton>
                  )}
                </Box>
              </Box>
            </Paper>
          ))}
        </Paper>
      )}

      {/* Empty state when nothing analyzed */}
      {!listingAnalysis && !listingAnalysisLoading && (
        <PremiumEmptyState
          icon={<Link size={48} />}
          title={tGrader('lg_emptyTitle')}
          desc={tGrader('lg_emptyDesc')}
          steps={[tGrader('lg_step1'), tGrader('lg_step2'), tGrader('lg_step3')]}
        />
      )}
    </Box>
  );
}
