import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { useTranslations } from 'next-intl';
import { useLocale } from '@/lib/i18n/useLocale';
import {
  Box, Button, CircularProgress, Tooltip, Dialog, DialogTitle, DialogContent, Snackbar, Alert, TextField, Select, MenuItem, InputLabel, FormControl, IconButton, Typography, Paper, Accordion, AccordionSummary, AccordionDetails, Chip, Drawer, Fade, List, ListItem, ListItemIcon, ListItemText, ToggleButton, ToggleButtonGroup, Grid, SelectChangeEvent
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel, GridRenderCellParams, GridValueGetter, GridRowSelectionModel, GridRowId } from '@mui/x-data-grid';
import { Sync as SyncIcon, Refresh as RefreshIcon, Search as SearchIcon, Close as CloseIcon, ExpandMore as ExpandMoreIcon, Edit as EditIcon, Check as CheckIcon, Warning as WarningIcon, Error as ErrorIcon, Info as InfoIcon, Lock as LockIcon, FlightTakeoff as FlightTakeoffIcon, Flight as FlightIcon, Delete as DeleteIcon } from '@mui/icons-material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { toast, Toaster, Toast } from 'react-hot-toast';
import { useOrders } from '@/lib/hooks/useOrders';
import { useMarketplaceOptions } from '@/lib/hooks/useMarketplaceOptions';
// Layout import removed - using AppLayout only
import AppLayout from '@/components/AppLayout';
import CircleIcon from '@mui/icons-material/Circle';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import UPSLabelDrawer from '@/components/UPSLabelDrawer';
import ManualOrderButton from '@/components/ManualOrderButton';
import { isEtsyOrderSync } from '@/lib/utils/etsyDetection';
import withAuth from '@/components/withAuth';
// supabase browser client removed — auth now handled by NextAuth cookies
import {
  FEDEX_SERVICE_TYPES,
  FEDEX_PACKAGING_TYPES,
  ALLOWED_LABEL_STOCK_TYPES,
  getFedexCurrencyCodes,
} from '@/lib/fedex/fedex.config';

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
  shipments?: any[];
}

