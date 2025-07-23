import React, { useState } from 'react';
import { Drawer, Box, Typography, IconButton, TextField, Select, MenuItem, FormControl, InputLabel, Button, Alert, Chip } from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import { UPS_SERVICE_TYPES, UPS_PACKAGE_TYPES, UPS_SIGNATURE_OPTIONS } from '@/constants/ups';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'react-hot-toast';

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
  recipientEmail?: string;
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
  serviceType: '65', // UPS Saver
  packageType: 'UPS_PAK',
  signatureOption: 'NO_SIGNATURE',
  dutyPaymentType: 'RECEIVER', // Default: Receiver pays duties
  weight: 0.5,
};

const UPS_EXPORT_REASONS = [
  { value: 'SALE', label: 'Satış' },
  { value: 'GIFT', label: 'Hediye' },
  { value: 'RETURN', label: 'İade' },
  { value: 'REPAIR', label: 'Tamir' },
  { value: 'SAMPLE', label: 'Numune' },
];

const UPS_CURRENCY_CODES = [
  { value: 'USD', label: 'ABD Doları' },
  { value: 'EUR', label: 'Euro' },
  { value: 'GBP', label: 'İngiliz Sterlini' },
];

const UPS_COUNTRY_CODES = [
  { value: 'TR', label: 'Türkiye' },
  { value: 'US', label: 'ABD' },
  { value: 'GB', label: 'İngiltere' },
  { value: 'DE', label: 'Almanya' },
  { value: 'FR', label: 'Fransa' },
  // ...add more as needed
];

// Helper function to convert country names to country codes
const getCountryCode = (countryName: string): string => {
  const countryMappings: Record<string, string> = {
    'United States': 'US',
    'USA': 'US',
    'US': 'US',
    'Turkey': 'TR',
    'Türkiye': 'TR',
    'TR': 'TR',
    'United Kingdom': 'GB',
    'UK': 'GB',
    'GB': 'GB',
    'Germany': 'DE',
    'DE': 'DE',
    'France': 'FR',
    'FR': 'FR',
  };
  
  return countryMappings[countryName] || 'US'; // Default to US if not found
};

const US_STATES = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

