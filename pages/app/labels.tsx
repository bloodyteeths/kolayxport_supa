import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Box, Button, CircularProgress, Tooltip, Dialog, DialogTitle, DialogContent, Snackbar, Alert, TextField, Select, MenuItem, InputLabel, FormControl, IconButton, Typography, Paper, Accordion, AccordionSummary, AccordionDetails, Chip, Drawer, Fade, List, ListItem, ListItemIcon, ListItemText
} from '@mui/material';
import { DataGrid, GridColDef, GridPaginationModel, GridRenderCellParams } from '@mui/x-data-grid';
import { Sync as SyncIcon, Refresh as RefreshIcon, Search as SearchIcon, Close as CloseIcon, ExpandMore as ExpandMoreIcon, Edit as EditIcon, Check as CheckIcon, Warning as WarningIcon, Error as ErrorIcon, Info as InfoIcon, Lock as LockIcon } from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import { useOrders } from '../../lib/hooks/useOrders';
import Layout from '@/components/Layout';
import AppLayout from '@/components/AppLayout';
import { OrderSource, OrderChannel, UIOrder, NormalizedLineItem } from '@/lib/types';

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
  { value: 'failed', label: 'Hata Alındı' }, // Assuming shipmentStatus might indicate this
];

const integrationOptions = [
  { value: '', label: 'Tümü (Market)' },
  { value: 'Veeqo', label: 'Veeqo' },
  { value: 'Shippo', label: 'Shippo' },
  { value: 'Trendyol', label: 'Trendyol' },
  { value: 'Hepsiburada', label: 'Hepsiburada' },
  // Add other marketplaces as they become relevant
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

// --- Define a type for the flattened order item rows ---
type LabelOrderItem = UIOrder & {
  orderId: string;
  _debugShippingAddress?: string;
  _debugMappedAddress?: Record<string, string>;
};

// --- Debounce utility ---
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debounced;
}

