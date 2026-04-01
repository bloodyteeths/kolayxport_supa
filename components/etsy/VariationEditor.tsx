import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  TextField, Switch, Button, CircularProgress, Paper, Typography, Box,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, Tooltip, InputAdornment, Checkbox, FormControlLabel,
  Select, MenuItem, Tabs, Tab, Alert, Divider,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  ContentCopy as DuplicateIcon,
  KeyboardArrowUp as UpIcon,
  KeyboardArrowDown as DownIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// --- Types ---

interface OfferingPrice {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface Offering {
  offering_id: number;
  price: OfferingPrice;
  quantity: number;
  is_enabled: boolean;
}

interface PropertyValue {
  property_id: number;
  property_name: string;
  values: string[];
  scale_id: number | null;
}

interface Product {
  product_id: number;
  sku: string;
  offerings: Offering[];
  property_values: PropertyValue[];
}

interface VariationEditorProps {
  listingId: string;
  shopId: string;
  onSaved: () => void;
}

// --- Etsy known property types ---
const ETSY_PROPERTIES = [
  { id: 200, name: 'Color', tKey: 'color' },
  { id: 100, name: 'Size', tKey: 'size' },
  { id: 504, name: 'Length', tKey: 'length' },
  { id: 501, name: 'Width', tKey: 'width' },
  { id: 502, name: 'Height', tKey: 'height' },
  { id: 503, name: 'Weight', tKey: 'weight' },
  { id: 505, name: 'Diameter', tKey: 'diameter' },
  { id: 506, name: 'Dimensions', tKey: 'dimensions' },
  { id: 507, name: 'Fabric', tKey: 'fabric' },
  { id: 508, name: 'Style', tKey: 'style' },
  { id: 509, name: 'Material', tKey: 'material' },
  { id: 510, name: 'Pattern', tKey: 'pattern' },
];

// --- Currency helpers ---

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '\u20AC', GBP: '\u00A3', TRY: '\u20BA',
  CAD: 'CA$', AUD: 'A$', JPY: '\u00A5', SEK: 'kr', NOK: 'kr',
  DKK: 'kr', CHF: 'CHF', PLN: 'z\u0142', CZK: 'K\u010D',
  HUF: 'Ft', ILS: '\u20AA', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$',
  MXN: 'MX$', BRL: 'R$', INR: '\u20B9',
};

function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code;
}

// --- Variation row styles ---
const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  py: 1.2,
  px: 1.5,
  flexWrap: 'wrap',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  '&:hover': { bgcolor: 'rgba(102,126,234,0.03)' },
  transition: 'background-color 0.15s',
};

const sectionHeaderSx = {
  px: 1.5,
  py: 0.8,
  bgcolor: 'rgba(0,0,0,0.03)',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};

// --- Component ---