export default function UPSLabelDrawer({ open, onClose, order, onSaved }: UPSLabelDrawerProps) {
  type Product = {
    description: string;
    quantity: number;
    value: number;
    commodityCode: string;
    originCountry: string;
  };
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
    dutyPaymentType: string;
    packageLength?: string;
    packageWidth?: string;
    packageHeight?: string;
    invoiceNumber: string;
    invoiceDate: string;
    exportReason: string;
    currencyCode: string;
    iossNumber: string;
    vatNumber: string;
    products: Array<{
      description: string;
      quantity: number;
      value: number;
      commodityCode: string;
      unitOfMeasurement: string;
      weight: string;
      originCountry: string;
    }>;
    soldToName: string;
    soldToAttention: string;
    soldToStreet1: string;
    soldToStreet2: string;
    soldToCity: string;
    soldToPostal: string;
    soldToCountry: string;
    soldToPhone: string;
    soldToState: string;
    soldToEmail: string;
    termsOfShipment: string;
    invoiceLineTotal: {
      currencyCode: string;
      monetaryValue: string;
    };
  };
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState<UPSFormState>({
    recipientFirstName: '',
    recipientLastName: '',
    recipientStreet1: '',
    recipientStreet2: '',
    recipientCity: '',
    recipientState: '',
    recipientPostal: '',
    recipientCountry: '',
    recipientPhone: '',
    hsCode: '',
    countryOfOrigin: '',
    weight: DEFAULTS.weight,
    serviceType: DEFAULTS.serviceType,
    packageType: DEFAULTS.packageType,
    signatureOption: DEFAULTS.signatureOption,
    dutyPaymentType: DEFAULTS.dutyPaymentType,
    packageLength: '',
    packageWidth: '',
    packageHeight: '',
    invoiceNumber: '',
    invoiceDate: today,
    exportReason: 'SALE',
    currencyCode: 'USD',
    iossNumber: '',
    vatNumber: '',
    products: [{
      description: 'Global Cargo Shipment',
      quantity: 1,
      value: 0,
      commodityCode: '',
      unitOfMeasurement: 'PCS',
      weight: DEFAULTS.weight.toString(),
      originCountry: 'TR',
    }],
    soldToName: '',
    soldToAttention: '',
    soldToStreet1: '',
    soldToStreet2: '',
    soldToCity: '',
    soldToPostal: '',
    soldToCountry: 'TR',
    soldToPhone: '',
    soldToState: '',
    soldToEmail: '',
    termsOfShipment: 'DAP',
    invoiceLineTotal: {
      currencyCode: 'USD',
      monetaryValue: '0.00'
    }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { user }: { user: any } = useAuth();
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  React.useEffect(() => {
    if (order) {
      const orderValue = order?.orderTotalPrice || 0;
      setForm(f => ({
        ...f,
        recipientFirstName: order?.recipientFirstName || '',
        recipientLastName: order?.recipientLastName || '',
        recipientStreet1: order?.recipientStreet1 || '',
        recipientStreet2: order?.recipientStreet2 || '',
        recipientCity: order?.recipientCity || '',
        recipientState: order?.recipientState || '',
        recipientPostal: order?.recipientPostal || '',
        recipientCountry: getCountryCode(order?.recipientCountry || ''),
        recipientPhone: order?.recipientPhone || '',
        hsCode: order?.hsCode || '',
        countryOfOrigin: order?.countryOfOrigin || '',
        serviceType: DEFAULTS.serviceType,
        dutyPaymentType: DEFAULTS.dutyPaymentType,
        weight: order?.weight || DEFAULTS.weight,
        invoiceNumber: `INV-${order?.orderNumber || Date.now()}`,
        soldToName: `${order?.recipientFirstName || ''} ${order?.recipientLastName || ''}`.trim(),
        soldToAttention: `${order?.recipientFirstName || ''} ${order?.recipientLastName || ''}`.trim(),
        soldToStreet1: order?.recipientStreet1 || '',
        soldToStreet2: order?.recipientStreet2 || '',
        soldToCity: order?.recipientCity || '',
        soldToPostal: order?.recipientPostal || '',
        soldToCountry: getCountryCode(order?.recipientCountry || ''),
        soldToPhone: order?.recipientPhone || '',
        soldToState: order?.recipientState || '',
        soldToEmail: order?.recipientEmail || '',
        products: [{
          description: order?.title || 'Global Cargo Shipment',
          quantity: 1,
          value: orderValue,
          commodityCode: order?.hsCode || '',
          unitOfMeasurement: 'PCS',
          weight: (order?.weight || DEFAULTS.weight).toString(),
          originCountry: order?.countryOfOrigin || 'TR',
        }],
        invoiceLineTotal: {
          currencyCode: order?.currency || 'USD',
          monetaryValue: orderValue.toFixed(2)
        }
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
      const { fetchWithLimit } = await import('../lib/fetchWithLimit');
      const res = await fetchWithLimit('/api/labels/ups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user?.id,
          orderId: order?.orderId,
          recipient: {
            name: `${form.recipientFirstName} ${form.recipientLastName}`.trim(),
            phone: form.recipientPhone,
            street1: form.recipientStreet1,
            street2: form.recipientStreet2,
            city: form.recipientCity,
            stateCode: form.recipientState,
            postalCode: form.recipientPostal,
            countryCode: form.recipientCountry,
          },
          package: {
            weightKg: form.weight,
            lengthCm: form.packageLength ? Number(form.packageLength) : undefined,
            widthCm: form.packageWidth ? Number(form.packageWidth) : undefined,
            heightCm: form.packageHeight ? Number(form.packageHeight) : undefined,
            dimensionUnits: 'CM',
          },
          serviceType: form.serviceType,
          isEdi: true,
          description: form.products[0].description, // Use product description
          dutyPaymentType: form.dutyPaymentType,
          internationalForms: {
            invoiceNumber: form.invoiceNumber,
            invoiceLineTotal: {
              currencyCode: form.currencyCode,
              monetaryValue: (form.products[0].quantity * form.products[0].value).toFixed(2)
            },
            exportReason: form.exportReason,
            currencyCode: form.currencyCode,
            iossNumber: form.iossNumber,
            vatNumber: form.vatNumber,
            products: form.products.map(product => ({
              ...product,
              commodityCode: product.commodityCode || '000000' // Fallback to 000000 if empty
            })),
            soldTo: {
              name: form.soldToName,
              attention: form.soldToAttention,
              street1: form.soldToStreet1,
              street2: form.soldToStreet2,
              city: form.soldToCity,
              postalCode: form.soldToPostal,
              countryCode: form.soldToCountry,
              phone: form.soldToPhone,
              state: form.soldToState,
              email: form.soldToEmail,
            },
            soldToState: form.soldToState,
            soldToEmail: form.soldToEmail,
            termsOfShipment: form.termsOfShipment,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setError(data.error || 'UPS label creation failed');
        setSaving(false);
        return;
      }
      toast.success(`UPS etiketi oluşturuldu! Takip No: ${data.trackingNumber}`);
      if (data.trackingNumber) {
        try { 
          await navigator.clipboard.writeText(data.trackingNumber);
          toast.success('Takip numarası panoya kopyalandı');
        } catch (e) {
          console.error('Failed to copy tracking number:', e);
        }
      }
      
      // Set success state first
      setSuccess(true);
      setSaving(false);
      
      // Trigger parent to refresh the orders list
      if (onSaved) {
        await onSaved();
      }
      
      // Handle label URL after parent has had a chance to update
      if (data.labelUrl) {
        if (data.labelUrl.startsWith('data:image/')) {
          setLabelUrl(data.labelUrl);
        } else {
          // Small delay to ensure the parent has time to update
          setTimeout(() => {
            window.open(data.labelUrl, '_blank', 'noopener,noreferrer');
            onClose();
          }, 500);
        }
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err.message || 'UPS label creation failed');
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
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Vergi/Gümrük Ödemesi</InputLabel>
              <Select name="dutyPaymentType" value={form.dutyPaymentType} onChange={handleSelectChange} label="Vergi/Gümrük Ödemesi">
                <MenuItem value="RECEIVER">Alıcı (Receiver)</MenuItem>
                <MenuItem value="SHIPPER">Gönderici (Shipper)</MenuItem>
              </Select>
            </FormControl>
            
            <TextField label="Weight (kg)" name="weight" type="number" value={form.weight} onChange={handleInputChange} fullWidth margin="dense" size="small" inputProps={{ min: 0, step: 0.01 }} />
            <Box mt={2} mb={1}>
              <Chip label="EDI: Electronic Data Interchange (Zorunlu)" color="info" variant="outlined" />
            </Box>
            <TextField
              label="Fatura Numarası"
              name="invoiceNumber"
              value={form.invoiceNumber}
              onChange={handleInputChange}
              inputProps={{ maxLength: 30 }}
              required
              fullWidth
              margin="dense"
            />
            <TextField
              label="Fatura Tarihi"
              name="invoiceDate"
              type="date"
              value={form.invoiceDate}
              onChange={handleInputChange}
              required
              fullWidth
              margin="dense"
              InputLabelProps={{ shrink: true }}
            />
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>İhracat Nedeni</InputLabel>
              <Select
                name="exportReason"
                value={form.exportReason}
                onChange={handleSelectChange}
                label="İhracat Nedeni"
                required
              >
                {UPS_EXPORT_REASONS.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Para Birimi</InputLabel>
              <Select
                name="currencyCode"
                value={form.currencyCode}
                onChange={handleSelectChange}
                label="Para Birimi"
                required
              >
                {UPS_CURRENCY_CODES.map(opt => (
                  <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="IOSS Numarası"
              name="iossNumber"
              value={form.iossNumber}
              onChange={handleInputChange}
              inputProps={{ maxLength: 35, pattern: '^[A-Z0-9]{1,35}$' }}
              fullWidth
              margin="dense"
            />
            <TextField
              label="KDV Numarası"
              name="vatNumber"
              value={form.vatNumber}
              onChange={handleInputChange}
              inputProps={{ maxLength: 20, pattern: '^[A-Z0-9]{1,20}$' }}
              fullWidth
              margin="dense"
            />
            <Box mt={2} mb={1} p={1} sx={{ border: '1px solid #eee', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>Ürün Bilgisi</Typography>
              <TextField
                label="Açıklama"
                name="description"
                value={form.products[0].description}
                onChange={e => setForm(f => ({ ...f, products: [{ ...f.products[0], description: e.target.value }] }))}
                inputProps={{ maxLength: 35 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="GTIP Kodu"
                name="commodityCode"
                value={form.products[0].commodityCode}
                onChange={e => setForm(f => ({
                  ...f,
                  products: [{ ...f.products[0], commodityCode: e.target.value }]
                }))}
                inputProps={{ maxLength: 20, pattern: '^[0-9]*$' }}
                fullWidth
                margin="dense"
              />
              <TextField
                label="Miktar"
                name="quantity"
                type="number"
                value={form.products[0].quantity}
                onChange={e => {
                  const quantity = Math.max(1, Number(e.target.value));
                  const unitPrice = form.products[0].value;
                  setForm(f => ({
                    ...f, 
                    products: [{ ...f.products[0], quantity }],
                    invoiceLineTotal: {
                      currencyCode: f.currencyCode,
                      monetaryValue: (quantity * unitPrice).toFixed(2)
                    }
                  }));
                }}
                inputProps={{ min: 1 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="Birim Fiyat"
                name="value"
                type="number"
                value={form.products[0].value}
                onChange={e => {
                  const unitPrice = Math.max(0.01, Number(e.target.value));
                  setForm(f => ({
                    ...f, 
                    products: [{ ...f.products[0], value: unitPrice }],
                    invoiceLineTotal: {
                      currencyCode: f.currencyCode,
                      monetaryValue: (f.products[0].quantity * unitPrice).toFixed(2)
                    }
                  }));
                }}
                inputProps={{ min: 0.01, step: 0.01 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="Toplam Tutar"
                type="number"
                value={(form.products[0].quantity * form.products[0].value).toFixed(2)}
                disabled
                fullWidth
                margin="dense"
              />
              <FormControl fullWidth margin="dense" size="small">
                <InputLabel>Ürün Birimi</InputLabel>
                <Select
                  name="unitOfMeasurement"
                  value={form.products[0].unitOfMeasurement}
                  onChange={e => setForm(f => ({ ...f, products: [{ ...f.products[0], unitOfMeasurement: e.target.value }] }))}
                  label="Ürün Birimi"
                  required
                >
                  <MenuItem value="PCS">Adet</MenuItem>
                  <MenuItem value="KG">Kilogram</MenuItem>
                  <MenuItem value="LTR">Litre</MenuItem>
                  <MenuItem value="MTR">Metre</MenuItem>
                  <MenuItem value="CMT">Santimetre</MenuItem>
                  <MenuItem value="MMT">Milimetre</MenuItem>
                </Select>
              </FormControl>
              <FormControl fullWidth margin="dense" size="small">
                <InputLabel>Ürün Ağırlığı</InputLabel>
                <TextField
                  name="weight"
                  type="number"
                  value={form.products[0].weight}
                  onChange={e => setForm(f => ({ ...f, products: [{ ...f.products[0], weight: e.target.value }] }))}
                  inputProps={{ min: 0, step: 0.01 }}
                  required
                  fullWidth
                  margin="dense"
                />
              </FormControl>
              <FormControl fullWidth margin="dense" size="small">
                <InputLabel>Menşei Ülke</InputLabel>
                <Select
                  name="originCountry"
                  value={form.products[0].originCountry}
                  onChange={e => setForm(f => ({ ...f, products: [{ ...f.products[0], originCountry: e.target.value }] }))}
                  label="Menşei Ülke"
                  required
                >
                  {UPS_COUNTRY_CODES.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
            <Box mt={2} mb={1} p={1} sx={{ border: '1px solid #eee', borderRadius: 1 }}>
              <Typography variant="subtitle2" gutterBottom>Alıcı (Sold To)</Typography>
              <TextField
                label="Ad"
                name="soldToName"
                value={form.soldToName}
                onChange={handleInputChange}
                inputProps={{ maxLength: 35 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="Dikkat Edilecek Kişi"
                name="soldToAttention"
                value={form.soldToAttention}
                onChange={handleInputChange}
                inputProps={{ maxLength: 35 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="Adres Satırı 1"
                name="soldToStreet1"
                value={form.soldToStreet1}
                onChange={handleInputChange}
                inputProps={{ maxLength: 35 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="Adres Satırı 2"
                name="soldToStreet2"
                value={form.soldToStreet2}
                onChange={handleInputChange}
                inputProps={{ maxLength: 35 }}
                fullWidth
                margin="dense"
              />
              <TextField
                label="Şehir"
                name="soldToCity"
                value={form.soldToCity}
                onChange={handleInputChange}
                inputProps={{ maxLength: 35 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="Posta Kodu"
                name="soldToPostal"
                value={form.soldToPostal}
                onChange={handleInputChange}
                inputProps={{ maxLength: 10 }}
                required
                fullWidth
                margin="dense"
              />
              <TextField
                label="Telefon Numarası"
                name="soldToPhone"
                value={form.soldToPhone}
                onChange={handleInputChange}
                inputProps={{ maxLength: 20 }}
                required
                fullWidth
                margin="dense"
              />
              <FormControl fullWidth margin="dense" size="small">
                <InputLabel>Ülke</InputLabel>
                <Select
                  name="soldToCountry"
                  value={form.soldToCountry}
                  onChange={handleSelectChange}
                  label="Ülke"
                  required
                >
                  {UPS_COUNTRY_CODES.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth margin="dense" size="small">
                <InputLabel>Alıcı Eyalet/Kod</InputLabel>
                <TextField
                  name="soldToState"
                  value={form.soldToState}
                  onChange={handleInputChange}
                  inputProps={{ maxLength: 2 }}
                  required
                  fullWidth
                  margin="dense"
                />
              </FormControl>
              <TextField
                label="Alıcı E-posta"
                name="soldToEmail"
                type="email"
                value={form.soldToEmail}
                onChange={handleInputChange}
                inputProps={{ maxLength: 50 }}
                fullWidth
                margin="dense"
                size="small"
              />
            </Box>
            <FormControl fullWidth margin="dense" size="small">
              <InputLabel>Teslim Şartı</InputLabel>
              <Select
                name="termsOfShipment"
                value={form.termsOfShipment}
                onChange={handleSelectChange}
                label="Teslim Şartı"
                required
              >
                <MenuItem value="DAP">DAP (Delivered At Place)</MenuItem>
                <MenuItem value="DDP">DDP (Delivered Duty Paid)</MenuItem>
                <MenuItem value="DDU">DDU (Delivered Duty Unpaid)</MenuItem>
                <MenuItem value="EXW">EXW (Ex Works)</MenuItem>
                <MenuItem value="FCA">FCA (Free Carrier)</MenuItem>
                <MenuItem value="CPT">CPT (Carriage Paid To)</MenuItem>
                <MenuItem value="CIP">CIP (Carriage and Insurance Paid To)</MenuItem>
                <MenuItem value="DAT">DAT (Delivered At Terminal)</MenuItem>
                <MenuItem value="DPU">DPU (Delivered at Place Unloaded)</MenuItem>
                <MenuItem value="CFR">CFR (Cost and Freight)</MenuItem>
                <MenuItem value="CIF">CIF (Cost, Insurance and Freight)</MenuItem>
              </Select>
            </FormControl>
            {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
            {success && <Alert severity="success" sx={{ mb: 2 }}>UPS etiketi başarıyla kaydedildi.</Alert>}
            <Button type="submit" variant="contained" color="primary" fullWidth disabled={saving}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</Button>
          </form>
          {labelUrl && (
            <Box mt={2} textAlign="center">
              <Typography variant="subtitle1" gutterBottom>UPS Etiketi</Typography>
              <img src={labelUrl} alt="UPS Label" style={{ maxWidth: '100%', border: '1px solid #ccc', marginBottom: 8 }} />
              <a href={labelUrl} download="ups-label.gif">
                <Button variant="outlined" color="primary">Etiketi İndir</Button>
              </a>
            </Box>
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