// Veeqo Carrier IDs for tracking submission
// Label for carrier 3 ('Other'/'Diğer') is set dynamically via t() in the component
const VEEQO_CARRIERS_BASE = [
  { value: 1, label: 'Royal Mail' },
  { value: 2, label: 'FedEx' },
  { value: 3, label: '__OTHER__' },
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
function fmtDateTr(iso?: string): string {
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
  trackingSubmissions?: any[]; // Array of tracking submissions
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
        id?: number;
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

  // Direct listing URL from marketplace
  listingUrl?: string;
}


/** Get the product listing URL — prefer pre-resolved direct URL from LabelRow */
function getProductListingUrl(row: LabelRow): string | null {
  // Use pre-resolved direct listing URL from Veeqo Product API / EtsyListing DB
  if (row.listingUrl) return row.listingUrl;
  return null;
}

function getMarketplaceOrderUrl(marketplace: string, orderNumber: string, channel?: string): string | null {
  if (!orderNumber || orderNumber === '—') return null;
  const mp = (marketplace || '').toLowerCase();
  const ch = (channel || '').toLowerCase();

  // Etsy — direct marketplace match OR orders routed through Veeqo/Shippo with channel=etsy
  if (mp.includes('etsy') || ch.includes('etsy')) {
    return `https://www.etsy.com/your/orders/sold/completed?order_id=${orderNumber}`;
  }
  // Trendyol
  if (mp.includes('trendyol')) {
    return `https://partner.trendyol.com/orders/detail/${orderNumber}`;
  }
  // eBay
  if (mp.includes('ebay')) {
    return `https://www.ebay.com/sh/ord/details?orderid=${encodeURIComponent(orderNumber)}`;
  }
  // Amazon
  if (mp.includes('amazon')) {
    return `https://sellercentral.amazon.com/orders-v3/order/${orderNumber}`;
  }
  // Hepsiburada
  if (mp.includes('hepsiburada')) {
    return `https://merchant.hepsiburada.com/siparis/detay/${orderNumber}`;
  }
  return null;
}

const statusColors: Record<string, {bg: string, text: string}> = {
  UNSHIPPED: { bg: '#87CEEB', text: '#000' }, // Baby Blue
  AWAITING_FULFILLMENT: { bg: '#87CEEB', text: '#000' }, // Baby Blue - same as PENDING
  PAID: { bg: '#87CEEB', text: '#000' }, // Baby Blue - same as PENDING
  CREATED: { bg: '#87CEEB', text: '#000' }, // Baby Blue - same as PENDING (Onaylandı)
  PARTIALLY_SHIPPED: { bg: '#ADD8E6', text: '#000' }, // Light Blue
  SHIPPED: { bg: '#90EE90', text: '#000' }, // Light Green
  DELIVERED: { bg: '#32CD32', text: '#fff' }, // Lime Green
  CANCELLED: { bg: '#F08080', text: '#fff' }, // Light Coral
  REFUNDED: { bg: '#DDA0DD', text: '#000' }, // Plum
  ON_HOLD: { bg: '#FFA500', text: '#000' }, // Orange
  COMPLETED: { bg: '#388e3c', text: '#fff' }, // Dark Green (for general success)
  LABEL_GENERATED: { bg: '#8A2BE2', text: '#fff' }, // BlueViolet
  FAILED: {bg: '#DC143C', text: '#fff'}, // Crimson for general failure
};

// These option arrays are built inside the component using t() for i18n.
// Static value-key mappings used to construct them:
const LABEL_STATUS_KEYS = [
  { value: '', key: 'all' },
  { value: 'created', key: 'created' },
  { value: 'not_created', key: 'notCreated' },
  { value: 'failed', key: 'failed' },
] as const;

const ORDER_STATUS_KEYS = [
  { value: '', key: 'all' },
  { value: 'UNSHIPPED', key: 'unshipped' },
  { value: 'AWAITING_FULFILLMENT', key: 'awaitingFulfillment' },
  { value: 'PAID', key: 'paid' },
  { value: 'CREATED', key: 'created' },
  { value: 'PARTIALLY_SHIPPED', key: 'partiallyShipped' },
  { value: 'SHIPPED', key: 'shipped' },
  { value: 'DELIVERED', key: 'delivered' },
  { value: 'CANCELLED', key: 'cancelled' },
  { value: 'REFUNDED', key: 'refunded' },
  { value: 'ON_HOLD', key: 'onHold' },
  { value: 'COMPLETED', key: 'completed' },
  { value: 'FAILED', key: 'failed' },
  { value: 'Synced', key: 'synced' },
] as const;

const ORDER_STATUS_FILTER_KEYS = [
  { value: '', key: 'all' },
  { value: 'onaylandi', key: 'approved', statuses: ['PAID', 'Created'] },
  { value: 'kargolandi', key: 'shipped', statuses: ['shipped', 'Shipped'] },
  { value: 'iptal', key: 'cancelled', statuses: ['cancelled', 'Cancelled'] },
  { value: 'Delivered', key: 'delivered', statuses: ['Delivered'] },
] as const;

const SEARCH_TYPE_KEYS = [
  { value: 'all', key: 'all' },
  { value: 'customer', key: 'customer' },
  { value: 'order', key: 'order' },
  { value: 'tracking', key: 'tracking' },
  { value: 'product', key: 'product' },
  { value: 'sku', key: 'sku' },
  { value: 'marketplace', key: 'marketplace' },
  { value: 'city', key: 'city' },
  { value: 'phone', key: 'phone' },
  { value: 'note', key: 'note' },
] as const;

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
    const response = await fetch(`/api/etsy-addresses?orderNumbers=${encodeURIComponent(orderNumber)}`, {
      cache: 'no-store',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    
    if (response.ok || response.status === 304) {
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
      addr?.recipientPostal, addr?.recipient_postal, addr?.postal, addr?.zip, addr?.postalCode, addr?.postcode,
      deliverTo.zip, deliverTo.postalCode, deliverTo.postcode, billing.zip, billing.postalCode, billing.postcode, raw?.zip, raw?.postalCode, raw?.postcode,
      fallback(['recipientPostal','recipient_postal','postal','zip','postalCode','postcode'])
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

  // --- FALLBACK: If critical address fields are still missing, check rawData fallbacks ---
  if ((!extractedAddress.recipientStreet1 || extractedAddress.recipientStreet1 === '—' || !extractedAddress.recipientCity || extractedAddress.recipientCity === '—') && raw) {
    // Check for to_address field (used by Trendyol and potentially other marketplaces)
    if (raw.to_address && typeof raw.to_address === 'object') {
      const toAddr = raw.to_address;
      extractedAddress.recipientStreet1 = extractedAddress.recipientStreet1 || toAddr.street1 || '';
      extractedAddress.recipientStreet2 = extractedAddress.recipientStreet2 || toAddr.street2 || '';
      extractedAddress.recipientCity = extractedAddress.recipientCity || toAddr.city || '';
      extractedAddress.recipientState = extractedAddress.recipientState || toAddr.state || '';
      extractedAddress.recipientPostal = extractedAddress.recipientPostal || toAddr.postal || toAddr.zip || '';
      extractedAddress.recipientCountry = extractedAddress.recipientCountry || toAddr.country || '';
      extractedAddress.recipientPhone = extractedAddress.recipientPhone || toAddr.phone || '';
      
      // Update name if missing
      if ((!extractedAddress.recipientFirstName || !extractedAddress.recipientLastName) && toAddr.name) {
        const nameParts = toAddr.name.split(' ');
        extractedAddress.recipientFirstName = extractedAddress.recipientFirstName || nameParts[0] || '';
        extractedAddress.recipientLastName = extractedAddress.recipientLastName || nameParts.slice(1).join(' ') || '';
      }
    }
    
    // Check for shipmentAddress field (alternative format used by some marketplaces)
    if (raw.shipmentAddress && typeof raw.shipmentAddress === 'object') {
      const shipAddr = raw.shipmentAddress;
      extractedAddress.recipientStreet1 = extractedAddress.recipientStreet1 || shipAddr.address1 || shipAddr.address || '';
      extractedAddress.recipientStreet2 = extractedAddress.recipientStreet2 || shipAddr.address2 || '';
      extractedAddress.recipientCity = extractedAddress.recipientCity || shipAddr.city || '';
      extractedAddress.recipientState = extractedAddress.recipientState || shipAddr.stateName || shipAddr.state || '';
      extractedAddress.recipientPostal = extractedAddress.recipientPostal || shipAddr.postalCode || shipAddr.zipCode || '';
      extractedAddress.recipientCountry = extractedAddress.recipientCountry || shipAddr.countryCode || '';
      extractedAddress.recipientPhone = extractedAddress.recipientPhone || shipAddr.phone || '';
      
      // Update name if missing
      if (!extractedAddress.recipientFirstName || !extractedAddress.recipientLastName) {
        if (shipAddr.firstName || shipAddr.lastName) {
          extractedAddress.recipientFirstName = extractedAddress.recipientFirstName || shipAddr.firstName || '';
          extractedAddress.recipientLastName = extractedAddress.recipientLastName || shipAddr.lastName || '';
        } else if (shipAddr.fullName) {
          const nameParts = shipAddr.fullName.split(' ');
          extractedAddress.recipientFirstName = extractedAddress.recipientFirstName || nameParts[0] || '';
          extractedAddress.recipientLastName = extractedAddress.recipientLastName || nameParts.slice(1).join(' ') || '';
        }
      }
    }
  }

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
  
  if (shouldTryEtsyEnrichment && order.orderNumber) {
    try {
      // Use pre-fetched enrichment first, fallback to individual API call if needed
      let etsyEnrichment = preFetchedEnrichment;
      
      // If no pre-fetched enrichment found, make individual API call as fallback
      if (!etsyEnrichment) {
        etsyEnrichment = await fetchEtsyAddressEnrichment(order.orderNumber);
      }
      
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
          _etsyCustomerNote: parseEtsyPersonalization(etsyEnrichment.notes)
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

/** Check if an order has existing successful shipments (labels) */
function hasExistingLabel(order: LocalUIOrder): boolean {
  if (!order) return false;
  
  const shipments = order.shipments || [];
  return shipments.some(s => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));
}

/** convert the API payload (LocalUIOrder[]) into grid-ready rows (LabelRow[]) */
export async function toLabelRows(orders: LocalUIOrder[]): Promise<LabelRow[]> {
  if (!orders) return [];

  // Pre-fetch all Etsy addresses in parallel for orders that need enrichment
  const etsyOrderNumbers: string[] = [];
  const orderMap = new Map<string, LocalUIOrder>();
  
  for (const order of orders) {
    if (!order || typeof order !== 'object') continue;
    
    // Use the same logic as in extractAddress to determine enrichment need
    const addr = order.shippingAddress;
    let parsedAddr = addr;
    if (typeof addr === 'string') {
      try { parsedAddr = JSON.parse(addr); } catch { parsedAddr = {}; }
    }
    if (!parsedAddr) parsedAddr = {};

    const extractedAddress = {
      recipientFirstName: parsedAddr.recipientFirstName || parsedAddr.firstName || '',
      recipientLastName: parsedAddr.recipientLastName || parsedAddr.lastName || '', 
      recipientStreet1: parsedAddr.recipientStreet1 || parsedAddr.street1 || parsedAddr.address1 || '',
      recipientCity: parsedAddr.recipientCity || parsedAddr.city || '',
    };

    const isMissingCriticalAddress = !extractedAddress.recipientStreet1 || !extractedAddress.recipientCity;
    
    const shouldTryEtsyEnrichment = order.orderNumber && isMissingCriticalAddress && (
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
  
  // Batch fetch Etsy enrichments in a single API call
  const etsyEnrichments = new Map<string, any>();
  if (etsyOrderNumbers.length > 0) {
    try {
      const response = await fetch(`/api/etsy-addresses?orderNumbers=${etsyOrderNumbers.join(',')}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache'
        }
      });
      
      if (response.ok || response.status === 304) {
        const data = await response.json();
        if (data.success && data.lookup) {
          // Use the lookup map to populate our enrichments
          for (const [orderNumber, enrichment] of Object.entries(data.lookup)) {
            etsyEnrichments.set(orderNumber, enrichment);
          }
        } else {
          console.warn('Etsy batch API returned unexpected format:', data);
        }
      } else {
        console.warn('Failed to fetch Etsy enrichments:', response.status, response.statusText);
      }
    } catch (error) {
      console.warn('Failed to batch fetch Etsy enrichments:', error);
    }
  }

  // Pre-fetch listing URLs: collect Veeqo product IDs and Shippo titles
  const veeqoProductIds: number[] = [];
  const shippoTitles: string[] = [];
  for (const order of orders) {
    if (!order || typeof order !== 'object') continue;
    let safeRaw = order.rawData;
    if (typeof safeRaw === 'string') {
      try { safeRaw = JSON.parse(safeRaw); } catch { safeRaw = {}; }
    }
    const items = order.line_items || safeRaw?.line_items || [];
    for (const item of items) {
      if (item.sellable?.product?.id) {
        veeqoProductIds.push(Number(item.sellable.product.id));
      } else if (item.title) {
        shippoTitles.push(item.title);
      }
    }
  }

  // Batch fetch listing URLs
  const listingUrlsByProductId: Record<string, string> = {};
  const listingUrlsByTitle: Record<string, string> = {};
  if (veeqoProductIds.length > 0 || shippoTitles.length > 0) {
    try {
      const resp = await fetch('/api/listing-urls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productIds: [...new Set(veeqoProductIds)],
          titles: [...new Set(shippoTitles)],
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        Object.assign(listingUrlsByProductId, data.byProductId || {});
        Object.assign(listingUrlsByTitle, data.byTitle || {});
      }
    } catch (error) {
      console.warn('Failed to batch fetch listing URLs:', error);
    }
  }

  const labelRows: LabelRow[] = [];
  for (const order of orders) {
    // Skip invalid orders
    if (!order || typeof order !== 'object') {
      console.warn('[toLabelRows] Skipping invalid order:', order);
      continue;
    }
    
    // PENDING and AWAITING_PAYMENT orders are now filtered out server-side
    
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
    
    
    
    
    // Build Trendyol contentId lookup from rawData.lines (for listing URLs)
    const trendyolContentMap = new Map<string, number>();
    const isTrendyol = (order.marketplace || '').toLowerCase().includes('trendyol');
    if (isTrendyol && safeRaw?.lines) {
      for (const line of safeRaw.lines) {
        if (line.id && line.contentId) {
          trendyolContentMap.set(String(line.id), line.contentId);
        }
      }
    }

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
        customerNote: (addr as any)?._etsyCustomerNote || '',
        originalOrder: order,
        labelCreated: hasOrderLabel,
        shippingLabelUrl: hasOrderLabel ? (latestShipment?.pdfUrl || order.shippingLabelUrl) : undefined,
        labelStockType: order.labelStockType,
        variantInfo: lineItems?.[0]?.variantInfo || '—',
        listingUrl: (() => {
          // Trendyol: construct from contentId
          if (isTrendyol && safeRaw?.lines?.[0]?.contentId) {
            return `https://www.trendyol.com/x/x-p-${safeRaw.lines[0].contentId}`;
          }
          const t = order.commodityDesc || safeRaw?.line_items?.[0]?.title || '';
          return listingUrlsByTitle[t] || undefined;
        })(),
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
        customerNote: (addr as any)?._etsyCustomerNote || '',
        originalOrder: order,
        labelCreated: latestLabelJob?.status === 'created' && !!latestLabelJob?.trackingNumber,
        shippingLabelUrl: latestLabelJob?.pdfUrl || (latestLabelJob?.status === 'created' && latestLabelJob?.trackingNumber ? `/api/labels/${item.id}/pdf` : undefined),
        labelStockType: order.labelStockType,
        variantInfo: item.variantInfo || '—',
        listingUrl: (() => {
          // Veeqo items: resolved via Product API
          if (isVeeqoItem && item.sellable?.product?.id) {
            return listingUrlsByProductId[String(item.sellable.product.id)] || undefined;
          }
          // Trendyol: construct from contentId in rawData.lines
          if (isTrendyol) {
            const lineId = (item as any).remoteLineId || (item as any).marketplaceKey || item.id;
            const contentId = trendyolContentMap.get(String(lineId)) || safeRaw?.lines?.[0]?.contentId;
            if (contentId) return `https://www.trendyol.com/x/x-p-${contentId}`;
          }
          // Fallback: title matching from EtsyListing DB
          const t = item.title || '';
          return listingUrlsByTitle[t] || undefined;
        })(),
      };
    });

    labelRows.push(...itemRows);
  }

  return labelRows;
}


// --- Utility Functions Updated for LabelRow ---
/** default values for the "Create Label" form */
export function getDefaultValues(row: LabelRow, defaultCountryOfOrigin = 'TR') {
  // Access properties directly from LabelRow
  const effectiveCustomsValue = row.customsValue ?? row.orderTotalPrice ?? 0;
  const effectiveQuantity = (row.quantity && row.quantity > 0) ? row.quantity : 1;
  // Ensure calculatedUnitPrice is not NaN if effectiveQuantity somehow ends up 0, though it's defaulted to 1.
  const calculatedUnitPrice = effectiveQuantity > 0 ? effectiveCustomsValue / effectiveQuantity : 0;

  return {
    weightKg: row.weight || row.originalOrder?.weightKg || 0.5, // Use row.weight (item weight) first
    hsCode: row.hsCode === '—' ? (row.originalOrder?.harmonizedCode || '') : row.hsCode, // HS Code can be optional, default to empty
    countryOfOrigin: row.countryOfOrigin || row.originalOrder?.countryOfMfg || defaultCountryOfOrigin,
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
    commodityDesc: row.title || 'Product',
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
      title: row.originalOrder?.commodityDesc || row.title || 'Product',
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
  if (!notes || typeof notes !== 'string') {
    return '';
  }

  try {
    // Look for "Personalization" followed by the actual personalization text
    // Examples:
    // "...PersonalizationLENA | Track package..."
    // "...PersonalizationNot requested on this item. | ..."
    // "...Personalizationit is a custom order | Track package..."

    const personalizationMatch = notes.match(/Personalization([^|]*)/);

    if (personalizationMatch && personalizationMatch[1]) {
      const personalization = personalizationMatch[1].trim();

      // Handle common cases
      if (personalization.toLowerCase().includes('not requested') ||
          personalization.toLowerCase().includes('no personalization')) {
        return '';
      }

      return personalization;
    }

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

/** Shared label status derivation — used by both mobile cards and desktop DataGrid */
function getLabelStatus(row: LabelRow): 'labeled' | 'pending' | 'failed' | 'unlabeled' {
  const originalOrder = row?.originalOrder as LocalUIOrder | undefined;
  const shipments = originalOrder?.shipments || [];
  const hasShipment = shipments.some(s => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));

  const hasLabel = row.trackingNumber ||
                   row.labelCreated ||
                   row.shippingLabelUrl ||
                   row.labelJobStatus === 'created' ||
                   hasShipment;

  if (hasLabel) return 'labeled';
  if (row.labelJobStatus === 'failed') return 'failed';
  if (row.labelJobStatus === 'pending' || row.labelJobStatus === 'processing') return 'pending';
  return 'unlabeled';
}

function LabelsPage(props: { source?: string; channel?: string }) {
  const t = useTranslations('labels');
  const tc = useTranslations('common');
  const tf = useTranslations('fedex');
  const { config, formatCurrency, formatDate, formatDateTime, formatNumber } = useLocale();
  const fedexCurrencyCodes = useMemo(() => getFedexCurrencyCodes(tf), [tf]);

  // Build i18n option arrays from keys
  const labelStatusOptions = useMemo(() => LABEL_STATUS_KEYS.map(o => ({ value: o.value, label: t(`labelStatusOptions.${o.key}`) })), [t]);
  const orderStatusOptions = useMemo(() => ORDER_STATUS_KEYS.map(o => ({ value: o.value, label: t(`orderStatusOptions.${o.key}`) })), [t]);
  const orderStatusFilterOptions = useMemo(() => ORDER_STATUS_FILTER_KEYS.map(o => ({ value: o.value, label: t(`orderStatusFilterOptions.${o.key}`), ...('statuses' in o ? { statuses: o.statuses } : {}) })), [t]);
  const searchTypeOptions = useMemo(() => SEARCH_TYPE_KEYS.map(o => ({ value: o.value, label: t(`searchTypeOptions.${o.key}`) })), [t]);
  const VEEQO_CARRIERS = useMemo(() => VEEQO_CARRIERS_BASE.map(c => ({ ...c, label: c.label === '__OTHER__' ? t('veeqoCarriers.other') : c.label })), [t]);

  // Format date using locale
  const fmtDateTr = useCallback((iso?: string): string => {
    if (!iso) return '\u2014';
    try {
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '\u2014';
      return formatDate(d, { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch {
      return '\u2014';
    }
  }, [formatDate]);

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
  const [searchType, setSearchType] = useState('all');
  const [marketplaceFilter, setMarketplaceFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [labelStatusFilter, setLabelStatusFilter] = useState('');
  const [generatingLabelId, setGeneratingLabelId] = useState<string | null>(null);
  const [syncingOrders, setSyncingOrders] = useState(false);
  const [rawOrderDataModalOpen, setRawOrderDataModalOpen] = useState(false);
  const [currentRawData, setCurrentRawData] = useState<Record<string, any> | null>(null);
  const [hasFedexCredentials, setHasFedexCredentials] = useState(false);
  const [checkingFedexCredentials, setCheckingFedexCredentials] = useState(true);
  const [labelFilter, setLabelFilter] = useState<'all' | 'unlabeled' | 'labeled'>('all');
  const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<string | null>(null);
  const [deletingOrderId, setDeletingOrderId] = useState<string | null>(null);
  const [shipmentDeleteConfirmation, setShipmentDeleteConfirmation] = useState<string | null>(null);
  const [deletingShipmentId, setDeletingShipmentId] = useState<string | null>(null);
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
  
  // --- ETGB Selection State ---
  const [etgbSelectedRows, setEtgbSelectedRows] = useState<string[]>([]);
  const [etgbEnabled, setEtgbEnabled] = useState(false);
  const [processingEtgb, setProcessingEtgb] = useState(false);

  const debouncedSearch = useDebouncedValue(searchTerm, 300);

  // Fetch marketplace options
  const { marketplaceOptions: dbMarketplaceOptions, isLoading: isLoadingMarketplaces } = useMarketplaceOptions();

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
      searchType: searchType,
      startDate: filterStartDate,
      endDate: filterEndDate,
      marketplace: marketplaceFilter.length > 0 ? marketplaceFilter : undefined,
      status: statusFilter,
      labelStatus: labelStatusFilter,
      labelFilter: labelFilter,
    },
    'labelsPage'
  );

  const marketplaceOptions = useMemo(() => {
    if (!fetchedOrders || !Array.isArray(fetchedOrders)) {
      return [{ value: '', label: t('integrationOptions.all') }];
    }
    const marketplaces = new Set(fetchedOrders.map((order: any) => order.marketplace).filter(Boolean));
    const options = Array.from(marketplaces).sort().map(m => ({ value: m, label: m }));
    return [{ value: '', label: t('integrationOptions.all') }, ...options];
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

  // All filtering (search, status, marketplace, date, label) is handled server-side via useOrders
  const filteredAndPaginatedItems = labelRows;

  // Reset pagination when filters change, but use a more stable approach
  useEffect(() => {
    // Use setTimeout to avoid race conditions with the filtering useMemo
    const timer = setTimeout(() => {
      setPaginationModel(prev => ({ ...prev, page: 0 }));
    }, 0);
    return () => clearTimeout(timer);
  }, [debouncedSearch, searchType, statusFilter, labelStatusFilter, labelFilter, filterStartDate, filterEndDate, marketplaceFilter]);

  useEffect(() => {
    const fetchUserSettings = async () => {
      setCheckingFedexCredentials(true);
      try {
        const response = await fetch('/api/user/settings', {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include'
        }); 
        if (!response.ok) {
          console.error('Kullanıcı ayarları alınamadı', response.status, response.statusText);
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
        
        // Check ETGB settings
        if (data.shippingSettings) {
          setEtgbEnabled(!!data.shippingSettings.etgbEnabled);
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
  
  // Clear selection when ETGB is disabled
  useEffect(() => {
    if (!etgbEnabled) {
      setEtgbSelectedRows([]);
    }
  }, [etgbEnabled]);


  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOrder, setDrawerOrder] = useState<LabelRow | null>(null);

  const drawerErrors = useMemo(
    () => (drawerOrder ? validateRowForLabel(drawerOrder) : ['no-row']), // Add 'no-row' or similar to ensure button disabled if no row
    [drawerOrder]
  );

  const openDrawer = (row: LabelRow) => {
    let currentDrawerData = { ...row }; 
    const defaultsFromRow = getDefaultValues(row, config.defaultCountryOfOrigin || 'TR');

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
      headerName: t('columnLabel'),
      width: 30,
      sortable: false,
      valueGetter: (_value, row) => {
        const originalOrder = row?.originalOrder as LocalUIOrder | undefined;
        const shipments = originalOrder?.shipments || [];
        const hasShipment = shipments.some(s => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));

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
          return t('statusReceived');
        }

        if (row.labelJobStatus === 'failed') {
          return t('statusError');
        }

        if (row.labelJobStatus === 'pending') {
          return t('statusPending');
        }

        return t('statusNoLabel');
      },
      renderCell: (params: GridRenderCellParams<LabelRow, string>) => {
        const status = params.value;
        if (status === t('statusReceived')) {
          // First try to get tracking number from row, then from shipments array
          let trackingNumber = params.row.trackingNumber;
          
          if (!trackingNumber) {
            const originalOrder = params.row?.originalOrder as LocalUIOrder | undefined;
            const shipments = originalOrder?.shipments || [];
            const latestShipment = shipments.find(s => s?.status === 'created' && s?.trackingNumber);
            trackingNumber = latestShipment?.trackingNumber || 'Tracking number not available';
          }
          
          // Find the shipment to get its ID for deletion
          const originalOrder = params.row?.originalOrder as LocalUIOrder | undefined;
          const shipments = originalOrder?.shipments || [];
          const latestShipment = shipments.find(s => s?.status === 'created' && (s?.trackingNumber || s?.pdfUrl));
          
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Tooltip title={t('tooltipLabelReceived')}>
                <span
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (trackingNumber && trackingNumber !== 'Tracking number not available') {
                      await navigator.clipboard.writeText(trackingNumber);
                      toast.success(t('trackingCopied'), { duration: 1500 });
                    }
                  }}
                >
                  <CheckCircleIcon color="success" />
                </span>
              </Tooltip>
              {latestShipment?.id && (
                <Tooltip title={t('deleteLabel')}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShipmentDeleteConfirmation(latestShipment.id);
                    }}
                    sx={{ p: 0.25, '&:hover': { backgroundColor: 'error.light', opacity: 0.8 } }}
                  >
                    <DeleteIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  </IconButton>
                </Tooltip>
              )}
            </Box>
          );
        }
        if (status === t('statusError'))   return <Tooltip title={t('tooltipLabelError')}><CancelIcon color="error" /></Tooltip>;
        if (status === t('statusPending')) return <Tooltip title={t('tooltipLabelPending')}><HourglassEmptyIcon color="warning" /></Tooltip>;
        return <Tooltip title={t('tooltipLabelNotCreated')}><CircleIcon color="disabled" /></Tooltip>;
      },
    },
    {
      field: 'tracking',
      headerName: t('columnShipping'),
      width: 30,
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

        // Check if tracking number exists (only manual entries, not from label generation)
        // Check if this order has any manual tracking submissions
        const hasManualTracking = originalOrder?.trackingSubmissions && 
                                 originalOrder.trackingSubmissions.length > 0;
        
        // Show tracking as active only if there's a manual tracking submission
        const hasTracking = hasManualTracking;

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
              <Tooltip title={hasTracking ? t('trackingExists') : t('addTracking')}>
                {hasTracking ? <FlightTakeoffIcon /> : <FlightIcon />}
              </Tooltip>
            </IconButton>
          </Box>
        );
      },
    },
    {
      field: 'itemImageUrl',
      headerName: t('columnProductImage'),
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
            alt={t('columnProductImage')}
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
    { field: 'marketplace', headerName: t('columnStore'), width: 110 },
    {
      field: 'status',
      headerName: tc('status'),
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
      headerName: t('columnOrderDate'), 
      width: 130,
      valueFormatter: (value: string | undefined) => fmtDateTr(value), // Turkish style
      sortable: true,
      sortComparator: (v1, v2) => new Date(v1).getTime() - new Date(v2).getTime(), // newest to oldest
    },
    {
      field: 'orderNumber',
      headerName: t('columnOrderNo'),
      width: 140,
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        const url = getMarketplaceOrderUrl(params.row.marketplace, params.value as string, params.row.channel);
        return (
          <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0.5 }}>
            <Typography variant="body2" noWrap>{params.value || '—'}</Typography>
            {url && (
              <IconButton
                size="small"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                component="a"
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                sx={{ p: 0.25, color: 'primary.main', '&:hover': { color: 'primary.dark' } }}
              >
                <OpenInNewIcon sx={{ fontSize: 14 }} />
              </IconButton>
            )}
          </Box>
        );
      }
    },
    {
      field: 'customerSevk',
      headerName: t('columnCustomerShip'),
      width: 150,
      valueGetter: (_value, row) => `${row.recipientFirstName || ''} ${row.recipientLastName || ''}`.trim() || row.originalOrder?.customerName || '—'
    },
    { 
      field: 'orderTotalPrice', 
      headerName: t('columnTotal'), 
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
      headerName: t('columnProductName'),
      minWidth: 180,
      flex: 2,
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        const listingUrl = getProductListingUrl(params.row);
        return (
          <Tooltip title={params.value || ''} placement="bottom-start">
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                height: '100%',
                gap: 0.5,
                overflow: 'hidden',
                minWidth: 0,
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  cursor: 'pointer',
                  flex: 1,
                  minWidth: 0,
                }}
                onClick={() => {
                  if (params.value) {
                    navigator.clipboard.writeText(params.value as string);
                    toast.success(t('productNameCopied'));
                  }
                }}
              >
                {params.value || '—'}
              </Typography>
              {listingUrl && (
                <IconButton
                  size="small"
                  href={listingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  component="a"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  sx={{ p: 0.25, color: 'primary.main', '&:hover': { color: 'primary.dark' }, flexShrink: 0 }}
                >
                  <OpenInNewIcon sx={{ fontSize: 14 }} />
                </IconButton>
              )}
            </Box>
          </Tooltip>
        );
      }
    },
    { 
      field: 'variantInfo',
      headerName: t('columnVariant'),
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
                toast.success(t('variationCopied'));
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
    { field: 'quantity', headerName: t('quantity'), width: 60, type: 'number' },
    {
      field: 'shipByDate',
      headerName: t('shipByDate'),
      width: 130,
      valueFormatter: (value: string | undefined) => value ? formatDate(value) : '—',
    },
    {
      field: 'customerNote',
      headerName: t('customerNote'),
      width: 150,
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
            toast.success(t('noteCopied'));
          } catch (err) {
            console.error('Failed to copy note:', err);
            toast.error(t('copyFailed'));
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
          title={t('clickToCopy', { context: note })}
          >
            {note}
          </div>
        );
      }
    },
    {
      field: 'lastCarrier',
      headerName: t('carrier'), 
      width: 140, 
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        // Try to get the latest label job's carrier
        const labelJobs = params.row.originalOrder?.line_items?.find(i => i.id === params.row.itemId)?.labelJobs || [];
        const latestLabelJob = labelJobs.length > 0 ? labelJobs[0] : null;
        
        // Also check shipments for carrier info (UPS creates shipments but not labelJobs)
        const shipments = params.row.originalOrder?.shipments || [];
        const latestShipment = shipments.length > 0 ? shipments[0] : null;
        
        const carrier = latestLabelJob?.carrier || (latestShipment as any)?.carrier || params.row.lastCarrier;
        if (carrier === 'FEDEX') {
          if (latestLabelJob?.pdfUrl) {
            return (
              <a
                href={latestLabelJob.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: 'inline-block' }}
                title={t('openLabel')}
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
                title={t('openLabel')}
              >
                <img src="/images/United_Parcel_Service_logo.png" alt="UPS" style={{ height: 16, marginLeft: 2, cursor: 'pointer' }} />
              </a>
            );
          }
          return <img src="/images/United_Parcel_Service_logo.png" alt="UPS" style={{ height: 16, marginLeft: 2 }} title="UPS" />;
        }
        return carrier || '—';
      }
    },
    {
      field: 'actions',
      headerName: t('details'),
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
            const originalOrder = params.row.originalOrder as LocalUIOrder | undefined;
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
              shipments: originalOrder?.shipments || [],
            };
            setSelectedOrderForUPS(uiOrder); 
            setUpsDrawerOpen(true); 
          }}>
            UPS
          </Button>
        </>
      )
    },
    {
      field: 'delete',
      headerName: tc('delete'),
      width: 80,
      sortable: false,
      renderCell: (params: GridRenderCellParams<LabelRow>) => {
        const orderId = params.row?.orderId;
        const orderNumber = params.row?.orderNumber;
        
        if (!orderId) return null;

        const isConfirming = deleteConfirmation === orderId;
        const isDeleting = deletingOrderId === orderId;

        if (isDeleting) {
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <CircularProgress size={16} />
            </Box>
          );
        }

        if (isConfirming) {
          return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Tooltip title={tc('delete')}>
                <IconButton
                  size="small"
                  onClick={() => handleDeleteOrder(orderId)}
                  sx={{ color: 'success.main', padding: '2px' }}
                >
                  <CheckIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={tc('cancel')}>
                <IconButton
                  size="small"
                  onClick={() => setDeleteConfirmation(null)}
                  sx={{ color: 'error.main', padding: '2px' }}
                >
                  <CancelIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          );
        }

        return (
          <Tooltip title={t('deleteOrder', { orderNumber })}>
            <IconButton
              size="small"
              onClick={() => setDeleteConfirmation(orderId)}
              sx={{ color: 'error.main', padding: '4px' }}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        );
      }
    },
  ];

  const handleSync = async () => {
    setSyncingOrders(true);
    const toastId = toast.loading(t('syncingOrders'));
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
        throw new Error(data.error || t('unknownError'));
      }
      toast.success(t('ordersSyncSuccess'), { id: toastId });
      // Optionally refresh data after sync
      mutate && mutate();
    } catch (e: any) {
      toast.error(t('syncError', { error: e.message }), { id: toastId });
    } finally {
      setSyncingOrders(false);
    }
  };

  const handleTrackingSubmit = async () => {
    if (!selectedOrderForTracking || !trackingFormData.trackingNumber.trim()) {
      return;
    }

    setSubmittingTracking(true);
    const toastId = toast.loading(t('sendingTracking'));
    
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
        throw new Error(data.error || t('trackingFailed'));
      }

      toast.success(t('trackingSuccess'), { id: toastId });
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
      toast.error(`${tc('error')}: ${e.message}`, { id: toastId });
    } finally {
      setSubmittingTracking(false);
    }
  };

  const handleRefresh = () => {
    const toastId = toast.loading(t('refreshingOrders'));
    mutate().then(() => {
      toast.success(t('refreshSuccess'), { id: toastId });
    }).catch(() => {
      toast.error(t('refreshError'), { id: toastId });
    });
  };
  
  const handleProcessEtgb = async () => {
    if (etgbSelectedRows.length === 0) {
      toast.error(t('selectOrders'));
      return;
    }
    
    setProcessingEtgb(true);
    const toastId = toast.loading(t('etgbStarting', { count: etgbSelectedRows.length }));
    
    try {
      // Get user settings for ETGB recipient email (NextAuth cookie auth)
      const settingsResponse = await fetch('/api/user/settings');
      let settings: any = {};
      try {
        settings = await settingsResponse.json();
      } catch (_) {
        settings = {};
      }
      const recipientEmail = settings.shippingSettings?.etgbRecipientEmail;
      
      if (!recipientEmail) {
        toast.error(t('etgbEmailNotConfigured'), { id: toastId });
        return;
      }
      
      // Process ETGB (NextAuth cookie auth)
      const response = await fetch('/api/etgb/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          orderIds: etgbSelectedRows,
          recipientEmail: recipientEmail
        })
      });
      
      let result: any = {};
      try {
        result = await response.json();
      } catch (_) {
        // If backend crashed and returned non-JSON, create a fallback error
        throw new Error(t('serverUnexpectedResponse'));
      }
      
      if (response.ok && result.success) {
        toast.success(t('etgbSentTo', { email: recipientEmail }), { id: toastId });
        // Clear selection after successful processing
        setEtgbSelectedRows([]);
      } else {
        throw new Error(result.error || result.message || t('etgbFailed'));
      }
      
    } catch (error: any) {
      toast.error(`${t('etgbError')}: ${error.message}`, { id: toastId });
    } finally {
      setProcessingEtgb(false);
    }
  };
  
  const handleGenerateLabel = async (rowForLabel: LabelRow) => {
    if (!hasFedexCredentials) {
      toast.error(t('fedexIncomplete'));
      return;
    }
    const currentFormValues = drawerOpen && drawerOrder ? drawerOrder : rowForLabel;
    
    const validationErrors = validateRowForLabel(currentFormValues);
    if (validationErrors.length > 0) {
      toast.error(`${t('fillMissingFields')}: ${validationErrors.join(', ')}`);
      return;
    }

    setGeneratingLabelId(currentFormValues.itemId);
    const toastLabelId = toast.loading(t('savingLabel', { orderNumber: currentFormValues.orderNumber }));
    
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
        commodityDesc: currentFormValues.title || 'Product' // use the edited title
      };

      const dbUpdateResponse = await fetch('/api/orders/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbUpdatePayload),
      });

      if (!dbUpdateResponse.ok) {
        const errorData = await dbUpdateResponse.json().catch(() => ({ error: t('dbUpdateError') }));
        toast.error(errorData.error || errorData.details || `${t('dbUpdateFailed')}: ${dbUpdateResponse.statusText || dbUpdateResponse.status}`, { id: toastLabelId });
        setGeneratingLabelId(null);
        return; // Stop if DB update fails
      }
      toast.success(t('dbUpdateSuccess'), { id: toastLabelId, duration: 2000 });
      toast.loading(t('generatingLabel', { orderNumber: currentFormValues.orderNumber }), { id: toastLabelId });

      // Step 2: Prepare payload for /update-options (FedEx specific options)
      const defaultsForFedexPayload = getDefaultValues(currentFormValues, config.defaultCountryOfOrigin || 'TR');
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
        const errData = await saveOptionsResponse.json().catch(() => ({ error: t('fedexOptionsError') }));
        // Surface the error message from the API if it's a 400 (validation error)
        throw new Error(errData.error || `${t('fedexOptionsError')}: ${saveOptionsResponse.status}`);
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
        let errorMsg = `${t('labelGenerationError')} (HTTP ${labelResponse.status})`;
        try {
          const errorData = await labelResponse.json();
          errorMsg = errorData.error || errorData.message || errorMsg;
        } catch (jsonError) {
          const textError = await labelResponse.text();
            errorMsg = textError.substring(0,200) || t('unknownServerError');
        }
        throw new Error(errorMsg);
      }
      const labelData = await labelResponse.json();
      toast.success(t('labelCreatedWithTracking', { orderNumber: currentFormValues.orderNumber, trackingNumber: labelData.trackingNumber }), { id: toastLabelId, duration: 6000 });
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
      toast.error(error.message || t('unknownError'), { id: toastLabelId, duration: 8000 });
    } finally {
      setGeneratingLabelId(null);
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    setDeletingOrderId(orderId);
    try {
      const response = await fetch(`/api/orders/${orderId}/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete order');
      }

      toast.success(t('deleteSuccess'));
      setDeleteConfirmation(null);
      await mutate(); // Refresh the orders list
    } catch (error: any) {
      console.error('Error deleting order:', error);
      toast.error(error.message || t('deleteError'));
    } finally {
      setDeletingOrderId(null);
    }
  };

  const handleDeleteShipment = async (shipmentId: string) => {
    setDeletingShipmentId(shipmentId);
    try {
      const response = await fetch(`/api/shipments/${shipmentId}/delete`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include'
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete shipment');
      }

      toast.success(t('labelDeletedSuccess'));
      setShipmentDeleteConfirmation(null);
      await mutate(); // Refresh the orders list
    } catch (error: any) {
      console.error('Error deleting shipment:', error);
      toast.error(error.message || t('labelDeleteError'));
    } finally {
      setDeletingShipmentId(null);
    }
  };

  const handleViewRawData = (data: Record<string, any>) => {
    setCurrentRawData(data);
    setRawOrderDataModalOpen(true);
  };

  return (
    <Box sx={{ height: { xs: 'calc(100dvh - 56px)', md: 'calc(100dvh - 64px - 48px)' }, display: 'flex', flexDirection: 'column', p: { xs: 0.5, sm: 2 }, overflow: 'auto', maxWidth: '100%' }}>
      <Toaster position="top-right" reverseOrder={false} />
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 'bold', mb: { xs: 1, sm: 2 }, fontSize: { xs: '1.1rem', sm: '1.5rem' }, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {t('labelManagement')}
      </Typography>
      <Box sx={{ display:'flex', flexDirection:'column', gap: 1, mb: 1, maxWidth: '100%', flexShrink: 0 }}>
        {/* Row 1: Actions + Search (always visible) */}
        <Paper elevation={1} sx={{ p: { xs: 0.75, sm: 1.5 }, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', maxWidth: '100%' }}>
          <Button variant="contained" color="primary" startIcon={<SyncIcon />} onClick={handleSync} disabled={syncingOrders || isLoading} size="small" sx={{ textTransform: 'none', fontSize: { xs: '0.7rem', sm: '0.8rem' }, px: { xs: 1, sm: 2 }, minWidth: 0, whiteSpace: 'nowrap' }}>
            {syncingOrders ? t('syncing') : t('syncButton')}
          </Button>
          <ManualOrderButton onOrderCreated={() => { mutate(); toast.success(t('orderListRefreshed')); }} />
          {etgbEnabled && (
            <Button variant="contained" color="secondary" onClick={handleProcessEtgb} disabled={processingEtgb || etgbSelectedRows.length === 0} size="small" sx={{ textTransform: 'none' }}>
              {processingEtgb ? t('processing') : `ETGB (${etgbSelectedRows.length})`}
            </Button>
          )}
          <Box sx={{ display: 'flex', gap: 0.5, flex: 1, minWidth: { xs: '100%', sm: 200 } }}>
            <FormControl size="small" variant="outlined" sx={{ minWidth: 80 }}>
              <Select value={searchType} onChange={e => setSearchType(e.target.value)} displayEmpty sx={{ fontSize: '0.8rem', height: 36 }}>
                {searchTypeOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField size="small" placeholder="Ara..." variant="outlined" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} InputProps={{ endAdornment: <SearchIcon fontSize="small" sx={{ color: 'text.disabled' }} /> }} sx={{ flex: 1, '& .MuiInputBase-root': { height: 36, fontSize: '0.8rem' } }} />
          </Box>
          <Tooltip title={t('refresh')}>
            <span><IconButton onClick={handleRefresh} disabled={isLoading || syncingOrders} color="primary" size="small"><RefreshIcon fontSize="small" /></IconButton></span>
          </Tooltip>
        </Paper>

        {/* Row 2: Filters (hidden on mobile) */}
        <Paper elevation={0} sx={{ p: { xs: 0.5, sm: 1 }, display: { xs: 'none', sm: 'flex' }, gap: 1, alignItems: 'center', flexWrap: 'wrap', bgcolor: 'grey.50' }}>
          <FormControl size="small" variant="outlined" sx={{ minWidth: 120 }}>
            <InputLabel shrink>{t('orderStatus')}</InputLabel>
            <Select value={statusFilter} label={t('orderStatus')} onChange={e => setStatusFilter(e.target.value)} displayEmpty sx={{ fontSize: '0.8rem', height: 34 }}>
              {orderStatusFilterOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" variant="outlined" sx={{ minWidth: 120 }}>
            <InputLabel shrink>{t('labelStatus')}</InputLabel>
            <Select value={labelStatusFilter} label={t('labelStatus')} onChange={e => setLabelStatusFilter(e.target.value)} displayEmpty sx={{ fontSize: '0.8rem', height: 34 }}>
              {labelStatusOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" variant="outlined" sx={{ minWidth: 120, display: { xs: 'none', md: 'inline-flex' } }}>
            <InputLabel shrink>{t('store')}</InputLabel>
            <Select
              multiple
              value={marketplaceFilter}
              label={t('store')}
              onChange={(e) => setMarketplaceFilter(typeof e.target.value === 'string' ? [e.target.value] : e.target.value)}
              displayEmpty
              renderValue={(selected) => selected.length === 0 ? <em>{t('all')}</em> : selected.length === 1 ? selected[0] : t('storesCount', { count: selected.length })}
              disabled={isLoadingMarketplaces}
              sx={{ fontSize: '0.8rem', height: 34 }}
              MenuProps={{ PaperProps: { style: { maxHeight: 7 * 48 + 8, width: 250 } } }}
            >
              <MenuItem value=""><em>{t('all')}</em></MenuItem>
              {dbMarketplaceOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label} ({opt.count})</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label={t('startDate')} type="date" value={filterStartDate} onChange={e => setFilterStartDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} sx={{ width: 140, '& .MuiInputBase-root': { height: 34, fontSize: '0.8rem' } }} />
          <TextField label={t('endDate')} type="date" value={filterEndDate} onChange={e => setFilterEndDate(e.target.value)} size="small" InputLabelProps={{ shrink: true }} sx={{ width: 140, '& .MuiInputBase-root': { height: 34, fontSize: '0.8rem' } }} />
          <Button onClick={() => { setSearchTerm(''); setSearchType('all'); setStatusFilter(''); setLabelStatusFilter(''); setMarketplaceFilter([]); setLabelFilter('all'); const now = new Date(); const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); setFilterStartDate(sevenDaysAgo.toISOString().slice(0, 10)); setFilterEndDate(now.toISOString().slice(0, 10)); }} variant="text" size="small" sx={{ fontSize: '0.75rem', textTransform: 'none' }}>{t('reset')}</Button>
        </Paper>

        {/* Row 3: Label toggle tabs */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <ToggleButtonGroup exclusive size="small" value={labelFilter} onChange={handleLabelFilter} aria-label={t('labelFilter')} sx={{ '& .MuiToggleButton-root': { fontSize: '0.75rem', px: { xs: 1, sm: 2 }, py: 0.3 } }}>
            <ToggleButton value="all">{t('all')}</ToggleButton>
            <ToggleButton value="unlabeled">{t('unlabeled')}</ToggleButton>
            <ToggleButton value="labeled">{t('received')}</ToggleButton>
          </ToggleButtonGroup>
          <Typography variant="caption" color="text.secondary">{t('ordersCount', { count: total })}</Typography>
        </Box>
      </Box>

      {/* Mobile Card Layout */}
      <Box sx={{ display: { xs: 'flex', md: 'none' }, flexDirection: 'column', flexGrow: 1, overflow: 'auto', minHeight: 0, WebkitOverflowScrolling: 'touch' }}>
        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={32} />
          </Box>
        ) : filteredAndPaginatedItems.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4, color: 'text.secondary' }}>
            <Typography variant="body2">{t('noOrdersFound')}</Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, pb: 1 }}>
            {filteredAndPaginatedItems.map((row) => {
              const cardId = row.itemId || row.orderId;
              const isExpanded = expandedCardId === cardId;
              const labelSt = getLabelStatus(row);
              const statusConfig = statusColors[row.status?.toUpperCase() || ''] || { bg: '#eee', text: '#333' };
              const statusLabel = orderStatusOptions.find(o => o.value === row.status?.toUpperCase())?.label || row.status || '-';
              const currSymbol = row.currency === 'TRY' ? '₺' : row.currency === 'EUR' ? '€' : row.currency === 'GBP' ? '£' : '$';

              return (
                <Paper
                  key={cardId}
                  elevation={isExpanded ? 3 : 1}
                  sx={{ border: '1px solid', borderColor: isExpanded ? 'primary.light' : 'divider', borderRadius: 1.5, overflow: 'hidden' }}
                >
                  {/* Collapsed header — always visible */}
                  <Box
                    onClick={() => setExpandedCardId(isExpanded ? null : cardId)}
                    sx={{ display: 'flex', gap: 1.5, p: 1.25, cursor: 'pointer', alignItems: 'center' }}
                  >
                    {row.itemImageUrl && row.itemImageUrl !== '/placeholder.png' ? (
                      <Box component="img" src={row.itemImageUrl} sx={{ width: 44, height: 44, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }} />
                    ) : (
                      <Box sx={{ width: 44, height: 44, borderRadius: 1, bgcolor: 'grey.100', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Typography variant="caption" color="text.disabled">-</Typography>
                      </Box>
                    )}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Typography variant="body2" fontWeight={600} noWrap sx={{ fontSize: '0.8rem' }}>
                          {row.recipientFirstName} {row.recipientLastName}
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                          <Chip label={labelSt === 'labeled' ? t('received') : labelSt === 'pending' ? t('pending') : labelSt === 'failed' ? t('failed') : t('unlabeled')}
                            size="small"
                            sx={{
                              height: 18, fontSize: '0.6rem', fontWeight: 600,
                              bgcolor: labelSt === 'labeled' ? '#e8f5e9' : labelSt === 'pending' ? '#fff3e0' : labelSt === 'failed' ? '#ffebee' : 'grey.100',
                              color: labelSt === 'labeled' ? '#2e7d32' : labelSt === 'pending' ? '#e65100' : labelSt === 'failed' ? '#c62828' : 'text.secondary',
                            }}
                          />
                          <ExpandMoreIcon sx={{ fontSize: 18, color: 'text.disabled', transform: isExpanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                        </Box>
                      </Box>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: '0.7rem' }}>
                        {(() => {
                          const mpUrl = getMarketplaceOrderUrl(row.marketplace, row.orderNumber, row.channel);
                          return mpUrl ? (
                            <a href={mpUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#1976d2', textDecoration: 'none' }}>
                              #{row.orderNumber} <OpenInNewIcon sx={{ fontSize: 10, verticalAlign: 'middle' }} />
                            </a>
                          ) : (
                            <>#{row.orderNumber}</>
                          );
                        })()} · {row.marketplace || '-'} · {row.orderDate ? formatDate(new Date(row.orderDate)) : '-'}
                        {row.orderTotalPrice > 0 && ` · ${currSymbol}${row.orderTotalPrice.toFixed(2)}`}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', fontSize: '0.65rem' }}>
                        {row.listingUrl ? (
                          <a href={row.listingUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: '#1976d2', textDecoration: 'none' }}>
                            {row.title || row.sku || '-'} <OpenInNewIcon sx={{ fontSize: 9, verticalAlign: 'middle' }} />
                          </a>
                        ) : (row.title || row.sku || '-')}
                        {row.variantInfo && row.variantInfo !== '—' ? ` · ${row.variantInfo}` : ''}
                      </Typography>
                    </Box>
                  </Box>

                  {/* Expanded details */}
                  {isExpanded && (
                    <Box sx={{ px: 1.25, pb: 1.25, pt: 0, borderTop: '1px solid', borderColor: 'divider', overflow: 'hidden', wordBreak: 'break-word' }}>
                      {/* Customer note / Personalization */}
                      {row.customerNote && row.customerNote.trim() !== '' && (
                        <Box sx={{ py: 0.75 }}>
                          <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5 }}>{t('customerNote')}</Typography>
                          <Typography variant="body2" sx={{ fontSize: '0.78rem', mt: 0.25, bgcolor: '#fffde7', p: 0.75, borderRadius: 1, whiteSpace: 'pre-wrap' }}>{row.customerNote}</Typography>
                        </Box>
                      )}

                      {/* Address */}
                      <Box sx={{ py: 0.75, borderTop: '1px dashed', borderColor: 'divider' }}>
                        <Typography variant="caption" fontWeight={600} color="text.secondary" sx={{ textTransform: 'uppercase', fontSize: '0.6rem', letterSpacing: 0.5 }}>{t('deliveryAddress')}</Typography>
                        <Box sx={{ mt: 0.25 }}>
                          <Typography variant="body2" sx={{ fontSize: '0.78rem' }}>{row.recipientFirstName} {row.recipientLastName}</Typography>
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{row.recipientStreet1}{row.recipientStreet2 ? `, ${row.recipientStreet2}` : ''}</Typography>
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{row.recipientCity}{row.recipientState ? `, ${row.recipientState}` : ''} {row.recipientPostal}</Typography>
                          <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{row.recipientCountry}</Typography>
                          {row.recipientPhone && <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{t('phone')}: {row.recipientPhone}</Typography>}
                          {row.recipientEmail && <Typography variant="body2" sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{t('email')}: {row.recipientEmail}</Typography>}
                        </Box>
                      </Box>

                      {/* Order status & shipping info */}
                      <Box sx={{ py: 0.75, borderTop: '1px dashed', borderColor: 'divider', display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Chip label={statusLabel} size="small" sx={{ height: 20, fontSize: '0.65rem', bgcolor: statusConfig.bg, color: statusConfig.text }} />
                        {row.shipByDate && <Typography variant="caption" color="text.secondary">{t('shipBy')}: {fmtDateTr(row.shipByDate)}</Typography>}
                        {row.trackingNumber && <Typography variant="caption" color="text.secondary">{t('tracking')}: {row.lastCarrier} {row.trackingNumber}</Typography>}
                      </Box>

                      {/* Action buttons */}
                      <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                        <Button
                          variant="contained"
                          size="small"
                          fullWidth
                          onClick={() => openDrawer(row)}
                          sx={{ textTransform: 'none', fontSize: '0.8rem', py: 0.75 }}
                        >
                          {t('fedexLabel')}
                        </Button>
                        <Button
                          variant="outlined"
                          size="small"
                          fullWidth
                          onClick={() => {
                            const originalOrder = row.originalOrder as LocalUIOrder | undefined;
                            const uiOrder: UIOrder = {
                              orderId: row.orderId,
                              orderNumber: row.orderNumber,
                              recipientFirstName: row.recipientFirstName,
                              recipientLastName: row.recipientLastName,
                              recipientStreet1: row.recipientStreet1,
                              recipientStreet2: row.recipientStreet2,
                              recipientCity: row.recipientCity,
                              recipientState: row.recipientState,
                              recipientPostal: row.recipientPostal,
                              recipientCountry: row.recipientCountry,
                              recipientPhone: row.recipientPhone,
                              recipientEmail: row.recipientEmail,
                              orderTotalPrice: row.orderTotalPrice,
                              currency: row.currency,
                              title: row.title,
                              weight: row.weight,
                              hsCode: row.hsCode,
                              countryOfOrigin: row.countryOfOrigin,
                              shipments: originalOrder?.shipments || [],
                            };
                            setSelectedOrderForUPS(uiOrder);
                            setUpsDrawerOpen(true);
                          }}
                          sx={{ textTransform: 'none', fontSize: '0.8rem', py: 0.75 }}
                        >
                          {t('upsLabel')}
                        </Button>
                      </Box>
                    </Box>
                  )}
                </Paper>
              );
            })}
            {/* Mobile pagination */}
            <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 2, py: 1 }}>
              <Button size="small" disabled={paginationModel.page === 0} onClick={() => setPaginationModel(prev => ({ ...prev, page: prev.page - 1 }))}>{t('previous')}</Button>
              <Typography variant="caption">{paginationModel.page + 1} / {Math.ceil(total / paginationModel.pageSize) || 1}</Typography>
              <Button size="small" disabled={(paginationModel.page + 1) * paginationModel.pageSize >= total} onClick={() => setPaginationModel(prev => ({ ...prev, page: prev.page + 1 }))}>{t('next')}</Button>
            </Box>
          </Box>
        )}
      </Box>

      {/* Desktop DataGrid */}
      <Box sx={{ flexGrow: 1, width: '100%', overflow: 'hidden', minHeight: 0, display: { xs: 'none', md: 'block' } }}>
        <div
          style={{ height: '100%' }}
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
              // Use requestAnimationFrame to ensure state update happens after current event
              requestAnimationFrame(() => {
                setPaginationModel(newModel);
              });
            }}
            getRowId={(row) => row.itemId || row.orderId}
            disableRowSelectionOnClick
            onCellClick={(params, event) => {
              // Don't open drawer for interactive columns
              const skipFields = ['actions', 'delete', 'tracking', 'labelStatus', '__check__'];
              if (skipFields.includes(params.field)) return;
              // Don't open drawer if clicking buttons/links inside cells
              const target = event.target as HTMLElement;
              if (target.closest('button') || target.closest('a') || target.closest('.MuiCheckbox-root')) return;
              openDrawer(params.row as LabelRow);
            }}
            rowHeight={60}
            disableColumnResize={false}
            disableColumnMenu
            keepNonExistentRowsSelected={etgbEnabled}
            checkboxSelection={etgbEnabled}
            onRowSelectionModelChange={etgbEnabled ? ((newSelection) => {
              // Extract selected row ids robustly across MUI versions
              let selectedIds: GridRowId[] = [];
              const anyModel = newSelection as any;
              if (Array.isArray(anyModel)) {
                selectedIds = anyModel as GridRowId[];
              } else if (anyModel && Array.isArray(anyModel.ids)) {
                selectedIds = anyModel.ids as GridRowId[];
              } else if (anyModel && anyModel.ids && typeof anyModel.ids.size === 'number') {
                selectedIds = Array.from(anyModel.ids as Set<GridRowId>);
              }

              const orderIds = selectedIds
                .map(id => {
                  const row = filteredAndPaginatedItems.find(r => (r.itemId || r.orderId) === id);
                  return row?.orderId;
                })
                .filter(Boolean) as string[];
              const uniqueOrderIds = Array.from(new Set(orderIds));
              setEtgbSelectedRows(uniqueOrderIds);
            }) : undefined}
            initialState={{
              sorting: {
                sortModel: [{ field: 'orderDate', sort: 'desc' }],
              },
            }}
            density="compact"
            sx={{
              height: '100%',
              border: 0,
              fontSize: { xs: '0.7rem', sm: '0.8rem', md: '0.875rem' },
              '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f5f5f5', fontSize: { xs: '0.65rem', sm: '0.75rem' } },
              '& .MuiDataGrid-columnHeaderTitle': { fontWeight: 600 },
              '& .MuiDataGrid-cell': { py: 0.5, px: { xs: 0.5, sm: 1 } },
              '& .MuiDataGrid-cell:focus-within, & .MuiDataGrid-cell:focus': {
                outline: 'none !important',
              },
            }}
          />
        </div>
      </Box>

      {drawerOrder && (
        <Drawer anchor="right" open={drawerOpen} onClose={closeDrawer}>
          <Box sx={{ width: { xs: '100%', sm: 500, md: 600 }, maxWidth: '100%', display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Box sx={{ p: { xs: 1.5, sm: 2 }, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Typography variant="h6">{t('createLabel')}</Typography>
              <Typography variant="body2" color="text.secondary">{t('orderNo', { number: drawerOrder.orderNumber })}</Typography>
            </Box>

            <Box sx={{ flexGrow: 1, overflowY: 'auto', p: { xs: 1.5, sm: 2 } }}>
              {/* Shipping Details Accordion */}
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>{t('shippingDetails')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <TextField name="recipientFirstName" label={t('recipientFirstName')} value={drawerOrder.recipientFirstName || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('First Name'))} />
                  <TextField name="recipientLastName" label={t('recipientLastName')} value={drawerOrder.recipientLastName || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Last Name'))} />
                  <TextField name="recipientStreet1" label={t('addressLine1')} value={drawerOrder.recipientStreet1 || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Street address'))} />
                  <TextField name="recipientStreet2" label={t('addressLine2')} value={drawerOrder.recipientStreet2 || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" />
                  <TextField name="recipientCity" label={t('city')} value={drawerOrder.recipientCity || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('City'))} />
                  <TextField name="recipientState" label={t('stateRegion')} value={drawerOrder.recipientState || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" />
                  <TextField name="recipientPostal" label={t('postalCode')} value={drawerOrder.recipientPostal || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Postal code'))} />
                  <TextField name="recipientCountry" label={t('country')} value={drawerOrder.recipientCountry || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Country'))} />
                  <TextField name="recipientPhone" label={t('phone')} value={drawerOrder.recipientPhone || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" />
                  <TextField name="recipientEmail" label={t('emailOptional')} value={drawerOrder.recipientEmail || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" type="email" />
                  <TextField 
                    name="title" 
                    label={t('productDescription')}
                    value={drawerOrder.title || ''} 
                    onChange={handleDrawerChange} 
                    fullWidth 
                    margin="dense" 
                    size="small" 
                  />
                  <Grid container spacing={2}>
                    <Grid item xs={4}><TextField name="weight" label={t('weight')} value={drawerOrder.weight || 0.5} inputProps={{ step: "0.1", style: { MozAppearance: 'textfield' } }} sx={{ '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 } }} onChange={handleDrawerChange} fullWidth margin="dense" size="small" error={drawerErrors.some(e => e.includes('Weight'))} /></Grid>
                    <Grid item xs={4}><TextField name="packageLength" label={t('length')} value={drawerOrder.originalOrder?.packageLength || ''} type="number" onChange={handleOriginalOrderChange} fullWidth margin="dense" size="small" /></Grid>
                    <Grid item xs={4}><TextField name="packageWidth" label={t('width')} value={drawerOrder.originalOrder?.packageWidth || ''} type="number" onChange={handleOriginalOrderChange} fullWidth margin="dense" size="small" /></Grid>
                    <Grid item xs={4}><TextField name="packageHeight" label={t('height')} value={drawerOrder.originalOrder?.packageHeight || ''} type="number" onChange={handleOriginalOrderChange} fullWidth margin="dense" size="small" /></Grid>
                    <Grid item xs={8}><TextField name="hsCode" label={t('hsCode')} value={drawerOrder.hsCode || ''} onChange={handleDrawerChange} fullWidth margin="dense" size="small" /></Grid>
                  </Grid>
                  <Grid container spacing={2} sx={{ mt: 0.5 }}>
                    <Grid item xs={6}>
                      <TextField 
                        name="orderTotalPrice" 
                        label={t('value')}
                        value={drawerOrder.orderTotalPrice || 0} 
                        type="number"
                        inputProps={{ step: "0.01", min: "0", style: { MozAppearance: 'textfield' } }} 
                        sx={{ '& input[type=number]::-webkit-outer-spin-button, & input[type=number]::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 } }} 
                        onChange={handleDrawerChange} 
                        fullWidth 
                        margin="dense" 
                        size="small" 
                      />
                    </Grid>
                    <Grid item xs={6}>
                      <FormControl fullWidth margin="dense" size="small">
                        <InputLabel>{t('currency')}</InputLabel>
                        <Select
                          name="currency"
                          value={drawerOrder.currency || 'USD'}
                          onChange={handleDrawerChange}
                          label={t('currency')}
                        >
                          {fedexCurrencyCodes.map(curr => (
                            <MenuItem key={curr.value} value={curr.value}>{curr.label}</MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>

              {/* FedEx Options Accordion */}
              <Accordion>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography>{t('fedexOptions')}</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>{t('serviceType')}</InputLabel>
                    <Select
                      name="fedexServiceType"
                      value={drawerOrder.fedexServiceType || ''}
                      onChange={handleDrawerChange}
                      label={t('serviceType')}
                    >
                      {FEDEX_SERVICE_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>{t('packageType')}</InputLabel>
                    <Select
                      name="fedexPackagingType"
                      value={drawerOrder.fedexPackagingType || ''}
                      onChange={handleDrawerChange}
                      label={t('packageType')}
                    >
                      {FEDEX_PACKAGING_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
                    </Select>
                  </FormControl>
                  <FormControl fullWidth margin="dense" size="small">
                    <InputLabel>{t('labelSize')}</InputLabel>
                    <Select
                      name="labelStockType"
                      value={drawerOrder.labelStockType || 'PAPER_4X6'}
                      onChange={handleDrawerChange}
                      label={t('labelSize')}
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
                disabled={drawerErrors.length > 0 || generatingLabelId === drawerOrder?.itemId || checkingFedexCredentials || !hasFedexCredentials || (drawerOrder?.originalOrder && hasExistingLabel(drawerOrder.originalOrder))}
              >
                {generatingLabelId === drawerOrder?.itemId ? <CircularProgress size={24} color="inherit" /> : (checkingFedexCredentials ? t('checkingSettings') : (!hasFedexCredentials ? t('fedexSettingsMissing') : (drawerOrder?.originalOrder && hasExistingLabel(drawerOrder.originalOrder) ? t('deleteExistingLabel') : t('createLabel'))))}
              </Button>
              <Button fullWidth variant="text" onClick={closeDrawer} sx={{mt:1}}>{t('cancel')}</Button>
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
          {t('productImage')}
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
              alt={t('columnProductImage')}
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
          {t('addTrackingNumber')}
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
                  {t('orderLabel')}: {selectedOrderForTracking.orderNumber}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Market: {selectedOrderForTracking.marketplace}
                </Typography>
              </Box>
            )}
            
            <TextField
              fullWidth
              label={t('trackingNumber')}
              value={trackingFormData.trackingNumber}
              onChange={(e) => setTrackingFormData(prev => ({...prev, trackingNumber: e.target.value}))}
              placeholder="1Z999AA10123456784"
              required
            />

            <FormControl fullWidth>
              <InputLabel>{t('shippingCarrier')}</InputLabel>
              <Select
                value={trackingFormData.carrierId}
                label={t('shippingCarrier')}
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
                {t('cancel')}
              </Button>
              <Button
                variant="contained"
                onClick={handleTrackingSubmit}
                disabled={submittingTracking || !trackingFormData.trackingNumber.trim()}
                startIcon={submittingTracking ? <CircularProgress size={16} /> : null}
              >
                {submittingTracking ? t('sending') : t('save')}
              </Button>
            </Box>
          </Box>
        </DialogContent>
      </Dialog>

      {/* Shipment Delete Confirmation Dialog */}
      <Dialog
        open={!!shipmentDeleteConfirmation}
        onClose={() => setShipmentDeleteConfirmation(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {t('deleteLabel')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {t('deleteLabelConfirmation')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('areYouSure')}
          </Typography>
        </DialogContent>
        <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end', p: 2 }}>
          <Button 
            onClick={() => setShipmentDeleteConfirmation(null)}
            disabled={!!deletingShipmentId}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => shipmentDeleteConfirmation && handleDeleteShipment(shipmentDeleteConfirmation)}
            disabled={!!deletingShipmentId}
            startIcon={deletingShipmentId ? <CircularProgress size={16} /> : null}
          >
            {deletingShipmentId ? t('deleting') : t('delete')}
          </Button>
        </Box>
      </Dialog>
</Box>
  );
}

function LabelsPageWithLayout(props: any): JSX.Element {
  const t = useTranslations('labels');
  return (
    <AppLayout title={t('labelManagement')}>
      <LabelsPage {...props} />
    </AppLayout>
  );
}

export default withAuth(LabelsPageWithLayout);
