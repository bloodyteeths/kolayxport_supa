import React, { useState } from 'react';
import {
  Drawer, Box, Typography, IconButton, TextField, Select, MenuItem,
  FormControl, InputLabel, Button, Alert, Switch, FormControlLabel,
  Accordion, AccordionSummary, AccordionDetails,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';
import { MNG_SERVICE_TYPES, MNG_PAYMENT_TYPES, MNG_DELIVERY_TYPES, MNG_PACKAGING_TYPES } from '@/lib/mng/mng.config';

interface MngOrder {
  orderId: string;
  orderNumber: string;
  recipientName?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  recipientCity?: string;
  recipientDistrict?: string;
  recipientNeighbourhood?: string;
  recipientStreet?: string;
  recipientAddress?: string;
  recipientPostalCode?: string;
  weight?: number;
  title?: string;
  shipments?: any[];
}

interface MngLabelDrawerProps {
  open: boolean;
  onClose: () => void;
  order: MngOrder | null;
  onSaved: () => void;
}

export default function MngLabelDrawer({ open, onClose, order, onSaved }: MngLabelDrawerProps) {
  const t = useTranslations('mng');

  // Form state
  const [recipientName, setRecipientName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [neighbourhood, setNeighbourhood] = useState('');
  const [street, setStreet] = useState('');
  const [address, setAddress] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [weight, setWeight] = useState('0.5');
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [length, setLength] = useState('');
  const [content, setContent] = useState('');
  const [serviceType, setServiceType] = useState(1);
  const [paymentType, setPaymentType] = useState(1);
  const [deliveryType, setDeliveryType] = useState(1);
  const [packagingType, setPackagingType] = useState(1);
  const [isCOD, setIsCOD] = useState(false);
  const [codAmount, setCodAmount] = useState('');
  const [smsRecipient, setSmsRecipient] = useState(true);
  const [smsDelivery, setSmsDelivery] = useState(true);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  // Populate from order when drawer opens
  React.useEffect(() => {
    if (order && open) {
      setRecipientName(order.recipientName || '');
      setPhone(order.recipientPhone || '');
      setEmail(order.recipientEmail || '');
      setCity(order.recipientCity || '');
      setDistrict(order.recipientDistrict || '');
      setNeighbourhood(order.recipientNeighbourhood || '');
      setStreet(order.recipientStreet || '');
      setAddress(order.recipientAddress || '');
      setPostalCode(order.recipientPostalCode || '');
      setWeight(String(order.weight || 0.5));
      setContent(order.title || order.orderNumber || '');
      setResult(null);
      setError('');
    }
  }, [order, open]);

  const hasExistingLabel = order?.shipments?.some(
    (s: any) => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl)
  );

  const handleSubmit = async () => {
    if (!order) return;

    if (!recipientName || !phone || !city || !district || !address) {
      setError(t('missingFields'));
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      const res = await fetch('/api/labels/mng', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.orderId,
          recipient: {
            name: recipientName,
            phone,
            email,
            city,
            district,
            neighbourhood,
            street,
            address,
            postalCode,
          },
          packageInfo: {
            weight: parseFloat(weight) || 0.5,
            width: width ? parseFloat(width) : undefined,
            height: height ? parseFloat(height) : undefined,
            length: length ? parseFloat(length) : undefined,
          },
          serviceType,
          paymentType,
          deliveryType,
          packagingType,
          isCOD,
          codAmount: isCOD ? parseFloat(codAmount) || 0 : 0,
          content,
          smsPreference1: false,
          smsPreference2: smsRecipient,
          smsPreference3: smsDelivery,
          description,
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        setError(data.error || t('createFailed'));
        return;
      }

      setResult(data);
      toast.success(t('createSuccess'));
      onSaved();
    } catch (err: any) {
      setError(err.message || t('createFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 480 }, p: 0 } }}
    >
      <Box sx={{ p: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #eee' }}>
        <Typography variant="h6">
          {t('drawerTitle')} — {order?.orderNumber}
        </Typography>
        <IconButton onClick={onClose}><CloseIcon /></IconButton>
      </Box>

      <Box sx={{ p: 2, overflowY: 'auto', flex: 1 }}>
        {hasExistingLabel && (
          <Alert severity="warning" sx={{ mb: 2 }}>{t('existingLabel')}</Alert>
        )}

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {result && (
          <Alert severity="success" sx={{ mb: 2 }}>
            {t('trackingNumber')}: <strong>{result.trackingNumber}</strong>
            {result.barcode && <><br />Barkod: {result.barcode}</>}
          </Alert>
        )}

        {/* Recipient */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight="bold">{t('recipientInfo')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField fullWidth label={t('recipientName')} value={recipientName} onChange={e => setRecipientName(e.target.value)} required size="small" />
              <TextField fullWidth label={t('phone')} value={phone} onChange={e => setPhone(e.target.value)} required size="small" />
              <TextField fullWidth label={t('email')} value={email} onChange={e => setEmail(e.target.value)} size="small" />
              <TextField fullWidth label={t('city')} value={city} onChange={e => setCity(e.target.value)} required size="small" placeholder="Istanbul" />
              <TextField fullWidth label={t('district')} value={district} onChange={e => setDistrict(e.target.value)} required size="small" placeholder="Kadikoy" />
              <TextField fullWidth label={t('neighbourhood')} value={neighbourhood} onChange={e => setNeighbourhood(e.target.value)} size="small" />
              <TextField fullWidth label={t('street')} value={street} onChange={e => setStreet(e.target.value)} size="small" />
              <TextField fullWidth label={t('address')} value={address} onChange={e => setAddress(e.target.value)} required multiline rows={2} size="small" />
              <TextField fullWidth label={t('postalCode')} value={postalCode} onChange={e => setPostalCode(e.target.value)} size="small" />
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* Package */}
        <Accordion defaultExpanded>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight="bold">{t('packageInfo')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <TextField fullWidth label={`${t('weight')} (kg)`} type="number" value={weight} onChange={e => setWeight(e.target.value)} size="small" inputProps={{ step: 0.1, min: 0.1 }} />
              <Box sx={{ display: 'flex', gap: 1 }}>
                <TextField label={`${t('width')} (cm)`} type="number" value={width} onChange={e => setWidth(e.target.value)} size="small" />
                <TextField label={`${t('height')} (cm)`} type="number" value={height} onChange={e => setHeight(e.target.value)} size="small" />
                <TextField label={`${t('length')} (cm)`} type="number" value={length} onChange={e => setLength(e.target.value)} size="small" />
              </Box>
              <TextField fullWidth label={t('content')} value={content} onChange={e => setContent(e.target.value)} size="small" />
              <TextField fullWidth label={t('description')} value={description} onChange={e => setDescription(e.target.value)} size="small" multiline rows={2} />
            </Box>
          </AccordionDetails>
        </Accordion>

        {/* Shipping Options */}
        <Accordion>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography fontWeight="bold">{t('shippingOptions')}</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('serviceType')}</InputLabel>
                <Select value={serviceType} label={t('serviceType')} onChange={(e: SelectChangeEvent<number>) => setServiceType(Number(e.target.value))}>
                  {MNG_SERVICE_TYPES.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>{t('paymentType')}</InputLabel>
                <Select value={paymentType} label={t('paymentType')} onChange={(e: SelectChangeEvent<number>) => setPaymentType(Number(e.target.value))}>
                  {MNG_PAYMENT_TYPES.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>{t('deliveryType')}</InputLabel>
                <Select value={deliveryType} label={t('deliveryType')} onChange={(e: SelectChangeEvent<number>) => setDeliveryType(Number(e.target.value))}>
                  {MNG_DELIVERY_TYPES.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>{t('packagingType')}</InputLabel>
                <Select value={packagingType} label={t('packagingType')} onChange={(e: SelectChangeEvent<number>) => setPackagingType(Number(e.target.value))}>
                  {MNG_PACKAGING_TYPES.map(opt => (
                    <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControlLabel
                control={<Switch checked={isCOD} onChange={e => setIsCOD(e.target.checked)} />}
                label={t('cod')}
              />
              {isCOD && (
                <TextField fullWidth label={`${t('codAmount')} (TRY)`} type="number" value={codAmount} onChange={e => setCodAmount(e.target.value)} size="small" />
              )}

              <FormControlLabel
                control={<Switch checked={smsRecipient} onChange={e => setSmsRecipient(e.target.checked)} />}
                label={t('smsRecipient')}
              />
              <FormControlLabel
                control={<Switch checked={smsDelivery} onChange={e => setSmsDelivery(e.target.checked)} />}
                label={t('smsDelivery')}
              />
            </Box>
          </AccordionDetails>
        </Accordion>

        <Button
          variant="contained"
          fullWidth
          onClick={handleSubmit}
          disabled={loading || !!result}
          sx={{ mt: 3, py: 1.5 }}
        >
          {loading ? t('creating') : result ? t('created') : t('createLabel')}
        </Button>
      </Box>
    </Drawer>
  );
}
