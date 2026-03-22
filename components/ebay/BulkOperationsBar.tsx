import React, { useState, useMemo } from 'react';
import {
  Paper,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  RadioGroup,
  Radio,
  FormControlLabel,
  LinearProgress,
  Typography,
  Box,
  Slide,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  DeleteOutline,
  AttachMoneyOutlined,
  PublishOutlined,
  BlockOutlined,
  Inventory2Outlined,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectedEbayListing {
  sku: string;
  offerId?: string;
  title: string;
  price: { value: string; currency: string };
  quantity: number;
  status: string;
}

interface Policy {
  policyId: string;
  name: string;
  description?: string;
}

interface BulkOperationsBarProps {
  selectedCount: number;
  selectedListings: SelectedEbayListing[];
  userId: string;
  fulfillmentPolicies: Policy[];
  returnPolicies: Policy[];
  onCompleted: () => void;
}

type PriceMode = 'percent_increase' | 'percent_decrease' | 'fixed_add' | 'fixed_subtract';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BulkOperationsBar({
  selectedCount,
  selectedListings,
  userId,
  fulfillmentPolicies,
  returnPolicies,
  onCompleted,
}: BulkOperationsBarProps) {
  // Dialog states
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Progress
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Price dialog state
  const [priceMode, setPriceMode] = useState<PriceMode>('percent_increase');
  const [priceAmount, setPriceAmount] = useState('');

  // Stock dialog state
  const [newQuantity, setNewQuantity] = useState('');

  const visible = selectedCount > 0 && !processing;

  // Price preview calculation
  const pricePreview = useMemo(() => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) return [];
    return selectedListings
      .filter((l) => l.price)
      .slice(0, 10)
      .map((l) => {
        const current = parseFloat(l.price.value);
        let newPrice: number;
        switch (priceMode) {
          case 'percent_increase':
            newPrice = current * (1 + amt / 100);
            break;
          case 'percent_decrease':
            newPrice = current * (1 - amt / 100);
            break;
          case 'fixed_add':
            newPrice = current + amt;
            break;
          case 'fixed_subtract':
            newPrice = current - amt;
            break;
        }
        newPrice = Math.max(0, Math.round(newPrice * 100) / 100);
        return {
          title: l.title.length > 40 ? l.title.slice(0, 40) + '...' : l.title,
          currency: l.price.currency,
          current,
          newPrice,
        };
      });
  }, [selectedListings, priceMode, priceAmount]);

  // Execute bulk operation with progress tracking
  async function executeBulk<T>(
    items: T[],
    operation: (item: T) => Promise<Response>,
    actionLabel: string
  ) {
    setProcessing(true);
    setProgress(0);

    const results: PromiseSettledResult<Response>[] = [];
    for (let i = 0; i < items.length; i++) {
      const result = await Promise.allSettled([operation(items[i])]);
      results.push(result[0]);
      setProgress(((i + 1) / items.length) * 100);
      if (i < items.length - 1) await delay(100);
    }

    const succeeded = results.filter(
      (r) => r.status === 'fulfilled' && (r.value as Response).ok
    ).length;
    const failed = results.length - succeeded;

    if (failed === 0) {
      toast.success(`${actionLabel}: ${succeeded} listeleme başarıyla güncellendi`);
    } else {
      toast.error(`${actionLabel}: ${succeeded} başarılı, ${failed} başarısız`);
    }

    setProcessing(false);
    setProgress(0);
    onCompleted();
  }

  // --- Price Change ---
  const handlePriceSubmit = async () => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Geçerli bir tutar giriniz');
      return;
    }

    const listingsWithPrice = selectedListings.filter((l) => l.price && l.offerId);
    setPriceDialogOpen(false);

    await executeBulk(
      listingsWithPrice,
      (listing) => {
        const current = parseFloat(listing.price.value);
        let newPrice: number;
        switch (priceMode) {
          case 'percent_increase':
            newPrice = current * (1 + amt / 100);
            break;
          case 'percent_decrease':
            newPrice = current * (1 - amt / 100);
            break;
          case 'fixed_add':
            newPrice = current + amt;
            break;
          case 'fixed_subtract':
            newPrice = current - amt;
            break;
        }
        newPrice = Math.max(0.01, Math.round(newPrice * 100) / 100);

        return fetch(
          `/api/clawd/ebay?action=update_offer&offer_id=${listing.offerId}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              pricingSummary: {
                price: {
                  value: newPrice.toFixed(2),
                  currency: listing.price.currency,
                },
              },
            }),
          }
        );
      },
      'Fiyat güncelleme'
    );

    setPriceAmount('');
    setPriceMode('percent_increase');
  };

  // --- Stock Update ---
  const handleStockSubmit = async () => {
    const qty = parseInt(newQuantity, 10);
    if (isNaN(qty) || qty < 0) {
      toast.error('Geçerli bir stok miktarı giriniz');
      return;
    }

    setStockDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(listing.sku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              availability: {
                shipToLocationAvailability: { quantity: qty },
              },
            }),
          }
        );
      },
      'Stok güncelleme'
    );

    setNewQuantity('');
  };

  // --- Publish ---
  const handlePublish = async () => {
    const unpublished = selectedListings.filter(
      (l) => l.offerId && l.status !== 'PUBLISHED'
    );

    if (unpublished.length === 0) {
      toast.error('Yayınlanacak liste bulunamadı');
      return;
    }

    await executeBulk(
      unpublished,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=publish_offer&offer_id=${listing.offerId}&user_id=${userId}`,
          {
            method: 'POST',
          }
        );
      },
      'Yayınlama'
    );
  };

  // --- Withdraw ---
  const handleWithdraw = async () => {
    const published = selectedListings.filter(
      (l) => l.offerId && l.status === 'PUBLISHED'
    );

    if (published.length === 0) {
      toast.error('Geri çekilecek liste bulunamadı');
      return;
    }

    await executeBulk(
      published,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=withdraw_offer&offer_id=${listing.offerId}&user_id=${userId}`,
          {
            method: 'POST',
          }
        );
      },
      'Geri çekme'
    );
  };

  // --- Delete ---
  const handleDeleteSubmit = async () => {
    setDeleteDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(listing.sku)}&user_id=${userId}`,
          {
            method: 'DELETE',
          }
        );
      },
      'Silme'
    );
  };

  return (
    <>
      {/* Processing overlay */}
      {processing && (
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1400,
            p: 2,
          }}
        >
          <Typography variant="body2" sx={{ mb: 1 }}>
            İşlem devam ediyor...
          </Typography>
          <LinearProgress variant="determinate" value={progress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(progress)} tamamlandı
          </Typography>
        </Paper>
      )}

      {/* Main bar */}
      <Slide direction="up" in={visible} mountOnEnter unmountOnExit>
        <Paper
          elevation={8}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1300,
            px: 3,
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            borderTop: '2px solid',
            borderColor: 'primary.main',
          }}
        >
          <Typography variant="body2" fontWeight={600} sx={{ mr: 2 }}>
            {selectedCount} listeleme seçildi
          </Typography>

          <Button
            size="small"
            variant="outlined"
            startIcon={<AttachMoneyOutlined />}
            onClick={() => setPriceDialogOpen(true)}
          >
            Toplu Fiyat Değiştir
          </Button>

          <Button
            size="small"
            variant="outlined"
            startIcon={<Inventory2Outlined />}
            onClick={() => setStockDialogOpen(true)}
          >
            Toplu Stok Güncelle
          </Button>

          <Button
            size="small"
            variant="outlined"
            color="success"
            startIcon={<PublishOutlined />}
            onClick={handlePublish}
          >
            Yayınla
          </Button>

          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<BlockOutlined />}
            onClick={handleWithdraw}
          >
            Geri Çek
          </Button>

          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteOutline />}
            onClick={() => setDeleteDialogOpen(true)}
          >
            Toplu Sil
          </Button>
        </Paper>
      </Slide>

      {/* ---- Price Dialog ---- */}
      <Dialog
        open={priceDialogOpen}
        onClose={() => setPriceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Toplu Fiyat Değiştir</DialogTitle>
        <DialogContent>
          <RadioGroup
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
          >
            <FormControlLabel value="percent_increase" control={<Radio />} label="% Artır" />
            <FormControlLabel value="percent_decrease" control={<Radio />} label="% Azalt" />
            <FormControlLabel value="fixed_add" control={<Radio />} label="Sabit tutar ekle" />
            <FormControlLabel value="fixed_subtract" control={<Radio />} label="Sabit tutar çıkar" />
          </RadioGroup>

          <TextField
            label={priceMode.startsWith('percent') ? 'Yüzde (%)' : 'Tutar'}
            type="number"
            value={priceAmount}
            onChange={(e) => setPriceAmount(e.target.value)}
            fullWidth
            sx={{ mt: 2 }}
            inputProps={{ min: 0, step: 0.01 }}
          />

          {pricePreview.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                Önizleme (ilk {pricePreview.length} listeleme)
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Listeleme</TableCell>
                      <TableCell align="right">Mevcut Fiyat</TableCell>
                      <TableCell align="right">Yeni Fiyat</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {pricePreview.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>{p.title}</TableCell>
                        <TableCell align="right">
                          {p.current.toFixed(2)} {p.currency}
                        </TableCell>
                        <TableCell align="right">
                          {p.newPrice.toFixed(2)} {p.currency}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPriceDialogOpen(false)}>İptal</Button>
          <Button
            variant="contained"
            onClick={handlePriceSubmit}
            disabled={!priceAmount || parseFloat(priceAmount) <= 0}
          >
            Uygula
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Stock Dialog ---- */}
      <Dialog
        open={stockDialogOpen}
        onClose={() => setStockDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Toplu Stok Güncelle</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Seçilen {selectedCount} listelemenin stok miktarını güncelleyin.
          </Typography>
          <TextField
            label="Yeni Stok Miktarı"
            type="number"
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
            fullWidth
            inputProps={{ min: 0 }}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStockDialogOpen(false)}>İptal</Button>
          <Button
            variant="contained"
            onClick={handleStockSubmit}
            disabled={!newQuantity || parseInt(newQuantity) < 0}
          >
            Güncelle
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Delete Confirmation Dialog ---- */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Toplu Silme Onayı</DialogTitle>
        <DialogContent>
          <Typography>
            <strong>{selectedCount}</strong> listelemeyi silmek istediğinize emin
            misiniz? Bu işlem geri alınamaz.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>İptal</Button>
          <Button variant="contained" color="error" onClick={handleDeleteSubmit}>
            Sil
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
