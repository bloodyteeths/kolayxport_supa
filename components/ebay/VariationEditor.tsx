import React, { useState, useEffect, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Button,
  CircularProgress,
  Paper,
  Typography,
  Box,
  Chip,
} from '@mui/material';
import { toast } from 'react-hot-toast';

interface VariationItem {
  sku: string;
  title?: string;
  price?: { value: string; currency: string };
  quantity?: number;
  status?: string;
}

interface VariationEditorProps {
  sku: string;
  userId: string;
  apiKey: string;
  onSaved: () => void;
}

export default function VariationEditor({ sku, userId, apiKey, onSaved }: VariationEditorProps) {
  const [variations, setVariations] = useState<VariationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasGroup, setHasGroup] = useState(false);

  const fetchVariations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/ebay?action=get_inventory_item_group&sku=${encodeURIComponent(sku)}&user_id=${userId}`,
        {
          headers: { 'x-api-key': apiKey },
        }
      );

      if (res.status === 404) {
        // No group found
        setHasGroup(false);
        setVariations([]);
        return;
      }

      if (!res.ok) throw new Error('Varyasyon verileri alınamadı');

      const data = await res.json();
      setHasGroup(true);

      if (data.variantSKUs && Array.isArray(data.variantSKUs)) {
        // Fetch each variant's details
        const items: VariationItem[] = [];
        for (const variantSku of data.variantSKUs) {
          try {
            const itemRes = await fetch(
              `/api/clawd/ebay?action=listing&sku=${encodeURIComponent(variantSku)}&user_id=${userId}`,
              {
                headers: { 'x-api-key': apiKey },
              }
            );
            if (itemRes.ok) {
              const itemData = await itemRes.json();
              items.push({
                sku: variantSku,
                title: itemData.product?.title || variantSku,
                price: itemData.offers?.[0]?.pricingSummary?.price,
                quantity: itemData.availability?.shipToLocationAvailability?.quantity,
                status: itemData.offers?.[0]?.status,
              });
            } else {
              items.push({ sku: variantSku });
            }
          } catch {
            items.push({ sku: variantSku });
          }
        }
        setVariations(items);
      } else {
        setVariations([]);
      }
    } catch (err: any) {
      // If not a 404, it's a real error — but for MVP, just show empty
      setHasGroup(false);
      setVariations([]);
    } finally {
      setLoading(false);
    }
  }, [sku, userId, apiKey]);

  useEffect(() => {
    fetchVariations();
  }, [fetchVariations]);

  const updateVariation = (index: number, field: string, value: string) => {
    setVariations((prev) => {
      const updated = [...prev];
      const item = { ...updated[index] };

      if (field === 'price' && item.price) {
        item.price = { ...item.price, value };
      } else if (field === 'quantity') {
        const qty = parseInt(value, 10);
        if (!isNaN(qty) && qty >= 0) {
          item.quantity = qty;
        }
      } else if (field === 'sku') {
        item.sku = value;
      }

      updated[index] = item;
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      let successCount = 0;
      let errorCount = 0;

      for (const variation of variations) {
        try {
          const body: Record<string, any> = {
            availability: {
              shipToLocationAvailability: {
                quantity: variation.quantity ?? 0,
              },
            },
          };

          const res = await fetch(
            `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(variation.sku)}&user_id=${userId}`,
            {
              method: 'PUT',
              headers: {
                'x-api-key': apiKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
            }
          );

          if (res.ok) {
            successCount++;
          } else {
            errorCount++;
          }
        } catch {
          errorCount++;
        }
      }

      if (errorCount === 0) {
        toast.success('Varyasyonlar başarıyla güncellendi');
      } else {
        toast.error(`${successCount} başarılı, ${errorCount} başarısız`);
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Kaydetme sırasında hata oluştu');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress size={28} />
        <Typography sx={{ ml: 1.5 }} variant="body2" color="text.secondary">
          Varyasyonlar yükleniyor...
        </Typography>
      </Box>
    );
  }

  if (!hasGroup || variations.length === 0) {
    return (
      <Box sx={{ py: 2, textAlign: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          Bu ürünün varyasyonu yok
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Varyasyon grupları eBay üzerinden yönetilebilir.
        </Typography>
      </Box>
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
              <TableCell align="center">Durum</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {variations.map((variation, idx) => (
              <TableRow key={variation.sku || idx}>
                <TableCell>
                  <Typography variant="body2">
                    {variation.title || variation.sku}
                  </Typography>
                </TableCell>
                <TableCell>
                  {variation.price ? (
                    <TextField
                      size="small"
                      type="number"
                      value={variation.price.value}
                      onChange={(e) => updateVariation(idx, 'price', e.target.value)}
                      inputProps={{ min: 0, step: '0.01' }}
                      sx={{ width: 100 }}
                      InputProps={{
                        endAdornment: (
                          <Typography variant="caption" color="text.secondary">
                            {variation.price.currency}
                          </Typography>
                        ),
                      }}
                    />
                  ) : (
                    <Typography variant="body2" color="text.secondary">-</Typography>
                  )}
                </TableCell>
                <TableCell>
                  <TextField
                    size="small"
                    type="number"
                    value={variation.quantity ?? 0}
                    onChange={(e) => updateVariation(idx, 'quantity', e.target.value)}
                    inputProps={{ min: 0 }}
                    sx={{ width: 80 }}
                  />
                </TableCell>
                <TableCell>
                  <Typography variant="body2" sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {variation.sku}
                  </Typography>
                </TableCell>
                <TableCell align="center">
                  {variation.status && (
                    <Chip
                      label={variation.status === 'PUBLISHED' ? 'Yayında' : 'Yayında Değil'}
                      size="small"
                      color={variation.status === 'PUBLISHED' ? 'success' : 'default'}
                      sx={{ height: 20, fontSize: '0.7rem' }}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
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
