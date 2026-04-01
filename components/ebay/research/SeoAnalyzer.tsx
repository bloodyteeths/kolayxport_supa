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
  if (score >= 70) return '#10b981';
  if (score >= 40) return '#f59e0b';
  return '#ef4444';
}

function StatCard({ icon, label, value, subtitle }: { icon: React.ReactNode; label: string; value: string | number; subtitle?: string }) {
  return (
    <Paper variant="outlined" sx={{
      p: 2, flex: '1 1 0', minWidth: 140, textAlign: 'center',
      bgcolor: '#f8faff',
      border: '1px solid rgba(99,102,241,0.08)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
      borderRadius: 3,
      transition: 'all 0.2s ease',
      '&:hover': { transform: 'translateY(-2px)', boxShadow: '0 4px 20px rgba(0,0,0,0.1)' },
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 1, color: '#6366f1' }}>{icon}</Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="h6" fontWeight={700} sx={{ color: '#1e1b4b' }}>{value}</Typography>
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
        bgcolor: !kw.inMyTitle ? 'rgba(239,68,68,0.04)' : '#f8faff',
        border: !kw.inMyTitle ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(99,102,241,0.08)',
        borderRadius: 2,
        transition: 'all 0.2s ease',
        '&:hover': { boxShadow: '0 2px 8px rgba(0,0,0,0.06)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1.5, cursor: 'pointer' }} onClick={onToggle}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="body2" fontWeight={600}>{kw.keyword}</Typography>
          <Typography variant="caption" color="text.secondary">Kullanım: %{kw.percentage.toFixed(1)}</Typography>
        </Box>
        {kw.inMyTitle
          ? <CheckCircle size={18} color="#10b981" />
          : <XCircle size={18} color="#ef4444" />
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
      <Paper variant="outlined" sx={{
        p: 2.5,
        bgcolor: '#fff',
        border: '1px solid rgba(99,102,241,0.08)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        borderRadius: 3,
      }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ color: '#1e1b4b' }}>
          <DollarSign size={16} style={{ verticalAlign: 'middle', marginRight: 4, color: '#6366f1' }} />
          Fiyat Konumlandırma
        </Typography>
        <Box sx={{ position: 'relative', height: 40, mt: 2, mb: 3 }}>
          <Box sx={{ position: 'absolute', top: 12, left: 0, right: 0, height: 8, background: 'linear-gradient(90deg, #e5e7eb, #f0edff)', borderRadius: 4 }} />
          <Tooltip title={`Min: $${min.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 8, left: 0, width: 16, height: 16, bgcolor: '#6366f1', borderRadius: '50%', boxShadow: '0 0 6px rgba(99,102,241,0.4)' }} />
          </Tooltip>
          <Tooltip title={`Ort: $${avg.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 4, left: `${avgPos}%`, transform: 'translateX(-50%)', textAlign: 'center' }}>
              <Box sx={{ width: 20, height: 20, bgcolor: '#10b981', borderRadius: '50%', mx: 'auto', boxShadow: '0 0 6px rgba(16,185,129,0.4)' }} />
              <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontWeight: 600 }}>Ort</Typography>
            </Box>
          </Tooltip>
          <Tooltip title={`Medyan: $${median.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 4, left: `${medianPos}%`, transform: 'translateX(-50%)', textAlign: 'center' }}>
              <Box sx={{ width: 20, height: 20, bgcolor: '#f59e0b', borderRadius: '50%', mx: 'auto', boxShadow: '0 0 6px rgba(245,158,11,0.4)' }} />
              <Typography variant="caption" sx={{ mt: 0.5, display: 'block', fontWeight: 600 }}>Med</Typography>
            </Box>
          </Tooltip>
          <Tooltip title={`Max: $${max.toFixed(2)}`}>
            <Box sx={{ position: 'absolute', top: 8, right: 0, width: 16, height: 16, bgcolor: '#ef4444', borderRadius: '50%', boxShadow: '0 0 6px rgba(239,68,68,0.4)' }} />
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
      <Paper variant="outlined" sx={{
        p: { xs: 2, md: 3 }, mb: 3,
        bgcolor: '#f8faff',
        border: '1px solid rgba(99,102,241,0.08)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
        borderRadius: 3,
      }}>
        <Typography variant="h6" fontWeight={700} gutterBottom sx={{ color: '#1e1b4b' }}>
          <Target size={20} style={{ verticalAlign: 'middle', marginRight: 8, color: '#6366f1' }} />
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
              sx={{
                minWidth: 140, textTransform: 'none', fontWeight: 600,
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                borderRadius: 2,
                '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)', boxShadow: '0 4px 12px rgba(99,102,241,0.4)' },
              }}
            >
              {loading ? 'Analiz ediliyor...' : 'Analiz Et'}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {loading && <LinearProgress sx={{ mb: 2, borderRadius: 2, '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }, backgroundColor: '#e5e7eb' }} />}

      {!result && !loading && (
        <Paper sx={{ p: 2, mb: 3, bgcolor: '#f8faff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
          <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ color: '#1e1b4b' }}>
            SEO Analizi Nedir?
          </Typography>
          <Typography variant="body2" color="text.secondary" component="div">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              <li>Başlığınızın anahtar kelime kapsama oranını ölçer</li>
              <li>Rakip listelemelerdeki en popüler kelimeleri gösterir</li>
              <li>Fiyat konumlandırmanızı pazar ortalamasıyla karşılaştırır</li>
              <li>AI ile başlığınızı otomatik optimize edebilirsiniz</li>
            </ul>
          </Typography>
          <Typography variant="body2" sx={{ mt: 1, fontStyle: 'italic', color: '#6366f1' }}>
            Örnek: "wireless bluetooth earbuds" yazıp analiz edin
          </Typography>
        </Paper>
      )}

      {result && (
        <Stack spacing={3}>
          <Paper
            variant="outlined"
            sx={{
              p: 4,
              textAlign: 'center',
              background: 'linear-gradient(135deg, #f8faff 0%, #f0edff 100%)',
              border: '1px solid rgba(99,102,241,0.08)',
              boxShadow: '0 4px 24px rgba(99,102,241,0.12)',
              borderRadius: 4,
              position: 'relative',
              overflow: 'visible',
            }}
          >
            <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
              <svg width="140" height="140" viewBox="0 0 140 140" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="70" cy="70" r="60" fill="none" stroke="#e5e7eb" strokeWidth="8" />
                <circle
                  cx="70" cy="70" r="60" fill="none"
                  stroke={ScoreColor(result.seoScore)}
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${(result.seoScore / 100) * 377} 377`}
                  style={{ filter: `drop-shadow(0 0 8px ${ScoreColor(result.seoScore)}40)` }}
                />
              </svg>
              <Box sx={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Tooltip title="0-100 arası SEO skoru. 80+ mükemmel, 60-80 iyi, 60 altı iyileştirme gerekli." arrow>
                  <Typography
                    variant="h2"
                    fontWeight={800}
                    sx={{ color: ScoreColor(result.seoScore), fontSize: { xs: 40, md: 48 }, lineHeight: 1, cursor: 'help' }}
                  >
                    {result.seoScore}
                  </Typography>
                </Tooltip>
              </Box>
            </Box>
            <Typography variant="subtitle1" color="text.secondary" sx={{ mt: 1, fontWeight: 500 }}>
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

          <Paper variant="outlined" sx={{
            p: 2,
            bgcolor: '#fff',
            border: '1px solid rgba(99,102,241,0.08)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
            borderRadius: 3,
          }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ color: '#1e1b4b' }}>
              <BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 4, color: '#6366f1' }} />
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
                    <TableRow sx={{ background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                      <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>Anahtar Kelime</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }} align="right">Kullanım %</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }} align="center">Başlığında?</TableCell>
                      <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }} align="right">Sayı</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {sortedKeywords.map((kw, idx) => (
                      <TableRow
                        key={idx}
                        sx={{
                          bgcolor: !kw.inMyTitle ? 'rgba(239,68,68,0.04)' : idx % 2 === 0 ? '#f8faff' : '#fff',
                          transition: 'background-color 0.15s ease',
                          '&:hover': { bgcolor: !kw.inMyTitle ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.06)' },
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
                              sx={{ width: 60, height: 6, borderRadius: 3, '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }, backgroundColor: '#e5e7eb' }}
                            />
                            <Typography variant="body2">%{kw.percentage.toFixed(1)}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="center">
                          {kw.inMyTitle
                            ? <CheckCircle size={18} color="#10b981" />
                            : <XCircle size={18} color="#ef4444" />
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
            <Paper variant="outlined" sx={{
              p: 2,
              bgcolor: '#fff',
              border: '1px solid rgba(99,102,241,0.08)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              borderRadius: 3,
            }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ color: '#1e1b4b' }}>
                <BarChart2 size={16} style={{ verticalAlign: 'middle', marginRight: 4, color: '#6366f1' }} />
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
            <Paper variant="outlined" sx={{
              p: 2,
              bgcolor: '#fff',
              border: '1px solid rgba(99,102,241,0.08)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              borderRadius: 3,
            }}>
              <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ color: '#1e1b4b' }}>
                <Sparkles size={16} style={{ verticalAlign: 'middle', marginRight: 4, color: '#8b5cf6' }} />
                Öneriler
              </Typography>
              <Stack spacing={1} sx={{ mt: 1 }}>
                {result.recommendations.map((rec, idx) => (
                  <Alert key={idx} severity="info" sx={{
                    '& .MuiAlert-message': { fontSize: '0.875rem' },
                    bgcolor: '#f8faff',
                    borderLeft: '3px solid #6366f1',
                    border: '1px solid rgba(99,102,241,0.12)',
                    borderLeftWidth: '3px',
                    '& .MuiAlert-icon': { color: '#6366f1' },
                  }}>
                    {rec}
                  </Alert>
                ))}
              </Stack>
            </Paper>
          )}

          {myTitle.trim() && (
            <Paper variant="outlined" sx={{
              p: 2,
              bgcolor: '#fff',
              border: '1px solid rgba(99,102,241,0.08)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
              borderRadius: 3,
            }}>
              <Button
                variant="contained"
                onClick={handleOptimizeTitle}
                disabled={optimizing}
                startIcon={optimizing ? <CircularProgress size={18} color="inherit" /> : <Sparkles size={18} />}
                fullWidth={isMobile}
                sx={{
                  textTransform: 'none', fontWeight: 600,
                  background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                  boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                  borderRadius: 2,
                  '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' },
                }}
              >
                {optimizing ? 'Optimize ediliyor...' : 'AI ile Başlığı Optimize Et'}
              </Button>

              {optimizedTitle && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>Mevcut Başlık:</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, bgcolor: '#fff5f5', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 2 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="body2">{myTitle}</Typography>
                      <IconButton size="small" onClick={() => copyToClipboard(myTitle)}>
                        <Copy size={14} />
                      </IconButton>
                    </Box>
                  </Paper>

                  <Typography variant="caption" color="text.secondary" fontWeight={600}>Optimize Edilmiş Başlık:</Typography>
                  <Paper variant="outlined" sx={{ p: 1.5, bgcolor: '#f0fdf4', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 2, boxShadow: '0 0 8px rgba(16,185,129,0.08)' }}>
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
