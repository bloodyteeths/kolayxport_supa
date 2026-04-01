import React, { useState, useMemo, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Alert, Tabs, Tab, Select, MenuItem, FormControl,
  InputLabel, Tooltip, IconButton, CircularProgress, InputAdornment,
  Dialog, DialogTitle, DialogContent,
} from '@mui/material';
import {
  Search, Users, TrendingUp, TrendingDown, ExternalLink, Eye, Star,
  Copy, Download, Plus, Trash2, BarChart2, ArrowUpDown, ShoppingBag,
  FileSearch, X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompetitiveIntelligenceProps {
  userId: string;
  marketplace: string;
  userListings?: any[];
  onNavigate?: (tool: string, data?: any) => void;
}

interface SellerItem {
  itemId: string;
  title: string;
  price: { value: string; currency: string };
  condition: string;
  conditionId?: string;
  image?: { imageUrl: string };
  itemWebUrl: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  categories?: { categoryId: string; categoryName: string }[];
  shippingOptions?: { shippingCostType: string; shippingCost?: { value: string; currency: string } }[];
  buyingOptions?: string[];
  itemCreationDate?: string;
  legacyItemId?: string;
  topRatedBuyingExperience?: boolean;
  estimatedSold?: number;
}

interface SellerProfile {
  username: string;
  feedbackScore: number;
  feedbackPercentage: string;
  topRated: boolean;
}

interface ItemDetails {
  itemId: string;
  legacyItemId?: string;
  title: string;
  price: { value: string; currency: string };
  condition: string;
  image?: { imageUrl: string };
  additionalImages?: { imageUrl: string }[];
  itemWebUrl: string;
  seller?: { username: string; feedbackScore: number; feedbackPercentage: string };
  categories?: { categoryId: string; categoryName: string }[];
  shippingOptions?: { shippingCostType: string; shippingCost?: { value: string; currency: string } }[];
  itemCreationDate?: string;
  estimatedSold?: number;
  localizedAspects?: { name: string; value: string }[];
  imageCount?: number;
}

interface MarketSnapshot {
  keyword: string;
  marketplace: string;
  timestamp: number;
  totalListings: number;
  avgPrice: number;
  medianPrice: number;
  uniqueSellers: number;
  freeShippingPct: number;
  newCount: number;
  usedCount: number;
  newAvgPrice: number;
  usedAvgPrice: number;
  topSellers: { username: string; count: number; share: number }[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

const TRENDS_KEY = 'kolayxport_market_trends';

function loadSnapshots(): MarketSnapshot[] {
  try {
    const raw = localStorage.getItem(TRENDS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveSnapshots(snapshots: MarketSnapshot[]) {
  localStorage.setItem(TRENDS_KEY, JSON.stringify(snapshots));
}

function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function extractKeywords(titles: string[]): { word: string; count: number }[] {
  const stop = new Set(['the', 'a', 'an', 'and', 'or', 'for', 'of', 'to', 'in', 'on', 'with', 'by', 'is', 'it', 'at', 'as', 'new', '-', '&', '/', '|']);
  const freq: Record<string, number> = {};
  titles.forEach(t => {
    t.toLowerCase().replace(/[^a-z0-9\s]/gi, ' ').split(/\s+/).filter(w => w.length > 2 && !stop.has(w)).forEach(w => {
      freq[w] = (freq[w] || 0) + 1;
    });
  });
  return Object.entries(freq).map(([word, count]) => ({ word, count })).sort((a, b) => b.count - a.count);
}

function getShippingCost(item: any): number {
  const opt = item.shippingOptions?.[0];
  if (!opt) return 0;
  if (opt.shippingCostType === 'FIXED') return parseFloat(opt.shippingCost?.value || '0');
  return 0;
}

function isFreeShipping(item: any): boolean {
  const opt = item.shippingOptions?.[0];
  if (!opt) return false;
  return opt.shippingCostType === 'FREE' || parseFloat(opt.shippingCost?.value || '0') === 0;
}

// CSS-based pie chart helper
function PieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return null;
  let cumulative = 0;
  const gradientParts = data.map(d => {
    const start = (cumulative / total) * 360;
    cumulative += d.value;
    const end = (cumulative / total) * 360;
    return `${d.color} ${start}deg ${end}deg`;
  });

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <Box sx={{
        width: 120, height: 120, borderRadius: '50%',
        background: `conic-gradient(${gradientParts.join(', ')})`,
        flexShrink: 0,
      }} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {data.map((d, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 12, height: 12, borderRadius: 1, bgcolor: d.color, flexShrink: 0 }} />
            <Typography variant="body2">{d.label}: {d.value} ({pct(d.value / total * 100)})</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// CSS-based histogram
function Histogram({ values, bins = 8 }: { values: number[]; bins?: number }) {
  if (!values.length) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) return <Typography variant="body2">Tüm fiyatlar aynı: {fmt(min)}</Typography>;
  const step = (max - min) / bins;
  const buckets = Array(bins).fill(0);
  values.forEach(v => {
    const idx = Math.min(Math.floor((v - min) / step), bins - 1);
    buckets[idx]++;
  });
  const maxCount = Math.max(...buckets);

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 0.5, height: 100 }}>
      {buckets.map((count, i) => (
        <Tooltip key={i} title={`${fmt(min + i * step)} - ${fmt(min + (i + 1) * step)}: ${count} ürün`}>
          <Box sx={{
            flex: 1, background: 'linear-gradient(180deg, #6366f1, #8b5cf6)', borderRadius: '4px 4px 0 0',
            height: maxCount ? `${(count / maxCount) * 100}%` : 0,
            minHeight: count ? 4 : 0, cursor: 'pointer',
            '&:hover': { background: 'linear-gradient(180deg, #5558e6, #7c4feb)' },
          }} />
        </Tooltip>
      ))}
    </Box>
  );
}

const PIE_COLORS = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#f97316', '#64748b'];

// ---------------------------------------------------------------------------
// Sub-tab 1: Seller Spy
// ---------------------------------------------------------------------------

function SellerSpy({ userId, marketplace, userListings, onNavigate }: { userId: string; marketplace: string; userListings?: any[]; onNavigate?: (tool: string, data?: any) => void }) {
  const suggestedSellers = useMemo(() => {
    if (!userListings?.length) return [];
    const sellers = new Map<string, { username: string; feedback: number }>();
    for (const l of userListings) {
      const s = l.seller;
      if (s?.username && !sellers.has(s.username)) {
        sellers.set(s.username, { username: s.username, feedback: s.feedbackScore || 0 });
      }
    }
    return Array.from(sellers.values()).slice(0, 5);
  }, [userListings]);

  const [sellerInput, setSellerInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [items, setItems] = useState<SellerItem[]>([]);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [sortBy, setSortBy] = useState<'price' | 'sold' | 'newest'>('sold');
  const [tracking, setTracking] = useState(false);

  // Standalone keyword search state
  const [kwInput, setKwInput] = useState('');
  const [kwLoading, setKwLoading] = useState(false);
  const [kwError, setKwError] = useState('');
  const [kwItems, setKwItems] = useState<SellerItem[]>([]);

  // Seller deep-dive state
  const [deepDiveSeller, setDeepDiveSeller] = useState<string | null>(null);
  const [deepDiveItems, setDeepDiveItems] = useState<SellerItem[]>([]);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [deepDiveOpen, setDeepDiveOpen] = useState(false);

  const searchSeller = useCallback(async () => {
    if (!sellerInput.trim()) return;
    setLoading(true);
    setError('');
    setItems([]);
    setProfile(null);
    try {
      const params = new URLSearchParams({
        action: 'search_seller',
        seller: sellerInput.trim(),
        marketplace_id: marketplace,
        limit: '50',
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Satıcı bulunamadı');
      const resultItems: SellerItem[] = data.items || data.itemSummaries || [];
      setItems(resultItems);
      if (resultItems.length > 0 && resultItems[0].seller) {
        const s = resultItems[0].seller;
        setProfile({
          username: s.username,
          feedbackScore: s.feedbackScore,
          feedbackPercentage: s.feedbackPercentage,
          topRated: resultItems.some(it => it.topRatedBuyingExperience),
        });
      }
    } catch (err: any) {
      setError(err.message || 'Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  }, [sellerInput, marketplace]);

  const trackSeller = useCallback(async () => {
    if (!profile) return;
    setTracking(true);
    try {
      const res = await fetch('/api/clawd/ebay-research?action=track_seller', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, seller: profile.username, marketplace }),
      });
      if (!res.ok) throw new Error('Takip eklenemedi');
      toast.success(`${profile.username} takip listesine eklendi`);
    } catch (err: any) {
      toast.error(err.message || 'Takip hatası');
    } finally {
      setTracking(false);
    }
  }, [profile, userId, marketplace]);

  // Standalone keyword search
  const searchByKeyword = useCallback(async () => {
    if (!kwInput.trim()) return;
    setKwLoading(true);
    setKwError('');
    setKwItems([]);
    try {
      const params = new URLSearchParams({
        action: 'search_market',
        user_id: userId,
        keywords: kwInput.trim(),
        marketplace,
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Arama basarisiz');
      const resultItems: SellerItem[] = data.items || data.itemSummaries || [];
      if (!resultItems.length) { setKwError('Sonuc bulunamadi'); return; }
      setKwItems(resultItems);
      toast.success(`${resultItems.length} urun bulundu`);
    } catch (err: any) {
      setKwError(err.message || 'Bir hata olustu');
    } finally {
      setKwLoading(false);
    }
  }, [kwInput, userId, marketplace]);

  // Seller deep-dive
  const openSellerDeepDive = useCallback(async (sellerName: string) => {
    setDeepDiveSeller(sellerName);
    setDeepDiveOpen(true);
    setDeepDiveLoading(true);
    setDeepDiveItems([]);
    try {
      const params = new URLSearchParams({
        action: 'search_seller',
        user_id: userId,
        seller: sellerName,
        marketplace,
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Satici bilgileri alinamadi');
      const resultItems: SellerItem[] = data.items || data.itemSummaries || [];
      setDeepDiveItems(resultItems);
    } catch (err: any) {
      toast.error(err.message || 'Satici arama hatasi');
    } finally {
      setDeepDiveLoading(false);
    }
  }, [userId, marketplace]);

  // Unique sellers from keyword search results
  const kwSellers = useMemo(() => {
    const map = new Map<string, { username: string; count: number; feedbackScore: number; feedbackPercentage: string }>();
    kwItems.forEach(item => {
      const s = item.seller;
      if (!s?.username) return;
      const existing = map.get(s.username);
      if (existing) {
        existing.count++;
      } else {
        map.set(s.username, {
          username: s.username,
          count: 1,
          feedbackScore: s.feedbackScore || 0,
          feedbackPercentage: s.feedbackPercentage || '0',
        });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [kwItems]);

  const prices = useMemo(() => items.map(i => parseFloat(i.price?.value || '0')).filter(p => p > 0), [items]);

  const sortedItems = useMemo(() => {
    const arr = [...items];
    switch (sortBy) {
      case 'price': return arr.sort((a, b) => parseFloat(a.price?.value || '0') - parseFloat(b.price?.value || '0'));
      case 'sold': return arr.sort((a, b) => (b.estimatedSold || 0) - (a.estimatedSold || 0));
      case 'newest': return arr.sort((a, b) => new Date(b.itemCreationDate || 0).getTime() - new Date(a.itemCreationDate || 0).getTime());
      default: return arr;
    }
  }, [items, sortBy]);

  const categoryBreakdown = useMemo(() => {
    const map: Record<string, number> = {};
    items.forEach(item => {
      const cat = item.categories?.[0]?.categoryName || 'Diğer';
      map[cat] = (map[cat] || 0) + 1;
    });
    return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([label, value], i) => ({
      label, value, color: PIE_COLORS[i % PIE_COLORS.length],
    }));
  }, [items]);

  const topKeywords = useMemo(() => extractKeywords(items.map(i => i.title)), [items]);

  const inventoryStats = useMemo(() => {
    if (!prices.length) return null;
    return {
      total: items.length,
      avgPrice: prices.reduce((s, p) => s + p, 0) / prices.length,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      estSold: items.reduce((s, i) => s + (i.estimatedSold || 0), 0),
    };
  }, [items, prices]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Standalone Keyword Search */}
      <Paper sx={{ p: 2, border: '1px solid rgba(99,102,241,0.15)', borderRadius: 3, bgcolor: '#f8faff', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#6366f1' }}>
          <Search size={18} />
          Pazar Arastirmasi ile Rakip Bul
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Anahtar kelime ile arama yapin, rakip saticilarini kesfet ve analiz edin.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="ör: bluetooth speaker, baby monitor"
            helperText="Rakip analizi yapmak istediğiniz ürün kelimesini girin"
            value={kwInput}
            onChange={e => setKwInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchByKeyword()}
            sx={{ flex: 1, minWidth: 250 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><Search size={16} /></InputAdornment>
              ),
            }}
          />
          <Button variant="contained" onClick={searchByKeyword} disabled={kwLoading || !kwInput.trim()}
            startIcon={kwLoading ? <CircularProgress size={16} /> : <Search size={16} />}
            sx={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' } }}>
            Ara
          </Button>
        </Box>
        {kwLoading && <LinearProgress sx={{ mt: 1 }} />}
        {kwError && <Alert severity="error" sx={{ mt: 1 }}>{kwError}</Alert>}

        {/* Tips — show when no results */}
        {!kwLoading && kwSellers.length === 0 && !kwError && (
          <Paper sx={{ p: 2, mt: 2, bgcolor: '#f8faff', borderRadius: 3, border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle2" fontWeight={700} gutterBottom>Rakip Analizi Nasil Kullanilir?</Typography>
            <Typography variant="body2" color="text.secondary" component="div">
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                <li>Bir anahtar kelime arayarak pazardaki rakipleri gorun</li>
                <li>Satici adina tiklayarak magaza detaylarini inceleyin</li>
                <li>Anlik goruntuyu kaydederek fiyat degisimlerini takip edin</li>
                <li>Pazar trendleri sekmesinde zaman icindeki degisimleri izleyin</li>
              </ul>
            </Typography>
          </Paper>
        )}

        {/* Keyword search results — seller list */}
        {kwSellers.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>
              Bulunan Saticilar ({kwSellers.length})
            </Typography>
            <TableContainer sx={{ maxHeight: 400 }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow sx={{ '& th': { background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '2px solid rgba(99,102,241,0.12)' } }}>
                    <TableCell>Satici</TableCell>
                    <TableCell align="right">Listeleme</TableCell>
                    <TableCell align="right">Puan</TableCell>
                    <TableCell align="right">Olumlu %</TableCell>
                    <TableCell align="center">Islemler</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {kwSellers.map((s, i) => (
                    <TableRow key={s.username} hover>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={i < 3 ? 600 : 400}
                          sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}
                          onClick={() => openSellerDeepDive(s.username)}
                        >
                          {s.username}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{s.count}</TableCell>
                      <TableCell align="right">{s.feedbackScore}</TableCell>
                      <TableCell align="right">{s.feedbackPercentage}%</TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                          <Tooltip title="Urunleri Gor">
                            <Button size="small" variant="outlined" sx={{ minWidth: 0, px: 1, fontSize: 11 }}
                              startIcon={<ShoppingBag size={12} />}
                              onClick={() => onNavigate?.('product_database', { keyword: s.username })}>
                              Urunleri Gor
                            </Button>
                          </Tooltip>
                          <Tooltip title="SEO Kontrol">
                            <Button size="small" variant="outlined" sx={{ minWidth: 0, px: 1, fontSize: 11 }}
                              startIcon={<FileSearch size={12} />}
                              onClick={() => onNavigate?.('seo_analyzer', { keyword: kwInput.trim() })}>
                              SEO Kontrol
                            </Button>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Paper>

      {/* Seller Deep-Dive Dialog */}
      <Dialog open={deepDiveOpen} onClose={() => setDeepDiveOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#6366f1' }}>
            <Users size={20} />
            <span>{deepDiveSeller} — Satici Detaylari</span>
          </Box>
          <IconButton size="small" onClick={() => setDeepDiveOpen(false)}>
            <X size={18} />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {deepDiveLoading && <LinearProgress sx={{ mb: 2 }} />}
          {!deepDiveLoading && deepDiveItems.length === 0 && (
            <Alert severity="info">Bu satici icin urun bulunamadi.</Alert>
          )}
          {deepDiveItems.length > 0 && (
            <>
              <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                <Button size="small" variant="contained"
                  startIcon={<ShoppingBag size={14} />}
                  onClick={() => { onNavigate?.('product_database', { keyword: deepDiveSeller }); setDeepDiveOpen(false); }}
                  sx={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' } }}>
                  Urunleri Gor
                </Button>
                <Button size="small" variant="outlined"
                  startIcon={<FileSearch size={14} />}
                  onClick={() => { onNavigate?.('seo_analyzer', { keyword: deepDiveSeller }); setDeepDiveOpen(false); }}
                  sx={{ borderColor: '#6366f1', color: '#6366f1', '&:hover': { borderColor: '#5558e6', bgcolor: 'rgba(99,102,241,0.04)' } }}>
                  SEO Kontrol
                </Button>
              </Box>
              <TableContainer sx={{ maxHeight: 400 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>Urun</TableCell>
                      <TableCell align="right">Fiyat</TableCell>
                      <TableCell align="right">Tah. Satis</TableCell>
                      <TableCell>Durum</TableCell>
                      <TableCell align="center">Link</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {deepDiveItems.map((item, idx) => (
                      <TableRow key={item.itemId || idx} hover>
                        <TableCell sx={{ maxWidth: 280 }}>
                          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            {item.image?.imageUrl && (
                              <Box component="img" src={item.image.imageUrl} alt=""
                                sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
                            )}
                            <Typography variant="body2" noWrap title={item.title}>{item.title}</Typography>
                          </Box>
                        </TableCell>
                        <TableCell align="right">{fmt(parseFloat(item.price?.value || '0'))}</TableCell>
                        <TableCell align="right">{item.estimatedSold ?? '-'}</TableCell>
                        <TableCell>
                          <Chip label={item.condition || 'N/A'} size="small" variant="outlined" />
                        </TableCell>
                        <TableCell align="center">
                          {item.itemWebUrl && (
                            <IconButton size="small" href={item.itemWebUrl} target="_blank" rel="noopener">
                              <ExternalLink size={14} />
                            </IconButton>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Suggested Sellers from user listings */}
      {suggestedSellers.length > 0 && (
        <Paper sx={{ p: 2, bgcolor: '#f8faff', border: '1px solid rgba(99,102,241,0.08)', borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
          <Typography variant="subtitle2" sx={{ mb: 1, color: '#6366f1' }}>
            <Users size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Senin satıcı hesabın:
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {suggestedSellers.map(({ username, feedback }) => (
              <Chip
                key={username}
                label={`${username} (${feedback})`}
                size="small"
                variant="outlined"
                onClick={() => setSellerInput(username)}
                sx={{ cursor: 'pointer' }}
              />
            ))}
          </Box>
        </Paper>
      )}

      {/* Search Input */}
      <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="ör: top_electronics_store"
            helperText="eBay satıcı adını girin — mağaza analizi ve ürün listesi görüntülenir"
            value={sellerInput}
            onChange={e => setSellerInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchSeller()}
            sx={{ flex: 1, minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><Users size={16} /></InputAdornment>
              ),
            }}
          />
          <Button variant="contained" onClick={searchSeller} disabled={loading || !sellerInput.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}
            sx={{ background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)', '&:hover': { background: 'linear-gradient(135deg, #5558e6 0%, #7c4feb 100%)' } }}>
            Ara
          </Button>
        </Box>
      </Paper>

      {loading && <LinearProgress />}
      {error && <Alert severity="error">{error}</Alert>}

      {/* Seller Profile Card */}
      {profile && (
        <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
            <Box>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Users size={20} />
                {profile.username}
                {profile.topRated && (
                  <Chip label="Top Rated" size="small" color="success" icon={<Star size={14} />} />
                )}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, mt: 1, flexWrap: 'wrap' }}>
                <Chip label={`Puan: ${profile.feedbackScore}`} size="small" variant="outlined" />
                <Chip label={`Olumlu: ${profile.feedbackPercentage}%`} size="small" variant="outlined"
                  color={parseFloat(profile.feedbackPercentage) >= 98 ? 'success' : 'default'} />
              </Box>
            </Box>
            <Button variant="outlined" size="small" onClick={trackSeller} disabled={tracking}
              startIcon={tracking ? <CircularProgress size={14} /> : <Eye size={14} />}>
              Takip Et
            </Button>
          </Box>
        </Paper>
      )}

      {/* Inventory Summary */}
      {inventoryStats && (
        <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>Envanter Özeti</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">Toplam Listeleme</Typography>
              <Typography variant="h6">{inventoryStats.total}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Ort. Fiyat</Typography>
              <Typography variant="h6">{fmt(inventoryStats.avgPrice)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Fiyat Aralığı</Typography>
              <Typography variant="h6">{fmt(inventoryStats.minPrice)} - {fmt(inventoryStats.maxPrice)}</Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">Tahmini Satış</Typography>
              <Typography variant="h6">{inventoryStats.estSold}</Typography>
            </Box>
          </Box>
        </Paper>
      )}

      {/* Product Table */}
      {items.length > 0 && (
        <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>Ürünler ({items.length})</Typography>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <ArrowUpDown size={14} />
              <Select size="small" value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                <MenuItem value="sold">Satışa Göre</MenuItem>
                <MenuItem value="price">Fiyata Göre</MenuItem>
                <MenuItem value="newest">Yeniye Göre</MenuItem>
              </Select>
            </Box>
          </Box>
          <TableContainer sx={{ maxHeight: 500 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow sx={{ '& th': { background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '2px solid rgba(99,102,241,0.12)' } }}>
                  <TableCell>Ürün</TableCell>
                  <TableCell align="right">Fiyat</TableCell>
                  <TableCell align="right">Tah. Satış</TableCell>
                  <TableCell>Durum</TableCell>
                  <TableCell>Kargo</TableCell>
                  <TableCell align="center">Link</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedItems.map((item, idx) => {
                  const ship = getShippingCost(item);
                  const free = isFreeShipping(item);
                  return (
                    <TableRow key={item.itemId || idx} hover>
                      <TableCell sx={{ maxWidth: 300 }}>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                          {item.image?.imageUrl && (
                            <Box component="img" src={item.image.imageUrl} alt=""
                              sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
                          )}
                          <Typography variant="body2" noWrap title={item.title}>{item.title}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">{fmt(parseFloat(item.price?.value || '0'))}</TableCell>
                      <TableCell align="right">{item.estimatedSold ?? '-'}</TableCell>
                      <TableCell>
                        <Chip label={item.condition || 'N/A'} size="small" variant="outlined" />
                      </TableCell>
                      <TableCell>
                        {free ? (
                          <Chip label="Ücretsiz" size="small" color="success" />
                        ) : (
                          <Typography variant="body2">{fmt(ship)}</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {item.itemWebUrl && (
                          <IconButton size="small" href={item.itemWebUrl} target="_blank" rel="noopener">
                            <ExternalLink size={14} />
                          </IconButton>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Category Breakdown + Price Distribution + Top Keywords */}
      {items.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          {/* Category Breakdown */}
          <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Kategori Dağılımı</Typography>
            <PieChart data={categoryBreakdown} />
          </Paper>

          {/* Price Distribution */}
          <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>Fiyat Dağılımı</Typography>
            <Histogram values={prices} />
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
              <Typography variant="caption" color="text.secondary">{fmt(Math.min(...prices))}</Typography>
              <Typography variant="caption" color="text.secondary">{fmt(Math.max(...prices))}</Typography>
            </Box>
          </Paper>

          {/* Top Keywords */}
          <Paper sx={{ p: 2, gridColumn: { md: '1 / -1' }, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>En Çok Kullanılan Anahtar Kelimeler</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {topKeywords.slice(0, 30).map((kw, i) => (
                <Chip key={i} label={`${kw.word} (${kw.count})`} size="small" variant="outlined"
                  color={i < 5 ? 'primary' : 'default'}
                  onClick={() => { navigator.clipboard.writeText(kw.word); toast.success('Kopyalandı'); }}
                  icon={<Copy size={12} />} />
              ))}
            </Box>
          </Paper>
        </Box>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-tab 2: Listing Comparison
// ---------------------------------------------------------------------------

function ListingComparison({ marketplace }: { marketplace: string }) {
  const [inputs, setInputs] = useState<string[]>(['']);
  const [listings, setListings] = useState<(ItemDetails | null)[]>([]);
  const [loading, setLoading] = useState<boolean[]>([]);
  const [error, setError] = useState('');

  const addInput = () => {
    if (inputs.length >= 5) { toast.error('Maksimum 5 listeleme eklenebilir'); return; }
    setInputs(prev => [...prev, '']);
  };

  const removeInput = (idx: number) => {
    setInputs(prev => prev.filter((_, i) => i !== idx));
    setListings(prev => prev.filter((_, i) => i !== idx));
    setLoading(prev => prev.filter((_, i) => i !== idx));
  };

  const updateInput = (idx: number, val: string) => {
    setInputs(prev => { const n = [...prev]; n[idx] = val; return n; });
  };

  const extractItemId = (input: string): string => {
    const trimmed = input.trim();
    // Try to extract from eBay URL
    const match = trimmed.match(/\/itm\/(?:.*\/)?(\d+)/);
    if (match) return match[1];
    // Try to extract from URL with item param
    const paramMatch = trimmed.match(/[?&]item=(\d+)/);
    if (paramMatch) return paramMatch[1];
    // Assume it's a raw ID
    return trimmed.replace(/\D/g, '');
  };

  const fetchItem = useCallback(async (idx: number) => {
    const itemId = extractItemId(inputs[idx]);
    if (!itemId) { toast.error('Geçerli bir eBay listeleme ID veya URL girin'); return; }

    setLoading(prev => { const n = [...prev]; n[idx] = true; return n; });
    setError('');
    try {
      const params = new URLSearchParams({
        action: 'get_item_details',
        legacy_item_id: itemId,
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Listeleme bulunamadı');
      setListings(prev => {
        const n = [...prev];
        n[idx] = {
          ...data,
          imageCount: 1 + (data.additionalImages?.length || 0),
        };
        return n;
      });
    } catch (err: any) {
      toast.error(err.message || 'Listeleme yüklenemedi');
    } finally {
      setLoading(prev => { const n = [...prev]; n[idx] = false; return n; });
    }
  }, [inputs]);

  const validListings = useMemo(() => listings.filter(Boolean) as ItemDetails[], [listings]);

  const metrics = useMemo(() => {
    if (validListings.length < 2) return null;
    const prices = validListings.map(l => parseFloat(l.price?.value || '0'));
    const shippings = validListings.map(l => getShippingCost(l));
    const totals = prices.map((p, i) => p + shippings[i]);
    const feedbacks = validListings.map(l => l.seller?.feedbackScore || 0);
    const imageCounts = validListings.map(l => l.imageCount || 0);
    const specificsCounts = validListings.map(l => l.localizedAspects?.length || 0);
    const solds = validListings.map(l => l.estimatedSold || 0);

    // Score: lower total cost = +2, higher sold = +2, more images = +1, more specifics = +1, higher feedback = +1
    const scores = validListings.map((_, i) => {
      let score = 0;
      if (totals[i] === Math.min(...totals)) score += 2;
      if (solds[i] === Math.max(...solds) && solds[i] > 0) score += 2;
      if (imageCounts[i] === Math.max(...imageCounts)) score += 1;
      if (specificsCounts[i] === Math.max(...specificsCounts)) score += 1;
      if (feedbacks[i] === Math.max(...feedbacks)) score += 1;
      return score;
    });

    const winnerIdx = scores.indexOf(Math.max(...scores));

    return { prices, shippings, totals, feedbacks, imageCounts, specificsCounts, solds, scores, winnerIdx };
  }, [validListings]);

  const cellColor = (values: number[], idx: number, higherBetter: boolean) => {
    if (values.length < 2) return undefined;
    const best = higherBetter ? Math.max(...values) : Math.min(...values);
    const worst = higherBetter ? Math.min(...values) : Math.max(...values);
    if (values[idx] === best) return '#e8f5e9';
    if (values[idx] === worst) return '#ffebee';
    return undefined;
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <Typography variant="subtitle1" fontWeight={600} gutterBottom>
          Listeleme Karşılaştırması (maks. 5)
        </Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {inputs.map((val, idx) => (
            <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <TextField
                size="small" fullWidth
                placeholder="ör: https://www.ebay.com/itm/123456789"
                helperText={idx === 0 ? "Karşılaştırmak istediğiniz eBay listing URL veya ID'lerini girin" : undefined}
                value={val}
                onChange={e => updateInput(idx, e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchItem(idx)}
              />
              <Button variant="contained" size="small" onClick={() => fetchItem(idx)}
                disabled={loading[idx] || !val.trim()}>
                {loading[idx] ? <CircularProgress size={16} /> : 'Ekle'}
              </Button>
              {inputs.length > 1 && (
                <IconButton size="small" onClick={() => removeInput(idx)} color="error">
                  <Trash2 size={16} />
                </IconButton>
              )}
            </Box>
          ))}
          {inputs.length < 5 && (
            <Button size="small" startIcon={<Plus size={14} />} onClick={addInput} sx={{ alignSelf: 'flex-start' }}>
              Alan Ekle
            </Button>
          )}
        </Box>
      </Paper>

      {error && <Alert severity="error">{error}</Alert>}

      {/* Winner */}
      {metrics && metrics.winnerIdx >= 0 && (
        <Alert severity="success" icon={<Star size={20} />}>
          <Typography variant="body2" fontWeight={600}>
            Kazanan: {validListings[metrics.winnerIdx]?.title?.slice(0, 60)}...
            {' '}(Skor: {metrics.scores[metrics.winnerIdx]}/7)
          </Typography>
        </Alert>
      )}

      {/* Comparison Table */}
      {validListings.length > 0 && (
        <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 600, minWidth: 140 }}>Metrik</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center" sx={{
                      fontWeight: 600, minWidth: 180,
                      bgcolor: metrics && i === metrics.winnerIdx ? '#e8f5e9' : undefined,
                    }}>
                      Listeleme {i + 1}
                      {metrics && i === metrics.winnerIdx && (
                        <Chip label="Kazanan" size="small" color="success" sx={{ ml: 0.5 }} />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {/* Thumbnail */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Görsel</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center">
                      {l.image?.imageUrl ? (
                        <Box component="img" src={l.image.imageUrl} alt=""
                          sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1 }} />
                      ) : '-'}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Title */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Başlık</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i}>
                      <Typography variant="body2" sx={{ fontSize: 12 }}>{l.title}</Typography>
                      <Typography variant="caption" color="text.secondary">({l.title?.length || 0} karakter)</Typography>
                    </TableCell>
                  ))}
                </TableRow>
                {/* Price */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Fiyat</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center"
                      sx={{ bgcolor: metrics ? cellColor(metrics.prices, i, false) : undefined }}>
                      {fmt(parseFloat(l.price?.value || '0'))}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Shipping */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Kargo</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center"
                      sx={{ bgcolor: metrics ? cellColor(metrics.shippings, i, false) : undefined }}>
                      {isFreeShipping(l) ? <Chip label="Ücretsiz" size="small" color="success" /> : fmt(getShippingCost(l))}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Total Cost */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Toplam Maliyet</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center" sx={{
                      fontWeight: 600,
                      bgcolor: metrics ? cellColor(metrics.totals, i, false) : undefined,
                    }}>
                      {metrics ? fmt(metrics.totals[i]) : '-'}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Condition */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Durum</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center">
                      <Chip label={l.condition || 'N/A'} size="small" variant="outlined" />
                    </TableCell>
                  ))}
                </TableRow>
                {/* Estimated Sold */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Tah. Satış</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center"
                      sx={{ bgcolor: metrics ? cellColor(metrics.solds, i, true) : undefined }}>
                      {l.estimatedSold ?? '-'}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Image Count */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Görsel Sayısı</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center"
                      sx={{ bgcolor: metrics ? cellColor(metrics.imageCounts, i, true) : undefined }}>
                      {l.imageCount || '-'}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Item Specifics Count */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Özellik Sayısı</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center"
                      sx={{ bgcolor: metrics ? cellColor(metrics.specificsCounts, i, true) : undefined }}>
                      {l.localizedAspects?.length || '-'}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Seller Feedback */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Satıcı Puanı</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center"
                      sx={{ bgcolor: metrics ? cellColor(metrics.feedbacks, i, true) : undefined }}>
                      {l.seller?.feedbackScore ?? '-'}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Category */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Kategori</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center">
                      <Typography variant="body2" sx={{ fontSize: 12 }}>
                        {l.categories?.[0]?.categoryName || '-'}
                      </Typography>
                    </TableCell>
                  ))}
                </TableRow>
                {/* Creation Date */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Oluşturma Tarihi</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center">
                      {l.itemCreationDate ? new Date(l.itemCreationDate).toLocaleDateString('tr-TR') : '-'}
                    </TableCell>
                  ))}
                </TableRow>
                {/* Link */}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Link</TableCell>
                  {validListings.map((l, i) => (
                    <TableCell key={i} align="center">
                      {l.itemWebUrl && (
                        <IconButton size="small" href={l.itemWebUrl} target="_blank" rel="noopener">
                          <ExternalLink size={14} />
                        </IconButton>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-tab 3: Market Trends
// ---------------------------------------------------------------------------

function MarketTrends({ marketplace, onNavigate, userId }: { marketplace: string; onNavigate?: (tool: string, data?: any) => void; userId?: string }) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [currentSnapshot, setCurrentSnapshot] = useState<MarketSnapshot | null>(null);
  const [savedSnapshots, setSavedSnapshots] = useState<MarketSnapshot[]>(() => loadSnapshots());

  // Seller deep-dive in trends
  const [trendDeepDiveSeller, setTrendDeepDiveSeller] = useState<string | null>(null);
  const [trendDeepDiveItems, setTrendDeepDiveItems] = useState<SellerItem[]>([]);
  const [trendDeepDiveLoading, setTrendDeepDiveLoading] = useState(false);
  const [trendDeepDiveOpen, setTrendDeepDiveOpen] = useState(false);

  const openTrendSellerDeepDive = useCallback(async (sellerName: string) => {
    if (!userId) return;
    setTrendDeepDiveSeller(sellerName);
    setTrendDeepDiveOpen(true);
    setTrendDeepDiveLoading(true);
    setTrendDeepDiveItems([]);
    try {
      const params = new URLSearchParams({
        action: 'search_seller',
        user_id: userId,
        seller: sellerName,
        marketplace,
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Satici bilgileri alinamadi');
      setTrendDeepDiveItems(data.items || data.itemSummaries || []);
    } catch (err: any) {
      toast.error(err.message || 'Satici arama hatasi');
    } finally {
      setTrendDeepDiveLoading(false);
    }
  }, [userId, marketplace]);

  const searchMarket = useCallback(async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    setError('');
    setCurrentSnapshot(null);
    try {
      const params = new URLSearchParams({
        action: 'search_market',
        q: keyword.trim(),
        limit: '200',
        marketplace_id: marketplace,
      });
      const res = await fetch(`/api/clawd/ebay?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Arama başarısız');

      const items: any[] = data.items || data.itemSummaries || [];
      if (!items.length) { setError('Sonuç bulunamadı'); setLoading(false); return; }

      const prices = items.map(i => parseFloat(i.price?.value || '0')).filter(p => p > 0);
      const sellers = new Set(items.map(i => i.seller?.username).filter(Boolean));
      const freeShipCount = items.filter(i => isFreeShipping(i)).length;

      const newItems = items.filter(i => (i.conditionId === '1000' || i.condition?.toLowerCase()?.includes('new')));
      const usedItems = items.filter(i => !newItems.includes(i));
      const newPrices = newItems.map(i => parseFloat(i.price?.value || '0')).filter(p => p > 0);
      const usedPrices = usedItems.map(i => parseFloat(i.price?.value || '0')).filter(p => p > 0);

      // Top sellers
      const sellerCounts: Record<string, number> = {};
      items.forEach(i => {
        const u = i.seller?.username;
        if (u) sellerCounts[u] = (sellerCounts[u] || 0) + 1;
      });
      const topSellers = Object.entries(sellerCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([username, count]) => ({ username, count, share: count / items.length * 100 }));

      const snapshot: MarketSnapshot = {
        keyword: keyword.trim().toLowerCase(),
        marketplace,
        timestamp: Date.now(),
        totalListings: items.length,
        avgPrice: prices.length ? prices.reduce((s, p) => s + p, 0) / prices.length : 0,
        medianPrice: median(prices),
        uniqueSellers: sellers.size,
        freeShippingPct: items.length ? (freeShipCount / items.length) * 100 : 0,
        newCount: newItems.length,
        usedCount: usedItems.length,
        newAvgPrice: newPrices.length ? newPrices.reduce((s, p) => s + p, 0) / newPrices.length : 0,
        usedAvgPrice: usedPrices.length ? usedPrices.reduce((s, p) => s + p, 0) / usedPrices.length : 0,
        topSellers,
      };
      setCurrentSnapshot(snapshot);
    } catch (err: any) {
      setError(err.message || 'Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  }, [keyword, marketplace]);

  const saveSnapshot = useCallback(() => {
    if (!currentSnapshot) return;
    const updated = [...savedSnapshots, currentSnapshot];
    setSavedSnapshots(updated);
    saveSnapshots(updated);
    toast.success('Anlık görüntü kaydedildi');
  }, [currentSnapshot, savedSnapshots]);

  const deleteSnapshot = useCallback((idx: number) => {
    const updated = savedSnapshots.filter((_, i) => i !== idx);
    setSavedSnapshots(updated);
    saveSnapshots(updated);
    toast.success('Anlık görüntü silindi');
  }, [savedSnapshots]);

  // Previous snapshots for current keyword
  const previousSnapshots = useMemo(() => {
    if (!currentSnapshot) return [];
    return savedSnapshots
      .filter(s => s.keyword === currentSnapshot.keyword && s.marketplace === currentSnapshot.marketplace)
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [savedSnapshots, currentSnapshot]);

  const latestPrevious = previousSnapshots.length > 0 ? previousSnapshots[0] : null;

  const trendArrow = (current: number, previous: number, higherBetter: boolean) => {
    if (!previous) return null;
    const change = ((current - previous) / previous) * 100;
    if (Math.abs(change) < 0.5) return <Chip label="Sabit" size="small" variant="outlined" />;
    const up = change > 0;
    const good = (up && higherBetter) || (!up && !higherBetter);
    return (
      <Chip
        icon={up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
        label={`${change > 0 ? '+' : ''}${change.toFixed(1)}%`}
        size="small"
        color={good ? 'success' : 'error'}
        variant="outlined"
      />
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* Search */}
      <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="ör: wireless earbuds, phone case"
            helperText="Pazar trendlerini takip etmek istediğiniz ürün kelimesini girin"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && searchMarket()}
            sx={{ flex: 1, minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start"><BarChart2 size={16} /></InputAdornment>
              ),
            }}
          />
          <Button variant="contained" onClick={searchMarket} disabled={loading || !keyword.trim()}
            startIcon={loading ? <CircularProgress size={16} /> : <Search size={16} />}>
            Analiz Et
          </Button>
        </Box>
      </Paper>

      {loading && <LinearProgress />}
      {error && <Alert severity="error">{error}</Alert>}

      {/* Current Market Snapshot */}
      {currentSnapshot && (
        <>
          <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                Pazar Anlık Görüntüsü: &quot;{currentSnapshot.keyword}&quot;
              </Typography>
              <Button variant="outlined" size="small" startIcon={<Download size={14} />} onClick={saveSnapshot}>
                Anlık Görüntü Kaydet
              </Button>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 2, mb: 2 }}>
              <Box>
                <Typography variant="caption" color="text.secondary">Toplam Listeleme</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6">{currentSnapshot.totalListings}</Typography>
                  {latestPrevious && trendArrow(currentSnapshot.totalListings, latestPrevious.totalListings, true)}
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Ortalama Fiyat</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6">{fmt(currentSnapshot.avgPrice)}</Typography>
                  {latestPrevious && trendArrow(currentSnapshot.avgPrice, latestPrevious.avgPrice, false)}
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Medyan Fiyat</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6">{fmt(currentSnapshot.medianPrice)}</Typography>
                  {latestPrevious && trendArrow(currentSnapshot.medianPrice, latestPrevious.medianPrice, false)}
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Benzersiz Satıcılar</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant="h6">{currentSnapshot.uniqueSellers}</Typography>
                  {latestPrevious && trendArrow(currentSnapshot.uniqueSellers, latestPrevious.uniqueSellers, false)}
                </Box>
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary">Ücretsiz Kargo</Typography>
                <Typography variant="h6">{pct(currentSnapshot.freeShippingPct)}</Typography>
              </Box>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Condition Breakdown */}
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>Durum Dağılımı</Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, mb: 2 }}>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="body2" fontWeight={600} color="success.main">Yeni</Typography>
                <Typography variant="h6">{currentSnapshot.newCount} listeleme</Typography>
                {currentSnapshot.newAvgPrice > 0 && (
                  <Typography variant="caption" color="text.secondary">Ort: {fmt(currentSnapshot.newAvgPrice)}</Typography>
                )}
              </Paper>
              <Paper variant="outlined" sx={{ p: 1.5 }}>
                <Typography variant="body2" fontWeight={600} color="warning.main">Kullanılmış</Typography>
                <Typography variant="h6">{currentSnapshot.usedCount} listeleme</Typography>
                {currentSnapshot.usedAvgPrice > 0 && (
                  <Typography variant="caption" color="text.secondary">Ort: {fmt(currentSnapshot.usedAvgPrice)}</Typography>
                )}
              </Paper>
            </Box>

            <Divider sx={{ my: 2 }} />

            {/* Top Sellers */}
            <Typography variant="subtitle2" fontWeight={600} gutterBottom>En Aktif Satıcılar</Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow sx={{ '& th': { background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '2px solid rgba(99,102,241,0.12)' } }}>
                    <TableCell>#</TableCell>
                    <TableCell>Satıcı</TableCell>
                    <TableCell align="right">Listeleme</TableCell>
                    <TableCell align="right">Pazar Payı</TableCell>
                    <TableCell>Pay</TableCell>
                    <TableCell align="center">Islemler</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {currentSnapshot.topSellers.map((s, i) => (
                    <TableRow key={i} hover>
                      <TableCell>{i + 1}</TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          fontWeight={i < 3 ? 600 : 400}
                          sx={{ cursor: 'pointer', color: 'primary.main', '&:hover': { textDecoration: 'underline' } }}
                          onClick={() => openTrendSellerDeepDive(s.username)}
                        >
                          {s.username}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{s.count}</TableCell>
                      <TableCell align="right">{pct(s.share)}</TableCell>
                      <TableCell sx={{ minWidth: 120 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          <Box sx={{ flex: 1, bgcolor: '#e0e0e0', borderRadius: 1, height: 8 }}>
                            <Box sx={{ width: `${Math.min(s.share, 100)}%`, bgcolor: '#6366f1', borderRadius: 1, height: '100%' }} />
                          </Box>
                        </Box>
                      </TableCell>
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center', flexWrap: 'wrap' }}>
                          <Tooltip title="Urunleri Gor">
                            <Button size="small" variant="outlined" sx={{ minWidth: 0, px: 1, fontSize: 11 }}
                              startIcon={<ShoppingBag size={12} />}
                              onClick={() => onNavigate?.('product_database', { keyword: s.username })}>
                              Urunleri Gor
                            </Button>
                          </Tooltip>
                          <Tooltip title="SEO Kontrol">
                            <Button size="small" variant="outlined" sx={{ minWidth: 0, px: 1, fontSize: 11 }}
                              startIcon={<FileSearch size={12} />}
                              onClick={() => onNavigate?.('seo_analyzer', { keyword: keyword.trim() })}>
                              SEO Kontrol
                            </Button>
                          </Tooltip>
                        </Box>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>

          {/* Trend Seller Deep-Dive Dialog */}
          <Dialog open={trendDeepDiveOpen} onClose={() => setTrendDeepDiveOpen(false)} maxWidth="md" fullWidth
            PaperProps={{ sx: { borderRadius: 3 } }}>
            <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)', borderBottom: '1px solid rgba(99,102,241,0.12)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#6366f1' }}>
                <Users size={20} />
                <span>{trendDeepDiveSeller} — Satici Detaylari</span>
              </Box>
              <IconButton size="small" onClick={() => setTrendDeepDiveOpen(false)}>
                <X size={18} />
              </IconButton>
            </DialogTitle>
            <DialogContent dividers>
              {trendDeepDiveLoading && <LinearProgress sx={{ mb: 2 }} />}
              {!trendDeepDiveLoading && trendDeepDiveItems.length === 0 && (
                <Alert severity="info">Bu satici icin urun bulunamadi.</Alert>
              )}
              {trendDeepDiveItems.length > 0 && (
                <>
                  <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                    <Button size="small" variant="contained"
                      startIcon={<ShoppingBag size={14} />}
                      onClick={() => { onNavigate?.('product_database', { keyword: trendDeepDiveSeller }); setTrendDeepDiveOpen(false); }}>
                      Urunleri Gor
                    </Button>
                    <Button size="small" variant="outlined"
                      startIcon={<FileSearch size={14} />}
                      onClick={() => { onNavigate?.('seo_analyzer', { keyword: trendDeepDiveSeller }); setTrendDeepDiveOpen(false); }}>
                      SEO Kontrol
                    </Button>
                  </Box>
                  <TableContainer sx={{ maxHeight: 400 }}>
                    <Table size="small" stickyHeader>
                      <TableHead>
                        <TableRow>
                          <TableCell>Urun</TableCell>
                          <TableCell align="right">Fiyat</TableCell>
                          <TableCell align="right">Tah. Satis</TableCell>
                          <TableCell>Durum</TableCell>
                          <TableCell align="center">Link</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {trendDeepDiveItems.map((item, idx) => (
                          <TableRow key={item.itemId || idx} hover>
                            <TableCell sx={{ maxWidth: 280 }}>
                              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                {item.image?.imageUrl && (
                                  <Box component="img" src={item.image.imageUrl} alt=""
                                    sx={{ width: 36, height: 36, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }} />
                                )}
                                <Typography variant="body2" noWrap title={item.title}>{item.title}</Typography>
                              </Box>
                            </TableCell>
                            <TableCell align="right">{fmt(parseFloat(item.price?.value || '0'))}</TableCell>
                            <TableCell align="right">{item.estimatedSold ?? '-'}</TableCell>
                            <TableCell>
                              <Chip label={item.condition || 'N/A'} size="small" variant="outlined" />
                            </TableCell>
                            <TableCell align="center">
                              {item.itemWebUrl && (
                                <IconButton size="small" href={item.itemWebUrl} target="_blank" rel="noopener">
                                  <ExternalLink size={14} />
                                </IconButton>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                </>
              )}
            </DialogContent>
          </Dialog>

          {/* Trend History */}
          {previousSnapshots.length > 0 && (
            <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
              <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                Trend Geçmişi: &quot;{currentSnapshot.keyword}&quot;
              </Typography>
              <Typography variant="body2" color="text.secondary" gutterBottom>
                Bu anahtar kelime için {previousSnapshots.length} kayıtlı anlık görüntü mevcut.
              </Typography>

              {/* Trend Summary */}
              {latestPrevious && (
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 2, my: 2 }}>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Fiyat Trendi</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {currentSnapshot.avgPrice > latestPrevious.avgPrice
                        ? <TrendingUp size={18} color="#d32f2f" />
                        : <TrendingDown size={18} color="#2e7d32" />}
                      <Typography variant="body2">
                        {fmt(latestPrevious.avgPrice)} → {fmt(currentSnapshot.avgPrice)}
                      </Typography>
                    </Box>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Listeleme Trendi</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {currentSnapshot.totalListings > latestPrevious.totalListings
                        ? <><TrendingUp size={18} color="#2e7d32" /> <Typography variant="body2">Büyüyen pazar</Typography></>
                        : <><TrendingDown size={18} color="#d32f2f" /> <Typography variant="body2">Daralan pazar</Typography></>}
                    </Box>
                  </Paper>
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Typography variant="caption" color="text.secondary">Rekabet Trendi</Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      {currentSnapshot.uniqueSellers > latestPrevious.uniqueSellers
                        ? <><TrendingUp size={18} color="#d32f2f" /> <Typography variant="body2">Daha fazla satıcı</Typography></>
                        : <><TrendingDown size={18} color="#2e7d32" /> <Typography variant="body2">Daha az satıcı</Typography></>}
                    </Box>
                  </Paper>
                </Box>
              )}

              {/* Snapshot Table */}
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Tarih</TableCell>
                      <TableCell align="right">Listeleme</TableCell>
                      <TableCell align="right">Ort. Fiyat</TableCell>
                      <TableCell align="right">Medyan Fiyat</TableCell>
                      <TableCell align="right">Satıcılar</TableCell>
                      <TableCell align="right">Ücretsiz Kargo</TableCell>
                      <TableCell align="center">Sil</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {previousSnapshots.map((snap, i) => {
                      const globalIdx = savedSnapshots.indexOf(snap);
                      return (
                        <TableRow key={i} hover>
                          <TableCell>
                            {new Date(snap.timestamp).toLocaleDateString('tr-TR', {
                              day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
                            })}
                          </TableCell>
                          <TableCell align="right">{snap.totalListings}</TableCell>
                          <TableCell align="right">{fmt(snap.avgPrice)}</TableCell>
                          <TableCell align="right">{fmt(snap.medianPrice)}</TableCell>
                          <TableCell align="right">{snap.uniqueSellers}</TableCell>
                          <TableCell align="right">{pct(snap.freeShippingPct)}</TableCell>
                          <TableCell align="center">
                            <IconButton size="small" color="error" onClick={() => deleteSnapshot(globalIdx)}>
                              <Trash2 size={14} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            </Paper>
          )}
        </>
      )}

      {/* All Saved Snapshots Summary */}
      {!currentSnapshot && savedSnapshots.length > 0 && (
        <Paper sx={{ p: 2, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
          <Typography variant="subtitle1" fontWeight={600} gutterBottom>Kayıtlı Anlık Görüntüler</Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Trend analizi için bir anahtar kelime arayın. Önceki anlık görüntülerle karşılaştırma yapılacaktır.
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Anahtar Kelime</TableCell>
                  <TableCell>Pazar</TableCell>
                  <TableCell>Tarih</TableCell>
                  <TableCell align="right">Listeleme</TableCell>
                  <TableCell align="right">Ort. Fiyat</TableCell>
                  <TableCell align="center">Sil</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {savedSnapshots.sort((a, b) => b.timestamp - a.timestamp).map((snap, i) => (
                  <TableRow key={i} hover sx={{ cursor: 'pointer' }}
                    onClick={() => { setKeyword(snap.keyword); }}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={500}>{snap.keyword}</Typography>
                    </TableCell>
                    <TableCell>{snap.marketplace}</TableCell>
                    <TableCell>
                      {new Date(snap.timestamp).toLocaleDateString('tr-TR', {
                        day: 'numeric', month: 'short', year: 'numeric',
                      })}
                    </TableCell>
                    <TableCell align="right">{snap.totalListings}</TableCell>
                    <TableCell align="right">{fmt(snap.avgPrice)}</TableCell>
                    <TableCell align="center">
                      <IconButton size="small" color="error" onClick={e => { e.stopPropagation(); deleteSnapshot(i); }}>
                        <Trash2 size={14} />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function CompetitiveIntelligence({ userId, marketplace, userListings, onNavigate }: CompetitiveIntelligenceProps) {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Paper sx={{ px: 1, borderRadius: 3, boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid rgba(99,102,241,0.08)' }}>
        <Tabs value={activeTab} onChange={(_, v) => setActiveTab(v)} variant="scrollable" scrollButtons="auto"
          sx={{ '& .Mui-selected': { color: '#6366f1' }, '& .MuiTabs-indicator': { bgcolor: '#6366f1' } }}>
          <Tab icon={<Eye size={16} />} iconPosition="start" label="Satıcı İstihbaratı" sx={{ textTransform: 'none', minHeight: 48 }} />
          <Tab icon={<ArrowUpDown size={16} />} iconPosition="start" label="Listeleme Karşılaştırması" sx={{ textTransform: 'none', minHeight: 48 }} />
          <Tab icon={<TrendingUp size={16} />} iconPosition="start" label="Pazar Trendleri" sx={{ textTransform: 'none', minHeight: 48 }} />
        </Tabs>
      </Paper>

      {activeTab === 0 && <SellerSpy userId={userId} marketplace={marketplace} userListings={userListings} onNavigate={onNavigate} />}
      {activeTab === 1 && <ListingComparison marketplace={marketplace} />}
      {activeTab === 2 && <MarketTrends marketplace={marketplace} onNavigate={onNavigate} userId={userId} />}
    </Box>
  );
}
