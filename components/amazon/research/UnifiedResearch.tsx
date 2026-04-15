import React from 'react';
import {
  Box, Typography, Grid, Card, CardContent, Chip, LinearProgress,
  Button, CircularProgress, Tooltip, IconButton,
} from '@mui/material';
import { TrendingUp, TrendingDown, Star, ShoppingCart, DollarSign, BarChart, Sparkles, BookmarkPlus, Package } from 'lucide-react';
import { useAmazonResearchStore, type AmazonProductItem } from '@/lib/stores/useAmazonResearchStore';
import { useTranslations } from 'next-intl';
import ProductCard from './ProductCard';
import NicheAnalyzer from './NicheAnalyzer';
import AiInsightsPanel from './AiInsightsPanel';

export default function UnifiedResearch() {
  const t = useTranslations('amazonResearch');
  const {
    items, totalResults, stats, opportunity, topKeywords, loading,
    nicheData, nicheLoading,
    aiInsights, aiLoading, generateAiInsights,
    nicheReport, nicheReportLoading, fetchNicheReport,
    trackProduct, saveNiche, query,
  } = useAmazonResearchStore();

  if (!items.length && !loading && !nicheLoading) {
    return (
      <Box sx={{ textAlign: 'center', py: 8, color: '#999' }}>
        <Package size={48} strokeWidth={1} />
        <Typography sx={{ mt: 2 }}>{t('searchPrompt')}</Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Loading indicator */}
      {(loading || nicheLoading) && <LinearProgress sx={{ mb: 2, borderRadius: 1 }} color="warning" />}

      {/* Market Stats Cards */}
      {stats && (
        <Grid container spacing={1.5} sx={{ mb: 2 }}>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined" sx={{ textAlign: 'center' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">{t('avgPrice')}</Typography>
                <Typography variant="h6" fontWeight={700}>${stats.avgPrice}</Typography>
                <Typography variant="caption" color="text.secondary">
                  ${stats.minPrice} – ${stats.maxPrice}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined" sx={{ textAlign: 'center' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">{t('avgBsr')}</Typography>
                <Typography variant="h6" fontWeight={700}>{stats.avgBsr?.toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined" sx={{ textAlign: 'center' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">{t('avgReviews')}</Typography>
                <Typography variant="h6" fontWeight={700}>{stats.avgReviews?.toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Card variant="outlined" sx={{ textAlign: 'center' }}>
              <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                <Typography variant="caption" color="text.secondary">{t('totalResults')}</Typography>
                <Typography variant="h6" fontWeight={700}>{totalResults?.toLocaleString()}</Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      )}

      {/* Opportunity Score */}
      {opportunity && (
        <Card variant="outlined" sx={{ mb: 2, background: opportunity.score >= 55 ? '#f0fff0' : '#fff5f0' }}>
          <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1.5, '&:last-child': { pb: 1.5 }, flexWrap: 'wrap' }}>
            <Box sx={{ flex: 1, minWidth: 200 }}>
              <Typography variant="subtitle2" fontWeight={700}>
                {t('opportunityScore')}: {opportunity.score}/100
              </Typography>
              <Typography variant="body2" color="text.secondary">{opportunity.label}</Typography>
            </Box>
            <Chip
              icon={<TrendingUp size={14} />}
              label={`${t('demand')}: ${opportunity.demand.score}`}
              size="small"
              color={opportunity.demand.score >= 60 ? 'success' : 'default'}
              variant="outlined"
            />
            <Chip
              icon={<ShoppingCart size={14} />}
              label={`${t('competition')}: ${opportunity.competition.score}`}
              size="small"
              color={opportunity.competition.score >= 60 ? 'success' : 'error'}
              variant="outlined"
            />
            <Button
              size="small"
              startIcon={<Sparkles size={14} />}
              onClick={generateAiInsights}
              disabled={aiLoading}
              variant="outlined"
              color="warning"
            >
              {aiLoading ? <CircularProgress size={14} /> : t('aiAnalysis')}
            </Button>
            <Button
              size="small"
              startIcon={<BookmarkPlus size={14} />}
              onClick={() => saveNiche()}
              variant="outlined"
            >
              {t('saveNiche')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* AI Insights */}
      {aiInsights && <AiInsightsPanel data={aiInsights} />}

      {/* Niche Analysis */}
      {nicheData && <NicheAnalyzer data={nicheData} />}

      {/* Niche AI Report button */}
      {nicheData && !nicheReport && (
        <Button
          fullWidth
          variant="outlined"
          color="warning"
          startIcon={nicheReportLoading ? <CircularProgress size={16} /> : <Sparkles size={16} />}
          onClick={fetchNicheReport}
          disabled={nicheReportLoading}
          sx={{ mb: 2 }}
        >
          {t('generateNicheReport')}
        </Button>
      )}

      {/* Niche Report */}
      {nicheReport && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent>
            <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1 }}>
              {t('nicheReport')} — {nicheReport.verdict}
            </Typography>
            <Typography variant="body2" sx={{ mb: 1 }}>{nicheReport.executiveSummary}</Typography>

            {nicheReport.entryStrategy && (
              <Box sx={{ mt: 1 }}>
                <Typography variant="subtitle2" fontWeight={600}>{t('entryStrategy')}</Typography>
                <Typography variant="body2">{nicheReport.entryStrategy.approach}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {t('investment')}: {nicheReport.entryStrategy.investmentRange} | {t('timeToProfit')}: {nicheReport.entryStrategy.timeToProfit}
                </Typography>
              </Box>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top Keywords */}
      {topKeywords.length > 0 && (
        <Card variant="outlined" sx={{ mb: 2 }}>
          <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>{t('topKeywords')}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {topKeywords.slice(0, 20).map((kw) => (
                <Chip
                  key={kw.keyword}
                  label={`${kw.keyword} (${kw.pct}%)`}
                  size="small"
                  variant="outlined"
                />
              ))}
            </Box>
          </CardContent>
        </Card>
      )}

      {/* Product Grid */}
      {items.length > 0 && (
        <>
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            {t('products')} ({items.length})
          </Typography>
          <Grid container spacing={1.5}>
            {items.map((item) => (
              <Grid item xs={12} sm={6} md={4} lg={3} key={item.asin}>
                <ProductCard product={item} onTrack={() => trackProduct(item)} />
              </Grid>
            ))}
          </Grid>
        </>
      )}
    </Box>
  );
}
