import React, { useState, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  Typography,
  IconButton,
  Box,
  Divider,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  Autocomplete
} from '@mui/material';
import { Close as CloseIcon, Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { useLocale } from '../lib/i18n/useLocale';

interface OrderItem {
  productName: string;
  quantity: number;
  unitPrice: number;
  weight: number;
  sku: string;
  hsCode: string;
  countryOfOrigin: string;
}

interface ManualOrderData {
  // Customer info
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  
  // Order info
  orderNumber: string;
  currency: string;
  
  // Shipping address
  street1: string;
  street2: string;
  city: string;
  state: string;
  postal: string;
  country: string;
  
  // Items
  items: OrderItem[];
}

interface ManualOrderFormProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

function getInitialOrderData(defaultCountry: string, defaultCurrency: string): ManualOrderData {
  return {
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    orderNumber: '',
    currency: defaultCurrency || 'USD',
    street1: '',
    street2: '',
    city: '',
    state: '',
    postal: '',
    country: defaultCountry || '',
    items: [{
      productName: '',
      quantity: 1,
      unitPrice: 0,
      weight: 0.5,
      sku: '',
      hsCode: '',
      countryOfOrigin: defaultCountry || ''
    }]
  };
}

const CURRENCY_CODES = [
  'TRY', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'BGN', 'HRK',
  'RUB', 'INR', 'KRW', 'SGD', 'HKD', 'NZD', 'MXN', 'BRL', 'ARS',
  'CLP', 'ZAR', 'AED', 'SAR', 'QAR', 'KWD', 'BHD', 'OMR', 'JOD',
  'LBP', 'EGP', 'ILS', 'THB', 'MYR', 'IDR', 'PHP', 'VND'
] as const;

const CURRENCY_SYMBOLS: Record<string, string> = {
  TRY: '₺', USD: '$', EUR: '€', GBP: '£', CAD: 'C$', AUD: 'A$',
  JPY: '¥', CHF: 'CHF', CNY: '¥', SEK: 'kr', NOK: 'kr', DKK: 'kr',
  PLN: 'zł', CZK: 'Kč', HUF: 'Ft', RON: 'lei', BGN: 'лв', HRK: 'kn',
  RUB: '₽', INR: '₹', KRW: '₩', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$',
  MXN: '$', BRL: 'R$', ARS: '$', CLP: '$', ZAR: 'R', AED: 'د.إ',
  SAR: '﷼', QAR: '﷼', KWD: 'د.ك', BHD: '.د.ب', OMR: '﷼', JOD: 'د.ا',
  LBP: '£', EGP: '£', ILS: '₪', THB: '฿', MYR: 'RM', IDR: 'Rp',
  PHP: '₱', VND: '₫'
};

const COUNTRY_CODES = [
  'TR', 'US', 'DE', 'GB', 'FR', 'IT', 'ES', 'NL', 'BE', 'AT', 'CH',
  'SE', 'NO', 'DK', 'FI', 'PL', 'CZ', 'HU', 'SK', 'SI', 'HR', 'RS',
  'BG', 'RO', 'GR', 'CY', 'MT', 'LU', 'IE', 'PT', 'CA', 'MX', 'BR',
  'AR', 'CL', 'CO', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE', 'AU', 'NZ',
  'JP', 'KR', 'CN', 'IN', 'SG', 'HK', 'TW', 'MY', 'TH', 'ID', 'PH',
  'VN', 'RU', 'UA', 'BY', 'KZ', 'UZ', 'AZ', 'GE', 'AM', 'IL', 'SA',
  'AE', 'QA', 'KW', 'BH', 'OM', 'JO', 'LB', 'SY', 'IQ', 'IR', 'AF',
  'PK', 'BD', 'LK', 'NP', 'BT', 'MV', 'EG', 'LY', 'TN', 'DZ', 'MA',
  'ZA', 'NG', 'KE', 'ET', 'GH', 'CI', 'SN', 'TZ', 'UG', 'RW', 'MU', 'SC'
] as const;

const COUNTRY_FLAGS: Record<string, string> = {
  TR: '\u{1F1F9}\u{1F1F7}', US: '\u{1F1FA}\u{1F1F8}', DE: '\u{1F1E9}\u{1F1EA}', GB: '\u{1F1EC}\u{1F1E7}',
  FR: '\u{1F1EB}\u{1F1F7}', IT: '\u{1F1EE}\u{1F1F9}', ES: '\u{1F1EA}\u{1F1F8}', NL: '\u{1F1F3}\u{1F1F1}',
  BE: '\u{1F1E7}\u{1F1EA}', AT: '\u{1F1E6}\u{1F1F9}', CH: '\u{1F1E8}\u{1F1ED}', SE: '\u{1F1F8}\u{1F1EA}',
  NO: '\u{1F1F3}\u{1F1F4}', DK: '\u{1F1E9}\u{1F1F0}', FI: '\u{1F1EB}\u{1F1EE}', PL: '\u{1F1F5}\u{1F1F1}',
  CZ: '\u{1F1E8}\u{1F1FF}', HU: '\u{1F1ED}\u{1F1FA}', SK: '\u{1F1F8}\u{1F1F0}', SI: '\u{1F1F8}\u{1F1EE}',
  HR: '\u{1F1ED}\u{1F1F7}', RS: '\u{1F1F7}\u{1F1F8}', BG: '\u{1F1E7}\u{1F1EC}', RO: '\u{1F1F7}\u{1F1F4}',
  GR: '\u{1F1EC}\u{1F1F7}', CY: '\u{1F1E8}\u{1F1FE}', MT: '\u{1F1F2}\u{1F1F9}', LU: '\u{1F1F1}\u{1F1FA}',
  IE: '\u{1F1EE}\u{1F1EA}', PT: '\u{1F1F5}\u{1F1F9}', CA: '\u{1F1E8}\u{1F1E6}', MX: '\u{1F1F2}\u{1F1FD}',
  BR: '\u{1F1E7}\u{1F1F7}', AR: '\u{1F1E6}\u{1F1F7}', CL: '\u{1F1E8}\u{1F1F1}', CO: '\u{1F1E8}\u{1F1F4}',
  PE: '\u{1F1F5}\u{1F1EA}', UY: '\u{1F1FA}\u{1F1FE}', PY: '\u{1F1F5}\u{1F1FE}', BO: '\u{1F1E7}\u{1F1F4}',
  EC: '\u{1F1EA}\u{1F1E8}', VE: '\u{1F1FB}\u{1F1EA}', AU: '\u{1F1E6}\u{1F1FA}', NZ: '\u{1F1F3}\u{1F1FF}',
  JP: '\u{1F1EF}\u{1F1F5}', KR: '\u{1F1F0}\u{1F1F7}', CN: '\u{1F1E8}\u{1F1F3}', IN: '\u{1F1EE}\u{1F1F3}',
  SG: '\u{1F1F8}\u{1F1EC}', HK: '\u{1F1ED}\u{1F1F0}', TW: '\u{1F1F9}\u{1F1FC}', MY: '\u{1F1F2}\u{1F1FE}',
  TH: '\u{1F1F9}\u{1F1ED}', ID: '\u{1F1EE}\u{1F1E9}', PH: '\u{1F1F5}\u{1F1ED}', VN: '\u{1F1FB}\u{1F1F3}',
  RU: '\u{1F1F7}\u{1F1FA}', UA: '\u{1F1FA}\u{1F1E6}', BY: '\u{1F1E7}\u{1F1FE}', KZ: '\u{1F1F0}\u{1F1FF}',
  UZ: '\u{1F1FA}\u{1F1FF}', AZ: '\u{1F1E6}\u{1F1FF}', GE: '\u{1F1EC}\u{1F1EA}', AM: '\u{1F1E6}\u{1F1F2}',
  IL: '\u{1F1EE}\u{1F1F1}', SA: '\u{1F1F8}\u{1F1E6}', AE: '\u{1F1E6}\u{1F1EA}', QA: '\u{1F1F6}\u{1F1E6}',
  KW: '\u{1F1F0}\u{1F1FC}', BH: '\u{1F1E7}\u{1F1ED}', OM: '\u{1F1F4}\u{1F1F2}', JO: '\u{1F1EF}\u{1F1F4}',
  LB: '\u{1F1F1}\u{1F1E7}', SY: '\u{1F1F8}\u{1F1FE}', IQ: '\u{1F1EE}\u{1F1F6}', IR: '\u{1F1EE}\u{1F1F7}',
  AF: '\u{1F1E6}\u{1F1EB}', PK: '\u{1F1F5}\u{1F1F0}', BD: '\u{1F1E7}\u{1F1E9}', LK: '\u{1F1F1}\u{1F1F0}',
  NP: '\u{1F1F3}\u{1F1F5}', BT: '\u{1F1E7}\u{1F1F9}', MV: '\u{1F1F2}\u{1F1FB}', EG: '\u{1F1EA}\u{1F1EC}',
  LY: '\u{1F1F1}\u{1F1FE}', TN: '\u{1F1F9}\u{1F1F3}', DZ: '\u{1F1E9}\u{1F1FF}', MA: '\u{1F1F2}\u{1F1E6}',
  ZA: '\u{1F1FF}\u{1F1E6}', NG: '\u{1F1F3}\u{1F1EC}', KE: '\u{1F1F0}\u{1F1EA}', ET: '\u{1F1EA}\u{1F1F9}',
  GH: '\u{1F1EC}\u{1F1ED}', CI: '\u{1F1E8}\u{1F1EE}', SN: '\u{1F1F8}\u{1F1F3}', TZ: '\u{1F1F9}\u{1F1FF}',
  UG: '\u{1F1FA}\u{1F1EC}', RW: '\u{1F1F7}\u{1F1FC}', MU: '\u{1F1F2}\u{1F1FA}', SC: '\u{1F1F8}\u{1F1E8}'
};

const US_STATES = [
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' }
];

export default function ManualOrderForm({ open, onClose, onSuccess }: ManualOrderFormProps) {
  const t = useTranslations('manualOrder');
  const { config } = useLocale();
  const initialData = useMemo(() => getInitialOrderData(config.defaultCountryOfOrigin, config.defaultCurrency), [config]);
  const [orderData, setOrderData] = useState<ManualOrderData>(initialData);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const currencies = useMemo(() =>
    CURRENCY_CODES.map(code => ({
      value: code,
      label: t(`currencies.${code}`),
      symbol: CURRENCY_SYMBOLS[code] || code
    })),
    [t]
  );

  const countries = useMemo(() =>
    COUNTRY_CODES.map(code => ({
      value: code,
      label: t(`countries.${code}`),
      flag: COUNTRY_FLAGS[code] || ''
    })),
    [t]
  );

  // Clear state when switching from US to another country
  React.useEffect(() => {
    if (orderData.country !== 'US' && orderData.state && US_STATES.some(s => s.value === orderData.state)) {
      setOrderData(prev => ({ ...prev, state: '' }));
    }
  }, [orderData.country, orderData.state]);

  const handleClose = () => {
    setOrderData(initialData);
    setErrors({});
    onClose();
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Required fields validation
    if (!orderData.customerName.trim()) newErrors.customerName = t('validation.customerNameRequired');
    if (!orderData.orderNumber.trim()) newErrors.orderNumber = t('validation.orderNumberRequired');
    if (!orderData.street1.trim()) newErrors.street1 = t('validation.address1Required');
    if (!orderData.city.trim()) newErrors.city = t('validation.cityRequired');
    if (!orderData.postal.trim()) newErrors.postal = t('validation.postalRequired');

    // US specific validations
    if (orderData.country === 'US' && !orderData.state.trim()) {
      newErrors.state = t('validation.stateRequiredUS');
    }

    // Items validation
    orderData.items.forEach((item, index) => {
      if (!item.productName.trim()) {
        newErrors[`item_${index}_productName`] = t('validation.productNameRequired');
      }
      if (item.quantity <= 0) {
        newErrors[`item_${index}_quantity`] = t('validation.quantityPositive');
      }
      if (item.unitPrice <= 0) {
        newErrors[`item_${index}_unitPrice`] = t('validation.pricePositive');
      }
      if (item.weight <= 0) {
        newErrors[`item_${index}_weight`] = t('validation.weightPositive');
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      toast.error(t('validation.fillRequired'));
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/orders/manual', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderData),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || t('orderCreateFailed'));
      }

      toast.success(t('orderCreated'));
      handleClose();
      onSuccess();
    } catch (error) {
      console.error('Error creating manual order:', error);
      toast.error(error instanceof Error ? error.message : t('orderCreateFailed'));
    } finally {
      setLoading(false);
    }
  };

  const addItem = () => {
    setOrderData(prev => ({
      ...prev,
      items: [...prev.items, {
        productName: '',
        quantity: 1,
        unitPrice: 0,
        weight: 0.5,
        sku: '',
        hsCode: '',
        countryOfOrigin: config.defaultCountryOfOrigin || ''
      }]
    }));
  };

  const removeItem = (index: number) => {
    if (orderData.items.length > 1) {
      setOrderData(prev => ({
        ...prev,
        items: prev.items.filter((_, i) => i !== index)
      }));
    }
  };

  const updateItem = (index: number, field: keyof OrderItem, value: any) => {
    setOrderData(prev => ({
      ...prev,
      items: prev.items.map((item, i) => 
        i === index ? { ...item, [field]: value } : item
      )
    }));
  };

  const updateField = (field: keyof Omit<ManualOrderData, 'items'>, value: string) => {
    setOrderData(prev => ({ ...prev, [field]: value }));
  };

  const totalPrice = orderData.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
  const selectedCurrency = currencies.find(c => c.value === orderData.currency);
  const currencySymbol = selectedCurrency?.symbol || orderData.currency;

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: { minHeight: '80vh' }
      }}
    >
      <DialogTitle>
        <Box display="flex" justifyContent="space-between" alignItems="center">
          <Typography variant="h6">{t('dialogTitle')}</Typography>
          <IconButton onClick={handleClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent dividers>
        <Grid container spacing={3}>
          {/* Customer Information */}
          <Grid item xs={12}>
            <Typography variant="h6" gutterBottom color="primary">
              {t('customerInfo')}
            </Typography>
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label={`${t('customerName')} *`}
              value={orderData.customerName}
              onChange={(e) => updateField('customerName', e.target.value)}
              error={!!errors.customerName}
              helperText={errors.customerName}
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label={t('email')}
              type="email"
              value={orderData.customerEmail}
              onChange={(e) => updateField('customerEmail', e.target.value)}
            />
          </Grid>
          
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label={t('phone')}
              value={orderData.customerPhone}
              onChange={(e) => updateField('customerPhone', e.target.value)}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label={`${t('orderNumber')} *`}
              value={orderData.orderNumber}
              onChange={(e) => updateField('orderNumber', e.target.value)}
              error={!!errors.orderNumber}
              helperText={errors.orderNumber}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={currencies}
              getOptionLabel={(option) => option.label}
              value={currencies.find(c => c.value === orderData.currency) || null}
              onChange={(_, newValue) => updateField('currency', newValue?.value || config.defaultCurrency)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('currency')}
                  placeholder={t('currencySearch')}
                />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props}>
                  <Box sx={{ mr: 1, fontSize: '1.2em' }}>{option.symbol}</Box>
                  {option.label}
                </Box>
              )}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              filterOptions={(options, { inputValue }) =>
                options.filter(option =>
                  option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
                  option.value.toLowerCase().includes(inputValue.toLowerCase())
                )
              }
            />
          </Grid>

          {/* Shipping Address */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Typography variant="h6" gutterBottom color="primary">
              {t('deliveryAddress')}
            </Typography>
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label={`${t('address1')} *`}
              value={orderData.street1}
              onChange={(e) => updateField('street1', e.target.value)}
              error={!!errors.street1}
              helperText={errors.street1}
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              label={t('address2')}
              value={orderData.street2}
              onChange={(e) => updateField('street2', e.target.value)}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label={`${t('city')} *`}
              value={orderData.city}
              onChange={(e) => updateField('city', e.target.value)}
              error={!!errors.city}
              helperText={errors.city}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            {orderData.country === 'US' ? (
              <FormControl fullWidth>
                <InputLabel>{t('state')} *</InputLabel>
                <Select
                  value={orderData.state}
                  label={`${t('state')} *`}
                  onChange={(e) => updateField('state', e.target.value)}
                  error={!!errors.state}
                >
                  <MenuItem value="">
                    <em>{t('selectState')}</em>
                  </MenuItem>
                  {US_STATES.map(state => (
                    <MenuItem key={state.value} value={state.value}>
                      {state.label}
                    </MenuItem>
                  ))}
                </Select>
                {errors.state && (
                  <Typography variant="caption" color="error" sx={{ mt: 0.5, ml: 1.75 }}>
                    {errors.state}
                  </Typography>
                )}
              </FormControl>
            ) : (
              <TextField
                fullWidth
                label={t('stateProvince')}
                value={orderData.state}
                onChange={(e) => updateField('state', e.target.value)}
                error={!!errors.state}
                helperText={errors.state}
              />
            )}
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label={`${t('postalCode')} *`}
              value={orderData.postal}
              onChange={(e) => updateField('postal', e.target.value)}
              error={!!errors.postal}
              helperText={errors.postal}
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <Autocomplete
              options={countries}
              getOptionLabel={(option) => option.label}
              value={countries.find(c => c.value === orderData.country) || null}
              onChange={(_, newValue) => updateField('country', newValue?.value || config.defaultCountryOfOrigin)}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={t('country')}
                  placeholder={t('searchCountry')}
                />
              )}
              renderOption={(props, option) => (
                <Box component="li" {...props}>
                  <Box sx={{ mr: 1, fontSize: '1.2em' }}>{option.flag}</Box>
                  {option.label}
                </Box>
              )}
              isOptionEqualToValue={(option, value) => option.value === value.value}
              filterOptions={(options, { inputValue }) =>
                options.filter(option =>
                  option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
                  option.value.toLowerCase().includes(inputValue.toLowerCase())
                )
              }
            />
          </Grid>

          {/* Order Items */}
          <Grid item xs={12}>
            <Divider sx={{ my: 2 }} />
            <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
              <Typography variant="h6" color="primary">
                {t('products')}
              </Typography>
              <Button
                startIcon={<AddIcon />}
                onClick={addItem}
                variant="outlined"
                size="small"
              >
                {t('addProduct')}
              </Button>
            </Box>
          </Grid>

          {orderData.items.map((item, index) => (
            <Grid item xs={12} key={index}>
              <Box border={1} borderColor="divider" borderRadius={1} p={2} mb={2}>
                <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                  <Typography variant="subtitle1">
                    {t('productItem', { index: index + 1 })}
                  </Typography>
                  {orderData.items.length > 1 && (
                    <IconButton onClick={() => removeItem(index)} size="small" color="error">
                      <DeleteIcon />
                    </IconButton>
                  )}
                </Box>

                <Grid container spacing={2}>
                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label={`${t('productName')} *`}
                      value={item.productName}
                      onChange={(e) => updateItem(index, 'productName', e.target.value)}
                      error={!!errors[`item_${index}_productName`]}
                      helperText={errors[`item_${index}_productName`]}
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label={t('sku')}
                      value={item.sku}
                      onChange={(e) => updateItem(index, 'sku', e.target.value)}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label={`${t('quantity')} *`}
                      type="number"
                      value={item.quantity}
                      onChange={(e) => updateItem(index, 'quantity', parseInt(e.target.value) || 0)}
                      error={!!errors[`item_${index}_quantity`]}
                      helperText={errors[`item_${index}_quantity`]}
                      inputProps={{ min: 1 }}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label={`${t('unitPrice')} *`}
                      type="number"
                      value={item.unitPrice}
                      onChange={(e) => updateItem(index, 'unitPrice', parseFloat(e.target.value) || 0)}
                      error={!!errors[`item_${index}_unitPrice`]}
                      helperText={errors[`item_${index}_unitPrice`]}
                      inputProps={{ min: 0, step: 0.01 }}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label={`${t('weightKg')} *`}
                      type="number"
                      value={item.weight}
                      onChange={(e) => updateItem(index, 'weight', parseFloat(e.target.value) || 0)}
                      error={!!errors[`item_${index}_weight`]}
                      helperText={errors[`item_${index}_weight`]}
                      inputProps={{ min: 0.01, step: 0.01 }}
                    />
                  </Grid>

                  <Grid item xs={6} sm={3}>
                    <TextField
                      fullWidth
                      label={t('total')}
                      value={`${currencySymbol} ${(item.quantity * item.unitPrice).toFixed(2)}`}
                      InputProps={{ readOnly: true }}
                      variant="filled"
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <TextField
                      fullWidth
                      label={t('hsCode')}
                      value={item.hsCode}
                      onChange={(e) => updateItem(index, 'hsCode', e.target.value)}
                    />
                  </Grid>

                  <Grid item xs={12} sm={6}>
                    <Autocomplete
                      options={countries}
                      getOptionLabel={(option) => option.label}
                      value={countries.find(c => c.value === item.countryOfOrigin) || null}
                      onChange={(_, newValue) => updateItem(index, 'countryOfOrigin', newValue?.value || config.defaultCountryOfOrigin)}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label={t('countryOfOrigin')}
                          placeholder={t('searchCountry')}
                          size="small"
                        />
                      )}
                      renderOption={(props, option) => (
                        <Box component="li" {...props}>
                          <Box sx={{ mr: 1, fontSize: '1.1em' }}>{option.flag}</Box>
                          {option.label}
                        </Box>
                      )}
                      isOptionEqualToValue={(option, value) => option.value === value.value}
                      filterOptions={(options, { inputValue }) =>
                        options.filter(option =>
                          option.label.toLowerCase().includes(inputValue.toLowerCase()) ||
                          option.value.toLowerCase().includes(inputValue.toLowerCase())
                        )
                      }
                      size="small"
                    />
                  </Grid>
                </Grid>
              </Box>
            </Grid>
          ))}

          {/* Order Total */}
          <Grid item xs={12}>
            <Alert severity="info">
              <Typography variant="h6">
                {t('totalAmount')}: {currencySymbol} {totalPrice.toFixed(2)}
              </Typography>
            </Alert>
          </Grid>
        </Grid>
      </DialogContent>

      <DialogActions sx={{ p: 3 }}>
        <Button onClick={handleClose} disabled={loading}>
          {t('cancel')}
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {loading ? t('creating') : t('createOrder')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}