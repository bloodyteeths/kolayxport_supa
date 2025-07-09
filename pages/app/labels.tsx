import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Box, Button, CircularProgress, Tooltip, Dialog, DialogTitle, DialogContent, Snackbar, Alert, TextField, Select, MenuItem, InputLabel, FormControl, IconButton, Typography, Paper, Accordion, AccordionSummary, AccordionDetails, Chip, Drawer, Fade, List, ListItem, ListItemIcon, ListItemText, ToggleButton, ToggleButtonGroup
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel, GridRenderCellParams, GridValueGetter } from '@mui/x-data-grid';
import { Sync as SyncIcon, Refresh as RefreshIcon, Search as SearchIcon, Close as CloseIcon, ExpandMore as ExpandMoreIcon, Edit as EditIcon, Check as CheckIcon, Warning as WarningIcon, Error as ErrorIcon, Info as InfoIcon, Lock as LockIcon } from '@mui/icons-material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { toast, Toaster, Toast } from 'react-hot-toast';
import { useOrders } from '@/lib/hooks/useOrders';
import Layout from '@/components/Layout';
import AppLayout from '@/components/AppLayout';
import CircleIcon from '@mui/icons-material/Circle';
import UPSLabelDrawer from '@/components/UPSLabelDrawer';

// Minimal UIOrder type for UPS drawer
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

// --- Constants for FedEx Dropdowns ---
const FEDEX_SERVICE_TYPES = [
  { value: 'INTERNATIONAL_PRIORITY', label: 'FedEx International Priority®' },
  { value: 'INTERNATIONAL_ECONOMY', label: 'FedEx International Economy®' },
  { value: 'FEDEX_EXPRESS_SAVER', label: 'FedEx Express Saver®' },
  { value: 'FEDEX_GROUND', label: 'FedEx Ground®' },
  { value: 'FEDEX_HOME_DELIVERY', label: 'FedEx Home Delivery®' },
];

const FEDEX_PACKAGING_TYPES = [
  { value: 'FEDEX_PAK', label: 'FedEx Pak' },
  { value: 'FEDEX_BOX', label: 'FedEx Box' },
  { value: 'FEDEX_TUBE', label: 'FedEx Tube' },
  { value: 'FEDEX_ENVELOPE', label: 'FedEx Envelope' },
  { value: 'YOUR_PACKAGING', label: 'Your Packaging' },
];

const FEDEX_PREDEFINED_CONTAINERS = [
  'FEDEX_PAK',
  'FEDEX_ENVELOPE',
  'FEDEX_BOX',
  'FEDEX_SMALL_BOX',
  'FEDEX_MEDIUM_BOX',
  'FEDEX_LARGE_BOX',
  'FEDEX_EXTRA_LARGE_BOX',
  'FEDEX_TUBE'
];

// Allowed label stock types for PDF/PNG labels per FedEx Ship API
const ALLOWED_LABEL_STOCK_TYPES = [
  { value: 'PAPER_4X6',  label: '4 × 6 in' },
  { value: 'PAPER_4X8',  label: '4 × 8 in' },
  { value: 'PAPER_4X9',  label: '4 × 9 in' },
  { value: 'PAPER_4X675', label: '4 × 6.75 in' },
  { value: 'PAPER_85X11_TOP_HALF_LABEL',   label: 'Letter – top ½' },
  { value: 'PAPER_85X11_BOTTOM_HALF_LABEL',label: 'Letter – bottom ½' },
  { value: 'PAPER_LETTER',                 label: 'Letter – full page' },
] as const;

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch (e) {
    console.error('Error formatting date:', e);
    return '—';
  }
}

