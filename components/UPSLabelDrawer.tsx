import React, { useState } from 'react';
import { Drawer, Box, Typography, IconButton, TextField, Select, MenuItem, FormControl, InputLabel, Button, Alert, Chip } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import { UPS_SERVICE_TYPES, UPS_PACKAGE_TYPES, UPS_SIGNATURE_OPTIONS } from '@/constants/ups';

interface UIOrder {
  orderId: string;
  orderNumber: string;
  recipientFirstName?: string;
  recipientLastName?: string;
  recipientStreet1?: string;
  recipientStreet2?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientPostal?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  orderTotalPrice?: number;
  currency?: string;
  title?: string;
  weight?: number;
  hsCode?: string;
  countryOfOrigin?: string;
}

interface UPSLabelDrawerProps {
  open: boolean;
  onClose: () => void;
  order: UIOrder | null;
  onSaved: () => void;
}

const DEFAULTS = {
  serviceType: 'UPS_SAVER',
  packageType: 'UPS_PAK',
  signatureOption: 'NO_SIGNATURE',
  weight: 0.5,
};

export default function UPSLabelDrawer({ open, onClose, order, onSaved }: UPSLabelDrawerProps) {
  type UPSFormState = {
    recipientFirstName: string;
    recipientLastName: string;
    recipientStreet1: string;
    recipientStreet2: string;
    recipientCity: string;
    recipientState: string;
    recipientPostal: string;
    recipientCountry: string;
    recipientPhone: string;
    hsCode: string;
    countryOfOrigin: string;
    weight: number;
    serviceType: string;
    packageType: string;
    signatureOption: string;
    packageLength?: string;
    packageWidth?: string;
    packageHeight?: string;
  };
  const [form, setForm] = useState<UPSFormState>({
    recipientFirstName: order?.recipientFirstName || '',
    recipientLastName: order?.recipientLastName || '',
    recipientStreet1: order?.recipientStreet1 || '',
    recipientStreet2: order?.recipientStreet2 || '',
    recipientCity: order?.recipientCity || '',
    recipientState: order?.recipientState || '',
    recipientPostal: order?.recipientPostal || '',
    recipientCountry: order?.recipientCountry || '',
    recipientPhone: order?.recipientPhone || '',
    hsCode: order?.hsCode || '',
    countryOfOrigin: order?.countryOfOrigin || '',
    weight: order?.weight || DEFAULTS.weight,
    serviceType: DEFAULTS.serviceType,
    packageType: DEFAULTS.packageType,
    signatureOption: DEFAULTS.signatureOption,
    packageLength: '',
    packageWidth: '',
    packageHeight: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  React.useEffect(() => {
    if (order) {
      setForm(f => ({
        ...f,
        recipientFirstName: order?.recipientFirstName || '',
        recipientLastName: order?.recipientLastName || '',
        recipientStreet1: order?.recipientStreet1 || '',
        recipientStreet2: order?.recipientStreet2 || '',
        recipientCity: order?.recipientCity || '',
        recipientState: order?.recipientState || '',
        recipientPostal: order?.recipientPostal || '',
        recipientCountry: order?.recipientCountry || '',
        recipientPhone: order?.recipientPhone || '',
        hsCode: order?.hsCode || '',
        countryOfOrigin: order?.countryOfOrigin || '',
        weight: order?.weight || DEFAULTS.weight,
      }));
    }
  }, [order]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  };

  const handleSelectChange = (e: SelectChangeEvent<string>) => {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name as string]: value }));
  };


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/labels/ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order?.orderId,
          recipientFirstName: form.recipientFirstName,
          recipientLastName: form.recipientLastName,
          recipientStreet1: form.recipientStreet1,
          recipientStreet2: form.recipientStreet2,
          recipientCity: form.recipientCity,
          recipientState: form.recipientState,
          recipientPostal: form.recipientPostal,
          recipientCountry: form.recipientCountry,
          recipientPhone: form.recipientPhone,
          hsCode: form.hsCode,
          countryOfOrigin: form.countryOfOrigin,
          serviceType: form.serviceType,
          packageType: form.packageType,
          signatureOption: form.signatureOption,
          weight: form.weight,
          ...(form.packageType === 'CUSTOM_PACKAGE' ? {
            packageLength: form.packageLength,
            packageWidth: form.packageWidth,
            packageHeight: form.packageHeight,
          } : {})
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSuccess(true);
      onSaved();
      onClose();
    } catch (err: any) {
      setError(err.message || 'UPS etiketi kaydedilemedi.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer anchor="right" open={open} onClose={onClose} PaperProps={{ sx: { width: { xs: '90%', sm: 450, md: 500 }, p: { xs: 1, sm: 2 } } }}>
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        <Box display="flex" alignItems="center" justifyContent="space-between" mb={1} p={1} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="h6">UPS Etiketi Oluştur</Typography>
          <IconButton onClick={onClose} size="small"><CloseIcon /></IconButton>
        </Box>
        <Box sx={{ overflowY: 'auto', p: { xs: 1, sm: 2 }, flexGrow: 1 }}>
          <form onSubmit={handleSubmit}>
            
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Service Type</InputLabel>
              <Select name="serviceType" value={form.serviceType} onChange={handleSelectChange} label="Service Type">
                {UPS_SERVICE_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Package Type</InputLabel>
              <Select name="packageType" value={form.packageType} onChange={handleSelectChange} label="Package Type">
                {UPS_PACKAGE_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
              </Select>
            </FormControl>
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Signature Option</InputLabel>
              <Select name="signatureOption" value={form.signatureOption} onChange={handleSelectChange} label="Signature Option">
                {UPS_SIGNATURE_OPTIONS.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
              </Select>
            </FormControl>
            
            <TextField label="Weight (kg)" name="weight" type="number" value={form.weight} onChange={handleInputChange} fullWidth margin="dense" size="small" inputProps={{ min: 0, step: 0.01 }} />
            <Box mt={2} mb={1}>
              <Chip label="EDI: Electronic Data Interchange (Zorunlu)" color="info" variant="outlined" />
            </Box>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }}>UPS etiketi başarıyla kaydedildi.</Alert>}
            <Button type="submit" variant="contained" color="primary" fullWidth disabled={saving}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</Button>
          </form>
        </Box>
      </Box>
    </Drawer>
  );
}
