import React, { useState, useMemo } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Alert, Tabs, Tab, Select, MenuItem, FormControl,
  InputLabel, Tooltip, IconButton, CircularProgress,
} from '@mui/material';
import { Search, TrendingUp, DollarSign, Tag, BarChart2, ExternalLink, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

interface MarketResearchProps {
  apiKey: string;
  userId: string;
  /** Pre-fill search with listing title for SEO analysis */
  initialQuery?: string;
  initialTitle?: string;
}

interface PriceStats {
  min: number;
  max: number;
  avg: number;
  median: number;
  count: number;
}

interface KeywordData {
  keyword: string;
  count: number;
  percentage: number;
  inMyTitle?: boolean;
}

interface MarketItem {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  condition: string;
  image?: { imageUrl: string };
  itemWebUrl: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
}

interface AspectAnalysis {
  name: string;
  topValues: { value: string; count: number }[];
}

export default function MarketResearch({ apiKey, userId, initialQuery, initialTitle }: MarketResearchProps) {
  const [tab, setTab] = useState(0);
  const [query, setQuery] = useState(initialQuery || '');
  const [myTitle, setMyTitle] = useState(initialTitle || '');
  const [marketplace, setMarketplace] = useState('EBAY_US');
  const [loading, setLoading] = useState(false);

  // Market search results
  const [items, setItems] = useState<MarketItem[]>([]);
  const [priceStats, setPriceStats] = useState<PriceStats | null>(null);
  const [topKeywords, setTopKeywords] = useState<KeywordData[]>([]);
  const [totalResults, setTotalResults] = useState(0);

  // SEO analysis results
  const [seoScore, setSeoScore] = useState<number | null>(null);
  const [keywordCoverage, setKeywordCoverage] = useState<KeywordData[]>([]);
  const [aspectAnalysis, setAspectAnalysis] = useState<AspectAnalysis[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [avgTitleLength, setAvgTitleLength] = useState(0);

  const searchMarket = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'search_market',
        q: query,
        user_id: userId,
        marketplace_id: marketplace,
        limit: '100',
      });

      const res = await fetch(`/api/clawd/ebay?${params}`, {
        headers: { 'x-api-key': apiKey },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Arama başarısız');
      }

      const data = await res.json();
      setItems(data.items || []);
      setPriceStats(data.priceStats);
      setTopKeywords(data.topKeywords || []);
      setTotalResults(data.total || 0);
      toast.success(`${data.total} sonuç bulundu`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const analyzeSEO = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'analyze_seo',
        q: query,
        user_id: userId,
        marketplace_id: marketplace,
        my_title: myTitle,
      });

      const res = await fetch(`/api/clawd/ebay?${params}`, {
        headers: { 'x-api-key': apiKey },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Analiz başarısız');
      }

      const data = await res.json();
      setSeoScore(data.seoScore);
      setKeywordCoverage(data.keywordCoverage || []);
      setAspectAnalysis(data.aspectAnalysis || []);
      setRecommendations(data.recommendations || []);
      setAvgTitleLength(data.avgTitleLength || 0);
      setPriceStats(data.priceStats);
      setTotalResults(data.totalCompetitors || 0);
      toast.success('SEO analizi tamamlandı');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const seoColor = seoScore !== null
    ? seoScore >= 70 ? 'success' : seoScore >= 40 ? 'warning' : 'error'
    : 'info';

  return (
    <Box>
      {/* Search Bar */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <TextField
            label="Ürün Arama"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            size="small"
            sx={{ flex: 1, minWidth: 200 }}
            placeholder="ör: baby monitor, vintage lamp..."
            onKeyDown={(e) => e.key === 'Enter' && (tab === 0 ? searchMarket() : analyzeSEO())}
          />
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>Pazar</InputLabel>
            <Select value={marketplace} onChange={(e) => setMarketplace(e.target.value)} label="Pazar">
              <MenuItem value="EBAY_US">ABD</MenuItem>
              <MenuItem value="EBAY_GB">İngiltere</MenuItem>
              <MenuItem value="EBAY_DE">Almanya</MenuItem>
              <MenuItem value="EBAY_FR">Fransa</MenuItem>
              <MenuItem value="EBAY_IT">İtalya</MenuItem>
              <MenuItem value="EBAY_ES">İspanya</MenuItem>
              <MenuItem value="EBAY_AU">Avustralya</MenuItem>
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={tab === 0 ? searchMarket : analyzeSEO}
            disabled={loading || !query.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}
          >
            {tab === 0 ? 'Araştır' : 'Analiz Et'}
          </Button>
        </Box>

        {tab === 1 && (
          <TextField
            label="Benim Başlığım (karşılaştırma için)"
            value={myTitle}
            onChange={(e) => setMyTitle(e.target.value)}
            size="small"
            fullWidth
            sx={{ mt: 1 }}
            placeholder="Listeleme başlığınızı girin..."
            helperText={`${myTitle.length}/80 karakter`}
          />
        )}
      </Paper>

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab icon={<DollarSign size={16} />} iconPosition="start" label="Fiyat Araştırması" />
        <Tab icon={<TrendingUp size={16} />} iconPosition="start" label="SEO Analizi" />
        <Tab icon={<Tag size={16} />} iconPosition="start" label="Anahtar Kelimeler" />
        <Tab icon={<BarChart2 size={16} />} iconPosition="start" label="Rakip Listeleri" />
      </Tabs>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {/* Tab 0: Price Research */}
      {tab === 0 && priceStats && (
        <Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            {[
              { label: 'Minimum', value: `$${priceStats.min.toFixed(2)}`, color: '#4caf50' },
              { label: 'Ortalama', value: `$${priceStats.avg.toFixed(2)}`, color: '#2196f3' },
              { label: 'Medyan', value: `$${priceStats.median.toFixed(2)}`, color: '#ff9800' },
              { label: 'Maksimum', value: `$${priceStats.max.toFixed(2)}`, color: '#f44336' },
              { label: 'Sonuç', value: `${totalResults}`, color: '#9c27b0' },
            ].map((stat) => (
              <Paper key={stat.label} sx={{ p: 1.5, flex: 1, minWidth: 100, textAlign: 'center' }}>
                <Typography variant="caption" color="text.secondary">{stat.label}</Typography>
                <Typography variant="h6" sx={{ color: stat.color, fontWeight: 700 }}>{stat.value}</Typography>
              </Paper>
            ))}
          </Box>

          <Alert severity="info" sx={{ mb: 2 }}>
            {totalResults} aktif listeleme analiz edildi. Fiyatlandırma stratejiniz için medyan fiyatı referans alın.
          </Alert>
        </Box>
      )}

      {/* Tab 1: SEO Analysis */}
      {tab === 1 && seoScore !== null && (
        <Box>
          <Paper sx={{ p: 2, mb: 2, textAlign: 'center' }}>
            <Typography variant="h4" sx={{
              color: seoScore >= 70 ? 'success.main' : seoScore >= 40 ? 'warning.main' : 'error.main',
              fontWeight: 700,
            }}>
              {seoScore}/100
            </Typography>
            <Typography variant="body2" color="text.secondary">
              SEO Skoru — Rakiplerin popüler kelimelerine göre
            </Typography>
            <LinearProgress
              variant="determinate"
              value={seoScore}
              color={seoColor as any}
              sx={{ mt: 1, height: 8, borderRadius: 4 }}
            />
          </Paper>

          {recommendations.length > 0 && (
            <Alert severity={seoScore >= 70 ? 'success' : 'warning'} sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>Öneriler</Typography>
              {recommendations.map((rec, i) => (
                <Typography key={i} variant="body2">• {rec}</Typography>
              ))}
            </Alert>
          )}

          {/* Keyword coverage table */}
          {keywordCoverage.length > 0 && (
            <TableContainer component={Paper} sx={{ mb: 2, maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    <TableCell>Anahtar Kelime</TableCell>
                    <TableCell align="center">Kullanım %</TableCell>
                    <TableCell align="center">Başlığımda</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {keywordCoverage.slice(0, 20).map((kw) => (
                    <TableRow key={kw.keyword} sx={{ bgcolor: kw.inMyTitle ? 'action.selected' : 'transparent' }}>
                      <TableCell>
                        <Typography variant="body2" sx={{ fontWeight: kw.inMyTitle ? 600 : 400 }}>
                          {kw.keyword}
                        </Typography>
                      </TableCell>
                      <TableCell align="center">
                        <Chip label={`%${kw.percentage}`} size="small"
                          color={kw.percentage >= 50 ? 'error' : kw.percentage >= 25 ? 'warning' : 'default'}
                          variant="outlined"
                        />
                      </TableCell>
                      <TableCell align="center">
                        {kw.inMyTitle
                          ? <CheckCircle size={18} color="#4caf50" />
                          : <XCircle size={18} color="#ccc" />
                        }
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}

          {/* Aspect analysis */}
          {aspectAnalysis.length > 0 && (
            <Paper sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                Popüler Ürün Özellikleri
              </Typography>
              {aspectAnalysis.slice(0, 8).map((aspect) => (
                <Box key={aspect.name} sx={{ mb: 1.5 }}>
                  <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>{aspect.name}</Typography>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {aspect.topValues.slice(0, 6).map((v) => (
                      <Chip
                        key={v.value}
                        label={`${v.value} (${v.count})`}
                        size="small"
                        variant="outlined"
                      />
                    ))}
                  </Box>
                </Box>
              ))}
            </Paper>
          )}
        </Box>
      )}

      {/* Tab 2: Keywords */}
      {tab === 2 && topKeywords.length > 0 && (
        <Box>
          <Alert severity="info" sx={{ mb: 2 }}>
            Rakiplerin başlıklarından çıkarılan en popüler anahtar kelimeler. Başlığınızda bunları kullanmayı deneyin.
          </Alert>
          <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
            {topKeywords.map((kw) => (
              <Chip
                key={kw.keyword}
                label={`${kw.keyword} (${kw.percentage}%)`}
                size="small"
                color={kw.percentage >= 40 ? 'error' : kw.percentage >= 20 ? 'warning' : 'default'}
                variant={kw.percentage >= 30 ? 'filled' : 'outlined'}
                onClick={() => {
                  navigator.clipboard.writeText(kw.keyword);
                  toast.success(`"${kw.keyword}" kopyalandı`);
                }}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>
        </Box>
      )}

      {/* Tab 3: Competitor Listings */}
      {tab === 3 && items.length > 0 && (
        <TableContainer component={Paper} sx={{ maxHeight: 500 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 50 }}></TableCell>
                <TableCell>Başlık</TableCell>
                <TableCell align="right">Fiyat</TableCell>
                <TableCell>Durum</TableCell>
                <TableCell>Satıcı</TableCell>
                <TableCell sx={{ width: 40 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.slice(0, 50).map((item) => (
                <TableRow key={item.itemId} hover>
                  <TableCell>
                    {item.image?.imageUrl && (
                      <img src={item.image.imageUrl} alt="" style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 4 }} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      ${parseFloat(item.price?.value || '0').toFixed(2)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip label={item.condition || 'N/A'} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell>
                    <Typography variant="caption">
                      {item.seller?.username} ({item.seller?.feedbackScore})
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => window.open(item.itemWebUrl, '_blank')}>
                      <ExternalLink size={14} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && seoScore === null && (
        <Paper sx={{ p: 4, textAlign: 'center' }}>
          <Search size={48} color="#ccc" />
          <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>
            Ürün adı girin ve araştırmaya başlayın
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Fiyat analizi, SEO anahtar kelime araştırması ve rakip analizi yapabilirsiniz
          </Typography>
        </Paper>
      )}
    </Box>
  );
}
