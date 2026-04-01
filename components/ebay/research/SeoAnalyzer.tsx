import React, { useState, useEffect } from 'react';
import {
  Box, Typography, Paper, TextField, Button, Chip, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, CircularProgress,
  Select, MenuItem, FormControl, InputLabel, Alert, IconButton,
  useMediaQuery, useTheme, Collapse, LinearProgress, Tooltip,
  InputAdornment, Stack, Divider,
} from '@mui/material';
import {
  Search, Target, BarChart2, CheckCircle, XCircle, Sparkles,
  Copy, TrendingUp, Users, DollarSign, Type, ChevronDown, ChevronUp,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface SeoAnalyzerProps {
  userId: string;
  marketplace?: string;
  onNavigate?: (tool: string, data: any) => void;
  navigateData?: any;
  onConsumeNavigateData?: () => void;
}

interface KeywordCoverage {
  keyword: string;
  count: number;
  percentage: number;
  inMyTitle: boolean;
}

interface AspectAnalysis {
  name: string;
  topValues: { value: string; count: number }[];
}

interface SeoResult {
  totalCompetitors: number;
  seoScore: number;
  keywordCoverage: KeywordCoverage[];
  priceStats: { min: number; max: number; avg: number; median: number };
  avgTitleLength: number;
  myTitleLength: number;
  aspectAnalysis: AspectAnalysis[];
  recommendations: string[];
}

const MARKETPLACES = [
  { value: 'EBAY_US', label: '🇺🇸 eBay US' },
  { value: 'EBAY_GB', label: '🇬🇧 eBay UK' },
  { value: 'EBAY_DE', label: '🇩🇪 eBay DE' },
  { value: 'EBAY_FR', label: '🇫🇷 eBay FR' },
  { value: 'EBAY_IT', label: '🇮🇹 eBay IT' },
  { value: 'EBAY_ES', label: '🇪🇸 eBay ES' },
  { value: 'EBAY_AU', label: '🇦🇺 eBay AU' },
];

async function ebayApiCall(action: string, userId: string, params: Record<string, any> = {}) {
  const query = new URLSearchParams({
    action, user_id: userId, ...Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => [k, String(v)])
    ),
  });
  const res = await fetch(`/api/clawd/ebay?${query.toString()}`);
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API hatası: ${res.status}`);
  }
  return res.json();
}

async function ebayAiCall(action: string, userId: string, body: Record<string, any> = {}) {
  const res = await fetch(`/api/clawd/ebay-ai?action=${action}&user_id=${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `API hatası: ${res.status}`);
  }
  return res.json();
}

function ScoreColor(score: number): string {
  if (score >= 70) return '#2e7d32';
  if (score >= 40) return '#ed6c02';
  return '#d32f2f';
}

function StatCard({ icon, label, value, subtitle }: { icon: React.ReactNode; label: string; value: string | number; subtitle?: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 2, flex: '1 1 0', minWidth: 140, textAlign: 'center' }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1, color: 'text.secondary' }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" fontWeight={700}>{value}</Typography>
      {subtitle && <Typography variant="caption" color="text.secondary">{subtitle}</Typography>}
    </Paper>
  );
}

function KeywordCard({ kw, expanded, onToggle }: { kw: KeywordCoverage; expanded: boolean; onToggle: () => void }) {
  return (
    <Paper
      variant="outlined"
      sx={{
        mb: 1,
        bgcolor: !kw.inMyTitle ? 'rgba(211,47,47,0.04)' : 'transparent',
        border: !kw.inMyTitle ? '1px solid rgba(211,47,47,0.2)' : undefined,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1.5, cursor: 'pointer' }} onClick={onToggle}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" fontWeight={600}>{kw.keyword}</Typography>
          <Typography variant="caption" color="text.secondary">Kullanım: %{kw.percentage.toFixed(1)}</Typography>
        </Box>
        {kw.inMyTitle
          ? <CheckCircle size={18} color="#2e7d32" />
          : <XCircle size={18} color="#d32f2f" />
        }
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <Typography variant="caption">Rakip kullanım sayısı: {kw.count}</Typography>
        </Box>
      </Collapse>
    </Paper>
  );
}

