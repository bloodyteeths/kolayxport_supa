import React, { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button,
  Switch, FormControlLabel, Autocomplete, Chip, Box, CircularProgress,
  Typography, IconButton, Collapse, Divider,
} from '@mui/material';
import TextFieldsIcon from '@mui/icons-material/TextFields';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

interface WixCollection {
  id: string;
  name: string;
}

interface WixProductCreatorDialogProps {
  open: boolean;
  onClose: () => void;
  collections: WixCollection[];
  onCreated: () => void;
}

export default function WixProductCreatorDialog({
  open, onClose, collections, onCreated,
}: WixProductCreatorDialogProps) {
  const t = useTranslations('wixListings');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [discountPrice, setDiscountPrice] = useState('');
  const [sku, setSku] = useState('');
  const [weight, setWeight] = useState('');
  const [visible, setVisible] = useState(true);
  const [selectedCollections, setSelectedCollections] = useState<WixCollection[]>([]);
  const [customTextFields, setCustomTextFields] = useState<Array<{ title: string; mandatory: boolean; maxLength: number }>>([]);
  const [personalizationExpanded, setPersonalizationExpanded] = useState(false);
  const [creating, setCreating] = useState(false);

  const resetForm = () => {
    setName('');
    setDescription('');
    setPrice('');
    setDiscountPrice('');
    setSku('');
    setWeight('');
    setVisible(true);
    setSelectedCollections([]);
    setCustomTextFields([]);
    setPersonalizationExpanded(false);
  };

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const body: any = {
        name: name.trim(),
        visible,
      };
      if (description) body.description = description;
      if (price) body.priceData = { price: parseFloat(price) };
      if (sku) body.sku = sku;
      if (weight) body.weight = parseFloat(weight);
      if (customTextFields.length > 0) body.customTextFields = customTextFields;

      const res = await fetch('/api/wix/products?action=create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error('Create failed');
      toast.success(t('createSuccess'));
      resetForm();
      onClose();
      onCreated();
    } catch (err: any) {
      toast.error(err.message || t('createFailed'));
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('createProduct')}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '16px !important' }}>
        <TextField
          label={t('productTitle')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          fullWidth
          required
          size="small"
          autoFocus
          helperText={`${name.length}/140`}
        />
        <TextField
          label={t('productDescription')}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          fullWidth
          multiline
          rows={3}
          size="small"
        />
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            label={t('productPrice')}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            type="number"
            size="small"
            sx={{ flex: 1 }}
            inputProps={{ min: 0, step: '0.01' }}
          />
          <TextField
            label={t('discountPrice')}
            value={discountPrice}
            onChange={(e) => setDiscountPrice(e.target.value)}
            type="number"
            size="small"
            sx={{ flex: 1 }}
            inputProps={{ min: 0, step: '0.01' }}
          />
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <TextField
            label={t('productSku')}
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            size="small"
            sx={{ flex: 1 }}
          />
          <TextField
            label={t('productWeight')}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            type="number"
            size="small"
            sx={{ flex: 1 }}
            inputProps={{ min: 0, step: '0.01' }}
          />
        </Box>
        <FormControlLabel
          control={<Switch checked={visible} onChange={(e) => setVisible(e.target.checked)} />}
          label={t('productVisibility')}
        />
        {collections.length > 0 && (
          <Autocomplete
            multiple
            options={collections}
            getOptionLabel={(opt) => opt.name}
            value={selectedCollections}
            onChange={(_, val) => setSelectedCollections(val)}
            renderInput={(params) => <TextField {...params} label={t('productCollections')} size="small" />}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip {...getTagProps({ index })} key={option.id} label={option.name} size="small" />
              ))
            }
            size="small"
          />
        )}

        {/* Personalization */}
        <Divider />
        <Box>
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer' }}
            onClick={() => setPersonalizationExpanded(!personalizationExpanded)}
          >
            <TextFieldsIcon fontSize="small" color="action" />
            <Typography variant="subtitle2" fontWeight={600}>{t('personalizationSection')}</Typography>
            {customTextFields.length > 0 && (
              <Chip label={customTextFields.length} size="small" color="primary" variant="outlined" />
            )}
            <ExpandMoreIcon sx={{ transform: personalizationExpanded ? 'rotate(180deg)' : 'none', transition: '0.2s', ml: 'auto' }} />
          </Box>
          <Collapse in={personalizationExpanded}>
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
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
                    onClick={() => setCustomTextFields(customTextFields.filter((_, i) => i !== idx))}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              {customTextFields.length < 2 ? (
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<AddIcon />}
                  onClick={() => setCustomTextFields([...customTextFields, { title: '', mandatory: false, maxLength: 200 }])}
                >
                  {t('personalizationAddField')}
                </Button>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {t('personalizationMaxFields', { max: 2 })}
                </Typography>
              )}
            </Box>
          </Collapse>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          variant="contained"
          onClick={handleCreate}
          disabled={!name.trim() || creating}
          startIcon={creating ? <CircularProgress size={14} /> : undefined}
        >
          {t('createProduct')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
