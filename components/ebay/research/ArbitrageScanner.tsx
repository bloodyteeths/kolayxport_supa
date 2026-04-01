import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Box, Typography, Button, Paper, Chip, Tabs, Tab,
  LinearProgress, Alert, Switch, FormControlLabel, TextField,
  InputAdornment, Collapse, Tooltip, useMediaQuery, useTheme,
  IconButton, Badge, Dialog, DialogTitle, DialogContent, DialogActions,
} from '@mui/material';
import {
  Search, ChevronDown, ChevronUp,
  SlidersHorizontal, Save, Zap,
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import type { ArbitrageScanResponse } from '../../../lib/arbitrage/types';
import { TRENDYOL_CATEGORIES } from '../../../lib/integrations/trendyolSearch';
import { useArbitrageStore } from './arbitrage/useArbitrageStore';
import { SCAN_PRESETS, CATEGORY_GROUPS } from './arbitrage/arbitrageConstants';
import ArbitrageDashboard from './arbitrage/ArbitrageDashboard';
import ArbitrageResultsTable from './arbitrage/ArbitrageResultsTable';
import ArbitrageCharts from './arbitrage/ArbitrageCharts';
import ArbitrageProductDetail from './arbitrage/ArbitrageProductDetail';
import ArbitrageCategoryBrowser from './arbitrage/ArbitrageCategoryBrowser';
import ArbitrageSavedScans from './arbitrage/ArbitrageSavedScans';

interface ArbitrageScannerProps {
  userId: string;
}

export default function ArbitrageScanner({ userId }: ArbitrageScannerProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const store = useArbitrageStore();
  const {
    selectedCategories, shippingCost, minProfit, minRoi, maxResults,
    includeInternational, highDefectRate, feeOverride, exchangeRateOverride,
    scanResponse, loading, scanProgress, jobId, activeTab, selectedProductIdx,
    setSelectedCategories, setScanResponse, setLoading, setScanProgress,
    setJobId, setActiveTab, setSelectedProductIdx, getFilteredResults,
    saveScan,
  } = store;

  const [showSettings, setShowSettings] = useState(false);
  const [showCategoryBrowser, setShowCategoryBrowser] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveLabel, setSaveLabel] = useState('');
  const [exchangeRate, setExchangeRate] = useState<number | null>(null);

  // Fetch exchange rate on mount
  useEffect(() => {
    fetch('/api/clawd/arbitrage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'exchange_rate' }),
    })
      .then(r => r.json())
      .then(data => setExchangeRate(data.rate))
      .catch(() => {});
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const buildParams = useCallback(() => {
    const params: any = {
      shippingCostUsd: shippingCost,
      minProfitUsd: minProfit,
      minRoiPercent: minRoi,
      maxTrendyolResults: maxResults,
      includeInternationalFee: includeInternational,
      highDefectRate,
    };
    if (feeOverride) params.feeOverridePercent = parseFloat(feeOverride);
    if (exchangeRateOverride) params.exchangeRate = parseFloat(exchangeRateOverride);
    return params;
  }, [shippingCost, minProfit, minRoi, maxResults, includeInternational, highDefectRate, feeOverride, exchangeRateOverride]);

  const runQuickScan = useCallback(async (categories: string[]) => {
    if (categories.length === 0) {
      toast.error('En az bir kategori seçin');
      return;
    }

    setLoading(true);
    setScanProgress({ current: 0, total: categories.length, phase: 'Trendyol ürünleri yükleniyor...' });
    setScanResponse(null);

    try {
      const res = await fetch('/api/clawd/arbitrage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'scan',
          categories,
          ...buildParams(),
        }),
      });

      const data: ArbitrageScanResponse = await res.json();

      if (!res.ok) throw new Error((data as any).error || 'Tarama başarısız');

      setScanResponse(data);
      setScanProgress(null);

      const profitCount = data.profitable;
      if (profitCount > 0) {
        toast.success(`${data.results.length} ürün tarandı, ${profitCount} kârlı fırsat bulundu!`);
      } else {
        toast(`${data.results.length} ürün tarandı, kârlı fırsat bulunamadı`, { icon: '📊' });
      }
    } catch (err: any) {
      toast.error(err.message || 'Tarama hatası');
    } finally {
      setLoading(false);
      setScanProgress(null);
    }
  }, [buildParams, setLoading, setScanProgress, setScanResponse]);

  const startBackgroundScan = useCallback(async (categories: string[]) => {
    if (categories.length === 0) {
      toast.error('En az bir kategori seçin');
      return;
    }

    setLoading(true);
    setScanProgress({ current: 0, total: categories.length, phase: 'Tarama başlatılıyor...' });
    setScanResponse(null);

    try {
      // Start the background job
      const res = await fetch('/api/clawd/arbitrage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'start_scan',
          categories,
          ...buildParams(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tarama başlatılamadı');

      setJobId(data.jobId);

      // Poll for status
      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/clawd/arbitrage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'job_status', jobId: data.jobId }),
          });
          const status = await statusRes.json();

          setScanProgress({
            current: status.progress,
            total: status.totalProducts,
            phase: status.status === 'processing'
              ? `${status.progress}/${status.totalProducts} kategori taranıyor...`
              : 'Tamamlanıyor...',
          });

          if (status.results && status.results.length > 0) {
            setScanResponse({
              results: status.results,
              exchangeRate: status.exchangeRate || 0.028,
              totalScanned: status.totalProducts,
              profitable: status.results.filter((r: any) => r.financials.profitUsd >= minProfit).length,
              scanDurationMs: status.scanDurationMs || 0,
            });
          }

          if (status.status === 'completed' || status.status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            setLoading(false);
            setScanProgress(null);
            setJobId(null);

            if (status.status === 'completed') {
              toast.success(`Tarama tamamlandı! ${status.resultsCount} sonuç bulundu`);
            } else {
              toast.error(status.error || 'Tarama başarısız');
            }
          }
        } catch {
          // Polling error — will retry next interval
        }
      }, 4000);
    } catch (err: any) {
      toast.error(err.message || 'Tarama hatası');
      setLoading(false);
      setScanProgress(null);
    }
  }, [buildParams, minProfit, setLoading, setScanProgress, setScanResponse, setJobId]);

  const handleScan = useCallback((categories: string[]) => {
    setSelectedCategories(categories);
    // Use background scan for 6+ categories, quick scan for fewer
    if (categories.length > 5) {
      startBackgroundScan(categories);
    } else {
      runQuickScan(categories);
    }
  }, [setSelectedCategories, runQuickScan, startBackgroundScan]);

  const handleSaveScan = () => {
    if (saveLabel.trim()) {
      saveScan(saveLabel.trim());
      setSaveDialogOpen(false);
      setSaveLabel('');
      toast.success('Tarama kaydedildi');
    }
  };

  const filteredResults = getFilteredResults();
  const selectedResult = selectedProductIdx !== null ? filteredResults[selectedProductIdx] : null;

  return (
    <Box>
      {/* Header */}
      <Paper sx={{
        p: 2, mb: 2,
        background: 'linear-gradient(135deg, #1a237e 0%, #0d47a1 100%)',
        color: '#fff',
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, fontSize: isMobile ? '1rem' : '1.2rem' }}>
              Trendyol → eBay Arbitraj Pro
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              {TRENDYOL_CATEGORIES.length} kategori | {exchangeRate ? `1 TRY = $${exchangeRate.toFixed(4)}` : 'Kur yükleniyor...'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Tooltip title="Ayarlar">
              <IconButton size="small" sx={{ color: '#fff' }} onClick={() => setShowSettings(!showSettings)}>
                <SlidersHorizontal size={18} />
              </IconButton>
            </Tooltip>
            {scanResponse && (
              <Tooltip title="Taramayı Kaydet">
                <IconButton size="small" sx={{ color: '#fff' }} onClick={() => setSaveDialogOpen(true)}>
                  <Save size={18} />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        </Box>
      </Paper>

      {/* Settings */}
      <Collapse in={showSettings}>
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr', gap: 2 }}>
            <TextField
              size="small" label="Kargo Maliyeti ($)"
              type="number" value={shippingCost}
              onChange={(e) => store.setShippingCost(Number(e.target.value))}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
            <TextField
              size="small" label="Min. Kâr ($)"
              type="number" value={minProfit}
              onChange={(e) => store.setMinProfit(Number(e.target.value))}
              InputProps={{ startAdornment: <InputAdornment position="start">$</InputAdornment> }}
            />
            <TextField
              size="small" label="Min. ROI (%)"
              type="number" value={minRoi}
              onChange={(e) => store.setMinRoi(Number(e.target.value))}
              InputProps={{ startAdornment: <InputAdornment position="start">%</InputAdornment> }}
            />
            <TextField
              size="small" label="Komisyon Override (%)"
              value={feeOverride}
              onChange={(e) => store.setFeeOverride(e.target.value)}
              placeholder="Otomatik"
            />
            <TextField
              size="small" label="Kur Override"
              value={exchangeRateOverride}
              onChange={(e) => store.setExchangeRateOverride(e.target.value)}
              placeholder="Otomatik"
            />
            <TextField
              size="small" label="Max Sonuç"
              type="number" value={maxResults}
              onChange={(e) => store.setMaxResults(Number(e.target.value))}
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <FormControlLabel
              control={<Switch size="small" checked={includeInternational} onChange={(e) => store.setIncludeInternational(e.target.checked)} />}
              label={<Typography variant="caption">Uluslararası Ücret (1.65%)</Typography>}
            />
            <FormControlLabel
              control={<Switch size="small" checked={highDefectRate} onChange={(e) => store.setHighDefectRate(e.target.checked)} />}
              label={<Typography variant="caption">Yüksek Defect (+5%)</Typography>}
            />
          </Box>
        </Paper>
      </Collapse>

      {/* Quick presets + Category browser button */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
        {SCAN_PRESETS.map(preset => (
          <Tooltip key={preset.label} title={preset.description}>
            <Button
              size="small"
              variant="outlined"
              onClick={() => handleScan(preset.slugs as unknown as string[])}
              disabled={loading}
              sx={{ fontSize: '0.75rem', textTransform: 'none' }}
              startIcon={<Zap size={14} />}
            >
              {preset.label}
            </Button>
          </Tooltip>
        ))}

        <Button
          size="small"
          variant="contained"
          onClick={() => setShowCategoryBrowser(true)}
          disabled={loading}
          sx={{ fontSize: '0.75rem', textTransform: 'none', ml: 'auto' }}
          startIcon={<Search size={14} />}
        >
          <Badge badgeContent={selectedCategories.length} color="error" sx={{ '& .MuiBadge-badge': { top: -4, right: -4 } }}>
            Kategori Seç
          </Badge>
        </Button>

        <Tooltip title="Tüm kategorileri tara (arka planda)">
          <Button
            size="small"
            variant="contained"
            color="warning"
            onClick={() => handleScan(TRENDYOL_CATEGORIES.map(c => c.slug))}
            disabled={loading}
            sx={{ fontSize: '0.75rem', textTransform: 'none', fontWeight: 700 }}
          >
            Hepsini Tara ({TRENDYOL_CATEGORIES.length})
          </Button>
        </Tooltip>
      </Box>

      {/* Loading */}
      {loading && scanProgress && (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
          <Typography variant="body2" sx={{ mb: 1 }}>
            {scanProgress.phase}
          </Typography>
          <LinearProgress
            variant={scanProgress.total > 0 ? 'determinate' : 'indeterminate'}
            value={scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0}
            sx={{ height: 8, borderRadius: 4 }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {scanProgress.current} / {scanProgress.total}
            {scanResponse ? ` | ${scanResponse.results.length} sonuç bulundu` : ''}
          </Typography>
        </Paper>
      )}

      {/* Results */}
      {scanResponse && (
        <>
          <ArbitrageDashboard response={scanResponse} />

          {/* Tabs */}
          <Tabs
            value={activeTab}
            onChange={(_, v) => setActiveTab(v)}
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            <Tab label={`Sonuçlar (${filteredResults.length})`} sx={{ textTransform: 'none', fontSize: '0.85rem' }} />
            <Tab label="Grafikler" sx={{ textTransform: 'none', fontSize: '0.85rem' }} />
            <Tab label="Geçmiş" sx={{ textTransform: 'none', fontSize: '0.85rem' }} />
          </Tabs>

          {activeTab === 0 && (
            <ArbitrageResultsTable
              results={filteredResults}
              onViewDetail={(idx) => setSelectedProductIdx(idx)}
            />
          )}

          {activeTab === 1 && (
            <ArbitrageCharts
              results={scanResponse.results}
              exchangeRate={scanResponse.exchangeRate}
            />
          )}

          {activeTab === 2 && (
            <ArbitrageSavedScans />
          )}
        </>
      )}

      {/* No results message */}
      {!scanResponse && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center' }} variant="outlined">
          <Typography variant="h6" sx={{ mb: 1, opacity: 0.6 }}>
            Trendyol → eBay Arbitraj Tarayıcı
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Yukarıdaki preset butonlarından birini tıklayın veya "Kategori Seç" ile özel tarama yapın.
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {TRENDYOL_CATEGORIES.length} Trendyol kategorisi hazır | Tiered matching: GTIN → AI → Fallback
          </Typography>
        </Paper>
      )}

      {/* Category Browser Dialog */}
      <ArbitrageCategoryBrowser
        open={showCategoryBrowser}
        onClose={() => setShowCategoryBrowser(false)}
        onScan={handleScan}
      />

      {/* Product Detail Drawer */}
      <ArbitrageProductDetail
        result={selectedResult}
        open={selectedProductIdx !== null}
        onClose={() => setSelectedProductIdx(null)}
      />

      {/* Save Dialog */}
      <Dialog open={saveDialogOpen} onClose={() => setSaveDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: '1rem' }}>Taramayı Kaydet</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Tarama adı"
            value={saveLabel}
            onChange={(e) => setSaveLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSaveScan()}
            sx={{ mt: 1 }}
            placeholder="örn. Ev dekor taraması"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSaveDialogOpen(false)}>İptal</Button>
          <Button variant="contained" onClick={handleSaveScan} disabled={!saveLabel.trim()}>Kaydet</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
