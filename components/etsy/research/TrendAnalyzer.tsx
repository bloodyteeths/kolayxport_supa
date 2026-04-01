'use client';

import React from 'react';
import { Box, Typography, Button, Paper, Chip, Alert, CircularProgress, LinearProgress, useMediaQuery, Skeleton } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { TrendingUp, BarChart2, Calendar, Activity, Lightbulb, Flame } from 'lucide-react';
import { toast } from 'react-hot-toast';

import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';
import { StatCard, TrendChart, GradientBar, PremiumEmptyState, GRADIENTS, glassCard } from './shared/ui';

export default function TrendAnalyzer() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const {
    trendData,
    trendLoading,
    seasonalData,
    seasonalLoading,
    query,
    kwExplorerQuery,
    fetchTrends,
    setQuery,
    discoveryData,
    discoveryLoading,
  } = useEtsyResearchStore();

  return (
    <Box>
      <Paper sx={{ ...glassCard, p: 2.5, mb: 2, textAlign: 'center' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, justifyContent: 'center' }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: '10px', display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: GRADIENTS.success,
          }}>
            <Activity size={18} color="#fff" />
          </Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Trend Analizi</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Google Trends + Wikipedia verileri ile arama trendleri ve mevsimsel analiz
        </Typography>
        <Button variant="contained" onClick={fetchTrends}
          disabled={trendLoading || (!query.trim() && !kwExplorerQuery.trim())} size="large"
          startIcon={trendLoading ? <CircularProgress size={16} /> : <TrendingUp size={16} />}
          sx={{ background: GRADIENTS.success, borderRadius: '12px', px: 4, boxShadow: '0 4px 12px rgba(17,153,142,0.3)', ...(isMobile && { width: '100%' }) }}
        >
          {trendLoading ? 'Analiz ediliyor...' : 'Trend Analizi Baslat'}
        </Button>
        {!query.trim() && !kwExplorerQuery.trim() && (
          <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1 }}>
            Önce "Kelime Keşif" sekmesinde bir anahtar kelime arayın
          </Typography>
        )}
      </Paper>

      {(trendLoading || seasonalLoading) && <LinearProgress sx={{ mb: 2, borderRadius: 4, height: 4 }} />}

      {trendData && (
        <>
          {/* Trend summary cards */}
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1.5, mb: 2 }}>
            <StatCard label="Ort. Ilgi" value={String(trendData.averageInterest)} color="#2196F3"
              icon={<BarChart2 size={18} />} />
            <StatCard label="Zirve Degeri" value={String(trendData.peakValue)} color="#4caf50"
              icon={<TrendingUp size={18} />} />
            <StatCard label="Zirve Tarihi" value={trendData.peakDate || '-'} color="#ff9800"
              icon={<Calendar size={18} />} />
            <StatCard label="Yon" value={
              trendData.trendDirection === 'rising' ? 'Yukselis' :
              trendData.trendDirection === 'declining' ? 'Dusus' : 'Stabil'
            } color={
              trendData.trendDirection === 'rising' ? '#4caf50' :
              trendData.trendDirection === 'declining' ? '#f44336' : '#ff9800'
            } icon={<Activity size={18} />}
              gradient={trendData.trendDirection === 'rising' ? GRADIENTS.success : undefined}
            />
          </Box>

          {/* Trend chart */}
          {trendData.timeline.length > 0 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
                12 Aylik Google Trends (Alisveris Kategorisi)
              </Typography>
              <TrendChart data={trendData.timeline} />
            </Paper>
          )}

          {/* Rising & top queries */}
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mb: 2 }}>
            {trendData.risingQueries.length > 0 && (
              <Paper sx={{ ...glassCard, p: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1, color: '#4caf50' }}>
                  Yukselen Aramalar
                </Typography>
                {trendData.risingQueries.map(q => (
                  <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                    <Typography variant="body2" sx={{
                      cursor: 'pointer', '&:hover': { color: 'primary.main' },
                    }} onClick={() => { setQuery(q.query); toast.success(`"${q.query}" arama alanina eklendi`); }}>
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
                  En Populer Iliskili Aramalar
                </Typography>
                {trendData.topQueries.map(q => (
                  <Box key={q.query} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, alignItems: 'center' }}>
                    <Typography variant="body2" sx={{
                      cursor: 'pointer', '&:hover': { color: 'primary.main' },
                    }} onClick={() => { setQuery(q.query); toast.success(`"${q.query}" arama alanina eklendi`); }}>
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

      {/* Seasonal calendar */}
      {seasonalData && seasonalData.hasData && (
        <Paper sx={{ ...glassCard, p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5 }}>
            Mevsimsel Takvim
          </Typography>
          {seasonalData.peakMonth && (
            <Alert severity="success" sx={{ mb: 2, borderRadius: '12px' }}>
              Zirve ay: <strong>{seasonalData.peakMonth}</strong> | Dusuk ay: <strong>{seasonalData.lowMonth}</strong>
            </Alert>
          )}
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(4, 1fr)' : 'repeat(auto-fill, minmax(70px, 1fr))', gap: isMobile ? 0.5 : 1 }}>
            {(seasonalData.monthlyTrends.length > 0 ? seasonalData.monthlyTrends : seasonalData.wikiPageviews.map(w => ({ month: w.month, value: w.views }))).map(m => {
              const maxVal = Math.max(...(seasonalData.monthlyTrends.length > 0 ? seasonalData.monthlyTrends : seasonalData.wikiPageviews.map(w => ({ month: w.month, value: w.views }))).map(x => x.value), 1);
              const intensity = m.value / maxVal;
              const isPeak = m.month === seasonalData.peakMonth;
              const isLow = m.month === seasonalData.lowMonth;
              return (
                <Paper key={m.month} sx={{
                  p: 1, textAlign: 'center', borderRadius: '12px',
                  border: isPeak ? '2px solid #4caf50' : isLow ? '2px solid #f44336' : '1px solid #eee',
                  bgcolor: `rgba(102,126,234,${intensity * 0.15})`,
                }}>
                  <Typography variant="caption" sx={{ fontWeight: 700, fontSize: '0.7rem' }}>
                    {m.month}
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: isPeak ? '#4caf50' : isLow ? '#f44336' : '#333' }}>
                    {m.value}
                  </Typography>
                </Paper>
              );
            })}
          </Box>
        </Paper>
      )}

      {!trendLoading && !trendData && (
        <>
          {/* Discovery: suggested searches + seasonal tips */}
          {discoveryLoading && (
            <Box sx={{ mb: 2 }}>
              <Skeleton variant="text" width={220} height={28} sx={{ mb: 1 }} />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4].map(i => (
                  <Skeleton key={i} variant="rounded" width={120} height={36} sx={{ borderRadius: '10px' }} />
                ))}
              </Box>
            </Box>
          )}

          {discoveryData?.trendingNiches?.length > 0 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Flame size={16} color="#f44336" /> Suggested Trend Searches
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Click a niche to set it as search query, then run Trend Analysis
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {discoveryData.trendingNiches.map((niche: any) => (
                  <Chip key={niche.query} label={niche.query} variant="outlined"
                    onClick={() => { setQuery(niche.query); toast.success(`"${niche.query}" arama alanina eklendi`); }}
                    sx={{
                      cursor: 'pointer', borderRadius: '10px', fontWeight: 600, textTransform: 'capitalize',
                      '&:hover': { bgcolor: 'rgba(17,153,142,0.08)', borderColor: '#11998e' },
                    }}
                  />
                ))}
              </Box>
            </Paper>
          )}

          {discoveryData?.seasonalTips?.length > 0 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Lightbulb size={16} color="#ff9800" /> Seasonal Tips
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

          {!discoveryLoading && !discoveryData && (
            <PremiumEmptyState
              icon={<Activity size={48} />}
              title="Trend Analizi"
              desc="Ürün kategoriniz yılın hangi aylarında popüler? Ne zaman stok yapmalısınız?"
              steps={['Önce "Pazar Araştırma" bölümünde bir anahtar kelime arayın', 'Bu sekmeye gelin ve "Trend Analizi Başlat" butonuna tıklayın', 'Mevsimsel takvim ve yükselen aramaları görün']}
            />
          )}
        </>
      )}
    </Box>
  );
}
