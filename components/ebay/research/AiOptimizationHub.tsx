import React, { useState, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Select, MenuItem,
  FormControl, InputLabel, Alert, CircularProgress, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Stack,
  LinearProgress, useMediaQuery, useTheme,
} from '@mui/material';
import {
  Type, Edit3, DollarSign, BarChart2, Tag, Zap, Sparkles, Copy,
  CheckCircle, AlertTriangle, Info,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface AiOptimizationHubProps {
  userId: string;
  marketplace?: string;
  onNavigate?: (tool: string, data: any) => void;
}

interface MarketContext {
  avgPrice?: number;
  medianPrice?: number;
  totalResults?: number;
  topKeywords?: string[];
  competitorPrices?: number[];
  freeShippingPct?: number;
}

type TabKey = 'title' | 'description' | 'price' | 'analyze' | 'aspects' | 'bulk';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'title', label: 'Başlık Optimize', icon: <Type size={16} /> },
  { key: 'description', label: 'Açıklama Yaz', icon: <Edit3 size={16} /> },
  { key: 'price', label: 'Fiyat Öner', icon: <DollarSign size={16} /> },
  { key: 'analyze', label: 'Liste Analiz', icon: <BarChart2 size={16} /> },
  { key: 'aspects', label: 'Özellik Öner', icon: <Tag size={16} /> },
  { key: 'bulk', label: 'Toplu Optimize', icon: <Zap size={16} /> },
];

async function fetchMarketContext(keyword: string, userId: string, marketplace: string): Promise<MarketContext | null> {
  try {
    const params = new URLSearchParams({
      action: 'search_market',
      q: keyword,
      user_id: userId,
      marketplace_id: marketplace,
      limit: '30',
    });
    const res = await fetch(`/api/clawd/ebay?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      avgPrice: data.priceStats?.avg,
      medianPrice: data.priceStats?.median,
      totalResults: data.total,
      topKeywords: data.topKeywords?.map((k: any) => k.keyword),
      competitorPrices: data.items?.map((i: any) => parseFloat(i.price?.value || '0')).filter(Boolean),
      freeShippingPct: data.items
        ? (data.items.filter((i: any) => i.shippingOptions?.[0]?.shippingCost?.value === '0.00').length / data.items.length * 100)
        : 0,
    };
  } catch {
    return null;
  }
}

async function callAi(action: string, body: Record<string, any>, userId: string) {
  const res = await fetch(`/api/clawd/ebay-ai?action=${action}&user_id=${userId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'AI isteği başarısız oldu');
  }
  return res.json();
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success('Kopyalandı!'),
    () => toast.error('Kopyalama başarısız'),
  );
}

function scoreColor(score: number): string {
  if (score >= 80) return '#2e7d32';
  if (score >= 60) return '#ed6c02';
  return '#d32f2f';
}

function severityToMui(severity: string): 'error' | 'warning' | 'info' {
  if (severity === 'critical') return 'error';
  if (severity === 'warning') return 'warning';
  return 'info';
}

