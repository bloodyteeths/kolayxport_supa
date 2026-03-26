import React, { useState, useCallback } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  LinearProgress, Alert, Slider, Switch, FormControlLabel,
  InputAdornment, IconButton, Collapse, Tooltip, Select, MenuItem,
  FormControl, InputLabel, useMediaQuery, useTheme,
} from '@mui/material';
import {
  Search, TrendingUp, DollarSign, Package, ChevronDown, ChevronUp,
  ExternalLink, AlertTriangle, Zap, RefreshCw, Settings,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import { CATEGORY_FEES, type CategoryFee } from '../../../lib/arbitrage/categoryFees';
import type { ArbitrageResult, ArbitrageScanResponse } from '../../../lib/arbitrage/types';

interface ArbitrageScannerProps {
  userId: string;
}

const VERDICT_CONFIG = {
  excellent: { color: '#2e7d32', bg: '#e8f5e9', label: 'Mükemmel Fırsat', emoji: '🔥' },
  good: { color: '#1565c0', bg: '#e3f2fd', label: 'İyi Fırsat', emoji: '✅' },
  marginal: { color: '#e65100', bg: '#fff3e0', label: 'Marjinal', emoji: '⚠️' },
  skip: { color: '#c62828', bg: '#ffebee', label: 'Geçin', emoji: '❌' },
};

const fmt = (n: number) => `$${n.toFixed(2)}`;
const fmtTry = (n: number) => `₺${n.toFixed(2)}`;

export default function ArbitrageScanner({ userId }: ArbitrageScannerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Search params
  const [keywords, setKeywords] = useState('');
  const [shippingCost, setShippingCost] = useState(15);
  const [minProfit, setMinProfit] = useState(5);
  const [minRoi, setMinRoi] = useState(20);
  const [maxResults, setMaxResults] = useState(30);
  const [includeInternational, setIncludeInternational] = useState(true);
  const [highDefectRate, setHighDefectRate] = useState(false);
  const [feeOverride, setFeeOverride] = useState<string>('');
  const [exchangeRateOverride, setExchangeRateOverride] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);

  // Results
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<ArbitrageScanResponse | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [filterVerdict, setFilterVerdict] = useState<string>('all');

  const handleScan = useCallback(async () => {
    const kws = keywords.split(',').map(k => k.trim()).filter(Boolean);
    if (kws.length === 0) {
      toast.error('En az bir anahtar kelime girin');
      return;
    }

    setLoading(true);
    setResponse(null);
    setExpandedIdx(null);

    try {
      const body: any = {
        action: 'scan',
        keywords: kws,
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
        toast.success(`${data.profitable} karlı ürün bulundu! (${data.totalScanned} tarandı)`);
      } else {
        toast(`${data.totalScanned} ürün tarandı, karlı ürün bulunamadı`, { icon: '🔍' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Tarama başarısız');
    } finally {
      setLoading(false);
    }
  }, [keywords, shippingCost, minProfit, minRoi, maxResults, includeInternational, highDefectRate, feeOverride, exchangeRateOverride]);

  const filtered = response?.results.filter(r => {
    if (filterVerdict === 'all') return true;
    if (filterVerdict === 'profitable') return r.financials.profitUsd >= minProfit && r.financials.roiPercent >= minRoi;
    return r.verdict === filterVerdict;
  }) || [];

  return (
    <Box>
      {/* Header */}
      <Paper sx={{ p: 2, mb: 2, background: 'linear-gradient(135deg, #1a237e 0%, #4527a0 100%)', color: 'white' }}>
        <Typography variant="h6" sx={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Zap size={20} /> Trendyol → eBay Arbitraj Bulucu
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5 }}>
          Trendyol&apos;dan ucuza alıp eBay&apos;de karlı satılabilecek ürünleri otomatik bulun
        </Typography>
      </Paper>

      {/* Search Form */}
      <Paper sx={{ p: 2, mb: 2 }}>
        <TextField
          fullWidth
          label="Anahtar Kelimeler"
          placeholder="baby shoes, turkish towel, ceramic bowl (virgülle ayırın)"
          value={keywords}
          onChange={e => setKeywords(e.target.value)}
          size="small"
          sx={{ mb: 2 }}
          helperText="İngilizce anahtar kelimeler girin — Trendyol'da aranır, eBay'de karşılaştırılır"
        />

        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <TextField
            label="Kargo Ücreti ($)"
            type="number"
            value={shippingCost}
            onChange={e => setShippingCost(Number(e.target.value))}
            size="small"
            sx={{ width: 140 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField
            label="Min. Kâr ($)"
            type="number"
            value={minProfit}
            onChange={e => setMinProfit(Number(e.target.value))}
            size="small"
            sx={{ width: 130 }}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField
            label="Min. ROI (%)"
            type="number"
            value={minRoi}
            onChange={e => setMinRoi(Number(e.target.value))}
            size="small"
            sx={{ width: 130 }}
            InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
          />
        </Box>

        {/* Advanced Settings */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: showSettings ? 2 : 0 }}>
          <Button
            size="small"
            startIcon={<Settings size={14} />}
            onClick={() => setShowSettings(!showSettings)}
            sx={{ textTransform: 'none' }}
          >
            Gelişmiş Ayarlar {showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </Button>
        </Box>

        <Collapse in={showSettings}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2, p: 2, bgcolor: 'grey.50', borderRadius: 1 }}>
            <TextField
              label="Döviz Kuru (TRY→USD)"
              type="number"
              value={exchangeRateOverride}
              onChange={e => setExchangeRateOverride(e.target.value)}
              size="small"
              sx={{ width: 180 }}
              placeholder="Otomatik"
              helperText="Boş bırakın = güncel kur"
              inputProps={{ step: 0.001 }}
            />
            <TextField
              label="eBay Komisyon Override (%)"
              type="number"
              value={feeOverride}
              onChange={e => setFeeOverride(e.target.value)}
              size="small"
              sx={{ width: 200 }}
              placeholder="Otomatik (kategoriye göre)"
              helperText="Boş = kategori bazlı otomatik"
              inputProps={{ step: 0.5 }}
            />
            <TextField
              label="Maks Trendyol Ürün"
              type="number"
              value={maxResults}
              onChange={e => setMaxResults(Number(e.target.value))}
              size="small"
              sx={{ width: 160 }}
            />
            <FormControlLabel
              control={<Switch checked={includeInternational} onChange={e => setIncludeInternational(e.target.checked)} size="small" />}
              label={<Typography variant="body2">Uluslararası Ücret (%1.65)</Typography>}
            />
            <FormControlLabel
              control={<Switch checked={highDefectRate} onChange={e => setHighDefectRate(e.target.checked)} size="small" color="warning" />}
              label={
                <Typography variant="body2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  Yüksek Defect Rate (+5%)
                  <Tooltip title="Below Standard satıcılar ek %5 komisyon öder">
                    <AlertTriangle size={12} color="#e65100" />
                  </Tooltip>
                </Typography>
              }
            />
          </Box>

          {/* Category fee reference */}
          <Box sx={{ p: 2, bgcolor: 'grey.50', borderRadius: 1, mb: 2, maxHeight: 200, overflow: 'auto' }}>
            <Typography variant="caption" fontWeight={600} sx={{ mb: 1, display: 'block' }}>
              eBay Kategori Komisyon Oranları:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {CATEGORY_FEES.slice(0, 15).map(cat => (
                <Chip
                  key={cat.label}
                  label={`${cat.labelTr}: %${cat.rate}`}
                  size="small"
                  variant="outlined"
                  sx={{ fontSize: '0.7rem' }}
                />
              ))}
            </Box>
          </Box>
        </Collapse>

        <Button
          variant="contained"
          fullWidth
          onClick={handleScan}
          disabled={loading || !keywords.trim()}
          startIcon={loading ? undefined : <Search size={18} />}
          sx={{
            py: 1.5,
            fontWeight: 700,
            background: 'linear-gradient(135deg, #1a237e 0%, #4527a0 100%)',
          }}
        >
          {loading ? 'Taranıyor...' : 'Arbitraj Tara'}
        </Button>

        {loading && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress sx={{ borderRadius: 1 }} />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', textAlign: 'center' }}>
              Trendyol ürünleri aranıyor ve eBay fiyatlarıyla karşılaştırılıyor...
            </Typography>
          </Box>
        )}
      </Paper>

      {/* Summary */}
      {response && (
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center' }}>
            <StatCard label="Taranan" value={response.totalScanned} icon="🔍" />
            <StatCard label="Karlı" value={response.profitable} icon="💰" color="#2e7d32" />
            <StatCard label="Döviz Kuru" value={`1 TRY = ${response.exchangeRate.toFixed(4)} USD`} icon="💱" />
            <StatCard label="Süre" value={`${(response.scanDurationMs / 1000).toFixed(1)}s`} icon="⏱️" />
          </Box>

          {/* Filter */}
          {response.results.length > 0 && (
            <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
              {['all', 'profitable', 'excellent', 'good', 'marginal', 'skip'].map(v => (
                <Chip
                  key={v}
                  label={v === 'all' ? `Tümü (${response.results.length})` : v === 'profitable' ? `Karlı (${response.profitable})` : `${VERDICT_CONFIG[v as keyof typeof VERDICT_CONFIG]?.label || v}`}
                  onClick={() => setFilterVerdict(v)}
                  color={filterVerdict === v ? 'primary' : 'default'}
                  variant={filterVerdict === v ? 'filled' : 'outlined'}
                  size="small"
                />
              ))}
            </Box>
          )}
        </Paper>
      )}

      {/* Results */}
      {filtered.map((result, idx) => (
        <ArbitrageCard
          key={`${result.trendyol.id}-${idx}`}
          result={result}
          expanded={expandedIdx === idx}
          onToggle={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
          isMobile={isMobile}
        />
      ))}

      {response && filtered.length === 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          {filterVerdict !== 'all'
            ? 'Bu filtreye uygun sonuç yok. Filtreyi değiştirmeyi deneyin.'
            : 'Hiç sonuç bulunamadı. Farklı anahtar kelimeler deneyin.'}
        </Alert>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatCard({ label, value, icon, color }: { label: string; value: string | number; icon: string; color?: string }) {
  return (
    <Box sx={{ textAlign: 'center', px: 2, py: 1, minWidth: 100 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, color: color || 'text.primary' }}>
        {icon} {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
    </Box>
  );
}

function ArbitrageCard({ result, expanded, onToggle, isMobile }: {
  result: ArbitrageResult;
  expanded: boolean;
  onToggle: () => void;
  isMobile: boolean;
}) {
  const { trendyol: tp, ebay, financials: fin, verdict, score } = result;
  const vc = VERDICT_CONFIG[verdict];

  return (
    <Paper
      sx={{
        mb: 1.5,
        border: `2px solid ${vc.color}20`,
        overflow: 'hidden',
        '&:hover': { borderColor: `${vc.color}40` },
        transition: 'border-color 0.2s',
      }}
    >
      {/* Header row */}
      <Box
        onClick={onToggle}
        sx={{
          p: 1.5,
          cursor: 'pointer',
          display: 'flex',
          gap: 1.5,
          alignItems: 'center',
          flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}
      >
        {/* Product image */}
        {tp.imageUrl && (
          <Box
            component="img"
            src={tp.imageUrl}
            alt={tp.name}
            sx={{ width: 56, height: 56, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }}
          />
        )}

        {/* Product info */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap>
            {tp.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {tp.brand} · {tp.merchantName}
          </Typography>
        </Box>

        {/* Key numbers */}
        <Box sx={{ display: 'flex', gap: isMobile ? 1 : 2, alignItems: 'center', flexShrink: 0, flexWrap: 'wrap' }}>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Trendyol</Typography>
            <Typography variant="body2" fontWeight={600}>{fmtTry(tp.priceTry)}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">eBay Med.</Typography>
            <Typography variant="body2" fontWeight={600}>{fmt(ebay.medianPrice)}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary">Kâr</Typography>
            <Typography variant="body2" fontWeight={700} color={fin.profitUsd > 0 ? 'success.main' : 'error.main'}>
              {fmt(fin.profitUsd)}
            </Typography>
          </Box>
          <Chip
            label={`${vc.emoji} ${score}`}
            size="small"
            sx={{ bgcolor: vc.bg, color: vc.color, fontWeight: 700 }}
          />
          {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </Box>
      </Box>

      {/* Expanded details */}
      <Collapse in={expanded}>
        <Divider />
        <Box sx={{ p: 2 }}>
          {/* Financial breakdown */}
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            💰 Finansal Detay
          </Typography>
          <Box sx={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr',
            gap: 1,
            mb: 2,
          }}>
            <FinRow label="Ürün Maliyeti" value={`${fmtTry(fin.costTry)} = ${fmt(fin.costUsd)}`} />
            <FinRow label="Kargo" value={fmt(fin.shippingUsd)} />
            <FinRow label={`eBay Komisyon (%${fin.ebayFeePercent})`} value={fmt(fin.ebayFeeUsd)} sub={fin.ebayFeeName} />
            <FinRow label="Ödeme İşlem" value={fmt(fin.paymentFeeUsd)} sub="2.35% + $0.30" />
            {fin.internationalFeeUsd > 0 && (
              <FinRow label="Uluslararası" value={fmt(fin.internationalFeeUsd)} sub="1.65%" />
            )}
            <FinRow label="Toplam Maliyet" value={fmt(fin.totalCostUsd)} bold />
            <FinRow label="Satış Fiyatı" value={fmt(fin.suggestedPriceUsd)} bold />
            <FinRow label="Net Kâr" value={fmt(fin.profitUsd)} bold color={fin.profitUsd > 0 ? '#2e7d32' : '#c62828'} />
          </Box>

          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Chip label={`ROI: %${fin.roiPercent}`} color={fin.roiPercent > 30 ? 'success' : fin.roiPercent > 0 ? 'warning' : 'error'} size="small" />
            <Chip label={`Marj: %${fin.marginPercent}`} color={fin.marginPercent > 20 ? 'success' : fin.marginPercent > 0 ? 'warning' : 'error'} size="small" />
            <Chip label={`eBay Liste: ${ebay.totalListings}`} size="small" variant="outlined" />
            <Chip label={`Ort. Satış: ${ebay.avgSold}`} size="small" variant="outlined" />
          </Box>

          {/* eBay price range */}
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            📊 eBay Fiyat Aralığı
          </Typography>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
            <Chip label={`Min: ${fmt(ebay.minPrice)}`} size="small" variant="outlined" />
            <Chip label={`Ort: ${fmt(ebay.avgPrice)}`} size="small" variant="outlined" />
            <Chip label={`Med: ${fmt(ebay.medianPrice)}`} size="small" variant="outlined" />
            <Chip label={`Max: ${fmt(ebay.maxPrice)}`} size="small" variant="outlined" />
          </Box>

          {/* Top eBay items */}
          {ebay.topItems.length > 0 && (
            <>
              <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
                🛒 eBay Benzer Ürünler
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {ebay.topItems.slice(0, 3).map((item, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: 'flex',
                      gap: 1,
                      alignItems: 'center',
                      p: 1,
                      bgcolor: 'grey.50',
                      borderRadius: 1,
                    }}
                  >
                    {item.imageUrl && (
                      <Box
                        component="img"
                        src={item.imageUrl}
                        alt=""
                        sx={{ width: 40, height: 40, borderRadius: 0.5, objectFit: 'cover' }}
                      />
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" noWrap>{item.title}</Typography>
                      <Box sx={{ display: 'flex', gap: 1 }}>
                        <Typography variant="caption" fontWeight={600}>{fmt(item.price)}</Typography>
                        {item.soldQuantity > 0 && (
                          <Typography variant="caption" color="success.main">{item.soldQuantity} satış</Typography>
                        )}
                      </Box>
                    </Box>
                  </Box>
                ))}
              </Box>
            </>
          )}

          {/* Links */}
          <Box sx={{ display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ExternalLink size={14} />}
              href={tp.url}
              target="_blank"
              sx={{ textTransform: 'none' }}
            >
              Trendyol
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ExternalLink size={14} />}
              href={`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(tp.name.split(' ').slice(0, 4).join(' '))}`}
              target="_blank"
              sx={{ textTransform: 'none' }}
            >
              eBay&apos;de Ara
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

function FinRow({ label, value, sub, bold, color }: {
  label: string;
  value: string;
  sub?: string;
  bold?: boolean;
  color?: string;
}) {
  return (
    <Box sx={{ p: 1, bgcolor: bold ? 'grey.100' : 'transparent', borderRadius: 0.5 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="body2" fontWeight={bold ? 700 : 500} sx={{ color: color || 'text.primary' }}>
        {value}
      </Typography>
      {sub && <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.65rem' }}>{sub}</Typography>}
    </Box>
  );
}
