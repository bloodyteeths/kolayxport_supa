import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  Box, Button, CircularProgress, Tooltip, Dialog, DialogTitle, DialogContent, Snackbar, Alert, TextField, Select, MenuItem, InputLabel, FormControl, IconButton, Typography, Paper, Accordion, AccordionSummary, AccordionDetails, Chip, Drawer, Fade, List, ListItem, ListItemIcon, ListItemText, ToggleButton, ToggleButtonGroup, Grid, SelectChangeEvent
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel, GridRenderCellParams, GridValueGetter } from '@mui/x-data-grid';
import { Sync as SyncIcon, Refresh as RefreshIcon, Search as SearchIcon, Close as CloseIcon, ExpandMore as ExpandMoreIcon, Edit as EditIcon, Check as CheckIcon, Warning as WarningIcon, Error as ErrorIcon, Info as InfoIcon, Lock as LockIcon, FlightTakeoff as FlightTakeoffIcon, Flight as FlightIcon } from '@mui/icons-material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { toast, Toaster, Toast } from 'react-hot-toast';
import { useOrders } from '@/lib/hooks/useOrders';
import Layout from '@/components/Layout';
import AppLayout from '@/components/AppLayout';
import CircleIcon from '@mui/icons-material/Circle';
import UPSLabelDrawer from '@/components/UPSLabelDrawer';
import { isEtsyOrderSync } from '@/lib/utils/etsyDetection';

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
  recipientEmail?: string;
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

