import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  Box, Typography, TextField, Button, Paper, Chip, Divider,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  LinearProgress, Alert, Tabs, Tab, Select, MenuItem, FormControl,
  InputLabel, Tooltip, IconButton, InputAdornment, Slider, Switch,
  FormControlLabel,
} from '@mui/material';
import {
  DollarSign, Calculator, TrendingUp, TrendingDown, Package,
  Download, Trash2, Plus, BarChart2, Target, Info, ArrowUpDown,
} from 'lucide-react';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FinancialIntelligenceProps {
  userId: string;
  marketplace: string;
}

interface EbayCategory {
  label: string;
  rate: number;
  cap?: number;
  note?: string;
}

interface ROIEntry {
  id: string;
  productName: string;
  sellingPrice: number;
  productCost: number;
  shippingCost: number;
  ebayFees: number;
  otherCosts: number;
  date: string;
}

interface SourcingScenario {
  label: string;
  price: number;
  fees: number;
  profit: number;
  margin: number;
  roi: number;
}

type SortField = 'productName' | 'sellingPrice' | 'productCost' | 'shippingCost' | 'ebayFees' | 'profit' | 'margin' | 'roi' | 'date';
type SortDir = 'asc' | 'desc';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EBAY_CATEGORIES: EbayCategory[] = [
  { label: 'Genel Kategoriler (Çoğu)', rate: 13.25 },
  { label: 'Kitaplar, DVD, Müzik', rate: 14.95 },
  { label: 'Madeni Paralar & Kağıt Para', rate: 6.35 },
  { label: 'Gitarlar & Baslar', rate: 3.5 },
  { label: 'Ağır Ekipman', rate: 2, cap: 300, note: 'Maks $300 sınırlı' },
  { label: 'Mücevher & Saat (>$1000)', rate: 6.5 },
  { label: 'Spor Ayakkabılar (Auth Guarantee)', rate: 8 },
  { label: 'İş & Endüstriyel', rate: 4 },
  { label: 'Müzik Aletleri (>$7500)', rate: 6.35 },
];

const STORAGE_KEY = 'kolayxport_roi_entries';

const VOLUME_TIERS = [10, 25, 50, 100];
const VOLUME_DISCOUNT_PER_TIER = 0.05;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmt = (n: number) => `$${n.toFixed(2)}`;
const pct = (n: number) => `${n.toFixed(1)}%`;

const generateId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const calcEbayFinalValueFee = (price: number, category: EbayCategory): number => {
  const fee = price * (category.rate / 100);
  if (category.cap && fee > category.cap) return category.cap;
  return fee;
};

const calcPaymentProcessingFee = (total: number): number => total * 0.0235 + 0.30;

const calcInternationalFee = (total: number): number => total * 0.0165;

const calcPromotedFee = (price: number, adRate: number): number => price * (adRate / 100);

const calcTotalFees = (
  sellingPrice: number,
  shippingCharged: number,
  category: EbayCategory,
  isInternational: boolean,
  isPromoted: boolean,
  adRate: number,
  freeInsertions: boolean,
): {
  finalValueFee: number;
  paymentFee: number;
  internationalFee: number;
  insertionFee: number;
  promotedFee: number;
  totalFees: number;
} => {
  const transactionTotal = sellingPrice + shippingCharged;
  const finalValueFee = calcEbayFinalValueFee(transactionTotal, category);
  const paymentFee = calcPaymentProcessingFee(transactionTotal);
  const internationalFee = isInternational ? calcInternationalFee(transactionTotal) : 0;
  const insertionFee = freeInsertions ? 0 : 0.35;
  const promotedFee = isPromoted ? calcPromotedFee(sellingPrice, adRate) : 0;
  const totalFees = finalValueFee + paymentFee + internationalFee + insertionFee + promotedFee;
  return { finalValueFee, paymentFee, internationalFee, insertionFee, promotedFee, totalFees };
};

// ---------------------------------------------------------------------------
// Sub-tab Panel
// ---------------------------------------------------------------------------

function TabPanel({ children, value, index }: { children: React.ReactNode; value: number; index: number }) {
  return value === index ? <Box sx={{ pt: 2 }}>{children}</Box> : null;
}

// ---------------------------------------------------------------------------
// Sub-tab 1: Revenue Calculator
// ---------------------------------------------------------------------------