// ---------------------------------------------------------------------------
// Tab 1: Title Optimizer
// ---------------------------------------------------------------------------
function TitleOptimizer({ userId, marketplace }: { userId: string; marketplace: string }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    if (!title.trim()) { toast.error('Başlık giriniz'); return; }
    setLoading(true);
    setResult(null);
    try {
      setStatus('Pazar verisi alınıyor...');
      const market = await fetchMarketContext(title, userId, marketplace);
      setStatus('AI çalışıyor...');
      const res = await callAi('optimize_title', {
        title,
        categoryName: category || undefined,
        marketResearch: market,
      }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [title, category, userId, marketplace]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Mevcut Başlık" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <TextField label="Kategori (opsiyonel)" value={category} onChange={e => setCategory(e.target.value)} fullWidth />
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Sparkles size={18} />}
        onClick={run}
        disabled={loading}
      >
        {loading ? status : 'AI ile Optimize Et'}
      </Button>

      {result && (
        <Paper sx={{ p: 2, mt: 1 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Karşılaştırma</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ p: 1.5, bgcolor: '#fff5f5', borderRadius: 1, border: '1px solid #ffcdd2' }}>
              <Typography variant="caption" color="error">Önceki</Typography>
              <Typography>{title}</Typography>
            </Box>
            <Box sx={{ p: 1.5, bgcolor: '#f1f8e9', borderRadius: 1, border: '1px solid #c5e1a5' }}>
              <Typography variant="caption" color="success.main">Sonra</Typography>
              <Typography fontWeight={600}>{result.optimizedTitle}</Typography>
            </Box>
          </Box>

          {result.score && (
            <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              <Typography variant="body2">
                Skor: <span style={{ color: scoreColor(result.score.before) }}>{result.score.before}</span>
                {' → '}
                <span style={{ color: scoreColor(result.score.after) }}>{result.score.after}</span>
              </Typography>
            </Box>
          )}

          {result.suggestions?.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Öneriler</Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {result.suggestions.map((s: string, i: number) => (
                  <li key={i}><Typography variant="body2">{s}</Typography></li>
                ))}
              </ul>
            </Box>
          )}

          <Button size="small" startIcon={<Copy size={14} />} onClick={() => copyToClipboard(result.optimizedTitle)} sx={{ mt: 1.5 }}>
            Kopyala
          </Button>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tab 2: Description Generator
// ---------------------------------------------------------------------------
function DescriptionGenerator({ userId, marketplace }: { userId: string; marketplace: string }) {
  const [title, setTitle] = useState('');
  const [condition, setCondition] = useState('NEW');
  const [price, setPrice] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    if (!title.trim()) { toast.error('Ürün başlığı giriniz'); return; }
    setLoading(true);
    setResult(null);
    try {
      setStatus('Pazar verisi alınıyor...');
      const market = await fetchMarketContext(title, userId, marketplace);
      setStatus('AI çalışıyor...');
      const res = await callAi('generate_description', {
        title,
        condition,
        price: price ? parseFloat(price) : undefined,
        marketResearch: market,
      }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [title, condition, price, userId, marketplace]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Ürün Başlığı" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <FormControl fullWidth>
        <InputLabel>Durum</InputLabel>
        <Select value={condition} label="Durum" onChange={e => setCondition(e.target.value)}>
          <MenuItem value="NEW">Yeni</MenuItem>
          <MenuItem value="USED">Kullanılmış</MenuItem>
          <MenuItem value="REFURBISHED">Yenilenmiş</MenuItem>
        </Select>
      </FormControl>
      <TextField label="Fiyat" type="number" value={price} onChange={e => setPrice(e.target.value)} fullWidth />
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Edit3 size={18} />}
        onClick={run}
        disabled={loading}
      >
        {loading ? status : 'Açıklama Oluştur'}
      </Button>

      {result?.description && (
        <Paper sx={{ p: 2, mt: 1 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>Oluşturulan Açıklama</Typography>
          <Box
            sx={{ p: 2, border: '1px solid #e0e0e0', borderRadius: 1, bgcolor: '#fafafa', maxHeight: 400, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: result.description }}
          />
          <Button size="small" startIcon={<Copy size={14} />} onClick={() => copyToClipboard(result.description)} sx={{ mt: 1.5 }}>
            Kopyala
          </Button>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tab 3: Price Advisor
// ---------------------------------------------------------------------------
function PriceAdvisor({ userId, marketplace }: { userId: string; marketplace: string }) {
  const [title, setTitle] = useState('');
  const [condition, setCondition] = useState('NEW');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);
  const [marketCtx, setMarketCtx] = useState<MarketContext | null>(null);

  const run = useCallback(async () => {
    if (!title.trim()) { toast.error('Ürün başlığı giriniz'); return; }
    setLoading(true);
    setResult(null);
    setMarketCtx(null);
    try {
      setStatus('Pazar verisi alınıyor...');
      const market = await fetchMarketContext(title, userId, marketplace);
      setMarketCtx(market);
      setStatus('AI çalışıyor...');
      const res = await callAi('suggest_price', {
        title,
        condition,
        categoryName: category || undefined,
        competitorPrices: market?.competitorPrices,
        marketResearch: market,
      }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [title, condition, category, userId, marketplace]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Ürün Başlığı" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <FormControl fullWidth>
        <InputLabel>Durum</InputLabel>
        <Select value={condition} label="Durum" onChange={e => setCondition(e.target.value)}>
          <MenuItem value="NEW">Yeni</MenuItem>
          <MenuItem value="USED">Kullanılmış</MenuItem>
          <MenuItem value="REFURBISHED">Yenilenmiş</MenuItem>
        </Select>
      </FormControl>
      <TextField label="Kategori (opsiyonel)" value={category} onChange={e => setCategory(e.target.value)} fullWidth />
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <DollarSign size={18} />}
        onClick={run}
        disabled={loading}
      >
        {loading ? status : 'Fiyat Önerisi Al'}
      </Button>

      {result && (
        <Paper sx={{ p: 2, mt: 1 }}>
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <Typography variant="h3" fontWeight={700} color="primary">
              ${typeof result.suggestedPrice === 'number' ? result.suggestedPrice.toFixed(2) : result.suggestedPrice}
            </Typography>
            <Typography variant="body2" color="text.secondary">Önerilen Fiyat</Typography>
          </Box>

          {result.priceRange && (
            <Box sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption">${result.priceRange.min?.toFixed(2)}</Typography>
                <Typography variant="caption" fontWeight={600}>${typeof result.suggestedPrice === 'number' ? result.suggestedPrice.toFixed(2) : result.suggestedPrice}</Typography>
                <Typography variant="caption">${result.priceRange.max?.toFixed(2)}</Typography>
              </Box>
              <Box sx={{ position: 'relative', height: 8, bgcolor: '#e0e0e0', borderRadius: 4, overflow: 'hidden' }}>
                {result.priceRange.min != null && result.priceRange.max != null && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: `${((result.suggestedPrice - result.priceRange.min) / (result.priceRange.max - result.priceRange.min)) * 100}%`,
                      top: -2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      transform: 'translateX(-50%)',
                    }}
                  />
                )}
                <LinearProgress
                  variant="determinate"
                  value={result.priceRange.min != null && result.priceRange.max != null
                    ? ((result.suggestedPrice - result.priceRange.min) / (result.priceRange.max - result.priceRange.min)) * 100
                    : 50}
                  sx={{ height: 8, borderRadius: 4 }}
                />
              </Box>
            </Box>
          )}

          {result.reasoning && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Gerekçe</Typography>
              <Typography variant="body2" color="text.secondary">{result.reasoning}</Typography>
            </Box>
          )}

          {marketCtx && (marketCtx.avgPrice || marketCtx.medianPrice) && (
            <Box sx={{ p: 1.5, bgcolor: '#f5f5f5', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Pazar Verileri</Typography>
              <Stack direction="row" spacing={3}>
                {marketCtx.avgPrice != null && (
                  <Typography variant="body2">Ortalama: <b>${marketCtx.avgPrice.toFixed(2)}</b></Typography>
                )}
                {marketCtx.medianPrice != null && (
                  <Typography variant="body2">Medyan: <b>${marketCtx.medianPrice.toFixed(2)}</b></Typography>
                )}
                {marketCtx.totalResults != null && (
                  <Typography variant="body2">Sonuç: <b>{marketCtx.totalResults}</b></Typography>
                )}
              </Stack>
            </Box>
          )}

          <Button size="small" startIcon={<Copy size={14} />} onClick={() => copyToClipboard(String(result.suggestedPrice))} sx={{ mt: 1.5 }}>
            Kopyala
          </Button>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tab 4: Listing Analyzer
// ---------------------------------------------------------------------------
function ListingAnalyzer({ userId, marketplace }: { userId: string; marketplace: string }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [imageCount, setImageCount] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    if (!title.trim()) { toast.error('Ürün başlığı giriniz'); return; }
    setLoading(true);
    setResult(null);
    try {
      setStatus('Pazar verisi alınıyor...');
      const market = await fetchMarketContext(title, userId, marketplace);
      setStatus('AI çalışıyor...');
      const res = await callAi('analyze_listing', {
        title,
        description: description || undefined,
        price: price ? parseFloat(price) : undefined,
        imageCount: imageCount ? parseInt(imageCount) : undefined,
        marketResearch: market,
      }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [title, description, price, imageCount, userId, marketplace]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Ürün Başlığı" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <TextField label="Açıklama (opsiyonel)" value={description} onChange={e => setDescription(e.target.value)} fullWidth multiline rows={3} />
      <Stack direction="row" spacing={2}>
        <TextField label="Fiyat (opsiyonel)" type="number" value={price} onChange={e => setPrice(e.target.value)} fullWidth />
        <TextField label="Resim Sayısı (opsiyonel)" type="number" value={imageCount} onChange={e => setImageCount(e.target.value)} fullWidth />
      </Stack>
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <BarChart2 size={18} />}
        onClick={run}
        disabled={loading}
      >
        {loading ? status : 'Analiz Et'}
      </Button>

      {result && (
        <Paper sx={{ p: 2, mt: 1 }}>
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <Box
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 80,
                height: 80,
                borderRadius: '50%',
                border: `4px solid ${scoreColor(result.score)}`,
                mb: 1,
              }}
            >
              <Typography variant="h4" fontWeight={700} color={scoreColor(result.score)}>
                {result.score}
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">Liste Skoru</Typography>
          </Box>

          {result.issues?.length > 0 && (
            <Box sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Typography variant="subtitle2">Sorunlar</Typography>
              {result.issues.map((issue: any, i: number) => (
                <Alert key={i} severity={severityToMui(issue.severity)} icon={
                  issue.severity === 'critical' ? <AlertTriangle size={18} /> :
                  issue.severity === 'warning' ? <Info size={18} /> :
                  <CheckCircle size={18} />
                }>
                  {issue.message}
                </Alert>
              ))}
            </Box>
          )}

          {result.tips?.length > 0 && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>İpuçları</Typography>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {result.tips.map((tip: string, i: number) => (
                  <li key={i}><Typography variant="body2">{tip}</Typography></li>
                ))}
              </ul>
            </Box>
          )}
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tab 5: Aspect Suggester
// ---------------------------------------------------------------------------
function AspectSuggester({ userId, marketplace }: { userId: string; marketplace: string }) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    if (!title.trim()) { toast.error('Ürün başlığı giriniz'); return; }
    setLoading(true);
    setResult(null);
    try {
      setStatus('Pazar verisi alınıyor...');
      const market = await fetchMarketContext(title, userId, marketplace);
      setStatus('AI çalışıyor...');
      const res = await callAi('suggest_aspects', {
        title,
        categoryName: category || undefined,
        marketResearch: market,
      }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [title, category, userId, marketplace]);

  const aspects = result?.aspects || {};
  const aspectEntries = Object.entries(aspects);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Ürün Başlığı" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <TextField label="Kategori" value={category} onChange={e => setCategory(e.target.value)} fullWidth />
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Tag size={18} />}
        onClick={run}
        disabled={loading}
      >
        {loading ? status : 'Özellik Öner'}
      </Button>

      {aspectEntries.length > 0 && (
        <TableContainer component={Paper} sx={{ mt: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Özellik</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Önerilen Değerler</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {aspectEntries.map(([name, values]) => (
                <TableRow key={name}>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>{name}</Typography>
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {(values as string[]).map((v, i) => (
                        <Chip
                          key={i}
                          label={v}
                          size="small"
                          variant="outlined"
                          onClick={() => copyToClipboard(v)}
                          sx={{ cursor: 'pointer' }}
                        />
                      ))}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Tab 6: Bulk Title Optimizer
// ---------------------------------------------------------------------------
function BulkTitleOptimizer({ userId }: { userId: string }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const run = useCallback(async () => {
    const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { toast.error('En az bir başlık giriniz'); return; }
    if (lines.length > 10) { toast.error('Maksimum 10 başlık girilebilir'); return; }
    setLoading(true);
    setResult(null);
    try {
      const listings = lines.map((title, i) => ({ id: String(i + 1), title }));
      const res = await callAi('bulk_optimize_titles', { listings }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }, [input, userId]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        label="Her satıra bir başlık girin (max 10)"
        value={input}
        onChange={e => setInput(e.target.value)}
        fullWidth
        multiline
        rows={5}
      />
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Zap size={18} />}
        onClick={run}
        disabled={loading}
      >
        {loading ? 'AI çalışıyor...' : 'Toplu Optimize Et'}
      </Button>

      {result?.results?.length > 0 && (
        <TableContainer component={Paper} sx={{ mt: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 600 }}>Orijinal</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Optimize Edilmiş</TableCell>
                <TableCell sx={{ fontWeight: 600, width: 60 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {result.results.map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>
                    <Typography variant="body2">{r.original}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500} color="success.main">{r.optimized}</Typography>
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => copyToClipboard(r.optimized)}>
                      <Copy size={14} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Hub
// ---------------------------------------------------------------------------
export default function AiOptimizationHub({ userId, marketplace = 'EBAY_US', onNavigate }: AiOptimizationHubProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('title');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>
        AI Optimizasyon Merkezi
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 3, overflowX: 'auto', pb: 1, '&::-webkit-scrollbar': { height: 4 } }}>
        {TABS.map(tab => (
          <Chip
            key={tab.key}
            icon={<>{tab.icon}</>}
            label={isMobile ? undefined : tab.label}
            onClick={() => setActiveTab(tab.key)}
            color={activeTab === tab.key ? 'primary' : 'default'}
            variant={activeTab === tab.key ? 'filled' : 'outlined'}
            sx={{ flexShrink: 0, fontWeight: activeTab === tab.key ? 600 : 400 }}
          />
        ))}
      </Box>

      <Box sx={{ maxWidth: 720 }}>
        {activeTab === 'title' && <TitleOptimizer userId={userId} marketplace={marketplace} />}
        {activeTab === 'description' && <DescriptionGenerator userId={userId} marketplace={marketplace} />}
        {activeTab === 'price' && <PriceAdvisor userId={userId} marketplace={marketplace} />}
        {activeTab === 'analyze' && <ListingAnalyzer userId={userId} marketplace={marketplace} />}
        {activeTab === 'aspects' && <AspectSuggester userId={userId} marketplace={marketplace} />}
        {activeTab === 'bulk' && <BulkTitleOptimizer userId={userId} />}
      </Box>
    </Box>
  );
}
