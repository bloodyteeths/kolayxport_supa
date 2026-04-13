import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  TextField, Switch, Button, CircularProgress, Paper, Typography, Box,
  IconButton, Dialog, DialogTitle, DialogContent, DialogActions,
  Chip, Tooltip, InputAdornment, Checkbox, FormControlLabel,
  Select, MenuItem, Tabs, Tab, Alert, Divider,
} from '@mui/material';
import {
  Delete as DeleteIcon,
  Add as AddIcon,
  ContentCopy as DuplicateIcon,
  KeyboardArrowUp as UpIcon,
  KeyboardArrowDown as DownIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// --- Types ---

interface OfferingPrice {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface Offering {
  offering_id: number;
  price: OfferingPrice;
  quantity: number;
  is_enabled: boolean;
}

interface PropertyValue {
  property_id: number;
  property_name: string;
  values: string[];
  scale_id: number | null;
}

interface Product {
  product_id: number;
  sku: string;
  offerings: Offering[];
  property_values: PropertyValue[];
}

interface TaxonomyScale {
  scale_id: number;
  display_name: string;
  description: string;
}

interface TaxonomyProperty {
  property_id: number;
  name: string;
  display_name: string;
  scales: TaxonomyScale[];
  possible_values?: { value_id: number; name: string }[];
}

interface VariationImage {
  property_id: number;
  value_id: number;
  value: string;
  image_id: number;
}

interface ListingImage {
  listing_image_id: number;
  url_75x75: string;
  url_170x135: string;
  url_570xN: string;
  url_fullxfull: string;
}

interface VariationEditorProps {
  listingId: string;
  shopId: string;
  taxonomyId?: number;
  onSaved: () => void;
}

// --- Etsy known property types ---
const ETSY_PROPERTIES = [
  { id: 200, name: 'Color', tKey: 'color' },
  { id: 100, name: 'Size', tKey: 'size' },
  { id: 504, name: 'Length', tKey: 'length' },
  { id: 501, name: 'Width', tKey: 'width' },
  { id: 502, name: 'Height', tKey: 'height' },
  { id: 503, name: 'Weight', tKey: 'weight' },
  { id: 505, name: 'Diameter', tKey: 'diameter' },
  { id: 506, name: 'Dimensions', tKey: 'dimensions' },
  { id: 507, name: 'Fabric', tKey: 'fabric' },
  { id: 508, name: 'Style', tKey: 'style' },
  { id: 509, name: 'Material', tKey: 'material' },
  { id: 510, name: 'Pattern', tKey: 'pattern' },
];

// --- Currency helpers ---

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '\u20AC', GBP: '\u00A3', TRY: '\u20BA',
  CAD: 'CA$', AUD: 'A$', JPY: '\u00A5', SEK: 'kr', NOK: 'kr',
  DKK: 'kr', CHF: 'CHF', PLN: 'z\u0142', CZK: 'K\u010D',
  HUF: 'Ft', ILS: '\u20AA', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$',
  MXN: 'MX$', BRL: 'R$', INR: '\u20B9',
};

function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] || code;
}

// --- Processing time options ---
const PROCESSING_OPTIONS = [
  { value: '1-1', tKey: 'days1_2', label: '1-1 business days' },
  { value: '1-2', tKey: 'days1_2', label: '1-2 business days' },
  { value: '1-3', tKey: 'days1_3', label: '1-3 business days' },
  { value: '3-5', tKey: 'days3_5', label: '3-5 business days' },
  { value: '5-10', tKey: 'days1_2weeks', label: '1-2 weeks' },
  { value: '10-15', tKey: 'days2_3weeks', label: '2-3 weeks' },
  { value: '15-20', tKey: 'days3_4weeks', label: '3-4 weeks' },
  { value: '20-30', tKey: 'days4_6weeks', label: '4-6 weeks' },
  { value: '30-40', tKey: 'days6_8weeks', label: '6-8 weeks' },
];

// --- Variation row styles ---
const rowSx = {
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  py: 1.2,
  px: 1.5,
  flexWrap: 'wrap',
  borderBottom: '1px solid rgba(0,0,0,0.06)',
  '&:hover': { bgcolor: 'rgba(102,126,234,0.03)' },
  transition: 'background-color 0.15s',
};

const sectionHeaderSx = {
  px: 1.5,
  py: 0.8,
  bgcolor: 'rgba(0,0,0,0.03)',
  borderBottom: '1px solid rgba(0,0,0,0.08)',
};

// --- Inline editable text ---
function EditableText({ value, onChange, fontWeight = 600 }: { value: string; onChange: (v: string) => void; fontWeight?: number }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  if (editing) {
    return (
      <TextField
        inputRef={inputRef}
        size="small"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { setEditing(false); if (draft.trim() && draft !== value) onChange(draft.trim()); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { setEditing(false); if (draft.trim() && draft !== value) onChange(draft.trim()); }
          if (e.key === 'Escape') { setEditing(false); setDraft(value); }
        }}
        sx={{ minWidth: 80, '& .MuiInputBase-input': { py: 0.3, px: 0.5, fontSize: '0.875rem', fontWeight } }}
      />
    );
  }

  return (
    <Tooltip title="Click to edit" arrow placement="top">
      <Typography
        variant="body2"
        fontWeight={fontWeight}
        noWrap
        onClick={() => setEditing(true)}
        sx={{ cursor: 'pointer', '&:hover': { textDecoration: 'underline dotted', textDecorationColor: 'rgba(0,0,0,0.3)' } }}
      >
        {value}
      </Typography>
    </Tooltip>
  );
}

// --- Error Boundary ---

