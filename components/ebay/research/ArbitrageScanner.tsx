import React, { useState, useCallback } from 'react';
import {
  Box, Typography, Button, Paper, Chip, Divider,
  LinearProgress, Alert, Switch, FormControlLabel, TextField,
  InputAdornment, Collapse, Tooltip, useMediaQuery, useTheme,
  IconButton,
} from '@mui/material';
import {
  Search, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, Zap, SlidersHorizontal, X,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { CATEGORY_FEES } from '../../../lib/arbitrage/categoryFees';
import type { ArbitrageResult, ArbitrageScanResponse } from '../../../lib/arbitrage/types';

interface ArbitrageScannerProps {
  userId: string;
}

const VERDICT_CONFIG = {
  excellent: { color: '#2e7d32', bg: '#e8f5e9', label: 'Mükemmel', emoji: '🔥' },
  good: { color: '#1565c0', bg: '#e3f2fd', label: 'İyi', emoji: '✅' },
  marginal: { color: '#e65100', bg: '#fff3e0', label: 'Marjinal', emoji: '⚠️' },
  skip: { color: '#c62828', bg: '#ffebee', label: 'Geçin', emoji: '❌' },
};

const CATEGORIES = [
  { slug: 'pestemal-x-c104074', label: 'Peştemal', emoji: '🏖️' },
  { slug: 'havlu-x-c104073', label: 'Havlu', emoji: '🛁' },
  { slug: 'bornoz-x-c103825', label: 'Bornoz', emoji: '👘' },
  { slug: 'seramik-tabak-x-c104209', label: 'Seramik Tabak', emoji: '🍽️' },
  { slug: 'seramik-kase-x-c104210', label: 'Seramik Kase', emoji: '🥣' },
  { slug: 'cam-bardak-x-c104216', label: 'Cam Bardak', emoji: '🥃' },
  { slug: 'cay-bardagi-x-c104217', label: 'Çay Bardağı', emoji: '🍵' },
  { slug: 'nazar-boncugu-x-c104271', label: 'Nazar Boncuğu', emoji: '🧿' },
  { slug: 'taki-seti-x-c104256', label: 'Takı Seti', emoji: '💍' },
  { slug: 'halhal-x-c104260', label: 'Halhal', emoji: '✨' },
  { slug: 'bakir-cezve-x-c104262', label: 'Bakır Cezve', emoji: '☕' },
  { slug: 'lamba-x-c104155', label: 'Lamba', emoji: '💡' },
  { slug: 'kilim-x-c104037', label: 'Kilim', emoji: '🪡' },
  { slug: 'yastik-kilifi-x-c104063', label: 'Yastık Kılıfı', emoji: '🛋️' },
  { slug: 'deri-canta-x-c103891', label: 'Deri Çanta', emoji: '👜' },
  { slug: 'lokum-x-c104301', label: 'Lokum', emoji: '🍬' },
  { slug: 'baharat-x-c103966', label: 'Baharat', emoji: '🌶️' },
  { slug: 'zeytinyagi-x-c103955', label: 'Zeytinyağı', emoji: '🫒' },
  { slug: 'el-yapimi-sabun-x-c104389', label: 'El Yapımı Sabun', emoji: '🧼' },
  { slug: 'turk-kahvesi-seti-x-c103760', label: 'Türk Kahvesi Seti', emoji: '☕' },
];

// Popular presets for quick scanning
const PRESETS = [
  { label: 'Ev & Dekor', slugs: ['kilim-x-c104037', 'lamba-x-c104155', 'yastik-kilifi-x-c104063', 'seramik-tabak-x-c104209', 'seramik-kase-x-c104210'] },
  { label: 'Tekstil', slugs: ['pestemal-x-c104074', 'havlu-x-c104073', 'bornoz-x-c103825'] },
  { label: 'Takı & Aksesuar', slugs: ['nazar-boncugu-x-c104271', 'taki-seti-x-c104256', 'halhal-x-c104260', 'deri-canta-x-c103891'] },
  { label: 'Mutfak', slugs: ['bakir-cezve-x-c104262', 'cay-bardagi-x-c104217', 'cam-bardak-x-c104216', 'turk-kahvesi-seti-x-c103760'] },
  { label: 'Yiyecek', slugs: ['lokum-x-c104301', 'baharat-x-c103966', 'zeytinyagi-x-c103955'] },
];

const fmt = (n: number) => `$${n.toFixed(2)}`;
const fmtTry = (n: number) => `₺${n.toFixed(0)}`;

export default function ArbitrageScanner({ userId }: ArbitrageScannerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [shippingCost, setShippingCost] = useState(15);
  const [minProfit, setMinProfit] = useState(5);
  const [minRoi, setMinRoi] = useState(20);
  const [maxResults, setMaxResults] = useState(30);
  const [includeInternational, setIncludeInternational] = useState(true);
  const [highDefectRate, setHighDefectRate] = useState(false);
  const [feeOverride, setFeeOverride] = useState<string>('');
  const [exchangeRateOverride, setExchangeRateOverride] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [showCategories, setShowCategories] = useState(false);

  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ArbitrageScanResponse | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [filterVerdict, setFilterVerdict] = useState<string>('all');

  const toggleCategory = (slug: string) => {
    setSelectedCategories(prev =>
      prev.includes(slug) ? prev.filter(s => s !== slug) : [...prev, slug]
    );
  };

  const selectPreset = (slugs: string[]) => {
    setSelectedCategories(slugs);
    setShowCategories(false);
  };

  const handleScan = useCallback(async (overrideCategories?: string[]) => {
    const cats = overrideCategories || selectedCategories;
    if (cats.length === 0) {
      toast.error('En az bir kategori seçin');
      return;
    }

    setLoading(true);
    setResponse(null);
    setExpandedIdx(null);
    if (overrideCategories) setSelectedCategories(overrideCategories);

    try {
      const body: any = {
        action: 'scan',
        categories: cats,
        shippingCostUsd: shippingCost,
        minProfitUsd: minProfit,
        minRoiPercent: minRoi,
        maxTrendyolResults: maxResults,
        includeInternationalFee: includeInternational,
        highDefectRate,
      };
      if (feeOverride) body.feeOverridePercent = parseFloat(feeOverride);
      if (exchangeRateOverride) body.exchangeRate = parseFloat(exchangeRateOverride);

      const res = await fetch('/api/clawd/arbitrage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data: ArbitrageScanResponse = await res.json();
      setResponse(data);

      if (data.profitable > 0) {
        toast.success(`${data.profitable} karlı ürün bulundu!`);
      } else {
        toast(`${data.totalScanned} ürün tarandı`, { icon: '🔍' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Tarama başarısız');
    } finally {
      setLoading(false);
    }
  }, [selectedCategories, shippingCost, minProfit, minRoi, maxResults, includeInternational, highDefectRate, feeOverride, exchangeRateOverride]);

  const filtered = response?.results.filter(r => {
    if (filterVerdict === 'all') return true;
    if (filterVerdict === 'profitable') return r.financials.profitUsd >= minProfit && r.financials.roiPercent >= minRoi;
    return r.verdict === filterVerdict;
  }) || [];

  return (
    <Box>
      {/* Quick Start */}
      <Paper sx={{ p: isMobile ? 2 : 3, mb: 2, background: 'linear-gradient(135deg, #1a237e 0%, #4527a0 100%)', color: 'white' }}>
        <Typography variant={isMobile ? 'subtitle1' : 'h6'} sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Zap size={20} /> Trendyol → eBay Arbitraj
        </Typography>

        {/* Preset Quick Buttons */}
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
          {PRESETS.map(preset => (
            <Button
              key={preset.label}
              variant="contained"
              size={isMobile ? 'small' : 'medium'}
              onClick={() => handleScan(preset.slugs)}
              disabled={loading}
              sx={{
                bgcolor: 'rgba(255,255,255,0.15)',
                color: 'white',
                textTransform: 'none',
                fontWeight: 600,
                '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' },
                fontSize: isMobile ? '0.75rem' : '0.85rem',
              }}
            >
              {preset.label}
            </Button>
          ))}
          <Button
            variant="contained"
            size={isMobile ? 'small' : 'medium'}
            onClick={() => handleScan(CATEGORIES.map(c => c.slug))}
            disabled={loading}
            sx={{
              bgcolor: 'rgba(255,255,255,0.25)',
              color: 'white',
              textTransform: 'none',
              fontWeight: 700,
              '&:hover': { bgcolor: 'rgba(255,255,255,0.4)' },
              fontSize: isMobile ? '0.75rem' : '0.85rem',
            }}
          >
            🔍 Hepsini Tara
          </Button>
        </Box>

        {/* Custom Category Picker (collapsible) */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Button
            size="small"
            onClick={() => setShowCategories(!showCategories)}
            sx={{ color: 'rgba(255,255,255,0.8)', textTransform: 'none', fontSize: '0.75rem' }}
            endIcon={showCategories ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          >
            Kategori seç ({selectedCategories.length || 'hiçbiri'})
          </Button>
          {selectedCategories.length > 0 && !loading && (
            <Button
              size="small"
              variant="outlined"
              onClick={() => handleScan()}
              sx={{ color: 'white', borderColor: 'rgba(255,255,255,0.4)', textTransform: 'none', fontWeight: 600 }}
              startIcon={<Search size={14} />}
            >
              Seçilenleri Tara
            </Button>
          )}
        </Box>

        <Collapse in={showCategories}>
          <Box sx={{ mt: 1.5, display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
            {CATEGORIES.map(cat => (
              <Chip
                key={cat.slug}
                label={`${cat.emoji} ${cat.label}`}
                onClick={() => toggleCategory(cat.slug)}
                size="small"
                sx={{
                  bgcolor: selectedCategories.includes(cat.slug) ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.15)',
                  color: selectedCategories.includes(cat.slug) ? '#1a237e' : 'white',
                  fontWeight: selectedCategories.includes(cat.slug) ? 700 : 400,
                  '&:hover': { bgcolor: selectedCategories.includes(cat.slug) ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.25)' },
                }}
              />
            ))}
          </Box>
          {selectedCategories.length > 0 && (
            <Button size="small" onClick={() => setSelectedCategories([])} sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'none', mt: 0.5, fontSize: '0.7rem' }}>
              Temizle
            </Button>
          )}
        </Collapse>

        {/* Loading */}
        {loading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress sx={{ borderRadius: 1, bgcolor: 'rgba(255,255,255,0.2)', '& .MuiLinearProgress-bar': { bgcolor: 'white' } }} />
            <Typography variant="caption" sx={{ mt: 0.5, display: 'block', textAlign: 'center', opacity: 0.85 }}>
              Trendyol → AI Çeviri → eBay eşleştirme...
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Settings (separate, minimal) */}
      <Collapse in={showSettings}>
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle2" fontWeight={700}>Ayarlar</Typography>
            <IconButton size="small" onClick={() => setShowSettings(false)}><X size={16} /></IconButton>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <TextField label="Kargo ($)" type="number" value={shippingCost} onChange={e => setShippingCost(Number(e.target.value))} size="small" sx={{ width: 110 }} InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
            <TextField label="Min. Kâr ($)" type="number" value={minProfit} onChange={e => setMinProfit(Number(e.target.value))} size="small" sx={{ width: 110 }} InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }} />
            <TextField label="Min. ROI" type="number" value={minRoi} onChange={e => setMinRoi(Number(e.target.value))} size="small" sx={{ width: 100 }} InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
            <TextField label="Döviz Kuru" type="number" value={exchangeRateOverride} onChange={e => setExchangeRateOverride(e.target.value)} size="small" sx={{ width: 130 }} placeholder="Otomatik" inputProps={{ step: 0.001 }} />
            <TextField label="Komisyon Override" type="number" value={feeOverride} onChange={e => setFeeOverride(e.target.value)} size="small" sx={{ width: 140 }} placeholder="Otomatik" InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }} />
            <TextField label="Maks Ürün" type="number" value={maxResults} onChange={e => setMaxResults(Number(e.target.value))} size="small" sx={{ width: 100 }} />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel control={<Switch checked={includeInternational} onChange={e => setIncludeInternational(e.target.checked)} size="small" />} label={<Typography variant="body2">Uluslararası Ücret (%1.65)</Typography>} />
            <FormControlLabel
              control={<Switch checked={highDefectRate} onChange={e => setHighDefectRate(e.target.checked)} size="small" color="warning" />}
              label={<Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>Yüksek Defect Rate (+5%) <Tooltip title="Below Standard satıcılar ek %5 komisyon öder"><AlertTriangle size={12} color="#e65100" /></Tooltip></Typography>}
            />
          </Box>
          <Collapse in={showSettings}>
            <Box sx={{ p: 1.5, bgcolor: 'grey.50', borderRadius: 1, mt: 1.5, maxHeight: 150, overflow: 'auto' }}>
              <Typography variant="caption" fontWeight={600} sx={{ mb: 0.5, display: 'block' }}>eBay Komisyon Oranları:</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {CATEGORY_FEES.slice(0, 15).map(cat => (
                  <Chip key={cat.label} label={`${cat.labelTr}: %${cat.rate}`} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                ))}
              </Box>
            </Box>
          </Collapse>
        </Paper>
      </Collapse>

      {!showSettings && !loading && (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
          <Button size="small" startIcon={<SlidersHorizontal size={14} />} onClick={() => setShowSettings(true)} sx={{ textTransform: 'none', fontSize: '0.75rem', color: 'text.secondary' }}>
            Ayarlar
          </Button>
        </Box>
      )}

      {/* Summary */}
      {response && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: isMobile ? 1.5 : 3, flexWrap: 'wrap', justifyContent: 'center' }}>
            <StatBox label="Taranan" value={response.totalScanned} />
            <StatBox label="Eşleşen" value={response.results.length} />
            <StatBox label="Karlı" value={response.profitable} color="#2e7d32" />
            <StatBox label="Kur" value={`₺1 = $${response.exchangeRate.toFixed(4)}`} small />
            <StatBox label="Süre" value={`${(response.scanDurationMs / 1000).toFixed(0)}s`} />
          </Box>
          {response.results.length > 0 && (
            <Box sx={{ mt: 1.5, display: 'flex', gap: 0.75, flexWrap: 'wrap', justifyContent: 'center' }}>
              {['all', 'profitable', 'excellent', 'good', 'marginal', 'skip'].map(v => {
                const count = v === 'all' ? response.results.length
                  : v === 'profitable' ? response.profitable
                  : response.results.filter(r => r.verdict === v).length;
                if (count === 0 && v !== 'all') return null;
                return (
                  <Chip
                    key={v}
                    label={v === 'all' ? `Tümü (${count})` : v === 'profitable' ? `💰 Karlı (${count})` : `${VERDICT_CONFIG[v as keyof typeof VERDICT_CONFIG]?.emoji} ${VERDICT_CONFIG[v as keyof typeof VERDICT_CONFIG]?.label} (${count})`}
                    onClick={() => setFilterVerdict(v)}
                    color={filterVerdict === v ? 'primary' : 'default'}
                    variant={filterVerdict === v ? 'filled' : 'outlined'}
                    size="small"
                  />
                );
              })}
            </Box>
          )}
        </Paper>
      )}

      {/* Results */}
      {filtered.map((result, idx) => (
        <ResultCard key={`${result.trendyol.id}-${idx}`} result={result} expanded={expandedIdx === idx} onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)} isMobile={isMobile} />
      ))}

      {response && filtered.length === 0 && (
        <Alert severity="info" sx={{ mt: 1 }}>
          {filterVerdict !== 'all' ? 'Bu filtreye uygun sonuç yok.' : 'Eşleşen ürün bulunamadı. Farklı kategoriler deneyin.'}
        </Alert>
      )}
    </Box>
  );
}

