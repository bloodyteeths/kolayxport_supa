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
  Chip,
  Select,
  MenuItem,
  LinearProgress,
  Typography,
  Box,
  Slide,
  InputLabel,
  FormControl,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import {
  DeleteOutline,
  LocalOfferOutlined,
  AttachMoneyOutlined,
  DriveFileMoveOutlined,
  PublishOutlined,
  RemoveCircleOutline,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

interface ListingPrice {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface SelectedListing {
  listing_id: number;
  title: string;
  price: ListingPrice | null;
  tags: string[];
  state: string;
  shop_section_id: number | null;
}

interface ShopSection {
  shop_section_id: number;
  title: string;
}

interface BulkOperationsBarProps {
  selectedCount: number;
  selectedListings: SelectedListing[];
  shopSections: ShopSection[];
  shopId: string;
  onCompleted: () => void;
}

type PriceMode = 'percent_increase' | 'percent_decrease' | 'fixed_add' | 'fixed_subtract';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function callUpdateListing(
  shopId: string,
  listingId: number,
  body: Record<string, any>
): Promise<Response> {
  return fetch(
    `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${shopId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );
}

async function callDeleteListing(
  shopId: string,
  listingId: number
): Promise<Response> {
  return fetch(
    `/api/clawd/etsy?action=delete_listing&listing_id=${listingId}&shop_id=${shopId}`,
    {
      method: 'DELETE',
    }
  );
}

export default function BulkOperationsBar({
  selectedCount,
  selectedListings,
  shopSections,
  shopId,
  onCompleted,
}: BulkOperationsBarProps) {
  // Dialog states
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [addTagDialogOpen, setAddTagDialogOpen] = useState(false);
  const [removeTagDialogOpen, setRemoveTagDialogOpen] = useState(false);
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Progress
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Price dialog state
  const [priceMode, setPriceMode] = useState<PriceMode>('percent_increase');
  const [priceAmount, setPriceAmount] = useState('');

  // Tag dialog state
  const [newTags, setNewTags] = useState('');
  const [tagsToRemove, setTagsToRemove] = useState<Set<string>>(new Set());

  // Section dialog state
  const [targetSectionId, setTargetSectionId] = useState<number | ''>('');

  const visible = selectedCount > 0 && !processing;

  // Collect all unique tags from selected listings
  const allUniqueTags = useMemo(() => {
    const tagSet = new Set<string>();
    selectedListings.forEach((l) => l.tags.forEach((t) => tagSet.add(t)));
    return Array.from(tagSet).sort();
  }, [selectedListings]);

  // Price preview calculation
  const pricePreview = useMemo(() => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) return [];
    return selectedListings
      .filter((l) => l.price)
      .slice(0, 10)
      .map((l) => {
        const current = l.price!.amount / l.price!.divisor;
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
          currency: l.price!.currency_code,
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

    const succeeded = results.filter((r) => r.status === 'fulfilled' && (r.value as Response).ok).length;
    const failed = results.length - succeeded;

    if (failed === 0) {
      toast.success(`${actionLabel}: ${succeeded} listeleme basariyla guncellendi`);
    } else {
      toast.error(`${actionLabel}: ${succeeded} basarili, ${failed} basarisiz`);
    }

    setProcessing(false);
    setProgress(0);
    onCompleted();
  }

  // --- Price Change ---
  const handlePriceSubmit = async () => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Gecerli bir tutar giriniz');
      return;
    }

    const listingsWithPrice = selectedListings.filter((l) => l.price);
    setPriceDialogOpen(false);

    await executeBulk(
      listingsWithPrice,
      (listing) => {
        const current = listing.price!.amount / listing.price!.divisor;
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
        return callUpdateListing(shopId, listing.listing_id, { price: newPrice });
      },
      'Fiyat guncelleme'
    );

    setPriceAmount('');
    setPriceMode('percent_increase');
  };

  // --- Add Tags ---
  const handleAddTagsSubmit = async () => {
    const tagsToAdd = newTags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (tagsToAdd.length === 0) {
      toast.error('En az bir etiket giriniz');
      return;
    }

    // Validate max 13 tags
    const violations = selectedListings.filter(
      (l) => l.tags.length + tagsToAdd.length > 13
    );
    if (violations.length > 0) {
      toast.error(
        `${violations.length} listelemede etiket siniri (maks 13) asilacak. Daha az etiket ekleyin.`
      );
      return;
    }

    setAddTagDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        const mergedTags = Array.from(new Set([...listing.tags, ...tagsToAdd])).slice(0, 13);
        return callUpdateListing(shopId, listing.listing_id, { tags: mergedTags });
      },
      'Etiket ekleme'
    );

    setNewTags('');
  };

  // --- Remove Tags ---
  const handleRemoveTagsSubmit = async () => {
    if (tagsToRemove.size === 0) {
      toast.error('Kaldirilacak en az bir etiket seciniz');
      return;
    }

    setRemoveTagDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        const filtered = listing.tags.filter((t) => !tagsToRemove.has(t));
        return callUpdateListing(shopId, listing.listing_id, { tags: filtered });
      },
      'Etiket kaldirma'
    );

    setTagsToRemove(new Set());
  };

  // --- Move Section ---
  const handleSectionSubmit = async () => {
    if (targetSectionId === '') {
      toast.error('Hedef bolum seciniz');
      return;
    }

    setSectionDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) =>
        callUpdateListing(shopId, listing.listing_id, {
          shop_section_id: targetSectionId,
        }),
      'Bolum tasima'
    );

    setTargetSectionId('');
  };

  // --- Delete ---
  const handleDeleteSubmit = async () => {
    setDeleteDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => callDeleteListing(shopId, listing.listing_id),
      'Silme'
    );
  };

  // --- Publish / Deactivate ---
  const handleToggleState = async (targetState: 'active' | 'inactive') => {
    const label = targetState === 'active' ? 'Yayinlama' : 'Deaktif etme';

    await executeBulk(
      selectedListings,
      (listing) =>
        callUpdateListing(shopId, listing.listing_id, { state: targetState }),
      label
    );
  };

  const toggleTagToRemove = (tag: string) => {
    setTagsToRemove((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) {
        next.delete(tag);
      } else {
        next.add(tag);
      }
      return next;
    });
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
            Islem devam ediyor...
          </Typography>
          <LinearProgress variant="determinate" value={progress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            %{Math.round(progress)} tamamlandi
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
            {selectedCount} listeleme secildi
          </Typography>

          <Button
            size="small"
            variant="outlined"
            startIcon={<AttachMoneyOutlined />}
            onClick={() => setPriceDialogOpen(true)}
          >
            Toplu Fiyat Degistir
          </Button>

          <Button
            size="small"
            variant="outlined"
            startIcon={<LocalOfferOutlined />}
            onClick={() => setAddTagDialogOpen(true)}
          >
            Etiket Ekle
          </Button>

          <Button
            size="small"
            variant="outlined"
            startIcon={<RemoveCircleOutline />}
            onClick={() => {
              setTagsToRemove(new Set());
              setRemoveTagDialogOpen(true);
            }}
          >
            Etiket Cikar
          </Button>

          <Button
            size="small"
            variant="outlined"
            startIcon={<DriveFileMoveOutlined />}
            onClick={() => setSectionDialogOpen(true)}
          >
            Bolum Tasi
          </Button>

          <Button
            size="small"
            variant="outlined"
            color="success"
            startIcon={<PublishOutlined />}
            onClick={() => handleToggleState('active')}
          >
            Yayinla
          </Button>

          <Button
            size="small"
            variant="outlined"
            color="warning"
            onClick={() => handleToggleState('inactive')}
          >
            Deaktif Et
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
        <DialogTitle>Toplu Fiyat Degistir</DialogTitle>
        <DialogContent>
          <RadioGroup
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
          >
            <FormControlLabel
              value="percent_increase"
              control={<Radio />}
              label="% Artir"
            />
            <FormControlLabel
              value="percent_decrease"
              control={<Radio />}
              label="% Azalt"
            />
            <FormControlLabel
              value="fixed_add"
              control={<Radio />}
              label="Sabit tutar ekle"
            />
            <FormControlLabel
              value="fixed_subtract"
              control={<Radio />}
              label="Sabit tutar cikar"
            />
          </RadioGroup>

          <TextField
            label={
              priceMode.startsWith('percent') ? 'Yuzde (%)' : 'Tutar'
            }
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
                Onizleme (ilk {pricePreview.length} listeleme)
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
          <Button onClick={() => setPriceDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            onClick={handlePriceSubmit}
            disabled={!priceAmount || parseFloat(priceAmount) <= 0}
          >
            Uygula
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Add Tag Dialog ---- */}
      <Dialog
        open={addTagDialogOpen}
        onClose={() => setAddTagDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Toplu Etiket Ekle</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Virgul ile ayirarak birden fazla etiket ekleyebilirsiniz. Her
            listelemede en fazla 13 etiket olabilir.
          </Typography>
          <TextField
            label="Etiketler"
            placeholder="etiket1, etiket2, etiket3"
            value={newTags}
            onChange={(e) => setNewTags(e.target.value)}
            fullWidth
            helperText={`${
              newTags
                .split(',')
                .map((t) => t.trim())
                .filter((t) => t).length
            } etiket girildi`}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddTagDialogOpen(false)}>Iptal</Button>
          <Button variant="contained" onClick={handleAddTagsSubmit}>
            Ekle
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Remove Tag Dialog ---- */}
      <Dialog
        open={removeTagDialogOpen}
        onClose={() => setRemoveTagDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Toplu Etiket Cikar</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Kaldirmak istediginiz etiketlere tiklayin.
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {allUniqueTags.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Secilen listelemelerde etiket bulunamadi.
              </Typography>
            ) : (
              allUniqueTags.map((tag) => (
                <Chip
                  key={tag}
                  label={tag}
                  onClick={() => toggleTagToRemove(tag)}
                  color={tagsToRemove.has(tag) ? 'error' : 'default'}
                  variant={tagsToRemove.has(tag) ? 'filled' : 'outlined'}
                />
              ))
            )}
          </Box>
          {tagsToRemove.size > 0 && (
            <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
              {tagsToRemove.size} etiket kaldirilacak
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTagDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleRemoveTagsSubmit}
            disabled={tagsToRemove.size === 0}
          >
            Kaldir
          </Button>
        </DialogActions>
      </Dialog>

      {/* ---- Section Move Dialog ---- */}
      <Dialog
        open={sectionDialogOpen}
        onClose={() => setSectionDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Bolum Tasi</DialogTitle>
        <DialogContent>
          <FormControl fullWidth sx={{ mt: 1 }}>
            <InputLabel>Hedef Bolum</InputLabel>
            <Select
              value={targetSectionId}
              label="Hedef Bolum"
              onChange={(e) => setTargetSectionId(Number(e.target.value))}
            >
              {shopSections.map((section) => (
                <MenuItem key={section.shop_section_id} value={section.shop_section_id}>
                  {section.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSectionDialogOpen(false)}>Iptal</Button>
          <Button
            variant="contained"
            onClick={handleSectionSubmit}
            disabled={targetSectionId === ''}
          >
            Tasi
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
        <DialogTitle>Toplu Silme Onayi</DialogTitle>
        <DialogContent>
          <Typography>
            <strong>{selectedCount}</strong> listelemeyi silmek istediginize emin
            misiniz? Bu islem geri alinamaz.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Iptal</Button>
          <Button variant="contained" color="error" onClick={handleDeleteSubmit}>
            Sil
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