function RevenueCalculator() {
  const [sellingPrice, setSellingPrice] = useState<string>('29.99');
  const [categoryIdx, setCategoryIdx] = useState<number>(0);
  const [shippingCharged, setShippingCharged] = useState<string>('5.99');
  const [actualShippingCost, setActualShippingCost] = useState<string>('4.50');
  const [productCost, setProductCost] = useState<string>('8.00');
  const [isInternational, setIsInternational] = useState(false);
  const [isPromoted, setIsPromoted] = useState(false);
  const [adRate, setAdRate] = useState<number>(5);
  const [freeInsertions, setFreeInsertions] = useState(true);

  const category = EBAY_CATEGORIES[categoryIdx];
  const sp = parseFloat(sellingPrice) || 0;
  const sc = parseFloat(shippingCharged) || 0;
  const asc = parseFloat(actualShippingCost) || 0;
  const pc = parseFloat(productCost) || 0;

  const fees = useMemo(
    () => calcTotalFees(sp, sc, category, isInternational, isPromoted, adRate, freeInsertions),
    [sp, sc, category, isInternational, isPromoted, adRate, freeInsertions],
  );

  const netRevenue = sp + sc - fees.totalFees;
  const profit = netRevenue - asc - pc;
  const profitMargin = sp > 0 ? (profit / sp) * 100 : 0;
  const roi = pc > 0 ? (profit / pc) * 100 : 0;

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Calculator size={20} /> Gelir Hesaplayıcı
      </Typography>

      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 2 }}>Satış Bilgileri</Typography>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mb: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Kategori</InputLabel>
            <Select
              value={categoryIdx}
              label="Kategori"
              onChange={(e) => setCategoryIdx(Number(e.target.value))}
            >
              {EBAY_CATEGORIES.map((cat, i) => (
                <MenuItem key={i} value={i}>
                  {cat.label} ({pct(cat.rate)})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Satış Fiyatı"
            size="small"
            type="number"
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />

          <TextField
            label="Alıcıya Yansıtılan Kargo"
            size="small"
            type="number"
            value={shippingCharged}
            onChange={(e) => setShippingCharged(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />

          <TextField
            label="Gerçek Kargo Maliyeti"
            size="small"
            type="number"
            value={actualShippingCost}
            onChange={(e) => setActualShippingCost(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />

          <TextField
            label="Ürün Maliyeti"
            size="small"
            type="number"
            value={productCost}
            onChange={(e) => setProductCost(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
        </Box>

        {category.note && (
          <Alert severity="info" sx={{ mb: 2 }}>
            {category.note}
          </Alert>
        )}

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>Ek Ayarlar</Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mb: 2 }}>
          <FormControlLabel
            control={<Switch checked={isInternational} onChange={(e) => setIsInternational(e.target.checked)} />}
            label="Uluslararası Satış (+1.65%)"
          />
          <FormControlLabel
            control={<Switch checked={!freeInsertions} onChange={(e) => setFreeInsertions(!e.target.checked)} />}
            label="Ücretsiz listeleme hakkı bitti ($0.35)"
          />
          <FormControlLabel
            control={<Switch checked={isPromoted} onChange={(e) => setIsPromoted(e.target.checked)} />}
            label="Promoted Listings"
          />
        </Box>

        {isPromoted && (
          <Box sx={{ px: 2, mb: 2 }}>
            <Typography variant="body2" gutterBottom>
              Reklam Oranı: {pct(adRate)}
            </Typography>
            <Slider
              value={adRate}
              onChange={(_, v) => setAdRate(v as number)}
              min={2}
              max={15}
              step={0.5}
              marks={[
                { value: 2, label: '2%' },
                { value: 5, label: '5%' },
                { value: 10, label: '10%' },
                { value: 15, label: '15%' },
              ]}
              valueLabelDisplay="auto"
              valueLabelFormat={(v) => pct(v)}
            />
          </Box>
        )}
      </Paper>

      {/* Results */}
      <Paper sx={{ p: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 2 }}>Hesaplama Sonuçları</Typography>

        <TableContainer>
          <Table size="small">
            <TableBody>
              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>eBay Final Value Fee ({pct(category.rate)})</TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(fees.finalValueFee)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>Ödeme İşlem Ücreti (2.35% + $0.30)</TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(fees.paymentFee)}</TableCell>
              </TableRow>
              {isInternational && (
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Uluslararası Ücret (1.65%)</TableCell>
                  <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(fees.internationalFee)}</TableCell>
                </TableRow>
              )}
              {!freeInsertions && (
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Listeleme Ücreti</TableCell>
                  <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(fees.insertionFee)}</TableCell>
                </TableRow>
              )}
              {isPromoted && (
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Promoted Listing Ücreti ({pct(adRate)})</TableCell>
                  <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(fees.promotedFee)}</TableCell>
                </TableRow>
              )}
              <TableRow sx={{ '& td': { borderTop: '2px solid', borderColor: 'divider' } }}>
                <TableCell sx={{ fontWeight: 700 }}>Toplam Ücretler</TableCell>
                <TableCell align="right" sx={{ fontWeight: 700, color: 'error.main' }}>-{fmt(fees.totalFees)}</TableCell>
              </TableRow>

              <TableRow>
                <TableCell colSpan={2} sx={{ py: 1 }} />
              </TableRow>

              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>Satış Fiyatı + Kargo</TableCell>
                <TableCell align="right">{fmt(sp + sc)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>Net Gelir (Ücretler Düşüldükten Sonra)</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(netRevenue)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>Gerçek Kargo Maliyeti</TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(asc)}</TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>Ürün Maliyeti</TableCell>
                <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(pc)}</TableCell>
              </TableRow>

              <TableRow sx={{ '& td': { borderTop: '2px solid', borderColor: 'divider' } }}>
                <TableCell sx={{ fontWeight: 700, fontSize: '1.05rem' }}>Kâr</TableCell>
                <TableCell
                  align="right"
                  sx={{ fontWeight: 700, fontSize: '1.05rem', color: profit >= 0 ? 'success.main' : 'error.main' }}
                >
                  {fmt(profit)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>Kâr Marjı</TableCell>
                <TableCell align="right" sx={{ color: profitMargin >= 0 ? 'success.main' : 'error.main' }}>
                  {pct(profitMargin)}
                </TableCell>
              </TableRow>
              <TableRow>
                <TableCell sx={{ fontWeight: 500 }}>ROI (Yatırım Getirisi)</TableCell>
                <TableCell align="right" sx={{ color: roi >= 0 ? 'success.main' : 'error.main' }}>
                  {pct(roi)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </TableContainer>

        {profit < 0 && (
          <Alert severity="warning" sx={{ mt: 2 }}>
            Bu satış kârsız! Minimum satış fiyatı {fmt(pc + asc + fees.totalFees - sc)} olmalıdır.
          </Alert>
        )}

        {profitMargin > 0 && profitMargin < 10 && (
          <Alert severity="info" sx={{ mt: 2 }}>
            Kâr marjı %10 altında. Daha yüksek fiyat veya daha düşük maliyet değerlendirin.
          </Alert>
        )}
      </Paper>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Sub-tab 2: Sourcing Calculator
// ---------------------------------------------------------------------------

function SourcingCalculator({ marketplace }: { marketplace: string }) {
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [marketData, setMarketData] = useState<{
    avgPrice: number;
    medianPrice: number;
    p25Price: number;
    p75Price: number;
    totalResults: number;
  } | null>(null);

  const [sourcingCost, setSourcingCost] = useState<string>('');
  const [shippingToBuyer, setShippingToBuyer] = useState<string>('5.00');
  const [shippingFromSupplier, setShippingFromSupplier] = useState<string>('2.00');
  const [targetMargin, setTargetMargin] = useState<string>('30');
  const [targetMonthlyIncome, setTargetMonthlyIncome] = useState<string>('1000');
  const [categoryIdx, setCategoryIdx] = useState(0);

  const category = EBAY_CATEGORIES[categoryIdx];

  const fetchMarketData = useCallback(async () => {
    if (!keyword.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/clawd/ebay?action=search&query=${encodeURIComponent(keyword)}&marketplace=${marketplace}&limit=50`);
      if (!res.ok) throw new Error('Arama başarısız');
      const data = await res.json();
      const items = data.itemSummaries || [];
      if (items.length === 0) {
        toast.error('Sonuç bulunamadı');
        setMarketData(null);
        setLoading(false);
        return;
      }
      const prices = items
        .map((i: any) => parseFloat(i.price?.value || '0'))
        .filter((p: number) => p > 0)
        .sort((a: number, b: number) => a - b);

      const sum = prices.reduce((s: number, p: number) => s + p, 0);
      const avg = sum / prices.length;
      const mid = Math.floor(prices.length / 2);
      const median = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
      const p25 = prices[Math.floor(prices.length * 0.25)];
      const p75 = prices[Math.floor(prices.length * 0.75)];

      setMarketData({
        avgPrice: avg,
        medianPrice: median,
        p25Price: p25,
        p75Price: p75,
        totalResults: data.total || items.length,
      });
    } catch (err: any) {
      toast.error(err.message || 'Veri alınamadı');
      setMarketData(null);
    } finally {
      setLoading(false);
    }
  }, [keyword, marketplace]);

  const sc = parseFloat(sourcingCost) || 0;
  const stb = parseFloat(shippingToBuyer) || 0;
  const sfs = parseFloat(shippingFromSupplier) || 0;
  const tm = parseFloat(targetMargin) || 0;
  const tmi = parseFloat(targetMonthlyIncome) || 0;

  const calcFeesForPrice = useCallback(
    (price: number) => {
      const f = calcTotalFees(price, 0, category, false, false, 0, true);
      return f.totalFees;
    },
    [category],
  );

  const breakEvenPrice = useMemo(() => {
    // breakeven: price - fees(price) - sc - stb - sfs = 0
    // Iterative approach since fees depend on price
    let lo = 0, hi = 10000;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const fees = calcFeesForPrice(mid);
      const profit = mid - fees - sc - stb - sfs;
      if (profit < 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }, [sc, stb, sfs, calcFeesForPrice]);

  const minSellingPrice = useMemo(() => {
    // price - fees(price) = (sc + stb + sfs) / (1 - tm/100)
    // Iterative
    const targetTotal = sc + stb + sfs;
    if (tm >= 100 || tm <= 0) return breakEvenPrice;
    let lo = 0, hi = 50000;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      const fees = calcFeesForPrice(mid);
      const profit = mid - fees - targetTotal;
      const margin = mid > 0 ? (profit / mid) * 100 : 0;
      if (margin < tm) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }, [sc, stb, sfs, tm, breakEvenPrice, calcFeesForPrice]);

  const scenarios: SourcingScenario[] = useMemo(() => {
    if (!marketData) return [];
    const prices = [
      { label: 'Muhafazakar (25. Yüzdelik)', price: marketData.p25Price },
      { label: 'Ortalama (Medyan)', price: marketData.medianPrice },
      { label: 'Agresif (75. Yüzdelik)', price: marketData.p75Price },
    ];
    return prices.map(({ label, price }) => {
      const fees = calcFeesForPrice(price);
      const totalCost = sc + stb + sfs + fees;
      const profit = price - totalCost;
      const margin = price > 0 ? (profit / price) * 100 : 0;
      const roi = sc > 0 ? (profit / sc) * 100 : 0;
      return { label, price, fees, profit, margin, roi };
    });
  }, [marketData, sc, stb, sfs, calcFeesForPrice]);

  const maxSourcingCost = useMemo(() => {
    if (!marketData) return 0;
    const price = marketData.medianPrice;
    const fees = calcFeesForPrice(price);
    return price - fees - stb - sfs;
  }, [marketData, stb, sfs, calcFeesForPrice]);

  const bulkAnalysis = useMemo(() => {
    if (!marketData) return [];
    const price = marketData.medianPrice;
    return VOLUME_TIERS.map((qty, tierIdx) => {
      const discount = tierIdx * VOLUME_DISCOUNT_PER_TIER;
      const discountedCost = sc * (1 - discount);
      const totalInvestment = discountedCost * qty + sfs * qty;
      const feesPerUnit = calcFeesForPrice(price);
      const revenuePerUnit = price;
      const profitPerUnit = revenuePerUnit - feesPerUnit - discountedCost - stb - sfs;
      const totalRevenue = revenuePerUnit * qty;
      const totalProfit = profitPerUnit * qty;
      const roiPct = totalInvestment > 0 ? (totalProfit / totalInvestment) * 100 : 0;
      return {
        qty,
        discount: discount * 100,
        unitCost: discountedCost,
        totalInvestment,
        totalRevenue,
        totalProfit,
        roi: roiPct,
      };
    });
  }, [marketData, sc, stb, sfs, calcFeesForPrice]);

  const unitsForTargetIncome = useMemo(() => {
    if (!marketData || !tmi) return 0;
    const price = marketData.medianPrice;
    const fees = calcFeesForPrice(price);
    const profitPerUnit = price - fees - sc - stb - sfs;
    if (profitPerUnit <= 0) return Infinity;
    return Math.ceil(tmi / profitPerUnit);
  }, [marketData, sc, stb, sfs, tmi, calcFeesForPrice]);

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Package size={20} /> Tedarik Hesaplayıcı
      </Typography>

      {/* Search */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 2 }}>Pazar Araştırması</Typography>
        <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
          <TextField
            label="Ürün Anahtar Kelimesi"
            size="small"
            fullWidth
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchMarketData()}
          />
          <Button
            variant="contained"
            onClick={fetchMarketData}
            disabled={loading || !keyword.trim()}
            sx={{ minWidth: 100 }}
          >
            {loading ? 'Arıyor...' : 'Ara'}
          </Button>
        </Box>

        {loading && <LinearProgress sx={{ mb: 2 }} />}

        {marketData && (
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            <Chip label={`Ort. Fiyat: ${fmt(marketData.avgPrice)}`} color="primary" variant="outlined" />
            <Chip label={`Medyan: ${fmt(marketData.medianPrice)}`} color="primary" />
            <Chip label={`25p: ${fmt(marketData.p25Price)}`} variant="outlined" />
            <Chip label={`75p: ${fmt(marketData.p75Price)}`} variant="outlined" />
            <Chip label={`Toplam: ${marketData.totalResults} sonuç`} variant="outlined" />
          </Box>
        )}
      </Paper>

      {/* Inputs */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 2 }}>Maliyet Girdileri</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel>Kategori</InputLabel>
            <Select
              value={categoryIdx}
              label="Kategori"
              onChange={(e) => setCategoryIdx(Number(e.target.value))}
            >
              {EBAY_CATEGORIES.map((cat, i) => (
                <MenuItem key={i} value={i}>{cat.label} ({pct(cat.rate)})</MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Tahmini Tedarik Maliyeti"
            size="small"
            type="number"
            value={sourcingCost}
            onChange={(e) => setSourcingCost(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />

          <TextField
            label="Kargo (Alıcıya)"
            size="small"
            type="number"
            value={shippingToBuyer}
            onChange={(e) => setShippingToBuyer(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />

          <TextField
            label="Kargo (Tedarikçiden Size)"
            size="small"
            type="number"
            value={shippingFromSupplier}
            onChange={(e) => setShippingFromSupplier(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />

          <TextField
            label="Hedef Kâr Marjı (%)"
            size="small"
            type="number"
            value={targetMargin}
            onChange={(e) => setTargetMargin(e.target.value)}
            InputProps={{ endAdornment: <InputAdornment position="end">%</InputAdornment> }}
          />

          <TextField
            label="Hedef Aylık Gelir"
            size="small"
            type="number"
            value={targetMonthlyIncome}
            onChange={(e) => setTargetMonthlyIncome(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
        </Box>
      </Paper>

      {/* Calculated Results */}
      {sc > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Hesaplama Sonuçları</Typography>
          <TableContainer>
            <Table size="small">
              <TableBody>
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Hedef Marj İçin Min. Satış Fiyatı</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(minSellingPrice)}</TableCell>
                </TableRow>
                {marketData && (
                  <TableRow>
                    <TableCell sx={{ fontWeight: 500 }}>Önerilen Satış Fiyatı (Medyan)</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>{fmt(marketData.medianPrice)}</TableCell>
                  </TableRow>
                )}
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>Başa Baş Fiyatı</TableCell>
                  <TableCell align="right">{fmt(breakEvenPrice)}</TableCell>
                </TableRow>
                {marketData && (
                  <>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 500 }}>Medyan Fiyatta Maks. Tedarik Maliyeti</TableCell>
                      <TableCell align="right" sx={{ color: maxSourcingCost > sc ? 'success.main' : 'error.main' }}>
                        {fmt(maxSourcingCost)}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 500 }}>
                        Hedef Aylık Gelir İçin Satılacak Adet
                      </TableCell>
                      <TableCell align="right" sx={{ fontWeight: 600 }}>
                        {unitsForTargetIncome === Infinity ? 'Kârsız' : `${unitsForTargetIncome} adet/ay`}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {marketData && minSellingPrice > marketData.p75Price && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              Hedef marjınız piyasa fiyatlarının üzerinde bir satış fiyatı gerektiriyor. Tedarik maliyetini düşürmeyi değerlendirin.
            </Alert>
          )}
        </Paper>
      )}

      {/* Scenario Comparison */}
      {scenarios.length > 0 && sc > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Target size={16} /> Senaryo Karşılaştırması
          </Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Senaryo</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Fiyat</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Ücretler</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Kâr</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Marj</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>ROI</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {scenarios.map((s) => (
                  <TableRow key={s.label}>
                    <TableCell sx={{ fontWeight: 500 }}>{s.label}</TableCell>
                    <TableCell align="right">{fmt(s.price)}</TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>-{fmt(s.fees)}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 600, color: s.profit >= 0 ? 'success.main' : 'error.main' }}
                    >
                      {fmt(s.profit)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: s.margin >= 0 ? 'success.main' : 'error.main' }}>
                      {pct(s.margin)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: s.roi >= 0 ? 'success.main' : 'error.main' }}>
                      {pct(s.roi)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Bulk Sourcing */}
      {bulkAnalysis.length > 0 && sc > 0 && (
        <Paper sx={{ p: 2 }}>
          <Typography variant="subtitle2" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
            <BarChart2 size={16} /> Toplu Tedarik Analizi
          </Typography>
          <Alert severity="info" sx={{ mb: 2 }}>
            Her kademe için %5 hacim indirimi uygulanır. Medyan piyasa fiyatı baz alınır.
          </Alert>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Adet</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>İndirim</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Birim Maliyet</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Toplam Yatırım</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Toplam Gelir</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Toplam Kâr</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>ROI</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bulkAnalysis.map((b) => (
                  <TableRow key={b.qty}>
                    <TableCell sx={{ fontWeight: 500 }}>{b.qty}</TableCell>
                    <TableCell align="right">{pct(b.discount)}</TableCell>
                    <TableCell align="right">{fmt(b.unitCost)}</TableCell>
                    <TableCell align="right">{fmt(b.totalInvestment)}</TableCell>
                    <TableCell align="right">{fmt(b.totalRevenue)}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 600, color: b.totalProfit >= 0 ? 'success.main' : 'error.main' }}
                    >
                      {fmt(b.totalProfit)}
                    </TableCell>
                    <TableCell align="right" sx={{ color: b.roi >= 0 ? 'success.main' : 'error.main' }}>
                      {pct(b.roi)}
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
// Sub-tab 3: ROI Tracker
// ---------------------------------------------------------------------------

function ROITracker() {
  const [entries, setEntries] = useState<ROIEntry[]>([]);
  const [productName, setProductName] = useState('');
  const [sellingPrice, setSellingPrice] = useState('');
  const [productCost, setProductCost] = useState('');
  const [shippingCost, setShippingCost] = useState('');
  const [otherCosts, setOtherCosts] = useState('');
  const [categoryIdx, setCategoryIdx] = useState(0);
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const category = EBAY_CATEGORIES[categoryIdx];

  // Load from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setEntries(JSON.parse(stored));
    } catch {
      // ignore
    }
  }, []);

  // Persist to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
    } catch {
      // ignore
    }
  }, [entries]);

  const handleAdd = useCallback(() => {
    const sp = parseFloat(sellingPrice) || 0;
    const pc = parseFloat(productCost) || 0;
    const sc = parseFloat(shippingCost) || 0;
    const oc = parseFloat(otherCosts) || 0;

    if (!productName.trim() || sp <= 0) {
      toast.error('Ürün adı ve satış fiyatı gereklidir');
      return;
    }

    const fees = calcTotalFees(sp, 0, category, false, false, 0, true);

    const entry: ROIEntry = {
      id: generateId(),
      productName: productName.trim(),
      sellingPrice: sp,
      productCost: pc,
      shippingCost: sc,
      ebayFees: fees.totalFees,
      otherCosts: oc,
      date: new Date().toISOString().split('T')[0],
    };

    setEntries((prev) => [entry, ...prev]);
    setProductName('');
    setSellingPrice('');
    setProductCost('');
    setShippingCost('');
    setOtherCosts('');
    toast.success('Kayıt eklendi');
  }, [productName, sellingPrice, productCost, shippingCost, otherCosts, category]);

  const handleDelete = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    toast.success('Kayıt silindi');
  }, []);

  const handleClearAll = useCallback(() => {
    if (window.confirm('Tüm kayıtları silmek istediğinize emin misiniz? Bu işlem geri alınamaz.')) {
      setEntries([]);
      toast.success('Tüm kayıtlar silindi');
    }
  }, []);

  const handleExportCSV = useCallback(() => {
    if (entries.length === 0) {
      toast.error('Dışa aktarılacak kayıt yok');
      return;
    }
    const headers = ['Ürün', 'Gelir', 'Maliyet', 'Kargo', 'Ücretler', 'Diğer', 'Kâr', 'Marj %', 'ROI %', 'Tarih'];
    const rows = entries.map((e) => {
      const totalCost = e.productCost + e.shippingCost + e.ebayFees + e.otherCosts;
      const profit = e.sellingPrice - totalCost;
      const margin = e.sellingPrice > 0 ? (profit / e.sellingPrice) * 100 : 0;
      const roi = e.productCost > 0 ? (profit / e.productCost) * 100 : 0;
      return [
        e.productName,
        e.sellingPrice.toFixed(2),
        e.productCost.toFixed(2),
        e.shippingCost.toFixed(2),
        e.ebayFees.toFixed(2),
        e.otherCosts.toFixed(2),
        profit.toFixed(2),
        margin.toFixed(1),
        roi.toFixed(1),
        e.date,
      ].join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `roi-tracker-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV indirildi');
  }, [entries]);

  // Computed summary
  const summary = useMemo(() => {
    if (entries.length === 0) return null;
    let totalRevenue = 0;
    let totalProductCost = 0;
    let totalShipping = 0;
    let totalFees = 0;
    let totalOther = 0;
    let bestProfit = -Infinity;
    let worstProfit = Infinity;
    let bestProduct = '';
    let worstProduct = '';

    entries.forEach((e) => {
      totalRevenue += e.sellingPrice;
      totalProductCost += e.productCost;
      totalShipping += e.shippingCost;
      totalFees += e.ebayFees;
      totalOther += e.otherCosts;

      const profit = e.sellingPrice - (e.productCost + e.shippingCost + e.ebayFees + e.otherCosts);
      if (profit > bestProfit) {
        bestProfit = profit;
        bestProduct = e.productName;
      }
      if (profit < worstProfit) {
        worstProfit = profit;
        worstProduct = e.productName;
      }
    });

    const totalCosts = totalProductCost + totalShipping + totalFees + totalOther;
    const totalProfit = totalRevenue - totalCosts;
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;
    const avgROI = totalProductCost > 0 ? (totalProfit / totalProductCost) * 100 : 0;

    return {
      totalRevenue,
      totalCosts,
      totalProfit,
      avgMargin,
      avgROI,
      bestProduct,
      bestProfit,
      worstProduct,
      worstProfit,
      count: entries.length,
    };
  }, [entries]);

  // Monthly summary
  const monthlySummary = useMemo(() => {
    if (entries.length < 3) return null;
    const byMonth: Record<string, { revenue: number; cost: number; profit: number; count: number }> = {};
    entries.forEach((e) => {
      const month = e.date.slice(0, 7); // YYYY-MM
      if (!byMonth[month]) byMonth[month] = { revenue: 0, cost: 0, profit: 0, count: 0 };
      const totalCost = e.productCost + e.shippingCost + e.ebayFees + e.otherCosts;
      byMonth[month].revenue += e.sellingPrice;
      byMonth[month].cost += totalCost;
      byMonth[month].profit += e.sellingPrice - totalCost;
      byMonth[month].count += 1;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, data]) => ({ month, ...data }));
  }, [entries]);

  // Sorting
  const sortedEntries = useMemo(() => {
    const arr = [...entries];
    arr.sort((a, b) => {
      let av: any, bv: any;
      switch (sortField) {
        case 'productName': av = a.productName; bv = b.productName; break;
        case 'sellingPrice': av = a.sellingPrice; bv = b.sellingPrice; break;
        case 'productCost': av = a.productCost; bv = b.productCost; break;
        case 'shippingCost': av = a.shippingCost; bv = b.shippingCost; break;
        case 'ebayFees': av = a.ebayFees; bv = b.ebayFees; break;
        case 'date': av = a.date; bv = b.date; break;
        case 'profit': {
          const pa = a.sellingPrice - (a.productCost + a.shippingCost + a.ebayFees + a.otherCosts);
          const pb = b.sellingPrice - (b.productCost + b.shippingCost + b.ebayFees + b.otherCosts);
          av = pa; bv = pb; break;
        }
        case 'margin': {
          const ma = a.sellingPrice > 0 ? (a.sellingPrice - (a.productCost + a.shippingCost + a.ebayFees + a.otherCosts)) / a.sellingPrice : 0;
          const mb = b.sellingPrice > 0 ? (b.sellingPrice - (b.productCost + b.shippingCost + b.ebayFees + b.otherCosts)) / b.sellingPrice : 0;
          av = ma; bv = mb; break;
        }
        case 'roi': {
          const ra = a.productCost > 0 ? (a.sellingPrice - (a.productCost + a.shippingCost + a.ebayFees + a.otherCosts)) / a.productCost : 0;
          const rb = b.productCost > 0 ? (b.sellingPrice - (b.productCost + b.shippingCost + b.ebayFees + b.otherCosts)) / b.productCost : 0;
          av = ra; bv = rb; break;
        }
        default: av = a.date; bv = b.date;
      }
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return sortDir === 'asc' ? av - bv : bv - av;
    });
    return arr;
  }, [entries, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <TableCell
      align={field === 'productName' ? 'left' : 'right'}
      sx={{ fontWeight: 700, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      onClick={() => toggleSort(field)}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {label}
        <ArrowUpDown size={12} style={{ opacity: sortField === field ? 1 : 0.3 }} />
      </Box>
    </TableCell>
  );

  return (
    <Box>
      <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
        <TrendingUp size={20} /> Yatırım Getiri Takipçisi
      </Typography>

      {/* Entry Form */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Typography variant="subtitle2" sx={{ mb: 2 }}>Yeni Kayıt Ekle</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2, mb: 2 }}>
          <TextField
            label="Ürün Adı"
            size="small"
            fullWidth
            value={productName}
            onChange={(e) => setProductName(e.target.value)}
          />
          <TextField
            label="Satış Fiyatı"
            size="small"
            type="number"
            value={sellingPrice}
            onChange={(e) => setSellingPrice(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField
            label="Ürün Maliyeti"
            size="small"
            type="number"
            value={productCost}
            onChange={(e) => setProductCost(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <TextField
            label="Kargo Maliyeti"
            size="small"
            type="number"
            value={shippingCost}
            onChange={(e) => setShippingCost(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
          <FormControl fullWidth size="small">
            <InputLabel>Kategori (Ücret Hesabı)</InputLabel>
            <Select
              value={categoryIdx}
              label="Kategori (Ücret Hesabı)"
              onChange={(e) => setCategoryIdx(Number(e.target.value))}
            >
              {EBAY_CATEGORIES.map((cat, i) => (
                <MenuItem key={i} value={i}>{cat.label} ({pct(cat.rate)})</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            label="Diğer Maliyetler"
            size="small"
            type="number"
            value={otherCosts}
            onChange={(e) => setOtherCosts(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
          />
        </Box>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={handleAdd}
        >
          Kayıt Ekle
        </Button>
      </Paper>

      {/* Summary Dashboard */}
      {summary && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Özet Gösterge Paneli</Typography>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr 1fr', sm: '1fr 1fr 1fr', md: 'repeat(5, 1fr)' },
              gap: 2,
              mb: 2,
            }}
          >
            <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Toplam Gelir</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700 }}>{fmt(summary.totalRevenue)}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Toplam Maliyet</Typography>
              <Typography variant="h6" sx={{ fontWeight: 700, color: 'error.main' }}>{fmt(summary.totalCosts)}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Toplam Kâr</Typography>
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, color: summary.totalProfit >= 0 ? 'success.main' : 'error.main' }}
              >
                {fmt(summary.totalProfit)}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Ort. Marj</Typography>
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, color: summary.avgMargin >= 0 ? 'success.main' : 'error.main' }}
              >
                {pct(summary.avgMargin)}
              </Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">Ort. ROI</Typography>
              <Typography
                variant="h6"
                sx={{ fontWeight: 700, color: summary.avgROI >= 0 ? 'success.main' : 'error.main' }}
              >
                {pct(summary.avgROI)}
              </Typography>
            </Paper>
          </Box>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
            <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 200 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <TrendingUp size={14} color="green" />
                <Typography variant="caption" color="text.secondary">En İyi Ürün</Typography>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{summary.bestProduct}</Typography>
              <Typography variant="body2" sx={{ color: 'success.main' }}>Kâr: {fmt(summary.bestProfit)}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 200 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                <TrendingDown size={14} color="red" />
                <Typography variant="caption" color="text.secondary">En Kötü Ürün</Typography>
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>{summary.worstProduct}</Typography>
              <Typography
                variant="body2"
                sx={{ color: summary.worstProfit >= 0 ? 'success.main' : 'error.main' }}
              >
                Kâr: {fmt(summary.worstProfit)}
              </Typography>
            </Paper>
          </Box>
        </Paper>
      )}

      {/* Monthly Summary */}
      {monthlySummary && monthlySummary.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 2 }}>Aylık Özet</Typography>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Ay</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Satış</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Gelir</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Maliyet</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 700 }}>Kâr</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {monthlySummary.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell sx={{ fontWeight: 500 }}>{m.month}</TableCell>
                    <TableCell align="right">{m.count}</TableCell>
                    <TableCell align="right">{fmt(m.revenue)}</TableCell>
                    <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(m.cost)}</TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 600, color: m.profit >= 0 ? 'success.main' : 'error.main' }}
                    >
                      {fmt(m.profit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Entries Table */}
      {entries.length > 0 && (
        <Paper sx={{ p: 2, mb: 3 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="subtitle2">
              Tüm Kayıtlar ({entries.length})
            </Typography>
            <Box sx={{ display: 'flex', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Download size={14} />}
                onClick={handleExportCSV}
              >
                CSV İndir
              </Button>
              <Button
                size="small"
                variant="outlined"
                color="error"
                startIcon={<Trash2 size={14} />}
                onClick={handleClearAll}
              >
                Tümünü Sil
              </Button>
            </Box>
          </Box>

          <TableContainer sx={{ maxHeight: 500 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  <SortHeader field="productName" label="Ürün" />
                  <SortHeader field="sellingPrice" label="Gelir" />
                  <SortHeader field="productCost" label="Maliyet" />
                  <SortHeader field="ebayFees" label="Ücretler" />
                  <SortHeader field="profit" label="Kâr" />
                  <SortHeader field="margin" label="Marj" />
                  <SortHeader field="roi" label="ROI" />
                  <SortHeader field="date" label="Tarih" />
                  <TableCell align="center" sx={{ fontWeight: 700 }}>Sil</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedEntries.map((e) => {
                  const totalCost = e.productCost + e.shippingCost + e.ebayFees + e.otherCosts;
                  const profit = e.sellingPrice - totalCost;
                  const margin = e.sellingPrice > 0 ? (profit / e.sellingPrice) * 100 : 0;
                  const roi = e.productCost > 0 ? (profit / e.productCost) * 100 : 0;
                  return (
                    <TableRow key={e.id} hover>
                      <TableCell sx={{ fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.productName}
                      </TableCell>
                      <TableCell align="right">{fmt(e.sellingPrice)}</TableCell>
                      <TableCell align="right">{fmt(e.productCost)}</TableCell>
                      <TableCell align="right" sx={{ color: 'error.main' }}>{fmt(e.ebayFees)}</TableCell>
                      <TableCell
                        align="right"
                        sx={{ fontWeight: 600, color: profit >= 0 ? 'success.main' : 'error.main' }}
                      >
                        {fmt(profit)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: margin >= 0 ? 'success.main' : 'error.main' }}>
                        {pct(margin)}
                      </TableCell>
                      <TableCell align="right" sx={{ color: roi >= 0 ? 'success.main' : 'error.main' }}>
                        {pct(roi)}
                      </TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>{e.date}</TableCell>
                      <TableCell align="center">
                        <IconButton size="small" color="error" onClick={() => handleDelete(e.id)}>
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

      {entries.length === 0 && (
        <Alert severity="info">
          Henüz kayıt eklenmedi. Yukarıdaki formu kullanarak satış kayıtlarınızı ekleyin.
        </Alert>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function FinancialIntelligence({ userId, marketplace }: FinancialIntelligenceProps) {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
        <DollarSign size={22} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Finansal Zekâ
        </Typography>
      </Box>

      <Paper sx={{ mb: 2 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="scrollable"
          scrollButtons="auto"
        >
          <Tab
            label="Gelir Hesaplayıcı"
            icon={<Calculator size={16} />}
            iconPosition="start"
            sx={{ textTransform: 'none', minHeight: 48 }}
          />
          <Tab
            label="Tedarik Hesaplayıcı"
            icon={<Package size={16} />}
            iconPosition="start"
            sx={{ textTransform: 'none', minHeight: 48 }}
          />
          <Tab
            label="Yatırım Getiri Takipçisi"
            icon={<TrendingUp size={16} />}
            iconPosition="start"
            sx={{ textTransform: 'none', minHeight: 48 }}
          />
        </Tabs>
      </Paper>

      <TabPanel value={activeTab} index={0}>
        <RevenueCalculator />
      </TabPanel>
      <TabPanel value={activeTab} index={1}>
        <SourcingCalculator marketplace={marketplace} />
      </TabPanel>
      <TabPanel value={activeTab} index={2}>
        <ROITracker />
      </TabPanel>
    </Box>
  );
}
