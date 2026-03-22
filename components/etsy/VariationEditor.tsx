import React, { useState, useEffect, useCallback } from 'react';
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
} from '@mui/material';
import { toast } from 'react-hot-toast';

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
  apiKey: string;
  onSaved: () => void;
}

export default function VariationEditor({ listingId, shopId, apiKey, onSaved }: VariationEditorProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=get_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`,
        { headers: { 'x-api-key': apiKey } }
      );
      if (!res.ok) throw new Error('Envanter verileri alinamadi');
      const data = await res.json();
      setProducts(data.products || []);
    } catch (err: any) {
      toast.error(err.message || 'Envanter yuklenirken hata olustu');
    } finally {
      setLoading(false);
    }
  }, [listingId, shopId, apiKey]);

  useEffect(() => {
    fetchInventory();
  }, [fetchInventory]);

  const getVariationLabel = (product: Product): string => {
    if (!product.property_values || product.property_values.length === 0) return '-';
    return product.property_values
      .map((pv) => `${pv.property_name}: ${pv.values.join(', ')}`)
      .join(' / ');
  };

  const getDisplayPrice = (offering: Offering): string => {
    return (offering.price.amount / offering.price.divisor).toFixed(2);
  };

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

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=update_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
          },
          body: JSON.stringify({ products }),
        }
      );
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Envanter guncellenemedi');
      }
      toast.success('Varyasyonlar basariyla guncellendi');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Kaydetme sirasinda hata olustu');
    } finally {
      setSaving(false);
    }
  };

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

  if (products.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
        Bu urunun varyasyonu yok
      </Typography>
    );
  }

  return (
    <Box>
      <TableContainer component={Paper} variant="outlined">
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Varyasyon</TableCell>
              <TableCell>Fiyat</TableCell>
              <TableCell>Stok</TableCell>
              <TableCell>SKU</TableCell>
              <TableCell align="center">Aktif</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {products.map((product, idx) => {
              const offering = product.offerings[0];
              if (!offering) return null;
              return (
                <TableRow key={product.product_id || idx}>
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
                      sx={{ width: 100 }}
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
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <Box display="flex" justifyContent="flex-end" mt={2}>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {saving ? 'Kaydediliyor...' : 'Kaydet'}
        </Button>
      </Box>
    </Box>
  );
}
