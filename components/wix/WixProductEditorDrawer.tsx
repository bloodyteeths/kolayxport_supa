import React, { useState, useEffect, useCallback } from 'react';
import {
  Drawer, SwipeableDrawer, Box, Typography, IconButton, TextField, Button,
  CircularProgress, Switch, FormControlLabel, Chip, Autocomplete, Divider,
  Tooltip, Alert, Collapse,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import InventoryIcon from '@mui/icons-material/Inventory';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import AddIcon from '@mui/icons-material/Add';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WixCollection {
  id: string;
  name: string;
}

interface WixProductEditorDrawerProps {
  open: boolean;
  onClose: () => void;
  product: any | null;
  collections: WixCollection[];
  onSaved: () => void;
  onDeleted?: () => void;
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

function calculateHealth(p: any): { total: number; images: number; title: number; desc: number; collections: number } {
  const imgCount = p?.imageCount || (p?.images ? JSON.parse(typeof p.images === 'string' ? p.images : JSON.stringify(p.images || []))?.length || 0 : 0);
  const titleLen = (p?.title || '').length;
  const descLen = (p?.description || '').length;
  const colCount = Array.isArray(p?.collectionIds) ? p.collectionIds.length : 0;

  const images = Math.min(25, Math.round((Math.min(imgCount, 10) / 10) * 25));
  const title = Math.min(25, Math.round((Math.min(titleLen, 140) / 140) * 25));
  const desc = Math.min(25, Math.round((Math.min(descLen, 500) / 500) * 25));
  const collections = Math.min(25, Math.round((Math.min(colCount, 3) / 3) * 25));
  return { total: images + title + desc + collections, images, title, desc, collections };
}

function gradeColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 60) return '#ff9800';
  if (score >= 40) return '#f57c00';
  return '#f44336';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function WixProductEditorDrawer({
  open, onClose, product, collections, onSaved, onDeleted,
}: WixProductEditorDrawerProps) {
  const t = useTranslations('wixListings');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [discountPrice, setDiscountPrice] = useState('');
  const [sku, setSku] = useState('');
  const [weight, setWeight] = useState('');
  const [visible, setVisible] = useState(true);
  const [ribbon, setRibbon] = useState('');
  const [selectedCollections, setSelectedCollections] = useState<WixCollection[]>([]);
  const [stockQuantity, setStockQuantity] = useState('');
  const [customTextFields, setCustomTextFields] = useState<Array<{ title: string; mandatory: boolean; maxLength: number }>>([]);

  // UI state
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [savingStock, setSavingStock] = useState(false);
  const [imagesExpanded, setImagesExpanded] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load product data into form
  useEffect(() => {
    if (!product) return;
    setTitle(product.title || '');
    setDescription(product.description || '');
    setPrice(product.price != null ? String(product.price) : '');
    setDiscountPrice(product.discountPrice != null ? String(product.discountPrice) : '');
    setSku(product.sku || '');
    setWeight(product.weight != null ? String(product.weight) : '');
    setVisible(product.visible !== false);
    setRibbon(product.ribbon || '');
    setStockQuantity(product.quantity != null ? String(product.quantity) : '0');

    // Match collections
    const colIds: string[] = Array.isArray(product.collectionIds) ? product.collectionIds : [];
    const matched = collections.filter(c => colIds.includes(c.id));
    setSelectedCollections(matched);
    setCustomTextFields(Array.isArray(product.customTextFields) ? product.customTextFields : []);
    setHasChanges(false);
  }, [product, collections]);

  const markChanged = useCallback(() => setHasChanges(true), []);

  // Save product
  const handleSave = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const updates: any = {
        productId: product.wixProductId || product.id,
        name: title,
        description,
        visible,
        ribbon: ribbon || undefined,
      };
      if (price) updates.priceData = { price: parseFloat(price) };
      if (sku) updates.sku = sku;
      if (weight) updates.weight = parseFloat(weight);
      updates.customTextFields = customTextFields;

      const res = await fetch('/api/wix/products?action=update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error('Update failed');
      toast.success(t('updateSuccess'));
      setHasChanges(false);
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('updateFailed'));
    } finally {
      setSaving(false);
    }
  };

  // Save stock separately
  const handleSaveStock = async () => {
    if (!product) return;
    setSavingStock(true);
    try {
      const res = await fetch('/api/wix/products?action=inventory', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.wixProductId || product.id,
          quantity: parseInt(stockQuantity) || 0,
        }),
      });
      if (!res.ok) throw new Error('Inventory update failed');
      toast.success(t('updateSuccess'));
      onSaved();
    } catch (err: any) {
      toast.error(err.message || t('updateFailed'));
    } finally {
      setSavingStock(false);
    }
  };

  // Delete product
  const handleDelete = async () => {
    if (!product) return;
    setDeleting(true);
    try {
      const productId = product.wixProductId || product.id;
      const res = await fetch(`/api/wix/products?action=delete&productId=${productId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(t('deleteSuccess'));
      setDeleteConfirmOpen(false);
      onClose();
      onDeleted?.();
    } catch (err: any) {
      toast.error(err.message || t('deleteFailed'));
    } finally {
      setDeleting(false);
    }
  };

  if (!product) return null;

  const health = calculateHealth(product);
  const images: any[] = (() => {
    try {
      if (Array.isArray(product.images)) return product.images;
      if (typeof product.images === 'string') return JSON.parse(product.images);
      return [];
    } catch { return []; }
  })();

  const drawerContent = (
    <Box sx={{ width: isMobile ? '100vw' : 520, height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="h6" fontWeight={600} noWrap sx={{ flex: 1 }}>
          {t('editProduct')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <Tooltip title={t('saveChanges')}>
            <span>
              <IconButton onClick={handleSave} disabled={saving || !hasChanges} color="primary" size="small">
                {saving ? <CircularProgress size={18} /> : <SaveIcon />}
              </IconButton>
            </span>
          </Tooltip>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Box>
      </Box>

      {/* Scrollable content */}
      <Box sx={{ flex: 1, overflow: 'auto', px: 2, py: 2, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
        {/* Health Score */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Chip
            label={t('scoreLabel', { score: health.total })}
            size="small"
            sx={{ bgcolor: gradeColor(health.total), color: '#fff', fontWeight: 600 }}
          />
          <Typography variant="caption" color="text.secondary">
            {t('imagesCount', { count: images.length })} &middot; {t('titleChars', { count: title.length })}
          </Typography>
        </Box>

        {/* Title */}
        <TextField
          label={t('productTitle')}
          value={title}
          onChange={(e) => { setTitle(e.target.value); markChanged(); }}
          fullWidth
          size="small"
          helperText={`${title.length}/140`}
          inputProps={{ maxLength: 255 }}
        />

        {/* Description */}
        <TextField
          label={t('productDescription')}
          value={description}
          onChange={(e) => { setDescription(e.target.value); markChanged(); }}
          fullWidth
          multiline
          rows={4}
          size="small"
          helperText={`${description.length} chars`}
        />

        {/* Price + Discount */}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            label={t('productPrice')}
            value={price}
            onChange={(e) => { setPrice(e.target.value); markChanged(); }}
            type="number"
            size="small"
            sx={{ flex: 1 }}
            inputProps={{ min: 0, step: '0.01' }}
          />
          <TextField
            label={t('discountPrice')}
            value={discountPrice}
            onChange={(e) => { setDiscountPrice(e.target.value); markChanged(); }}
            type="number"
            size="small"
            sx={{ flex: 1 }}
            inputProps={{ min: 0, step: '0.01' }}
          />
        </Box>

        {/* SKU + Weight */}
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            label={t('productSku')}
            value={sku}
            onChange={(e) => { setSku(e.target.value); markChanged(); }}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            label={t('productWeight')}
            value={weight}
            onChange={(e) => { setWeight(e.target.value); markChanged(); }}
            type="number"
            size="small"
            sx={{ flex: 1 }}
            inputProps={{ min: 0, step: '0.01' }}
          />
        </Box>

        {/* Visibility */}
        <FormControlLabel
          control={<Switch checked={visible} onChange={(e) => { setVisible(e.target.checked); markChanged(); }} />}
          label={t('productVisibility')}
        />

        {/* Ribbon */}
        <TextField
          label={t('productRibbon')}
          value={ribbon}
          onChange={(e) => { setRibbon(e.target.value); markChanged(); }}
          fullWidth
          size="small"
          placeholder="e.g. Sale, New, Best Seller"
        />

        {/* Collections */}
        <Autocomplete
          multiple
          options={collections}
          getOptionLabel={(opt) => opt.name}
          value={selectedCollections}
          onChange={(_, val) => { setSelectedCollections(val); markChanged(); }}
          renderInput={(params) => <TextField {...params} label={t('productCollections')} size="small" />}
          renderTags={(value, getTagProps) =>
            value.map((option, index) => (
              <Chip {...getTagProps({ index })} key={option.id} label={option.name} size="small" />
            ))
          }
          size="small"
        />

        <Divider />

        {/* Personalization / Custom Text Fields */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <TextFieldsIcon fontSize="small" color="action" />
            <Typography variant="subtitle2" fontWeight={600}>{t('personalizationSection')}</Typography>
            {customTextFields.length > 0 && (
              <Chip label={customTextFields.length} size="small" color="primary" variant="outlined" />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
            {t('personalizationHelperText')}
          </Typography>
          {customTextFields.map((field, idx) => (
            <Box key={idx} sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
              <TextField
                label={t('personalizationFieldTitle')}
                value={field.title}
                onChange={(e) => {
                  const updated = [...customTextFields];
                  updated[idx] = { ...updated[idx], title: e.target.value };
                  setCustomTextFields(updated);
                  markChanged();
                }}
                size="small"
                sx={{ flex: 2 }}
              />
              <TextField
                label={t('personalizationMaxLength')}
                value={field.maxLength}
                onChange={(e) => {
                  const updated = [...customTextFields];
                  updated[idx] = { ...updated[idx], maxLength: Math.max(1, parseInt(e.target.value) || 1) };
                  setCustomTextFields(updated);
                  markChanged();
                }}
                type="number"
                size="small"
                sx={{ width: 90 }}
                inputProps={{ min: 1, max: 500 }}
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={field.mandatory}
                    onChange={(e) => {
                      const updated = [...customTextFields];
                      updated[idx] = { ...updated[idx], mandatory: e.target.checked };
                      setCustomTextFields(updated);
                      markChanged();
                    }}
                    size="small"
                  />
                }
                label={<Typography variant="caption">{t('personalizationMandatory')}</Typography>}
                sx={{ mx: 0 }}
              />
              <IconButton
                size="small"
                color="error"
                onClick={() => {
                  setCustomTextFields(customTextFields.filter((_, i) => i !== idx));
                  markChanged();
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Box>
          ))}
          {customTextFields.length < 2 && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => {
                setCustomTextFields([...customTextFields, { title: '', mandatory: false, maxLength: 200 }]);
                markChanged();
              }}
            >
              {t('personalizationAddField')}
            </Button>
          )}
          {customTextFields.length >= 2 && (
            <Typography variant="caption" color="text.secondary">
              {t('personalizationMaxFields', { max: 2 })}
            </Typography>
          )}
        </Box>

        <Divider />

        {/* Inventory Section */}
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <InventoryIcon fontSize="small" color="action" />
            <Typography variant="subtitle2" fontWeight={600}>{t('inventorySection')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
            <TextField
              label={t('stockQuantity')}
              value={stockQuantity}
              onChange={(e) => setStockQuantity(e.target.value)}
              type="number"
              size="small"
              sx={{ width: 140 }}
              inputProps={{ min: 0 }}
            />
            <Button
              size="small"
              variant="outlined"
              onClick={handleSaveStock}
              disabled={savingStock}
              startIcon={savingStock ? <CircularProgress size={14} /> : <SaveIcon />}
            >
              {t('save')}
            </Button>
          </Box>
        </Box>

        <Divider />

        {/* Images Section */}
        <Box>
          <Box
            sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', gap: 1, mb: 1 }}
            onClick={() => setImagesExpanded(!imagesExpanded)}
          >
            <Typography variant="subtitle2" fontWeight={600}>{t('productImages')}</Typography>
            <Chip label={images.length} size="small" variant="outlined" />
            <ExpandMoreIcon sx={{ transform: imagesExpanded ? 'rotate(180deg)' : 'none', transition: '0.2s', ml: 'auto' }} />
          </Box>
          <Collapse in={imagesExpanded}>
            {images.length === 0 ? (
              <Alert severity="warning" variant="outlined" sx={{ fontSize: '0.8rem' }}>
                {t('healthMissingImages')}
              </Alert>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {images.map((img: any, i: number) => {
                  const url = typeof img === 'string' ? img : img?.url || img?.src || img?.mediaUrl || '';
                  const thumbUrl = url.includes('wix:image')
                    ? `https://static.wixstatic.com/media/${url.replace('wix:image://v1/', '').split('/')[0]}`
                    : url;
                  return (
                    <Box key={i} sx={{ width: 72, height: 72, borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider' }}>
                      <img
                        src={thumbUrl || '/placeholder.png'}
                        alt={`Image ${i + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.png'; }}
                      />
                    </Box>
                  );
                })}
              </Box>
            )}
          </Collapse>
        </Box>

        <Divider />

        {/* Delete */}
        <Box sx={{ mt: 1 }}>
          {deleteConfirmOpen ? (
            <Alert
              severity="error"
              action={
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <Button size="small" onClick={() => setDeleteConfirmOpen(false)}>{t('cancel')}</Button>
                  <Button size="small" color="error" variant="contained" onClick={handleDelete} disabled={deleting}>
                    {deleting ? <CircularProgress size={14} /> : t('delete')}
                  </Button>
                </Box>
              }
            >
              {t('deleteProductConfirm', { title: product.title || '' })}
            </Alert>
          ) : (
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<DeleteIcon />}
              onClick={() => setDeleteConfirmOpen(true)}
              fullWidth
            >
              {t('deleteProductTitle')}
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );

  if (isMobile) {
    return (
      <SwipeableDrawer
        anchor="right"
        open={open}
        onClose={onClose}
        onOpen={() => {}}
        disableSwipeToOpen
      >
        {drawerContent}
      </SwipeableDrawer>
    );
  }

  return (
    <Drawer anchor="right" open={open} onClose={onClose}>
      {drawerContent}
    </Drawer>
  );
}
