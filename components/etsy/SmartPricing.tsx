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
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Edit as EditIcon,
  Add as AddIcon,
  TrendingDown as TrendingDownIcon,
  TrendingUp as TrendingUpIcon,
  Inventory as InventoryIcon,
} from '@mui/icons-material';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PricingRule {
  id: string;
  name: string;
  condition: 'low_views' | 'high_sales' | 'low_sales';
  threshold: number;
  period_days: number;
  adjustment_percent: number;
  adjustment_type: 'decrease' | 'increase';
  price_floor?: number;
  price_ceiling?: number;
  enabled: boolean;
}

interface AutoRestock {
  enabled: boolean;
  quantity: number;
}

interface ListingForSim {
  listing_id: number;
  title: string;
  price: { amount: number; divisor: number; currency_code: string } | null;
  views: number;
  quantity: number;
}

interface SmartPricingProps {
  open: boolean;
  onClose: () => void;
  listings?: ListingForSim[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Condition labels are now resolved via t() inside the component
const CONDITION_KEYS: Record<PricingRule['condition'], string> = {
  low_views: 'lowViews',
  high_sales: 'highSales',
  low_sales: 'lowSales',
};

const LS_RULES_KEY = 'etsy_pricing_rules';
const LS_RESTOCK_KEY = 'etsy_auto_restock';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SmartPricing({ open, onClose, listings = [] }: SmartPricingProps) {
  const t = useTranslations('etsy.smartPricing');
  // --- Pricing rules state ---
  const [rules, setRules] = useState<PricingRule[]>([]);
  const [editingRule, setEditingRule] = useState<PricingRule | null>(null);
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [simResults, setSimResults] = useState<
    { listing_id: number; title: string; oldPrice: string; newPrice: string; rule: string }[] | null
  >(null);

  // --- Auto-restock state ---
  const [autoRestock, setAutoRestock] = useState<AutoRestock>({ enabled: false, quantity: 5 });

  // --- Load from localStorage ---
  useEffect(() => {
    if (!open) return;
    try {
      const raw = localStorage.getItem(LS_RULES_KEY);
      if (raw) setRules(JSON.parse(raw));
    } catch { /* ignore */ }
    try {
      const raw = localStorage.getItem(LS_RESTOCK_KEY);
      if (raw) setAutoRestock(JSON.parse(raw));
    } catch { /* ignore */ }
  }, [open]);

  // --- Persist helpers ---
  const saveRules = useCallback((next: PricingRule[]) => {
    setRules(next);
    localStorage.setItem(LS_RULES_KEY, JSON.stringify(next));
  }, []);

  const saveRestock = useCallback((next: AutoRestock) => {
    setAutoRestock(next);
    localStorage.setItem(LS_RESTOCK_KEY, JSON.stringify(next));
  }, []);

  // --- Rule CRUD ---
  const handleOpenAddRule = () => {
    setEditingRule({
      id: generateId(),
      name: '',
      condition: 'low_views',
      threshold: 10,
      period_days: 7,
      adjustment_percent: 10,
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

  // --- Simulation ---
  const handleSimulate = () => {
    const enabledRules = rules.filter((r) => r.enabled);
    if (enabledRules.length === 0 || listings.length === 0) {
      setSimResults([]);
      return;
    }

    const results: typeof simResults = [];

    for (const listing of listings) {
      if (!listing.price) continue;
      const currentPrice = listing.price.amount / listing.price.divisor;
      const symbol =
        listing.price.currency_code === 'USD'
          ? '$'
          : listing.price.currency_code === 'EUR'
            ? '€'
            : listing.price.currency_code === 'TRY'
              ? '₺'
              : listing.price.currency_code + ' ';

      for (const rule of enabledRules) {
        let matches = false;

        if (rule.condition === 'low_views' && listing.views < rule.threshold) {
          matches = true;
        } else if (rule.condition === 'high_sales') {
          // Simulation: we don't have sales-in-period data, so skip with a note
          continue;
        } else if (rule.condition === 'low_sales') {
          continue;
        }

        if (!matches) continue;

        const factor =
          rule.adjustment_type === 'decrease'
            ? 1 - rule.adjustment_percent / 100
            : 1 + rule.adjustment_percent / 100;

        let newPrice = currentPrice * factor;
        if (rule.price_floor != null && newPrice < rule.price_floor) newPrice = rule.price_floor;
        if (rule.price_ceiling != null && newPrice > rule.price_ceiling) newPrice = rule.price_ceiling;

        if (newPrice !== currentPrice) {
          results.push({
            listing_id: listing.listing_id,
            title: listing.title.length > 50 ? listing.title.slice(0, 50) + '…' : listing.title,
            oldPrice: `${symbol}${currentPrice.toFixed(2)}`,
            newPrice: `${symbol}${newPrice.toFixed(2)}`,
            rule: rule.name || t(CONDITION_KEYS[rule.condition]),
          });
        }
      }
    }

    setSimResults(results);
  };

  // --- Render ---
  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <TrendingDownIcon color="primary" />
          {t('title')}
        </DialogTitle>

        <DialogContent dividers>
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
                        rule.condition === 'low_views'
                          ? 'warning'
                          : rule.condition === 'high_sales'
                            ? 'success'
                            : 'error'
                      }
                    />
                    <Chip
                      size="small"
                      icon={rule.adjustment_type === 'decrease' ? <TrendingDownIcon /> : <TrendingUpIcon />}
                      label={`${rule.adjustment_type === 'decrease' ? '-' : '+'}${rule.adjustment_percent}%`}
                      variant="outlined"
                    />
                    <Typography variant="caption" color="text.secondary">
                      {t('threshold')}: {rule.threshold} / {rule.period_days} {t('days')}
                    </Typography>
                    {rule.price_floor != null && (
                      <Typography variant="caption" color="text.secondary">
                        {t('floor')}: {rule.price_floor}
                      </Typography>
                    )}
                    {rule.price_ceiling != null && (
                      <Typography variant="caption" color="text.secondary">
                        {t('ceiling')}: {rule.price_ceiling}
                      </Typography>
                    )}
                  </Box>
                </CardContent>
                <CardActions sx={{ pt: 0 }}>
                  <Switch
                    size="small"
                    checked={rule.enabled}
                    onChange={() => handleToggleRule(rule.id)}
                  />
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

          <Box sx={{ display: 'flex', gap: 1, mb: 3 }}>
            <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={handleOpenAddRule}>
              {t('addPricingRule')}
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={handleSimulate}
              disabled={rules.filter((r) => r.enabled).length === 0}
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
                  {t('noMatchingProducts')}
                </Alert>
              ) : (
                <TableContainer component={Paper} variant="outlined" sx={{ maxHeight: 300 }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('product')}</TableCell>
                        <TableCell align="right">{t('currentPrice')}</TableCell>
                        <TableCell align="right">{t('newPrice')}</TableCell>
                        <TableCell>{t('rule')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {simResults.map((r, i) => (
                        <TableRow key={i}>
                          <TableCell>{r.title}</TableCell>
                          <TableCell align="right">{r.oldPrice}</TableCell>
                          <TableCell align="right" sx={{ fontWeight: 600 }}>
                            {r.newPrice}
                          </TableCell>
                          <TableCell>{r.rule}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          )}

          <Divider sx={{ my: 2 }} />

          {/* ============================================================= */}
          {/* AUTO-RESTOCK SECTION                                           */}
          {/* ============================================================= */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <InventoryIcon color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={600}>
              {t('autoRestock')}
            </Typography>
            {autoRestock.enabled && (
              <Chip size="small" label={t('autoRestockActive', { quantity: autoRestock.quantity })} color="success" />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            {t('autoRestockDesc')}
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  checked={autoRestock.enabled}
                  onChange={(e) => saveRestock({ ...autoRestock, enabled: e.target.checked })}
                />
              }
              label={t('autoRestockLabel')}
            />
            <TextField
              type="number"
              size="small"
              label={t('quantity')}
              value={autoRestock.quantity}
              onChange={(e) => {
                const v = Math.max(1, parseInt(e.target.value) || 1);
                saveRestock({ ...autoRestock, quantity: v });
              }}
              sx={{ width: 100 }}
              inputProps={{ min: 1 }}
            />
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose}>{t('close')}</Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================= */}
      {/* ADD / EDIT RULE SUB-DIALOG                                        */}
      {/* ================================================================= */}
      <Dialog
        open={ruleDialogOpen}
        onClose={() => setRuleDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editingRule && rules.find((r) => r.id === editingRule.id) ? t('editRule') : t('addPricingRule')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          {editingRule && (
            <>
              <TextField
                label={t('ruleName')}
                size="small"
                fullWidth
                value={editingRule.name}
                onChange={(e) => setEditingRule({ ...editingRule, name: e.target.value })}
              />

              <FormControl size="small" fullWidth>
                <InputLabel>{t('condition')}</InputLabel>
                <Select
                  label={t('condition')}
                  value={editingRule.condition}
                  onChange={(e) =>
                    setEditingRule({ ...editingRule, condition: e.target.value as PricingRule['condition'] })
                  }
                >
                  <MenuItem value="low_views">{t('lowViews')}</MenuItem>
                  <MenuItem value="high_sales">{t('highSales')}</MenuItem>
                  <MenuItem value="low_sales">{t('lowSales')}</MenuItem>
                </Select>
              </FormControl>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <TextField
                  label={t('thresholdValue')}
                  type="number"
                  size="small"
                  value={editingRule.threshold}
                  onChange={(e) =>
                    setEditingRule({ ...editingRule, threshold: Math.max(0, parseInt(e.target.value) || 0) })
                  }
                  sx={{ flex: 1 }}
                  inputProps={{ min: 0 }}
                />
                <TextField
                  label={t('periodDays')}
                  type="number"
                  size="small"
                  value={editingRule.period_days}
                  onChange={(e) =>
                    setEditingRule({ ...editingRule, period_days: Math.max(1, parseInt(e.target.value) || 1) })
                  }
                  sx={{ flex: 1 }}
                  inputProps={{ min: 1 }}
                />
              </Box>

              <Box sx={{ display: 'flex', gap: 2 }}>
                <FormControl size="small" sx={{ flex: 1 }}>
                  <InputLabel>{t('adjustment')}</InputLabel>
                  <Select
                    label={t('adjustment')}
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
                  label={t('adjustmentPercent')}
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
                  label={t('priceFloor')}
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
                  placeholder={t('optionalPlaceholder')}
                />
                <TextField
                  label={t('priceCeiling')}
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
                  placeholder={t('optionalPlaceholder')}
                />
              </Box>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRuleDialogOpen(false)}>{t('cancel')}</Button>
          <Button variant="contained" onClick={handleSaveRule} disabled={!editingRule?.name}>
            {t('save')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
