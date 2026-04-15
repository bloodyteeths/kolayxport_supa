import React from 'react';
import { Card, CardContent, Typography, Box, Chip, Grid } from '@mui/material';
import { Sparkles, Target, AlertTriangle, Lightbulb, TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface Props {
  data: {
    summary?: string;
    marketSize?: string;
    trend?: string;
    profitPotential?: string;
    pricingStrategy?: { recommended?: number; reasoning?: string };
    topOpportunities?: string[];
    risks?: string[];
    differentiationIdeas?: string[];
    keywordsToTarget?: string[];
    seasonality?: string;
    competitiveAdvice?: string;
  };
}

function trendChip(trend: string) {
  const color = trend === 'growing' ? 'success' : trend === 'stable' ? 'info' : 'error';
  return <Chip label={trend} size="small" color={color} variant="outlined" />;
}

export default function AiInsightsPanel({ data }: Props) {
  const t = useTranslations('amazonResearch');

  return (
    <Card variant="outlined" sx={{ mb: 2, border: '1px solid #FF9900' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Sparkles size={18} color="#FF9900" />
          <Typography variant="subtitle1" fontWeight={700}>{t('aiInsights')}</Typography>
          {data.trend && trendChip(data.trend)}
          {data.marketSize && <Chip label={`${t('marketSize')}: ${data.marketSize}`} size="small" variant="outlined" />}
          {data.profitPotential && <Chip label={`${t('profit')}: ${data.profitPotential}`} size="small" variant="outlined" />}
        </Box>

        {data.summary && (
          <Typography variant="body2" sx={{ mb: 1.5 }}>{data.summary}</Typography>
        )}

        <Grid container spacing={2}>
          {/* Pricing recommendation */}
          {data.pricingStrategy?.recommended && (
            <Grid item xs={12} sm={6}>
              <Box sx={{ p: 1, bgcolor: '#fff8e1', borderRadius: 1 }}>
                <Typography variant="caption" fontWeight={600}>
                  <Target size={12} /> {t('recommendedPrice')}: ${data.pricingStrategy.recommended}
                </Typography>
                <Typography variant="caption" display="block" color="text.secondary">
                  {data.pricingStrategy.reasoning}
                </Typography>
              </Box>
            </Grid>
          )}

          {/* Opportunities */}
          {data.topOpportunities?.length ? (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Lightbulb size={12} /> {t('opportunities')}
              </Typography>
              {data.topOpportunities.map((opp, i) => (
                <Typography key={i} variant="caption" display="block" sx={{ pl: 1 }}>• {opp}</Typography>
              ))}
            </Grid>
          ) : null}

          {/* Risks */}
          {data.risks?.length ? (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" fontWeight={600} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <AlertTriangle size={12} /> {t('risks')}
              </Typography>
              {data.risks.map((risk, i) => (
                <Typography key={i} variant="caption" display="block" sx={{ pl: 1 }}>• {risk}</Typography>
              ))}
            </Grid>
          ) : null}

          {/* Differentiation */}
          {data.differentiationIdeas?.length ? (
            <Grid item xs={12} sm={6}>
              <Typography variant="caption" fontWeight={600}>
                <TrendingUp size={12} /> {t('differentiation')}
              </Typography>
              {data.differentiationIdeas.map((idea, i) => (
                <Typography key={i} variant="caption" display="block" sx={{ pl: 1 }}>• {idea}</Typography>
              ))}
            </Grid>
          ) : null}
        </Grid>

        {/* Keywords to target */}
        {data.keywordsToTarget?.length ? (
          <Box sx={{ mt: 1.5 }}>
            <Typography variant="caption" fontWeight={600}>{t('keywordsToTarget')}</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
              {data.keywordsToTarget.map((kw) => (
                <Chip key={kw} label={kw} size="small" variant="outlined" color="warning" />
              ))}
            </Box>
          </Box>
        ) : null}

        {/* Competitive advice */}
        {data.competitiveAdvice && (
          <Box sx={{ mt: 1.5, p: 1, bgcolor: '#f5f5f5', borderRadius: 1 }}>
            <Typography variant="caption" fontWeight={600}>{t('competitiveAdvice')}</Typography>
            <Typography variant="caption" display="block">{data.competitiveAdvice}</Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
