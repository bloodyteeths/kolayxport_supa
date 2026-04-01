import React, { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  Box,
  Typography,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Chip,
  Divider,
  Alert,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  InputAdornment,
  LinearProgress,
  CircularProgress,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  TrendingDown as TrendingDownIcon,
  TrendingUp as TrendingUpIcon,
  Search as SearchIcon,
  PlayArrow as PlayArrowIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PricingRule {
  id: string;
  name: string;
  condition: 'price_too_high' | 'price_too_low' | 'match_competitor';
  threshold_percent: number;
  adjustment_percent: number;
  adjustment_type: 'decrease' | 'increase';
  price_floor?: number;
  price_ceiling?: number;
  enabled: boolean;
}

interface MarketData {
  sku: string;
  title: string;
  currentPrice: number;
  avgMarketPrice: number;
  lowestPrice: number;
  highestPrice: number;
  competitorCount: number;
}

interface SimResult {
  sku: string;
  title: string;
  oldPrice: string;
  newPrice: string;
  rule: string;
  diff: string;
}

interface SmartPricingProps {
  listings: any[];
  userId: string;
  onPriceUpdate: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONDITION_KEYS: Record<PricingRule['condition'], string> = {
  price_too_high: 'conditionPriceTooHigh',
  price_too_low: 'conditionPriceTooLow',
  match_competitor: 'conditionMatchCompetitor',
};

const CONDITION_DESC_KEYS: Record<PricingRule['condition'], string> = {
  price_too_high: 'conditionDescPriceTooHigh',
  price_too_low: 'conditionDescPriceTooLow',
  match_competitor: 'conditionDescMatchCompetitor',
};

const LS_RULES_KEY = 'ebay_pricing_rules';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SmartPricing({ listings, userId, onPriceUpdate }: SmartPricingProps) {
  const t = useTranslations('ebay.smartPricing');

  // --- Pricing rules state ---
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [simResults, setSimResults] = useState<SimResult[] | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState(0);

  // --- Market data state ---
  const [marketData, setMarketData] = useState<MarketData[]>([]);
  const [loadingMarket, setLoadingMarket] = useState(false);

  // --- Load from localStorage ---
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_RULES_KEY);
      if (raw) setRules(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // --- Persist helpers ---
  const saveRules = useCallback((next: PricingRule[]) => {
    setRules(next);
    localStorage.setItem(LS_RULES_KEY, JSON.stringify(next));
  }, []);

  // --- Rule CRUD ---
  const handleOpenAddRule = () => {
    setEditingRule({
      id: generateId(),
      name: '',
      condition: 'price_too_high',
      threshold_percent: 10,
      adjustment_percent: 5,
      adjustment_type: 'decrease',
      enabled: true,
    });
    setRuleDialogOpen(true);
  };

  const handleOpenEditRule = (rule: PricingRule) => {
    setEditingRule({ ...rule });
    setRuleDialogOpen(true);
  };

  const handleSaveRule = () => {
    if (!editingRule) return;
    const exists = rules.find((r) => r.id === editingRule.id);
    const next = exists
      ? rules.map((r) => (r.id === editingRule.id ? editingRule : r))
      : [...rules, editingRule];
    saveRules(next);
    setRuleDialogOpen(false);
    setEditingRule(null);
  };

  const handleDeleteRule = (id: string) => {
    saveRules(rules.filter((r) => r.id !== id));
  };

  const handleToggleRule = (id: string) => {
    saveRules(rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  // --- Fetch market data ---
  const fetchMarketData = async () => {
    if (listings.length === 0) {
      toast.error(t('noListingsToResearch'));
      return;
    }

    setLoadingMarket(true);
    const results: MarketData[] = [];

    for (const listing of listings.slice(0, 20)) {
      try {
        const query = encodeURIComponent(
          listing.title ? listing.title.substring(0, 60) : listing.sku,
        );
        const res = await fetch(
          `/api/clawd/ebay?action=search_market&user_id=${userId}&q=${query}&limit=5`,
        );
        if (res.ok) {
          const data = await res.json();
          const items = data.items || data.itemSummaries || [];
          if (items.length > 0) {
            const prices = items
              .map((item: any) => {
                const p = item.price?.value || item.currentBidPrice?.value;
                return p ? parseFloat(p) : null;
              })
              .filter((p: number | null) => p != null) as number[];

            if (prices.length > 0) {
              results.push({
                sku: listing.sku,
                title: listing.title || listing.sku,
                currentPrice: listing.price || 0,
                avgMarketPrice: prices.reduce((a: number, b: number) => a + b, 0) / prices.length,
                lowestPrice: Math.min(...prices),
                highestPrice: Math.max(...prices),
                competitorCount: prices.length,
              });
            }
          }
        }
      } catch {
        // skip failed lookups
      }

      // Rate limit
      await new Promise((r) => setTimeout(r, 300));
    }

    setMarketData(results);
    setLoadingMarket(false);

    if (results.length === 0) {
      toast.error(t('noMarketDataFound'));
    } else {
      toast.success(t('marketDataLoaded', { count: results.length }));
    }
  };

  // --- Simulation ---
  const handleSimulate = () => {
    const enabledRules = rules.filter((r) => r.enabled);
    if (enabledRules.length === 0) {
      toast.error(t('noActiveRules'));
      setSimResults([]);
      return;
    }

    if (marketData.length === 0 && listings.length === 0) {
      toast.error(t('simulationNeedsData'));
      setSimResults([]);
      return;
    }

    setSimulating(true);
    const results: SimResult[] = [];

    // Use market data if available, otherwise use listing data
    const dataSource = marketData.length > 0 ? marketData : listings;

    for (const item of dataSource) {
      const currentPrice =
        'currentPrice' in item ? item.currentPrice : (item as any).price || 0;
      if (!currentPrice || currentPrice <= 0) continue;

      const sku = 'sku' in item ? item.sku : (item as any).sku || '';
      const title = 'title' in item ? item.title : (item as any).title || sku;
      const avgMarket = 'avgMarketPrice' in item ? item.avgMarketPrice : currentPrice;
      const lowestMarket = 'lowestPrice' in item ? item.lowestPrice : currentPrice;

      for (const rule of enabledRules) {
        let shouldApply = false;
        let newPrice = currentPrice;

        if (rule.condition === 'price_too_high') {
          const thresholdPrice = avgMarket * (1 + rule.threshold_percent / 100);
          if (currentPrice > thresholdPrice) {
            shouldApply = true;
            newPrice = currentPrice * (1 - rule.adjustment_percent / 100);
          }
        } else if (rule.condition === 'price_too_low') {
          const thresholdPrice = avgMarket * (1 - rule.threshold_percent / 100);
          if (currentPrice < thresholdPrice) {
            shouldApply = true;
            newPrice = currentPrice * (1 + rule.adjustment_percent / 100);
          }
        } else if (rule.condition === 'match_competitor') {
          if (currentPrice > lowestMarket * (1 + rule.threshold_percent / 100)) {
            shouldApply = true;
            // Set to lowest + small margin
            newPrice = lowestMarket * (1 + rule.adjustment_percent / 100);
          }
        }

        if (!shouldApply) continue;

        // Apply floor/ceiling
        if (rule.price_floor != null && newPrice < rule.price_floor) newPrice = rule.price_floor;
        if (rule.price_ceiling != null && newPrice > rule.price_ceiling)
          newPrice = rule.price_ceiling;

        if (Math.abs(newPrice - currentPrice) < 0.01) continue;

        const diff = newPrice - currentPrice;
        const diffPercent = ((diff / currentPrice) * 100).toFixed(1);

        results.push({
          sku,
          title: title.length > 50 ? title.slice(0, 50) + '...' : title,
          oldPrice: `$${currentPrice.toFixed(2)}`,
          newPrice: `$${newPrice.toFixed(2)}`,
          rule: rule.name || t(CONDITION_KEYS[rule.condition]),
          diff: `${diff > 0 ? '+' : ''}$${diff.toFixed(2)} (${diff > 0 ? '+' : ''}${diffPercent}%)`,
        });

        break; // Only apply first matching rule per listing
      }
    }

    setSimResults(results);
    setSimulating(false);
  };

  // --- Apply simulation results ---
  const handleApplyChanges = async () => {
    if (!simResults || simResults.length === 0) return;

    setApplying(true);
    setApplyProgress(0);
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < simResults.length; i++) {
      const result = simResults[i];
      const listing = listings.find((l: any) => l.sku === result.sku);
      if (!listing) {
        failed++;
        continue;
      }

      try {
        const newPriceNum = parseFloat(result.newPrice.replace('$', ''));
        const res = await fetch(
          `/api/clawd/ebay?action=update_offer&user_id=${userId}&offer_id=${listing.offerId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ price: newPriceNum }),
          },
        );

        if (res.ok) succeeded++;
        else failed++;
      } catch {
        failed++;
      }

      setApplyProgress(((i + 1) / simResults.length) * 100);
      // Rate limit
      await new Promise((r) => setTimeout(r, 200));
    }

    setApplying(false);
    setApplyProgress(0);

    if (failed === 0) {
      toast.success(t('priceUpdateSuccess', { count: succeeded }));
    } else {
      toast.error(t('priceUpdatePartial', { success: succeeded, failed }));
    }

    setSimResults(null);
    onPriceUpdate();
  };

  // --- Render ---
  return (
    <Box>
      {/* ============================================================= */}
      {/* MARKET RESEARCH SECTION                                       */}
      {/* ============================================================= */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <SearchIcon color="primary" fontSize="small" />
        <Typography variant="subtitle1" fontWeight={600}>
          {t('marketResearch')}
        </Typography>
        {marketData.length > 0 && (
          <Chip label={t('productsLabel', { count: marketData.length })} size="small" color="info" />
        )}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('marketResearchDesc')}
      </Typography>

      <Button
        variant="outlined"
        size="small"
        startIcon={loadingMarket ? <CircularProgress size={16} /> : <SearchIcon />}
        onClick={fetchMarketData}
        disabled={loadingMarket || listings.length === 0}
        sx={{ mb: 2 }}
      >
        {loadingMarket ? t('researching') : t('fetchMarketData')}
      </Button>

      {/* Market data results */}
      {marketData.length > 0 && (
        <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 200, mb: 3 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                <TableCell>{t('productCol')}</TableCell>
                <TableCell align="right">{t('yourPriceCol')}</TableCell>
                <TableCell align="right">{t('marketAvgCol')}</TableCell>
                <TableCell align="right">{t('lowestCol')}</TableCell>
                <TableCell align="right">{t('highestCol')}</TableCell>
                <TableCell align="right">{t('competitorCol')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {marketData.map((m) => {
                const priceDiff = m.currentPrice - m.avgMarketPrice;
                const isHigh = priceDiff > 0;
                return (
                  <TableRow key={m.sku}>
                    <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.title}
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600 }}>
                      ${m.currentPrice.toFixed(2)}
                    </TableCell>
                    <TableCell align="right">${m.avgMarketPrice.toFixed(2)}</TableCell>
                    <TableCell align="right">${m.lowestPrice.toFixed(2)}</TableCell>
                    <TableCell align="right">${m.highestPrice.toFixed(2)}</TableCell>
                    <TableCell align="right">
                      <Chip
                        label={`${m.competitorCount}`}
                        size="small"
                        variant="outlined"
                        sx={{ fontSize: '0.65rem', height: 20 }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Divider sx={{ my: 2 }} />

      {/* ============================================================= */}
      {/* PRICING RULES SECTION                                         */}
      {/* ============================================================= */}
      <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
        {t('pricingRules')}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t('pricingRulesDesc')}
      </Typography>

      {rules.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('noRulesYet')}
        </Alert>
      )}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 2 }}>
        {rules.map((rule) => (
          <Card key={rule.id} variant="outlined" sx={{ opacity: rule.enabled ? 1 : 0.5 }}>
            <CardContent sx={{ pb: '8px !important' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 120 }}>
                  {rule.name || t('unnamedRule')}
                </Typography>
                <Chip
                  size="small"
                  label={t(CONDITION_KEYS[rule.condition])}
                  color={
                    rule.condition === 'price_too_high'
                      ? 'warning'
                      : rule.condition === 'price_too_low'
                        ? 'success'
                        : 'info'
                  }
                />
                <Chip
                  size="small"
                  icon={rule.adjustment_type === 'decrease' ? <TrendingDownIcon /> : <TrendingUpIcon />}
                  label={`${rule.adjustment_type === 'decrease' ? '-' : '+'}${rule.adjustment_percent}%`}
                  variant="outlined"
                />
                <Typography variant="caption" color="text.secondary">
                  {t('thresholdLabel', { percent: rule.threshold_percent })}
                </Typography>
                {rule.price_floor != null && (
                  <Typography variant="caption" color="text.secondary">
                    {t('floorLabel', { value: rule.price_floor })}
                  </Typography>
                )}
                {rule.price_ceiling != null && (
                  <Typography variant="caption" color="text.secondary">
                    {t('ceilingLabel', { value: rule.price_ceiling })}
                  </Typography>
                )}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                {t(CONDITION_DESC_KEYS[rule.condition])}
              </Typography>
            </CardContent>
            <CardActions sx={{ pt: 0 }}>
              <Switch size="small" checked={rule.enabled} onChange={() => handleToggleRule(rule.id)} />
              <Box sx={{ flex: 1 }} />
              <IconButton size="small" onClick={() => handleOpenEditRule(rule)}>
                <EditIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => handleDeleteRule(rule.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </CardActions>
          </Card>
        ))}
      </Box>

      <Box sx={{ display: 'flex', gap: 1, mb: 3, flexWrap: 'wrap' }}>
        <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={handleOpenAddRule}>
          {t('addPricingRule')}
        </Button>
        <Button
          variant="contained"
          size="small"
          onClick={handleSimulate}
          disabled={rules.filter((r) => r.enabled).length === 0 || simulating}
          startIcon={simulating ? <CircularProgress size={16} /> : <PlayArrowIcon />}
        >
          {t('simulate')}
        </Button>
      </Box>

      {/* Simulation results */}
      {simResults !== null && (
        <Box sx={{ mb: 3 }}>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>
            {t('simulationResults')}
          </Typography>
          {simResults.length === 0 ? (
            <Alert severity="info">
              {t('noMatchAlert')}
            </Alert>
          ) : (
            <>
              <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300, mb: 2 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('productCol')}</TableCell>
                      <TableCell align="right">{t('currentPriceCol')}</TableCell>
                      <TableCell align="right">{t('newPriceCol')}</TableCell>
                      <TableCell align="right">{t('differenceCol')}</TableCell>
                      <TableCell>{t('ruleCol')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {simResults.map((r, i) => (
                      <TableRow key={i}>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.title}
                        </TableCell>
                        <TableCell align="right">{r.oldPrice}</TableCell>
                        <TableCell align="right" sx={{ fontWeight: 600 }}>
                          {r.newPrice}
                        </TableCell>
                        <TableCell
                          align="right"
                          sx={{
                            color: r.diff.startsWith('+') ? 'success.main' : 'error.main',
                            fontWeight: 500,
                          }}
                        >
                          {r.diff}
                        </TableCell>
                        <TableCell>{r.rule}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>

              {applying && (
                <Box sx={{ mb: 2 }}>
                  <LinearProgress variant="determinate" value={applyProgress} />
                  <Typography variant="caption" color="text.secondary">
                    {t('progressPercent', { percent: Math.round(applyProgress) })}
                  </Typography>
                </Box>
              )}

              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  variant="contained"
                  color="warning"
                  size="small"
                  onClick={handleApplyChanges}
                  disabled={applying}
                  startIcon={applying ? <CircularProgress size={16} /> : <PlayArrowIcon />}
                >
                  {applying ? t('applying') : t('applyChanges', { count: simResults.length })}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => setSimResults(null)}
                  disabled={applying}
                >
                  {t('clear')}
                </Button>
              </Box>
            </>
          )}
        </Box>
      )}

      {/* ================================================================= */}
      {/* ADD / EDIT RULE SUB-DIALOG                                        */}
      {/* ================================================================= */}
      <Dialog open={ruleDialogOpen} onClose={() => setRuleDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingRule && rules.find((r) => r.id === editingRule.id) ? t('editRule') : t('addRule')}
        </DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          {editingRule && (
            <>
              <TextField
                label={t('ruleNameLabel')}
                size="small"
                fullWidth
                value={editingRule.name}
                onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
              />

              <FormControl size="small" fullWidth>
                <InputLabel>{t('conditionLabel')}</InputLabel>
                <Select
                  label={t('conditionLabel')}
                  value={editingRule.condition}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      condition: e.target.value as PricingRule['condition'],
                    })
                  }
                >
                  <MenuItem value="price_too_high">{t('conditionPriceTooHigh')}</MenuItem>
                  <MenuItem value="price_too_low">{t('conditionPriceTooLow')}</MenuItem>
                  <MenuItem value="match_competitor">{t('conditionMatchCompetitor')}</MenuItem>
                </Select>
              </FormControl>

              <TextField
                label={t('thresholdPercentLabel')}
                type="number"
                size="small"
                value={editingRule.threshold_percent}
                onChange={(e) =>
                  setEditingRule({
                    ...editingRule,
                    threshold_percent: Math.max(0, parseInt(e.target.value) || 0),
                  })
                }
                fullWidth
                inputProps={{ min: 0, max: 100 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">%</InputAdornment>,
                }}
                helperText={t('thresholdHelperText')}
              />

              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel>{t('adjustmentLabel')}</InputLabel>
                  <Select
                    label={t('adjustmentLabel')}
                    value={editingRule.adjustment_type}
                    onChange={(e) =>
                      setEditingRule({
                        ...editingRule,
                        adjustment_type: e.target.value as 'decrease' | 'increase',
                      })
                    }
                  >
                    <MenuItem value="decrease">{t('decrease')}</MenuItem>
                    <MenuItem value="increase">{t('increase')}</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  label={t('percentLabel')}
                  type="number"
                  size="small"
                  value={editingRule.adjustment_percent}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      adjustment_percent: Math.max(0, Math.min(100, parseInt(e.target.value) || 0)),
                    })
                  }
                  sx={{ flex: 1 }}
                  inputProps={{ min: 0, max: 100 }}
                  InputProps={{
                    endAdornment: <InputAdornment position="end">%</InputAdornment>,
                  }}
                />
              </Box>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label={t('priceFloorLabel')}
                  type="number"
                  size="small"
                  value={editingRule.price_floor ?? ''}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      price_floor: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  sx={{ flex: 1 }}
                  inputProps={{ min: 0, step: 0.01 }}
                  placeholder={t('optional')}
                  helperText={t('floorHelperText')}
                />
                <TextField
                  label={t('priceCeilingLabel')}
                  type="number"
                  size="small"
                  value={editingRule.price_ceiling ?? ''}
                  onChange={(e) =>
                    setEditingRule({
                      ...editingRule,
                      price_ceiling: e.target.value ? parseFloat(e.target.value) : undefined,
                    })
                  }
                  sx={{ flex: 1 }}
                  inputProps={{ min: 0, step: 0.01 }}
                  placeholder={t('optional')}
                  helperText={t('ceilingHelperText')}
                />
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDialogOpen(false)}>{t('cancelBtn')}</Button>
          <Button variant="contained" onClick={handleSaveRule} disabled={!editingRule?.name}>
            {t('saveBtn')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
