import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Box, Typography, Paper, Button, IconButton, TextField, Select, MenuItem,
  Chip, FormControl, InputLabel, Divider, useMediaQuery, useTheme, InputAdornment,
  CircularProgress, LinearProgress, SwipeableDrawer, List, ListItem, ListItemButton,
  ListItemText, Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup,
  Collapse, Checkbox, Tooltip, Badge, Switch, FormControlLabel, Alert,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Image as ImageIcon,
  Videocam as VideoIcon,
  Title as TitleIcon,
  Description as DescriptionIcon,
  LocalOffer as TagIcon,
  Category as CategoryIcon,
  Folder as FolderIcon,
  AttachMoney as PriceIcon,
  Inventory as InventoryIcon,
  AutoFixHigh as AIIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Menu as MenuIcon,
  CheckBox as CheckBoxIcon,
  CheckBoxOutlineBlank as CheckBoxBlankIcon,
  IndeterminateCheckBox as IndeterminateIcon,
  Schedule as ScheduleIcon,
  Save as SaveIcon,
  ArrowBack as BackIcon,
  Palette as PaletteIcon,
  Straighten as SizeIcon,
  Scale as WeightIcon,
  Tune as TuneIcon,
  LocalShipping as ShippingIcon,
  AssignmentReturn as ReturnIcon,
  Build as MaterialIcon,
  Person as PersonIcon,
  CalendarMonth as CalendarIcon,
  Storefront as StorefrontIcon,
  Settings as SettingsIcon,
  TextFields as TextFieldsIcon,
  Sync as SyncIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
  FindReplace as FindReplaceIcon,
  SwapHoriz as SwapIcon,
  Clear as ClearIcon,
  Download as ExportIcon,
  KeyboardArrowDown as ArrowDownIcon,
  Celebration as CelebrationIcon,
  Speed as SpeedIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import { useTranslations } from 'next-intl';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListingPrice {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface SelectedListing {
  listing_id: number;
  title: string;
  description?: string;
  price: ListingPrice | null;
  tags: string[];
  materials?: string[];
  state: string;
  shop_section_id: number | null;
  thumbnail?: { url_75x75?: string; url_170x135?: string } | null;
  quantity?: number;
  who_made?: string;
  when_made?: string;
  is_supply?: boolean;
  item_weight?: number;
  item_weight_unit?: string;
  item_length?: number;
  item_width?: number;
  item_height?: number;
  item_dimensions_unit?: string;
  shipping_profile_id?: number;
  return_policy_id?: number;
  processing_min?: number;
  processing_max?: number;
}

interface ShopSection {
  shop_section_id: number;
  title: string;
}

interface ShippingProfile {
  shipping_profile_id: number;
  title: string;
}

interface ReturnPolicy {
  return_policy_id: number;
  description?: string;
  accepts_returns?: boolean;
  accepts_exchanges?: boolean;
}

interface BulkEditorProps {
  open: boolean;
  onClose: () => void;
  listings: SelectedListing[];
  shopId: string;
  shopName?: string;
  shopSections: ShopSection[];
  shippingProfiles?: ShippingProfile[];
  returnPolicies?: ReturnPolicy[];
  onCompleted: () => void;
}

type FieldCategory =
  | 'photos' | 'videos'
  | 'title' | 'description' | 'tags' | 'materials' | 'about' | 'category' | 'section' | 'personalization'
  | 'price' | 'quantity' | 'sku'
  | 'processing_time' | 'shipping_profile' | 'item_weight' | 'item_size' | 'return_policy'
  | 'state';

type OperationType =
  | 'ai_rewrite' | 'ai_optimize' | 'add_before' | 'add_after' | 'find_replace' | 'delete' | 'change_to'
  | 'add' | 'remove' | 'remove_all'
  | 'increase_pct' | 'decrease_pct' | 'increase_fixed' | 'decrease_fixed' | 'set_price'
  | 'set_value' | 'set_section' | 'set_quantity'
  | 'activate' | 'deactivate';

interface PendingChange {
  title?: string;
  description?: string;
  tags?: string[];
  materials?: string[];
  price?: number;
  quantity?: number;
  shop_section_id?: number;
  state?: string;
  who_made?: string;
  when_made?: string;
  is_supply?: boolean;
  item_weight?: number;
  item_weight_unit?: string;
  item_length?: number;
  item_width?: number;
  item_height?: number;
  item_dimensions_unit?: string;
  shipping_profile_id?: number;
  return_policy_id?: number;
  processing_min?: number;
  processing_max?: number;
}

// ---------------------------------------------------------------------------
// Field definitions — comprehensive Vela-style categories
// ---------------------------------------------------------------------------

interface FieldDef {
  key: FieldCategory;
  label: string;
  group: string;
  icon: React.ReactNode;
  operations: { value: OperationType; label: string }[];
}

const FIELD_DEFS: FieldDef[] = [
  // Media
  {
    key: 'photos', label: 'Photos', group: 'Media',
    icon: <ImageIcon fontSize="small" />,
    operations: [{ value: 'ai_optimize', label: 'AI Alt Text' }],
  },
  {
    key: 'videos', label: 'Videos', group: 'Media',
    icon: <VideoIcon fontSize="small" />,
    operations: [{ value: 'ai_optimize', label: 'AI Alt Text' }],
  },
  // Listings
  {
    key: 'title', label: 'Title', group: 'Listings',
    icon: <TitleIcon fontSize="small" />,
    operations: [
      { value: 'ai_rewrite', label: 'AI Rewrite' },
      { value: 'add_before', label: 'Add Before' },
      { value: 'add_after', label: 'Add After' },
      { value: 'find_replace', label: 'Find & Replace' },
      { value: 'delete', label: 'Delete' },
      { value: 'change_to', label: 'Change To' },
    ],
  },
  {
    key: 'description', label: 'Description', group: 'Listings',
    icon: <DescriptionIcon fontSize="small" />,
    operations: [
      { value: 'ai_rewrite', label: 'AI Rewrite' },
      { value: 'add_before', label: 'Add Before' },
      { value: 'add_after', label: 'Add After' },
      { value: 'find_replace', label: 'Find & Replace' },
      { value: 'delete', label: 'Delete' },
      { value: 'change_to', label: 'Change To' },
    ],
  },
  {
    key: 'tags', label: 'Tags', group: 'Listings',
    icon: <TagIcon fontSize="small" />,
    operations: [
      { value: 'ai_rewrite', label: 'AI Optimize' },
      { value: 'add', label: 'Add' },
      { value: 'remove', label: 'Remove' },
      { value: 'remove_all', label: 'Remove All' },
      { value: 'change_to', label: 'Change To' },
    ],
  },
  {
    key: 'materials', label: 'Materials', group: 'Listings',
    icon: <MaterialIcon fontSize="small" />,
    operations: [
      { value: 'add', label: 'Add' },
      { value: 'remove', label: 'Remove' },
      { value: 'remove_all', label: 'Remove All' },
      { value: 'change_to', label: 'Change To' },
    ],
  },
  {
    key: 'about', label: 'About', group: 'Listings',
    icon: <PersonIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Set Value' }],
  },
  {
    key: 'category', label: 'Category', group: 'Listings',
    icon: <CategoryIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Set Category' }],
  },
  {
    key: 'section', label: 'Section', group: 'Listings',
    icon: <FolderIcon fontSize="small" />,
    operations: [{ value: 'set_section', label: 'Set Section' }],
  },
  {
    key: 'personalization', label: 'Personalization', group: 'Listings',
    icon: <TextFieldsIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Configure' }],
  },
  // Inventory
  {
    key: 'price', label: 'Price', group: 'Inventory',
    icon: <PriceIcon fontSize="small" />,
    operations: [
      { value: 'increase_pct', label: '% Increase' },
      { value: 'decrease_pct', label: '% Decrease' },
      { value: 'increase_fixed', label: '+ Fixed' },
      { value: 'decrease_fixed', label: '- Fixed' },
      { value: 'set_price', label: 'Set Price' },
    ],
  },
  {
    key: 'quantity', label: 'Quantity', group: 'Inventory',
    icon: <InventoryIcon fontSize="small" />,
    operations: [
      { value: 'set_quantity', label: 'Set Quantity' },
      { value: 'increase_fixed', label: 'Increase' },
      { value: 'decrease_fixed', label: 'Decrease' },
    ],
  },
  // Shipping
  {
    key: 'processing_time', label: 'Processing Time', group: 'Shipping',
    icon: <ScheduleIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Set Time' }],
  },
  {
    key: 'shipping_profile', label: 'Shipping Profile', group: 'Shipping',
    icon: <ShippingIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Set Profile' }],
  },
  {
    key: 'item_weight', label: 'Item Weight', group: 'Shipping',
    icon: <WeightIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Set Weight' }],
  },
  {
    key: 'item_size', label: 'Item Size', group: 'Shipping',
    icon: <SizeIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Set Size' }],
  },
  {
    key: 'return_policy', label: 'Return Policy', group: 'Shipping',
    icon: <ReturnIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Set Policy' }],
  },
];

const GROUPS = ['Media', 'Listings', 'Inventory', 'Shipping'];

const WHO_MADE_OPTIONS = [
  { value: 'i_did', label: 'I did' },
  { value: 'collective', label: 'A member of my shop' },
  { value: 'someone_else', label: 'Another company or person' },
];

const WHEN_MADE_OPTIONS = [
  { value: 'made_to_order', label: 'Made to order' },
  { value: '2020_2025', label: '2020-2025' },
  { value: '2010_2019', label: '2010-2019' },
  { value: '2004_2009', label: '2004-2009' },
  { value: 'before_2004', label: 'Before 2004' },
];

const WEIGHT_UNITS = ['oz', 'lb', 'g', 'kg'];
const DIMENSION_UNITS = ['in', 'ft', 'mm', 'cm'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function callUpdateListing(shopId: string, listingId: number, body: Record<string, any>) {
  return fetch(`/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${shopId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Inline tag editor for per-listing tag management
// ---------------------------------------------------------------------------

function InlineTagEditor({
  tags,
  onChange,
  maxTags = 13,
  maxCharsPerTag = 20,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  maxTags?: number;
  maxCharsPerTag?: number;
}) {
  const [inputVal, setInputVal] = useState('');
  const remaining = maxTags - tags.length;

  const handleAdd = () => {
    const newTags = inputVal
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(s => s.length > 0 && s.length <= maxCharsPerTag && !tags.includes(s));
    if (newTags.length === 0) return;
    const merged = [...tags, ...newTags].slice(0, maxTags);
    onChange(merged);
    setInputVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        placeholder="Tags (comma separated)"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleAdd}
        sx={{ mb: 0.5, '& .MuiInputBase-input': { fontSize: '0.82rem' } }}
      />
      <Typography
        variant="caption"
        sx={{
          color: remaining <= 0 ? 'error.main' : remaining <= 3 ? 'warning.main' : 'text.secondary',
          fontWeight: remaining <= 3 ? 700 : 400,
        }}
      >
        {remaining} remaining
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        {tags.map((tag, i) => {
          const tooLong = tag.length > maxCharsPerTag;
          return (
            <Chip
              key={`${tag}-${i}`}
              label={
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                  {tag}
                  <Typography component="span" variant="caption" sx={{ opacity: 0.6, fontSize: '0.65rem', ml: 0.3 }}>
                    {tag.length}
                  </Typography>
                </Box>
              }
              size="small"
              color={tooLong ? 'error' : 'default'}
              onDelete={() => onChange(tags.filter((_, idx) => idx !== i))}
              sx={{
                height: 28,
                fontSize: '0.78rem',
                '& .MuiChip-deleteIcon': { fontSize: '0.9rem' },
              }}
            />
          );
        })}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Inline material editor
// ---------------------------------------------------------------------------

function InlineMaterialEditor({
  materials,
  onChange,
  maxMaterials = 13,
}: {
  materials: string[];
  onChange: (materials: string[]) => void;
  maxMaterials?: number;
}) {
  const [inputVal, setInputVal] = useState('');
  const remaining = maxMaterials - materials.length;

  const handleAdd = () => {
    const newMats = inputVal
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !materials.includes(s));
    if (newMats.length === 0) return;
    onChange([...materials, ...newMats].slice(0, maxMaterials));
    setInputVal('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        placeholder="Materials (comma separated)"
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleAdd}
        sx={{ mb: 0.5, '& .MuiInputBase-input': { fontSize: '0.82rem' } }}
      />
      <Typography variant="caption" color={remaining <= 0 ? 'error' : 'text.secondary'}>
        {remaining} remaining
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        {materials.map((mat, i) => (
          <Chip
            key={`${mat}-${i}`}
            label={mat}
            size="small"
            onDelete={() => onChange(materials.filter((_, idx) => idx !== i))}
            sx={{ height: 26, fontSize: '0.78rem' }}
          />
        ))}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BulkEditor({
  open,
  onClose,
  listings,
  shopId,
  shopName,
  shopSections,
  shippingProfiles = [],
  returnPolicies = [],
  onCompleted,
}: BulkEditorProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Navigation
  const [activeField, setActiveField] = useState<FieldCategory>('title');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Search within selected listings
  const [searchTerm, setSearchTerm] = useState('');

  // Operation state
  const [operation, setOperation] = useState<OperationType>('ai_rewrite');
  const [inputValue, setInputValue] = useState('');
  const [findValue, setFindValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [targetSectionId, setTargetSectionId] = useState<number | ''>('');

  // About fields
  const [whoMade, setWhoMade] = useState('i_did');
  const [whenMade, setWhenMade] = useState('made_to_order');
  const [isSupply, setIsSupply] = useState(false);

  // Weight/size
  const [weightValue, setWeightValue] = useState('');
  const [weightUnit, setWeightUnit] = useState('g');
  const [lengthValue, setLengthValue] = useState('');
  const [widthValue, setWidthValue] = useState('');
  const [heightValue, setHeightValue] = useState('');
  const [dimensionUnit, setDimensionUnit] = useState('cm');

  // Processing time
  const [processingMin, setProcessingMin] = useState('');
  const [processingMax, setProcessingMax] = useState('');

  // Shipping/return
  const [selectedShippingProfileId, setSelectedShippingProfileId] = useState<number | ''>('');
  const [selectedReturnPolicyId, setSelectedReturnPolicyId] = useState<number | ''>('');

  // Per-listing changes & selection
  const [pendingChanges, setPendingChanges] = useState<Map<number, PendingChange>>(new Map());
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set(listings.map(l => l.listing_id)));

  // Saving
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  // AI processing
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);
  const [aiInstructions, setAiInstructions] = useState('');

  // Groups collapsed state
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  // Derived
  const fieldDef = useMemo(() => FIELD_DEFS.find(f => f.key === activeField)!, [activeField]);

  const filteredListings = useMemo(() => {
    if (!searchTerm.trim()) return listings;
    const q = searchTerm.toLowerCase();
    return listings.filter(l =>
      l.title.toLowerCase().includes(q) ||
      l.tags.some(t => t.toLowerCase().includes(q)) ||
      String(l.listing_id).includes(q)
    );
  }, [listings, searchTerm]);

  const pendingCount = pendingChanges.size;

  // Reset when listings change
  useEffect(() => {
    setCheckedIds(new Set(listings.map(l => l.listing_id)));
    setPendingChanges(new Map());
  }, [listings]);

  // Reset operation when field changes
  const handleFieldChange = useCallback((field: FieldCategory) => {
    setActiveField(field);
    const def = FIELD_DEFS.find(f => f.key === field)!;
    setOperation(def.operations[0].value);
    setInputValue('');
    setFindValue('');
    setReplaceValue('');
    setTagsInput('');
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);

  // Get effective value for a listing field
  const getFieldValue = useCallback((listing: SelectedListing, field: FieldCategory): any => {
    const pending = pendingChanges.get(listing.listing_id);
    switch (field) {
      case 'title': return pending?.title ?? listing.title;
      case 'description': return pending?.description ?? (listing.description || '');
      case 'tags': return pending?.tags ?? listing.tags;
      case 'materials': return pending?.materials ?? (listing.materials || []);
      case 'price': {
        if (pending?.price !== undefined) return pending.price;
        return listing.price ? listing.price.amount / (listing.price.divisor || 100) : 0;
      }
      case 'quantity': return pending?.quantity ?? (listing.quantity || 0);
      case 'section': return pending?.shop_section_id ?? listing.shop_section_id;
      case 'state': return pending?.state ?? listing.state;
      case 'item_weight': return pending?.item_weight ?? listing.item_weight;
      case 'item_size': return {
        length: pending?.item_length ?? listing.item_length,
        width: pending?.item_width ?? listing.item_width,
        height: pending?.item_height ?? listing.item_height,
        unit: pending?.item_dimensions_unit ?? listing.item_dimensions_unit,
      };
      default: return '';
    }
  }, [pendingChanges]);

  // Update a single listing's pending change
  const updatePending = useCallback((listingId: number, changes: PendingChange) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(listingId) || {};
      next.set(listingId, { ...existing, ...changes });
      return next;
    });
  }, []);

  // Apply bulk operation to all checked listings
  const handleApply = useCallback(() => {
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) {
      toast.error('No listings selected');
      return;
    }

    checked.forEach(listing => {
      const current = getFieldValue(listing, activeField);

      switch (activeField) {
        case 'title':
        case 'description': {
          let newVal = current as string;
          switch (operation) {
            case 'add_before': newVal = inputValue + newVal; break;
            case 'add_after': newVal = newVal + inputValue; break;
            case 'find_replace': newVal = newVal.split(findValue).join(replaceValue); break;
            case 'delete': newVal = ''; break;
            case 'change_to': newVal = inputValue; break;
            case 'ai_rewrite': return; // handled separately
            case 'ai_optimize': return;
          }
          updatePending(listing.listing_id, { [activeField]: newVal });
          break;
        }
        case 'tags': {
          let newTags = [...(current as string[])];
          switch (operation) {
            case 'add': {
              const adding = tagsInput.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0 && s.length <= 20);
              newTags = [...new Set([...newTags, ...adding])].slice(0, 13);
              break;
            }
            case 'remove': {
              const removing = tagsInput.split(',').map(s => s.trim().toLowerCase());
              newTags = newTags.filter(t => !removing.includes(t.toLowerCase()));
              break;
            }
            case 'remove_all': {
              newTags = [];
              break;
            }
            case 'change_to': {
              newTags = tagsInput.split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0 && s.length <= 20).slice(0, 13);
              break;
            }
            case 'ai_rewrite': return;
          }
          updatePending(listing.listing_id, { tags: newTags });
          break;
        }
        case 'materials': {
          let newMats = [...(current as string[])];
          switch (operation) {
            case 'add': {
              const adding = tagsInput.split(',').map(s => s.trim()).filter(s => s.length > 0);
              newMats = [...new Set([...newMats, ...adding])].slice(0, 13);
              break;
            }
            case 'remove': {
              const removing = tagsInput.split(',').map(s => s.trim().toLowerCase());
              newMats = newMats.filter(t => !removing.includes(t.toLowerCase()));
              break;
            }
            case 'remove_all': {
              newMats = [];
              break;
            }
            case 'change_to': {
              newMats = tagsInput.split(',').map(s => s.trim()).filter(s => s.length > 0).slice(0, 13);
              break;
            }
          }
          updatePending(listing.listing_id, { materials: newMats });
          break;
        }
        case 'price': {
          const currentPrice = current as number;
          const amount = parseFloat(inputValue) || 0;
          let newPrice = currentPrice;
          switch (operation) {
            case 'increase_pct': newPrice = currentPrice * (1 + amount / 100); break;
            case 'decrease_pct': newPrice = currentPrice * (1 - amount / 100); break;
            case 'increase_fixed': newPrice = currentPrice + amount; break;
            case 'decrease_fixed': newPrice = currentPrice - amount; break;
            case 'set_price': newPrice = amount; break;
          }
          updatePending(listing.listing_id, { price: Math.max(0.01, Math.round(newPrice * 100) / 100) });
          break;
        }
        case 'quantity': {
          const currentQty = current as number;
          const amount = parseInt(inputValue) || 0;
          let newQty = currentQty;
          switch (operation) {
            case 'set_quantity': newQty = amount; break;
            case 'increase_fixed': newQty = currentQty + amount; break;
            case 'decrease_fixed': newQty = Math.max(0, currentQty - amount); break;
          }
          updatePending(listing.listing_id, { quantity: newQty });
          break;
        }
        case 'section': {
          if (targetSectionId !== '') {
            updatePending(listing.listing_id, { shop_section_id: targetSectionId as number });
          }
          break;
        }
        case 'about': {
          updatePending(listing.listing_id, {
            who_made: whoMade,
            when_made: whenMade,
            is_supply: isSupply,
          });
          break;
        }
        case 'item_weight': {
          const w = parseFloat(weightValue);
          if (!isNaN(w) && w > 0) {
            updatePending(listing.listing_id, { item_weight: w, item_weight_unit: weightUnit });
          }
          break;
        }
        case 'item_size': {
          const l = parseFloat(lengthValue);
          const w = parseFloat(widthValue);
          const h = parseFloat(heightValue);
          const changes: PendingChange = { item_dimensions_unit: dimensionUnit };
          if (!isNaN(l) && l > 0) changes.item_length = l;
          if (!isNaN(w) && w > 0) changes.item_width = w;
          if (!isNaN(h) && h > 0) changes.item_height = h;
          updatePending(listing.listing_id, changes);
          break;
        }
        case 'processing_time': {
          const min = parseInt(processingMin);
          const max = parseInt(processingMax);
          if (!isNaN(min) && !isNaN(max)) {
            updatePending(listing.listing_id, { processing_min: min, processing_max: max });
          }
          break;
        }
        case 'shipping_profile': {
          if (selectedShippingProfileId !== '') {
            updatePending(listing.listing_id, { shipping_profile_id: selectedShippingProfileId as number });
          }
          break;
        }
        case 'return_policy': {
          if (selectedReturnPolicyId !== '') {
            updatePending(listing.listing_id, { return_policy_id: selectedReturnPolicyId as number });
          }
          break;
        }
        case 'state': {
          updatePending(listing.listing_id, { state: operation === 'activate' ? 'active' : 'inactive' });
          break;
        }
      }
    });

    toast.success(`Applied to ${checked.length} listings (not saved yet)`);
  }, [filteredListings, checkedIds, activeField, operation, inputValue, findValue, replaceValue, tagsInput,
      targetSectionId, getFieldValue, updatePending, whoMade, whenMade, isSupply,
      weightValue, weightUnit, lengthValue, widthValue, heightValue, dimensionUnit,
      processingMin, processingMax, selectedShippingProfileId, selectedReturnPolicyId]);

  // AI optimize / rewrite
  const handleAIAction = useCallback(async () => {
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) return;

    setAiProcessing(true);
    setAiProgress(0);

    try {
      // Determine what to optimize
      const fieldForAI = activeField === 'tags' ? 'tags' : activeField === 'description' ? 'description' : 'title';

      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_optimize',
          field: fieldForAI,
          instructions: aiInstructions || undefined,
          listings: checked.map(l => ({
            listing_id: l.listing_id,
            title: getFieldValue(l, 'title'),
            tags: getFieldValue(l, 'tags'),
            description: fieldForAI === 'description' ? getFieldValue(l, 'description') : undefined,
          })),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'AI request failed');
      }

      const data = await res.json();
      const optimized = data.optimized || [];

      optimized.forEach((opt: any, idx: number) => {
        setAiProgress(Math.round(((idx + 1) / optimized.length) * 100));
        const changes: PendingChange = {};
        if (fieldForAI === 'title' && opt.title) changes.title = opt.title;
        if (fieldForAI === 'description' && opt.description) changes.description = opt.description;
        if (fieldForAI === 'tags' && opt.tags) changes.tags = opt.tags;
        if (Object.keys(changes).length > 0) {
          updatePending(opt.listing_id, changes);
        }
      });

      toast.success(`AI optimized ${optimized.length} listings`);
    } catch (err: any) {
      toast.error(err.message || 'AI optimization failed');
    } finally {
      setAiProcessing(false);
      setAiProgress(0);
      setAiInstructions('');
    }
  }, [filteredListings, checkedIds, activeField, aiInstructions, getFieldValue, updatePending]);

  // Bulk AI alt text for photos
  const handleBulkAltText = useCallback(async () => {
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) return;

    setAiProcessing(true);
    setAiProgress(0);
    let success = 0, failed = 0;

    for (let i = 0; i < checked.length; i++) {
      const listing = checked[i];
      try {
        const aiRes = await fetch('/api/ai/etsy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate_alt_text', title: listing.title }),
        });
        if (!aiRes.ok) { failed++; continue; }
        const aiData = await aiRes.json();
        const altText = aiData.alt_text || '';
        if (!altText) { failed++; continue; }

        const imagesRes = await fetch(
          `/api/clawd/etsy?action=get_listing_images&listing_id=${listing.listing_id}&shop_id=${shopId}`
        );
        if (!imagesRes.ok) { failed++; continue; }
        const imagesData = await imagesRes.json();
        const images = imagesData.images || imagesData.results || [];

        let ok = true;
        for (const img of images) {
          try {
            const r = await fetch(
              `/api/clawd/etsy?action=update_listing_image&listing_id=${listing.listing_id}&image_id=${img.listing_image_id}&shop_id=${shopId}`,
              { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ alt_text: altText }) }
            );
            if (!r.ok) ok = false;
          } catch { ok = false; }
        }
        if (ok) success++; else failed++;
      } catch { failed++; }
      setAiProgress(Math.round(((i + 1) / checked.length) * 100));
    }

    setAiProcessing(false);
    if (failed === 0) toast.success(`Alt text: ${success} listings updated`);
    else toast.error(`Alt text: ${success} ok, ${failed} failed`);
  }, [filteredListings, checkedIds, shopId]);

  // Save all pending changes to Etsy
  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) {
      toast('No changes to save');
      return;
    }

    setSaving(true);
    setSaveProgress(0);

    const entries = Array.from(pendingChanges.entries());
    let success = 0;
    let failed = 0;

    for (let i = 0; i < entries.length; i++) {
      const [listingId, changes] = entries[i];
      try {
        const body: Record<string, any> = {};
        if (changes.title !== undefined) body.title = changes.title;
        if (changes.description !== undefined) body.description = changes.description;
        if (changes.tags !== undefined) body.tags = changes.tags;
        if (changes.materials !== undefined) body.materials = changes.materials;
        if (changes.price !== undefined) body.price = changes.price;
        if (changes.quantity !== undefined) body.quantity = changes.quantity;
        if (changes.shop_section_id !== undefined) body.shop_section_id = changes.shop_section_id;
        if (changes.state !== undefined) body.state = changes.state;
        if (changes.who_made !== undefined) body.who_made = changes.who_made;
        if (changes.when_made !== undefined) body.when_made = changes.when_made;
        if (changes.is_supply !== undefined) body.is_supply = changes.is_supply;
        if (changes.item_weight !== undefined) body.item_weight = changes.item_weight;
        if (changes.item_weight_unit !== undefined) body.item_weight_unit = changes.item_weight_unit;
        if (changes.item_length !== undefined) body.item_length = changes.item_length;
        if (changes.item_width !== undefined) body.item_width = changes.item_width;
        if (changes.item_height !== undefined) body.item_height = changes.item_height;
        if (changes.item_dimensions_unit !== undefined) body.item_dimensions_unit = changes.item_dimensions_unit;
        if (changes.shipping_profile_id !== undefined) body.shipping_profile_id = changes.shipping_profile_id;
        if (changes.return_policy_id !== undefined) body.return_policy_id = changes.return_policy_id;
        if (changes.processing_min !== undefined) body.processing_min = changes.processing_min;
        if (changes.processing_max !== undefined) body.processing_max = changes.processing_max;

        const res = await callUpdateListing(shopId, listingId, body);
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
      setSaveProgress(Math.round(((i + 1) / entries.length) * 100));
      if (i < entries.length - 1) await new Promise(r => setTimeout(r, 100));
    }

    setSaving(false);

    if (failed === 0) {
      toast.success(`${success} listings updated successfully`);
      setPendingChanges(new Map());
      onCompleted();
    } else {
      toast.error(`${success} ok, ${failed} failed`);
    }
  }, [pendingChanges, shopId, onCompleted]);

  // Toggle all checkboxes
  const handleToggleAll = useCallback(() => {
    const allIds = filteredListings.map(l => l.listing_id);
    const allChecked = allIds.every(id => checkedIds.has(id));
    if (allChecked) setCheckedIds(new Set());
    else setCheckedIds(new Set(allIds));
  }, [filteredListings, checkedIds]);

  const allChecked = filteredListings.length > 0 && filteredListings.every(l => checkedIds.has(l.listing_id));
  const someChecked = filteredListings.some(l => checkedIds.has(l.listing_id)) && !allChecked;

  // Close handler with unsaved warning
  const handleClose = useCallback(() => {
    if (pendingChanges.size > 0) {
      if (!confirm(`${pendingChanges.size} unsaved changes. Are you sure you want to exit?`)) return;
    }
    setPendingChanges(new Map());
    onClose();
  }, [pendingChanges, onClose]);

  // Discard all pending changes
  const handleDiscard = useCallback(() => {
    setPendingChanges(new Map());
    toast.success('All changes discarded');
  }, []);

  if (!open) return null;

  // ---------------------------------------------------------------------------
  // Left sidebar content
  // ---------------------------------------------------------------------------
  const sidebarContent = (
    <Box sx={{ py: 0.5 }}>
      {GROUPS.map(group => {
        const fields = FIELD_DEFS.filter(f => f.group === group);
        const isCollapsed = collapsedGroups.has(group);
        return (
          <Box key={group} sx={{ mb: 0.5 }}>
            <Box
              onClick={() => {
                setCollapsedGroups(prev => {
                  const next = new Set(prev);
                  if (next.has(group)) next.delete(group);
                  else next.add(group);
                  return next;
                });
              }}
              sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: 2, py: 0.75, cursor: 'pointer',
                '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.65rem' }}
              >
                {group}
              </Typography>
              {isCollapsed ? <ExpandMoreIcon sx={{ fontSize: 16, color: 'text.secondary' }} /> : <ExpandLessIcon sx={{ fontSize: 16, color: 'text.secondary' }} />}
            </Box>
            <Collapse in={!isCollapsed}>
              {fields.map(field => {
                const isActive = activeField === field.key;
                // Count pending changes for this field
                let fieldChangeCount = 0;
                pendingChanges.forEach((change) => {
                  const key = field.key as string;
                  if (key === 'title' && change.title !== undefined) fieldChangeCount++;
                  else if (key === 'description' && change.description !== undefined) fieldChangeCount++;
                  else if (key === 'tags' && change.tags !== undefined) fieldChangeCount++;
                  else if (key === 'materials' && change.materials !== undefined) fieldChangeCount++;
                  else if (key === 'price' && change.price !== undefined) fieldChangeCount++;
                  else if (key === 'quantity' && change.quantity !== undefined) fieldChangeCount++;
                  else if (key === 'section' && change.shop_section_id !== undefined) fieldChangeCount++;
                  else if (key === 'state' && change.state !== undefined) fieldChangeCount++;
                  else if (key === 'about' && (change.who_made !== undefined || change.when_made !== undefined)) fieldChangeCount++;
                  else if (key === 'item_weight' && change.item_weight !== undefined) fieldChangeCount++;
                  else if (key === 'item_size' && (change.item_length !== undefined || change.item_width !== undefined || change.item_height !== undefined)) fieldChangeCount++;
                  else if (key === 'shipping_profile' && change.shipping_profile_id !== undefined) fieldChangeCount++;
                  else if (key === 'return_policy' && change.return_policy_id !== undefined) fieldChangeCount++;
                  else if (key === 'processing_time' && change.processing_min !== undefined) fieldChangeCount++;
                });

                return (
                  <ListItemButton
                    key={field.key}
                    selected={isActive}
                    onClick={() => handleFieldChange(field.key)}
                    sx={{
                      py: 0.75, px: 2, minHeight: 38,
                      '&.Mui-selected': {
                        bgcolor: 'primary.50',
                        borderLeft: '3px solid',
                        borderColor: 'primary.main',
                        color: 'primary.main',
                      },
                    }}
                  >
                    <Box sx={{ mr: 1.5, display: 'flex', alignItems: 'center', color: 'inherit', opacity: 0.8 }}>
                      {field.icon}
                    </Box>
                    <ListItemText
                      primary={field.label}
                      primaryTypographyProps={{
                        fontSize: '0.82rem',
                        fontWeight: isActive ? 700 : 500,
                      }}
                    />
                    {fieldChangeCount > 0 && (
                      <Badge
                        badgeContent={fieldChangeCount}
                        color="primary"
                        sx={{ '& .MuiBadge-badge': { fontSize: '0.6rem', height: 16, minWidth: 16 } }}
                      />
                    )}
                  </ListItemButton>
                );
              })}
            </Collapse>
          </Box>
        );
      })}
    </Box>
  );

  // ---------------------------------------------------------------------------
  // Top action bar
  // ---------------------------------------------------------------------------
  const renderActionBar = () => {
    const ops = fieldDef.operations;
    const isAI = operation === 'ai_rewrite' || operation === 'ai_optimize';
    const isFindReplace = operation === 'find_replace';

    // Fields that don't need the standard action bar
    if (['photos', 'videos', 'about', 'category', 'personalization', 'processing_time',
         'shipping_profile', 'item_weight', 'item_size', 'return_policy', 'state'].includes(activeField)) {
      return renderSpecialActionBar();
    }

    return (
      <Paper
        elevation={0}
        sx={{
          px: 2, py: 1.5, mb: 1.5,
          display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap',
          border: '1px solid', borderColor: 'divider', borderRadius: 2,
        }}
      >
        {/* Operation select */}
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select
            value={operation}
            onChange={(e) => setOperation(e.target.value as OperationType)}
            sx={{
              fontSize: '0.85rem', fontWeight: 600,
              bgcolor: isAI ? 'rgba(139,92,246,0.08)' : 'primary.50',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: isAI ? 'rgba(139,92,246,0.3)' : undefined,
              },
            }}
          >
            {ops.map(op => (
              <MenuItem key={op.value} value={op.value}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {(op.value === 'ai_rewrite' || op.value === 'ai_optimize') && (
                    <AIIcon sx={{ fontSize: 16, color: '#8b5cf6' }} />
                  )}
                  <span>{op.label}</span>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Input fields based on operation */}
        {isAI ? (
          <TextField
            size="small"
            placeholder="Additional instructions (optional)..."
            value={aiInstructions}
            onChange={(e) => setAiInstructions(e.target.value)}
            sx={{ flex: 1, minWidth: 150 }}
          />
        ) : isFindReplace ? (
          <>
            <TextField
              size="small"
              placeholder="Find..."
              value={findValue}
              onChange={(e) => setFindValue(e.target.value)}
              sx={{ flex: 1, minWidth: 100 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16 }} /></InputAdornment> }}
            />
            <SwapIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
            <TextField
              size="small"
              placeholder="Replace with..."
              value={replaceValue}
              onChange={(e) => setReplaceValue(e.target.value)}
              sx={{ flex: 1, minWidth: 100 }}
            />
          </>
        ) : (activeField === 'tags' || activeField === 'materials') ? (
          <TextField
            size="small"
            placeholder={`${fieldDef.label} (comma separated)...`}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            sx={{ flex: 1, minWidth: 150 }}
          />
        ) : activeField === 'section' ? (
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <Select
              value={targetSectionId}
              onChange={(e) => setTargetSectionId(e.target.value as number)}
              displayEmpty
              sx={{ fontSize: '0.85rem' }}
            >
              <MenuItem value="" disabled>Select section...</MenuItem>
              {shopSections.map(s => (
                <MenuItem key={s.shop_section_id} value={s.shop_section_id}>{s.title}</MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : activeField === 'price' ? (
          <TextField
            size="small"
            placeholder="Amount..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            sx={{ flex: 1, minWidth: 120, maxWidth: 200 }}
            type="number"
            InputProps={{
              startAdornment: <InputAdornment position="start">{operation.includes('pct') ? '%' : '$'}</InputAdornment>,
            }}
          />
        ) : activeField === 'quantity' ? (
          <TextField
            size="small"
            placeholder="Quantity..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            sx={{ flex: 1, minWidth: 100, maxWidth: 160 }}
            type="number"
          />
        ) : operation !== 'delete' ? (
          <TextField
            size="small"
            placeholder={`${fieldDef.label}...`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            sx={{ flex: 1, minWidth: 150 }}
          />
        ) : null}

        {/* Apply button */}
        <Button
          variant="contained"
          size="small"
          onClick={isAI ? handleAIAction : handleApply}
          disabled={saving || aiProcessing}
          sx={{
            minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px',
            background: isAI
              ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)'
              : 'linear-gradient(135deg, #2563eb, #4f46e5)',
            '&:hover': {
              background: isAI
                ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                : 'linear-gradient(135deg, #1d4ed8, #4338ca)',
            },
          }}
        >
          {aiProcessing ? <CircularProgress size={18} sx={{ color: 'white' }} /> : 'Apply'}
        </Button>
      </Paper>
    );
  };

  // Special action bars for non-text fields
  const renderSpecialActionBar = () => {
    switch (activeField) {
      case 'photos':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<AIIcon />}
                onClick={handleBulkAltText}
                disabled={aiProcessing}
                sx={{
                  minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px',
                  background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                }}
              >
                {aiProcessing ? `AI Alt Text... ${aiProgress}%` : 'AI Generate Alt Text'}
              </Button>
              <Typography variant="caption" color="text.secondary">
                Automatically generate SEO-optimized alt text for all images of selected listings
              </Typography>
            </Box>
          </Paper>
        );

      case 'videos':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Alert severity="info" sx={{ fontSize: '0.82rem' }}>
              Video management is available in the single listing editor. Select a listing below to manage videos.
            </Alert>
          </Paper>
        );

      case 'about':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>Who Made</InputLabel>
                <Select value={whoMade} onChange={e => setWhoMade(e.target.value)} label="Who Made" sx={{ fontSize: '0.85rem' }}>
                  {WHO_MADE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>When Made</InputLabel>
                <Select value={whenMade} onChange={e => setWhenMade(e.target.value)} label="When Made" sx={{ fontSize: '0.85rem' }}>
                  {WHEN_MADE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControlLabel
                control={<Switch checked={isSupply} onChange={e => setIsSupply(e.target.checked)} size="small" />}
                label={<Typography variant="body2" sx={{ fontSize: '0.82rem' }}>Is Supply</Typography>}
              />
              <Button
                variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
              >
                Apply
              </Button>
            </Box>
          </Paper>
        );

      case 'processing_time':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" type="number" label="Min Days" value={processingMin} onChange={e => setProcessingMin(e.target.value)} sx={{ width: 100 }} />
              <Typography variant="body2" color="text.secondary">to</Typography>
              <TextField size="small" type="number" label="Max Days" value={processingMax} onChange={e => setProcessingMax(e.target.value)} sx={{ width: 100 }} />
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                Apply
              </Button>
            </Box>
          </Paper>
        );

      case 'shipping_profile':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 250 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>Shipping Profile</InputLabel>
                <Select
                  value={selectedShippingProfileId}
                  onChange={e => setSelectedShippingProfileId(e.target.value as number)}
                  label="Shipping Profile"
                  sx={{ fontSize: '0.85rem' }}
                >
                  {shippingProfiles.map(sp => (
                    <MenuItem key={sp.shipping_profile_id} value={sp.shipping_profile_id}>{sp.title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                Apply
              </Button>
            </Box>
          </Paper>
        );

      case 'item_weight':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" type="number" label="Weight" value={weightValue} onChange={e => setWeightValue(e.target.value)} sx={{ width: 120 }} />
              <FormControl size="small" sx={{ minWidth: 80 }}>
                <Select value={weightUnit} onChange={e => setWeightUnit(e.target.value)} sx={{ fontSize: '0.85rem' }}>
                  {WEIGHT_UNITS.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                Apply
              </Button>
            </Box>
          </Paper>
        );

      case 'item_size':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" type="number" label="Length" value={lengthValue} onChange={e => setLengthValue(e.target.value)} sx={{ width: 90 }} />
              <Typography variant="body2" color="text.secondary">x</Typography>
              <TextField size="small" type="number" label="Width" value={widthValue} onChange={e => setWidthValue(e.target.value)} sx={{ width: 90 }} />
              <Typography variant="body2" color="text.secondary">x</Typography>
              <TextField size="small" type="number" label="Height" value={heightValue} onChange={e => setHeightValue(e.target.value)} sx={{ width: 90 }} />
              <FormControl size="small" sx={{ minWidth: 70 }}>
                <Select value={dimensionUnit} onChange={e => setDimensionUnit(e.target.value)} sx={{ fontSize: '0.85rem' }}>
                  {DIMENSION_UNITS.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                Apply
              </Button>
            </Box>
          </Paper>
        );

      case 'return_policy':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 250 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>Return Policy</InputLabel>
                <Select
                  value={selectedReturnPolicyId}
                  onChange={e => setSelectedReturnPolicyId(e.target.value as number)}
                  label="Return Policy"
                  sx={{ fontSize: '0.85rem' }}
                >
                  {returnPolicies.map(rp => (
                    <MenuItem key={rp.return_policy_id} value={rp.return_policy_id}>
                      {rp.description || `Policy #${rp.return_policy_id}`}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                Apply
              </Button>
            </Box>
          </Paper>
        );

      case 'state':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
              <Button
                variant="contained" size="small" color="success"
                onClick={() => { setOperation('activate' as OperationType); setTimeout(handleApply, 0); }}
                disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
              >
                Activate All
              </Button>
              <Button
                variant="outlined" size="small" color="warning"
                onClick={() => { setOperation('deactivate' as OperationType); setTimeout(handleApply, 0); }}
                disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
              >
                Deactivate All
              </Button>
            </Box>
          </Paper>
        );

      case 'category':
      case 'personalization':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Alert severity="info" sx={{ fontSize: '0.82rem' }}>
              {activeField === 'category'
                ? 'Category changes require the single listing editor. Select a listing below.'
                : 'Personalization settings require the single listing editor. Select a listing below.'}
            </Alert>
          </Paper>
        );

      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Per-listing row renderer
  // ---------------------------------------------------------------------------
  const renderListingRow = (listing: SelectedListing) => {
    const isChecked = checkedIds.has(listing.listing_id);
    const hasPending = pendingChanges.has(listing.listing_id);
    const value = getFieldValue(listing, activeField);

    return (
      <Paper
        key={listing.listing_id}
        variant="outlined"
        sx={{
          p: { xs: 1, sm: 1.5 }, mb: 1,
          borderColor: hasPending ? 'primary.main' : 'divider',
          borderWidth: hasPending ? 2 : 1,
          bgcolor: hasPending ? 'rgba(37,99,235,0.03)' : 'background.paper',
          opacity: isChecked ? 1 : 0.45,
          transition: 'all 0.15s ease',
          '&:hover': { borderColor: hasPending ? 'primary.main' : 'primary.200' },
        }}
      >
        <Box sx={{ display: 'flex', gap: { xs: 1, sm: 1.5 }, alignItems: 'flex-start' }}>
          {/* Checkbox */}
          <Checkbox
            checked={isChecked}
            onChange={() => {
              setCheckedIds(prev => {
                const next = new Set(prev);
                if (next.has(listing.listing_id)) next.delete(listing.listing_id);
                else next.add(listing.listing_id);
                return next;
              });
            }}
            sx={{ p: 0.5 }}
          />

          {/* Thumbnail */}
          <Box
            sx={{
              width: { xs: 40, sm: 56 },
              height: { xs: 40, sm: 56 },
              borderRadius: 1,
              bgcolor: '#f1f5f9',
              flexShrink: 0,
              backgroundImage: listing.thumbnail?.url_75x75 ? `url(${listing.thumbnail.url_75x75})` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />

          {/* Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Title (always visible as context) */}
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600, mb: 0.75,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                fontSize: { xs: '0.78rem', sm: '0.85rem' },
                color: 'text.primary',
              }}
            >
              {listing.title}
            </Typography>

            {/* Field-specific inline editor */}
            {activeField === 'title' && (
              <Box>
                <TextField
                  fullWidth
                  size="small"
                  value={value as string}
                  onChange={(e) => updatePending(listing.listing_id, { title: e.target.value })}
                  multiline={false}
                  sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
                  <Typography
                    variant="caption"
                    sx={{
                      color: (value as string).length > 140 ? 'error.main'
                        : (value as string).length >= 100 ? 'success.main'
                        : (value as string).length >= 60 ? 'warning.main'
                        : 'text.secondary',
                      fontWeight: 600,
                    }}
                  >
                    {140 - (value as string).length} characters remaining
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {(value as string).length}/140
                  </Typography>
                </Box>
              </Box>
            )}

            {activeField === 'description' && (
              <Box>
                <TextField
                  fullWidth
                  size="small"
                  value={value as string}
                  onChange={(e) => updatePending(listing.listing_id, { description: e.target.value })}
                  multiline
                  minRows={2}
                  maxRows={6}
                  sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
                  {(value as string).length} characters
                </Typography>
              </Box>
            )}

            {activeField === 'tags' && (
              <InlineTagEditor
                tags={value as string[]}
                onChange={(newTags) => updatePending(listing.listing_id, { tags: newTags })}
              />
            )}

            {activeField === 'materials' && (
              <InlineMaterialEditor
                materials={value as string[]}
                onChange={(newMats) => updatePending(listing.listing_id, { materials: newMats })}
              />
            )}

            {activeField === 'price' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <TextField
                  size="small"
                  type="number"
                  value={value as number}
                  onChange={(e) => updatePending(listing.listing_id, { price: parseFloat(e.target.value) || 0 })}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">
                      {listing.price?.currency_code === 'EUR' ? '\u20ac' : listing.price?.currency_code === 'GBP' ? '\u00a3' : listing.price?.currency_code === 'TRY' ? '\u20ba' : '$'}
                    </InputAdornment>,
                  }}
                  sx={{ maxWidth: 150, '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
                {listing.price && (
                  <Typography variant="caption" color="text.secondary">
                    (was: {(listing.price.amount / (listing.price.divisor || 100)).toFixed(2)})
                  </Typography>
                )}
              </Box>
            )}

            {activeField === 'quantity' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TextField
                  size="small"
                  type="number"
                  value={value as number}
                  onChange={(e) => updatePending(listing.listing_id, { quantity: parseInt(e.target.value) || 0 })}
                  sx={{ maxWidth: 120, '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
                {listing.quantity !== undefined && (
                  <Typography variant="caption" color="text.secondary">
                    (was: {listing.quantity})
                  </Typography>
                )}
              </Box>
            )}

            {activeField === 'section' && (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <Select
                  value={(value as number) || ''}
                  onChange={(e) => updatePending(listing.listing_id, { shop_section_id: e.target.value as number })}
                  displayEmpty
                  sx={{ fontSize: '0.85rem' }}
                >
                  <MenuItem value="">No section</MenuItem>
                  {shopSections.map(s => (
                    <MenuItem key={s.shop_section_id} value={s.shop_section_id}>{s.title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {activeField === 'state' && (
              <Chip
                label={value === 'active' ? 'Active' : value === 'inactive' ? 'Inactive' : value === 'draft' ? 'Draft' : String(value)}
                size="small"
                color={value === 'active' ? 'success' : value === 'inactive' ? 'default' : 'warning'}
              />
            )}

            {activeField === 'about' && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={`Who: ${listing.who_made || 'i_did'}`} size="small" variant="outlined" />
                <Chip label={`When: ${listing.when_made || 'made_to_order'}`} size="small" variant="outlined" />
                <Chip label={listing.is_supply ? 'Supply' : 'Not supply'} size="small" variant="outlined" />
              </Box>
            )}

            {activeField === 'photos' && (
              <Typography variant="caption" color="text.secondary">
                Photos are displayed in the listing. Alt text will be applied to all images.
              </Typography>
            )}

            {activeField === 'videos' && (
              <Typography variant="caption" color="text.secondary">
                Video management available in single listing editor.
              </Typography>
            )}

            {activeField === 'item_weight' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.item_weight ? `${listing.item_weight} ${listing.item_weight_unit || 'g'}` : 'Not set'}
              </Typography>
            )}

            {activeField === 'item_size' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.item_length
                  ? `${listing.item_length} x ${listing.item_width || '?'} x ${listing.item_height || '?'} ${listing.item_dimensions_unit || 'cm'}`
                  : 'Not set'}
              </Typography>
            )}

            {activeField === 'processing_time' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.processing_min ? `${listing.processing_min}-${listing.processing_max} days` : 'Not set'}
              </Typography>
            )}

            {activeField === 'shipping_profile' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.shipping_profile_id
                  ? (shippingProfiles.find(sp => sp.shipping_profile_id === listing.shipping_profile_id)?.title || `Profile #${listing.shipping_profile_id}`)
                  : 'Not set'}
              </Typography>
            )}

            {activeField === 'return_policy' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.return_policy_id
                  ? (returnPolicies.find(rp => rp.return_policy_id === listing.return_policy_id)?.description || `Policy #${listing.return_policy_id}`)
                  : 'Not set'}
              </Typography>
            )}

            {activeField === 'category' && (
              <Typography variant="caption" color="text.secondary">
                Category can be set in single listing editor.
              </Typography>
            )}

            {activeField === 'personalization' && (
              <Typography variant="caption" color="text.secondary">
                Personalization can be configured in single listing editor.
              </Typography>
            )}
          </Box>

          {/* SEO score indicator for title */}
          {activeField === 'title' && (
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Tooltip title={`${(value as string).length}/140 chars`}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    color: (value as string).length >= 100 && (value as string).length <= 140 ? 'success.main'
                      : (value as string).length >= 60 ? 'warning.main' : 'error.main',
                  }}
                >
                  {(value as string).length >= 100 && (value as string).length <= 140 ? 'A+'
                    : (value as string).length >= 80 ? 'B'
                    : (value as string).length >= 60 ? 'C' : 'F'}
                </Typography>
              </Tooltip>
            </Box>
          )}

          {/* Tag score indicator */}
          {activeField === 'tags' && (
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Tooltip title={`${(value as string[]).length}/13 tags`}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.75rem',
                    color: (value as string[]).length >= 13 ? 'success.main'
                      : (value as string[]).length >= 10 ? 'warning.main' : 'error.main',
                  }}
                >
                  {(value as string[]).length >= 13 ? 'A+'
                    : (value as string[]).length >= 10 ? 'B'
                    : (value as string[]).length >= 7 ? 'C' : 'F'}
                </Typography>
              </Tooltip>
            </Box>
          )}
        </Box>
      </Paper>
    );
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <Dialog
      open={open}
      onClose={handleClose}
      fullScreen
      PaperProps={{ sx: { bgcolor: '#f8fafc' } }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex', alignItems: 'center', gap: { xs: 1, sm: 2 },
          px: { xs: 1.5, sm: 2 }, py: 1,
          borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'white',
          position: 'sticky', top: 0, zIndex: 10,
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        {isMobile && (
          <IconButton onClick={() => setSidebarOpen(true)} size="small">
            <MenuIcon />
          </IconButton>
        )}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {shopName && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, fontSize: '0.7rem' }}>
              Etsy &middot; {shopName}
            </Typography>
          )}
          <Typography variant="subtitle1" fontWeight={700} sx={{ fontSize: { xs: '0.9rem', sm: '1rem' } }}>
            Editing {listings.length} listings
          </Typography>
        </Box>

        {pendingCount > 0 && (
          <Chip
            label={`${pendingCount} changes`}
            color="primary"
            size="small"
            sx={{ fontWeight: 700, mr: 0.5 }}
          />
        )}

        {pendingCount > 0 && (
          <Button
            variant="text"
            size="small"
            color="error"
            onClick={handleDiscard}
            sx={{ minHeight: 36, textTransform: 'none', fontWeight: 600, fontSize: '0.8rem' }}
          >
            Discard
          </Button>
        )}

        <Button
          variant="outlined"
          size="small"
          onClick={handleClose}
          sx={{ minHeight: 36, textTransform: 'none', fontWeight: 600, borderRadius: '8px', display: { xs: 'none', sm: 'flex' } }}
        >
          Cancel
        </Button>

        <IconButton onClick={handleClose} size="small" sx={{ display: { xs: 'flex', sm: 'none' } }}>
          <CloseIcon />
        </IconButton>

        <Button
          variant="contained"
          size="small"
          onClick={handleSave}
          disabled={saving || pendingCount === 0}
          startIcon={saving ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <SyncIcon />}
          sx={{
            minHeight: 36, textTransform: 'none', fontWeight: 700, borderRadius: '8px',
            px: { xs: 2, sm: 3 },
            background: 'linear-gradient(135deg, #10b981, #059669)',
            '&:hover': { background: 'linear-gradient(135deg, #059669, #047857)' },
            '&.Mui-disabled': { bgcolor: '#e0e0e0' },
          }}
        >
          {saving ? `${saveProgress}%` : isMobile ? 'Sync' : 'Sync Updates'}
        </Button>
      </Box>

      {/* Progress bar */}
      {(saving || aiProcessing) && (
        <LinearProgress
          variant="determinate"
          value={saving ? saveProgress : aiProgress}
          sx={{
            height: 3,
            bgcolor: 'transparent',
            '& .MuiLinearProgress-bar': {
              background: saving ? 'linear-gradient(90deg, #10b981, #059669)' : 'linear-gradient(90deg, #8b5cf6, #6d28d9)',
            },
          }}
        />
      )}

      {/* Body */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <Box
            sx={{
              width: 220, flexShrink: 0, bgcolor: 'white',
              borderRight: '1px solid', borderColor: 'divider',
              overflowY: 'auto',
              '&::-webkit-scrollbar': { width: 4 },
              '&::-webkit-scrollbar-thumb': { bgcolor: '#d0d0d0', borderRadius: 2 },
            }}
          >
            {sidebarContent}
          </Box>
        )}

        {/* Mobile sidebar drawer */}
        {isMobile && (
          <SwipeableDrawer
            anchor="left"
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            onOpen={() => setSidebarOpen(true)}
            PaperProps={{ sx: { width: 260 } }}
          >
            <Box sx={{ pt: 2 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, pb: 1 }}>
                <Typography variant="subtitle2" fontWeight={700}>
                  Select Field
                </Typography>
                <IconButton size="small" onClick={() => setSidebarOpen(false)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Box>
              {sidebarContent}
            </Box>
          </SwipeableDrawer>
        )}

        {/* Main content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 1, sm: 2 } }}>
          {/* Action bar */}
          {renderActionBar()}

          {/* Search + select all row */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5, flexWrap: 'wrap' }}>
            <Checkbox
              checked={allChecked}
              indeterminate={someChecked}
              onChange={handleToggleAll}
              sx={{ p: 0.5 }}
            />
            <TextField
              size="small"
              placeholder="Search listings..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              sx={{ flex: 1, minWidth: 120, maxWidth: 400 }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>,
                endAdornment: searchTerm ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchTerm('')}>
                      <ClearIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {filteredListings.filter(l => checkedIds.has(l.listing_id)).length}/{filteredListings.length} selected
            </Typography>

            {/* Quick field name display */}
            <Chip
              label={fieldDef.label}
              size="small"
              icon={fieldDef.icon as React.ReactElement}
              sx={{
                fontWeight: 700, ml: 'auto',
                bgcolor: 'primary.50', color: 'primary.main',
                '& .MuiChip-icon': { color: 'primary.main' },
              }}
            />
          </Box>

          {/* Listing rows */}
          {filteredListings.length === 0 ? (
            <Paper sx={{ p: 4, textAlign: 'center' }}>
              <Typography color="text.secondary">
                {searchTerm ? 'No listings match your search' : 'No listings to edit'}
              </Typography>
            </Paper>
          ) : (
            filteredListings.map(listing => renderListingRow(listing))
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