// Veeqo Carrier IDs for tracking submission
const VEEQO_CARRIERS = [
  { value: 1, label: 'Royal Mail' },
  { value: 2, label: 'FedEx' },
  { value: 3, label: 'Diğer' },
  { value: 4, label: 'DPD' },
  { value: 5, label: 'UPS' },
  { value: 7, label: 'USPS' },
  { value: 9, label: 'DHL' },
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
  totalPrice?: number; // Added for DB compatibility (alternative to orderTotalPrice)
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
  trackingNumber?: string; // Added for UPS tracking
  labelStatus?: string; // Added for label status
  shippingLabelUrl?: string; // Added for label URL
  shipments?: Array<{
    id: string;
    trackingNumber?: string;
    pdfUrl?: string;
    status: string;
    createdAt: string;
  }>;
  line_items: Array<{
    sellable?: {
      id?: any;
      full_title?: string;
      price?: number;
      sku_code?: string;
      image_url?: string;
      weight?: number;
      product?: {
        title?: string;
        main_image_src?: string;
        hs_tariff_number?: string;
        origin_country?: string;
      }
    };
    id: any;
    object_id?: string; // Shippo uses object_id
    productName?: string; // From database
    title?: string; // From API mapping
    value?: number; // This becomes unitPrice in LabelRow
    unitPrice?: number; // Ensure this is present if API sends it
    total_price?: number; // Shippo uses total_price
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
  recipientEmail?: string;

  // For label generation form & actions (can be duplicated from above if needed, or extended)
  fedexServiceType?: string;
  fedexPackagingType?: string;
  countryOfOrigin?: string; // From item.country_of_origin
  labelJobStatus?: string; // From item
  trackingNumber?: string; // From item
  shipByDate?: string; // Effective ship by date
  customerNote?: string; // Customer personalization/notes (especially from Etsy)

  // Reference to the original full LocalUIOrder if complex data needed for actions not covered by LabelRow
  originalOrder?: LocalUIOrder; 

  // Add labelStockType for UI editing
  labelStockType?: string;
  
  // Add variantInfo for Trendyol orders
  variantInfo?: string;
}


const statusColors: Record<string, {bg: string, text: string}> = {
  UNSHIPPED: { bg: '#87CEEB', text: '#000' }, // Baby Blue
  PENDING: { bg: '#87CEEB', text: '#000' },
  AWAITING_FULFILLMENT: { bg: '#87CEEB', text: '#000' }, // Baby Blue - same as PENDING
  PAID: { bg: '#87CEEB', text: '#000' }, // Baby Blue - same as PENDING
  CREATED: { bg: '#87CEEB', text: '#000' }, // Baby Blue - same as PENDING (Onaylandı)
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
  { value: 'Etsy', label: 'Etsy' },
  { value: 'Etsy Store 4', label: 'Etsy Store 4' },
];

const orderStatusOptions = [
  { value: '', label: 'Tümü (Sipariş)' },
  { value: 'UNSHIPPED', label: 'Hazırlanıyor' },
  { value: 'PENDING', label: 'Onaylandı' },
  { value: 'AWAITING_FULFILLMENT', label: 'Onaylandı' },
  { value: 'PAID', label: 'Onaylandı' },
  { value: 'CREATED', label: 'Onaylandı' },
  { value: 'PARTIALLY_SHIPPED', label: 'Kısmen Kargolandı' },
  { value: 'SHIPPED', label: 'Kargolandı' },
  { value: 'DELIVERED', label: 'Teslim Edildi' },
  { value: 'CANCELLED', label: 'İptal Edildi' },
  { value: 'REFUNDED', label: 'İade Edildi' },
  { value: 'ON_HOLD', label: 'Askıya Alındı' },
  { value: 'COMPLETED', label: 'Tamamlandı' },
  { value: 'FAILED', label: 'Başarısız Oldu' },
  { value: 'Synced', label: 'Senkronize' },
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

// --- Etsy address enrichment helper ---
async function fetchEtsyAddressEnrichment(orderNumber: string): Promise<any | null> {
  try {
    const response = await fetch(`/api/etsy-addresses?orderNumbers=${encodeURIComponent(orderNumber)}`);
    
    if (response.ok) {
      const data = await response.json();
      const enrichment = data.lookup?.[orderNumber] || null;
      return enrichment;
    } else {
      console.warn(`Failed to fetch Etsy address enrichment for order ${orderNumber}:`, response.status, response.statusText);
    }
  } catch (error) {
    console.warn(`Failed to fetch Etsy address enrichment for order ${orderNumber}:`, error);
  }
  return null;
}

// --- Address mapping utility (already defined in the file) ---
async function extractAddress(order: LocalUIOrder, preFetchedEnrichment?: any): Promise<any> { // Made async and ensure input type matches LocalUIOrder
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


  const extractedAddress = {
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
    recipientEmail: getValue(
      addr?.recipientEmail, addr?.recipient_email, addr?.email,
      deliverTo.email, billing.email, raw?.email,
      fallback(['recipientEmail','recipient_email','email'])
    ),
  };

  // --- ETSY ENRICHMENT: Check if address fields are missing and try to enrich from EtsyAddress table ---
  const isMissingCriticalAddress = 
    !extractedAddress.recipientStreet1 || 
    !extractedAddress.recipientCity ||
    extractedAddress.recipientStreet1 === '—' ||
    extractedAddress.recipientCity === '—' ||
    extractedAddress.recipientStreet1?.trim() === '' ||
    extractedAddress.recipientCity?.trim() === '';
  
  // For multitenant SaaS: Always try Etsy enrichment if address is missing, regardless of marketplace name
  // The API will return null if no EtsyAddress record exists for this order
  const shouldTryEtsyEnrichment = isMissingCriticalAddress && order.orderNumber;
  
  // Debug logging
  console.log(`🔍 Debug order ${order.orderNumber}:`, {
    marketplace: order.marketplace,
    shouldTryEtsyEnrichment,
    isMissingCriticalAddress,
    street1: extractedAddress.recipientStreet1,
    city: extractedAddress.recipientCity,
    extractedAddress
  });
  
  if (shouldTryEtsyEnrichment && order.orderNumber) {
    try {
      const etsyEnrichment = preFetchedEnrichment || await fetchEtsyAddressEnrichment(order.orderNumber);
      
      if (etsyEnrichment?.shippingAddress) {
        const etsyAddr = etsyEnrichment.shippingAddress;
        // Helper function to check if a value is missing or placeholder
        const isMissingValue = (value: any) => !value || value === '—' || value?.trim() === '';
        
        // Helper function to parse relative ship by dates from Chrome extension
        const parseShipByDate = (shipByText: string): string | null => {
          if (!shipByText || shipByText.trim() === '' || shipByText === 'null') return null;
          
          const text = shipByText.toLowerCase().trim();
          const now = new Date();
          
          if (text.includes('today')) {
            return now.toISOString();
          } else if (text.includes('tomorrow')) {
            const tomorrow = new Date(now);
            tomorrow.setDate(tomorrow.getDate() + 1);
            return tomorrow.toISOString();
          } else if (text.includes('in 2 days')) {
            const inTwoDays = new Date(now);
            inTwoDays.setDate(inTwoDays.getDate() + 2);
            return inTwoDays.toISOString();
          } else if (text.includes('in 3 days')) {
            const inThreeDays = new Date(now);
            inThreeDays.setDate(inThreeDays.getDate() + 3);
            return inThreeDays.toISOString();
          }
          
          // Try to parse as a regular date if it's already in a date format
          try {
            const parsed = new Date(shipByText);
            if (!isNaN(parsed.getTime())) {
              return parsed.toISOString();
            }
          } catch (e) {
            // Ignore parsing errors
          }
          
          return null;
        };
        
        // Fill missing fields with Etsy data - override placeholder values
        
        const enrichedAddress = {
          ...extractedAddress,
          recipientFirstName: isMissingValue(extractedAddress.recipientFirstName) ? (etsyAddr.name?.split(' ')[0] || '') : extractedAddress.recipientFirstName,
          recipientLastName: isMissingValue(extractedAddress.recipientLastName) ? (etsyAddr.name?.split(' ').slice(1).join(' ') || '') : extractedAddress.recipientLastName,
          recipientStreet1: isMissingValue(extractedAddress.recipientStreet1) ? (etsyAddr.line1 || '') : extractedAddress.recipientStreet1,
          recipientStreet2: isMissingValue(extractedAddress.recipientStreet2) ? (etsyAddr.line2 || '') : extractedAddress.recipientStreet2,
          recipientCity: isMissingValue(extractedAddress.recipientCity) ? (etsyAddr.city || '') : extractedAddress.recipientCity,
          recipientState: isMissingValue(extractedAddress.recipientState) ? (etsyAddr.state || '') : extractedAddress.recipientState,
          recipientPostal: isMissingValue(extractedAddress.recipientPostal) ? (etsyAddr.postalCode || '') : extractedAddress.recipientPostal,
          recipientCountry: isMissingValue(extractedAddress.recipientCountry) ? (etsyAddr.country || 'US') : extractedAddress.recipientCountry,
          // Add Etsy-specific data for debugging/display
          _etsyEnriched: true,
          _etsyStoreName: etsyEnrichment.etsyStoreName,
          _etsyNotes: etsyEnrichment.notes,
          _etsyShipByDate: parseShipByDate(etsyEnrichment.shipByDate) || etsyEnrichment.shipByDate || (() => {
            // Fallback: if no ship by date, use order date + 3 days
            if (etsyEnrichment.orderDate) {
              try {
                const orderDate = new Date(etsyEnrichment.orderDate);
                if (!isNaN(orderDate.getTime())) {
                  const shipBy = new Date(orderDate);
                  shipBy.setDate(shipBy.getDate() + 3);
                  return shipBy.toISOString();
                }
              } catch (e) {
                // Ignore parsing errors
              }
            }
            return null;
          })(),
          _etsyOrderDate: etsyEnrichment.orderDate,
          // Extract customer note from Etsy notes
          _etsyCustomerNote: (() => {
            const customerNote = parseEtsyPersonalization(etsyEnrichment.notes);
            console.log(`🔍 Etsy customer note extraction for order ${order.orderNumber}:`, {
              originalNotes: etsyEnrichment.notes,
              extractedNote: customerNote
            });
            return customerNote;
          })()
        };
        
        return enrichedAddress;
      }
    } catch (error) {
      console.warn(`Etsy address enrichment failed for order ${order.orderNumber}:`, error);
      // Continue with original address if enrichment fails
    }
  }
  
  return extractedAddress;
}


// --- Types ---
interface Shipment {
  id: string;
  status: string;
  carrier?: string;
  trackingNumber?: string;
  pdfUrl?: string;
  createdAt?: string;
}

// --- Data Transformation ---
/** Get the most appropriate product title from available data */
function getProductTitle(item: any, order: any) {
  const isMissing = (val: any) => !val || val === 'Unknown Product' || val === 'N/A';


  let result;
  // Check productName first (from database)
  if (item.productName && !isMissing(item.productName)) {
    result = item.productName;
  } else if (!isMissing(item.title)) {
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

/** convert the API payload (LocalUIOrder[]) into grid-ready rows (LabelRow[]) */
export async function toLabelRows(orders: LocalUIOrder[]): Promise<LabelRow[]> {
  if (!orders) return [];

  // Pre-fetch all Etsy addresses in parallel for orders that need enrichment
  const etsyOrderNumbers: string[] = [];
  const orderMap = new Map<string, LocalUIOrder>();
  
  for (const order of orders) {
    if (!order || typeof order !== 'object') continue;
    
    // Check if this order might need Etsy enrichment
    const shouldTryEtsyEnrichment = order.orderNumber && (
      isEtsyOrderSync(order.marketplace) || 
      order.marketplace === 'Trendyol' ||
      order.marketplace === 'Amazon Channel' ||
      (order.marketplace === 'outletemporiumus' && order.orderNumber)
    );
    
    if (shouldTryEtsyEnrichment && order.orderNumber) {
      etsyOrderNumbers.push(order.orderNumber);
      orderMap.set(order.orderNumber, order);
    }
  }
  
  // Batch fetch Etsy enrichments
  const etsyEnrichments = new Map<string, any>();
  if (etsyOrderNumbers.length > 0) {
    try {
      // Fetch up to 10 at a time to avoid overwhelming the API
      const batchSize = 10;
      for (let i = 0; i < etsyOrderNumbers.length; i += batchSize) {
        const batch = etsyOrderNumbers.slice(i, i + batchSize);
        const promises = batch.map(orderNumber => 
          fetchEtsyAddressEnrichment(orderNumber).then(enrichment => {
            if (enrichment) {
              etsyEnrichments.set(orderNumber, enrichment);
            }
          })
        );
        await Promise.all(promises);
      }
    } catch (error) {
      console.warn('Failed to batch fetch Etsy enrichments:', error);
    }
  }

  const labelRows: LabelRow[] = [];
  for (const order of orders) {
    // Skip invalid orders
    if (!order || typeof order !== 'object') {
      console.warn('[toLabelRows] Skipping invalid order:', order);
      continue;
    }
    
    // Pass the pre-fetched enrichment to extractAddress
    const etsyEnrichment = order.orderNumber ? etsyEnrichments.get(order.orderNumber) : null;
    const addr = await extractAddress(order, etsyEnrichment);
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

    
    // Get the latest shipment (for UPS labels)
    let latestShipment: Shipment | null = null;
    const orderShipments = order.shipments || [];
    
    if (orderShipments.length > 0) {
      
      latestShipment = orderShipments.reduce<Shipment | null>((latest, shipment) => {
        if (!shipment) return latest;
        
        const isNewer = !latest || 
          (shipment.createdAt && 
           latest.createdAt && 
           new Date(shipment.createdAt) > new Date(latest.createdAt));
          
        
        return isNewer ? shipment : latest;
      }, null as any);
      
    } else {
    }

    // Check for order-level tracking and label status (for UPS)
    const hasShipment = latestShipment?.status === 'created' && 
      (!!latestShipment?.trackingNumber || !!latestShipment?.pdfUrl);
      
    const hasOrderLabel = !!order.trackingNumber || 
                         order.labelStatus === 'created' || 
                         hasShipment || 
                         !!order.shippingLabelUrl;
    
    
    
    
    // Check if line_items are in rawData (Shippo/Etsy case)
    let lineItems = order.line_items;
    if ((!lineItems || lineItems.length === 0) && safeRaw?.line_items) {
      // For Shippo orders, line_items are in rawData
      lineItems = safeRaw.line_items;
    }
    
    // If no line items, create a single row for the order (UPS case)
    if (!lineItems || lineItems.length === 0) {
      const orderLevelRow = {
        orderId: order.id,
        marketplace: order.marketplace ?? '—',
        orderNumber: order.marketplaceOrderNumber || order.orderNumber || '—',
        orderTotalPrice: order.orderTotalPrice ?? order.totalPrice ?? safeRaw?.total_price ?? 0,
        orderDate: finalOrderDate,
        status: order.status ?? 'N/A',
        customsValue: order.customsValue ?? order.orderTotalPrice ?? order.totalPrice ?? safeRaw?.total_price ?? 0,
        currency: order.currency || safeRaw?.currency || 'USD',
        source: order.source || 'shippo',
        channel: order.channel || safeRaw?.shop_app,
        createdAt: order.marketplaceOrderDate,
        lastCarrier: latestShipment?.carrier || order.lastShipmentCarrier || safeRaw?.delivery_method?.name || safeRaw?.shipping_method || '—',

        itemId: `${order.id}-noitem`,
        sku: '—',
        title: order.commodityDesc || safeRaw?.line_items?.[0]?.title || 'N/A (Order Level)',
        quantity: 1,
        unitPrice: order.orderTotalPrice ?? order.totalPrice ?? safeRaw?.total_price ?? 0,
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
        recipientEmail: addr.recipientEmail || '',

        fedexServiceType: order.fedexServiceType,
        fedexPackagingType: order.fedexPackagingType,
        countryOfOrigin: order.countryOfMfg,
        labelJobStatus: hasOrderLabel ? 'created' : undefined,
        trackingNumber: latestShipment?.trackingNumber || order.trackingNumber || undefined,
        shipByDate: order.shipByDate || (addr as any)?._etsyShipByDate,
        customerNote: (() => {
          const note = (addr as any)?._etsyCustomerNote || '';
          if (order.orderNumber === '3749610005') {
            console.log(`🔍 Customer note for order ${order.orderNumber} (no line items):`, {
              etsyCustomerNote: (addr as any)?._etsyCustomerNote,
              finalNote: note,
              addrObj: addr
            });
          }
          return note;
        })(),
        originalOrder: order,
        labelCreated: hasOrderLabel,
        shippingLabelUrl: hasOrderLabel ? (latestShipment?.pdfUrl || order.shippingLabelUrl) : undefined,
        labelStockType: order.labelStockType,
        variantInfo: lineItems?.[0]?.variantInfo || '—',
      };
      
      labelRows.push(orderLevelRow);
      continue;
    }

    // Map each line item to a row (FedEx case)
    const itemRows = lineItems.map(item => {
      // Get the latest label job for this item
      const latestLabelJob = item.labelJobs && item.labelJobs.length > 0
        ? item.labelJobs.reduce<typeof item.labelJobs[0] | undefined>((latest, job) => 
            !latest || new Date(job.createdAt) > new Date(latest.createdAt) ? job : latest
          , undefined)
        : null;

      const isVeeqoItem = !!item.sellable;

      return {
        orderId: order.id,
        marketplace: order.marketplace ?? '—',
        orderNumber: order.marketplaceOrderNumber || order.orderNumber || '—',
        orderTotalPrice: order.orderTotalPrice ?? order.totalPrice ?? safeRaw?.total_price ?? 0,
        orderDate: finalOrderDate,
        status: order.status ?? 'N/A',
        customsValue: order.customsValue ?? order.orderTotalPrice ?? order.totalPrice ?? safeRaw?.total_price ?? 0,
        currency: order.currency || safeRaw?.currency || 'USD',
        source: order.source || 'shippo',
        channel: order.channel || safeRaw?.shop_app,
        createdAt: order.marketplaceOrderDate,
        lastCarrier: latestLabelJob?.carrier || latestShipment?.carrier || order.lastShipmentCarrier || safeRaw?.delivery_method?.name || safeRaw?.shipping_method || '—',

        itemId: isVeeqoItem ? item.id : (item.object_id || item.id || `${order.id}-item-${lineItems.indexOf(item)}`),
        sku: (isVeeqoItem ? item.sellable?.sku_code : item.sku) ?? '—',
        title: (isVeeqoItem ? item.sellable?.full_title : item.title) || getProductTitle(item, order),
        quantity: item.quantity ?? 1,
        unitPrice: (isVeeqoItem ? item.sellable?.price : item.unitPrice ?? item.value ?? item.total_price) ?? 0,
        weight: (isVeeqoItem ? item.sellable?.weight : item.weight) ?? 0.5,
        hsCode: (isVeeqoItem ? item.sellable?.product?.hs_tariff_number : item.hs_code) ?? order.harmonizedCode ?? '—',
        itemImageUrl: (isVeeqoItem ? item.sellable?.image_url || item.sellable?.product?.main_image_src : item.image) || order.imageUrl || '/placeholder.png',
        
        recipientFirstName: addr.recipientFirstName || '—',
        recipientLastName: addr.recipientLastName || '—',
        recipientStreet1: addr.recipientStreet1 || '—',
        recipientStreet2: addr.recipientStreet2 || '',
        recipientCity: addr.recipientCity || '—',
        recipientState: addr.recipientState || '',
        recipientPostal: addr.recipientPostal || '—',
        recipientCountry: addr.recipientCountry || '—',
        recipientPhone: addr.recipientPhone || '',
        recipientEmail: addr.recipientEmail || '',

        fedexServiceType: order.fedexServiceType,
        fedexPackagingType: order.fedexPackagingType,
        countryOfOrigin: (isVeeqoItem ? item.sellable?.product?.origin_country : item.country_of_origin) || order.countryOfMfg,
        labelJobStatus: latestLabelJob?.status,
        trackingNumber: latestLabelJob?.trackingNumber,
        shipByDate: item.shipBy || order.shipByDate || (addr as any)?._etsyShipByDate,
        customerNote: (() => {
          const note = (addr as any)?._etsyCustomerNote || '';
          if (order.orderNumber === '3749610005') {
            console.log(`🔍 Customer note for order ${order.orderNumber} (with line items):`, {
              etsyCustomerNote: (addr as any)?._etsyCustomerNote,
              finalNote: note,
              addrObj: addr
            });
          }
          return note;
        })(),
        originalOrder: order,
        labelCreated: latestLabelJob?.status === 'created' && !!latestLabelJob?.trackingNumber,
        shippingLabelUrl: latestLabelJob?.pdfUrl || (latestLabelJob?.status === 'created' && latestLabelJob?.trackingNumber ? `/api/labels/${item.id}/pdf` : undefined),
        labelStockType: order.labelStockType,
        variantInfo: item.variantInfo || '—',
      };
    });
    
    labelRows.push(...itemRows);
  }
  
  return labelRows;
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
    recipientEmail: row.recipientEmail === '—' ? '' : row.recipientEmail,
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

// Parse Etsy personalization from Chrome extension notes
function parseEtsyPersonalization(notes: string): string {
  console.log(`🔍 parseEtsyPersonalization called with:`, notes);
  
  if (!notes || typeof notes !== 'string') {
    console.log(`🔍 parseEtsyPersonalization: notes is empty or not string`);
    return '';
  }
  
  try {
    // Look for "Personalization" followed by the actual personalization text
    // Examples:
    // "...PersonalizationLENA | Track package..."
    // "...PersonalizationNot requested on this item. | ..."
    // "...Personalizationit is a custom order | Track package..."
    
    const personalizationMatch = notes.match(/Personalization([^|]*)/);
    console.log(`🔍 parseEtsyPersonalization: regex match result:`, personalizationMatch);
    
    if (personalizationMatch && personalizationMatch[1]) {
      const personalization = personalizationMatch[1].trim();
      console.log(`🔍 parseEtsyPersonalization: extracted personalization:`, personalization);
      
      // Handle common cases
      if (personalization.toLowerCase().includes('not requested') || 
          personalization.toLowerCase().includes('no personalization')) {
        console.log(`🔍 parseEtsyPersonalization: filtered out "not requested" case`);
        return '';
      }
      
      console.log(`🔍 parseEtsyPersonalization: returning:`, personalization);
      return personalization;
    }
    
    console.log(`🔍 parseEtsyPersonalization: no match found, returning empty`);
    return '';
  } catch (error) {
    console.warn('Failed to parse Etsy personalization:', error);
    return '';
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
    // Create a more specific key that includes itemId to avoid removing different line items
    // But also check for true duplicates where the same item appears multiple times
    const itemKey = `${row.itemId}`;
    const orderKey = `${(row.marketplace || '').toLowerCase().trim()}-${(row.orderNumber || '').toString().trim().toLowerCase()}-${row.sku}-${row.title}`;
    
    // Use itemId as primary key if available, otherwise fall back to order-based key
    const key = row.itemId !== `${row.orderId}-noitem` ? itemKey : orderKey;
    
    if (!seen.has(key)) {
      seen.set(key, row);
    }
  }
  return Array.from(seen.values());
}

function LabelsPage(props: { source?: string; channel?: string }): JSX.Element {
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ 
    page: 0, 
    pageSize: 15 
  });
  // --- UPS Drawer State ---
  const [upsDrawerOpen, setUpsDrawerOpen] = useState(false);
  const [selectedOrderForUPS, setSelectedOrderForUPS] = useState<UIOrder | null>(null);
  
  // --- Image Modal State ---
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string>('');

  // --- Tracking Submission State ---
  const [trackingDialogOpen, setTrackingDialogOpen] = useState(false);
  const [selectedOrderForTracking, setSelectedOrderForTracking] = useState<LabelRow | null>(null);
  const [trackingFormData, setTrackingFormData] = useState({
    trackingNumber: '',
    carrierId: 3, // Default to "Other"
    notifyCustomer: true,
    updateRemoteOrder: true
  });
  const [submittingTracking, setSubmittingTracking] = useState(false);

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
    paginationModel.page + 1,
    paginationModel.pageSize,
    {
      search: debouncedSearch,
      startDate: filterStartDate,
      endDate: filterEndDate,
      marketplace: '', // Always empty to show all marketplaces
      status: statusFilter,
      labelStatus: labelStatusFilter,
    },
    'labelsPage'
  );

  const marketplaceOptions = useMemo(() => {
    if (!fetchedOrders || !Array.isArray(fetchedOrders)) {
      return [{ value: '', label: 'Tümü (Market)' }];
    }
    const marketplaces = new Set(fetchedOrders.map((order: any) => order.marketplace).filter(Boolean));
    const options = Array.from(marketplaces).sort().map(m => ({ value: m, label: m }));
    return [{ value: '', label: 'Tümü (Market)' }, ...options];
  }, [fetchedOrders]);

  const [labelRows, setLabelRows] = useState<LabelRow[]>([]);
  
  useEffect(() => {
    async function processOrders() {
      if (!fetchedOrders || !Array.isArray(fetchedOrders)) {
        setLabelRows([]);
        return;
      }
      const rows = await toLabelRows(fetchedOrders as LocalUIOrder[]);
      setLabelRows(dedupeLabelRows(rows));
    }
    processOrders();
  }, [fetchedOrders]);

  // Restore label filter tab interactivity
  const handleLabelFilter = (_event: React.MouseEvent<HTMLElement>, value: 'all' | 'unlabeled' | 'labeled' | null) => {
    if (value) setLabelFilter(value);
  };

  const filteredAndPaginatedItems = useMemo(() => {
    // TEMPORARILY DISABLED: Frontend filtering for debugging
    return labelRows; // Always return all rows for debugging
    
    /* ORIGINAL FILTERING CODE - DISABLED
    if (labelFilter === 'all') {
      return labelRows;
    }
    return labelRows.filter(row => {
      const originalOrder = row?.originalOrder as LocalUIOrder | undefined;
      const shipments = originalOrder?.shipments || [];
      const hasShipment = shipments.some(s => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));

      const hasLabel = row.trackingNumber || 
                      row.labelCreated || 
                      row.shippingLabelUrl || 
                      row.labelJobStatus === 'created' ||
                      hasShipment;

      if (labelFilter === 'labeled') {
        return hasLabel;
      }
      if (labelFilter === 'unlabeled') {
        return !hasLabel;
      }
      return true;
    });
    */
  }, [labelRows, labelFilter, marketplaceFilter]);

  useEffect(() => {
    setPaginationModel(prev => ({ ...prev, page: 0 }));
  }, [debouncedSearch, statusFilter, labelStatusFilter, filterStartDate, filterEndDate]);

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


  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOrder, setDrawerOrder] = useState<LabelRow | null>(null);

  const drawerErrors = useMemo(
    () => (drawerOrder ? validateRowForLabel(drawerOrder) : ['no-row']), // Add 'no-row' or similar to ensure button disabled if no row
    [drawerOrder]
  );

  const openDrawer = (row: LabelRow) => {
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
      recipientPhone: row.recipientPhone || '',
      recipientEmail: row.recipientEmail || '',
      labelStockType: row.labelStockType || 'PAPER_4X6',
      fedexServiceType: row.fedexServiceType || 'INTERNATIONAL_PRIORITY',
      fedexPackagingType: row.fedexPackagingType || 'FEDEX_PAK',
      weight: row.weight || 0.5, // Ensure weight defaults to 0.5
      hsCode: '', // Always start with empty HS code
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

  const handleDrawerChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement> | SelectChangeEvent<string>) => {
    const { name, value } = e.target;
    setDrawerOrder(prev => {
      if (!prev) return null;
      const isNumeric = ['weight'].includes(name);
      return {
        ...prev,
        [name]: isNumeric ? parseFloat(value) || 0 : value,
      };
    });
  };

  const handleOriginalOrderChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDrawerOrder(prev => {
      if (!prev) return null;
      const isNumeric = ['packageLength', 'packageWidth', 'packageHeight'].includes(name);
      return {
        ...prev,
        originalOrder: {
          ...prev.originalOrder!,
          [name]: isNumeric ? parseFloat(value) || 0 : value,
        },
      };
    });
  };

  const columns: GridColDef<LabelRow>[] = [
    {
      field: 'labelStatus',
      headerName: 'Etiket',
      width: 90,
      sortable: false,
      valueGetter: (_value, row) => {
        const originalOrder = row?.originalOrder as LocalUIOrder | undefined;
        const shipments = originalOrder?.shipments || [];
        const hasShipment = shipments.some(s => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));
        
        const debugInfo = {
          orderId: row?.orderId,
          orderNumber: row?.orderNumber,
          trackingNumber: row?.trackingNumber,
          labelCreated: row?.labelCreated,
          labelJobStatus: row?.labelJobStatus,
          shippingLabelUrl: row?.shippingLabelUrl,
          hasShipment,
          hasLineItems: Array.isArray(originalOrder?.line_items) && originalOrder.line_items.length > 0,
          hasShipments: shipments.length > 0,
          shipments: shipments.map(s => ({
            id: s.id,
            status: s.status,
            trackingNumber: s.trackingNumber,
            pdfUrl: s.pdfUrl,
            createdAt: s.createdAt
          }))
        };
        
        if (!row) {
          return '—';
        }
        
        // Check if we have a label created (either through tracking number, labelCreated flag, shippingLabelUrl, or shipment)
        const hasLabel = row.trackingNumber || 
                        row.labelCreated || 
                        row.shippingLabelUrl || 
                        row.labelJobStatus === 'created' ||
                        hasShipment;
        
        if (hasLabel) {
          return 'Alındı';
        }
        
        if (row.labelJobStatus === 'failed') {
          return 'Hata';
        }
        
        if (row.labelJobStatus === 'pending') {
          return 'Bekliyor';
        }
        
        return 'Etiketsız';
      },
      renderCell: (params: GridRenderCellParams<LabelRow, string>) => {
        const status = params.value;
        if (status === 'Alındı') {
          // First try to get tracking number from row, then from shipments array
          let trackingNumber = params.row.trackingNumber;
          
          if (!trackingNumber) {
            const originalOrder = params.row?.originalOrder as LocalUIOrder | undefined;
            const shipments = originalOrder?.shipments || [];
            const latestShipment = shipments.find(s => s?.status === 'created' && s?.trackingNumber);
            trackingNumber = latestShipment?.trackingNumber || 'Tracking number not available';
          }
          
          return (
            <Tooltip title="Etiket Alındı">
              <span
                style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                onClick={async (e) => {
                  e.stopPropagation();
                  if (trackingNumber && trackingNumber !== 'Tracking number not available') {
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
      field: 'tracking',
      headerName: 'Kargo',
      width: 80,
      sortable: false,
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        const row = params.row;
        const originalOrder = row?.originalOrder as LocalUIOrder | undefined;
        
        // Determine source from marketplace like in the API
        const source = (() => {
          const marketplace = (row.marketplace || '').toLowerCase();
          if (isEtsyOrderSync(marketplace)) return 'shippo';
          if (marketplace.includes('trendyol')) return 'trendyol';
          return 'veeqo';
        })();

        // Only show for Veeqo and Shippo orders
        if (source !== 'veeqo' && source !== 'shippo') {
          return <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>—</Box>;
        }

        // Check if tracking number exists
        const hasTracking = row.trackingNumber || 
                           originalOrder?.trackingNumber ||
                           (originalOrder?.shipments && originalOrder.shipments.some(s => s?.trackingNumber));

        const handleTrackingClick = () => {
          setSelectedOrderForTracking(row);
          setTrackingFormData({
            trackingNumber: '',
            carrierId: 3,
            notifyCustomer: true,
            updateRemoteOrder: true
          });
          setTrackingDialogOpen(true);
        };

        return (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconButton 
              size="small" 
              onClick={handleTrackingClick}
              sx={{ 
                color: hasTracking ? 'success.main' : 'text.secondary',
                '&:hover': { 
                  backgroundColor: hasTracking ? 'success.light' : 'action.hover',
                  opacity: 0.8
                }
              }}
            >
              <Tooltip title={hasTracking ? 'Takip numarası mevcut' : 'Takip numarası ekle'}>
                {hasTracking ? <FlightTakeoffIcon /> : <FlightIcon />}
              </Tooltip>
            </IconButton>
          </Box>
        );
      },
    },
    {
      field: 'itemImageUrl',
      headerName: 'Ürün Görseli',
      width: 140,
      sortable: false,
      renderCell: (params: GridRenderCellParams<LabelRow>) => (
        <Box
          sx={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            height: '100%',
            cursor: 'pointer'
          }}
          onClick={() => {
            const imageUrl = params.value as string || '/placeholder.png';
            setSelectedImageUrl(imageUrl);
            setImageModalOpen(true);
          }}
        >
          <img
            src={params.value as string || '/placeholder.png'} 
            alt="Ürün Görseli"
            style={{ 
              width: 65, 
              height: 65, 
              objectFit: 'cover', 
              borderRadius: 8,
              transition: 'transform 0.2s',
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLImageElement).style.transform = 'scale(1.1)';
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLImageElement).style.transform = 'scale(1)';
            }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.png'; }}
          />
        </Box>
      )
    },
    { field: 'marketplace', headerName: 'Mağaza', width: 110 },
    {
      field: 'status',
      headerName: 'Durum',
      width: 120,
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        const status = params.value?.toUpperCase() || 'UNKNOWN';
        const config = statusColors[status] || { bg: '#ccc', text: '#000' };
        const statusOption = orderStatusOptions.find(opt => opt.value === status);
        const label = statusOption?.label || status.replace(/_/g, ' ');
        
        return (
          <Chip 
            label={label} 
            size="small"
            style={{
              backgroundColor: config.bg,
              color: config.text,
              fontWeight: 500,
              fontSize: '0.75rem'
            }}
          />
        );
      }
    },
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
      width: 120, 
      type: 'number',
      renderCell: (params: GridRenderCellParams<LabelRow>) => (
        <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
          <Typography variant="body2">
            {params.value != null && params.value > 0 ? `${(params.value as number).toFixed(2)} ${params.row.currency || ''}`.trim() : '—'}
          </Typography>
        </Box>
      )
    },
    { 
      field: 'title', 
      headerName: 'Ürün Adı', 
      width: 180,
      renderCell: (params: GridRenderCellParams<LabelRow>) => (
        <Tooltip title={params.value || ''} placement="bottom-start">
          <Box 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              height: '100%',
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            onClick={() => {
              if (params.value) {
                navigator.clipboard.writeText(params.value as string);
                toast.success('Ürün adı kopyalandı!');
              }
            }}
          >
            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {params.value || '—'}
            </Typography>
          </Box>
        </Tooltip>
      )
    },
    { 
      field: 'variantInfo', 
      headerName: 'Varyasyon', 
      width: 140,
      renderCell: (params: GridRenderCellParams<LabelRow>) => (
        <Tooltip title={params.value || ''} placement="bottom-start">
          <Box 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              height: '100%',
              cursor: 'pointer',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap'
            }}
            onClick={() => {
              if (params.value) {
                navigator.clipboard.writeText(params.value as string);
                toast.success('Varyasyon bilgisi kopyalandı!');
              }
            }}
          >
            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {params.value || '—'}
            </Typography>
          </Box>
        </Tooltip>
      )
    },
    { field: 'quantity', headerName: 'Adet', width: 60, type: 'number' },
    { 
      field: 'shipByDate', 
      headerName: 'Son Kargo Tarihi',
      width: 130,
      valueFormatter: (value: string | undefined) => value ? formatDate(value) : '—',
    },
    { 
      field: 'customerNote', 
      headerName: 'Müşteri Notu',
      width: 140,
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        const note = params.row.customerNote;
        if (!note || note.trim() === '') {
          return (
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              height: '100%' 
            }}>
              <span style={{ color: '#999' }}>—</span>
            </div>
          );
        }

        const handleCopyClick = async () => {
          try {
            await navigator.clipboard.writeText(note);
            toast.success('Müşteri notu kopyalandı');
          } catch (err) {
            console.error('Failed to copy note:', err);
            toast.error('Kopyalama başarısız');
          }
        };

        return (
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            height: '100%',
            fontSize: '13px', 
            lineHeight: '1.2',
            maxHeight: '40px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            cursor: 'pointer',
            padding: '2px 4px',
            borderRadius: '4px',
            transition: 'background-color 0.2s'
          }}
          onClick={handleCopyClick}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = '#f5f5f5';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
          }}
          title={`Kopyalamak için tıklayın: ${note}`}
          >
            {note}
          </div>
        );
      }
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
            // Convert LabelRow to UIOrder format for UPS drawer
            const uiOrder: UIOrder = {
              orderId: params.row.orderId,
              orderNumber: params.row.orderNumber,
              recipientFirstName: params.row.recipientFirstName,
              recipientLastName: params.row.recipientLastName,
              recipientStreet1: params.row.recipientStreet1,
              recipientStreet2: params.row.recipientStreet2,
              recipientCity: params.row.recipientCity,
              recipientState: params.row.recipientState,
              recipientPostal: params.row.recipientPostal,
              recipientCountry: params.row.recipientCountry,
              recipientPhone: params.row.recipientPhone,
              recipientEmail: params.row.recipientEmail,
              orderTotalPrice: params.row.orderTotalPrice,
              currency: params.row.currency,
              title: params.row.title,
              weight: params.row.weight,
              hsCode: params.row.hsCode,
              countryOfOrigin: params.row.countryOfOrigin,
            };
            setSelectedOrderForUPS(uiOrder); 
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
      const { fetchWithLimit } = await import('../../lib/fetchWithLimit');
      const res = await fetchWithLimit('/api/orders/sync', {
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

  const handleTrackingSubmit = async () => {
    if (!selectedOrderForTracking || !trackingFormData.trackingNumber.trim()) {
      return;
    }

    setSubmittingTracking(true);
    const toastId = toast.loading('Takip numarası gönderiliyor...');
    
    try {
      const { fetchWithLimit } = await import('../../lib/fetchWithLimit');
      const res = await fetchWithLimit(`/api/orders/${selectedOrderForTracking.orderId}/submit-tracking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          trackingNumber: trackingFormData.trackingNumber.trim(),
          carrierId: trackingFormData.carrierId,
          notifyCustomer: trackingFormData.notifyCustomer,
          updateRemoteOrder: trackingFormData.updateRemoteOrder
        })
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Takip numarası gönderilemedi');
      }

      toast.success('Takip numarası başarıyla kaydedildi!', { id: toastId });
      setTrackingDialogOpen(false);
      
      // Reset form
      setTrackingFormData({
        trackingNumber: '',
        carrierId: 3,
        notifyCustomer: true,
        updateRemoteOrder: true
      });
      
      // Refresh data to show updated icons
      mutate && mutate();
      
    } catch (e: any) {
      toast.error(`Hata: ${e.message}`, { id: toastId });
    } finally {
      setSubmittingTracking(false);
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
        recipientEmail,
        // Extract only the fields that should be updated on Order table
        weight,
        hsCode,
        countryOfOrigin,
        itemId,
        // Ignore all other fields to prevent data corruption
      } = currentFormValues;
      const dbUpdatePayload = {
        id: orderId,
        itemId, // For OrderItem updates
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
          email: recipientEmail,
        },
        // Only include specific safe fields for OrderItem updates
        weight: weight,
        hsCode: hsCode,
        countryOfOrigin: countryOfOrigin,
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
          email: currentFormValues.recipientEmail,
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
        recipientEmail: defaultsForFedexPayload.recipientEmail,

        // And orderId / orderItemId
        orderId: currentFormValues.orderId, // Ensure orderId is at top level
        orderItemId: currentFormValues.itemId
      };

      const { fetchWithLimit } = await import('../../lib/fetchWithLimit');
      const labelResponse = await fetchWithLimit(`/api/orders/${currentFormValues.orderId}/generate-label`, {
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
          <Button onClick={() => { setSearchTerm(''); setStatusFilter(''); setLabelStatusFilter(''); setLabelFilter('all'); const now = new Date(); const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); setFilterStartDate(sevenDaysAgo.toISOString().slice(0, 10)); setFilterEndDate(now.toISOString().slice(0, 10)); }} variant="outlined" sx={{ ml: 'auto', height: '40px', minWidth: 100, flexGrow: 1, mb: { xs: 1, sm: 0 } }}>Sıfırla</Button>
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

      <Box sx={{ flexGrow: 1, width: '100%', overflow: 'auto', minHeight: 0 }}>
        <div 
          onSubmit={(e) => e.preventDefault()} 
          onClick={(e) => {
            // Only stop propagation for specific pagination elements
            const target = e.target as HTMLElement;
            if (target.closest('.MuiTablePagination-root') || target.closest('[aria-label*="page"]')) {
              e.stopPropagation();
            }
          }}
        >
          <DataGrid
            rows={filteredAndPaginatedItems}
            columns={columns}
            rowCount={total}
            loading={isLoading}
            pageSizeOptions={[15, 25, 50]}
            paginationModel={paginationModel}
            paginationMode="server"
            onPaginationModelChange={(newModel, details) => {
              console.log('Pagination change:', newModel, 'Details:', details);
              // Use requestAnimationFrame to ensure state update happens after current event
              requestAnimationFrame(() => {
                setPaginationModel(newModel);
              });
            }}
            getRowId={(row) => row.itemId || row.orderId}
            disableRowSelectionOnClick
            rowHeight={90}
            disableColumnResize
            disableColumnMenu
            keepNonExistentRowsSelected={false}
            initialState={{
              sorting: {
                sortModel: [{ field: 'orderDate', sort: 'desc' }],
              },
            }}
            density="compact"
            sx={{ 
              height: '100%',
              border: 0,
              '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f5f5f5' },
              '& .MuiDataGrid-cell:focus-within, & .MuiDataGrid-cell:focus': {
                outline: 'none !important',
              },
            }}
          />
        </div>
      </Box>

      {drawerOrder && (
        <Drawer anchor="right" open={drawerOpen} onClose={closeDrawer}>
          <Box sx={{ width: { xs: '100vw', sm: 500 }, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="h6">Etiket Oluştur</Typography>
              <Typography variant="body2" color="text.secondary">Sipariş No: {drawerOrder.orderNumber}</Typography>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: 2 }}>
              {/* Shipping Details Accordion */}
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>Kargo Detayları</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField name="recipientFirstName" label="Alıcı Adı" value={drawerOrder.recipientFirstName || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('First Name'))} />
                  <TextField name="recipientLastName" label="Alıcı Soyadı" value={drawerOrder.recipientLastName || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Last Name'))} />
                  <TextField name="recipientStreet1" label="Adres Satırı 1" value={drawerOrder.recipientStreet1 || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Street address'))} />
                  <TextField name="recipientStreet2" label="Adres Satırı 2" value={drawerOrder.recipientStreet2 || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" />
                  <TextField name="recipientCity" label="Şehir" value={drawerOrder.recipientCity || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('City'))} />
                  <TextField name="recipientState" label="Eyalet/Bölge" value={drawerOrder.recipientState || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" />
                  <TextField name="recipientPostal" label="Posta Kodu" value={drawerOrder.recipientPostal || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Postal code'))} />
                  <TextField name="recipientCountry" label="Ülke" value={drawerOrder.recipientCountry || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Country'))} />
                  <TextField name="recipientPhone" label="Telefon" value={drawerOrder.recipientPhone || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" />
                  <TextField name="recipientEmail" label="E-posta (Opsiyonel)" value={drawerOrder.recipientEmail || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" type="email" />
                  <TextField name="commodityDesc" label="Ürün Açıklaması" value={drawerOrder.title === 'N/A' ? (drawerOrder.originalOrder?.commodityDesc || drawerOrder.title) : drawerOrder.title} onChange={handleOriginalOrderChange} fullWidth margin="dense" size="small" />
                  <Grid container spacing={2}>
                    <Grid item xs={4}><TextField name="weight" label="Ağırlık (kg)" value={drawerOrder.weight || 0.5} inputProps={{ step: "0.1", style: { MozAppearance: 'textfield' } }} sx={{ '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 } }} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Weight'))} /></Grid>
                    <Grid item xs={4}><TextField name="packageLength" label="Uzunluk (cm)" value={drawerOrder.originalOrder?.packageLength || ''} type="number" onChange={handleOriginalOrderChange} fullWidth margin="dense" size="small" /></Grid>
                    <Grid item xs={4}><TextField name="packageWidth" label="Genişlik (cm)" value={drawerOrder.originalOrder?.packageWidth || ''} type="number" onChange={handleOriginalOrderChange} fullWidth margin="dense" size="small" /></Grid>
                    <Grid item xs={4}><TextField name="packageHeight" label="Yükseklik (cm)" value={drawerOrder.originalOrder?.packageHeight || ''} type="number" onChange={handleOriginalOrderChange} fullWidth margin="dense" size="small" /></Grid>
                    <Grid item xs={8}><TextField name="hsCode" label="HS Kodu" value={drawerOrder.hsCode || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" /></Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>

              {/* FedEx Options Accordion */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>FedEx Seçenekleri</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Servis Tipi</InputLabel>
                    <Select
                      name="fedexServiceType"
                      value={drawerOrder.fedexServiceType || ''}
                      onChange={handleDrawerChange}
                      label="Servis Tipi"
                    >
                      {FEDEX_SERVICE_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Paket Tipi</InputLabel>
                    <Select
                      name="fedexPackagingType"
                      value={drawerOrder.fedexPackagingType || ''}
                      onChange={handleDrawerChange}
                      label="Paket Tipi"
                    >
                      {FEDEX_PACKAGING_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>Etiket Boyutu</InputLabel>
                    <Select
                      name="labelStockType"
                      value={drawerOrder.labelStockType || 'PAPER_4X6'}
                      onChange={handleDrawerChange}
                      label="Etiket Boyutu"
                    >
                      {ALLOWED_LABEL_STOCK_TYPES.map(opt => (
                        <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </AccordionDetails>
              </Accordion>
            </Box>

            <Box sx={{ p: {xs: 1, sm: 2}, borderTop: '1px solid', borderColor: 'divider', mt: 'auto' }}>
              <Button fullWidth variant="contained" color="primary" 
                onClick={() => drawerOrder && handleGenerateLabel(drawerOrder)} 
                disabled={drawerErrors.length > 0 || generatingLabelId === drawerOrder?.itemId || checkingFedexCredentials || !hasFedexCredentials}
              >
                {generatingLabelId === drawerOrder?.itemId ? <CircularProgress size={24} color="inherit" /> : (checkingFedexCredentials ? 'Ayarlar Kontrol Ediliyor...': (!hasFedexCredentials ? 'FedEx Ayarları Eksik' : 'ETİKET OLUŞTUR'))}
              </Button>
              <Button fullWidth variant="text" onClick={closeDrawer} sx={{mt:1}}>İptal</Button>
            </Box>
          </Box>
        </Drawer>
      )}

      {/* UPS Drawer mount */}
      {selectedOrderForUPS && (
        <UPSLabelDrawer
          open={upsDrawerOpen}
          onClose={() => setUpsDrawerOpen(false)}
          order={selectedOrderForUPS}
          onSaved={async () => {
            // Force a revalidation of the data
            await mutate();
            // Force a re-render of the table
            await new Promise(resolve => setTimeout(resolve, 500));
          }}
        />
      )}
      
      {/* Image Modal */}
      <Dialog
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          Ürün Görseli
          <IconButton
            aria-label="close"
            onClick={() => setImageModalOpen(false)}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent>
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              minHeight: '400px',
            }}
          >
            <img
              src={selectedImageUrl}
              alt="Ürün Görseli"
              style={{
                maxWidth: '100%',
                maxHeight: '600px',
                objectFit: 'contain',
              }}
              onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.png'; }}
            />
          </Box>
        </DialogContent>
      </Dialog>

      {/* Tracking Submission Dialog */}
      <Dialog
        open={trackingDialogOpen}
        onClose={() => setTrackingDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          Takip Numarası Ekle
          <IconButton
            aria-label="close"
            onClick={() => setTrackingDialogOpen(false)}
            sx={{
              position: 'absolute',
              right: 8,
              top: 8,
              color: (theme) => theme.palette.grey[500],
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 2 }}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {selectedOrderForTracking && (
              <Box sx={{ mb: 2, p: 2, backgroundColor: 'grey.50', borderRadius: 1 }}>
                <Typography variant="subtitle2" color="text.secondary">
                  Sipariş: {selectedOrderForTracking.orderNumber}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Market: {selectedOrderForTracking.marketplace}
                </Typography>
              </Box>
            )}
            
            <TextField
              fullWidth
              label="Takip Numarası"
              value={trackingFormData.trackingNumber}
              onChange={(e) => setTrackingFormData(prev => ({...prev, trackingNumber: e.target.value}))}
              placeholder="1Z999AA10123456784"
              required
            />

            <FormControl fullWidth>
              <InputLabel>Kargo Firması</InputLabel>
              <Select
                value={trackingFormData.carrierId}
                label="Kargo Firması"
                onChange={(e) => setTrackingFormData(prev => ({...prev, carrierId: Number(e.target.value)}))}
              >
                {VEEQO_CARRIERS.map((carrier) => (
                  <MenuItem key={carrier.value} value={carrier.value}>
                    {carrier.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', mt: 2 }}>
              <Button 
                onClick={() => setTrackingDialogOpen(false)}
                disabled={submittingTracking}
              >
                İptal
              </Button>
              <Button 
                variant="contained" 
                onClick={handleTrackingSubmit}
                disabled={submittingTracking || !trackingFormData.trackingNumber.trim()}
                startIcon={submittingTracking ? <CircularProgress size={16} /> : null}
              >
                {submittingTracking ? 'Gönderiliyor...' : 'Kaydet'}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>
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