// --- Address mapping utility ---
function extractAddress(order) {
  let addr = order.shippingAddress;
  if (typeof addr === 'string') {
    try { addr = JSON.parse(addr); } catch { addr = {}; }
  }
  let raw = order.rawData;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(raw); } catch { raw = {}; }
  }
  const deliverTo = raw?.deliver_to || {};
  const billing = raw?.billing_address || {};

  // Only treat actual anonymized strings as anonymized
  const isAnonymized = (value) => {
    if (typeof value !== 'string') return false;
    return value === 'Anonymized by Amazon' || value === 'Anonymized By Amazon' || value.includes('Anonymized');
  };

  // Helper to get the first non-empty, non-anonymized value
  const getValue = (...values) => {
    for (const v of values) {
      if (typeof v === 'string' && v.trim() && !isAnonymized(v)) return v;
    }
    return '';
  };

  // Fallback: try all possible keys in addr/raw
  const fallback = (keys) => {
    for (const k of keys) {
      if (addr && addr[k] && !isAnonymized(addr[k])) return addr[k];
      if (raw && raw[k] && !isAnonymized(raw[k])) return raw[k];
    }
    return '';
  };

  return {
    recipientFirstName: getValue(
      addr?.recipientFirstName, addr?.recipient_first_name, addr?.first_name, addr?.name,
      deliverTo.first_name, billing.first_name, raw?.first_name, raw?.name,
      fallback(['recipientFirstName','recipient_first_name','first_name','name'])
    ),
    recipientLastName: getValue(
      addr?.recipientLastName, addr?.recipient_last_name, addr?.last_name,
      deliverTo.last_name, billing.last_name, raw?.last_name,
      fallback(['recipientLastName','recipient_last_name','last_name'])
    ),
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

// Add source/channel badge components
function SourceBadge({ source }: { source?: OrderSource }) {
  if (!source) return null;
  const color = source === 'shippo' ? 'primary' : 'default';
  return <Chip label={source.toUpperCase()} color={color} size="small" />;
}

function ChannelBadge({ channel }: { channel?: OrderChannel }) {
  if (!channel) return null;
  const color = channel === 'etsy' ? 'secondary' : 'default';
  return <Chip label={channel.toUpperCase()} color={color} size="small" />;
}

// Add validation status helper
function getValidationStatus(order: UIOrder): { status: 'valid' | 'warning' | 'error'; message: string } {
  const { valid, errors } = validateOrderForLabel(order);
  if (valid) return { status: 'valid', message: 'Ready for label' };
  
  // Categorize errors
  const addressErrors = errors.filter(e => e.startsWith('Missing'));
  const lineItemErrors = errors.filter(e => e.includes('Line item'));
  
  if (addressErrors.length > 0 && lineItemErrors.length > 0) {
    return { 
      status: 'error', 
      message: `${addressErrors.length} address fields and ${lineItemErrors.length} line items missing` 
    };
  }
  if (addressErrors.length > 0) {
    return { status: 'error', message: `${addressErrors.length} address fields missing` };
  }
  if (lineItemErrors.length > 0) {
    return { status: 'warning', message: `${lineItemErrors.length} line items need attention` };
  }
  return { status: 'error', message: 'Validation failed' };
}

// Add validation status chip component
function ValidationStatusChip({ status, message }: { status: 'valid' | 'warning' | 'error'; message: string }) {
  const color = status === 'valid' ? 'success' : status === 'warning' ? 'warning' : 'error';
  return (
    <Tooltip title={message}>
      <Chip 
        label={status === 'valid' ? 'Ready' : status === 'warning' ? 'Warning' : 'Error'} 
        color={color} 
        size="small" 
        icon={status === 'valid' ? <CheckIcon /> : status === 'warning' ? <WarningIcon /> : <ErrorIcon />}
      />
    </Tooltip>
  );
}

// Validation helper function
function validateOrderForLabel(order: UIOrder): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  // Validate address fields with more specific messages
  const addressFields = [
    { field: 'recipientFirstName', label: 'First Name', type: 'name' },
    { field: 'recipientLastName', label: 'Last Name', type: 'name' },
    { field: 'recipientPhone', label: 'Phone', type: 'contact' },
    { field: 'recipientStreet1', label: 'Street Address', type: 'address' },
    { field: 'recipientCity', label: 'City', type: 'address' },
    { field: 'recipientState', label: 'State', type: 'address' },
    { field: 'recipientPostal', label: 'Postal Code', type: 'address' },
    { field: 'recipientCountry', label: 'Country', type: 'address' }
  ];

  const missingFields = addressFields.filter(({ field }) => !order[field] || order[field].trim() === '');
  if (missingFields.length > 0) {
    const groupedByType = missingFields.reduce((acc, { label, type }) => {
      acc[type] = acc[type] || [];
      acc[type].push(label);
      return acc;
    }, {} as Record<string, string[]>);

    Object.entries(groupedByType).forEach(([type, fields]) => {
      errors.push(`Missing ${type} information: ${fields.join(', ')}`);
    });
  }

  // Validate line items with more specific messages
  if (!order.line_items || order.line_items.length === 0) {
    errors.push('No line items found - at least one item is required');
  } else {
    order.line_items.forEach((item, index) => {
      const itemErrors = [];
      if (!item.title || item.title.trim() === '') {
        itemErrors.push('missing title');
      }
      if (!item.value || item.value <= 0) {
        itemErrors.push('invalid value');
      }
      if (!item.quantity || item.quantity <= 0) {
        itemErrors.push('invalid quantity');
      }
      if (itemErrors.length > 0) {
        errors.push(`Item ${index + 1}: ${itemErrors.join(', ')}`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Auto-fill helper function
function getDefaultValues(order: UIOrder) {
  return {
    weight: order.weight || 0.5,
    hsCode: order.hsCode || '620449506',
    countryOfOrigin: order.countryOfOrigin || 'TR',
    serviceType: order.serviceType || 'INTERNATIONAL_PRIORITY',
    packagingType: order.packagingType || 'FEDEX_PAK',
    // Include address fields with defaults from order
    recipientFirstName: order.recipientFirstName || '',
    recipientLastName: order.recipientLastName || '',
    recipientStreet1: order.recipientStreet1 || '',
    recipientStreet2: order.recipientStreet2 || '',
    recipientCity: order.recipientCity || '',
    recipientState: order.recipientState || '',
    recipientPostal: order.recipientPostal || '',
    recipientCountry: order.recipientCountry || '',
    recipientPhone: order.recipientPhone || ''
  };
}

// Add Shippo notes parser helper
function parseShippoNotes(notes: string): { to_address?: any; success: boolean } {
  try {
    // Look for Shippo-style JSON in notes
    const shippoMatch = notes.match(/to_address\s*:\s*({[^}]+})/);
    if (shippoMatch) {
      const addressJson = shippoMatch[1].replace(/'/g, '"'); // Replace single quotes with double quotes
      const toAddress = JSON.parse(addressJson);
      return { to_address: toAddress, success: true };
    }
    return { success: false };
  } catch (error) {
    console.error('Failed to parse Shippo notes:', error);
    return { success: false };
  }
}

function LabelsPage(props) {
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 100 });
  const [searchTerm, setSearchTerm] = useState('');
  const [marketplaceFilter, setMarketplaceFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [labelStatusFilter, setLabelStatusFilter] = useState('');
  
  const [serviceTypeOverrides, setServiceTypeOverrides] = useState<Record<string, string>>({});
  const [packagingTypeOverrides, setPackagingTypeOverrides] = useState<Record<string, string>>({});
  
  const [generatingLabelId, setGeneratingLabelId] = useState<string | null>(null);
  const [syncingOrders, setSyncingOrders] = useState(false);

  const [rawOrderDataModalOpen, setRawOrderDataModalOpen] = useState(false);
  const [currentRawData, setCurrentRawData] = useState<Record<string, any> | null>(null);

  // Placeholder for FedEx credentials check - replace with actual logic
  const [hasFedexCredentials, setHasFedexCredentials] = useState(false); // Default to false
  const [checkingFedexCredentials, setCheckingFedexCredentials] = useState(true);
  // TODO: Fetch user settings to determine if FedEx credentials are set

  const [unlabeledOnly, setUnlabeledOnly] = useState(false);
  // Debounced filters
  const debouncedSearch = useDebouncedValue(searchTerm, 300);
  const debouncedMarketplace = useDebouncedValue(marketplaceFilter, 300);
  const debouncedStatus = useDebouncedValue(statusFilter, 300);
  const debouncedLabelStatus = useDebouncedValue(labelStatusFilter, 300);

  const [filterStartDate, setFilterStartDate] = useState(() => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return sevenDaysAgo.toISOString().slice(0, 10);
  });
  const [filterEndDate, setFilterEndDate] = useState(() => new Date().toISOString().slice(0, 10));

  const [drawerErrors, setDrawerErrors] = useState<string[]>([]);
  const [drawerFieldErrors, setDrawerFieldErrors] = useState<Record<string, boolean>>({});

  // Add state for address source
  const [addressSource, setAddressSource] = useState<'default' | 'shippo'>('default');
  const [readOnlyAddress, setReadOnlyAddress] = useState(true);

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
          // Check FedEx credentials
          const hasFedex = data.integrationSettings.fedexApiKey &&
            data.integrationSettings.fedexApiSecret &&
                          data.integrationSettings.fedexAccountNumber;
          setHasFedexCredentials(hasFedex);

          // Check Veeqo and Shippo credentials
          const hasVeeqo = !!data.integrationSettings.veeqoApiKey;
          const hasShippo = !!data.integrationSettings.shippoToken;

          if (!hasVeeqo && !hasShippo) {
            toast.error('Lütfen Veeqo veya Shippo entegrasyon ayarlarınızı tamamlayın.');
          }
        } else {
          setHasFedexCredentials(false);
          toast.error('Lütfen entegrasyon ayarlarınızı tamamlayın.');
        }
      } catch (error) {
        console.error('Error fetching user settings for labels page:', error);
        setHasFedexCredentials(false);
        toast.error('Kullanıcı ayarları alınırken bir hata oluştu.');
      } finally {
        setCheckingFedexCredentials(false);
      }
    };
    fetchUserSettings();
  }, []); // Empty dependency array to run once on mount

  useEffect(() => {
    setPaginationModel(prev => ({ ...prev, page: 0 }));
  }, [debouncedSearch]);

  const { orders, total, page, pageSize, isLoading, isError, mutate } = useOrders(
    paginationModel.page,
    paginationModel.pageSize,
    {
      search: debouncedSearch,
      source: props.source,
      channel: props.channel,
      status: props.status,
      marketplace: props.marketplace,
      startDate: filterStartDate,
      endDate: filterEndDate,
      sort: 'desc'  // Sort by createdAt in descending order
    },
    'labelsPage' // Add context parameter for Labels page
  );

  // Handle error state
  if (isError) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          An error occurred while loading orders. Please try again.
        </Alert>
      </Box>
    );
  }

  // Debug: print all unique marketplaces in fetched orders
  if (orders && orders.length) {
    console.log('Marketplaces in fetched orders:', [...new Set(orders.map(o => o.marketplace))]);
  }

  // DIAGNOSTIC LOGGING
  console.log('ORDERS:', orders as any);
  if (orders && orders.length) {
    console.log('First order:', orders[0] as any);
  }

  const handleServiceTypeChange = (orderId: string, value: string) => {
    setServiceTypeOverrides(prev => ({ ...prev, [orderId]: value }));
  };

  const handlePackagingTypeChange = (orderId: string, value: string) => {
    setPackagingTypeOverrides(prev => ({ ...prev, [orderId]: value }));
  };

  // --- Flatten orders to order items with parent order info ---
  const orderItems: LabelOrderItem[] = useMemo(() => {
    if (!orders || orders.length === 0) return [];
    return orders.flatMap(uiOrder => {
      // Ensure correct mapping for marketplaceOrderDate and commodityDesc
      const gridRowMarketplaceOrderDate = uiOrder.marketplaceOrderDate || uiOrder.createdAt || '';
      // TypeScript: line_items is present from backend, but not in UIOrder type, so cast to any
      const lineItems = (uiOrder as any).line_items || [];
      let gridRowCommodityDesc = '---';
      if (lineItems.length > 0) {
        gridRowCommodityDesc = lineItems[0].title || lineItems[0].productName || '---';
      }
      const gridRow: LabelOrderItem = {
        ...(uiOrder as any),
        orderId: uiOrder.id,
        id: uiOrder.id,
        marketplaceOrderDate: gridRowMarketplaceOrderDate,
        createdAt: gridRowMarketplaceOrderDate,
        commodityDesc: gridRowCommodityDesc,
      };
      return [gridRow];
    });
  }, [orders]);

  // Debug log for createdAt values
  if (orderItems.length) {
    console.log('[createdAt debug]', orderItems.slice(0, 5).map(o => o.createdAt));
  }

  // --- Filtering ---
  const filteredItems = useMemo(() => {
    const result = orderItems.filter(row => {
      if (debouncedMarketplace && row.marketplace !== debouncedMarketplace) return false;
      if (debouncedStatus && row.status !== debouncedStatus) return false;
      if (debouncedLabelStatus) {
        if (debouncedLabelStatus === 'created' && !row.shippingLabelUrl) return false;
        if (debouncedLabelStatus === 'not_created' && row.shippingLabelUrl) return false;
        if (debouncedLabelStatus === 'failed' && row.status !== 'FAILED' && row.status !== 'ERROR') return false;
      }
      if (unlabeledOnly && row.shippingLabelUrl) return false;
      return true;
    });
    // Debug: print all unique marketplaces in filteredItems
    if (result.length) {
      console.log('Marketplaces in filteredItems:', [...new Set(result.map(o => o.marketplace))]);
    }
    return result;
  }, [orderItems, debouncedMarketplace, debouncedStatus, debouncedLabelStatus, unlabeledOnly]);

  // --- Date filter now handled by backend ---
  const filteredByDate = filteredItems;

  // --- Pagination ---
  const pagedItems = useMemo(() => {
    const start = paginationModel.page * paginationModel.pageSize;
    return filteredItems.slice(start, start + paginationModel.pageSize);
  }, [filteredItems, paginationModel]);

  // --- In-row editing ---
  const [itemEdits, setItemEdits] = useState<Record<string, any>>({});
  const handleEditField = (itemId: string, field: string, value: any) => {
    setItemEdits(prev => ({ ...prev, [itemId]: { ...prev[itemId], [field]: value } }));
  };

  // --- Responsive: show table on desktop, card/accordion on mobile ---
  const [expandedMobile, setExpandedMobile] = useState<string | null>(null);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  // --- Group OrderItems by Order ---
  const groupedOrders = useMemo(() => {
    const map: Record<string, { order: LabelOrderItem, items: LabelOrderItem[] }> = {};
    orderItems.forEach(item => {
      if (!map[item.orderId]) {
        map[item.orderId] = { order: item, items: [] };
      }
      map[item.orderId].items.push(item);
    });
    return Object.values(map);
  }, [orderItems]);

  // --- Status badge helper ---
  function getLabelStatusChip(labelCreated: boolean, status?: string) {
    if (status === 'FAILED' || status === 'ERROR') return <Chip label="Failed" color="error" size="small" />;
    if (labelCreated) return <Chip label="Labeled" color="success" size="small" />;
    return <Chip label="Not Labeled" color="default" size="small" />;
  }
  function getOrderStatusChip(status?: string) {
    if (!status) return null;
    let color: 'default' | 'primary' | 'success' | 'error' | 'warning' = 'default';
    if (status === 'SHIPPED' || status === 'DELIVERED' || status === 'COMPLETED') color = 'success';
    else if (status === 'FAILED' || status === 'CANCELLED') color = 'error';
    else if (status === 'PENDING' || status === 'ON_HOLD') color = 'warning';
    else color = 'primary';
    return <Chip label={status} color={color} size="small" />;
  }

  // --- Hover-to-edit logic ---
  const [editField, setEditField] = useState<{ [itemId: string]: string | null }>({});
  const handleEditStart = (itemId: string, field: string) => setEditField(prev => ({ ...prev, [itemId]: field }));
  const handleEditEnd = (itemId: string) => setEditField(prev => ({ ...prev, [itemId]: null }));

  // --- Sidebar Drawer logic ---
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOrder, setDrawerOrder] = useState<LabelOrderItem | null>(null);
  const openDrawer = (order: LabelOrderItem) => {
    console.log('Opening drawer with order:', order);
    
    // Get the full order from orders array
    const originalOrder = orders.find(o => o.id === order.orderId) as any;
    if (!originalOrder) {
      console.error('Original order not found:', order.orderId);
      return;
    }
    
    // Ensure line items are properly initialized from the original order
    const normalizedLineItems = ((originalOrder.line_items || []) as any[]).map(item => ({
      id: item.id || String(Math.random()),
      title: item.title || '',
      value: typeof item.value === 'number' ? item.value : parseFloat(String(item.value)) || 0,
      quantity: item.quantity || 1,
      weight: typeof item.weight === 'number' ? item.weight : parseFloat(String(item.weight)) || 0.5,
      hs_code: item.hs_code || '',
      country_of_origin: item.country_of_origin || 'TR',
      sku: item.sku || '',
      image: item.image || '',
      variantInfo: item.variantInfo || ''
    }));
    
    const defaults = getDefaultValues(originalOrder) as any;
    let addressSource: 'default' | 'shippo' = 'default';
    
    // Check for Shippo notes in Etsy orders from Veeqo
    if (originalOrder.source === 'veeqo' && originalOrder.channel === 'etsy' && originalOrder.rawData?.notes) {
      const { to_address, success } = parseShippoNotes(originalOrder.rawData.notes);
      if (success && to_address) {
        console.log(`[Shippo Fallback] Found address in notes for order ${originalOrder.id}`);
        // Update address fields from Shippo data
        defaults.recipientFirstName = to_address.name?.split(' ')[0] || defaults.recipientFirstName;
        defaults.recipientLastName = to_address.name?.split(' ').slice(1).join(' ') || defaults.recipientLastName;
        defaults.recipientStreet1 = to_address.street1 || defaults.recipientStreet1;
        defaults.recipientStreet2 = to_address.street2 || defaults.recipientStreet2;
        defaults.recipientCity = to_address.city || defaults.recipientCity;
        defaults.recipientState = to_address.state || defaults.recipientState;
        defaults.recipientPostal = to_address.zip || defaults.recipientPostal;
        defaults.recipientCountry = to_address.country || defaults.recipientCountry;
        defaults.recipientPhone = to_address.phone || defaults.recipientPhone;
        addressSource = 'shippo';
        setReadOnlyAddress(true); // Start in read-only mode for Shippo addresses
      }
    }

    setDrawerOrder({ 
      ...originalOrder, 
      ...defaults,
      line_items: normalizedLineItems,
      marketplaceOrderDate: originalOrder.marketplaceOrderDate || originalOrder.marketplaceCreatedAt
    } as any);
    setDrawerOpen(true);
    
    // Run initial validation
    const { errors } = validateOrderForLabel({ ...originalOrder, ...defaults, line_items: normalizedLineItems } as any);
    setDrawerErrors(errors);
    
    // Set field-level errors
    const fieldErrors: Record<string, boolean> = {};
    if (!defaults.recipientFirstName) fieldErrors.recipientFirstName = true;
    if (!defaults.recipientLastName) fieldErrors.recipientLastName = true;
    if (!defaults.recipientPhone) fieldErrors.recipientPhone = true;
    if (!defaults.recipientStreet1) fieldErrors.recipientStreet1 = true;
    if (!defaults.recipientCity) fieldErrors.recipientCity = true;
    if (!defaults.recipientState) fieldErrors.recipientState = true;
    if (!defaults.recipientPostal) fieldErrors.recipientPostal = true;
    if (!defaults.recipientCountry) fieldErrors.recipientCountry = true;
    if (!normalizedLineItems.length) fieldErrors.line_items = true;
    
    setDrawerFieldErrors(fieldErrors);
    setAddressSource(addressSource);
  };
  const closeDrawer = () => {
    setDrawerOpen(false);
    setReadOnlyAddress(true); // Reset read-only state when closing
  };

  // --- Columns for DataGrid ---
  const columns: GridColDef<LabelOrderItem>[] = [
    {
      field: 'marketplaceOrderDate',
      headerName: 'Sipariş Tarihi',
      width: 180,
      valueFormatter: (params: { value: string | undefined }) => formatDate(params.value),
      sortable: true
    },
    {
      field: 'orderNumber',
      headerName: 'Sipariş No',
      width: 150,
      renderCell: (params: GridRenderCellParams<LabelOrderItem>) => (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="body2">{params.value}</Typography>
          <SourceBadge source={params.row.source} />
          <ChannelBadge channel={params.row.channel} />
        </Box>
      )
    },
    {
      field: 'customerName',
      headerName: 'Müşteri',
      width: 200,
      valueGetter: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        return order.customerName || `${order.recipientFirstName} ${order.recipientLastName}`.trim() || '—';
      }
    },
    {
      field: 'commodityDesc',
      headerName: 'Ürün',
      width: 200,
      valueGetter: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        return order.commodityDesc || order.line_items[0]?.title || '—';
      }
    },
    {
      field: 'recipientPostal',
      headerName: 'Posta Kodu',
      width: 120,
      valueGetter: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        return order.recipientPostal || order.to_address?.postal || '—';
      }
    },
    {
      field: 'recipientCountry',
      headerName: 'Ülke',
      width: 100,
      valueGetter: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        return order.recipientCountry || order.to_address?.country || '—';
      }
    },
    {
      field: 'weightKg',
      headerName: 'Ağırlık (kg)',
      width: 120,
      valueGetter: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        return order.weightKg || order.line_items[0]?.weight || 0.5;
      }
    },
    {
      field: 'harmonizedCode',
      headerName: 'HS Kodu',
      width: 120,
      valueGetter: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        return order.harmonizedCode || order.line_items[0]?.hs_code || '—';
      }
    },
    {
      field: 'countryOfMfg',
      headerName: 'Menşei',
      width: 120,
      valueGetter: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        return order.countryOfMfg || order.line_items[0]?.country_of_origin || '—';
      }
    },
    {
      field: 'fedexServiceType',
      headerName: 'Kargo Tipi',
      width: 180,
      renderCell: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        const value = order.fedexServiceType || order.serviceType || 'FEDEX_GROUND';
        const option = FEDEX_SERVICE_TYPES.find(opt => opt.value === value);
        return (
          <FormControl size="small" fullWidth>
            <Select
              value={value}
              onChange={(e) => handleServiceTypeChange(order.id, e.target.value)}
              size="small"
              sx={{ minWidth: 150 }}
            >
              {FEDEX_SERVICE_TYPES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );
      }
    },
    {
      field: 'fedexPackagingType',
      headerName: 'Paket Tipi',
      width: 150,
      renderCell: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        const value = order.fedexPackagingType || order.packagingType || 'YOUR_PACKAGING';
        const option = FEDEX_PACKAGING_TYPES.find(opt => opt.value === value);
        return (
          <FormControl size="small" fullWidth>
            <Select
              value={value}
              onChange={(e) => handlePackagingTypeChange(order.id, e.target.value)}
              size="small"
              sx={{ minWidth: 120 }}
            >
              {FEDEX_PACKAGING_TYPES.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        );
      }
    },
    {
      field: 'validation',
      headerName: 'Durum',
      width: 120,
      renderCell: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        const { status, message } = getValidationStatus(order);
        return <ValidationStatusChip status={status} message={message} />;
      }
    },
    {
      field: 'actions',
      headerName: 'İşlemler',
      width: 120,
      renderCell: (params: GridRenderCellParams<LabelOrderItem>) => {
        const order = params.row;
        const { valid } = validateOrderForLabel(order);
        return (
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              size="small"
              onClick={() => openDrawer(order)}
              startIcon={<EditIcon />}
            >
              Düzenle
            </Button>
            <Button
              variant="contained"
              color="primary"
              size="small"
              onClick={() => handleGenerateLabel(order)}
              disabled={!valid}
              startIcon={<CheckIcon />}
            >
              Etiket
            </Button>
          </Box>
        );
      }
    }
  ];

  // --- Debug log for DataGrid rows ---
  if (typeof window !== 'undefined') {
    console.log('[DataGrid] First 3 rows:', filteredByDate.slice(0, 3));
  }

  const handleSync = async () => {
    setSyncingOrders(true);
    const toastId = toast.loading('Siparişler senkronize ediliyor...');
    try {
      // First fetch user settings to get both Veeqo and Shippo credentials
      const settingsRes = await fetch('/api/user/settings');
      if (!settingsRes.ok) {
        throw new Error('Kullanıcı ayarları alınamadı');
      }
      const settings = await settingsRes.json();
      
      // Then call sync endpoint with both credentials
      const res = await fetch('/api/orders/sync', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          veeqoApiKey: settings.integrationSettings?.veeqoApiKey,
          shippoToken: settings.integrationSettings?.shippoToken
        })
      });
      console.log('[SYNC DEBUG] Sync response status:', res.status);
      const text = await res.text();
      console.log('[SYNC DEBUG] Sync response text:', text);
      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        console.error('[SYNC DEBUG] Failed to parse sync response as JSON:', e, text);
        throw new Error('Sync response is not valid JSON');
      }
      if (!res.ok) {
        throw new Error(result.error || 'Bilinmeyen bir hata oluştu.');
      }
      toast.success(`Senkronizasyon tamamlandı! ${Number(result.successfulOrders) || 0} sipariş işlendi.`, { id: toastId });
      await mutate(); // Refetch orders
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
  
  const handleGenerateLabel = async (orderDataFromDrawer: UIOrder) => {
    if (!hasFedexCredentials) {
      toast.error('Etiket oluşturmak için FedEx ayarlarınızı tamamlamanız gerekmektedir.');
      return;
    }

    // Client-side validation based on current drawer state
    const { valid, errors: validationErrors } = validateOrderForLabel(orderDataFromDrawer);
    if (!valid) {
      setDrawerErrors(validationErrors);
      toast.error(`Lütfen eksik alanları doldurun: ${validationErrors.join(', ')}`);
      return;
    }

    setGeneratingLabelId(orderDataFromDrawer.id);
    const toastLabelId = toast.loading(`'${orderDataFromDrawer.orderNumber}' için etiket oluşturuluyor...`);

    try {
      // Prepare the payload with all required fields
      const payloadToSave = {
        ...orderDataFromDrawer,
        // Ensure all ETD fields are included
        weightKg: orderDataFromDrawer.weightKg || orderDataFromDrawer.line_items[0]?.weight || 0.5,
        harmonizedCode: orderDataFromDrawer.harmonizedCode || orderDataFromDrawer.line_items[0]?.hs_code || '',
        countryOfMfg: orderDataFromDrawer.countryOfMfg || orderDataFromDrawer.line_items[0]?.country_of_origin || '',
        commodityDesc: orderDataFromDrawer.commodityDesc || orderDataFromDrawer.line_items[0]?.title || '',
        termsOfSale: orderDataFromDrawer.termsOfSale || 'DDP',
        sendCommercialInvoiceViaEtd: orderDataFromDrawer.sendCommercialInvoiceViaEtd ?? true,
        fedexServiceType: orderDataFromDrawer.fedexServiceType || 'FEDEX_GROUND',
        fedexPackagingType: orderDataFromDrawer.fedexPackagingType || 'YOUR_PACKAGING',
        fedexPickupType: orderDataFromDrawer.fedexPickupType || 'DROP_BOX',
        fedexDutiesPaymentType: orderDataFromDrawer.fedexDutiesPaymentType || 'SENDER',
        packageLength: orderDataFromDrawer.packageLength,
        packageWidth: orderDataFromDrawer.packageWidth,
        packageHeight: orderDataFromDrawer.packageHeight,
        dimensionUnits: orderDataFromDrawer.dimensionUnits || 'CM',
        labelStockType: orderDataFromDrawer.labelStockType || 'PAPER_LETTER',
        signatureType: orderDataFromDrawer.signatureType || 'NO_SIGNATURE_REQUIRED',
        // Include shipping address
        shippingAddress: {
          recipientFirstName: orderDataFromDrawer.recipientFirstName || orderDataFromDrawer.to_address?.name?.split(' ')[0] || '',
          recipientLastName: orderDataFromDrawer.recipientLastName || orderDataFromDrawer.to_address?.name?.split(' ').slice(1).join(' ') || '',
          recipientStreet1: orderDataFromDrawer.recipientStreet1 || orderDataFromDrawer.to_address?.street1 || '',
          recipientStreet2: orderDataFromDrawer.recipientStreet2 || orderDataFromDrawer.to_address?.street2 || '',
          recipientCity: orderDataFromDrawer.recipientCity || orderDataFromDrawer.to_address?.city || '',
          recipientState: orderDataFromDrawer.recipientState || orderDataFromDrawer.to_address?.state || '',
          recipientPostal: orderDataFromDrawer.recipientPostal || orderDataFromDrawer.to_address?.postal || '',
          recipientCountry: orderDataFromDrawer.recipientCountry || orderDataFromDrawer.to_address?.country || '',
          recipientPhone: orderDataFromDrawer.recipientPhone || orderDataFromDrawer.to_address?.phone || '',
        }
      };

      // Save the updated order data
      const saveResponse = await fetch(`/api/orders/${orderDataFromDrawer.id}/update-options`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadToSave)
      });

      if (!saveResponse.ok) {
        const errData = await saveResponse.json();
        throw new Error(errData.error || 'Failed to save order data');
      }

      toast.success(`'${orderDataFromDrawer.orderNumber}' için değişiklikler kaydedildi!`);

      // After successful save, generate the label
      const labelResponse = await fetch(`/api/orders/${orderDataFromDrawer.id}/generate-label`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadToSave)
      });

      if (!labelResponse.ok) {
        let errorMsg = `Etiket oluşturma hatası (HTTP ${labelResponse.status})`;
        let errorDetailsFromServer;
        try {
          const errorData = await labelResponse.json();
          errorMsg = errorData.error || errorData.message || errorMsg;
          errorDetailsFromServer = errorData.details;
          if (errorDetailsFromServer) console.error('Error details from server:', errorDetailsFromServer);
        } catch (jsonError) {
          const textError = await labelResponse.text();
          console.error('Non-JSON error response from generate-label:', textError.substring(0, 500));
          if (labelResponse.status === 404) errorMsg = 'Etiket oluşturma servisi bulunamadı (404).';
          else if (textError.toLowerCase().includes('doctype')) errorMsg = 'Sunucudan beklenmeyen bir yanıt alındı (HTML).';
        }
        if (errorDetailsFromServer && Array.isArray(errorDetailsFromServer) && errorDetailsFromServer.some((err: any) => err.code === 'PHONENUMBER.TOO.LONG')) {
          errorMsg += ' Telefon numarası çok uzun. Lütfen düzeltip tekrar deneyin.';
        }
        throw new Error(errorMsg);
      }

      const labelData = await labelResponse.json();
      
      // Show success message
      toast.success(`'${orderDataFromDrawer.orderNumber}' için etiket oluşturuldu! Takip No: ${labelData.trackingNumber}`, { id: toastLabelId, duration: 6000 });
      
      if (labelData.labelUrl) {
        window.open(labelData.labelUrl, '_blank', 'noopener,noreferrer');
      }
      
      if (labelData.alerts && labelData.alerts.length > 0) {
        labelData.alerts.forEach((alert: any) => toast.custom((t) => (
          <Alert severity={alert.type?.toLowerCase() || 'warning'} onClose={() => toast.dismiss(t.id)}>
            {alert.message || JSON.stringify(alert)}
          </Alert>
        ), { duration: 8000 }));
      }
      
      // Refresh the orders list
      if (mutate) await mutate();
      
      // Close the drawer
      if (drawerOpen && closeDrawer) closeDrawer();
      
      return labelData;
    } catch (error: any) {
      console.error('Error generating label:', error);
      toast.error(error.message, { id: toastLabelId, duration: 8000 });
      throw error;
    } finally {
      setGeneratingLabelId(null);
    }
  };

  const handleViewRawData = (data: Record<string, any>) => {
    setCurrentRawData(data);
    setRawOrderDataModalOpen(true);
  };

  // --- Render ---
  return (
    <Box sx={{ m: 2, p: 2, backgroundColor: 'background.paper', borderRadius: 2, boxShadow: 3 }}>
      <Toaster position="top-right" reverseOrder={false} />
      <Typography variant="h5" component="h1" gutterBottom sx={{ fontWeight: 'bold', mb: 2 }}>
        Etiket Yönetimi
      </Typography>
      {/* --- Toolbar --- */}
      <Paper elevation={1} sx={{ p: 2, mb: 2, display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          color="primary"
          startIcon={<SyncIcon />}
          onClick={handleSync}
          disabled={syncingOrders}
          sx={{ textTransform: 'none', height: '40px' }}
        >
          {syncingOrders ? 'Senkronize Ediliyor...' : 'Siparişleri Senkron Et'}
        </Button>
        <TextField
          size="small"
          label="Sipariş ID / Müşteri Adı Ara"
          variant="outlined"
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          InputProps={{ endAdornment: <SearchIcon fontSize="small" /> }}
          sx={{ minWidth: '250px', height: '40px' }}
        />
        <FormControl size="small" variant="outlined" sx={{ minWidth: 180, height: '40px' }}>
          <InputLabel>Marketplace</InputLabel>
          <Select value={marketplaceFilter} label="Marketplace" onChange={e => setMarketplaceFilter(e.target.value)}>
            {integrationOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" variant="outlined" sx={{ minWidth: 180, height: '40px' }}>
          <InputLabel>Sipariş Durumu</InputLabel>
          <Select value={statusFilter} label="Sipariş Durumu" onChange={e => setStatusFilter(e.target.value)}>
            {orderStatusOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" variant="outlined" sx={{ minWidth: 180, height: '40px' }}>
          <InputLabel>Etiket Durumu</InputLabel>
          <Select value={labelStatusFilter} label="Etiket Durumu" onChange={e => setLabelStatusFilter(e.target.value)}>
            {labelStatusOptions.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" variant="outlined" sx={{ minWidth: 180, height: '40px' }}>
          <InputLabel>Yalnızca Etiketsiz</InputLabel>
          <Select value={unlabeledOnly ? 'yes' : ''} label="Yalnızca Etiketsiz" onChange={e => setUnlabeledOnly(e.target.value === 'yes')}>
            <MenuItem value="">Tümü</MenuItem>
            <MenuItem value="yes">Yalnızca Etiketsiz</MenuItem>
          </Select>
        </FormControl>
        <TextField
          label="Başlangıç Tarihi"
          type="date"
          value={filterStartDate}
          onChange={e => { setFilterStartDate(e.target.value); setPaginationModel(prev => ({ ...prev, page: 0 })); }}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 160, height: '40px' }}
        />
        <TextField
          label="Bitiş Tarihi"
          type="date"
          value={filterEndDate}
          onChange={e => { setFilterEndDate(e.target.value); setPaginationModel(prev => ({ ...prev, page: 0 })); }}
          size="small"
          InputLabelProps={{ shrink: true }}
          sx={{ minWidth: 160, height: '40px' }}
        />
        <Button onClick={() => {
          setSearchTerm(''); setMarketplaceFilter(''); setStatusFilter(''); setLabelStatusFilter(''); setUnlabeledOnly(false);
        }} variant="outlined" sx={{ ml: 2 }}>Filtreleri Sıfırla</Button>
        <Tooltip title="Sipariş Listesini Yenile">
          <span>
            <IconButton onClick={handleRefresh} disabled={isLoading || syncingOrders} color="primary" sx={{ height: '40px', width: '40px' }}>
              <RefreshIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Paper>
      {/* --- Desktop: DataGrid Table --- */}
      {!isMobile && (
        <DataGrid
          rows={[...filteredByDate].sort((a, b) => {
            if (!a.createdAt && !b.createdAt) return 0;
            if (!a.createdAt) return 1;
            if (!b.createdAt) return -1;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          })}
          columns={columns}
          autoHeight
          pageSizeOptions={[10, 20, 50, 100]}
          pagination
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          getRowId={(row) => row.id}
          initialState={{
            sorting: { sortModel: [{ field: 'marketplaceOrderDate', sort: 'desc' }] }
          }}
          sortingOrder={['desc','asc']}
          sx={{
            backgroundColor: 'white',
            borderRadius: 2,
            boxShadow: 1,
            '& .MuiDataGrid-columnHeaders': { position: 'sticky', top: 0, background: '#f7f7fa', zIndex: 1 },
            '& .MuiDataGrid-row:nth-of-type(even)': { background: '#fafbfc' },
            '& .MuiDataGrid-row:hover': { background: '#f5faff' },
            fontSize: 15,
          }}
        />
      )}
      {/* --- Mobile: Accordion Cards --- */}
      {isMobile && groupedOrders.map(({ order, items }) => (
        <Accordion key={order.orderId} sx={{ mb: 2, borderRadius: 2, boxShadow: 1 }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', justifyContent: 'space-between' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography fontWeight={600}>#{order.orderNumber}</Typography>
                <Typography>{order.customerName}</Typography>
                {getOrderStatusChip(order.status)}
                {getLabelStatusChip(order.labelCreated, order.status)}
              </Box>
              <Button size="small" variant="outlined" onClick={e => { e.stopPropagation(); openDrawer(order); }}>Detay</Button>
            </Box>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            {items.map(row => (
              <Paper key={row.id} sx={{ mb: 2, p: 2 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center">
                  <Typography fontWeight={600}>{row.commodityDesc}</Typography>
                  <Button variant="contained" size="small" color="primary"
                    disabled={generatingLabelId === row.id || !hasFedexCredentials || checkingFedexCredentials}
                    onClick={() => handleGenerateLabel({ ...row, ...itemEdits[row.id] })}>
                    {generatingLabelId === row.id ? <CircularProgress size={16} color="inherit" /> : 'Etiket Oluştur'}
                  </Button>
                </Box>
                <Box mt={1}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Select size="small" value={itemEdits[row.id]?.serviceType || row.serviceType}
                      onChange={e => handleEditField(row.id, 'serviceType', e.target.value)}>
                      {FEDEX_SERVICE_TYPES.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                    </Select>
                    <Select size="small" value={itemEdits[row.id]?.packagingType || row.packagingType}
                      onChange={e => handleEditField(row.id, 'packagingType', e.target.value)}>
                      {FEDEX_PACKAGING_TYPES.map(opt => <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>)}
                    </Select>
                    {['weight', 'customsValue', 'hsCode', 'countryOfOrigin', 'currency'].map(field => (
                      <Box key={field} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {editField[row.id] === field ? (
                          <Fade in={true}><Box sx={{ display: 'flex', alignItems: 'center' }}>
                            <TextField
                              size="small"
                              type={field === 'weight' || field === 'customsValue' ? 'number' : 'text'}
                              value={itemEdits[row.id]?.[field] || row[field] || ''}
                              onChange={e => handleEditField(row.id, field, e.target.value)}
                              onBlur={() => handleEditEnd(row.id)}
                              autoFocus
                              sx={{ width: 80 }}
                            />
                            <IconButton size="small" onClick={() => handleEditEnd(row.id)}><CheckIcon fontSize="small" /></IconButton>
                          </Box></Fade>
                        ) : (
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography>{itemEdits[row.id]?.[field] || row[field]}</Typography>
                            <IconButton size="small" onClick={() => handleEditStart(row.id, field)}><EditIcon fontSize="small" /></IconButton>
                          </Box>
                        )}
                      </Box>
                    ))}
                  </Box>
                  <Typography variant="body2" mt={1}>Takip No: {row.trackingNumber || '—'}</Typography>
                  <Typography variant="body2" mt={1}>
                    {row.shippingLabelUrl ? <Button component="a" href={row.shippingLabelUrl} target="_blank" rel="noopener noreferrer" size="small" variant="outlined">PDF</Button> : '—'}
                  </Typography>
                </Box>
              </Paper>
            ))}
          </AccordionDetails>
        </Accordion>
      ))}
      {/* --- Drawer for expanded order details --- */}
      <Drawer anchor="right" open={drawerOpen} onClose={closeDrawer} PaperProps={{ sx: { width: 400 } }}>
        <Box sx={{ p: 3 }}>
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6">Sipariş Detayları</Typography>
            <IconButton onClick={closeDrawer}><CloseIcon /></IconButton>
          </Box>
          {drawerOrder && (
            <Box mt={2}>
              {/* Error Summary */}
              {drawerErrors.length > 0 && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  <Typography variant="subtitle2" gutterBottom>Validation Issues:</Typography>
                  <List dense>
                    {drawerErrors.map((error, index) => (
                      <ListItem key={index}>
                        <ListItemIcon>
                          <ErrorIcon color="error" fontSize="small" />
                        </ListItemIcon>
                        <ListItemText 
                          primary={error}
                          primaryTypographyProps={{ 
                            variant: 'body2',
                            sx: { 
                              color: error.includes('Warning') ? 'warning.main' : 'error.main',
                              fontWeight: error.includes('Warning') ? 'normal' : 'medium'
                            }
                          }}
                        />
                      </ListItem>
                    ))}
                  </List>
                </Alert>
              )}

              {/* Order Details */}
              <Typography fontWeight={600}>Order: #{drawerOrder.orderNumber}</Typography>
              <Typography>Müşteri: {drawerOrder.customerName}</Typography>
              <Typography>Marketplace: {drawerOrder.marketplace}</Typography>
              <Typography>Durum: {drawerOrder.status}</Typography>
              <Typography>Toplam: {drawerOrder.customsValue} {drawerOrder.currency}</Typography>

              {/* Address Fields with Source Indicator and Edit Toggle */}
              <Box mt={3}>
                <Box display="flex" alignItems="center" justifyContent="space-between">
                  <Typography variant="subtitle1" fontWeight={600}>Shipping Address</Typography>
                  <Box display="flex" alignItems="center" gap={1}>
                    {addressSource === 'shippo' && (
                      <>
                        <Chip 
                          size="small" 
                          color="info" 
                          label="Address from Shippo notes" 
                          icon={<InfoIcon fontSize="small" />}
                        />
                        <Tooltip title={readOnlyAddress ? "Enable editing" : "Disable editing"}>
                          <IconButton 
                            size="small" 
                            onClick={() => setReadOnlyAddress(!readOnlyAddress)}
                            color={readOnlyAddress ? "default" : "primary"}
                          >
                            {readOnlyAddress ? <LockIcon fontSize="small" /> : <EditIcon fontSize="small" />}
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>
                </Box>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientFirstName}>
                  <TextField
                    id="recipientFirstName"
                    name="recipientFirstName"
                    label="First Name"
                    value={drawerOrder.recipientFirstName || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientFirstName: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientFirstName: false }));
                    }}
                    error={drawerFieldErrors.recipientFirstName}
                    helperText={drawerFieldErrors.recipientFirstName ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientLastName}>
                  <TextField
                    id="recipientLastName"
                    name="recipientLastName"
                    label="Last Name"
                    value={drawerOrder.recipientLastName || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientLastName: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientLastName: false }));
                    }}
                    error={drawerFieldErrors.recipientLastName}
                    helperText={drawerFieldErrors.recipientLastName ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientPhone}>
                  <TextField
                    id="recipientPhone"
                    name="recipientPhone"
                    label="Phone"
                    value={drawerOrder.recipientPhone || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientPhone: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientPhone: false }));
                    }}
                    error={drawerFieldErrors.recipientPhone}
                    helperText={drawerFieldErrors.recipientPhone ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientStreet1}>
                  <TextField
                    id="recipientStreet1"
                    name="recipientStreet1"
                    label="Street Address"
                    value={drawerOrder.recipientStreet1 || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientStreet1: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientStreet1: false }));
                    }}
                    error={drawerFieldErrors.recipientStreet1}
                    helperText={drawerFieldErrors.recipientStreet1 ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientCity}>
                  <TextField
                    id="recipientCity"
                    name="recipientCity"
                    label="City"
                    value={drawerOrder.recipientCity || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientCity: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientCity: false }));
                    }}
                    error={drawerFieldErrors.recipientCity}
                    helperText={drawerFieldErrors.recipientCity ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientState}>
                  <TextField
                    id="recipientState"
                    name="recipientState"
                    label="State"
                    value={drawerOrder.recipientState || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientState: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientState: false }));
                    }}
                    error={drawerFieldErrors.recipientState}
                    helperText={drawerFieldErrors.recipientState ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientPostal}>
                  <TextField
                    id="recipientPostal"
                    name="recipientPostal"
                    label="Postal Code"
                    value={drawerOrder.recipientPostal || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientPostal: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientPostal: false }));
                    }}
                    error={drawerFieldErrors.recipientPostal}
                    helperText={drawerFieldErrors.recipientPostal ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
                <FormControl fullWidth margin="dense" error={drawerFieldErrors.recipientCountry}>
                  <TextField
                    id="recipientCountry"
                    name="recipientCountry"
                    label="Country"
                    value={drawerOrder.recipientCountry || ''}
                    onChange={(e) => {
                      setDrawerOrder(prev => ({ ...prev, recipientCountry: e.target.value }));
                      setDrawerFieldErrors(prev => ({ ...prev, recipientCountry: false }));
                    }}
                    error={drawerFieldErrors.recipientCountry}
                    helperText={drawerFieldErrors.recipientCountry ? 'Required' : ''}
                    disabled={addressSource === 'shippo' && readOnlyAddress}
                    sx={addressSource === 'shippo' && readOnlyAddress ? { 
                      '& .MuiInputBase-input': { color: 'text.disabled' },
                      '& .MuiOutlinedInput-root': { backgroundColor: 'action.hover' }
                    } : {}}
                  />
                </FormControl>
              </Box>

              {/* Line Items */}
              <Box mt={3}>
                <Typography variant="subtitle1" fontWeight={600}>Line Items</Typography>
                {(drawerOrder.line_items || []).map((item: NormalizedLineItem, index) => (
                  <Paper key={index} sx={{ p: 2, mt: 1 }}>
                    <Typography variant="subtitle2">Item {index + 1}</Typography>
                    <TextField
                      fullWidth
                      margin="dense"
                      label="Title"
                      value={item.title || ''}
                      onChange={(e) => {
                        const updatedItems = [...(drawerOrder.line_items || [])] as NormalizedLineItem[];
                        updatedItems[index] = { ...item, title: e.target.value };
                        setDrawerOrder(prev => ({ ...prev, line_items: updatedItems }));
                        setDrawerFieldErrors(prev => ({ ...prev, [`line_items.${index}.title`]: !e.target.value }));
                      }}
                      error={!item.title}
                      helperText={!item.title ? 'Required' : ''}
                    />
                    <TextField
                      fullWidth
                      margin="dense"
                      label="Value"
                      type="number"
                      value={item.value || ''}
                      onChange={(e) => {
                        const updatedItems = [...(drawerOrder.line_items || [])] as NormalizedLineItem[];
                        updatedItems[index] = { ...item, value: parseFloat(e.target.value) };
                        setDrawerOrder(prev => ({ ...prev, line_items: updatedItems }));
                        setDrawerFieldErrors(prev => ({ ...prev, [`line_items.${index}.value`]: !e.target.value || parseFloat(e.target.value) <= 0 }));
                      }}
                      error={!item.value || item.value <= 0}
                      helperText={(!item.value || item.value <= 0) ? 'Required and must be greater than 0' : ''}
                    />
                    <TextField
                      fullWidth
                      margin="dense"
                      label="Quantity"
                      type="number"
                      value={item.quantity || ''}
                      onChange={(e) => {
                        const updatedItems = [...(drawerOrder.line_items || [])] as NormalizedLineItem[];
                        updatedItems[index] = { ...item, quantity: parseInt(e.target.value) };
                        setDrawerOrder(prev => ({ ...prev, line_items: updatedItems }));
                        setDrawerFieldErrors(prev => ({ ...prev, [`line_items.${index}.quantity`]: !e.target.value || parseInt(e.target.value) <= 0 }));
                      }}
                      error={!item.quantity || item.quantity <= 0}
                      helperText={(!item.quantity || item.quantity <= 0) ? 'Required and must be greater than 0' : ''}
                    />
                  </Paper>
                ))}
                {(!drawerOrder.line_items || drawerOrder.line_items.length === 0) && (
                  <Button
                    fullWidth
                    variant="outlined"
                    onClick={() => {
                      const newItem: NormalizedLineItem = {
                        id: `new-${Date.now()}`,
                        title: '',
                        value: 0,
                        quantity: 1,
                        sku: '',
                        weight: 0
                      };
                      setDrawerOrder(prev => ({
                        ...prev,
                        line_items: [...(prev.line_items || []), newItem]
                      }));
                    }}
                    sx={{ mt: 1 }}
                  >
                    Add Line Item
                  </Button>
                )}
              </Box>

              {/* Label Options */}
              <Box mt={3}>
                <Typography variant="subtitle1" fontWeight={600}>Label Options</Typography>
                <FormControl fullWidth margin="dense">
                  <InputLabel>Service Type</InputLabel>
                  <Select
                    value={drawerOrder.serviceType || 'INTERNATIONAL_PRIORITY'}
                    label="Service Type"
                    onChange={(e) => setDrawerOrder(prev => ({ ...prev, serviceType: e.target.value }))}
                  >
                    {FEDEX_SERVICE_TYPES.map(opt => (
                      <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControl fullWidth margin="dense">
                  <InputLabel>Packaging Type</InputLabel>
                  <Select
                    value={drawerOrder.packagingType || 'FEDEX_PAK'}
                    label="Packaging Type"
                    onChange={(e) => setDrawerOrder(prev => ({ ...prev, packagingType: e.target.value }))}
                  >
                    {FEDEX_PACKAGING_TYPES.map(opt => (
                      <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  fullWidth
                  margin="dense"
                  label="Weight (kg)"
                  type="number"
                  value={drawerOrder.weight || 0.5}
                  onChange={(e) => setDrawerOrder(prev => ({ ...prev, weight: parseFloat(e.target.value) }))}
                />
                <TextField
                  fullWidth
                  margin="dense"
                  label="HS Code"
                  value={drawerOrder.hsCode || '620449506'}
                  onChange={(e) => setDrawerOrder(prev => ({ ...prev, hsCode: e.target.value }))}
                />
                <TextField
                  fullWidth
                  margin="dense"
                  label="Country of Origin"
                  value={drawerOrder.countryOfOrigin || 'TR'}
                  onChange={(e) => setDrawerOrder(prev => ({ ...prev, countryOfOrigin: e.target.value }))}
                />
              </Box>

              {/* Action Buttons */}
              <Box mt={3} display="flex" gap={2}>
                <Button
                  fullWidth
                  variant="contained"
                  color="primary"
                  onClick={() => handleGenerateLabel(drawerOrder)}
                  disabled={drawerErrors.length > 0 || generatingLabelId === drawerOrder.id}
                >
                  {generatingLabelId === drawerOrder.id ? (
                    <CircularProgress size={24} color="inherit" />
                  ) : (
                    'Generate Label'
                  )}
                </Button>
                <Button
                  fullWidth
                  variant="outlined"
                  onClick={closeDrawer}
                >
                  Cancel
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      </Drawer>
      {/* --- Loading/Error/Empty States --- */}
      {isLoading && <Box textAlign="center" py={4}><CircularProgress /></Box>}
      {isError && <Alert severity="error">Siparişler yüklenemedi.</Alert>}
      {!isLoading && !isError && filteredItems.length === 0 && <Alert severity="info">Gösterilecek sipariş yok.</Alert>}

      {/* --- Raw Data Modal --- */}
      <Dialog open={rawOrderDataModalOpen} onClose={() => setRawOrderDataModalOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontWeight: 'bold' }}>
          Ham Sipariş Verisi
          <IconButton onClick={() => setRawOrderDataModalOpen(false)} sx={{ position: 'absolute', right: 8, top: 8 }}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {currentRawData ? (
            <pre style={{ maxHeight: '60vh', overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.8rem', margin: 0 }}>
              {JSON.stringify(currentRawData, null, 2)}
            </pre>
          ) : (
            <Typography>Veri bulunamadı.</Typography>
          )}
        </DialogContent>
        <Box sx={{ p:2, display:'flex', justifyContent:'flex-end' }}>
             <Button onClick={() => setRawOrderDataModalOpen(false)} variant="outlined">Kapat</Button>
        </Box>
      </Dialog>
    </Box>
  );
}

export default function LabelsPageWithLayout(props) {
  return (
    <AppLayout title="Etiket Yönetimi">
      <LabelsPage {...props} />
    </AppLayout>
  );
}
