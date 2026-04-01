import React, { useState, useCallback, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Select, MenuItem,
  FormControl, InputLabel, Alert, CircularProgress, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, IconButton, Stack,
  LinearProgress, useMediaQuery, useTheme, Tooltip,
} from '@mui/material';
import {
  Type, Edit3, DollarSign, BarChart2, Tag, Zap, Sparkles, Copy,
  CheckCircle, AlertTriangle, Info, X, Code,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

interface AiOptimizationHubProps {
  userId: string;
  marketplace?: string;
  onNavigate?: (tool: string, data: any) => void;
  navigateData?: any;
  onConsumeNavigateData?: () => void;
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

function stripHtml(html: string): string {
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

const DEFAULT_ASPECT_NAMES = [
  'Brand', 'Model', 'Color', 'Size', 'Material', 'Type', 'Style', 'Country/Region of Manufacture',
];

function scoreColor(score: number): string {
  if (score >= 80) return '#10b981';
  if (score >= 60) return '#f59e0b';
  return '#ef4444';
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
      <TextField label="Mevcut Başlık" placeholder="ör: Wireless Earbuds Bluetooth 5.0 Headphones" helperText="Optimize etmek istediğiniz mevcut başlığı yapıştırın" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <TextField label="Kategori (opsiyonel)" value={category} onChange={e => setCategory(e.target.value)} fullWidth />
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Sparkles size={18} />}
        onClick={run}
        disabled={loading}
        sx={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
          borderRadius: 2,
          textTransform: 'none',
          fontWeight: 600,
          '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)', boxShadow: '0 4px 12px rgba(99,102,241,0.4)' },
        }}
      >
        {loading ? status : 'AI ile Optimize Et'}
      </Button>

      {result && (
        <Paper sx={{ p: 2, mt: 1, bgcolor: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: '#1e1b4b', fontWeight: 700 }}>Karşılaştırma</Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ p: 1.5, bgcolor: '#fff5f5', borderRadius: 2, border: '1px solid rgba(239,68,68,0.15)' }}>
              <Typography variant="caption" color="error">Önceki</Typography>
              <Typography>{title}</Typography>
            </Box>
            <Box sx={{ p: 1.5, bgcolor: '#f0fdf4', borderRadius: 2, border: '1px solid rgba(16,185,129,0.2)', boxShadow: '0 0 8px rgba(16,185,129,0.08)' }}>
              <Typography variant="caption" sx={{ color: '#10b981' }}>Sonra</Typography>
              <Typography fontWeight={600}>{result.optimizedTitle}</Typography>
            </Box>
          </Box>

          {result.score && (
            <Box sx={{ mt: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
              <Typography variant="body2" fontWeight={600}>
                Skor: <span style={{ color: scoreColor(result.score.before), fontSize: '1.1rem', fontWeight: 700 }}>{result.score.before}</span>
                {' → '}
                <span style={{ color: scoreColor(result.score.after), fontSize: '1.1rem', fontWeight: 700 }}>{result.score.after}</span>
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

          <Button size="small" variant="outlined" startIcon={<Copy size={14} />} onClick={() => copyToClipboard(result.optimizedTitle)} sx={{
            mt: 1.5, color: '#6366f1', borderColor: 'rgba(99,102,241,0.3)', textTransform: 'none', fontWeight: 600,
            '&:hover': { bgcolor: '#6366f1', color: '#fff', borderColor: '#6366f1' },
          }}>
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
  const [aspectsText, setAspectsText] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const parseAspects = useCallback((): Record<string, string> | undefined => {
    if (!aspectsText.trim()) return undefined;
    const aspects: Record<string, string> = {};
    aspectsText.split('\n').forEach(line => {
      const sep = line.indexOf(':');
      if (sep > 0) {
        const key = line.slice(0, sep).trim();
        const val = line.slice(sep + 1).trim();
        if (key && val) aspects[key] = val;
      }
    });
    return Object.keys(aspects).length > 0 ? aspects : undefined;
  }, [aspectsText]);

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
        aspects: parseAspects(),
        marketResearch: market,
      }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [title, condition, price, parseAspects, userId, marketplace]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Ürün Başlığı" placeholder="ör: LED Strip Lights 50ft RGB Color Changing" helperText="Ürün başlığını girin — AI profesyonel HTML açıklama oluşturacak" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <FormControl fullWidth>
        <InputLabel>Durum</InputLabel>
        <Select value={condition} label="Durum" onChange={e => setCondition(e.target.value)}>
          <MenuItem value="NEW">Yeni</MenuItem>
          <MenuItem value="USED">Kullanılmış</MenuItem>
          <MenuItem value="REFURBISHED">Yenilenmiş</MenuItem>
        </Select>
      </FormControl>
      <TextField label="Fiyat" type="number" value={price} onChange={e => setPrice(e.target.value)} fullWidth />
      <TextField
        label="Özellikler (opsiyonel)"
        placeholder={"Brand: Nike\nSize: 10\nColor: Black\nMaterial: Leather"}
        value={aspectsText}
        onChange={e => setAspectsText(e.target.value)}
        fullWidth
        multiline
        rows={3}
        helperText="Her satıra bir özellik: Anahtar: Değer"
      />
      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Edit3 size={18} />}
        onClick={run}
        disabled={loading}
        sx={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
          borderRadius: 2, textTransform: 'none', fontWeight: 600,
          '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' },
        }}
      >
        {loading ? status : 'Açıklama Oluştur'}
      </Button>

      {result?.description && (
        <Paper sx={{ p: 2, mt: 1, bgcolor: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: '#1e1b4b', fontWeight: 700 }}>Oluşturulan Açıklama</Typography>
          <Box
            sx={{ p: 2, border: '1px solid rgba(99,102,241,0.08)', borderRadius: 2, bgcolor: '#f8faff', maxHeight: 400, overflow: 'auto' }}
            dangerouslySetInnerHTML={{ __html: result.description }}
          />
          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Tooltip title="HTML etiketleri olmadan düz metin kopyalar">
              <Button size="small" variant="outlined" startIcon={<Copy size={14} />} onClick={() => copyToClipboard(stripHtml(result.description))} sx={{
                color: '#6366f1', borderColor: 'rgba(99,102,241,0.3)', textTransform: 'none', fontWeight: 600,
                '&:hover': { bgcolor: '#6366f1', color: '#fff', borderColor: '#6366f1' },
              }}>
                Metin Kopyala
              </Button>
            </Tooltip>
            <Tooltip title="HTML etiketleriyle birlikte kopyalar">
              <Button size="small" variant="outlined" startIcon={<Code size={14} />} onClick={() => copyToClipboard(result.description)} sx={{
                color: '#8b5cf6', borderColor: 'rgba(139,92,246,0.3)', textTransform: 'none', fontWeight: 600,
                '&:hover': { bgcolor: '#8b5cf6', color: '#fff', borderColor: '#8b5cf6' },
              }}>
                HTML Kopyala
              </Button>
            </Tooltip>
          </Stack>
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
      <TextField label="Ürün Başlığı" placeholder="ör: Apple AirPods Pro 2nd Generation" helperText="Fiyat önerisi almak istediğiniz ürünün başlığını girin" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
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
        sx={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
          borderRadius: 2, textTransform: 'none', fontWeight: 600,
          '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' },
        }}
      >
        {loading ? status : 'Fiyat Önerisi Al'}
      </Button>

      {result && (
        <Paper sx={{ p: 2, mt: 1, bgcolor: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
          <Box sx={{ textAlign: 'center', mb: 2 }}>
            <Typography variant="h3" fontWeight={700} sx={{ color: '#6366f1' }}>
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
              <Box sx={{ position: 'relative', height: 8, bgcolor: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
                {result.priceRange.min != null && result.priceRange.max != null && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: `${((result.suggestedPrice - result.priceRange.min) / (result.priceRange.max - result.priceRange.min)) * 100}%`,
                      top: -2,
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: '#6366f1',
                      transform: 'translateX(-50%)',
                      boxShadow: '0 0 6px rgba(99,102,241,0.4)',
                    }}
                  />
                )}
                <LinearProgress
                  variant="determinate"
                  value={result.priceRange.min != null && result.priceRange.max != null
                    ? ((result.suggestedPrice - result.priceRange.min) / (result.priceRange.max - result.priceRange.min)) * 100
                    : 50}
                  sx={{ height: 8, borderRadius: 4, '& .MuiLinearProgress-bar': { background: 'linear-gradient(90deg, #6366f1, #8b5cf6)' }, backgroundColor: '#e5e7eb' }}
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
            <Box sx={{ p: 1.5, bgcolor: '#f8faff', borderRadius: 2, border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 700, color: '#1e1b4b' }}>Pazar Verileri</Typography>
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

          <Button size="small" variant="outlined" startIcon={<Copy size={14} />} onClick={() => copyToClipboard(String(result.suggestedPrice))} sx={{
            mt: 1.5, color: '#6366f1', borderColor: 'rgba(99,102,241,0.3)', textTransform: 'none', fontWeight: 600,
            '&:hover': { bgcolor: '#6366f1', color: '#fff', borderColor: '#6366f1' },
          }}>
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
      const res = await callAi('analyze_listing', {
        title,
        description: description || undefined,
        categoryName: category || undefined,
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
  }, [title, description, category, price, imageCount, userId, marketplace]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Ürün Başlığı" placeholder="ör: https://www.ebay.com/itm/123456789" helperText="eBay listing URL'si veya ürün başlığı girin — AI detaylı analiz yapacak" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <TextField label="Kategori (opsiyonel)" value={category} onChange={e => setCategory(e.target.value)} fullWidth />
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
        sx={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
          borderRadius: 2, textTransform: 'none', fontWeight: 600,
          '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' },
        }}
      >
        {loading ? status : 'Analiz Et'}
      </Button>

      {result && (
        <Paper sx={{ p: 2, mt: 1, bgcolor: '#fff', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
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
                boxShadow: `0 0 12px ${scoreColor(result.score)}30`,
              }}
            >
              <Typography variant="h4" fontWeight={700} sx={{ color: scoreColor(result.score), fontSize: '1.8rem' }}>
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
  const [aspectNames, setAspectNames] = useState<string[]>([...DEFAULT_ASPECT_NAMES]);
  const [newAspect, setNewAspect] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<any>(null);

  const addAspect = useCallback(() => {
    const names = newAspect.split(',').map(n => n.trim()).filter(Boolean);
    if (names.length === 0) return;
    setAspectNames(prev => [...prev, ...names.filter(n => !prev.includes(n))]);
    setNewAspect('');
  }, [newAspect]);

  const removeAspect = useCallback((name: string) => {
    setAspectNames(prev => prev.filter(n => n !== name));
  }, []);

  const run = useCallback(async () => {
    if (!title.trim()) { toast.error('Ürün başlığı giriniz'); return; }
    if (aspectNames.length === 0) { toast.error('En az bir özellik adı ekleyin'); return; }
    setLoading(true);
    setResult(null);
    try {
      setStatus('Pazar verisi alınıyor...');
      const market = await fetchMarketContext(title, userId, marketplace);
      setStatus('AI çalışıyor...');
      const res = await callAi('suggest_aspects', {
        title,
        categoryName: category || undefined,
        aspectNames,
        marketResearch: market,
      }, userId);
      setResult(res);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
      setStatus('');
    }
  }, [title, category, aspectNames, userId, marketplace]);

  const aspects = result?.aspects || {};
  const aspectEntries = Object.entries(aspects);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField label="Ürün Başlığı" placeholder="ör: Samsung Galaxy S24 Ultra 256GB Unlocked" helperText="Ürün başlığını girin — AI en uygun özellikleri önerecek" value={title} onChange={e => setTitle(e.target.value)} fullWidth />
      <TextField label="Kategori" value={category} onChange={e => setCategory(e.target.value)} fullWidth />

      <Box>
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>Özellik Adları</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
          {aspectNames.map(name => (
            <Chip
              key={name}
              label={name}
              size="small"
              onDelete={() => removeAspect(name)}
              deleteIcon={<X size={12} />}
            />
          ))}
        </Box>
        <Stack direction="row" spacing={1}>
          <TextField
            size="small"
            label="Yeni özellik ekle"
            placeholder="Virgülle ayırarak birden fazla ekleyin"
            value={newAspect}
            onChange={e => setNewAspect(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addAspect(); } }}
            fullWidth
          />
          <Button size="small" variant="outlined" onClick={addAspect} sx={{ flexShrink: 0 }}>
            Ekle
          </Button>
        </Stack>
      </Box>

      <Button
        variant="contained"
        startIcon={loading ? <CircularProgress size={18} color="inherit" /> : <Tag size={18} />}
        onClick={run}
        disabled={loading}
        sx={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
          borderRadius: 2, textTransform: 'none', fontWeight: 600,
          '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' },
        }}
      >
        {loading ? status : 'Özellik Öner'}
      </Button>

      {aspectEntries.length > 0 && (
        <TableContainer component={Paper} sx={{ mt: 1, boxShadow: '0 2px 16px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>Özellik</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>Önerilen Değerler</TableCell>
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
        placeholder={"Her satıra bir başlık yazın:\nWireless Earbuds Bluetooth\nPhone Case iPhone 15\nYoga Mat Non Slip"}
        helperText="Her satıra bir başlık girin (maks 10). AI hepsini tek seferde optimize edecek."
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
        sx={{
          background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
          boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
          borderRadius: 2, textTransform: 'none', fontWeight: 600,
          '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' },
        }}
      >
        {loading ? 'AI çalışıyor...' : 'Toplu Optimize Et'}
      </Button>

      {result?.results?.length > 0 && (
        <TableContainer component={Paper} sx={{ mt: 1, boxShadow: '0 2px 16px rgba(0,0,0,0.06)', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)' }}>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>Orijinal</TableCell>
                <TableCell sx={{ fontWeight: 700, color: '#1e1b4b' }}>Optimize Edilmiş</TableCell>
                <TableCell sx={{ fontWeight: 700, width: 60 }} />
              </TableRow>
            </TableHead>
            <TableBody>
              {result.results.map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell>
                    <Typography variant="body2">{r.original}</Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500} sx={{ color: '#10b981' }}>{r.optimized}</Typography>
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
export default function AiOptimizationHub({ userId, marketplace = 'EBAY_US', onNavigate, navigateData, onConsumeNavigateData }: AiOptimizationHubProps) {
  const [activeTab, setActiveTab] = useState<TabKey>('title');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Consume navigateData — auto-select the right AI tab based on incoming data
  useEffect(() => {
    if (!navigateData) return;
    if (navigateData.tab && ['title', 'description', 'price', 'analyze', 'aspects', 'bulk'].includes(navigateData.tab)) {
      setActiveTab(navigateData.tab);
    }
    onConsumeNavigateData?.();
  }, [navigateData, onConsumeNavigateData]);

  return (
    <Box>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2, color: '#1e1b4b' }}>
        AI Optimizasyon Merkezi
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, mb: 3, overflowX: 'auto', pb: 1, '&::-webkit-scrollbar': { height: 4 } }}>
        {TABS.map(tab => (
          <Chip
            key={tab.key}
            icon={<>{tab.icon}</>}
            label={isMobile ? undefined : tab.label}
            onClick={() => setActiveTab(tab.key)}
            variant="filled"
            sx={{
              flexShrink: 0,
              fontWeight: activeTab === tab.key ? 600 : 400,
              ...(activeTab === tab.key
                ? {
                    background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)',
                    color: '#fff',
                    boxShadow: '0 2px 8px rgba(99,102,241,0.3)',
                    '& .MuiChip-icon': { color: '#fff' },
                  }
                : {
                    bgcolor: '#f8faff',
                    color: '#6366f1',
                    border: '1px solid rgba(99,102,241,0.2)',
                    '& .MuiChip-icon': { color: '#6366f1' },
                    '&:hover': { bgcolor: 'rgba(99,102,241,0.08)' },
                  }),
            }}
          />
        ))}
      </Box>

      <Paper sx={{ p: 2, mb: 2, bgcolor: '#f8faff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
        <Typography variant="subtitle2" fontWeight={700} gutterBottom sx={{ color: '#1e1b4b' }}>
          AI Araçları Rehberi
        </Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          <ul style={{ margin: 0, paddingLeft: 16 }}>
            <li><strong>Başlık Optimize:</strong> Mevcut başlığınızı AI ile optimize edin — pazar araştırması otomatik yapılır</li>
            <li><strong>Açıklama Yaz:</strong> Profesyonel HTML ürün açıklaması oluşturun</li>
            <li><strong>Fiyat Öner:</strong> Pazar verilerine dayalı rekabetçi fiyat önerisi alın</li>
            <li><strong>Liste Analiz:</strong> Herhangi bir eBay listesini 0-100 arasında puanlayın</li>
            <li><strong>Özellik Öner:</strong> Eksik ürün özelliklerini AI ile tamamlayın</li>
            <li><strong>Toplu Optimize:</strong> 10 başlığa kadar tek seferde optimize edin</li>
          </ul>
        </Typography>
      </Paper>

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
