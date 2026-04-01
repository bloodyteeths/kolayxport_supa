import React from 'react';
import {
  Box, Typography, Paper, Button, Chip, IconButton, Tooltip,
  useMediaQuery, Skeleton, Card, CardMedia, CardContent, Grid,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import {
  Search, TrendingUp, BarChart2, Compass, Trash2, Clock,
  ArrowRight, Zap, Star, Flame, Lightbulb,
} from 'lucide-react';
import { useEtsyResearchStore } from '@/lib/stores/useEtsyResearchStore';
import { GRADIENTS, glassCard, StatCard, ScoreRing } from './shared/ui';

interface ResearchDashboardProps {
  onNavigateToSection: (section: number, tab?: number) => void;
}

export default function ResearchDashboard({ onNavigateToSection }: ResearchDashboardProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const {
    items, totalResults, savedSearches, query,
    setQuery, loadSearch, deleteSaved, initSavedSearches,
    discoveryData, discoveryLoading, searchMarket,
  } = useEtsyResearchStore();

  React.useEffect(() => { initSavedSearches(); }, [initSavedSearches]);

  const hasData = items.length > 0;

  // Quick stats from last search
  const avgFav = hasData ? Math.round(items.reduce((s, i) => s + i.num_favorers, 0) / items.length) : 0;
  const avgPrice = hasData ? Math.round(items.reduce((s, i) => s + i.price, 0) / items.length * 100) / 100 : 0;
  const uniqueShops = hasData ? new Set(items.map(i => i.shop_id)).size : 0;

  return (
    <Box>
      {/* Quick Actions */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5, mb: 3 }}>
        <Paper
          onClick={() => onNavigateToSection(1, 100)}
          sx={{
            ...glassCard, p: 2, cursor: 'pointer', textAlign: 'center',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' },
          }}
        >
          <Box sx={{ width: 44, height: 44, borderRadius: '12px', background: GRADIENTS.primary, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
            <Search size={20} color="#fff" />
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>Niş Analizi</Typography>
          <Typography variant="caption" color="text.secondary">Pazar talep ve rekabet</Typography>
        </Paper>

        <Paper
          onClick={() => onNavigateToSection(2, 0)}
          sx={{
            ...glassCard, p: 2, cursor: 'pointer', textAlign: 'center',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' },
          }}
        >
          <Box sx={{ width: 44, height: 44, borderRadius: '12px', background: GRADIENTS.info, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
            <Compass size={20} color="#fff" />
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>Kelime Keşif</Typography>
          <Typography variant="caption" color="text.secondary">Yeni fırsatlar bul</Typography>
        </Paper>

        <Paper
          onClick={() => onNavigateToSection(2, 1)}
          sx={{
            ...glassCard, p: 2, cursor: 'pointer', textAlign: 'center',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' },
          }}
        >
          <Box sx={{ width: 44, height: 44, borderRadius: '12px', background: GRADIENTS.success, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
            <TrendingUp size={20} color="#fff" />
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>Trendler</Typography>
          <Typography variant="caption" color="text.secondary">Mevsimsel analiz</Typography>
        </Paper>

        <Paper
          onClick={() => onNavigateToSection(0, 9)}
          sx={{
            ...glassCard, p: 2, cursor: 'pointer', textAlign: 'center',
            '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' },
          }}
        >
          <Box sx={{ width: 44, height: 44, borderRadius: '12px', background: GRADIENTS.warning, display: 'flex', alignItems: 'center', justifyContent: 'center', mx: 'auto', mb: 1 }}>
            <Zap size={20} color="#fff" />
          </Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: '0.8rem' }}>Mağazam</Typography>
          <Typography variant="caption" color="text.secondary">SEO & kâr hesaplama</Typography>
        </Paper>
      </Box>

      {/* Last Search Summary */}
      {hasData && (
        <Paper sx={{ ...glassCard, p: 2.5, mb: 3 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant={isMobile ? 'body1' : 'subtitle1'} sx={{ fontWeight: 800 }}>
              Son Arastirma: "{query}"
            </Typography>
            <Button
              size="small" variant="outlined"
              startIcon={<ArrowRight size={14} />}
              onClick={() => onNavigateToSection(1, 100)}
              sx={{ borderRadius: '10px', textTransform: 'none', ...(isMobile && { width: '100%' }) }}
            >
              Detaylara Git
            </Button>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1.5 }}>
            <StatCard label="Toplam Sonuc" value={totalResults.toLocaleString()} color="#667eea" icon={<BarChart2 size={16} />} />
            <StatCard label="Ort. Fiyat" value={`$${avgPrice}`} color="#11998e" />
            <StatCard label="Ort. Favori" value={String(avgFav)} color="#e91e63" icon={<Star size={16} />} />
            <StatCard label="Benzersiz Magaza" value={String(uniqueShops)} color="#9c27b0" />
          </Box>
        </Paper>
      )}

      {/* Saved Searches */}
      {savedSearches.length > 0 && (
        <Paper sx={{ ...glassCard, p: 2.5 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Clock size={16} color="#667eea" /> Kayıtlı Aramalar
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            {savedSearches.map((s, i) => (
              <Chip
                key={i}
                label={s.query}
                onClick={() => {
                  loadSearch(s);
                  onNavigateToSection(1, 100);
                }}
                onDelete={() => deleteSaved(i)}
                deleteIcon={<Trash2 size={12} />}
                sx={{
                  borderRadius: '10px', fontWeight: 600, fontSize: '0.78rem',
                  '&:hover': { bgcolor: 'rgba(102,126,234,0.08)' },
                }}
                variant="outlined"
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Discovery data — shown when no search results yet */}
      {!hasData && (
        <>
          {/* Skeleton loaders while discovery data loads */}
          {discoveryLoading && (
            <Box sx={{ mb: 3 }}>
              <Skeleton variant="text" width={200} height={32} sx={{ mb: 1.5 }} />
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} variant="rounded" height={220} sx={{ borderRadius: '16px' }} />
                ))}
              </Box>
              <Skeleton variant="text" width={180} height={32} sx={{ mt: 3, mb: 1 }} />
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {[1, 2, 3, 4, 5, 6, 7, 8].map(i => (
                  <Skeleton key={i} variant="rounded" width={90} height={32} sx={{ borderRadius: '16px' }} />
                ))}
              </Box>
            </Box>
          )}

          {/* Trending Niches */}
          {discoveryData?.trendingNiches?.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Flame size={18} color="#f44336" /> Trending Niches
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(3, 1fr)' }, gap: 2 }}>
                {discoveryData.trendingNiches.map((niche: any) => (
                  <Card key={niche.query} sx={{
                    ...glassCard, cursor: 'pointer', overflow: 'hidden',
                    '&:hover': { transform: 'translateY(-4px)', boxShadow: '0 12px 32px rgba(0,0,0,0.12)' },
                    transition: 'all 0.2s',
                  }} onClick={() => { setQuery(niche.query); setTimeout(() => searchMarket(), 50); onNavigateToSection(1, 100); }}>
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
                          {niche.totalResults?.toLocaleString()} results
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          ${niche.priceStats?.avg?.toFixed(2)} avg
                        </Typography>
                        <Typography variant="caption" sx={{ color: '#e91e63', display: 'flex', alignItems: 'center', gap: 0.3 }}>
                          <Star size={10} /> {niche.avgFavorites} fav
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
                <TrendingUp size={16} color="#667eea" /> Hot Keywords
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap' }}>
                {discoveryData.hotKeywords.map((kw: any) => (
                  <Chip key={kw.keyword} label={`${kw.keyword} (${kw.count})`} size="small" variant="outlined"
                    onClick={() => { setQuery(kw.keyword); setTimeout(() => searchMarket(), 50); onNavigateToSection(1, 100); }}
                    sx={{
                      cursor: 'pointer', borderRadius: '10px', fontWeight: 600, fontSize: '0.78rem',
                      '&:hover': { bgcolor: 'rgba(102,126,234,0.08)', borderColor: '#667eea' },
                    }}
                  />
                ))}
              </Box>
            </Paper>
          )}

          {/* Seasonal Tips */}
          {discoveryData?.seasonalTips?.length > 0 && (
            <Paper sx={{ ...glassCard, p: 2.5, mb: 3 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Lightbulb size={16} color="#ff9800" /> Seasonal Tips
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

          {/* Fallback empty state when no discovery data either */}
          {!discoveryLoading && !discoveryData && savedSearches.length === 0 && (
            <Paper sx={{
              ...glassCard, p: 4, textAlign: 'center', my: 2,
              background: 'linear-gradient(135deg, rgba(102,126,234,0.03) 0%, rgba(118,75,162,0.03) 100%)',
            }}>
              <Box sx={{ mb: 2 }}>
                <Search size={48} color="#667eea" style={{ opacity: 0.5 }} />
              </Box>
              <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>Etsy Araştırma Merkezi</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Rakipleri analiz edin, trendleri keşfedin, fiyatlandırma stratejinizi belirleyin.
              </Typography>
              <Button
                variant="contained"
                startIcon={<Search size={16} />}
                onClick={() => onNavigateToSection(1, 100)}
                sx={{ background: GRADIENTS.primary, borderRadius: '12px', textTransform: 'none', fontWeight: 600, px: 3, ...(isMobile && { width: '100%' }) }}
              >
                İlk Araştırmanızı Yapın
              </Button>
            </Paper>
          )}
        </>
      )}
    </Box>
  );
}