export default function SeoAnalyzer({ userId, marketplace: defaultMarketplace, onNavigate, navigateData, onConsumeNavigateData }: SeoAnalyzerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const [keyword, setKeyword] = useState('');
  const [myTitle, setMyTitle] = useState('');
  const [selectedMarketplace, setSelectedMarketplace] = useState(defaultMarketplace || 'EBAY_US');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SeoResult | null>(null);

  const [optimizing, setOptimizing] = useState(false);
  const [optimizedTitle, setOptimizedTitle] = useState('');

  const [expandedKeywords, setExpandedKeywords] = useState<Set<number>>(new Set());

  // Consume navigateData to pre-fill keyword
  useEffect(() => {
    if (navigateData?.keyword) {
      setKeyword(navigateData.keyword);
      onConsumeNavigateData?.();
    }
  }, [navigateData, onConsumeNavigateData]);

  const handleAnalyze = async () => {
    if (!keyword.trim()) {
      toast.error('Anahtar kelime gerekli');
      return;
    }
    setLoading(true);
    setResult(null);
    setOptimizedTitle('');
    try {
      const data = await ebayApiCall('analyze_seo', userId, {
        q: keyword.trim(),
        my_title: myTitle.trim() || undefined,
        marketplace_id: selectedMarketplace,
      });
      setResult(data);
    } catch (err: any) {
      toast.error(err.message || 'Analiz başarısız');
    } finally {
      setLoading(false);
    }
  };

  const handleOptimizeTitle = async () => {
    if (!result || !myTitle.trim()) {
      toast.error('Önce başlığınızı girin ve analiz edin');
      return;
    }
    setOptimizing(true);
    try {
      const topKeywords = result.keywordCoverage
        .sort((a, b) => b.percentage - a.percentage)
        .slice(0, 15)
        .map(k => k.keyword);

      const data = await ebayAiCall('optimize_title', userId, {
        title: myTitle.trim(),
        keywords: topKeywords,
        marketResearch: {
          avgPrice: result.priceStats.avg,
          totalCompetitors: result.totalCompetitors,
        },
      });
      setOptimizedTitle(data.optimizedTitle || data.title || '');
      toast.success('Başlık optimize edildi');
    } catch (err: any) {
      toast.error(err.message || 'Optimizasyon başarısız');
    } finally {
      setOptimizing(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Kopyalandı');
  };

  const toggleKeywordExpand = (idx: number) => {
    setExpandedKeywords(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const sortedKeywords = result?.keywordCoverage
    ? [...result.keywordCoverage].sort((a, b) => b.percentage - a.percentage)
    : [];

  const renderPriceBar = () => {
    if (!result) return null;
    const { min, max, avg, median } = result.priceStats;
    const range = max - min || 1;
    const avgPos = ((avg - min) / range) * 100;
    const medianPos = ((median - min) / range) * 100;

    return (
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom>
          <DollarSign size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
          Fiyat Konumlandırma
        </Typography>
        <Box sx={{ position: 'relative', height: 40, mt: 2, mb: 3 }}>
          <Box sx={{ position: 'absolute', top: 12, left: 0, right: 0, height: 8, bgcolor: 'grey.200', borderRadius: 4 }} />
          <Tooltip title={`Min: $${min.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 8, left: 0, width: 16, height: 16, bgcolor: '#2196f3', borderRadius: '50%' }} />
          </Tooltip>
          <Tooltip title={`Ort: $${avg.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 4, left: `${avgPos}%`, transform: 'translateX(-50%)', textAlign: 'center' }}>
              <Box sx={{ width: 20, height: 20, bgcolor: '#4caf50', borderRadius: '50%', mx: 'auto' }} />
              <Typography variant="caption" sx={{ mt: 0.5, display: 'block' }}>Ort</Typography>
            </Box>
          </Tooltip>
          <Tooltip title={`Medyan: $${median.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 4, left: `${medianPos}%`, transform: 'translateX(-50%)', textAlign: 'center' }}>
              <Box sx={{ width: 20, height: 20, bgcolor: '#ff9800', borderRadius: '50%', mx: 'auto' }} />
              <Typography variant="caption" sx={{ mt: 0.5, display: 'block' }}>Med</Typography>
            </Box>
          </Tooltip>
          <Tooltip title={`Max: $${max.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 8, right: 0, width: 16, height: 16, bgcolor: '#f44336', borderRadius: '50%' }} />
          </Tooltip>
        </Box>
        <Stack direction="row" justifyContent="space-between">
          <Typography variant="caption" color="text.secondary">${min.toFixed(2)}</Typography>
          <Typography variant="caption" color="text.secondary">${max.toFixed(2)}</Typography>
        </Stack>
      </Paper>
    );
  };

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto' }}>
      <Paper variant="outlined" sx={{ p: { xs: 2, md: 3 }, mb: 3 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>
          <Target size={20} style={{ verticalAlign: 'middle', marginRight: 8 }} />
          SEO Analizi
        </Typography>

        <Stack spacing={2} sx={{ mt: 2 }}>
          <TextField
            label="Anahtar Kelime"
            placeholder="ör: wireless bluetooth earbuds"
            helperText="Analiz etmek istediğiniz ürün anahtar kelimesini girin"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            fullWidth
            required
            size={isMobile ? 'small' : 'medium'}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><Search size={18} /></InputAdornment>
              ),
            }}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
          />

          <TextField
            label="Senin Başlığın"
            placeholder="ör: Premium Wireless Bluetooth Earbuds with Noise Cancellation"
            helperText="Kendi başlığınızı girerek rakiplerle karşılaştırın (opsiyonel)"
            value={myTitle}
            onChange={e => setMyTitle(e.target.value)}
            fullWidth
            size={isMobile ? 'small' : 'medium'}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><Type size={18} /></InputAdornment>
              ),
            }}
          />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControl size={isMobile ? 'small' : 'medium'} sx={{ minWidth: 180 }}>
              <InputLabel>Pazar Yeri</InputLabel>
              <Select
                value={selectedMarketplace}
                label="Pazar Yeri"
                onChange={e => setSelectedMarketplace(e.target.value)}
              >
                {MARKETPLACES.map(m => (
                  <MenuItem key={m.value} value={m.value}>{m.label}</MenuItem>
                ))}
              </Select>
            </FormControl>

            <Button
              variant="contained"
              onClick={handleAnalyze}
              disabled={loading || !keyword.trim()}
              startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Search size={18} />}
              sx={{ minWidth: 140, textTransform: 'none', fontWeight: 600 }}
            >
              {loading ? 'Analiz ediliyor...' : 'Analiz Et'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {loading && <LinearProgress sx={{ mb: 2 }} />}

      {result && (
        <Stack spacing={3}>
          <Paper
            variant="outlined"
            sx={{
              p: 3,
              textAlign: 'center',
              bgcolor: `${ScoreColor(result.seoScore)}08`,
              borderColor: ScoreColor(result.seoScore),
            }}
          >
            <Tooltip title="0-100 arası SEO skoru. 80+ mükemmel, 60-80 iyi, 60 altı iyileştirme gerekli." arrow>
              <Typography
                variant="h1"
                fontWeight={800}
                sx={{ color: ScoreColor(result.seoScore), fontSize: { xs: 64, md: 80 }, lineHeight: 1, cursor: 'help' }}
              >
                {result.seoScore}
              </Typography>
            </Tooltip>
            <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 1 }}>
              SEO Skoru / 100
            </Typography>
          </Paper>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap">
            <StatCard
              icon={<Users size={20} />}
              label="Toplam Rakip"
              value={result.totalCompetitors.toLocaleString()}
            />
            <StatCard
              icon={<Type size={20} />}
              label="Ort. Başlık Uzunluğu"
              value={Math.round(result.avgTitleLength)}
              subtitle={result.myTitleLength ? `Seninki: ${result.myTitleLength}` : undefined}
            />
            <StatCard
              icon={<DollarSign size={20} />}
              label="Fiyat Aralığı"
              value={`$${result.priceStats.min.toFixed(0)}-${result.priceStats.max.toFixed(0)}`}
              subtitle={`Ort: $${result.priceStats.avg.toFixed(2)}`}
            />
            <StatCard
              icon={<TrendingUp size={20} />}
              label="Skor Durumu"
              value={result.seoScore >= 70 ? 'İyi' : result.seoScore >= 40 ? 'Orta' : 'Zayıf'}
            />
          </Stack>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>
              <BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              Anahtar Kelime Kapsama Analizi
            </Typography>

            {isMobile ? (
              <Box sx={{ mt: 1 }}>
                {sortedKeywords.map((kw, idx) => (
                  <KeywordCard
                    key={idx}
                    kw={kw}
                    expanded={expandedKeywords.has(idx)}
                    onToggle={() => toggleKeywordExpand(idx)}
                  />
                ))}
              </Box>
            ) : (
              <TableContainer sx={{ mt: 1 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Anahtar Kelime</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Kullanım %</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="center">Başlığında?</TableCell>
                      <TableCell sx={{ fontWeight: 700 }} align="right">Sayı</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedKeywords.map((kw, idx) => (
                      <TableRow
                        key={idx}
                        sx={{
                          bgcolor: !kw.inMyTitle ? 'rgba(211,47,47,0.04)' : 'transparent',
                        }}
                      >
                        <TableCell>
                          <Typography variant="body2" fontWeight={kw.inMyTitle ? 400 : 600}>
                            {kw.keyword}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1 }}>
                            <LinearProgress
                              variant="determinate"
                              value={Math.min(kw.percentage, 100)}
                              sx={{ width: 60, height: 6, borderRadius: 3 }}
                            />
                            <Typography variant="body2">%{kw.percentage.toFixed(1)}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          {kw.inMyTitle
                            ? <CheckCircle size={18} color="#2e7d32" />
                            : <XCircle size={18} color="#d32f2f" />
                          }
                        </TableCell>
                        <TableCell align="right">{kw.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          {renderPriceBar()}

          {result.aspectAnalysis?.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                <BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Özellik Analizi
              </Typography>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {result.aspectAnalysis.map((aspect, idx) => (
                  <Box key={idx}>
                    <Typography variant="body2" fontWeight={600} gutterBottom>{aspect.name}</Typography>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      {aspect.topValues.slice(0, 3).map((val, vIdx) => (
                        <Chip
                          key={vIdx}
                          label={`${val.value} (${val.count})`}
                          size="small"
                          variant="outlined"
                        />
                      ))}
                    </Stack>
                    {idx < result.aspectAnalysis.length - 1 && <Divider sx={{ mt: 1.5 }} />}
                  </Box>
                ))}
              </Stack>
            </Paper>
          )}

          {result.recommendations?.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom>
                <Sparkles size={16} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                Öneriler
              </Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {result.recommendations.map((rec, idx) => (
                  <Alert key={idx} severity="info" sx={{ '& .MuiAlert-message': { fontSize: '0.875rem' } }}>
                    {rec}
                  </Alert>
                ))}
              </Stack>
            </Paper>
          )}

          {myTitle.trim() && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Button
                variant="contained"
                onClick={handleOptimizeTitle}
                disabled={optimizing}
                startIcon={optimizing ? <CircularProgress size={18} color="inherit" /> : <Sparkles size={18} />}
                fullWidth={isMobile}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                {optimizing ? 'Optimize ediliyor...' : 'AI ile Başlığı Optimize Et'}
              </Button>

              {optimizedTitle && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>Mevcut Başlık:</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, bgcolor: 'rgba(211,47,47,0.04)' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2">{myTitle}</Typography>
                      <IconButton size="small" onClick={() => copyToClipboard(myTitle)}>
                        <Copy size={14} />
                      </IconButton>
                    </Box>
                  </Paper>

                  <Typography variant="caption" color="text.secondary" fontWeight={600}>Optimize Edilmiş Başlık:</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, bgcolor: 'rgba(46,125,50,0.04)', borderColor: '#2e7d32' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2" fontWeight={600}>{optimizedTitle}</Typography>
                      <IconButton size="small" onClick={() => copyToClipboard(optimizedTitle)}>
                        <Copy size={14} />
                      </IconButton>
                    </Box>
                  </Paper>
                </Box>
              )}
            </Paper>
          )}
        </Stack>
      )}
    </Box>
  );
}
