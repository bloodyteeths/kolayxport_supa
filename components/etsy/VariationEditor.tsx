import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Switch,
  Button,
  CircularProgress,
  Paper,
  Typography,
  Box,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Tooltip,
  Collapse,
  InputAdornment,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

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

// --- Currency helpers ---

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '\u20AC',
  GBP: '\u00A3',
  TRY: '\u20BA',
  CAD: 'CA$',
  AUD: 'A$',
  JPY: '\u00A5',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  CHF: 'CHF',
  PLN: 'z\u0142',
  CZK: 'K\u010D',
  HUF: 'Ft',
  ILS: '\u20AA',
  SGD: 'S$',
  HKD: 'HK$',
  NZD: 'NZ$',
  MXN: 'MX$',
  BRL: 'R$',
  INR: '\u20B9',
};

function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code;
}

// --- Component ---

export default function VariationEditor({ listingId, shopId, onSaved }: VariationEditorProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [originalProducts, setOriginalProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Add variation dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newPropertyId, setNewPropertyId] = useState<number | ''>('');
  const [newPropertyName, setNewPropertyName] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newQuantity, setNewQuantity] = useState('1');
  const [newSku, setNewSku] = useState('');

  // Delete confirmation
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  // Bulk actions
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkQuantity, setBulkQuantity] = useState('');

  // Detect currency from first product
  const currencyCode = useMemo(() => {
    for (const p of products) {
      if (p.offerings?.[0]?.price?.currency_code) {
        return p.offerings[0].price.currency_code;
      }
    }
    return 'USD';
  }, [products]);

  const currencySymbol = getCurrencySymbol(currencyCode);

  // Detect default divisor
  const defaultDivisor = useMemo(() => {
    for (const p of products) {
      if (p.offerings?.[0]?.price?.divisor) {
        return p.offerings[0].price.divisor;
      }
    }
    return 100;
  }, [products]);

  // Unsaved changes detection
  const hasChanges = useMemo(() => {
    return JSON.stringify(products) !== JSON.stringify(originalProducts);
  }, [products, originalProducts]);

  // Existing properties in the listing (for the "add" dialog)
  const existingProperties = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of originalProducts) {
      for (const pv of p.property_values) {
        if (!map.has(pv.property_id)) {
          map.set(pv.property_id, pv.property_name);
        }
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [originalProducts]);

  // --- Fetch ---

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=get_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`
      );
      if (!res.ok) throw new Error('Envanter verileri alinamadi');
      const data = await res.json();
      const fetched = data.products || [];
      setProducts(fetched);
      setOriginalProducts(JSON.parse(JSON.stringify(fetched)));
    } catch (err: any) {
      toast.error(err.message || 'Envanter yuklenirken hata olustu');
    } finally {
      setLoading(false);
    }
  }, [listingId, shopId]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  // --- Helpers ---

  const getVariationLabel = (product: Product): string => {
    if (!product.property_values || product.property_values.length === 0) return '-';
    return product.property_values
      .map((pv) => `${pv.property_name}: ${pv.values.join(', ')}`)
      .join(' / ');
  };

  const getDisplayPrice = (offering: Offering): string => {
    return (offering.price.amount / offering.price.divisor).toFixed(2);
  };

  // --- Mutations ---

  const updateProduct = (productIndex: number, field: string, value: any) => {
    setProducts((prev) => {
      const updated = [...prev];
      const product = { ...updated[productIndex] };

      if (field === 'sku') {
        product.sku = value;
      } else if (field === 'price' && product.offerings.length > 0) {
        const offerings = [...product.offerings];
        const offering = { ...offerings[0] };
        const priceNum = parseFloat(value);
        if (!isNaN(priceNum)) {
          offering.price = {
            ...offering.price,
            amount: Math.round(priceNum * offering.price.divisor),
          };
        }
        offerings[0] = offering;
        product.offerings = offerings;
      } else if (field === 'quantity' && product.offerings.length > 0) {
        const offerings = [...product.offerings];
        const offering = { ...offerings[0] };
        const qty = parseInt(value, 10);
        if (!isNaN(qty) && qty >= 0) {
          offering.quantity = qty;
        }
        offerings[0] = offering;
        product.offerings = offerings;
      } else if (field === 'is_enabled' && product.offerings.length > 0) {
        const offerings = [...product.offerings];
        const offering = { ...offerings[0] };
        offering.is_enabled = value;
        offerings[0] = offering;
        product.offerings = offerings;
      }

      updated[productIndex] = product;
      return updated;
    });
  };

  const removeProduct = (index: number) => {
    setProducts((prev) => prev.filter((_, i) => i !== index));
    setDeleteIndex(null);
    toast.success('Varyasyon silindi (kaydetmeyi unutmayin)');
  };

  const addVariation = () => {
    if (!newValue.trim()) {
      toast.error('Deger giriniz');
      return;
    }

    const priceNum = parseFloat(newPrice);
    const qtyNum = parseInt(newQuantity, 10);

    if (isNaN(priceNum) || priceNum < 0) {
      toast.error('Gecerli bir fiyat giriniz');
      return;
    }
    if (isNaN(qtyNum) || qtyNum < 0) {
      toast.error('Gecerli bir stok giriniz');
      return;
    }

    const propertyId = typeof newPropertyId === 'number' ? newPropertyId : 0;
    const propertyName = newPropertyName.trim();

    if (!propertyId && !propertyName) {
      toast.error('Ozellik seciniz veya yeni ozellik adi giriniz');
      return;
    }

    // Resolve property name from existing if selected
    let resolvedName = propertyName;
    if (propertyId && !resolvedName) {
      const found = existingProperties.find((p) => p.id === propertyId);
      resolvedName = found?.name || 'Variation';
    }

    const newProduct: Product = {
      product_id: 0, // new product, Etsy assigns ID
      sku: newSku.trim(),
      property_values: [
        {
          property_id: propertyId,
          property_name: resolvedName,
          values: [newValue.trim()],
          scale_id: null,
        },
      ],
      offerings: [
        {
          offering_id: 0,
          price: {
            amount: Math.round(priceNum * defaultDivisor),
            divisor: defaultDivisor,
            currency_code: currencyCode,
          },
          quantity: qtyNum,
          is_enabled: true,
        },
      ],
    };

    setProducts((prev) => [...prev, newProduct]);
    resetAddDialog();
    toast.success('Varyasyon eklendi (kaydetmeyi unutmayin)');
  };

  const resetAddDialog = () => {
    setAddDialogOpen(false);
    setNewPropertyId('');
    setNewPropertyName('');
    setNewValue('');
    setNewPrice('');
    setNewQuantity('1');
    setNewSku('');
  };

  // --- Bulk actions ---

  const applyBulkPrice = () => {
    const priceNum = parseFloat(bulkPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      toast.error('Gecerli bir fiyat giriniz');
      return;
    }
    setProducts((prev) =>
      prev.map((product) => {
        if (product.offerings.length === 0) return product;
        const offerings = [...product.offerings];
        const offering = { ...offerings[0] };
        offering.price = {
          ...offering.price,
          amount: Math.round(priceNum * offering.price.divisor),
        };
        offerings[0] = offering;
        return { ...product, offerings };
      })
    );
    setBulkPrice('');
    toast.success('Tum fiyatlar guncellendi');
  };

  const applyBulkQuantity = () => {
    const qtyNum = parseInt(bulkQuantity, 10);
    if (isNaN(qtyNum) || qtyNum < 0) {
      toast.error('Gecerli bir stok giriniz');
      return;
    }
    setProducts((prev) =>
      prev.map((product) => {
        if (product.offerings.length === 0) return product;
        const offerings = [...product.offerings];
        const offering = { ...offerings[0] };
        offering.quantity = qtyNum;
        offerings[0] = offering;
        return { ...product, offerings };
      })
    );
    setBulkQuantity('');
    toast.success('Tum stoklar guncellendi');
  };

  // --- Save ---

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=update_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ products }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Envanter guncellenemedi');
      }
      toast.success('Varyasyonlar basariyla guncellendi');
      setOriginalProducts(JSON.parse(JSON.stringify(products)));
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Kaydetme sirasinda hata olustu');
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
          Varyasyonlar yukleniyor...
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Unsaved changes indicator */}
      {hasChanges && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1.5,
            px: 1.5,
            py: 0.75,
            bgcolor: 'warning.light',
            borderRadius: 1,
          }}
        >
          <WarningIcon fontSize="small" sx={{ color: 'warning.dark' }} />
          <Typography variant="body2" sx={{ color: 'warning.dark', fontWeight: 500 }}>
            Degisiklik var - kaydetmeyi unutmayin
          </Typography>
        </Box>
      )}

      {/* Toolbar: Add + Bulk */}
      <Box display="flex" flexWrap="wrap" gap={1} mb={1.5} alignItems="center">
        <Button
          variant="outlined"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setAddDialogOpen(true)}
        >
          Varyasyon Ekle
        </Button>
        <Button
          variant="text"
          size="small"
          onClick={() => setBulkOpen((o) => !o)}
        >
          Toplu Islemler
        </Button>
        {products.length > 0 && (
          <Chip
            label={`${products.length} varyasyon`}
            size="small"
            variant="outlined"
            sx={{ ml: 'auto' }}
          />
        )}
      </Box>

      {/* Bulk actions panel */}
      <Collapse in={bulkOpen}>
        <Paper variant="outlined" sx={{ p: 1.5, mb: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'flex-end' }}>
          <Box display="flex" gap={1} alignItems="flex-end">
            <TextField
              label="Tum fiyatlar"
              size="small"
              type="number"
              value={bulkPrice}
              onChange={(e) => setBulkPrice(e.target.value)}
              inputProps={{ min: 0, step: '0.01' }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">{currencySymbol}</InputAdornment>
                ),
              }}
              sx={{ width: 140 }}
            />
            <Button variant="outlined" size="small" onClick={applyBulkPrice} disabled={!bulkPrice}>
              Tumunun fiyatini guncelle
            </Button>
          </Box>
          <Box display="flex" gap={1} alignItems="flex-end">
            <TextField
              label="Tum stoklar"
              size="small"
              type="number"
              value={bulkQuantity}
              onChange={(e) => setBulkQuantity(e.target.value)}
              inputProps={{ min: 0 }}
              sx={{ width: 100 }}
            />
            <Button variant="outlined" size="small" onClick={applyBulkQuantity} disabled={!bulkQuantity}>
              Tumunun stokunu guncelle
            </Button>
          </Box>
        </Paper>
      </Collapse>

      {/* Table */}
      {products.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
          Bu urunun varyasyonu yok. Eklemek icin yukardaki butonu kullanin.
        </Typography>
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Varyasyon</TableCell>
                <TableCell>Fiyat ({currencySymbol})</TableCell>
                <TableCell>Stok</TableCell>
                <TableCell>SKU</TableCell>
                <TableCell align="center">Aktif</TableCell>
                <TableCell align="center" sx={{ width: 48 }}></TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {products.map((product, idx) => {
                const offering = product.offerings[0];
                if (!offering) return null;
                const isDisabled = !offering.is_enabled;
                return (
                  <TableRow
                    key={product.product_id || `new-${idx}`}
                    sx={{
                      opacity: isDisabled ? 0.5 : 1,
                      bgcolor: isDisabled ? 'action.hover' : 'inherit',
                      '&:hover': { bgcolor: isDisabled ? 'action.hover' : 'action.selected' },
                    }}
                  >
                    <TableCell>
                      <Typography variant="body2">{getVariationLabel(product)}</Typography>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={getDisplayPrice(offering)}
                        onChange={(e) => updateProduct(idx, 'price', e.target.value)}
                        inputProps={{ min: 0, step: '0.01' }}
                        InputProps={{
                          startAdornment: (
                            <InputAdornment position="start">{currencySymbol}</InputAdornment>
                          ),
                        }}
                        sx={{ width: 120 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={offering.quantity}
                        onChange={(e) => updateProduct(idx, 'quantity', e.target.value)}
                        inputProps={{ min: 0 }}
                        sx={{ width: 80 }}
                      />
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={product.sku}
                        onChange={(e) => updateProduct(idx, 'sku', e.target.value)}
                        sx={{ width: 120 }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Switch
                        checked={offering.is_enabled}
                        onChange={(e) => updateProduct(idx, 'is_enabled', e.target.checked)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell align="center">
                      <Tooltip title="Varyasyonu sil">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => setDeleteIndex(idx)}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Save button */}
      <Box display="flex" justifyContent="flex-end" mt={2} gap={1}>
        {hasChanges && (
          <Button
            variant="text"
            onClick={() => {
              setProducts(JSON.parse(JSON.stringify(originalProducts)));
            }}
            disabled={saving}
          >
            Vazgec
          </Button>
        )}
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {saving ? 'Kaydediliyor...' : 'Kaydet'}
        </Button>
      </Box>

      {/* --- Add Variation Dialog --- */}
      <Dialog open={addDialogOpen} onClose={resetAddDialog} maxWidth="sm" fullWidth>
        <DialogTitle>Yeni Varyasyon Ekle</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
          {/* Property selection: existing or custom */}
          {existingProperties.length > 0 ? (
            <FormControl size="small" fullWidth>
              <InputLabel>Ozellik Sec</InputLabel>
              <Select
                value={newPropertyId}
                label="Ozellik Sec"
                onChange={(e) => {
                  const val = e.target.value as number;
                  setNewPropertyId(val);
                  const found = existingProperties.find((p) => p.id === val);
                  setNewPropertyName(found?.name || '');
                }}
              >
                {existingProperties.map((prop) => (
                  <MenuItem key={prop.id} value={prop.id}>
                    {prop.name} (ID: {prop.id})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <>
              <TextField
                label="Ozellik Adi (orn: Renk, Beden)"
                size="small"
                fullWidth
                value={newPropertyName}
                onChange={(e) => setNewPropertyName(e.target.value)}
              />
              <TextField
                label="Ozellik ID (Etsy property_id)"
                size="small"
                fullWidth
                type="number"
                value={newPropertyId}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setNewPropertyId(isNaN(v) ? '' : v);
                }}
                helperText="Ornek: 200 = Color, 100 = Size"
              />
            </>
          )}

          <TextField
            label="Deger (orn: XXL, Kirmizi)"
            size="small"
            fullWidth
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            autoFocus
          />

          <Box display="flex" gap={2}>
            <TextField
              label={`Fiyat (${currencySymbol})`}
              size="small"
              type="number"
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              inputProps={{ min: 0, step: '0.01' }}
              sx={{ flex: 1 }}
            />
            <TextField
              label="Stok"
              size="small"
              type="number"
              value={newQuantity}
              onChange={(e) => setNewQuantity(e.target.value)}
              inputProps={{ min: 0 }}
              sx={{ flex: 1 }}
            />
          </Box>

          <TextField
            label="SKU (opsiyonel)"
            size="small"
            fullWidth
            value={newSku}
            onChange={(e) => setNewSku(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={resetAddDialog}>Iptal</Button>
          <Button variant="contained" onClick={addVariation}>
            Ekle
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Delete Confirmation Dialog --- */}
      <Dialog open={deleteIndex !== null} onClose={() => setDeleteIndex(null)} maxWidth="xs">
        <DialogTitle>Varyasyonu Sil</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {deleteIndex !== null && products[deleteIndex]
              ? `"${getVariationLabel(products[deleteIndex])}" varyasyonunu silmek istediginize emin misiniz?`
              : 'Bu varyasyonu silmek istediginize emin misiniz?'}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Degisiklik kaydedilene kadar Etsy&apos;de silinmez.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteIndex(null)}>Vazgec</Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => deleteIndex !== null && removeProduct(deleteIndex)}
          >
            Sil
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