export default function VariationEditor({ listingId, shopId, onSaved }: VariationEditorProps) {
  const t = useTranslations('etsy.variation');
  const [products, setProducts] = useState<Product[]>([]);
  const [originalProducts, setOriginalProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Tab: 0=Variations, 1=Price, 2=Quantity, 3=SKU, 4=Visibility
  const [activeTab, setActiveTab] = useState(0);

  // Price tab controls
  const [individualPrice, setIndividualPrice] = useState(false);
  const [priceAction, setPriceAction] = useState<'set' | 'increase' | 'decrease'>('set');
  const [priceValue, setPriceValue] = useState('');

  // Quantity tab controls
  const [individualQuantity, setIndividualQuantity] = useState(false);
  const [quantityAction, setQuantityAction] = useState<'set' | 'increase' | 'decrease'>('set');
  const [quantityValue, setQuantityValue] = useState('');

  // Add dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addPropertyId, setAddPropertyId] = useState<number>(200);
  const [addValues, setAddValues] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addQuantity, setAddQuantity] = useState('1');

  // Delete confirmation
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  // Detect currency
  const currencyCode = useMemo(() => {
    for (const p of products) {
      if (p.offerings?.[0]?.price?.currency_code) return p.offerings[0].price.currency_code;
    }
    return 'USD';
  }, [products]);
  const sym = getCurrencySymbol(currencyCode);

  const defaultDivisor = useMemo(() => {
    for (const p of products) {
      if (p.offerings?.[0]?.price?.divisor) return p.offerings[0].price.divisor;
    }
    return 100;
  }, [products]);

  const hasChanges = useMemo(
    () => JSON.stringify(products) !== JSON.stringify(originalProducts),
    [products, originalProducts],
  );

  // Existing properties
  const existingProperties = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of originalProducts) {
      for (const pv of p.property_values) {
        if (!map.has(pv.property_id)) map.set(pv.property_id, pv.property_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [originalProducts]);

  // Detect individual pricing/quantity on load
  useEffect(() => {
    if (products.length < 2) return;
    const prices = products.map(p => p.offerings[0]?.price?.amount).filter(Boolean);
    const quantities = products.map(p => p.offerings[0]?.quantity).filter(q => q !== undefined);
    setIndividualPrice(!prices.every(p => p === prices[0]));
    setIndividualQuantity(!quantities.every(q => q === quantities[0]));
  }, [products.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Grouped by first property ---
  const grouped = useMemo(() => {
    const groups: { propName: string; items: { product: Product; globalIdx: number }[] }[] = [];
    const map = new Map<string, { product: Product; globalIdx: number }[]>();

    products.forEach((p, idx) => {
      const firstProp = p.property_values[0];
      const key = firstProp?.property_name || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ product: p, globalIdx: idx });
    });

    map.forEach((items, propName) => groups.push({ propName, items }));
    return groups;
  }, [products]);

  // --- Fetch ---

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=get_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`
      );
      if (!res.ok) throw new Error(t('inventoryFetchFailed'));
      const data = await res.json();
      const fetched = data.products || [];
      setProducts(fetched);
      setOriginalProducts(JSON.parse(JSON.stringify(fetched)));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [listingId, shopId]);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  // --- Helpers ---

  const getLabel = (p: Product) =>
    p.property_values?.map(pv => pv.values.join(', ')).join(' / ') || '-';

  const getPrice = (o: Offering) => (o.price.amount / o.price.divisor).toFixed(2);

  // --- Mutations ---

  const updateField = (idx: number, field: string, value: any) => {
    setProducts(prev => {
      const arr = [...prev];
      const p = { ...arr[idx] };
      if (field === 'sku') {
        p.sku = value;
      } else if (field === 'price' && p.offerings.length > 0) {
        const o = { ...p.offerings[0] };
        const n = parseFloat(value);
        if (!isNaN(n)) o.price = { ...o.price, amount: Math.round(n * o.price.divisor) };
        p.offerings = [o, ...p.offerings.slice(1)];
      } else if (field === 'quantity' && p.offerings.length > 0) {
        const o = { ...p.offerings[0] };
        const n = parseInt(value, 10);
        if (!isNaN(n) && n >= 0) o.quantity = n;
        p.offerings = [o, ...p.offerings.slice(1)];
      } else if (field === 'is_enabled' && p.offerings.length > 0) {
        p.offerings = [{ ...p.offerings[0], is_enabled: value }, ...p.offerings.slice(1)];
      }
      arr[idx] = p;
      return arr;
    });
  };

  const removeProduct = (idx: number) => {
    setProducts(prev => prev.filter((_, i) => i !== idx));
    setDeleteIndex(null);
    toast.success(t('variationDeleted'));
  };

  const duplicateProduct = (idx: number) => {
    setProducts(prev => {
      const clone: Product = JSON.parse(JSON.stringify(prev[idx]));
      clone.product_id = 0;
      clone.sku = '';
      if (clone.property_values[0]?.values[0]) {
        clone.property_values[0].values[0] += ` (${t('copy')})`;
      }
      const arr = [...prev];
      arr.splice(idx + 1, 0, clone);
      return arr;
    });
  };

  const moveProduct = (idx: number, dir: 'up' | 'down') => {
    setProducts(prev => {
      const arr = [...prev];
      const t = dir === 'up' ? idx - 1 : idx + 1;
      if (t < 0 || t >= arr.length) return prev;
      [arr[idx], arr[t]] = [arr[t], arr[idx]];
      return arr;
    });
  };

  // Bulk price/quantity apply
  const applyBulkPrice = () => {
    const v = parseFloat(priceValue);
    if (isNaN(v)) return;
    setProducts(prev => prev.map(p => {
      if (!p.offerings.length) return p;
      const o = { ...p.offerings[0] };
      const cur = o.price.amount / o.price.divisor;
      let newPrice = cur;
      if (priceAction === 'set') newPrice = v;
      else if (priceAction === 'increase') newPrice = cur + v;
      else if (priceAction === 'decrease') newPrice = Math.max(0, cur - v);
      o.price = { ...o.price, amount: Math.round(newPrice * o.price.divisor) };
      return { ...p, offerings: [o, ...p.offerings.slice(1)] };
    }));
    toast.success(t('pricesUpdated'));
  };

  const applyBulkQuantity = () => {
    const v = parseInt(quantityValue, 10);
    if (isNaN(v)) return;
    setProducts(prev => prev.map(p => {
      if (!p.offerings.length) return p;
      const o = { ...p.offerings[0] };
      let newQty = o.quantity;
      if (quantityAction === 'set') newQty = v;
      else if (quantityAction === 'increase') newQty = o.quantity + v;
      else if (quantityAction === 'decrease') newQty = Math.max(0, o.quantity - v);
      o.quantity = newQty;
      return { ...p, offerings: [o, ...p.offerings.slice(1)] };
    }));
    toast.success(t('stockUpdated'));
  };

  // Batch add variations
  const addVariations = () => {
    const values = addValues.split(',').map(v => v.trim()).filter(v => v.length > 0);
    if (!values.length) { toast.error(t('enterAtLeastOneValue')); return; }
    const priceNum = parseFloat(addPrice);
    const qtyNum = parseInt(addQuantity, 10);
    if (isNaN(priceNum) || priceNum < 0) { toast.error(t('enterValidPrice')); return; }
    if (isNaN(qtyNum) || qtyNum < 0) { toast.error(t('enterValidStock')); return; }

    const propName = existingProperties.find(p => p.id === addPropertyId)?.name
      || ETSY_PROPERTIES.find(p => p.id === addPropertyId)?.name || 'Variation';

    const newProducts: Product[] = values.map(value => ({
      product_id: 0,
      sku: '',
      property_values: [{
        property_id: addPropertyId,
        property_name: propName,
        values: [value],
        scale_id: null,
      }],
      offerings: [{
        offering_id: 0,
        price: { amount: Math.round(priceNum * defaultDivisor), divisor: defaultDivisor, currency_code: currencyCode },
        quantity: qtyNum,
        is_enabled: true,
      }],
    }));

    setProducts(prev => [...prev, ...newProducts]);
    setAddDialogOpen(false);
    setAddValues('');
    setAddPrice('');
    setAddQuantity('1');
    toast.success(t('variationsAdded', { count: values.length }));
  };

  // --- Save ---

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=update_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products }) }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t('inventoryUpdateFailed'));
      }
      toast.success(t('variationsSavedToEtsy'));
      setOriginalProducts(JSON.parse(JSON.stringify(products)));
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress size={28} />
        <Typography sx={{ ml: 1.5 }} variant="body2" color="text.secondary">
          {t('variationsLoading')}
        </Typography>
      </Box>
    );
  }

  const totalStock = products.reduce((sum, p) => sum + (p.offerings[0]?.quantity || 0), 0);

  return (
    <Box>
      {/* Tabs — Getvela style */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: '2px solid #eee',
          mb: 0,
          minHeight: 36,
          '& .MuiTab-root': {
            minHeight: 36, py: 0.5, textTransform: 'none', fontWeight: 600,
            fontSize: '0.82rem', color: '#888',
          },
          '& .Mui-selected': { color: '#667eea' },
          '& .MuiTabs-indicator': { bgcolor: '#667eea', height: 2.5 },
        }}
      >
        <Tab label={t('tabVariations')} />
        <Tab label={t('tabPrice')} />
        <Tab label={t('tabStock')} />
        <Tab label="SKU" />
        <Tab label={t('tabVisibility')} />
      </Tabs>

      {/* Summary chips */}
      {products.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, py: 1, px: 0.5, flexWrap: 'wrap' }}>
          <Chip label={`${products.length} ${t('tabVariations').toLowerCase()}`} size="small" variant="outlined" />
          <Chip label={`${t('totalStock')}: ${totalStock}`} size="small" variant="outlined" />
          {existingProperties.map(p => (
            <Chip key={p.id} label={p.name} size="small"
              sx={{ bgcolor: 'rgba(102,126,234,0.1)', fontWeight: 600 }} />
          ))}
        </Box>
      )}

      {/* Unsaved warning */}
      {hasChanges && (
        <Alert severity="warning" sx={{ py: 0.3, my: 0.5, borderRadius: '8px', fontSize: '0.8rem' }}>
          {t('unsavedChanges')}
        </Alert>
      )}

      {/* ============================================================ */}
      {/* TAB 0: Variations — list with reorder, duplicate, delete     */}
      {/* ============================================================ */}
      {activeTab === 0 && (
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setAddDialogOpen(true)}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea' }}
            >
              {t('addVariation')}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {t('firstVariationDefault')}
            </Typography>
          </Box>

          {products.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#fafafa', borderRadius: '10px' }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {t('noVariationsYet')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('bulkAddHint')}
              </Typography>
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
              {grouped.map(group => (
                <Box key={group.propName}>
                  {group.propName && (
                    <Box sx={sectionHeaderSx}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {group.propName}
                      </Typography>
                    </Box>
                  )}
                  {group.items.map(({ product, globalIdx }) => {
                    const o = product.offerings[0];
                    if (!o) return null;
                    return (
                      <Box key={product.product_id || `new-${globalIdx}`} sx={{
                        ...rowSx,
                        opacity: o.is_enabled ? 1 : 0.45,
                      }}>
                        {/* Reorder arrows */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', mr: 0.5 }}>
                          <IconButton size="small" disabled={globalIdx === 0} onClick={() => moveProduct(globalIdx, 'up')} sx={{ p: 0.15 }}>
                            <UpIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                          <IconButton size="small" disabled={globalIdx === products.length - 1} onClick={() => moveProduct(globalIdx, 'down')} sx={{ p: 0.15 }}>
                            <DownIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Box>

                        {/* Label */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {getLabel(product)}
                          </Typography>
                          {product.sku && (
                            <Typography variant="caption" color="text.secondary">SKU: {product.sku}</Typography>
                          )}
                        </Box>

                        {/* Quick info */}
                        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 55, textAlign: 'right' }}>
                          {sym}{getPrice(o)}
                        </Typography>
                        <Chip
                          label={o.quantity === 0 ? t('outOfStock') : `${o.quantity} ${t('pieces')}`}
                          size="small"
                          color={o.quantity === 0 ? 'error' : 'default'}
                          variant="outlined"
                          sx={{ fontSize: '0.7rem', height: 22, minWidth: { xs: 'auto', sm: 60 } }}
                        />

                        {/* Actions */}
                        <Box sx={{ display: 'flex', gap: 0 }}>
                          <Tooltip title={t('copy')}>
                            <IconButton size="small" onClick={() => duplicateProduct(globalIdx)}><DuplicateIcon sx={{ fontSize: 16 }} /></IconButton>
                          </Tooltip>
                          <Tooltip title={t('deleteTooltip')}>
                            <IconButton size="small" color="error" onClick={() => setDeleteIndex(globalIdx)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                          </Tooltip>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Paper>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 1: Price                                                  */}
      {/* ============================================================ */}
      {activeTab === 1 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          {/* Getvela-style controls */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
            <FormControlLabel
              control={<Checkbox checked={individualPrice} onChange={(e) => setIndividualPrice(e.target.checked)} sx={{ color: '#667eea', '&.Mui-checked': { color: '#667eea' }, '& .MuiSvgIcon-root': { fontSize: 24 } }} />}
              label={<Typography variant="body2" fontWeight={600}>{t('individualPrice')}</Typography>}
            />
            {!individualPrice && (
              <>
                <Select size="small" value={priceAction} onChange={(e) => setPriceAction(e.target.value as any)}
                  sx={{ minWidth: { xs: '100%', sm: 130 }, height: 36 }}>
                  <MenuItem value="set">{t('set')}</MenuItem>
                  <MenuItem value="increase">{t('increase')}</MenuItem>
                  <MenuItem value="decrease">{t('decrease')}</MenuItem>
                </Select>
                <TextField
                  size="small" type="number" value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start">{sym}</InputAdornment> }}
                  inputProps={{ min: 0, step: '0.01' }}
                  sx={{ width: { xs: '100%', sm: 120 } }}
                  placeholder="0.00"
                />
                <Button size="small" variant="contained" onClick={applyBulkPrice} disabled={!priceValue}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea', height: 36, width: { xs: '100%', sm: 'auto' } }}>
                  {t('apply')}
                </Button>
              </>
            )}
          </Box>

          {/* Price rows */}
          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
            {grouped.map(group => (
              <Box key={group.propName}>
                {group.propName && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.propName}
                    </Typography>
                  </Box>
                )}
                {group.items.map(({ product, globalIdx }) => {
                  const o = product.offerings[0];
                  if (!o) return null;
                  return (
                    <Box key={globalIdx} sx={rowSx}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                      {individualPrice ? (
                        <TextField
                          size="small" type="number"
                          value={getPrice(o)}
                          onChange={(e) => updateField(globalIdx, 'price', e.target.value)}
                          InputProps={{ startAdornment: <InputAdornment position="start">{sym}</InputAdornment> }}
                          inputProps={{ min: 0, step: '0.01' }}
                          sx={{ width: { xs: '100%', sm: 120 } }}
                        />
                      ) : (
                        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 70, textAlign: 'right' }}>
                          {sym}{getPrice(o)}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 2: Quantity                                               */}
      {/* ============================================================ */}
      {activeTab === 2 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
            <FormControlLabel
              control={<Checkbox checked={individualQuantity} onChange={(e) => setIndividualQuantity(e.target.checked)} sx={{ color: '#667eea', '&.Mui-checked': { color: '#667eea' }, '& .MuiSvgIcon-root': { fontSize: 24 } }} />}
              label={<Typography variant="body2" fontWeight={600}>{t('individualStock')}</Typography>}
            />
            {!individualQuantity && (
              <>
                <Select size="small" value={quantityAction} onChange={(e) => setQuantityAction(e.target.value as any)}
                  sx={{ minWidth: { xs: '100%', sm: 130 }, height: 36 }}>
                  <MenuItem value="set">{t('set')}</MenuItem>
                  <MenuItem value="increase">{t('increase')}</MenuItem>
                  <MenuItem value="decrease">{t('decrease')}</MenuItem>
                </Select>
                <TextField
                  size="small" type="number" value={quantityValue}
                  onChange={(e) => setQuantityValue(e.target.value)}
                  inputProps={{ min: 0 }}
                  sx={{ width: { xs: '100%', sm: 100 } }}
                  placeholder="0"
                />
                <Button size="small" variant="contained" onClick={applyBulkQuantity} disabled={!quantityValue}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea', height: 36, width: { xs: '100%', sm: 'auto' } }}>
                  {t('apply')}
                </Button>
              </>
            )}
          </Box>

          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
            {grouped.map(group => (
              <Box key={group.propName}>
                {group.propName && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.propName}
                    </Typography>
                  </Box>
                )}
                {group.items.map(({ product, globalIdx }) => {
                  const o = product.offerings[0];
                  if (!o) return null;
                  return (
                    <Box key={globalIdx} sx={rowSx}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                      {individualQuantity ? (
                        <TextField
                          size="small" type="number"
                          value={o.quantity}
                          onChange={(e) => updateField(globalIdx, 'quantity', e.target.value)}
                          inputProps={{ min: 0 }}
                          sx={{ width: { xs: '100%', sm: 90 } }}
                        />
                      ) : (
                        <Chip
                          label={o.quantity === 0 ? t('outOfStock') : o.quantity}
                          size="small"
                          color={o.quantity === 0 ? 'error' : 'default'}
                          variant="outlined"
                          sx={{ minWidth: 60 }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 3: SKU                                                    */}
      {/* ============================================================ */}
      {activeTab === 3 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
            {grouped.map(group => (
              <Box key={group.propName}>
                {group.propName && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.propName}
                    </Typography>
                  </Box>
                )}
                {group.items.map(({ product, globalIdx }) => (
                  <Box key={globalIdx} sx={rowSx}>
                    <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                    <TextField
                      size="small"
                      value={product.sku}
                      onChange={(e) => updateField(globalIdx, 'sku', e.target.value)}
                      placeholder={t('enterSku')}
                      sx={{ width: { xs: '100%', sm: 150 } }}
                    />
                  </Box>
                ))}
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 4: Visibility (active/inactive toggle)                    */}
      {/* ============================================================ */}
      {activeTab === 4 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
            <Button size="small" variant="outlined" onClick={() => {
              setProducts(prev => prev.map(p => {
                if (!p.offerings.length) return p;
                return { ...p, offerings: [{ ...p.offerings[0], is_enabled: true }, ...p.offerings.slice(1)] };
              }));
            }} sx={{ textTransform: 'none', borderRadius: '6px' }}>
              {t('enableAll')}
            </Button>
            <Button size="small" variant="outlined" onClick={() => {
              setProducts(prev => prev.map(p => {
                if (!p.offerings.length) return p;
                return { ...p, offerings: [{ ...p.offerings[0], is_enabled: false }, ...p.offerings.slice(1)] };
              }));
            }} sx={{ textTransform: 'none', borderRadius: '6px' }}>
              {t('disableAll')}
            </Button>
          </Box>
          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
            {grouped.map(group => (
              <Box key={group.propName}>
                {group.propName && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.propName}
                    </Typography>
                  </Box>
                )}
                {group.items.map(({ product, globalIdx }) => {
                  const o = product.offerings[0];
                  if (!o) return null;
                  return (
                    <Box key={globalIdx} sx={{ ...rowSx, opacity: o.is_enabled ? 1 : 0.45 }}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                      <Switch
                        checked={o.is_enabled}
                        onChange={(e) => updateField(globalIdx, 'is_enabled', e.target.checked)}
                        sx={{ '& .Mui-checked': { color: '#667eea' }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: '#667eea' } }}
                      />
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* Empty state for non-variation tabs */}
      {activeTab > 0 && products.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">{t('addVariationsFirst')}</Typography>
        </Box>
      )}

      {/* Save / Cancel */}
      <Box display="flex" justifyContent="flex-end" mt={2} gap={1} alignItems="center"
        sx={{ position: 'sticky', bottom: 0, bgcolor: 'white', py: 1.5, zIndex: 5, borderTop: '1px solid #eee' }}>
        {hasChanges && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
              {t('changesNotSentToEtsy')}
            </Typography>
            <Button variant="text" onClick={() => setProducts(JSON.parse(JSON.stringify(originalProducts)))}
              disabled={saving} sx={{ textTransform: 'none' }}>
              {t('cancel')}
            </Button>
          </>
        )}
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
          sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea' }}
        >
          {saving ? t('saving') : t('saveToEtsy')}
        </Button>
      </Box>

      {/* --- Add Variations Dialog --- */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth sx={{ zIndex: 1600 }}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('addVariation')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '16px !important' }}>
          <Alert severity="info" sx={{ py: 0.5, borderRadius: '8px' }}>
            {t('bulkAddHint')}
          </Alert>

          {/* Property type chips */}
          <Box>
            <Typography variant="caption" fontWeight={700} sx={{ mb: 1, display: 'block', color: 'text.secondary', textTransform: 'uppercase' }}>
              {t('propertyType')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {existingProperties.map(prop => (
                <Chip key={prop.id}
                  label={`${(() => { const ep = ETSY_PROPERTIES.find(p => p.id === prop.id); return ep ? t(ep.tKey) : prop.name; })()} (${t('existing')})`}
                  onClick={() => setAddPropertyId(prop.id)}
                  color={addPropertyId === prop.id ? 'primary' : 'default'}
                  variant={addPropertyId === prop.id ? 'filled' : 'outlined'}
                  size="small" sx={{ fontWeight: addPropertyId === prop.id ? 700 : 400 }}
                />
              ))}
              {ETSY_PROPERTIES.filter(p => !existingProperties.some(ep => ep.id === p.id)).slice(0, 8).map(prop => (
                <Chip key={prop.id} label={t(prop.tKey)}
                  onClick={() => setAddPropertyId(prop.id)}
                  color={addPropertyId === prop.id ? 'primary' : 'default'}
                  variant={addPropertyId === prop.id ? 'filled' : 'outlined'}
                  size="small" sx={{ fontWeight: addPropertyId === prop.id ? 700 : 400 }}
                />
              ))}
            </Box>
          </Box>

          <TextField label={t('valuesLabel')} size="small" fullWidth multiline minRows={2}
            value={addValues} onChange={(e) => setAddValues(e.target.value)}
            placeholder={t('valuesPlaceholder')} autoFocus
            helperText={addValues ? t('variationsWillBeAdded', { count: addValues.split(',').filter(v => v.trim()).length }) : t('eachValueCreatesVariation')}
          />

          <Box display="flex" gap={2}>
            <TextField label={`Fiyat (${sym})`} size="small" type="number"
              value={addPrice} onChange={(e) => setAddPrice(e.target.value)}
              inputProps={{ min: 0, step: '0.01' }} sx={{ flex: 1 }}
              helperText={t('appliedToAll')}
            />
            <TextField label="Stok" size="small" type="number"
              value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)}
              inputProps={{ min: 0 }} sx={{ flex: 1 }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddDialogOpen(false)} sx={{ textTransform: 'none' }}>{t('cancel')}</Button>
          <Button variant="contained" onClick={addVariations} disabled={!addValues.trim() || !addPrice}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea' }}>
            {t('variationsAdded', { count: addValues.split(',').filter(v => v.trim()).length || 0 })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Delete Confirmation --- */}
      <Dialog open={deleteIndex !== null} onClose={() => setDeleteIndex(null)} maxWidth="xs" sx={{ zIndex: 1600 }}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('deleteVariation')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {deleteIndex !== null && products[deleteIndex]
              ? t('deleteConfirmNamed', { name: getLabel(products[deleteIndex]) })
              : t('deleteConfirm')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t('deleteNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteIndex(null)} sx={{ textTransform: 'none' }}>{t('cancel')}</Button>
          <Button variant="contained" color="error" onClick={() => deleteIndex !== null && removeProduct(deleteIndex)}
            sx={{ textTransform: 'none' }}>
            Sil
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