class VariationErrorBoundary extends React.Component<
  { children: React.ReactNode; listingId: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[VariationEditor] Crash:', error.message, '\nStack:', info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <Box sx={{ p: 2, border: '1px solid #f44336', borderRadius: 2, bgcolor: '#fff5f5' }}>
          <Typography variant="body2" color="error" fontWeight={700}>
            Variation editor error
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </Typography>
          <Button size="small" sx={{ mt: 1, textTransform: 'none' }}
            onClick={() => this.setState({ error: null })}>
            Retry
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

// --- Sanitize API data to prevent object-as-React-child crashes ---

function sanitizeProducts(raw: any[]): Product[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(p => ({
    product_id: Number(p.product_id) || 0,
    sku: String(p.sku ?? ''),
    offerings: Array.isArray(p.offerings) ? p.offerings.map((o: any) => ({
      offering_id: Number(o.offering_id) || 0,
      price: {
        amount: Number(o.price?.amount) || 0,
        divisor: Number(o.price?.divisor) || 100,
        currency_code: String(o.price?.currency_code ?? 'USD'),
      },
      quantity: Number(o.quantity) || 0,
      is_enabled: Boolean(o.is_enabled),
    })) : [],
    property_values: Array.isArray(p.property_values) ? p.property_values.map((pv: any) => ({
      property_id: Number(pv.property_id) || 0,
      property_name: String(pv.property_name ?? ''),
      values: Array.isArray(pv.values) ? pv.values.map((v: any) => String(v)) : [],
      scale_id: pv.scale_id != null ? Number(pv.scale_id) : null,
    })) : [],
  }));
}

// --- Component ---

export default function VariationEditor(props: VariationEditorProps) {
  return (
    <VariationErrorBoundary listingId={props.listingId}>
      <VariationEditorInner {...props} />
    </VariationErrorBoundary>
  );
}

function VariationEditorInner({ listingId, shopId, taxonomyId, onSaved }: VariationEditorProps) {
  const t = useTranslations('etsy.variation');
  const [products, setProducts] = useState<Product[]>([]);
  const [originalProducts, setOriginalProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Tabs: 0=Variations, 1=Price, 2=Quantity, 3=SKU, 4=Visibility, 5=Photos, 6=Processing
  const [activeTab, setActiveTab] = useState(0);

  // Price tab controls
  const [individualPrice, setIndividualPrice] = useState(false);
  const [priceAction, setPriceAction] = useState<'set' | 'increase' | 'decrease'>('set');
  const [priceValue, setPriceValue] = useState('');

  // Quantity tab controls
  const [individualQuantity, setIndividualQuantity] = useState(false);
  const [quantityAction, setQuantityAction] = useState<'set' | 'increase' | 'decrease'>('set');
  const [quantityValue, setQuantityValue] = useState('');

  // SKU tab controls
  const [individualSku, setIndividualSku] = useState(false);
  const [uniformSku, setUniformSku] = useState('');

  // Add dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addPropertyId, setAddPropertyId] = useState<number>(200);
  const [addValues, setAddValues] = useState('');
  const [addPrice, setAddPrice] = useState('');
  const [addQuantity, setAddQuantity] = useState('1');

  // Inline add
  const [inlineAddValue, setInlineAddValue] = useState('');

  // Delete confirmation
  const [deleteIndex, setDeleteIndex] = useState<number | null>(null);

  // Scale / taxonomy
  const [taxonomyProperties, setTaxonomyProperties] = useState<TaxonomyProperty[]>([]);
  const [selectedScaleId, setSelectedScaleId] = useState<number | null>(null);

  // Second variation
  const [secondPropertyId, setSecondPropertyId] = useState<number | null>(null);

  // Photos
  const [listingImages, setListingImages] = useState<ListingImage[]>([]);
  const [variationImages, setVariationImages] = useState<VariationImage[]>([]);
  const [savingPhotos, setSavingPhotos] = useState(false);

  // Detect currency
  const currencyCode = useMemo(() => {
    for (const p of products) {
      if (p.offerings?.[0]?.price?.currency_code) return p.offerings[0].price.currency_code;
    }
    return 'USD';
  }, [products]);
  const sym = getCurrencySymbol(currencyCode);

  const defaultDivisor = useMemo(() => {
    for (const p of products) {
      if (p.offerings?.[0]?.price?.divisor) return p.offerings[0].price.divisor;
    }
    return 100;
  }, [products]);

  const hasChanges = useMemo(
    () => JSON.stringify(products) !== JSON.stringify(originalProducts),
    [products, originalProducts],
  );

  // Existing properties
  const existingProperties = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of products) {
      for (const pv of p.property_values) {
        if (!map.has(pv.property_id)) map.set(pv.property_id, pv.property_name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [products]);

  // Detect which property is primary (first property used)
  const primaryPropertyId = useMemo(() => {
    if (products.length === 0) return null;
    return products[0]?.property_values?.[0]?.property_id || null;
  }, [products]);

  // Detect second property
  const detectedSecondPropertyId = useMemo(() => {
    for (const p of products) {
      if (p.property_values.length >= 2) return p.property_values[1].property_id;
    }
    return null;
  }, [products]);

  useEffect(() => {
    if (detectedSecondPropertyId) setSecondPropertyId(detectedSecondPropertyId);
  }, [detectedSecondPropertyId]);

  // Get available scales for a property
  const scalesForProperty = useMemo(() => {
    if (!primaryPropertyId || !taxonomyProperties.length) return [];
    const prop = taxonomyProperties.find(tp => tp.property_id === primaryPropertyId);
    return prop?.scales || [];
  }, [primaryPropertyId, taxonomyProperties]);

  // Detect scale from products
  useEffect(() => {
    for (const p of products) {
      const pv = p.property_values?.[0];
      if (pv?.scale_id) { setSelectedScaleId(pv.scale_id); return; }
    }
  }, [products.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Detect individual pricing/quantity/sku on load
  useEffect(() => {
    if (products.length < 2) return;
    const prices = products.map(p => p.offerings[0]?.price?.amount).filter(Boolean);
    const quantities = products.map(p => p.offerings[0]?.quantity).filter(q => q !== undefined);
    const skus = products.map(p => p.sku).filter(Boolean);
    setIndividualPrice(!prices.every(p => p === prices[0]));
    setIndividualQuantity(!quantities.every(q => q === quantities[0]));
    setIndividualSku(!skus.every(s => s === skus[0]) && skus.length > 0);
    if (skus.length > 0 && skus.every(s => s === skus[0])) setUniformSku(skus[0]);
  }, [products.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Grouped by first property ---
  const grouped = useMemo(() => {
    const groups: { propName: string; items: { product: Product; globalIdx: number }[] }[] = [];
    const map = new Map<string, { product: Product; globalIdx: number }[]>();

    products.forEach((p, idx) => {
      const firstProp = p.property_values[0];
      const key = firstProp?.property_name || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ product: p, globalIdx: idx });
    });

    map.forEach((items, propName) => groups.push({ propName, items }));
    return groups;
  }, [products]);

  // --- Fetch ---

  const fetchInventory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=get_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`
      );
      if (!res.ok) throw new Error(t('inventoryFetchFailed'));
      const data = await res.json();
      const fetched = sanitizeProducts(data.products || []);
      setProducts(fetched);
      setOriginalProducts(JSON.parse(JSON.stringify(fetched)));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [listingId, shopId, t]);

  useEffect(() => { fetchInventory(); }, [fetchInventory]);

  // Fetch taxonomy properties for scale support
  useEffect(() => {
    if (!taxonomyId) return;
    fetch(`/api/clawd/etsy?action=get_taxonomy_properties&taxonomy_id=${taxonomyId}&shop_id=${shopId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.results && Array.isArray(data.results)) {
          setTaxonomyProperties(data.results.map((tp: any) => ({
            property_id: Number(tp.property_id) || 0,
            name: String(tp.name ?? ''),
            display_name: String(tp.display_name ?? ''),
            scales: Array.isArray(tp.scales) ? tp.scales.map((s: any) => ({
              scale_id: Number(s.scale_id) || 0,
              display_name: String(s.display_name ?? ''),
              description: String(s.description ?? ''),
            })) : [],
            possible_values: Array.isArray(tp.possible_values) ? tp.possible_values : [],
          })));
        }
      })
      .catch(() => {});
  }, [taxonomyId, shopId]);

  // Fetch listing images for photos tab
  useEffect(() => {
    fetch(`/api/clawd/etsy?action=get_listing_images&listing_id=${listingId}&shop_id=${shopId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.images) setListingImages(data.images); })
      .catch(() => {});
  }, [listingId, shopId]);

  // Fetch variation images
  useEffect(() => {
    fetch(`/api/clawd/etsy?action=get_variation_images&listing_id=${listingId}&shop_id=${shopId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.results) setVariationImages(data.results); })
      .catch(() => {});
  }, [listingId, shopId]);

  // --- Helpers ---

  const getLabel = (p: Product) =>
    p.property_values?.map(pv => pv.values.join(', ')).join(' / ') || '-';

  const getPrice = (o: Offering) => (o.price.amount / o.price.divisor).toFixed(2);

  // --- Mutations ---

  const updateField = (idx: number, field: string, value: any) => {
    setProducts(prev => {
      const arr = [...prev];
      const p = { ...arr[idx] };
      if (field === 'sku') {
        p.sku = value;
      } else if (field === 'price' && p.offerings.length > 0) {
        const o = { ...p.offerings[0] };
        const n = parseFloat(value);
        if (!isNaN(n)) o.price = { ...o.price, amount: Math.round(n * o.price.divisor) };
        p.offerings = [o, ...p.offerings.slice(1)];
      } else if (field === 'quantity' && p.offerings.length > 0) {
        const o = { ...p.offerings[0] };
        const n = parseInt(value, 10);
        if (!isNaN(n) && n >= 0) o.quantity = n;
        p.offerings = [o, ...p.offerings.slice(1)];
      } else if (field === 'is_enabled' && p.offerings.length > 0) {
        p.offerings = [{ ...p.offerings[0], is_enabled: value }, ...p.offerings.slice(1)];
      }
      arr[idx] = p;
      return arr;
    });
  };

  const updatePropertyValue = (idx: number, pvIdx: number, newValue: string) => {
    setProducts(prev => {
      const arr = [...prev];
      const p = { ...arr[idx] };
      p.property_values = [...p.property_values];
      p.property_values[pvIdx] = { ...p.property_values[pvIdx], values: [newValue] };
      arr[idx] = p;
      return arr;
    });
  };

  const removeProduct = (idx: number) => {
    setProducts(prev => prev.filter((_, i) => i !== idx));
    setDeleteIndex(null);
    toast.success(t('variationDeleted'));
  };

  const duplicateProduct = (idx: number) => {
    setProducts(prev => {
      const clone: Product = JSON.parse(JSON.stringify(prev[idx]));
      clone.product_id = 0;
      clone.sku = '';
      if (clone.property_values[0]?.values[0]) {
        clone.property_values[0].values[0] += ` (${t('copy')})`;
      }
      const arr = [...prev];
      arr.splice(idx + 1, 0, clone);
      return arr;
    });
  };

  const moveProduct = (idx: number, dir: 'up' | 'down') => {
    setProducts(prev => {
      const arr = [...prev];
      const t = dir === 'up' ? idx - 1 : idx + 1;
      if (t < 0 || t >= arr.length) return prev;
      [arr[idx], arr[t]] = [arr[t], arr[idx]];
      return arr;
    });
  };

  // Bulk price/quantity apply
  const applyBulkPrice = () => {
    const v = parseFloat(priceValue);
    if (isNaN(v)) return;
    setProducts(prev => prev.map(p => {
      if (!p.offerings.length) return p;
      const o = { ...p.offerings[0] };
      const cur = o.price.amount / o.price.divisor;
      let newPrice = cur;
      if (priceAction === 'set') newPrice = v;
      else if (priceAction === 'increase') newPrice = cur + v;
      else if (priceAction === 'decrease') newPrice = Math.max(0, cur - v);
      o.price = { ...o.price, amount: Math.round(newPrice * o.price.divisor) };
      return { ...p, offerings: [o, ...p.offerings.slice(1)] };
    }));
    toast.success(t('pricesUpdated'));
  };

  const applyBulkQuantity = () => {
    const v = parseInt(quantityValue, 10);
    if (isNaN(v)) return;
    setProducts(prev => prev.map(p => {
      if (!p.offerings.length) return p;
      const o = { ...p.offerings[0] };
      let newQty = o.quantity;
      if (quantityAction === 'set') newQty = v;
      else if (quantityAction === 'increase') newQty = o.quantity + v;
      else if (quantityAction === 'decrease') newQty = Math.max(0, o.quantity - v);
      o.quantity = newQty;
      return { ...p, offerings: [o, ...p.offerings.slice(1)] };
    }));
    toast.success(t('stockUpdated'));
  };

  const applyUniformSku = () => {
    setProducts(prev => prev.map(p => ({ ...p, sku: uniformSku })));
  };

  // Inline add single variation
  const addInlineVariation = () => {
    const val = inlineAddValue.trim();
    if (!val) return;
    const propId = primaryPropertyId || existingProperties[0]?.id || 200;
    const propName = existingProperties.find(p => p.id === propId)?.name
      || ETSY_PROPERTIES.find(p => p.id === propId)?.name || 'Variation';

    const refProduct = products[products.length - 1];
    const refPrice = refProduct?.offerings[0]?.price;

    const newProduct: Product = {
      product_id: 0,
      sku: '',
      property_values: [{
        property_id: propId,
        property_name: propName,
        values: [val],
        scale_id: selectedScaleId,
      }],
      offerings: [{
        offering_id: 0,
        price: refPrice ? { ...refPrice } : { amount: 0, divisor: defaultDivisor, currency_code: currencyCode },
        quantity: refProduct?.offerings[0]?.quantity || 1,
        is_enabled: true,
      }],
    };

    setProducts(prev => [...prev, newProduct]);
    setInlineAddValue('');
  };

  // Batch add variations (from dialog)
  const addVariations = () => {
    const values = addValues.split(',').map(v => v.trim()).filter(v => v.length > 0);
    if (!values.length) { toast.error(t('enterAtLeastOneValue')); return; }
    const priceNum = parseFloat(addPrice);
    const qtyNum = parseInt(addQuantity, 10);
    if (isNaN(priceNum) || priceNum < 0) { toast.error(t('enterValidPrice')); return; }
    if (isNaN(qtyNum) || qtyNum < 0) { toast.error(t('enterValidStock')); return; }

    const propName = existingProperties.find(p => p.id === addPropertyId)?.name
      || ETSY_PROPERTIES.find(p => p.id === addPropertyId)?.name || 'Variation';

    const newProducts: Product[] = values.map(value => ({
      product_id: 0,
      sku: '',
      property_values: [{
        property_id: addPropertyId,
        property_name: propName,
        values: [value],
        scale_id: selectedScaleId,
      }],
      offerings: [{
        offering_id: 0,
        price: { amount: Math.round(priceNum * defaultDivisor), divisor: defaultDivisor, currency_code: currencyCode },
        quantity: qtyNum,
        is_enabled: true,
      }],
    }));

    setProducts(prev => [...prev, ...newProducts]);
    setAddDialogOpen(false);
    setAddValues('');
    setAddPrice('');
    setAddQuantity('1');
    toast.success(t('variationsAdded', { count: values.length }));
  };

  // --- Save inventory ---

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=update_listing_inventory&listing_id=${listingId}&shop_id=${shopId}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ products }) }
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t('inventoryUpdateFailed'));
      }
      toast.success(t('variationsSavedToEtsy'));
      setOriginalProducts(JSON.parse(JSON.stringify(products)));
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // --- Save variation photos ---

  const handleSavePhotos = async () => {
    setSavingPhotos(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=set_variation_images&listing_id=${listingId}&shop_id=${shopId}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variation_images: variationImages }) }
      );
      if (!res.ok) throw new Error(t('photosSaveFailed'));
      toast.success(t('photosSaved'));
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setSavingPhotos(false);
    }
  };

  // --- Render ---

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" py={4}>
        <CircularProgress size={28} />
        <Typography sx={{ ml: 1.5 }} variant="body2" color="text.secondary">
          {t('variationsLoading')}
        </Typography>
      </Box>
    );
  }

  const totalStock = products.reduce((sum, p) => sum + (p.offerings[0]?.quantity || 0), 0);

  // Unique first-property values (for photos tab)
  const uniqueFirstPropValues = useMemo(() => {
    const seen = new Map<string, { property_id: number; value: string }>();
    for (const p of products) {
      const pv = p.property_values[0];
      if (pv && !seen.has(pv.values[0])) {
        seen.set(pv.values[0], { property_id: pv.property_id, value: pv.values[0] });
      }
    }
    return Array.from(seen.values());
  }, [products]);

  // DEBUG: Find #310 object-as-child crash
  // eslint-disable-next-line no-console
  console.log('[VariationEditor DEBUG]', {
    totalStock, typeof_totalStock: typeof totalStock,
    productsLen: products.length,
    existingProperties: existingProperties.map(p => ({ id: p.id, name: p.name, typeof_name: typeof p.name })),
    grouped: grouped.map(g => ({ propName: g.propName, typeof_propName: typeof g.propName, itemCount: g.items.length })),
    scalesForProperty: scalesForProperty.map(s => ({ scale_id: s.scale_id, display_name: s.display_name, typeof_dn: typeof s.display_name })),
    sample_product: products[0] ? {
      sku: products[0].sku, typeof_sku: typeof products[0].sku,
      prop_values: products[0].property_values.map(pv => ({
        name: pv.property_name, typeof_name: typeof pv.property_name,
        values: pv.values, typeof_v0: typeof pv.values[0],
      })),
      price: products[0].offerings[0]?.price,
    } : null,
    t_test: { tabVariations: t('tabVariations'), typeof_tv: typeof t('tabVariations') },
  });

  return (
    <Box>
      {/* Tabs — 7 tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => setActiveTab(v)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{
          borderBottom: '2px solid #eee',
          mb: 0,
          minHeight: 36,
          '& .MuiTab-root': {
            minHeight: 36, py: 0.5, textTransform: 'none', fontWeight: 600,
            fontSize: '0.82rem', color: '#888',
          },
          '& .Mui-selected': { color: '#667eea' },
          '& .MuiTabs-indicator': { bgcolor: '#667eea', height: 2.5 },
        }}
      >
        <Tab label={t('tabVariations')} />
        <Tab label={t('tabPrice')} />
        <Tab label={t('tabStock')} />
        <Tab label="SKU" />
        <Tab label={t('tabVisibility')} />
        <Tab label={t('tabPhotos')} />
        <Tab label={t('tabProcessing')} />
      </Tabs>

      {/* Summary chips */}
      {products.length > 0 && (
        <Box sx={{ display: 'flex', gap: 1, py: 1, px: 0.5, flexWrap: 'wrap' }}>
          <Chip label={`${products.length} ${t('tabVariations').toLowerCase()}`} size="small" variant="outlined" />
          <Chip label={`${t('totalStock')}: ${totalStock}`} size="small" variant="outlined" />
          {existingProperties.map(p => (
            <Chip key={p.id} label={p.name} size="small"
              sx={{ bgcolor: 'rgba(102,126,234,0.1)', fontWeight: 600 }} />
          ))}
        </Box>
      )}

      {/* Unsaved warning */}
      {hasChanges && (
        <Alert severity="warning" sx={{ py: 0.3, my: 0.5, borderRadius: '8px', fontSize: '0.8rem' }}>
          {t('unsavedChanges')}
        </Alert>
      )}

      {/* ============================================================ */}
      {/* TAB 0: Variations — list with drag reorder, duplicate, delete */}
      {/* ============================================================ */}
      {activeTab === 0 && (
        <Box>
          {/* Top controls: property type, scale selector, second variation */}
          <Box sx={{ display: 'flex', gap: 1.5, py: 1, flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Scale selector (when Size property is used) */}
            {scalesForProperty.length > 0 && primaryPropertyId && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" fontWeight={600} color="text.secondary">{t('scale')}:</Typography>
                <Select
                  size="small"
                  value={selectedScaleId || ''}
                  onChange={(e) => {
                    const scaleId = e.target.value ? Number(e.target.value) : null;
                    setSelectedScaleId(scaleId);
                    // Update all products with this property
                    setProducts(prev => prev.map(p => ({
                      ...p,
                      property_values: p.property_values.map(pv =>
                        pv.property_id === primaryPropertyId ? { ...pv, scale_id: scaleId } : pv
                      ),
                    })));
                  }}
                  displayEmpty
                  sx={{ minWidth: 140, height: 32, fontSize: '0.82rem' }}
                >
                  <MenuItem value=""><em>{t('allScales')}</em></MenuItem>
                  {scalesForProperty.map(s => (
                    <MenuItem key={s.scale_id} value={s.scale_id}>{s.display_name}</MenuItem>
                  ))}
                </Select>
              </Box>
            )}

            {/* Second variation selector */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
              <Typography variant="caption" fontWeight={600} color="text.secondary">{t('secondVariation')}:</Typography>
              <Select
                size="small"
                value={secondPropertyId || ''}
                onChange={(e) => setSecondPropertyId(e.target.value ? Number(e.target.value) : null)}
                displayEmpty
                sx={{ minWidth: 160, height: 32, fontSize: '0.82rem' }}
              >
                <MenuItem value=""><em>{t('noSecondVariation')}</em></MenuItem>
                {ETSY_PROPERTIES.filter(p => p.id !== primaryPropertyId).map(prop => (
                  <MenuItem key={prop.id} value={prop.id}>{t(prop.tKey)}</MenuItem>
                ))}
              </Select>
            </Box>
          </Box>

          {/* Batch add button */}
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddIcon />}
              onClick={() => setAddDialogOpen(true)}
              sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', borderColor: '#667eea', color: '#667eea' }}
            >
              {t('batchAdd')}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {t('dragToReorder')}
            </Typography>
          </Box>

          {products.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#fafafa', borderRadius: '10px' }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                {t('noVariationsYet')}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('bulkAddHint')}
              </Typography>
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
              {grouped.map(group => (
                <Box key={group.propName}>
                  {group.propName && (
                    <Box sx={sectionHeaderSx}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {group.propName}
                      </Typography>
                    </Box>
                  )}
                  {group.items.map(({ product, globalIdx }) => {
                    const o = product.offerings?.[0];
                    if (!o) return null;
                    return (
                      <Box key={product.product_id || `new-${globalIdx}`} sx={{
                        ...rowSx,
                        opacity: o.is_enabled ? 1 : 0.45,
                      }}>
                        {/* Reorder arrows */}
                        <Box sx={{ display: 'flex', flexDirection: 'column', mr: 0.5 }}>
                          <IconButton size="small" disabled={globalIdx === 0} onClick={() => moveProduct(globalIdx, 'up')} sx={{ p: 0.15 }}>
                            <UpIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                          <IconButton size="small" disabled={globalIdx === products.length - 1} onClick={() => moveProduct(globalIdx, 'down')} sx={{ p: 0.15 }}>
                            <DownIcon sx={{ fontSize: 16 }} />
                          </IconButton>
                        </Box>

                        {/* Label — editable */}
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexWrap: 'wrap' }}>
                            {product.property_values?.map((pv, pvIdx) => (
                              <EditableText
                                key={pvIdx}
                                value={pv.values?.[0] || ''}
                                onChange={(v) => updatePropertyValue(globalIdx, pvIdx, v)}
                              />
                            ))}
                          </Box>
                          {product.sku && (
                            <Typography variant="caption" color="text.secondary">SKU: {product.sku}</Typography>
                          )}
                        </Box>

                        {/* Quick info */}
                        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 55, textAlign: 'right' }}>
                          {sym}{getPrice(o)}
                        </Typography>
                        <Chip
                          label={o.quantity === 0 ? t('outOfStock') : `${o.quantity} ${t('pieces')}`}
                          size="small"
                          color={o.quantity === 0 ? 'error' : 'default'}
                          variant="outlined"
                          sx={{ fontSize: '0.7rem', height: 22, minWidth: { xs: 'auto', sm: 60 } }}
                        />

                        {/* Enabled indicator */}
                        {!o.is_enabled && (
                          <Chip label="OFF" size="small" color="default" sx={{ fontSize: '0.65rem', height: 18, opacity: 0.6 }} />
                        )}

                        {/* Actions */}
                        <Box sx={{ display: 'flex', gap: 0 }}>
                          <Tooltip title={t('copy')}>
                            <IconButton size="small" onClick={() => duplicateProduct(globalIdx)}><DuplicateIcon sx={{ fontSize: 16 }} /></IconButton>
                          </Tooltip>
                          <Tooltip title={t('deleteTooltip')}>
                            <IconButton size="small" color="error" onClick={() => setDeleteIndex(globalIdx)}><DeleteIcon sx={{ fontSize: 16 }} /></IconButton>
                          </Tooltip>
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              ))}

              {/* Inline add option */}
              <Box sx={{ display: 'flex', gap: 1, px: 1.5, py: 1.2, alignItems: 'center', borderTop: '1px solid rgba(0,0,0,0.08)', bgcolor: 'rgba(0,0,0,0.01)' }}>
                <TextField
                  size="small"
                  value={inlineAddValue}
                  onChange={(e) => setInlineAddValue(e.target.value)}
                  placeholder={t('addOption')}
                  onKeyDown={(e) => { if (e.key === 'Enter') addInlineVariation(); }}
                  sx={{ flex: 1, '& .MuiInputBase-input': { py: 0.6 } }}
                />
                <Button
                  size="small"
                  variant="contained"
                  onClick={addInlineVariation}
                  disabled={!inlineAddValue.trim()}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea', minWidth: 60 }}
                >
                  {t('add')}
                </Button>
              </Box>
            </Paper>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 1: Price                                                  */}
      {/* ============================================================ */}
      {activeTab === 1 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
            <FormControlLabel
              control={<Checkbox checked={individualPrice} onChange={(e) => setIndividualPrice(e.target.checked)} sx={{ color: '#667eea', '&.Mui-checked': { color: '#667eea' }, '& .MuiSvgIcon-root': { fontSize: 24 } }} />}
              label={<Typography variant="body2" fontWeight={600}>{t('individualPrice')}</Typography>}
            />
            {!individualPrice && (
              <>
                <Select size="small" value={priceAction} onChange={(e) => setPriceAction(e.target.value as any)}
                  sx={{ minWidth: { xs: '100%', sm: 130 }, height: 36 }}>
                  <MenuItem value="set">{t('set')}</MenuItem>
                  <MenuItem value="increase">{t('increase')}</MenuItem>
                  <MenuItem value="decrease">{t('decrease')}</MenuItem>
                </Select>
                <TextField
                  size="small" type="number" value={priceValue}
                  onChange={(e) => setPriceValue(e.target.value)}
                  InputProps={{ startAdornment: <InputAdornment position="start">{sym}</InputAdornment> }}
                  inputProps={{ min: 0, step: '0.01' }}
                  sx={{ width: { xs: '100%', sm: 120 } }}
                  placeholder="0.00"
                />
                <Button size="small" variant="contained" onClick={applyBulkPrice} disabled={!priceValue}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea', height: 36, width: { xs: '100%', sm: 'auto' } }}>
                  {t('apply')}
                </Button>
              </>
            )}
          </Box>

          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
            {grouped.map(group => (
              <Box key={group.propName}>
                {group.propName && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.propName}
                    </Typography>
                  </Box>
                )}
                {group.items.map(({ product, globalIdx }) => {
                  const o = product.offerings[0];
                  if (!o) return null;
                  return (
                    <Box key={globalIdx} sx={rowSx}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                      {individualPrice ? (
                        <TextField
                          size="small" type="number"
                          value={getPrice(o)}
                          onChange={(e) => updateField(globalIdx, 'price', e.target.value)}
                          InputProps={{ startAdornment: <InputAdornment position="start">{sym}</InputAdornment> }}
                          inputProps={{ min: 0, step: '0.01' }}
                          sx={{ width: { xs: '100%', sm: 120 } }}
                        />
                      ) : (
                        <Typography variant="body2" fontWeight={600} sx={{ minWidth: 70, textAlign: 'right' }}>
                          {sym}{getPrice(o)}
                        </Typography>
                      )}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 2: Quantity                                               */}
      {/* ============================================================ */}
      {activeTab === 2 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap', flexDirection: { xs: 'column', sm: 'row' } }}>
            <FormControlLabel
              control={<Checkbox checked={individualQuantity} onChange={(e) => setIndividualQuantity(e.target.checked)} sx={{ color: '#667eea', '&.Mui-checked': { color: '#667eea' }, '& .MuiSvgIcon-root': { fontSize: 24 } }} />}
              label={<Typography variant="body2" fontWeight={600}>{t('individualStock')}</Typography>}
            />
            {!individualQuantity && (
              <>
                <Select size="small" value={quantityAction} onChange={(e) => setQuantityAction(e.target.value as any)}
                  sx={{ minWidth: { xs: '100%', sm: 130 }, height: 36 }}>
                  <MenuItem value="set">{t('set')}</MenuItem>
                  <MenuItem value="increase">{t('increase')}</MenuItem>
                  <MenuItem value="decrease">{t('decrease')}</MenuItem>
                </Select>
                <TextField
                  size="small" type="number" value={quantityValue}
                  onChange={(e) => setQuantityValue(e.target.value)}
                  inputProps={{ min: 0 }}
                  sx={{ width: { xs: '100%', sm: 100 } }}
                  placeholder="0"
                />
                <Button size="small" variant="contained" onClick={applyBulkQuantity} disabled={!quantityValue}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea', height: 36, width: { xs: '100%', sm: 'auto' } }}>
                  {t('apply')}
                </Button>
              </>
            )}
          </Box>

          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
            {grouped.map(group => (
              <Box key={group.propName}>
                {group.propName && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.propName}
                    </Typography>
                  </Box>
                )}
                {group.items.map(({ product, globalIdx }) => {
                  const o = product.offerings[0];
                  if (!o) return null;
                  return (
                    <Box key={globalIdx} sx={rowSx}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                      {individualQuantity ? (
                        <TextField
                          size="small" type="number"
                          value={o.quantity}
                          onChange={(e) => updateField(globalIdx, 'quantity', e.target.value)}
                          inputProps={{ min: 0 }}
                          sx={{ width: { xs: '100%', sm: 90 } }}
                        />
                      ) : (
                        <Chip
                          label={o.quantity === 0 ? t('outOfStock') : o.quantity}
                          size="small"
                          color={o.quantity === 0 ? 'error' : 'default'}
                          variant="outlined"
                          sx={{ minWidth: 60 }}
                        />
                      )}
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 3: SKU (with individual/uniform toggle)                   */}
      {/* ============================================================ */}
      {activeTab === 3 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={<Checkbox checked={individualSku} onChange={(e) => setIndividualSku(e.target.checked)} sx={{ color: '#667eea', '&.Mui-checked': { color: '#667eea' }, '& .MuiSvgIcon-root': { fontSize: 24 } }} />}
              label={<Typography variant="body2" fontWeight={600}>{t('individualSku')}</Typography>}
            />
            {!individualSku && (
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flex: 1 }}>
                <TextField
                  size="small"
                  value={uniformSku}
                  onChange={(e) => setUniformSku(e.target.value)}
                  placeholder={t('enterSku')}
                  sx={{ width: { xs: '100%', sm: 180 } }}
                />
                <Button size="small" variant="contained" onClick={applyUniformSku} disabled={!uniformSku}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea', height: 36 }}>
                  {t('apply')}
                </Button>
              </Box>
            )}
          </Box>

          {individualSku && (
            <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
              {grouped.map(group => (
                <Box key={group.propName}>
                  {group.propName && (
                    <Box sx={sectionHeaderSx}>
                      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {group.propName}
                      </Typography>
                    </Box>
                  )}
                  {group.items.map(({ product, globalIdx }) => (
                    <Box key={globalIdx} sx={rowSx}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                      <TextField
                        size="small"
                        value={product.sku}
                        onChange={(e) => updateField(globalIdx, 'sku', e.target.value)}
                        placeholder={t('enterSku')}
                        sx={{ width: { xs: '100%', sm: 150 } }}
                      />
                    </Box>
                  ))}
                </Box>
              ))}
            </Paper>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 4: Visibility (active/inactive toggle)                    */}
      {/* ============================================================ */}
      {activeTab === 4 && products.length > 0 && (
        <Box sx={{ pt: 1 }}>
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
            <Button size="small" variant="outlined" onClick={() => {
              setProducts(prev => prev.map(p => {
                if (!p.offerings.length) return p;
                return { ...p, offerings: [{ ...p.offerings[0], is_enabled: true }, ...p.offerings.slice(1)] };
              }));
            }} sx={{ textTransform: 'none', borderRadius: '6px' }}>
              {t('enableAll')}
            </Button>
            <Button size="small" variant="outlined" onClick={() => {
              setProducts(prev => prev.map(p => {
                if (!p.offerings.length) return p;
                return { ...p, offerings: [{ ...p.offerings[0], is_enabled: false }, ...p.offerings.slice(1)] };
              }));
            }} sx={{ textTransform: 'none', borderRadius: '6px' }}>
              {t('disableAll')}
            </Button>
          </Box>
          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
            {grouped.map(group => (
              <Box key={group.propName}>
                {group.propName && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {group.propName}
                    </Typography>
                  </Box>
                )}
                {group.items.map(({ product, globalIdx }) => {
                  const o = product.offerings[0];
                  if (!o) return null;
                  return (
                    <Box key={globalIdx} sx={{ ...rowSx, opacity: o.is_enabled ? 1 : 0.45 }}>
                      <Typography variant="body2" fontWeight={500} sx={{ flex: 1 }}>{getLabel(product)}</Typography>
                      <Switch
                        checked={o.is_enabled}
                        onChange={(e) => updateField(globalIdx, 'is_enabled', e.target.checked)}
                        sx={{ '& .Mui-checked': { color: '#667eea' }, '& .Mui-checked + .MuiSwitch-track': { bgcolor: '#667eea' } }}
                      />
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Paper>
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 5: Photos — assign images to variation values             */}
      {/* ============================================================ */}
      {activeTab === 5 && (
        <Box sx={{ pt: 1 }}>
          {listingImages.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#fafafa', borderRadius: '10px' }}>
              <Typography variant="body2" color="text.secondary">{t('noPhotosAvailable')}</Typography>
            </Paper>
          ) : uniqueFirstPropValues.length === 0 ? (
            <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#fafafa', borderRadius: '10px' }}>
              <Typography variant="body2" color="text.secondary">{t('addVariationsFirst')}</Typography>
            </Paper>
          ) : (
            <>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                {t('photosDescription')}
              </Typography>
              <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden' }}>
                {existingProperties[0] && (
                  <Box sx={sectionHeaderSx}>
                    <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                      {existingProperties[0].name}
                    </Typography>
                  </Box>
                )}
                {uniqueFirstPropValues.map(({ property_id, value }) => {
                  const assignedImage = variationImages.find(vi => vi.value === value);
                  const assignedImg = assignedImage ? listingImages.find(li => li.listing_image_id === assignedImage.image_id) : null;

                  return (
                    <Box key={value} sx={{ ...rowSx, py: 1.5, gap: 2 }}>
                      <Typography variant="body2" fontWeight={600} sx={{ minWidth: 120 }}>{value}</Typography>
                      <Box sx={{ display: 'flex', gap: 0.8, flexWrap: 'wrap', flex: 1 }}>
                        {listingImages.map(img => {
                          const isSelected = assignedImg?.listing_image_id === img.listing_image_id;
                          return (
                            <Box
                              key={img.listing_image_id}
                              onClick={() => {
                                setVariationImages(prev => {
                                  const filtered = prev.filter(vi => vi.value !== value);
                                  if (isSelected) return filtered; // deselect
                                  return [...filtered, {
                                    property_id,
                                    value_id: 0, // Etsy assigns this
                                    value,
                                    image_id: img.listing_image_id,
                                  }];
                                });
                              }}
                              sx={{
                                width: 52, height: 52,
                                borderRadius: '6px',
                                overflow: 'hidden',
                                cursor: 'pointer',
                                border: isSelected ? '2.5px solid #667eea' : '2px solid transparent',
                                boxShadow: isSelected ? '0 0 0 1px #667eea' : 'none',
                                opacity: isSelected ? 1 : 0.6,
                                transition: 'all 0.15s',
                                '&:hover': { opacity: 1, borderColor: '#667eea' },
                              }}
                            >
                              <img
                                src={img.url_75x75}
                                alt={value}
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                              />
                            </Box>
                          );
                        })}
                      </Box>
                    </Box>
                  );
                })}
              </Paper>

              {/* Save photos button */}
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1.5 }}>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleSavePhotos}
                  disabled={savingPhotos}
                  startIcon={savingPhotos ? <CircularProgress size={14} /> : undefined}
                  sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea' }}
                >
                  {savingPhotos ? t('saving') : t('saveToEtsy')}
                </Button>
              </Box>
            </>
          )}
        </Box>
      )}

      {/* ============================================================ */}
      {/* TAB 6: Processing Time                                        */}
      {/* ============================================================ */}
      {activeTab === 6 && (
        <Box sx={{ pt: 1 }}>
          <Alert severity="info" sx={{ py: 0.3, mb: 1.5, borderRadius: '8px', fontSize: '0.8rem' }}>
            {t('processingTime')} — {t('appliedToAll')}
          </Alert>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t('processingTime')}
          </Typography>
          <Paper variant="outlined" sx={{ borderRadius: '8px', overflow: 'hidden', p: 2 }}>
            <Select
              size="small"
              fullWidth
              defaultValue=""
              sx={{ mb: 1 }}
            >
              {PROCESSING_OPTIONS.map(opt => (
                <MenuItem key={opt.value} value={opt.value}>{t(opt.tKey)}</MenuItem>
              ))}
            </Select>
            <Typography variant="caption" color="text.secondary">
              {t('processingTime')} — Etsy listing level
            </Typography>
          </Paper>
        </Box>
      )}

      {/* Empty state for non-variation tabs */}
      {activeTab > 0 && activeTab <= 4 && products.length === 0 && (
        <Box sx={{ p: 3, textAlign: 'center' }}>
          <Typography variant="body2" color="text.secondary">{t('addVariationsFirst')}</Typography>
        </Box>
      )}

      {/* Save / Cancel */}
      <Box display="flex" justifyContent="flex-end" mt={2} gap={1} alignItems="center"
        sx={{ position: 'sticky', bottom: 0, bgcolor: 'white', py: 1.5, zIndex: 5, borderTop: '1px solid #eee' }}>
        {hasChanges && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ mr: 'auto' }}>
              {t('changesNotSentToEtsy')}
            </Typography>
            <Button variant="text" onClick={() => setProducts(JSON.parse(JSON.stringify(originalProducts)))}
              disabled={saving} sx={{ textTransform: 'none' }}>
              {t('cancel')}
            </Button>
          </>
        )}
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
          sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea' }}
        >
          {saving ? t('saving') : t('saveToEtsy')}
        </Button>
      </Box>

      {/* --- Batch Add Variations Dialog --- */}
      <Dialog open={addDialogOpen} onClose={() => setAddDialogOpen(false)} maxWidth="sm" fullWidth sx={{ zIndex: 1600 }}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('batchAdd')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, pt: '16px !important' }}>
          <Alert severity="info" sx={{ py: 0.5, borderRadius: '8px' }}>
            {t('bulkAddHint')}
          </Alert>

          {/* Property type chips */}
          <Box>
            <Typography variant="caption" fontWeight={700} sx={{ mb: 1, display: 'block', color: 'text.secondary', textTransform: 'uppercase' }}>
              {t('propertyType')}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
              {existingProperties.map(prop => (
                <Chip key={prop.id}
                  label={`${(() => { const ep = ETSY_PROPERTIES.find(p => p.id === prop.id); return ep ? t(ep.tKey) : prop.name; })()} (${t('existing')})`}
                  onClick={() => setAddPropertyId(prop.id)}
                  color={addPropertyId === prop.id ? 'primary' : 'default'}
                  variant={addPropertyId === prop.id ? 'filled' : 'outlined'}
                  size="small" sx={{ fontWeight: addPropertyId === prop.id ? 700 : 400 }}
                />
              ))}
              {ETSY_PROPERTIES.filter(p => !existingProperties.some(ep => ep.id === p.id)).slice(0, 8).map(prop => (
                <Chip key={prop.id} label={t(prop.tKey)}
                  onClick={() => setAddPropertyId(prop.id)}
                  color={addPropertyId === prop.id ? 'primary' : 'default'}
                  variant={addPropertyId === prop.id ? 'filled' : 'outlined'}
                  size="small" sx={{ fontWeight: addPropertyId === prop.id ? 700 : 400 }}
                />
              ))}
            </Box>
          </Box>

          {/* Scale selector in dialog */}
          {scalesForProperty.length > 0 && addPropertyId === primaryPropertyId && (
            <Box>
              <Typography variant="caption" fontWeight={700} sx={{ mb: 0.5, display: 'block', color: 'text.secondary', textTransform: 'uppercase' }}>
                {t('scale')}
              </Typography>
              <Select
                size="small"
                value={selectedScaleId || ''}
                onChange={(e) => setSelectedScaleId(e.target.value ? Number(e.target.value) : null)}
                displayEmpty
                fullWidth
              >
                <MenuItem value=""><em>{t('allScales')}</em></MenuItem>
                {scalesForProperty.map(s => (
                  <MenuItem key={s.scale_id} value={s.scale_id}>{s.display_name}</MenuItem>
                ))}
              </Select>
            </Box>
          )}

          <TextField label={t('valuesLabel')} size="small" fullWidth multiline minRows={2}
            value={addValues} onChange={(e) => setAddValues(e.target.value)}
            placeholder={t('valuesPlaceholder')} autoFocus
            helperText={addValues ? t('variationsWillBeAdded', { count: addValues.split(',').filter(v => v.trim()).length }) : t('eachValueCreatesVariation')}
          />

          <Box display="flex" gap={2}>
            <TextField label={`${t('tabPrice')} (${sym})`} size="small" type="number"
              value={addPrice} onChange={(e) => setAddPrice(e.target.value)}
              inputProps={{ min: 0, step: '0.01' }} sx={{ flex: 1 }}
              helperText={t('appliedToAll')}
            />
            <TextField label={t('tabStock')} size="small" type="number"
              value={addQuantity} onChange={(e) => setAddQuantity(e.target.value)}
              inputProps={{ min: 0 }} sx={{ flex: 1 }}
            />
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setAddDialogOpen(false)} sx={{ textTransform: 'none' }}>{t('cancel')}</Button>
          <Button variant="contained" onClick={addVariations} disabled={!addValues.trim() || !addPrice}
            sx={{ textTransform: 'none', fontWeight: 600, borderRadius: '8px', bgcolor: '#667eea' }}>
            {t('variationsAdded', { count: addValues.split(',').filter(v => v.trim()).length || 0 })}
          </Button>
        </DialogActions>
      </Dialog>

      {/* --- Delete Confirmation --- */}
      <Dialog open={deleteIndex !== null} onClose={() => setDeleteIndex(null)} maxWidth="xs" sx={{ zIndex: 1600 }}>
        <DialogTitle sx={{ fontWeight: 700 }}>{t('deleteVariation')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            {deleteIndex !== null && products[deleteIndex]
              ? t('deleteConfirmNamed', { name: getLabel(products[deleteIndex]) })
              : t('deleteConfirm')}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            {t('deleteNote')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteIndex(null)} sx={{ textTransform: 'none' }}>{t('cancel')}</Button>
          <Button variant="contained" color="error" onClick={() => deleteIndex !== null && removeProduct(deleteIndex)}
            sx={{ textTransform: 'none' }}>
            {t('deleteVariation')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