// Turkish date formatter: dd/MM/yy
function formatDateTr(iso?: string): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear().toString().slice(-2)}`;
  } catch (e) {
    console.error('Error formatting date:', e);
    return '—';
  }
}

// --- Type for API order structure (before flattening) ---
interface LocalUIOrder {
  id: string;
  customerName?: string; // Made optional as it can be derived
  marketplaceOrderDate?: string; // Made optional to reflect potential missing data before syncTimestamp fallback
  orderTotalPrice?: number;
  marketplace?: string;
  marketplaceOrderNumber?: string; // Added this field based on toLabelRows
  orderNumber?: string; // Keep for compatibility if used elsewhere, or consolidate
  customsValue?: number;
  status?: string;
  shippingAddress?: any;
  recipientFirstName?: string; // Already in LocalUIOrder
  recipientLastName?: string;  // Already in LocalUIOrder
  shipByDate?: string;
  fedexServiceType?: string;
  fedexPackagingType?: string;
  imageUrl?: string;
  rawData?: any; // For extractAddress and Shippo notes
  source?: string; // e.g., 'veeqo', 'shippo'
  channel?: string; // e.g., 'etsy'
  currency?: string; // For drawer display
  weightKg?: number; // For label generation
  harmonizedCode?: string; // For label generation
  countryOfMfg?: string; // For label generation
  commodityDesc?: string; // For label generation
  termsOfSale?: string; // For label generation
  sendCommercialInvoiceViaEtd?: boolean; // For label generation
  fedexPickupType?: string; // For label generation
  fedexDutiesPaymentType?: string; // For label generation
  packageLength?: number; // For label generation
  packageWidth?: number; // For label generation
  packageHeight?: number; // For label generation
  dimensionUnits?: string; // For label generation
  labelStockType?: string; // For label generation
  signatureType?: string; // For label generation
  to_address?: any; // For shippo notes
  syncTimestamp?: string; // Added syncTimestamp
  lastShipmentCarrier?: string; // Added for last carrier information
  line_items: Array<{
    sellable?: {
      full_title?: string;
      // You can add more fields if needed in the future
    };

    id: string;
    title?: string;
    value?: number; // This becomes unitPrice in LabelRow
    unitPrice?: number; // Ensure this is present if API sends it
    quantity?: number;
    variantInfo?: string;
    image?: string;
    weight?: number;
    hs_code?: string;
    country_of_origin?: string;
    sku?: string;
    labelJobStatus?: string;
    trackingNumber?: string;
    shipBy?: string;
    labelJobs?: Array<{
      id: string;
      status: string;
      createdAt: string;
      trackingNumber?: string;
      pdfUrl?: string;
      errorMessage?: string;
      carrier?: string;
    }>;
  }>;
}

// --- Canonical Row Model ---
export interface LabelRow {
  // order-level
  orderId: string;
  marketplace: string;
  orderNumber: string;
  orderTotalPrice: number;
  orderDate: string;          // ISO
  status?: string; // Added from LocalUIOrder
  customsValue?: number; // Added
  currency?: string; // Added
  source?: string;
  channel?: string;
  shippingLabelUrl?: string; // Added from previous logic
  createdAt?: string; // Added for sorting
  labelCreated?: boolean; // Added
  lastCarrier?: string; // Added lastCarrier


  // item-level
  itemId: string;
  sku: string;
  title: string; // Added title for display
  quantity: number;
  unitPrice: number;
  weight: number;
  hsCode: string;
  itemImageUrl: string; // Added for product image

  // flattened address
  recipientFirstName: string;
  recipientLastName: string;
  recipientStreet1: string;
  recipientStreet2?: string;
  recipientCity: string;
  recipientState?: string;
  recipientPostal: string;
  recipientCountry: string;
  recipientPhone?: string;

  // For label generation form & actions (can be duplicated from above if needed, or extended)
  fedexServiceType?: string;
  fedexPackagingType?: string;
  countryOfOrigin?: string; // From item.country_of_origin
  labelJobStatus?: string; // From item
  trackingNumber?: string; // From item
  shipByDate?: string; // Effective ship by date

  // Reference to the original full LocalUIOrder if complex data needed for actions not covered by LabelRow
  originalOrder?: LocalUIOrder; 

  // Add labelStockType for UI editing
  labelStockType?: string;
}


const statusColors: Record<string, {bg: string, text: string}> = {
  UNSHIPPED: { bg: '#FFD700', text: '#000' }, // Gold
  PENDING: { bg: '#FFD700', text: '#000' },
  PARTIALLY_SHIPPED: { bg: '#ADD8E6', text: '#000' }, // Light Blue
  SHIPPED: { bg: '#90EE90', text: '#000' }, // Light Green
  DELIVERED: { bg: '#32CD32', text: '#fff' }, // Lime Green
  CANCELLED: { bg: '#F08080', text: '#fff' }, // Light Coral
  REFUNDED: { bg: '#DDA0DD', text: '#000' }, // Plum
  ON_HOLD: { bg: '#FFA500', text: '#000' }, // Orange
  AWAITING_PAYMENT: { bg: '#FFFFE0', text: '#000' }, // Light Yellow
  COMPLETED: { bg: '#388e3c', text: '#fff' }, // Dark Green (for general success)
  LABEL_GENERATED: { bg: '#8A2BE2', text: '#fff' }, // BlueViolet
  FAILED: {bg: '#DC143C', text: '#fff'}, // Crimson for general failure
};

const labelStatusOptions = [
  { value: '', label: 'Tümü (Etiket)' },
  { value: 'created', label: 'Oluşturuldu' },
  { value: 'not_created', label: 'Oluşturulmadı' },
  { value: 'failed', label: 'Hata Alındı' },
];

const integrationOptions = [
  { value: '', label: 'Tümü (Market)' },
  { value: 'Veeqo', label: 'Veeqo' },
  { value: 'Shippo', label: 'Shippo' },
  { value: 'Trendyol', label: 'Trendyol' },
  { value: 'Hepsiburada', label: 'Hepsiburada' },
];

const orderStatusOptions = [
  { value: '', label: 'Tümü (Sipariş)' },
  { value: 'UNSHIPPED', label: 'Hazırlanıyor' },
  { value: 'PENDING', label: 'Beklemede' },
  { value: 'PARTIALLY_SHIPPED', label: 'Kısmen Kargolandı' },
  { value: 'SHIPPED', label: 'Kargolandı' },
  { value: 'DELIVERED', label: 'Teslim Edildi' },
  { value: 'CANCELLED', label: 'İptal Edildi' },
  { value: 'REFUNDED', label: 'İade Edildi' },
  { value: 'ON_HOLD', label: 'Askıya Alındı' },
  { value: 'AWAITING_PAYMENT', label: 'Ödeme Bekliyor' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'FAILED', label: 'Başarısız Oldu' },
];

// --- Debounce utility ---
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

// --- Address mapping utility (already defined in the file) ---
function extractAddress(order: LocalUIOrder) { // Ensure input type matches LocalUIOrder
  let addr = order.shippingAddress;
  if (typeof addr === 'string') {
    try { addr = JSON.parse(addr); } catch { addr = {}; }
  } else if (addr === null || typeof addr !== 'object') { // Handle null or non-object addr
    addr = {};
  }

  let raw = order.rawData;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  } else if (raw === null || typeof raw !== 'object') { // Handle null or non-object raw
    raw = {};
  }
  
  const deliverTo = raw?.deliver_to || {};
  const billing = raw?.billing_address || {};

  const isAnonymized = (value: any) => { // Added type annotation
    if (typeof value !== 'string') return false;
    return value === 'Anonymized by Amazon' || value === 'Anonymized By Amazon' || value.includes('Anonymized');
  };

  const getValue = (...values: any[]) => { // Added type annotation
    for (const v of values) {
      if (v && typeof v === 'string' && v.trim() && !isAnonymized(v)) return v.trim();
    }
    return ''; // Return empty string if no valid value found
  };

  const fallback = (keys: string[]) => { // Added type annotation
    for (const k of keys) {
      if (addr && addr[k] && !isAnonymized(addr[k]) && typeof addr[k] === 'string') return addr[k].trim();
      if (raw && raw[k] && !isAnonymized(raw[k]) && typeof raw[k] === 'string') return raw[k].trim();
    }
    return '';
  };

  // Attempt to construct full name if only combined name is present
  let recipientFirstName = getValue(
    addr?.recipientFirstName, addr?.recipient_first_name, addr?.first_name, 
    deliverTo.first_name, billing.first_name, raw?.first_name,
    fallback(['recipientFirstName','recipient_first_name','first_name'])
  );
  let recipientLastName = getValue(
      addr?.recipientLastName, addr?.recipient_last_name, addr?.last_name,
      deliverTo.last_name, billing.last_name, raw?.last_name,
      fallback(['recipientLastName','recipient_last_name','last_name'])
  );

  if (!recipientFirstName && !recipientLastName) {
    const fullName = getValue(addr?.name, raw?.name, fallback(['name']));
    if (fullName) {
      const nameParts = fullName.split(/\s+/);
      recipientFirstName = nameParts[0] || '';
      recipientLastName = nameParts.slice(1).join(' ') || '';
    }
  }
  
  // If order has direct recipient fields, prioritize them if extractAddress couldn't find better
  recipientFirstName = recipientFirstName || order.recipientFirstName || '';
  recipientLastName = recipientLastName || order.recipientLastName || '';


  return {
    recipientFirstName,
    recipientLastName,
    recipientStreet1: getValue(
      addr?.recipientStreet1, addr?.recipient_street1, addr?.address1, addr?.street1,
      deliverTo.address1, deliverTo.street1, billing.address1, raw?.address1, raw?.street1,
      fallback(['recipientStreet1','recipient_street1','address1','street1'])
    ),
    recipientStreet2: getValue(
      addr?.recipientStreet2, addr?.recipient_street2, addr?.address2, addr?.street2,
      deliverTo.address2, deliverTo.street2, billing.address2, raw?.address2, raw?.street2,
      fallback(['recipientStreet2','recipient_street2','address2','street2'])
    ),
    recipientCity: getValue(
      addr?.recipientCity, addr?.recipient_city, addr?.city,
      deliverTo.city, billing.city, raw?.city,
      fallback(['recipientCity','recipient_city','city'])
    ),
    recipientState: getValue(
      addr?.recipientState, addr?.recipient_state, addr?.state, addr?.province,
      deliverTo.state, deliverTo.province, billing.state, raw?.state, raw?.province,
      fallback(['recipientState','recipient_state','state','province'])
    ),
    recipientPostal: getValue(
      addr?.recipientPostal, addr?.recipient_postal, addr?.zip, addr?.postalCode, addr?.postcode,
      deliverTo.zip, deliverTo.postalCode, deliverTo.postcode, billing.zip, billing.postalCode, billing.postcode, raw?.zip, raw?.postalCode, raw?.postcode,
      fallback(['recipientPostal','recipient_postal','zip','postalCode','postcode'])
    ),
    recipientCountry: getValue(
      addr?.recipientCountry, addr?.recipient_country, addr?.country,
      deliverTo.country, billing.country, raw?.country,
      fallback(['recipientCountry','recipient_country','country'])
    ),
    recipientPhone: getValue(
      addr?.recipientPhone, addr?.recipient_phone, addr?.phone,
      deliverTo.phone, billing.phone, raw?.phone,
      fallback(['recipientPhone','recipient_phone','phone'])
    ),
  };
}


// --- Data Transformation ---
/** convert the API payload (LocalUIOrder[]) into grid-ready rows (LabelRow[]) */
function getProductTitle(item: any, order: any) {
  const isMissing = (val: any) => !val || val === 'Unknown Product';

  let result;
  if (!isMissing(item.title)) {
    result = item.title;
  } else if (!isMissing(order.commodityDesc)) {
    result = order.commodityDesc;
  } else if (!isMissing(item.sellable?.full_title)) {
    result = item.sellable.full_title;
  } else {
    result = 'N/A';
  }
 
  return result;
}

export function toLabelRows(orders: LocalUIOrder[]): LabelRow[] {
  if (!orders) return [];

  return orders.flatMap(order => {
    const addr = extractAddress(order);
    // Safe: Parse rawData ONLY for date mapping, do not mutate or affect other columns
    let safeRaw = order.rawData;
    if (typeof safeRaw === 'string') {
      try { safeRaw = JSON.parse(safeRaw); } catch { safeRaw = {}; }
    }
    let finalOrderDate = safeRaw?.created_at
      || safeRaw?.to_address?.object_created
      || safeRaw?.placed_at
      || safeRaw?.to_address?.object_updated
      || order.marketplaceOrderDate
      || order.syncTimestamp
      || new Date(0).toISOString();

    // If no line items, create a single row for the order
    if (!order.line_items || order.line_items.length === 0) {
      return [{
        orderId: order.id,
        marketplace: order.marketplace ?? '—',
        orderNumber: order.marketplaceOrderNumber || order.orderNumber || '—',
        orderTotalPrice: order.orderTotalPrice ?? 0,
        orderDate: finalOrderDate,
        status: order.status ?? 'N/A',
        customsValue: order.customsValue ?? order.orderTotalPrice ?? 0,
        currency: order.currency || 'USD',
        source: order.source,
        channel: order.channel,
        createdAt: order.marketplaceOrderDate,
        lastCarrier: order.lastShipmentCarrier || order.rawData?.delivery_method?.name || '—',

        itemId: `${order.id}-noitem`,
        sku: '—',
        title: order.commodityDesc || 'N/A (Order Level)',
        quantity: 1,
        unitPrice: order.orderTotalPrice ?? 0,
        weight: order.weightKg ?? 0.5,
        hsCode: order.harmonizedCode ?? '—',
        itemImageUrl: order.imageUrl || '/placeholder.png',

        recipientFirstName: addr.recipientFirstName || '—',
        recipientLastName: addr.recipientLastName || '—',
        recipientStreet1: addr.recipientStreet1 || '—',
        recipientStreet2: addr.recipientStreet2 || '',
        recipientCity: addr.recipientCity || '—',
        recipientState: addr.recipientState || '',
        recipientPostal: addr.recipientPostal || '—',
        recipientCountry: addr.recipientCountry || '—',
        recipientPhone: addr.recipientPhone || '',

        fedexServiceType: order.fedexServiceType,
        fedexPackagingType: order.fedexPackagingType,
        countryOfOrigin: order.countryOfMfg,
        labelJobStatus: undefined,
        trackingNumber: undefined,
        shipByDate: order.shipByDate,
        originalOrder: order,
        labelCreated: false,
        shippingLabelUrl: undefined,
        labelStockType: order.labelStockType,
      }];
    }

    // Map each line item to a row
    return order.line_items.map(item => {
      // Get the latest label job for this item
      const latestLabelJob = item.labelJobs && item.labelJobs.length > 0
        ? item.labelJobs.reduce<typeof item.labelJobs[0] | undefined>((latest, job) => 
            !latest || new Date(job.createdAt) > new Date(latest.createdAt) ? job : latest
          , undefined)
        : null;

     

      return {
        orderId: order.id,
        marketplace: order.marketplace ?? '—',
        orderNumber: order.marketplaceOrderNumber || order.orderNumber || '—',
        orderTotalPrice: order.orderTotalPrice ?? 0,
        orderDate: finalOrderDate,
        status: order.status ?? 'N/A',
        customsValue: order.customsValue ?? order.orderTotalPrice ?? 0,
        currency: order.currency || 'USD',
        source: order.source,
        channel: order.channel,
        createdAt: order.marketplaceOrderDate,
        lastCarrier: order.lastShipmentCarrier || order.rawData?.delivery_method?.name || '—',

        itemId: item.id,
        sku: item.sku ?? '—',
        title: getProductTitle(item, order),
        quantity: item.quantity ?? 0,
        unitPrice: item.unitPrice ?? item.value ?? 0,
        weight: item.weight ?? 0.5,
        hsCode: item.hs_code ?? order.harmonizedCode ?? '—',
        itemImageUrl: item.image || order.imageUrl || '/placeholder.png',

        recipientFirstName: addr.recipientFirstName || '—',
        recipientLastName: addr.recipientLastName || '—',
        recipientStreet1: addr.recipientStreet1 || '—',
        recipientStreet2: addr.recipientStreet2 || '',
        recipientCity: addr.recipientCity || '—',
        recipientState: addr.recipientState || '',
        recipientPostal: addr.recipientPostal || '—',
        recipientCountry: addr.recipientCountry || '—',
        recipientPhone: addr.recipientPhone || '',

        fedexServiceType: order.fedexServiceType,
        fedexPackagingType: order.fedexPackagingType,
        countryOfOrigin: item.country_of_origin || order.countryOfMfg,
        labelJobStatus: latestLabelJob?.status,
        trackingNumber: latestLabelJob?.trackingNumber,
        shipByDate: item.shipBy || order.shipByDate,
        originalOrder: order,
        labelCreated: latestLabelJob?.status === 'created' && !!latestLabelJob?.trackingNumber,
        shippingLabelUrl: latestLabelJob?.status === 'created' && latestLabelJob?.trackingNumber ? `/api/labels/${item.id}/pdf` : undefined,
        labelStockType: order.labelStockType,
      };
    });
  });
}


// --- Utility Functions Updated for LabelRow ---
/** default values for the "Create Label" form */
export function getDefaultValues(row: LabelRow) {
  // Access properties directly from LabelRow
  const effectiveCustomsValue = row.customsValue ?? row.orderTotalPrice ?? 0;
  const effectiveQuantity = (row.quantity && row.quantity > 0) ? row.quantity : 1;
  // Ensure calculatedUnitPrice is not NaN if effectiveQuantity somehow ends up 0, though it's defaulted to 1.
  const calculatedUnitPrice = effectiveQuantity > 0 ? effectiveCustomsValue / effectiveQuantity : 0;

  return {
    weightKg: row.weight || row.originalOrder?.weightKg || 0.5, // Use row.weight (item weight) first
    hsCode: row.hsCode === '—' ? (row.originalOrder?.harmonizedCode || '') : row.hsCode, // HS Code can be optional, default to empty
    countryOfOrigin: row.countryOfOrigin || row.originalOrder?.countryOfMfg || 'TR',
    serviceType: row.fedexServiceType || row.originalOrder?.fedexServiceType || 'FEDEX_INTERNATIONAL_PRIORITY', // Ensure default
    packagingType: row.fedexPackagingType || row.originalOrder?.fedexPackagingType || 'FEDEX_PAK', // Ensure default
    recipientFirstName: row.recipientFirstName === '—' ? '' : row.recipientFirstName,
    recipientLastName: row.recipientLastName === '—' ? '' : row.recipientLastName,
    recipientStreet1: row.recipientStreet1 === '—' ? '' : row.recipientStreet1,
    recipientStreet2: row.recipientStreet2,
    recipientCity: row.recipientCity === '—' ? '' : row.recipientCity,
    recipientState: row.recipientState,
    recipientPostal: row.recipientPostal === '—' ? '' : row.recipientPostal,
    recipientCountry: row.recipientCountry === '—' ? '' : row.recipientCountry,
    recipientPhone: row.recipientPhone,
    // Fields from originalOrder for label generation payload
    commodityDesc: row.title === 'N/A' ? (row.originalOrder?.commodityDesc || row.title) : row.title,
    termsOfSale: row.originalOrder?.termsOfSale || 'DDP',
    sendCommercialInvoiceViaEtd: row.originalOrder?.sendCommercialInvoiceViaEtd ?? true,
    fedexPickupType: row.originalOrder?.fedexPickupType || 'DROP_BOX',
    fedexDutiesPaymentType: row.originalOrder?.fedexDutiesPaymentType || 'SENDER',
    packageLength: row.originalOrder?.packageLength,
    packageWidth: row.originalOrder?.packageWidth,
    packageHeight: row.originalOrder?.packageHeight,
    dimensionUnits: row.originalOrder?.dimensionUnits || 'CM',
    labelStockType: row.originalOrder?.labelStockType || 'PAPER_LETTER',
    signatureType: row.originalOrder?.signatureType || 'NO_SIGNATURE_REQUIRED',
    currency: row.currency || row.originalOrder?.currency || 'USD',
    customsValue: effectiveCustomsValue, // Use the determined effective customs value
    line_items: [{ // Construct a single line item for the label based on the current LabelRow
      id: row.itemId,
      title: row.title === 'N/A' ? (row.originalOrder?.commodityDesc || 'Product') : row.title,
      quantity: effectiveQuantity,
      unitPrice: calculatedUnitPrice, // Use calculated unit price
      weight: row.weight,
      hs_code: row.hsCode === '—' ? (row.originalOrder?.harmonizedCode || '') : row.hsCode,
      country_of_origin: row.countryOfOrigin || row.originalOrder?.countryOfMfg || '',
      sku: row.sku,
    }]
  };
}

/** returns an array of missing-field messages (empty ⇒ row is OK) */
export function validateRowForLabel(row: LabelRow): string[] { // Renamed
  const errors: string[] = [];
  const defaults = getDefaultValues(row); // Use 'defaults'

  // FedEx specific from originalOrder (if available and needed for validation before API call)
  if (!defaults.serviceType || !defaults.packagingType) {
    errors.push('FedEx service / packaging missing');
  }

  // Item details
  if (!row.weight || row.weight <= 0) errors.push('Item Weight is missing or invalid');
  if (!row.title || row.title === 'N/A' || row.title === '—') errors.push('Item Title is missing');
  if (!row.quantity || row.quantity <= 0) errors.push('Item Quantity is missing or invalid');
  // HS Code is now optional, so do not push error for missing HS Code

  // Address details (check for '—' as well as empty)
  if (!row.recipientFirstName || row.recipientFirstName === '—') errors.push('Recipient First Name is missing');
  if (!row.recipientLastName || row.recipientLastName === '—') errors.push('Recipient Last Name is missing');
  if (!row.recipientStreet1 || row.recipientStreet1 === '—') errors.push('Recipient Street address is missing');
  if (!row.recipientCity || row.recipientCity === '—') errors.push('Recipient City is missing');
  if (!row.recipientPostal || row.recipientPostal === '—') errors.push('Recipient Postal code is missing');
  if (!row.recipientCountry || row.recipientCountry === '—') errors.push('Recipient Country is missing');
  // Phone is often optional, so not validating it strictly here unless required by FedEx later
  // if (!row.recipientPhone || row.recipientPhone === '—') errors.push('Recipient Phone is missing');
  
  return errors;
}

function getValidationStatus(row: LabelRow): { status: 'valid' | 'warning' | 'error'; message: string } {
  const errors = validateRowForLabel(row);
  if (errors.length === 0) return { status: 'valid', message: 'Ready for label' };
  
  const criticalErrors = errors.filter(e => 
    e.includes('Street address') || e.includes('City') || e.includes('Postal code') || e.includes('Country') ||
    e.includes('Weight') || e.includes('HS code') || e.includes('Service Type') || e.includes('Packaging Type')
  );
  
  if (criticalErrors.length > 0) {
    return { status: 'error', message: `Critical: ${criticalErrors.join(', ')}` };
  }
  return { status: 'warning', message: `Warnings: ${errors.join(', ')}` };
}


// Add Shippo notes parser helper (already defined in the file, ensure it's kept)
function parseShippoNotes(notes: string): { to_address?: any; success: boolean } {
  try {
    const shippoMatch = notes.match(/to_address\s*:\s*({[^}]+})/);
    if (shippoMatch) {
      const addressJson = shippoMatch[1].replace(/'/g, '"');
      const toAddress = JSON.parse(addressJson);
      return { to_address: toAddress, success: true };
    }
    return { success: false };
  } catch (error) {
    console.error('Failed to parse Shippo notes:', error);
    return { success: false };
  }
}

// Add this before the LabelsPage component
interface LabelFormData {
  fedexPackagingType: string;
  labelStockType: string;
  // Add other fields as needed for the form, e.g. recipientFirstName, etc.
}

// --- UI deduplication helper ---
function dedupeLabelRows(rows: LabelRow[]): LabelRow[] {
  const seen = new Map<string, LabelRow>();
  for (const row of rows) {
    const key = `${(row.marketplace || '').toLowerCase().trim()}-${(row.orderNumber || '').toString().trim().toLowerCase()}`;
    if (!seen.has(key)) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}

function LabelsPage(props: { source?: string; channel?: string }): JSX.Element {
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 100 });
  // --- UPS Drawer State ---
  const [upsDrawerOpen, setUpsDrawerOpen] = useState(false);
  const [selectedOrderForUPS, setSelectedOrderForUPS] = useState<UIOrder | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [marketplaceFilter, setMarketplaceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [labelStatusFilter, setLabelStatusFilter] = useState('');
  const [generatingLabelId, setGeneratingLabelId] = useState<string | null>(null);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [rawOrderDataModalOpen, setRawOrderDataModalOpen] = useState(false);
  const [currentRawData, setCurrentRawData] = useState<Record<string, any> | null>(null);
  const [hasFedexCredentials, setHasFedexCredentials] = useState(false);
  const [checkingFedexCredentials, setCheckingFedexCredentials] = useState(true);
  const [labelFilter, setLabelFilter] = useState<'all' | 'unlabeled' | 'labeled'>('all');
  const [filterStartDate, setFilterStartDate] = useState(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return sevenDaysAgo.toISOString().slice(0, 10);
  });
  const [filterEndDate, setFilterEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [addressSource, setAddressSource] = useState<'default' | 'shippo'>('default');
  const [readOnlyAddress, setReadOnlyAddress] = useState(true);
  const [formData, setFormData] = useState<LabelFormData>({
    fedexPackagingType: '',
    labelStockType: 'PAPER_4X6',
  });

  const debouncedSearch = useDebouncedValue(searchTerm, 300);

  const { 
    orders: fetchedOrders, 
    total, 
    isLoading, 
    isError, 
    mutate 
  } = useOrders(
    1, // page
    500, // pageSize
    {},
    'labelsPage'
  );

  const labelRows: LabelRow[] = useMemo(() => {
    if (!fetchedOrders || !Array.isArray(fetchedOrders)) return [];
    return toLabelRows(fetchedOrders as LocalUIOrder[]);
  }, [fetchedOrders]);

  // Restore label filter tab interactivity
  const handleLabelFilter = (_event: React.MouseEvent<HTMLElement>, value: 'all' | 'unlabeled' | 'labeled' | null) => {
    if (value) setLabelFilter(value);
  };

  const filteredAndPaginatedItems: LabelRow[] = useMemo(() => {
    let rows = labelRows;
    console.log('[Filter Debug] Initial:', rows.length);

    // Label filter
    if (labelFilter === 'unlabeled') {
      rows = rows.filter(r => !r.trackingNumber);
      console.log('[Filter Debug] After labelFilter "unlabeled":', rows.length);
    } else if (labelFilter === 'labeled') {
      rows = rows.filter(r => !!r.trackingNumber);
      console.log('[Filter Debug] After labelFilter "labeled":', rows.length);
    }

    // Date filter
    if (filterStartDate || filterEndDate) {
      rows = rows.filter(r => {
        if (!r.orderDate) return false;
        const orderDateStr = new Date(r.orderDate).toISOString().slice(0, 10);
        if (filterStartDate && orderDateStr < filterStartDate) return false;
        if (filterEndDate && orderDateStr > filterEndDate) return false;
        return true;
      });
      console.log('[Filter Debug] After date filter:', rows.length);
    }


    // Label status filter
    if (labelStatusFilter) {
      rows = rows.filter(r => {
        const match = (r.labelJobStatus || '').toLowerCase().includes(labelStatusFilter.toLowerCase());
        if (!match && labelStatusFilter === 'oluşturulmadı') {
          console.log('[LabelStatusFilter Debug] Not matched:', r.labelJobStatus, 'Expected:', labelStatusFilter);
        }
        return match;
      });
      console.log('[Filter Debug] After labelStatusFilter:', rows.length);
    }

    // Search filter
    if (debouncedSearch) {
      const search = debouncedSearch.toLowerCase();
      rows = rows.filter(r =>
        (r.orderNumber && r.orderNumber.toLowerCase().includes(search)) ||
        (r.recipientFirstName && r.recipientFirstName.toLowerCase().includes(search)) ||
        (r.recipientLastName && r.recipientLastName.toLowerCase().includes(search)) ||
        (r.title && r.title.toLowerCase().includes(search))
      );
      console.log('[Filter Debug] After debouncedSearch:', rows.length);
    }

    return rows;
  }, [labelRows, labelFilter, filterStartDate, filterEndDate, marketplaceFilter, statusFilter, labelStatusFilter, debouncedSearch]);

  useEffect(() => {
    setPaginationModel(prev => ({ ...prev, page: 0 }));
  }, [debouncedSearch, marketplaceFilter, statusFilter, labelStatusFilter, filterStartDate, filterEndDate]);

  useEffect(() => {
    const fetchUserSettings = async () => {
      setCheckingFedexCredentials(true);
      try {
        const response = await fetch('/api/user/settings'); 
        if (!response.ok) {
          console.error('Kullanıcı ayarları alınamadı', response.status);
          setHasFedexCredentials(false);
          return;
        }
        const data = await response.json();
        if (data.integrationSettings) {
          const hasFedex = data.integrationSettings.fedexApiKey &&
            data.integrationSettings.fedexApiSecret &&
                          data.integrationSettings.fedexAccountNumber;
          setHasFedexCredentials(hasFedex);
        } else {
          setHasFedexCredentials(false);
          // toast.error('Lütfen entegrasyon ayarlarınızı tamamlayın.'); // Consider if this toast is too aggressive on load
        }
      } catch (error) {
        console.error('Error fetching user settings for labels page:', error);
        setHasFedexCredentials(false);
        // toast.error('Kullanıcı ayarları alınırken bir hata oluştu.');
      } finally {
        setCheckingFedexCredentials(false);
      }
    };
    fetchUserSettings();
  }, []);

  useEffect(() => {
    console.log('[LabelsPage] fetchedOrders:', fetchedOrders);
    console.log('[LabelsPage] isLoading:', isLoading);
    console.log('[LabelsPage] labelRows:', labelRows);
    console.log('[LabelsPage] DataGrid rows prop:', filteredAndPaginatedItems);
    console.log('[LabelsPage] DataGrid row IDs:', filteredAndPaginatedItems.map(r => r.itemId || r.orderId));
    console.log('[LabelsPage] labelFilter:', labelFilter);
    console.log('[LabelsPage] filterStartDate:', filterStartDate);
    console.log('[LabelsPage] filterEndDate:', filterEndDate);
    console.log('[LabelsPage] marketplaceFilter:', marketplaceFilter);
    console.log('[LabelsPage] statusFilter:', statusFilter);
    console.log('[LabelsPage] labelStatusFilter:', labelStatusFilter);
    console.log('[LabelsPage] debouncedSearch:', debouncedSearch);
  }, [fetchedOrders, isLoading, labelRows, filteredAndPaginatedItems, labelFilter, filterStartDate, filterEndDate, marketplaceFilter, statusFilter, labelStatusFilter, debouncedSearch]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOrder, setDrawerOrder] = useState<LabelRow | null>(null);

  const drawerErrors = useMemo(
    () => (drawerOrder ? validateRowForLabel(drawerOrder) : ['no-row']), // Add 'no-row' or similar to ensure button disabled if no row
    [drawerOrder]
  );

  const openDrawer = (row: LabelRow) => {
    console.log('Opening drawer with LabelRow:', row);
    let currentDrawerData = { ...row }; 
    const defaultsFromRow = getDefaultValues(row);

    currentDrawerData = {
      ...currentDrawerData,
      ...defaultsFromRow,
      recipientFirstName: row.recipientFirstName === '—' ? '' : row.recipientFirstName,
      recipientLastName: row.recipientLastName === '—' ? '' : row.recipientLastName,
      recipientStreet1: row.recipientStreet1 === '—' ? '' : row.recipientStreet1,
      recipientCity: row.recipientCity === '—' ? '' : row.recipientCity,
      recipientPostal: row.recipientPostal === '—' ? '' : row.recipientPostal,
      recipientCountry: row.recipientCountry === '—' ? '' : row.recipientCountry,
      labelStockType: row.labelStockType || 'PAPER_4X6',
      // Ensure line_items for the payload is correctly formed by getDefaultValues
    };
    
    let newAddressSource: 'default' | 'shippo' = 'default';
    if (row.originalOrder?.source === 'veeqo' && row.originalOrder?.channel === 'etsy' && row.originalOrder?.rawData?.notes) {
      const { to_address, success } = parseShippoNotes(row.originalOrder.rawData.notes);
      if (success && to_address) {
        currentDrawerData.recipientFirstName = to_address.name?.split(' ')[0] || currentDrawerData.recipientFirstName;
        currentDrawerData.recipientLastName = to_address.name?.split(' ').slice(1).join(' ') || currentDrawerData.recipientLastName;
        currentDrawerData.recipientStreet1 = to_address.street1 || currentDrawerData.recipientStreet1;
        currentDrawerData.recipientStreet2 = to_address.street2 || currentDrawerData.recipientStreet2 || '';
        currentDrawerData.recipientCity = to_address.city || currentDrawerData.recipientCity;
        currentDrawerData.recipientState = to_address.state || currentDrawerData.recipientState || '';
        currentDrawerData.recipientPostal = to_address.zip || currentDrawerData.recipientPostal;
        currentDrawerData.recipientCountry = to_address.country || currentDrawerData.recipientCountry;
        currentDrawerData.recipientPhone = to_address.phone || currentDrawerData.recipientPhone || '';
        newAddressSource = 'shippo';
        setReadOnlyAddress(true);
      }
    }
    
    setDrawerOrder(currentDrawerData);
    setDrawerOpen(true);
    setAddressSource(newAddressSource);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
    setReadOnlyAddress(true);
  };

  const columns: GridColDef<LabelRow>[] = [
    {
      field: 'labelStatus',
      headerName: 'Etiket',
      width: 110,
      sortable: false,
      valueGetter: (_value, row) => {
        if (!row) return '—'; // Defensive check
        if (row.trackingNumber) return 'Alındı';
        if (row.labelJobStatus === 'failed') return 'Hata';
        if (row.labelJobStatus === 'created') return 'Alındı';
        if (row.labelJobStatus === 'pending') return 'Bekliyor';
        return 'Etiketsiz';
      },
      renderCell: (params: GridRenderCellParams<LabelRow, string>) => {
        const status = params.value;
        if (status === 'Alındı') {
          const trackingNumber = params.row.trackingNumber;
          return (
            <Tooltip title="Etiket Alındı">
              <span
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (trackingNumber) {
                    await navigator.clipboard.writeText(trackingNumber);
                    toast.success('takip numarası kopyalandı.', { duration: 1500 });
                  }
                }}
              >
                <CheckCircleIcon color="success" />
              </span>
            </Tooltip>
          );
        }
        if (status === 'Hata')     return <Tooltip title="Etiketleme Hatası"><CancelIcon color="error" /></Tooltip>;
        if (status === 'Bekliyor') return <Tooltip title="Etiket İşleniyor/Bekliyor"><HourglassEmptyIcon color="warning" /></Tooltip>;
        return <Tooltip title="Etiket Oluşturulmadı"><CircleIcon color="disabled" /></Tooltip>;
      },
    },
    {
      field: 'itemImageUrl',
      headerName: 'Ürün Görseli',
      width: 70,
      sortable: false,
      renderCell: (params: GridRenderCellParams<LabelRow>) => (
        <img
          src={params.value as string || '/placeholder.png'} 
          alt="Ürün Görseli"
          style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 8 }}
          onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.png'; }}
        />
      )
    },
    { field: 'marketplace', headerName: 'Mağaza', width: 110 },
    {
      field: 'orderDate', 
      headerName: 'Sipariş Tarihi', 
      width: 130,
      valueFormatter: (value: string | undefined) => formatDateTr(value), // Turkish style
      sortable: true,
      sortComparator: (v1, v2) => new Date(v1).getTime() - new Date(v2).getTime(), // newest to oldest
    },
    { field: 'orderNumber', headerName: 'Sipariş No', width: 110 },
    {
      field: 'customerSevk',
      headerName: 'Müşteri Sevk',
      width: 160,
      valueGetter: (_value, row) => `${row.recipientFirstName || ''} ${row.recipientLastName || ''}`.trim() || row.originalOrder?.customerName || '—'
    },
    { 
      field: 'orderTotalPrice', 
      headerName: 'Toplam', 
      width: 80, 
      type: 'number',
      renderCell: (params: GridRenderCellParams<LabelRow>) => (
        <Typography variant="body2">
          {params.value != null && params.value > 0 ? `${(params.value as number).toFixed(2)} ${params.row.currency || ''}`.trim() : '—'}
        </Typography>
      )
    },
    { field: 'title', headerName: 'Ürün Adı', width: 180 },
    { field: 'quantity', headerName: 'Adet', width: 60, type: 'number' },
    { 
      field: 'shipByDate', 
      headerName: 'Son Kargo Tarihi',
      width: 130,
      valueFormatter: (value: string | undefined) => value ? formatDate(value) : '—',
    },
    { 
      field: 'lastCarrier', 
      headerName: 'Kargo Firması', 
      width: 140, 
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        // Try to get the latest label job's carrier
        const labelJobs = params.row.originalOrder?.line_items?.find(i => i.id === params.row.itemId)?.labelJobs || [];
        const latestLabelJob = labelJobs.length > 0 ? labelJobs[0] : null;
        const carrier = latestLabelJob?.carrier || params.row.lastCarrier;
        if (carrier === 'FEDEX') {
          if (latestLabelJob?.pdfUrl) {
            return (
              <a
                href={latestLabelJob.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block' }}
                title="Etiketi aç"
              >
                <img src="/images/FedEx-Logo-PNG-Transparent.png" alt="FedEx" style={{ height: 16, marginLeft: 2, cursor: 'pointer' }} />
              </a>
            );
          }
          return <img src="/images/FedEx-Logo-PNG-Transparent.png" alt="FedEx" style={{ height: 16, marginLeft: 2 }} title="FedEx" />;
        }
        if (carrier === 'UPS') {
          if (latestLabelJob?.pdfUrl) {
            return (
              <a
                href={latestLabelJob.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block' }}
                title="Etiketi aç"
              >
                <img src="/images/United_Parcel_Service_logo_2014.svg.png" alt="UPS" style={{ height: 16, marginLeft: 2, cursor: 'pointer' }} />
              </a>
            );
          }
          return <img src="/images/United_Parcel_Service_logo_2014.svg.png" alt="UPS" style={{ height: 16, marginLeft: 2 }} title="UPS" />;
        }
        return carrier || '—';
      }
    },
    {
      field: 'actions',
      headerName: 'Detaylar',
      width: 140,
      minWidth: 120,
      sortable: false,
      renderCell: (params: GridRenderCellParams<LabelRow>) => (
        <>
          <IconButton onClick={() => openDrawer(params.row as LabelRow)} size="small">
            <EditIcon fontSize="small"/>
          </IconButton>
          <Button size="small" variant="outlined" sx={{ml:1}} onClick={() => { 
            console.log('[UPS DEBUG] UPS button clicked', params.row);
            setSelectedOrderForUPS(params.row); 
            setUpsDrawerOpen(true); 
          }}>
            UPS
          </Button>
        </>
      )
    },
  ];

  const handleSync = async () => {
    setSyncingOrders(true);
    const toastId = toast.loading('Siparişler senkronize ediliyor...');
    try {
      // Fast sync: only first page from Shippo and Veeqo
      const res = await fetch('/api/orders/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ syncType: 'fast' })
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Bilinmeyen hata');
      }
      toast.success('Siparişler başarıyla senkronize edildi!', { id: toastId });
      // Optionally refresh data after sync
      mutate && mutate();
    } catch (e: any) {
      toast.error(`Senkronizasyon hatası: ${e.message}`, { id: toastId });
    } finally {
      setSyncingOrders(false);
    }
  };


  const handleRefresh = () => {
    const toastId = toast.loading('Siparişler yenileniyor...');
    mutate().then(() => {
      toast.success('Siparişler yenilendi.', { id: toastId });
    }).catch(() => {
      toast.error('Siparişler yenilenirken hata oluştu.', { id: toastId });
    });
  };
  
  const handleGenerateLabel = async (rowForLabel: LabelRow) => {
    if (!hasFedexCredentials) {
      toast.error('Etiket oluşturmak için FedEx ayarlarınızı tamamlamanız gerekmektedir.');
      return;
    }
    const currentFormValues = drawerOpen && drawerOrder ? drawerOrder : rowForLabel;
    
    const validationErrors = validateRowForLabel(currentFormValues);
    if (validationErrors.length > 0) {
      toast.error(`Lütfen eksik alanları doldurun: ${validationErrors.join(', ')}`);
      return;
    }

    setGeneratingLabelId(currentFormValues.itemId);
    const toastLabelId = toast.loading(`'${currentFormValues.orderNumber}' için etiket ve DB güncelleme işlemi başlatılıyor...`);
    
    try {
      // Step 1: Update order details in DB via /api/orders/update
      // Patch: Map UI model to backend schema fields for DB update
      // - Always use id (not orderId)
      // - Group address fields into shippingAddress as required by backend
      // - Prevents data loss and Prisma errors
      const {
        orderId,
        recipientFirstName,
        recipientLastName,
        recipientStreet1,
        recipientStreet2,
        recipientCity,
        recipientState,
        recipientPostal,
        recipientCountry,
        recipientPhone,
        ...rest
      } = currentFormValues;
      const dbUpdatePayload = {
        id: orderId,
        shippingAddress: {
          firstName: recipientFirstName,
          lastName: recipientLastName,
          street1: recipientStreet1,
          street2: recipientStreet2,
          city: recipientCity,
          state: recipientState,
          postal: recipientPostal,
          country: recipientCountry,
          phone: recipientPhone,
        },
        ...rest,
        commodityDesc: getDefaultValues(currentFormValues).commodityDesc // preserve logic for commodityDesc
      };

      const dbUpdateResponse = await fetch('/api/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdatePayload),
      });

      if (!dbUpdateResponse.ok) {
        const errorData = await dbUpdateResponse.json().catch(() => ({ error: 'Veritabanı güncelleme sırasında bir hata oluştu.' }));
        toast.error(errorData.error || errorData.details || `Veritabanı güncellemesi başarısız: ${dbUpdateResponse.statusText || dbUpdateResponse.status}`, { id: toastLabelId });
        setGeneratingLabelId(null);
        return; // Stop if DB update fails
      }
      toast.success('Sipariş detayları kaydedildi.', { id: toastLabelId, duration: 2000 });
      toast.loading(`'${currentFormValues.orderNumber}' için etiket oluşturuluyor...`, { id: toastLabelId }); // Update toast message

      // Step 2: Prepare payload for /update-options (FedEx specific options)
      const defaultsForFedexPayload = getDefaultValues(currentFormValues);
      const fedexOptionsPayload = {
        orderId: currentFormValues.orderId, // Not strictly needed in body if in URL, but good for consistency
        shippingAddress: {
          firstName: currentFormValues.recipientFirstName,
          lastName: currentFormValues.recipientLastName,
          street1: currentFormValues.recipientStreet1,
          street2: currentFormValues.recipientStreet2,
          city: currentFormValues.recipientCity,
          state: currentFormValues.recipientState,
          postal: currentFormValues.recipientPostal,
          country: currentFormValues.recipientCountry,
          phone: currentFormValues.recipientPhone,
        },
        line_items: defaultsForFedexPayload.line_items,
        weightKg: defaultsForFedexPayload.weightKg,
        harmonizedCode: defaultsForFedexPayload.hsCode,
        countryOfMfg: defaultsForFedexPayload.countryOfOrigin,
        commodityDesc: defaultsForFedexPayload.commodityDesc,
        termsOfSale: defaultsForFedexPayload.termsOfSale,
        sendCommercialInvoiceViaEtd: defaultsForFedexPayload.sendCommercialInvoiceViaEtd,
        fedexServiceType: defaultsForFedexPayload.serviceType,
        fedexPackagingType: defaultsForFedexPayload.packagingType,
        fedexPickupType: defaultsForFedexPayload.fedexPickupType,
        fedexDutiesPaymentType: defaultsForFedexPayload.fedexDutiesPaymentType,
        packageLength: defaultsForFedexPayload.packageLength,
        packageWidth: defaultsForFedexPayload.packageWidth,
        packageHeight: defaultsForFedexPayload.packageHeight,
        dimensionUnits: defaultsForFedexPayload.dimensionUnits,
        labelStockType: defaultsForFedexPayload.labelStockType,
        signatureType: defaultsForFedexPayload.signatureType,
        customsValue: defaultsForFedexPayload.customsValue, 
        currency: defaultsForFedexPayload.currency,
      };

      const saveOptionsResponse = await fetch(`/api/orders/${currentFormValues.orderId}/update-options`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fedexOptionsPayload)
      });

      if (!saveOptionsResponse.ok) {
        const errData = await saveOptionsResponse.json().catch(() => ({ error: 'FedEx seçenekleri kaydedilemedi.'}));
        // Surface the error message from the API if it's a 400 (validation error)
        throw new Error(errData.error || `FedEx seçenekleri kaydedilemedi: ${saveOptionsResponse.status}`);
      }
      // toast.success('FedEx seçenekleri kaydedildi.', { id: toastLabelId, duration: 2000 }); // Optional success toast

      // Step 3: Generate Label
      const bodyForGenerateLabel = {
        // Fields from fedexOptionsPayload that generate-label might expect
        line_items: fedexOptionsPayload.line_items,
        weightKg: fedexOptionsPayload.weightKg,
        harmonizedCode: fedexOptionsPayload.harmonizedCode,
        countryOfMfg: fedexOptionsPayload.countryOfMfg,
        commodityDesc: fedexOptionsPayload.commodityDesc,
        termsOfSale: fedexOptionsPayload.termsOfSale,
        sendCommercialInvoiceViaEtd: fedexOptionsPayload.sendCommercialInvoiceViaEtd,
        // Use serviceType and packagingType from defaultsForFedexPayload for these specific fields
        fedexServiceType: defaultsForFedexPayload.serviceType, 
        fedexPackagingType: defaultsForFedexPayload.packagingType,
        // Other fedex options come from fedexOptionsPayload which uses the full names
        fedexPickupType: fedexOptionsPayload.fedexPickupType,
        fedexDutiesPaymentType: fedexOptionsPayload.fedexDutiesPaymentType,
        packageLength: fedexOptionsPayload.packageLength,
        packageWidth: fedexOptionsPayload.packageWidth,
        packageHeight: fedexOptionsPayload.packageHeight,
        dimensionUnits: fedexOptionsPayload.dimensionUnits,
        labelStockType: fedexOptionsPayload.labelStockType,
        signatureType: fedexOptionsPayload.signatureType,
        customsValue: fedexOptionsPayload.customsValue,
        currency: fedexOptionsPayload.currency,

        // Explicitly add address fields from defaultsForFedexPayload (which is getDefaultValues(currentFormValues))
        recipientFirstName: defaultsForFedexPayload.recipientFirstName,
        recipientLastName: defaultsForFedexPayload.recipientLastName,
        recipientStreet1: defaultsForFedexPayload.recipientStreet1,
        recipientStreet2: defaultsForFedexPayload.recipientStreet2,
        recipientCity: defaultsForFedexPayload.recipientCity,
        recipientState: defaultsForFedexPayload.recipientState,
        recipientPostal: defaultsForFedexPayload.recipientPostal,
        recipientCountry: defaultsForFedexPayload.recipientCountry,
        recipientPhone: defaultsForFedexPayload.recipientPhone,

        // And orderId / orderItemId
        orderId: currentFormValues.orderId, // Ensure orderId is at top level
        orderItemId: currentFormValues.itemId
      };

      const labelResponse = await fetch(`/api/orders/${currentFormValues.orderId}/generate-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyForGenerateLabel) 
      });

      if (!labelResponse.ok) {
        let errorMsg = `Etiket oluşturma hatası (HTTP ${labelResponse.status})`;
        try {
          const errorData = await labelResponse.json();
          errorMsg = errorData.error || errorData.message || errorMsg;
        } catch (jsonError) {
          const textError = await labelResponse.text();
            errorMsg = textError.substring(0,200) || 'Etiket oluşturulurken bilinmeyen bir sunucu hatası oluştu.'; 
        }
        throw new Error(errorMsg);
      }
      const labelData = await labelResponse.json();
      toast.success(`'${currentFormValues.orderNumber}' için etiket oluşturuldu! Takip No: ${labelData.trackingNumber}`, { id: toastLabelId, duration: 6000 });
      if (labelData.labelUrl) window.open(labelData.labelUrl, '_blank', 'noopener,noreferrer');
      if (labelData.alerts && labelData.alerts.length > 0) {
        labelData.alerts.forEach((alert: any) => {
          toast.custom(
            <Alert severity={alert.type?.toLowerCase() || 'warning'} onClose={() => toast.dismiss()}>
              {alert.message || JSON.stringify(alert)}
            </Alert>,
            { duration: 8000 }
          );
        });
      }
      await mutate();
      if (drawerOpen) closeDrawer();
    } catch (error: any) {
      console.error('Error in handleGenerateLabel process:', error);
      toast.error(error.message || 'İşlem sırasında bilinmeyen bir hata oluştu.', { id: toastLabelId, duration: 8000 });
    } finally {
      setGeneratingLabelId(null);
    }
  };

  const handleViewRawData = (data: Record<string, any>) => {
    setCurrentRawData(data);
    setRawOrderDataModalOpen(true);
  };

  return (
    <Box sx={{ height: 'calc(100vh - 64px - 48px)', display: 'flex', flexDirection: 'column', p: 2 }}>
  {/* ...content... */}

      <Toaster position="top-right" reverseOrder={false} />
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 'bold', mb: 2 }}>
        Etiket Yönetimi
      </Typography>
      <Box sx={{ display:'flex', flexDirection:'column', gap:1, mb:2 }}>
        <Paper elevation={1} sx={{ p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap', rowGap: 2 }}>
          <Button variant="contained" color="primary" startIcon={<SyncIcon />} onClick={handleSync} disabled={syncingOrders || isLoading} sx={{ textTransform: 'none', height: '40px', minWidth: 180, flexGrow: 1, mb: { xs: 1, sm: 0 } }}>
          {syncingOrders ? 'Senkronize Ediliyor...' : 'Siparişleri Senkron Et'}
        </Button>
          <TextField size="small" label="Ara..." variant="outlined" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} InputProps={{ endAdornment: <SearchIcon fontSize="small" /> }} sx={{ minWidth: 200, flexGrow: 1, height: '40px', mb: { xs: 1, sm: 0 } }}/>
          <FormControl size="small" variant="outlined" sx={{ minWidth: 170, flexGrow: 1, height: '40px', mb: { xs: 1, sm: 0 } }}>
            <InputLabel shrink={true}>Marketplace</InputLabel>
            <Select value={marketplaceFilter} label="Marketplace" onChange={e => setMarketplaceFilter(e.target.value)} displayEmpty>
            {integrationOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </Select>
        </FormControl>
          <FormControl size="small" variant="outlined" sx={{ minWidth: 170, flexGrow: 1, height: '40px', mb: { xs: 1, sm: 0 } }}>
            <InputLabel shrink={true}>Sipariş Durumu</InputLabel>
            <Select value={statusFilter} label="Sipariş Durumu" onChange={e => setStatusFilter(e.target.value)} displayEmpty>
            {orderStatusOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </Select>
        </FormControl>
          <FormControl size="small" variant="outlined" sx={{ minWidth: 170, flexGrow: 1, height: '40px', mb: { xs: 1, sm: 0 } }}>
            <InputLabel shrink={true}>Etiket Durumu</InputLabel>
            <Select value={labelStatusFilter} label="Etiket Durumu" onChange={e => setLabelStatusFilter(e.target.value)} displayEmpty>
            {labelStatusOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </Select>
        </FormControl>
          <TextField label="Başlangıç Tarihi" type="date" value={filterStartDate} onChange={e => { setFilterStartDate(e.target.value); }} size="small" InputLabelProps={{ shrink: true }} sx={{ minWidth: 150, flexGrow: 1, height: '40px', mb: { xs: 1, sm: 0 } }} />
          <TextField label="Bitiş Tarihi" type="date" value={filterEndDate} onChange={e => { setFilterEndDate(e.target.value); }} size="small" InputLabelProps={{ shrink: true }} sx={{ minWidth: 150, flexGrow: 1, height: '40px', mb: { xs: 1, sm: 0 } }} />
          <Button onClick={() => { setSearchTerm(''); setMarketplaceFilter(''); setStatusFilter(''); setLabelStatusFilter(''); setLabelFilter('all'); const now = new Date(); const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); setFilterStartDate(sevenDaysAgo.toISOString().slice(0, 10)); setFilterEndDate(now.toISOString().slice(0, 10)); }} variant="outlined" sx={{ ml: 'auto', height: '40px', minWidth: 100, flexGrow: 1, mb: { xs: 1, sm: 0 } }}>Sıfırla</Button>
        <Tooltip title="Sipariş Listesini Yenile">
            <span><IconButton onClick={handleRefresh} disabled={isLoading || syncingOrders} color="primary" sx={{ height: '40px', width: '40px', mb: { xs: 1, sm: 0 } }}><RefreshIcon /></IconButton></span>
        </Tooltip>
      </Paper>
        
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={labelFilter}
            onChange={handleLabelFilter}
            aria-label="Etiket filtresi"
          >
            <ToggleButton value="all" aria-label="Tümü">Tümü</ToggleButton>
            <ToggleButton value="unlabeled" aria-label="Etiketsiz">Etiketsiz</ToggleButton>
            <ToggleButton value="labeled" aria-label="Etiket Alındı">Alındı</ToggleButton>
          </ToggleButtonGroup>
          {/* Placeholder for any other controls on the right if needed */}
        </Box>
      </Box>

      <Box sx={{ flexGrow: 1, width: '100%', overflow: 'hidden' }}>
        <DataGrid
          rows={filteredAndPaginatedItems}
          columns={columns}
          pageSizeOptions={[20, 50, 100]}
          pagination
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          paginationMode="client"
          loading={isLoading}
          getRowId={(row: LabelRow) => row.itemId || row.orderId}
          initialState={{ sorting: { sortModel: [{ field: 'orderDate', sort: 'desc' }] } }}
          sortingMode="client"
          sx={{ backgroundColor: 'white', borderRadius: 2, boxShadow: 1, border: 'none', '& .MuiDataGrid-columnHeaders': { position: 'sticky', top: 0, background: '#f7f7fa', zIndex: 1 }, '& .MuiDataGrid-row:nth-of-type(even)': { background: '#fafbfc' }, '& .MuiDataGrid-row:hover': { background: '#f5faff' }, fontSize: '0.875rem', height: '100%' }}
          density="compact"
        />
      </Box>

      {drawerOrder && (
        <Drawer anchor="right" open={drawerOpen} onClose={closeDrawer} PaperProps={{ sx: { width: {xs: '90%', sm: 450, md: 500}, p: {xs: 1, sm: 2} } }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box display="flex" alignItems="center" justifyContent="space-between" mb={1} p={1} sx={{borderBottom: '1px solid', borderColor: 'divider'}}>
              <Typography variant="h6">Sipariş Detayları</Typography>
              <IconButton onClick={closeDrawer} size="small"><CloseIcon /></IconButton>
            </Box>
            <Box sx={{ overflowY: 'auto', p: {xs: 1, sm: 2}, flexGrow: 1 }}>
              {drawerErrors.length > 0 && drawerErrors[0] !== 'no-row' && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Düzeltilmesi Gerekenler:</Typography>
                  <List dense sx={{pl:1}}>
                    {drawerErrors.map((error, index) => (
                      <ListItem key={index} sx={{py:0}}>
                        <ListItemIcon sx={{minWidth: 20}}><ErrorIcon color="error" fontSize="inherit" /></ListItemIcon>
                        <ListItemText primary={error} primaryTypographyProps={{ variant: 'caption', color: 'error.main' }}/>
                      </ListItem>
                    ))}
                  </List>
                </Alert>
              )}
              <Typography variant="overline" display="block" gutterBottom>
                Sipariş No: {drawerOrder.orderNumber} (Ürün SKU: {drawerOrder.sku || 'N/A'})
              </Typography>
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="subtitle2">Alıcı Bilgileri</Typography></AccordionSummary>
                <AccordionDetails sx={{p:1}}>
                  <TextField fullWidth margin="dense" size="small" label="Ad" name="recipientFirstName" value={drawerOrder.recipientFirstName || ''} error={drawerErrors.some(e => e.toLowerCase().includes('first name'))} helperText={drawerErrors.some(e => e.toLowerCase().includes('first name')) ? 'Gerekli' : ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const { name, value } = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Soyad" name="recipientLastName" value={drawerOrder.recipientLastName || ''} error={drawerErrors.some(e => e.toLowerCase().includes('last name'))} helperText={drawerErrors.some(e => e.toLowerCase().includes('last name')) ? 'Gerekli değil ama önerilir' : ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const { name, value } = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Telefon" name="recipientPhone" value={drawerOrder.recipientPhone || ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const {name, value} = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Adres Satırı 1" name="recipientStreet1" value={drawerOrder.recipientStreet1 || ''} error={drawerErrors.some(e => e.toLowerCase().includes('street address'))} helperText={drawerErrors.some(e => e.toLowerCase().includes('street address')) ? 'Gerekli' : ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const { name, value } = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Adres Satırı 2" name="recipientStreet2" value={drawerOrder.recipientStreet2 || ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const {name, value} = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Şehir" name="recipientCity" value={drawerOrder.recipientCity || ''} error={drawerErrors.some(e => e.toLowerCase().includes('city'))} helperText={drawerErrors.some(e => e.toLowerCase().includes('city')) ? 'Gerekli' : ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const { name, value } = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Eyalet/Bölge" name="recipientState" value={drawerOrder.recipientState || ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const {name, value} = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Posta Kodu" name="recipientPostal" value={drawerOrder.recipientPostal || ''} error={drawerErrors.some(e => e.toLowerCase().includes('postal code'))} helperText={drawerErrors.some(e => e.toLowerCase().includes('postal code')) ? 'Gerekli' : ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const { name, value } = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  <TextField fullWidth margin="dense" size="small" label="Ülke" name="recipientCountry" value={drawerOrder.recipientCountry || ''} error={drawerErrors.some(e => e.toLowerCase().includes('country'))} helperText={drawerErrors.some(e => e.toLowerCase().includes('country')) ? 'Gerekli' : ''} disabled={addressSource === 'shippo' && readOnlyAddress} onChange={(e) => { const { name, value } = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }} />
                  {addressSource === 'shippo' && <Button size="small" onClick={() => setReadOnlyAddress(!readOnlyAddress)} sx={{mt:1}}>{readOnlyAddress ? 'Adresi Düzenle' : 'Değişiklikleri Kilitle'}</Button>}
                </AccordionDetails>
              </Accordion>

              <TextField
                label="Toplam (Order Total)"
                fullWidth
                margin="dense"
                size="small" 
                value={drawerOrder.orderTotalPrice?.toFixed(2) + (drawerOrder.currency ? ' ' + drawerOrder.currency : '') || '0.00'}
                InputProps={{ readOnly: true }}
                InputLabelProps={{ shrink: true }}
              />

              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}><Typography variant="subtitle2">Ürün ve Kargo Detayları</Typography></AccordionSummary>
                <AccordionDetails sx={{p:1}}>
                  <TextField label="Ürün Adı (Beyan için)" fullWidth margin="dense" size="small" name="title" value={drawerOrder.title || ''} 
                      onChange={(e) => {
                      const {name, value} = e.target; 
                      setDrawerOrder(prev => prev ? { 
                        ...prev, 
                        title: value, // Update title on LabelRow
                        originalOrder: prev.originalOrder ? {...prev.originalOrder, commodityDesc: value } : undefined // Also update originalOrder.commodityDesc if exists
                      } : null);
                    }} 
                    InputLabelProps={{ shrink: true }}
                    error={drawerErrors.some(e => e.toLowerCase().includes('title'))} 
                    helperText={drawerErrors.some(e => e.toLowerCase().includes('title')) ? 'Gerekli' : ''}
                  />
                  <TextField label="Ağırlık (kg)" type="number" fullWidth margin="dense" size="small" name="weight" value={drawerOrder.weight || 0} error={drawerErrors.some(e => e.toLowerCase().includes('weight'))} helperText={drawerErrors.some(e => e.toLowerCase().includes('weight')) ? 'Gerekli' : ''} onChange={(e) => { const value = parseFloat(e.target.value) || 0; setDrawerOrder(prev => prev ? { ...prev, weight: value } : null);}} InputLabelProps={{ shrink: true }}/>
                  <TextField label="HS Kodu" fullWidth margin="dense" size="small" name="hsCode" value={drawerOrder.hsCode || ''} 
                    error={drawerErrors.some(e => e.toLowerCase().includes('hs code'))} 
                    helperText={drawerErrors.some(e => e.toLowerCase().includes('hs code')) ? 'Gerekli değil ama önerilir' : ''} 
                    onChange={(e) => { const { name, value } = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }}
                  />
                  <TextField label="Menşei Ülke (Örn: TR)" fullWidth margin="dense" size="small" name="countryOfOrigin" value={drawerOrder.countryOfOrigin || ''} onChange={(e) => { const {name, value} = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value } : null);}} InputLabelProps={{ shrink: true }}/>
                  <FormControl fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.toLowerCase().includes('service type'))}>
                    <InputLabel>Servis Tipi</InputLabel>
                    <Select name="fedexServiceType" 
                      value={drawerOrder.fedexServiceType || ''} 
                      defaultValue={drawerOrder.fedexServiceType || 'FEDEX_INTERNATIONAL_PRIORITY'}
                      label="Servis Tipi" 
                      onChange={(e) => { const {name, value} = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value as string } : null);}} 
                  >
                    {FEDEX_SERVICE_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                  </Select>
                  {drawerErrors.some(e => e.toLowerCase().includes('service type')) && <Typography variant="caption" color="error" sx={{pl:2}}>Gerekli</Typography>}
                </FormControl>
                  <FormControl fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.toLowerCase().includes('packaging type'))}>
                    <InputLabel>Paket Tipi</InputLabel>
                    <Select name="fedexPackagingType" 
                      value={drawerOrder.fedexPackagingType || ''} 
                      defaultValue={drawerOrder.fedexPackagingType || 'FEDEX_PAK'}
                      label="Paket Tipi" 
                      onChange={(e) => { const {name, value} = e.target; setDrawerOrder(prev => prev ? { ...prev, [name]: value as string } : null);}}
                  >
                    {FEDEX_PACKAGING_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                  </Select>
                  {drawerErrors.some(e => e.toLowerCase().includes('packaging type')) && <Typography variant="caption" color="error" sx={{pl:2}}>Gerekli</Typography>}
                </FormControl>
                {/* Label Stock Type Dropdown */}
                <FormControl fullWidth margin="dense" size="small">
                  <InputLabel>Etiket Boyutu</InputLabel>
                  <Select
                    name="labelStockType"
                    value={drawerOrder.labelStockType || 'PAPER_4X6'}
                    label="Etiket Boyutu"
                    onChange={e => {
                      const { name, value } = e.target;
                      setDrawerOrder(prev => prev ? { ...prev, [name]: value as string } : null);
                    }}
                  >
                    {ALLOWED_LABEL_STOCK_TYPES.map(opt => (
                      <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                </AccordionDetails>
              </Accordion>

              <Box sx={{ p: {xs:1, sm:2}, borderTop: '1px solid', borderColor: 'divider', mt: 'auto' }}> {/* Sticky footer for actions */}
                <Button fullWidth variant="contained" color="primary" 
                  onClick={() => drawerOrder && handleGenerateLabel(drawerOrder)} 
                  disabled={drawerErrors.length > 0 || generatingLabelId === drawerOrder?.itemId || checkingFedexCredentials || !hasFedexCredentials}
                >
                  {generatingLabelId === drawerOrder?.itemId ? <CircularProgress size={24} color="inherit" /> : (checkingFedexCredentials ? 'Ayarlar Kontrol Ediliyor...': (!hasFedexCredentials ? 'FedEx Ayarları Eksik' : 'ETİKET OLUŞTUR'))}
                </Button>
                <Button fullWidth variant="text" onClick={closeDrawer} sx={{mt:1}}>İptal</Button>
              </Box>
            </Box>
          </Box>
        </Drawer>
      )}

{/* UPS Drawer mount (outside all Grids, Drawers, Accordions, etc.) */}
{selectedOrderForUPS && (
  <UPSLabelDrawer
    open={upsDrawerOpen}
    onClose={() => setUpsDrawerOpen(false)}
    order={selectedOrderForUPS}
    onSaved={mutate}
  />
)}
</Box>
  );
}

export default function LabelsPageWithLayout(props: any): JSX.Element {
  return (
    <AppLayout title="Etiket Yönetimi">
      <LabelsPage {...props} />
    </AppLayout>
  );
}
