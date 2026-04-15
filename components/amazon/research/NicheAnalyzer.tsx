import React from 'react';
import { Card, CardContent, Typography, Box, Grid, Chip, LinearProgress } from '@mui/material';
import type { NicheData } from '@/lib/stores/useAmazonResearchStore';
import { useTranslations } from 'next-intl';

interface Props {
  data: NicheData;
}

function scoreColor(score: number) {
  if (score >= 70) return '#4caf50';
  if (score >= 40) return '#ff9800';
  return '#f44336';
}

export default function NicheAnalyzer({ data }: Props) {
  const t = useTranslations('amazonResearch');
  const { stats, demand, competition, opportunity, priceDistribution, sellerAnalysis, feeEstimate } = data;

  return (
    <Card variant="outlined" sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1.5 }}>
          {t('nicheAnalysis')}
        </Typography>

        {/* Score bars */}
        <Grid container spacing={2} sx={{ mb: 2 }}>
          <Grid item xs={12} sm={4}>
            <Typography variant="caption" fontWeight={600}>{t('demand')}: {demand.score}/100</Typography>
            <LinearProgress
              variant="determinate"
              value={demand.score}
              sx={{ height: 8, borderRadius: 4, bgcolor: '#eee', '& .MuiLinearProgress-bar': { bgcolor: scoreColor(demand.score) } }}
            />
            <Typography variant="caption" color="text.secondary">{demand.label}</Typography>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography variant="caption" fontWeight={600}>{t('competition')}: {competition.score}/100</Typography>
            <LinearProgress
              variant="determinate"
              value={competition.score}
              sx={{ height: 8, borderRadius: 4, bgcolor: '#eee', '& .MuiLinearProgress-bar': { bgcolor: scoreColor(competition.score) } }}
            />
            <Typography variant="caption" color="text.secondary">{competition.label}</Typography>
          </Grid>
          <Grid item xs={12} sm={4}>
            <Typography variant="caption" fontWeight={600}>{t('opportunity')}: {opportunity.score}/100</Typography>
            <LinearProgress
              variant="determinate"
              value={opportunity.score}
              sx={{ height: 8, borderRadius: 4, bgcolor: '#eee', '& .MuiLinearProgress-bar': { bgcolor: scoreColor(opportunity.score) } }}
            />
            <Typography variant="caption" color="text.secondary">{opportunity.label}</Typography>
          </Grid>
        </Grid>

        {/* Price distribution */}
        {priceDistribution?.length > 0 && (
          <Box sx={{ mb: 2 }}>
            <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>
              {t('priceDistribution')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.3, height: 40, alignItems: 'flex-end' }}>
              {priceDistribution.map((bucket, i) => {
                const maxCount = Math.max(...priceDistribution.map(b => b.count), 1);
                const height = (bucket.count / maxCount) * 100;
                return (
                  <Box
                    key={i}
                    sx={{
                      flex: 1, bgcolor: '#FF9900', borderRadius: '2px 2px 0 0',
                      height: `${Math.max(height, 4)}%`,
                      opacity: bucket.count > 0 ? 1 : 0.2,
                    }}
                    title={`${bucket.range}: ${bucket.count}`}
                  />
                );
              })}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">${stats.minPrice}</Typography>
              <Typography variant="caption" color="text.secondary">${stats.maxPrice}</Typography>
            </Box>
          </Box>
        )}

        {/* Seller analysis */}
        {sellerAnalysis && (
          <Box sx={{ mb: 1 }}>
            <Typography variant="caption" fontWeight={600}>
              {t('sellers')}: {sellerAnalysis.uniqueSellers} {t('unique')}
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {sellerAnalysis.topSellers.map((s) => (
                <Chip key={s.seller} label={`${s.seller} (${s.listings})`} size="small" variant="outlined" />
              ))}
            </Box>
          </Box>
        )}

        {/* Fee estimate */}
        {feeEstimate && (
          <Box sx={{ mt: 1, p: 1, bgcolor: '#f5f5f5', borderRadius: 1 }}>
            <Typography variant="caption" fontWeight={600}>{t('feeEstimate')} (FBA @ ${stats.avgPrice})</Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 0.5, flexWrap: 'wrap' }}>
              <Typography variant="caption">
                {t('referralFee')}: ${feeEstimate.referralFee} ({feeEstimate.referralFeePercent}%)
              </Typography>
              <Typography variant="caption">FBA: ${feeEstimate.fbaFee}</Typography>
              <Typography variant="caption">
                {t('totalFees')}: ${feeEstimate.totalFees} ({feeEstimate.totalFeesPercent}%)
              </Typography>
              <Typography variant="caption" fontWeight={600} color="success.main">
                {t('netAfterFees')}: ${feeEstimate.netAfterFees}
              </Typography>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