function StatBox({ label, value, color, small }: { label: string; value: string | number; color?: string; small?: boolean }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography variant={small ? 'body2' : 'h6'} sx={{ fontWeight: 700, color: color || 'text.primary', lineHeight: 1.2 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

function ResultCard({ result, expanded, onToggle, isMobile }: { result: ArbitrageResult; expanded: boolean; onToggle: () => void; isMobile: boolean }) {
  const { trendyol: tp, ebay, financials: fin, verdict, score } = result;
  const vc = VERDICT_CONFIG[verdict];

  return (
    <Paper sx={{ mb: 1, border: `2px solid ${vc.color}20`, overflow: 'hidden', '&:hover': { borderColor: `${vc.color}40` }, transition: 'border-color 0.15s' }}>
      {/* Compact row */}
      <Box onClick={onToggle} sx={{ p: 1.5, cursor: 'pointer', display: 'flex', gap: 1.5, alignItems: 'center' }}>
        {tp.imageUrl && <Box component="img" src={tp.imageUrl} alt={tp.name} sx={{ width: 48, height: 48, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>{tp.name}</Typography>
          <Typography variant="caption" color="text.secondary">{tp.brand}</Typography>
        </Box>
        {!isMobile && (
          <>
            <PriceCol label="Trendyol" value={fmtTry(tp.priceTry)} />
            <PriceCol label="eBay" value={fmt(ebay.medianPrice)} />
          </>
        )}
        <PriceCol label="Kâr" value={fmt(fin.profitUsd)} color={fin.profitUsd > 0 ? '#2e7d32' : '#c62828'} bold />
        <Chip label={`${vc.emoji} ${score}`} size="small" sx={{ bgcolor: vc.bg, color: vc.color, fontWeight: 700, minWidth: 56 }} />
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </Box>

      {/* Mobile price row */}
      {isMobile && !expanded && (
        <Box sx={{ px: 1.5, pb: 1, display: 'flex', gap: 2 }}>
          <Typography variant="caption" color="text.secondary">Trendyol: <b>{fmtTry(tp.priceTry)}</b></Typography>
          <Typography variant="caption" color="text.secondary">eBay: <b>{fmt(ebay.medianPrice)}</b></Typography>
          <Typography variant="caption" color="text.secondary">ROI: <b>{fin.roiPercent.toFixed(0)}%</b></Typography>
        </Box>
      )}

      {/* Expanded detail */}
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ p: 2 }}>
          {/* Financial grid */}
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 1, mb: 2 }}>
            <FinCell label="Ürün Maliyeti" value={`${fmtTry(fin.costTry)} (${fmt(fin.costUsd)})`} />
            <FinCell label="Kargo" value={fmt(fin.shippingUsd)} />
            <FinCell label={`eBay %${fin.ebayFeePercent}`} value={fmt(fin.ebayFeeUsd)} sub={fin.ebayFeeName} />
            <FinCell label="Ödeme İşlem" value={fmt(fin.paymentFeeUsd)} />
            {fin.internationalFeeUsd > 0 && <FinCell label="Uluslararası" value={fmt(fin.internationalFeeUsd)} />}
            <FinCell label="Toplam Maliyet" value={fmt(fin.totalCostUsd)} bold />
            <FinCell label="Satış Fiyatı" value={fmt(fin.suggestedPriceUsd)} bold />
            <FinCell label="Net Kâr" value={fmt(fin.profitUsd)} bold color={fin.profitUsd > 0 ? '#2e7d32' : '#c62828'} />
          </Box>

          {/* Metrics row */}
          <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2 }}>
            <Chip label={`ROI: %${fin.roiPercent.toFixed(0)}`} color={fin.roiPercent > 30 ? 'success' : fin.roiPercent > 0 ? 'warning' : 'error'} size="small" />
            <Chip label={`Marj: %${fin.marginPercent.toFixed(0)}`} color={fin.marginPercent > 20 ? 'success' : fin.marginPercent > 0 ? 'warning' : 'error'} size="small" />
            <Chip label={`${ebay.totalListings} liste`} size="small" variant="outlined" />
            {ebay.avgSold > 0 && <Chip label={`${ebay.avgSold.toFixed(0)} ort. satış`} size="small" variant="outlined" />}
          </Box>

          {/* eBay price range */}
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            <Chip label={`Min ${fmt(ebay.minPrice)}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            <Chip label={`Ort ${fmt(ebay.avgPrice)}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
            <Chip label={`Max ${fmt(ebay.maxPrice)}`} size="small" variant="outlined" sx={{ fontSize: '0.7rem' }} />
          </Box>

          {/* eBay comparables */}
          {ebay.topItems.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block' }}>eBay Benzer Ürünler</Typography>
              {ebay.topItems.slice(0, 3).map((item, i) => (
                <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'center', py: 0.5 }}>
                  {item.imageUrl && <Box component="img" src={item.imageUrl} alt="" sx={{ width: 32, height: 32, borderRadius: 0.5, objectFit: 'cover' }} />}
                  <Typography variant="caption" sx={{ flex: 1 }} noWrap>{item.title}</Typography>
                  <Typography variant="caption" fontWeight={600}>{fmt(item.price)}</Typography>
                  {item.soldQuantity > 0 && <Typography variant="caption" color="success.main">{item.soldQuantity}x</Typography>}
                </Box>
              ))}
            </Box>
          )}

          {/* Links */}
          <Box sx={{ display: 'flex', gap: 1 }}>
            {tp.url && <Button size="small" variant="outlined" startIcon={<ExternalLink size={12} />} href={tp.url} target="_blank" sx={{ textTransform: 'none', fontSize: '0.75rem' }}>Trendyol</Button>}
            <Button size="small" variant="outlined" startIcon={<ExternalLink size={12} />} href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(tp.brand + ' ' + tp.name.split(' ').slice(0, 3).join(' '))}`} target="_blank" sx={{ textTransform: 'none', fontSize: '0.75rem' }}>eBay</Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

function PriceCol({ label, value, color, bold }: { label: string; value: string; color?: string; bold?: boolean }) {
  return (
    <Box sx={{ textAlign: 'center', minWidth: 60 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem', lineHeight: 1 }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 600, color: color || 'text.primary', lineHeight: 1.2 }}>{value}</Typography>
    </Box>
  );
}

function FinCell({ label, value, sub, bold, color }: { label: string; value: string; sub?: string; bold?: boolean; color?: string }) {
  return (
    <Box sx={{ p: 0.75, bgcolor: bold ? 'grey.100' : 'transparent', borderRadius: 0.5 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.65rem' }}>{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: bold ? 700 : 500, color: color || 'text.primary' }}>{value}</Typography>
      {sub && <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>{sub}</Typography>}
    </Box>
  );
}
