import React, { useEffect } from 'react';
import {
  Box, Typography, Card, CardContent, Grid, Button, Chip, CircularProgress,
  IconButton, Tooltip, LinearProgress,
} from '@mui/material';
import { Trash2, RefreshCw, TrendingUp, Star, ExternalLink, Package } from 'lucide-react';
import { useAmazonResearchStore } from '@/lib/stores/useAmazonResearchStore';
import { useTranslations } from 'next-intl';
import { formatMoney } from '@/lib/research/stats';
import { useResearchLocale } from '@/components/etsy/research/shared/RobustPrice';

/** Saved niches store only the marketplace code; map it to the currency prices were summarized in. */
const AMAZON_MARKETPLACE_CURRENCY: Record<string, string> = {
  US: 'USD', CA: 'CAD', MX: 'MXN', BR: 'BRL', UK: 'GBP', GB: 'GBP', DE: 'EUR', FR: 'EUR', IT: 'EUR',
  ES: 'EUR', NL: 'EUR', BE: 'EUR', IE: 'EUR', SE: 'SEK', PL: 'PLN', TR: 'TRY', AE: 'AED', SA: 'SAR',
  IN: 'INR', JP: 'JPY', AU: 'AUD', SG: 'SGD', EG: 'EGP',
};
const amazonCurrency = (marketplace?: string | null) => AMAZON_MARKETPLACE_CURRENCY[(marketplace || 'US').toUpperCase()] || 'USD';

export default function CompetitorIntelligence() {
  const t = useTranslations('amazonResearch');
  const tR = useTranslations('research');
  const locale = useResearchLocale();
  const {
    trackedProducts, trackedLoading, fetchTrackedProducts, untrackProduct, refreshTracked,
    savedNiches, fetchSavedNiches, deleteNiche,
    getProduct, selectedProduct, productLoading,
  } = useAmazonResearchStore();

  useEffect(() => {
    fetchTrackedProducts();
    fetchSavedNiches();
  }, []);

  return (
    <Box>
      {/* Tracked Products */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          {t('trackedProducts')} ({trackedProducts.length})
        </Typography>
        <Button
          size="small"
          startIcon={trackedLoading ? <CircularProgress size={14} /> : <RefreshCw size={14} />}
          onClick={refreshTracked}
          disabled={trackedLoading || !trackedProducts.length}
          color="warning"
        >
          {t('refreshAll')}
        </Button>
      </Box>

      {trackedLoading && <LinearProgress color="warning" sx={{ mb: 1 }} />}

      {trackedProducts.length === 0 && !trackedLoading ? (
        <Card variant="outlined" sx={{ mb: 3 }}>
          <CardContent sx={{ textAlign: 'center', py: 4 }}>
            <Package size={40} strokeWidth={1} color="#ccc" />
            <Typography color="text.secondary" sx={{ mt: 1 }}>{t('noTrackedProducts')}</Typography>
            <Typography variant="caption" color="text.secondary">{t('trackHint')}</Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={1.5} sx={{ mb: 3 }}>
          {trackedProducts.map((product) => (
            <Grid item xs={12} sm={6} md={4} key={product.id}>
              <Card variant="outlined" sx={{ height: '100%' }}>
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {product.imageUrl && (
                      <Box
                        component="img"
                        src={product.imageUrl}
                        sx={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 1, bgcolor: '#f5f5f5' }}
                      />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={600} sx={{
                        overflow: 'hidden', textOverflow: 'ellipsis',
                        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                        fontSize: '0.78rem', lineHeight: 1.3,
                      }}>
                        {product.title || product.asin}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">{product.asin}</Typography>
                    </Box>
                  </Box>

                  <Box sx={{ display: 'flex', gap: 1, mt: 1, flexWrap: 'wrap' }}>
                    {product.currentPrice != null && (
                      <Chip label={formatMoney(product.currentPrice, product.currency || 'USD', locale)} size="small" color="warning" variant="outlined" />
                    )}
                    {product.currentRank != null && (
                      <Chip
                        icon={<TrendingUp size={12} />}
                        label={`BSR #${product.currentRank.toLocaleString()}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                    {product.reviewCount != null && (
                      <Chip
                        icon={<Star size={12} />}
                        label={`${product.rating || '?'} (${product.reviewCount})`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>

                  {product.lastCheckedAt && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                      {t('lastChecked')}: {new Date(product.lastCheckedAt).toLocaleDateString()}
                    </Typography>
                  )}

                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                    <Tooltip title="View on Amazon">
                      <IconButton size="small" onClick={() => window.open(`https://amazon.com/dp/${product.asin}`, '_blank')}>
                        <ExternalLink size={14} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('untrack')}>
                      <IconButton size="small" color="error" onClick={() => untrackProduct(product.id)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      {/* Saved Niches */}
      <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
        {t('savedNiches')} ({savedNiches.length})
      </Typography>

      {savedNiches.length === 0 ? (
        <Card variant="outlined">
          <CardContent sx={{ textAlign: 'center', py: 3 }}>
            <Typography color="text.secondary">{t('noSavedNiches')}</Typography>
          </CardContent>
        </Card>
      ) : (
        <Grid container spacing={1.5}>
          {savedNiches.map((niche) => (
            <Grid item xs={12} sm={6} md={4} key={niche.id}>
              <Card variant="outlined">
                <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                  <Typography variant="body2" fontWeight={700}>{niche.query}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {niche.marketplace} • {new Date(niche.createdAt).toLocaleDateString()}
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                    {niche.demandScore != null && (
                      <Chip label={`${t('demand')}: ${niche.demandScore}`} size="small" variant="outlined" />
                    )}
                    {niche.competitionScore != null && (
                      <Chip label={`${t('competition')}: ${niche.competitionScore}`} size="small" variant="outlined" />
                    )}
                    {/* R0: median only (legacy saved means are not shown). */}
                    {niche.medianPrice != null && niche.medianPrice > 0 && (
                      <Chip label={`${tR('stats.medianShort')} ${formatMoney(niche.medianPrice, amazonCurrency(niche.marketplace), locale)}`} size="small" variant="outlined" />
                    )}
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.5 }}>
                    <Tooltip title={t('delete')}>
                      <IconButton size="small" color="error" onClick={() => deleteNiche(niche.id)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </Tooltip>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );
}
