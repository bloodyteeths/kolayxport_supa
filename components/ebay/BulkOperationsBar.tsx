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
  Select,
  MenuItem,
  FormControl,
  InputLabel,
} from '@mui/material';
import {
  DeleteOutline,
  AttachMoneyOutlined,
  PublishOutlined,
  BlockOutlined,
  Inventory2Outlined,
  CategoryOutlined,
  BuildOutlined,
  DescriptionOutlined,
  FileDownloadOutlined,
  ContentCopyOutlined,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SelectedEbayListing {
  sku: string;
  offerId?: string;
  listingId?: string;
  title: string;
  description: string;
  price: { value: string; currency: string };
  quantity: number;
  status: string;
  condition: string;
  categoryId?: string;
  imageUrl?: string;
  imageCount?: number;
  aspects?: Record<string, string[]>;
  format?: string;
  marketplaceId?: string;
  listingUrl?: string;
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
  const t = useTranslations('ebayListings');

  const CONDITION_OPTIONS: { value: string; label: string }[] = [
    { value: 'NEW', label: t('bulk.condNew') },
    { value: 'LIKE_NEW', label: t('bulk.condLikeNew') },
    { value: 'VERY_GOOD', label: t('bulk.condVeryGood') },
    { value: 'GOOD', label: t('bulk.condGood') },
    { value: 'ACCEPTABLE', label: t('bulk.condAcceptable') },
  ];

  // Dialog states - existing
  const [priceDialogOpen, setPriceDialogOpen] = useState(false);
  const [stockDialogOpen, setStockDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Dialog states - new
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const [conditionDialogOpen, setConditionDialogOpen] = useState(false);
  const [descriptionDialogOpen, setDescriptionDialogOpen] = useState(false);
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);

  // Progress
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);

  // Price dialog state
  const [priceMode, setPriceMode] = useState<PriceMode>('percent_increase');
  const [priceAmount, setPriceAmount] = useState('');

  // Stock dialog state
  const [newQuantity, setNewQuantity] = useState('');

  // Category dialog state
  const [newCategoryId, setNewCategoryId] = useState('');

  // Condition dialog state
  const [newCondition, setNewCondition] = useState('NEW');

  // Description append state
  const [appendText, setAppendText] = useState('');
  const [appendPosition, setAppendPosition] = useState<'end' | 'start'>('end');

  // Copy dialog state
  const [skuPrefix, setSkuPrefix] = useState('COPY-');

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
      toast.success(t('bulk.successAll', { action: actionLabel, count: succeeded }));
    } else {
      toast.error(t('bulk.successPartial', { action: actionLabel, succeeded, failed }));
    }

    setProcessing(false);
    setProgress(0);
    onCompleted();
  }

  // =======================================================================
  // 1. Price Change
  // =======================================================================
  const handlePriceSubmit = async () => {
    const amt = parseFloat(priceAmount);
    if (isNaN(amt) || amt <= 0) {
      toast.error(t('bulk.enterValidAmount'));
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
            headers: { 'Content-Type': 'application/json' },
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
      t('bulk.priceUpdate')
    );

    setPriceAmount('');
    setPriceMode('percent_increase');
  };

  // =======================================================================
  // 2. Stock Update
  // =======================================================================
  const handleStockSubmit = async () => {
    const qty = parseInt(newQuantity, 10);
    if (isNaN(qty) || qty < 0) {
      toast.error(t('bulk.enterValidStock'));
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
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              availability: {
                shipToLocationAvailability: { quantity: qty },
              },
            }),
          }
        );
      },
      t('bulk.stockUpdate')
    );

    setNewQuantity('');
  };

  // =======================================================================
  // 3. Publish
  // =======================================================================
  const handlePublish = async () => {
    const unpublished = selectedListings.filter(
      (l) => l.offerId && l.status !== 'PUBLISHED'
    );

    if (unpublished.length === 0) {
      toast.error(t('bulk.noListingsToPublish'));
      return;
    }

    await executeBulk(
      unpublished,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=publish_offer&offer_id=${listing.offerId}&user_id=${userId}`,
          { method: 'POST' }
        );
      },
      t('bulk.publishAction')
    );
  };

  // =======================================================================
  // 4. Withdraw
  // =======================================================================
  const handleWithdraw = async () => {
    const published = selectedListings.filter(
      (l) => l.offerId && l.status === 'PUBLISHED'
    );

    if (published.length === 0) {
      toast.error(t('bulk.noListingsToWithdraw'));
      return;
    }

    await executeBulk(
      published,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=withdraw_offer&offer_id=${listing.offerId}&user_id=${userId}`,
          { method: 'POST' }
        );
      },
      t('bulk.withdrawAction')
    );
  };

  // =======================================================================
  // 5. Delete
  // =======================================================================
  const handleDeleteSubmit = async () => {
    setDeleteDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=delete_inventory_item&sku=${encodeURIComponent(listing.sku)}&user_id=${userId}`,
          { method: 'DELETE' }
        );
      },
      t('bulk.deleteAction')
    );
  };

  // =======================================================================
  // 6. Bulk Category Change
  // =======================================================================
  const handleCategorySubmit = async () => {
    if (!newCategoryId.trim()) {
      toast.error(t('bulk.enterValidCategoryId'));
      return;
    }

    setCategoryDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(listing.sku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product: {
                aspects: listing.aspects || {},
              },
              categoryId: newCategoryId.trim(),
            }),
          }
        );
      },
      t('bulk.categoryUpdate')
    );

    setNewCategoryId('');
  };

  // =======================================================================
  // 7. Bulk Condition Update
  // =======================================================================
  const handleConditionSubmit = async () => {
    setConditionDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        return fetch(
          `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(listing.sku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              condition: newCondition,
            }),
          }
        );
      },
      t('bulk.conditionUpdate')
    );

    setNewCondition('NEW');
  };

  // =======================================================================
  // 8. Bulk Description Append
  // =======================================================================
  const handleDescriptionAppendSubmit = async () => {
    if (!appendText.trim()) {
      toast.error(t('bulk.enterTextToAppend'));
      return;
    }

    setDescriptionDialogOpen(false);

    await executeBulk(
      selectedListings,
      (listing) => {
        const currentDesc = listing.description || '';
        const newDesc = appendPosition === 'end'
          ? currentDesc + '\n' + appendText
          : appendText + '\n' + currentDesc;

        return fetch(
          `/api/clawd/ebay?action=update_inventory_item&sku=${encodeURIComponent(listing.sku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              product: {
                description: newDesc,
              },
            }),
          }
        );
      },
      t('bulk.descriptionUpdate')
    );

    setAppendText('');
    setAppendPosition('end');
  };

  // =======================================================================
  // 9. Export Selected as CSV
  // =======================================================================
  const handleExportSelected = () => {
    if (selectedListings.length === 0) {
      toast.error(t('bulk.noListingsToExport'));
      return;
    }

    const rows = selectedListings.map((l) => ({
      sku: l.sku,
      title: l.title,
      description: (l.description || '').substring(0, 200),
      price: parseFloat(l.price?.value || '0').toFixed(2),
      currency: l.price?.currency || '',
      quantity: l.quantity,
      condition: l.condition,
      status: l.status,
      listing_url: l.listingUrl || '',
    }));

    const headers = Object.keys(rows[0] || {}).join(',');
    const csv = [
      headers,
      ...rows.map((r) =>
        Object.values(r)
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(',')
      ),
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ebay-selected-${selectedCount}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast.success(t('bulk.exportedCsv', { count: selectedCount }));
  };

  // =======================================================================
  // 10. Copy (Duplicate) Listings
  // =======================================================================
  const handleCopySubmit = async () => {
    if (!skuPrefix.trim()) {
      toast.error(t('bulk.enterSkuPrefix'));
      return;
    }

    setCopyDialogOpen(false);

    await executeBulk(
      selectedListings,
      async (listing) => {
        const newSku = `${skuPrefix}${listing.sku}`;

        // Step 1: Create inventory item copy
        const itemBody: Record<string, any> = {
          product: {
            title: listing.title,
            description: listing.description || '',
            aspects: listing.aspects || {},
          },
          condition: listing.condition || 'NEW',
          availability: {
            shipToLocationAvailability: {
              quantity: listing.quantity || 0,
            },
          },
        };

        const itemRes = await fetch(
          `/api/clawd/ebay?action=create_inventory_item&sku=${encodeURIComponent(newSku)}&user_id=${userId}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(itemBody),
          }
        );

        if (!itemRes.ok) return itemRes;

        // Step 2: Create offer for the copy
        if (listing.price && listing.offerId) {
          const offerBody: Record<string, any> = {
            sku: newSku,
            marketplaceId: listing.marketplaceId || 'EBAY_US',
            format: listing.format || 'FIXED_PRICE',
            pricingSummary: {
              price: {
                value: listing.price.value,
                currency: listing.price.currency,
              },
            },
          };

          return fetch(
            `/api/clawd/ebay?action=create_offer&user_id=${userId}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(offerBody),
            }
          );
        }

        return itemRes;
      },
      t('bulk.copyAction')
    );

    setSkuPrefix('COPY-');
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
            {t('bulk.processing')}
          </Typography>
          <LinearProgress variant="determinate" value={progress} />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('bulk.progressCompleted', { progress: Math.round(progress) })}
          </Typography>
        </Paper>
      )}

      {/* Main bar */}
      <Slide direction="up" in={visible} mountOnEnter unmountOnExit>
        <Paper
          elevation={0}
          sx={{
            position: 'fixed',
            bottom: 0,
            left: 0,
            right: 0,
            zIndex: 1300,
            px: { xs: 1.5, sm: 3 },
            py: 1.5,
            display: 'flex',
            alignItems: 'center',
            gap: { xs: 0.5, sm: 1 },
            flexWrap: 'wrap',
            borderTop: '1px solid rgba(226,232,240,0.8)',
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            boxShadow: '0 -4px 20px rgba(0,0,0,0.08)',
          }}
        >
          <Typography variant="body2" fontWeight={600} sx={{ mr: { xs: 0.5, sm: 2 } }}>
            {t('bulk.selectedCount', { count: selectedCount })}
          </Typography>

          {/* 1. Price Change */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<AttachMoneyOutlined />}
            onClick={() => setPriceDialogOpen(true)}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.bulkPrice')}
          </Button>

          {/* 2. Stock Update */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<Inventory2Outlined />}
            onClick={() => setStockDialogOpen(true)}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.bulkStock')}
          </Button>

          {/* 3. Publish */}
          <Button
            size="small"
            variant="outlined"
            color="success"
            startIcon={<PublishOutlined />}
            onClick={handlePublish}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.publish')}
          </Button>

          {/* 4. Withdraw */}
          <Button
            size="small"
            variant="outlined"
            color="warning"
            startIcon={<BlockOutlined />}
            onClick={handleWithdraw}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.withdraw')}
          </Button>

          {/* 5. Delete */}
          <Button
            size="small"
            variant="outlined"
            color="error"
            startIcon={<DeleteOutline />}
            onClick={() => setDeleteDialogOpen(true)}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.bulkDelete')}
          </Button>

          {/* 6. Category Change */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<CategoryOutlined />}
            onClick={() => setCategoryDialogOpen(true)}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.category')}
          </Button>

          {/* 7. Condition Update */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<BuildOutlined />}
            onClick={() => setConditionDialogOpen(true)}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.condition')}
          </Button>

          {/* 8. Description Append */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<DescriptionOutlined />}
            onClick={() => setDescriptionDialogOpen(true)}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.appendDescription')}
          </Button>

          {/* 9. Export Selected */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<FileDownloadOutlined />}
            onClick={handleExportSelected}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.export')}
          </Button>

          {/* 10. Copy Listings */}
          <Button
            size="small"
            variant="outlined"
            startIcon={<ContentCopyOutlined />}
            onClick={() => setCopyDialogOpen(true)}
            sx={{ fontSize: { xs: 11, sm: 13 } }}
          >
            {t('bulk.copy')}
          </Button>
        </Paper>
      </Slide>

      {/* ================================================================ */}
      {/* 1. Price Dialog                                                  */}
      {/* ================================================================ */}
      <Dialog
        open={priceDialogOpen}
        onClose={() => setPriceDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('bulk.priceDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('bulk.priceDialogDesc', { count: selectedCount })}
          </Typography>
          <RadioGroup
            value={priceMode}
            onChange={(e) => setPriceMode(e.target.value as PriceMode)}
          >
            <FormControlLabel value="percent_increase" control={<Radio />} label={t('bulk.percentIncrease')} />
            <FormControlLabel value="percent_decrease" control={<Radio />} label={t('bulk.percentDecrease')} />
            <FormControlLabel value="fixed_add" control={<Radio />} label={t('bulk.fixedAdd')} />
            <FormControlLabel value="fixed_subtract" control={<Radio />} label={t('bulk.fixedSubtract')} />
          </RadioGroup>

          <TextField
            label={priceMode.startsWith('percent') ? t('bulk.percentLabel') : t('bulk.amountLabel')}
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
                {t('bulk.previewFirst', { count: pricePreview.length })}
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('bulk.listingCol')}</TableCell>
                      <TableCell align="right">{t('bulk.currentPrice')}</TableCell>
                      <TableCell align="right">{t('bulk.newPrice')}</TableCell>
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
          <Button onClick={() => setPriceDialogOpen(false)}>{t('bulk.cancelBtn')}</Button>
          <Button
            variant="contained"
            onClick={handlePriceSubmit}
            disabled={!priceAmount || parseFloat(priceAmount) <= 0}
          >
            {t('bulk.applyBtn')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* 2. Stock Dialog                                                  */}
      {/* ================================================================ */}
      <Dialog
        open={stockDialogOpen}
        onClose={() => setStockDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('bulk.stockDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('bulk.stockDialogDesc', { count: selectedCount })}
          </Typography>
          <TextField
            label={t('bulk.newStockQuantity')}
            type="number"
            value={newQuantity}
            onChange={(e) => setNewQuantity(e.target.value)}
            fullWidth
            inputProps={{ min: 0 }}
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStockDialogOpen(false)}>{t('bulk.cancelBtn')}</Button>
          <Button
            variant="contained"
            onClick={handleStockSubmit}
            disabled={!newQuantity || parseInt(newQuantity) < 0}
          >
            {t('bulk.updateBtn')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* 5. Delete Confirmation Dialog                                    */}
      {/* ================================================================ */}
      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('bulk.deleteDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('bulk.deleteDialogDesc', { count: selectedCount })}
          </Typography>
          {selectedListings.length <= 10 && (
            <Box sx={{ mt: 2 }}>
              {selectedListings.map((l, i) => (
                <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  - {l.title.length > 50 ? l.title.slice(0, 50) + '...' : l.title} ({l.sku})
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('bulk.cancelBtn')}</Button>
          <Button variant="contained" color="error" onClick={handleDeleteSubmit}>
            {t('bulk.deleteListingsBtn', { count: selectedCount })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* 6. Category Change Dialog                                        */}
      {/* ================================================================ */}
      <Dialog
        open={categoryDialogOpen}
        onClose={() => setCategoryDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('bulk.categoryDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('bulk.categoryDialogDesc', { count: selectedCount })}
          </Typography>
          <TextField
            label={t('bulk.newCategoryId')}
            value={newCategoryId}
            onChange={(e) => setNewCategoryId(e.target.value)}
            fullWidth
            autoFocus
            placeholder={t('bulk.categoryPlaceholder')}
            helperText={t('bulk.categoryHelperText')}
          />
          {selectedListings.length <= 5 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('bulk.affectedListings')}
              </Typography>
              {selectedListings.map((l, i) => (
                <Typography key={i} variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                  - {l.title.length > 50 ? l.title.slice(0, 50) + '...' : l.title}
                </Typography>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCategoryDialogOpen(false)}>{t('bulk.cancelBtn')}</Button>
          <Button
            variant="contained"
            onClick={handleCategorySubmit}
            disabled={!newCategoryId.trim()}
          >
            {t('bulk.updateCategoryBtn')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* 7. Condition Update Dialog                                       */}
      {/* ================================================================ */}
      <Dialog
        open={conditionDialogOpen}
        onClose={() => setConditionDialogOpen(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('bulk.conditionDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('bulk.conditionDialogDesc', { count: selectedCount })}
          </Typography>
          <FormControl fullWidth>
            <InputLabel>{t('bulk.newConditionLabel')}</InputLabel>
            <Select
              value={newCondition}
              onChange={(e) => setNewCondition(e.target.value)}
              label={t('bulk.newConditionLabel')}
            >
              {CONDITION_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConditionDialogOpen(false)}>{t('bulk.cancelBtn')}</Button>
          <Button variant="contained" onClick={handleConditionSubmit}>
            {t('bulk.updateConditionBtn')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* 8. Description Append Dialog                                     */}
      {/* ================================================================ */}
      <Dialog
        open={descriptionDialogOpen}
        onClose={() => setDescriptionDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('bulk.descDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('bulk.descDialogDesc', { count: selectedCount })}
          </Typography>

          <RadioGroup
            value={appendPosition}
            onChange={(e) => setAppendPosition(e.target.value as 'end' | 'start')}
            row
          >
            <FormControlLabel value="end" control={<Radio />} label={t('bulk.appendEnd')} />
            <FormControlLabel value="start" control={<Radio />} label={t('bulk.appendStart')} />
          </RadioGroup>

          <TextField
            label={t('bulk.textToAppend')}
            value={appendText}
            onChange={(e) => setAppendText(e.target.value)}
            fullWidth
            multiline
            rows={4}
            sx={{ mt: 1 }}
            placeholder={t('bulk.textPlaceholder')}
          />

          {appendText.trim() && selectedListings.length > 0 && (
            <Box sx={{ mt: 2, p: 1.5, bgcolor: 'action.hover', borderRadius: 1 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>{t('bulk.preview')}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
                {appendPosition === 'end' ? (
                  <>
                    {(selectedListings[0].description || '').substring(0, 80)}...
                    <Box component="span" sx={{ color: 'success.main', fontWeight: 600 }}>
                      {'\n' + appendText.substring(0, 80)}{appendText.length > 80 ? '...' : ''}
                    </Box>
                  </>
                ) : (
                  <>
                    <Box component="span" sx={{ color: 'success.main', fontWeight: 600 }}>
                      {appendText.substring(0, 80)}{appendText.length > 80 ? '...' : ''}{'\n'}
                    </Box>
                    {(selectedListings[0].description || '').substring(0, 80)}...
                  </>
                )}
              </Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDescriptionDialogOpen(false)}>{t('bulk.cancelBtn')}</Button>
          <Button
            variant="contained"
            onClick={handleDescriptionAppendSubmit}
            disabled={!appendText.trim()}
          >
            {t('bulk.appendDescBtn')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ================================================================ */}
      {/* 10. Copy Listings Dialog                                         */}
      {/* ================================================================ */}
      <Dialog
        open={copyDialogOpen}
        onClose={() => setCopyDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t('bulk.copyDialogTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t('bulk.copyDialogDesc', { count: selectedCount })}
          </Typography>
          <TextField
            label={t('bulk.skuPrefix')}
            value={skuPrefix}
            onChange={(e) => setSkuPrefix(e.target.value)}
            fullWidth
            autoFocus
            helperText={t('bulk.skuExample', { example: `${skuPrefix}${selectedListings[0]?.sku || 'EXAMPLE-SKU'}` })}
          />

          {selectedListings.length <= 10 && (
            <Box sx={{ mt: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {t('bulk.copiesToCreate')}
              </Typography>
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t('bulk.currentSku')}</TableCell>
                      <TableCell>{t('bulk.newSku')}</TableCell>
                      <TableCell>{t('bulk.titleCol')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {selectedListings.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>{l.sku}</TableCell>
                        <TableCell sx={{ color: 'primary.main', fontWeight: 600 }}>
                          {skuPrefix}{l.sku}
                        </TableCell>
                        <TableCell sx={{ maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {l.title}
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
          <Button onClick={() => setCopyDialogOpen(false)}>{t('bulk.cancelBtn')}</Button>
          <Button
            variant="contained"
            onClick={handleCopySubmit}
            disabled={!skuPrefix.trim()}
          >
            {t('bulk.copyListingsBtn', { count: selectedCount })}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
