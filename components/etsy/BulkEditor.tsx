import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Box, Typography, Paper, Button, IconButton, TextField, Select, MenuItem,
  Chip, FormControl, InputLabel, Divider, useMediaQuery, useTheme, InputAdornment,
  CircularProgress, LinearProgress, SwipeableDrawer, List, ListItem, ListItemButton,
  ListItemText, Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup,
  Collapse, Checkbox, Tooltip, Badge, Switch, FormControlLabel, Alert,
  Autocomplete,
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
import VariationEditor from './VariationEditor';
import { stageEtsyDraft, stageEtsyDraftFile } from '@/lib/etsy/draftClient';
import BulkPhotoStudio from './BulkPhotoStudio';
import BulkVideoStudio from './BulkVideoStudio';

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
  taxonomy_id?: number | null;
}

interface ListingImage {
  listing_image_id: number;
  url_75x75?: string;
  url_170x135?: string;
  url_570xN?: string;
  url_fullxfull?: string;
  rank: number;
  alt_text?: string;
  is_pending_upload?: boolean;
  pending_filename?: string;
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
  | 'title' | 'description' | 'tags' | 'materials' | 'about' | 'category' | 'etsy_details' | 'section' | 'personalization'
  | 'variations' | 'price' | 'quantity' | 'sku'
  | 'processing_time' | 'shipping_profile' | 'item_weight' | 'item_size' | 'return_policy'
  | 'state';

type OperationType =
  | '' | 'ai_rewrite' | 'ai_optimize' | 'add_before' | 'add_after' | 'find_replace' | 'delete' | 'change_to'
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
  is_personalizable?: boolean;
  personalization_is_required?: boolean;
  personalization_instructions?: string;
  personalization_char_count_max?: number;
  taxonomy_id?: number;
  taxonomyProperties?: ListingPropertyPatch[];
}

interface TaxonomyOption {
  value_id?: number;
  name: string;
}

interface TaxonomyNode {
  id: number;
  name: string;
  children?: TaxonomyNode[];
}

interface FlatTaxonomy {
  id: number;
  label: string;
}

interface TaxonomyProperty {
  property_id: number;
  display_name: string;
  name?: string;
  supports_variations?: boolean;
  is_required?: boolean;
  possible_values?: Array<{ value_id: number; name: string }>;
  scales?: Array<{ scale_id: number; display_name: string }>;
}

interface ListingPropertyPatch {
  property_id: number;
  values: string[];
  value_ids?: number[];
  scale_id?: number | null;
}

function flattenTaxonomy(nodes: TaxonomyNode[], prefix = ''): FlatTaxonomy[] {
  const result: FlatTaxonomy[] = [];
  for (const node of nodes) {
    const label = prefix ? `${prefix} > ${node.name}` : node.name;
    result.push({ id: node.id, label });
    if (node.children?.length) {
      result.push(...flattenTaxonomy(node.children, label));
    }
  }
  return result;
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
    key: 'photos', label: 'fields.photos', group: 'groups.media',
    icon: <ImageIcon fontSize="small" />,
    operations: [
      { value: 'add', label: 'operations.addPhotos' },
      { value: 'delete', label: 'operations.deleteAllPhotos' },
      { value: 'ai_optimize', label: 'operations.aiAltText' },
    ],
  },
  {
    key: 'videos', label: 'fields.videos', group: 'groups.media',
    icon: <VideoIcon fontSize="small" />,
    operations: [
      { value: 'add', label: 'operations.addVideo' },
      { value: 'delete', label: 'operations.deleteAllVideos' },
    ],
  },
  // Listings
  {
    key: 'title', label: 'fields.title', group: 'groups.listings',
    icon: <TitleIcon fontSize="small" />,
    operations: [
      { value: 'ai_rewrite', label: 'operations.aiRewrite' },
      { value: 'add_before', label: 'operations.addBefore' },
      { value: 'add_after', label: 'operations.addAfter' },
      { value: 'find_replace', label: 'operations.findReplace' },
      { value: 'delete', label: 'operations.delete' },
      { value: 'change_to', label: 'operations.changeTo' },
    ],
  },
  {
    key: 'description', label: 'fields.description', group: 'groups.listings',
    icon: <DescriptionIcon fontSize="small" />,
    operations: [
      { value: 'ai_rewrite', label: 'operations.aiRewrite' },
      { value: 'add_before', label: 'operations.addBefore' },
      { value: 'add_after', label: 'operations.addAfter' },
      { value: 'find_replace', label: 'operations.findReplace' },
      { value: 'delete', label: 'operations.delete' },
      { value: 'change_to', label: 'operations.changeTo' },
    ],
  },
  {
    key: 'tags', label: 'fields.tags', group: 'groups.listings',
    icon: <TagIcon fontSize="small" />,
    operations: [
      { value: 'ai_rewrite', label: 'operations.aiOptimize' },
      { value: 'add', label: 'operations.add' },
      { value: 'remove', label: 'operations.remove' },
      { value: 'remove_all', label: 'operations.removeAll' },
      { value: 'change_to', label: 'operations.changeTo' },
    ],
  },
  {
    key: 'materials', label: 'fields.materials', group: 'groups.listings',
    icon: <MaterialIcon fontSize="small" />,
    operations: [
      { value: 'add', label: 'operations.add' },
      { value: 'remove', label: 'operations.remove' },
      { value: 'remove_all', label: 'operations.removeAll' },
      { value: 'change_to', label: 'operations.changeTo' },
    ],
  },
  {
    key: 'about', label: 'fields.about', group: 'groups.listings',
    icon: <PersonIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.setValue' }],
  },
  {
    key: 'category', label: 'fields.category', group: 'groups.listings',
    icon: <CategoryIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.setCategory' }],
  },
  {
    key: 'etsy_details', label: 'Etsy details', group: 'groups.listings',
    icon: <TuneIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'Edit details' }],
  },
  {
    key: 'section', label: 'fields.section', group: 'groups.listings',
    icon: <FolderIcon fontSize="small" />,
    operations: [{ value: 'set_section', label: 'operations.setSection' }],
  },
  {
    key: 'personalization', label: 'fields.personalization', group: 'groups.listings',
    icon: <TextFieldsIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.configure' }],
  },
  // Inventory
  {
    key: 'variations', label: 'fields.variations', group: 'groups.inventory',
    icon: <TuneIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.editInline' }],
  },
  {
    key: 'price', label: 'fields.price', group: 'groups.inventory',
    icon: <PriceIcon fontSize="small" />,
    operations: [
      { value: 'increase_pct', label: 'operations.pctIncrease' },
      { value: 'decrease_pct', label: 'operations.pctDecrease' },
      { value: 'increase_fixed', label: 'operations.fixedIncrease' },
      { value: 'decrease_fixed', label: 'operations.fixedDecrease' },
      { value: 'set_price', label: 'operations.setPrice' },
    ],
  },
  {
    key: 'quantity', label: 'fields.quantity', group: 'groups.inventory',
    icon: <InventoryIcon fontSize="small" />,
    operations: [
      { value: 'set_quantity', label: 'operations.setQuantity' },
      { value: 'increase_fixed', label: 'operations.increase' },
      { value: 'decrease_fixed', label: 'operations.decrease' },
    ],
  },
  // Shipping
  {
    key: 'processing_time', label: 'fields.processingTime', group: 'groups.shipping',
    icon: <ScheduleIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.setTime' }],
  },
  {
    key: 'shipping_profile', label: 'fields.shippingProfile', group: 'groups.shipping',
    icon: <ShippingIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.setProfile' }],
  },
  {
    key: 'item_weight', label: 'fields.itemWeight', group: 'groups.shipping',
    icon: <WeightIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.setWeight' }],
  },
  {
    key: 'item_size', label: 'fields.itemSize', group: 'groups.shipping',
    icon: <SizeIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.setSize' }],
  },
  {
    key: 'return_policy', label: 'fields.returnPolicy', group: 'groups.shipping',
    icon: <ReturnIcon fontSize="small" />,
    operations: [{ value: 'set_value', label: 'operations.setPolicy' }],
  },
];

const GROUPS = ['groups.media', 'groups.listings', 'groups.inventory', 'groups.shipping'];

const WHO_MADE_OPTIONS = [
  { value: 'i_did', label: 'whoMade.iDid' },
  { value: 'collective', label: 'whoMade.collective' },
  { value: 'someone_else', label: 'whoMade.someoneElse' },
];

const WHEN_MADE_OPTIONS = [
  { value: 'made_to_order', label: 'whenMade.madeToOrder' },
  { value: '2020_2025', label: 'whenMade.2020_2025' },
  { value: '2010_2019', label: 'whenMade.2010_2019' },
  { value: '2004_2009', label: 'whenMade.2004_2009' },
  { value: 'before_2004', label: 'whenMade.before2004' },
];

const WEIGHT_UNITS = ['oz', 'lb', 'g', 'kg'];
const DIMENSION_UNITS = ['in', 'ft', 'mm', 'cm'];

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function callUpdateListing(shopId: string, listingId: number, body: Record<string, any>, queuedActions?: Array<Record<string, any>>) {
  await stageEtsyDraft({ shopId, listingId, fields: body, queuedActions });
  return { ok: true, json: async () => ({ success: true }) } as Response;
}

async function callSetSimplePersonalization(
  shopId: string,
  listingId: number,
  changes: Pick<PendingChange, 'personalization_is_required' | 'personalization_instructions' | 'personalization_char_count_max'>
) {
  await stageEtsyDraft({
    shopId,
    listingId,
    personalization: {
      personalization_questions: [{
        question_type: 'text_input',
        question_text: 'Personalization',
        required: changes.personalization_is_required || false,
        instructions: changes.personalization_instructions || '',
        max_allowed_characters: changes.personalization_char_count_max || 256,
      }],
    },
  });
  return { ok: true, json: async () => ({ success: true }) } as Response;
}

async function callRemovePersonalization(shopId: string, listingId: number) {
  await stageEtsyDraft({ shopId, listingId, personalization: { remove: true } });
  return { ok: true, json: async () => ({ success: true }) } as Response;
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
  const t = useTranslations('etsy.bulkEditor');
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
        placeholder={t("inlineEditor.tagsPlaceholder")}
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
        {t('inlineEditor.remaining', { count: remaining })}
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
                  <Typography component="span" variant="caption" sx={{ opacity: 0.6, fontSize: '0.82rem', ml: 0.3 }}>
                    {tag.length}
                  </Typography>
                </Box>
              }
              size="small"
              color={tooLong ? 'error' : 'default'}
              onDelete={() => onChange(tags.filter((_, idx) => idx !== i))}
              sx={{
                height: 28,
                fontSize: '0.875rem',
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
  const t = useTranslations('etsy.bulkEditor');
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
        placeholder={t("inlineEditor.materialsPlaceholder")}
        value={inputVal}
        onChange={(e) => setInputVal(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={handleAdd}
        sx={{ mb: 0.5, '& .MuiInputBase-input': { fontSize: '0.82rem' } }}
      />
      <Typography variant="caption" color={remaining <= 0 ? 'error' : 'text.secondary'}>
        {t('inlineEditor.remaining', { count: remaining })}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
        {materials.map((mat, i) => (
          <Chip
            key={`${mat}-${i}`}
            label={mat}
            size="small"
            onDelete={() => onChange(materials.filter((_, idx) => idx !== i))}
            sx={{ height: 26, fontSize: '0.875rem' }}
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
  const t = useTranslations('etsy.bulkEditor');

  // Navigation
  const [activeField, setActiveField] = useState<FieldCategory>('title');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Search within selected listings
  const [searchTerm, setSearchTerm] = useState('');

  // Bulk action bar visibility
  const [showBulkActions, setShowBulkActions] = useState(false);

  // Operation state
  const [operation, setOperation] = useState<OperationType>('');
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

  // Personalization fields
  const [isPersonalizable, setIsPersonalizable] = useState(false);
  const [personalizationRequired, setPersonalizationRequired] = useState(false);
  const [personalizationInstructions, setPersonalizationInstructions] = useState('');
  const [personalizationCharMax, setPersonalizationCharMax] = useState('');
  const taxonomyGroups = useMemo(() => {
    const groups = new Map<number, SelectedListing[]>();
    listings.forEach((listing) => {
      if (!listing.taxonomy_id) return;
      const group = groups.get(listing.taxonomy_id) || [];
      group.push(listing);
      groups.set(listing.taxonomy_id, group);
    });
    return Array.from(groups.entries()).map(([taxonomyId, groupListings]) => ({ taxonomyId, listings: groupListings }));
  }, [listings]);
  const [selectedTaxonomyGroup, setSelectedTaxonomyGroup] = useState<number | ''>('');
  const [bulkTaxonomyProperties, setBulkTaxonomyProperties] = useState<Record<number, TaxonomyProperty[]>>({});
  const [bulkTaxonomyLoading, setBulkTaxonomyLoading] = useState(false);
  const [bulkTaxonomyDraft, setBulkTaxonomyDraft] = useState<Record<number, ListingPropertyPatch>>({});
  const [taxonomyOptions, setTaxonomyOptions] = useState<FlatTaxonomy[]>([]);
  const [taxonomyLoading, setTaxonomyLoading] = useState(false);
  const [selectedBulkTaxonomy, setSelectedBulkTaxonomy] = useState<FlatTaxonomy | null>(null);

  // Photo bulk upload
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoMode, setPhotoMode] = useState<'append' | 'replace_all'>('append');
  const [photoUploading, setPhotoUploading] = useState(false);
  const [photoProgress, setPhotoProgress] = useState(0);
  const [listingImagesById, setListingImagesById] = useState<Record<number, ListingImage[]>>({});
  const [listingImagesLoading, setListingImagesLoading] = useState(false);
  const [draggingBulkImage, setDraggingBulkImage] = useState<{ listingId: number; imageId: number } | null>(null);
  const [bulkPreview, setBulkPreview] = useState<{ listing: SelectedListing; image: ListingImage } | null>(null);
  const [bulkPreviewLoaded, setBulkPreviewLoaded] = useState(false);
  const [bulkAltText, setBulkAltText] = useState('');
  const [savingBulkAlt, setSavingBulkAlt] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const bulkPendingObjectUrlsRef = useRef<string[]>([]);
  // Latest images map + in-flight tracking so image loading has a stable identity
  // (avoids re-running the loader effect on every incremental state commit).
  const listingImagesByIdRef = useRef<Record<number, ListingImage[]>>(listingImagesById);
  const inFlightImagesRef = useRef<Set<number>>(new Set());
  useEffect(() => { listingImagesByIdRef.current = listingImagesById; }, [listingImagesById]);

  useEffect(() => () => {
    bulkPendingObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const applyPhotoFiles = useCallback((files: File[]) => {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const validFiles = files.filter((file) => validTypes.includes(file.type));
    if (validFiles.length !== files.length) {
      toast.error(t('photos.unsupportedFiles'));
    }
    setPhotoFiles(validFiles.slice(0, 10));
  }, [t]);

  // Video bulk
  const [videoUrl, setVideoUrl] = useState('');
  const [videoUploading, setVideoUploading] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);

  // Create section
  const [newSectionName, setNewSectionName] = useState('');
  const [creatingSec, setCreatingSec] = useState(false);
  const [localSections, setLocalSections] = useState<ShopSection[]>([]);
  const [stagedSectionPayloads, setStagedSectionPayloads] = useState<Record<number, { title: string }>>({});
  const allSections = useMemo(() => {
    const ids = new Set(shopSections.map(s => s.shop_section_id));
    return [...shopSections, ...localSections.filter(s => !ids.has(s.shop_section_id))];
  }, [shopSections, localSections]);

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
  const [aiLoadingId, setAiLoadingId] = useState<number | null>(null);

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

  const refreshListingImages = useCallback(async (listingIds: number[], force = false) => {
    const current = listingImagesByIdRef.current;
    const missing = Array.from(new Set(listingIds))
      .filter(id => (force ? true : current[id] === undefined))
      // Skip listings whose images are already being fetched by another run.
      .filter(id => !inFlightImagesRef.current.has(id));
    if (missing.length === 0) return;

    missing.forEach(id => inFlightImagesRef.current.add(id));
    setListingImagesLoading(true);

    const fetchOne = async (listingId: number): Promise<ListingImage[]> => {
      try {
        const res = await fetch(
          `/api/clawd/etsy?action=get_listing_images&listing_id=${listingId}&shop_id=${shopId}`
        );
        if (!res.ok) return [];
        const data = await res.json();
        const images = data.images || data.results || [];
        return images
          .map((img: any) => ({
            listing_image_id: Number(img.listing_image_id) || 0,
            url_75x75: img.url_75x75,
            url_170x135: img.url_170x135,
            url_570xN: img.url_570xN,
            url_fullxfull: img.url_fullxfull,
            rank: Number(img.rank) || 0,
            alt_text: img.alt_text || '',
          }))
          .filter((img: ListingImage) => img.listing_image_id)
          .sort((a: ListingImage, b: ListingImage) => a.rank - b.rank);
      } catch {
        return [];
      }
    };

    // Load in parallel with a small concurrency cap, committing each listing's
    // images to state as soon as they arrive so thumbnails appear immediately
    // instead of only after every listing has been fetched.
    const CONCURRENCY = 6;
    let cursor = 0;
    const worker = async () => {
      while (cursor < missing.length) {
        const listingId = missing[cursor++];
        const imgs = await fetchOne(listingId);
        setListingImagesById(prev => {
          // Preserve any pending (staged, not-yet-synced) uploads for this listing.
          const pending = (prev[listingId] || []).filter(img => img.is_pending_upload);
          return { ...prev, [listingId]: [...imgs, ...pending] };
        });
        inFlightImagesRef.current.delete(listingId);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker)
    );

    if (inFlightImagesRef.current.size === 0) setListingImagesLoading(false);
  }, [shopId]);

  useEffect(() => {
    if (!open || activeField !== 'photos') return;

    let cancelled = false;
    const loadImages = async () => {
      if (!cancelled) {
        await refreshListingImages(filteredListings.map(l => l.listing_id));
      }
    };

    loadImages();
    return () => { cancelled = true; };
  }, [open, activeField, filteredListings, refreshListingImages]);

  // Fields with no per-row inline editing can ONLY be edited from the bulk action
  // bar, so auto-expand it when the user switches to one (e.g. Photos/Videos) —
  // otherwise the upload/add controls stay hidden behind the collapsed toggle.
  useEffect(() => {
    const noInlineFields: FieldCategory[] = [
      'photos', 'videos', 'about', 'category', 'personalization', 'processing_time',
      'shipping_profile', 'item_weight', 'item_size', 'return_policy', 'state', 'variations',
    ];
    if (noInlineFields.includes(activeField)) setShowBulkActions(true);
  }, [activeField]);

  const pendingCount = pendingChanges.size;

  useEffect(() => {
    if (activeField !== 'etsy_details') return;
    if (taxonomyGroups.length > 0 && selectedTaxonomyGroup === '') {
      setSelectedTaxonomyGroup(taxonomyGroups[0].taxonomyId);
    }
  }, [activeField, selectedTaxonomyGroup, taxonomyGroups]);

  useEffect(() => {
    if (!open || activeField !== 'category' || taxonomyOptions.length > 0 || taxonomyLoading) return;
    let cancelled = false;
    setTaxonomyLoading(true);
    fetch(`/api/clawd/etsy?action=taxonomy&shop_id=${shopId}`)
      .then((res) => res.ok ? res.json() : { categories: [] })
      .then((data) => {
        if (cancelled) return;
        const nodes: TaxonomyNode[] = data.categories || data.results || data || [];
        setTaxonomyOptions(flattenTaxonomy(Array.isArray(nodes) ? nodes : []));
      })
      .catch(() => {
        if (!cancelled) setTaxonomyOptions([]);
      })
      .finally(() => {
        if (!cancelled) setTaxonomyLoading(false);
      });
    return () => { cancelled = true; };
  }, [activeField, open, shopId, taxonomyLoading, taxonomyOptions.length]);

  useEffect(() => {
    if (activeField !== 'etsy_details' || selectedTaxonomyGroup === '') return;
    const taxonomyId = Number(selectedTaxonomyGroup);
    if (bulkTaxonomyProperties[taxonomyId]) return;

    let cancelled = false;
    setBulkTaxonomyLoading(true);
    fetch(`/api/clawd/etsy?action=get_taxonomy_properties&taxonomy_id=${taxonomyId}&shop_id=${shopId}`)
      .then((res) => res.ok ? res.json() : { results: [] })
      .then((data) => {
        if (cancelled) return;
        setBulkTaxonomyProperties((prev) => ({ ...prev, [taxonomyId]: data.results || [] }));
      })
      .catch(() => {
        if (!cancelled) setBulkTaxonomyProperties((prev) => ({ ...prev, [taxonomyId]: [] }));
      })
      .finally(() => {
        if (!cancelled) setBulkTaxonomyLoading(false);
      });

    return () => { cancelled = true; };
  }, [activeField, bulkTaxonomyProperties, selectedTaxonomyGroup, shopId]);

  // Reset only when the SET of listing IDs actually changes (not on every parent re-render).
  // Using listings reference directly would clear pendingChanges whenever parent re-renders
  // with a new memoized array (common with filters, health maps, status counts).
  const listingIdsKey = useMemo(
    () => listings.map(l => l.listing_id).sort((a, b) => a - b).join(','),
    [listings]
  );
  useEffect(() => {
    setCheckedIds(new Set(listings.map(l => l.listing_id)));
    setPendingChanges(new Map());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingIdsKey]);

  // Reset operation when field changes
  const handleFieldChange = useCallback((field: FieldCategory) => {
    setActiveField(field);
    const def = FIELD_DEFS.find(f => f.key === field)!;
    setOperation('');
    setInputValue('');
    setSelectedBulkTaxonomy(null);
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
      case 'variations': return null; // Variations are managed independently via VariationEditor
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

  const updateBulkTaxonomyProperty = useCallback((propertyId: number, selected: TaxonomyOption[]) => {
    setBulkTaxonomyDraft((prev) => ({
      ...prev,
      [propertyId]: {
        ...(prev[propertyId] || { property_id: propertyId, values: [] }),
        property_id: propertyId,
        values: selected.map((option) => option.name),
        value_ids: selected.map((option) => option.value_id).filter((id): id is number => typeof id === 'number'),
      },
    }));
  }, []);

  const updateBulkTaxonomyScale = useCallback((propertyId: number, scaleId: number | null) => {
    setBulkTaxonomyDraft((prev) => ({
      ...prev,
      [propertyId]: {
        ...(prev[propertyId] || { property_id: propertyId, values: [] }),
        property_id: propertyId,
        scale_id: scaleId,
      },
    }));
  }, []);

  // Apply bulk operation to all checked listings
  const handleApply = useCallback(() => {
    if (!operation) {
      toast.error(t('toast.noOperationSelected'));
      return;
    }
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) {
      toast.error(t('toast.noListingsSelected'));
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
            case 'find_replace': newVal = newVal.replace(new RegExp(findValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replaceValue); break;
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
        case 'personalization': {
          updatePending(listing.listing_id, {
            is_personalizable: isPersonalizable,
            personalization_is_required: personalizationRequired,
            personalization_instructions: personalizationInstructions || undefined,
            personalization_char_count_max: personalizationCharMax ? parseInt(personalizationCharMax) : undefined,
          });
          break;
        }
        case 'category': {
          const tid = selectedBulkTaxonomy?.id || parseInt(inputValue);
          if (!isNaN(tid) && tid > 0) {
            updatePending(listing.listing_id, { taxonomy_id: tid });
          }
          break;
        }
        case 'etsy_details': {
          if (selectedTaxonomyGroup === '' || listing.taxonomy_id !== Number(selectedTaxonomyGroup)) break;
          const patches = Object.values(bulkTaxonomyDraft);
          if (patches.length > 0) {
            updatePending(listing.listing_id, { taxonomyProperties: patches });
          }
          break;
        }
      }
    });

    toast.success(t('toast.appliedToListings', { count: checked.length }));
  }, [filteredListings, checkedIds, activeField, operation, inputValue, findValue, replaceValue, tagsInput,
      targetSectionId, getFieldValue, updatePending, whoMade, whenMade, isSupply,
      weightValue, weightUnit, lengthValue, widthValue, heightValue, dimensionUnit,
      processingMin, processingMax, selectedShippingProfileId, selectedReturnPolicyId,
      isPersonalizable, personalizationRequired, personalizationInstructions, personalizationCharMax,
      selectedTaxonomyGroup, selectedBulkTaxonomy, bulkTaxonomyDraft]);

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

      toast.success(t('toast.aiOptimized', { count: optimized.length }));
    } catch (err: any) {
      toast.error(err.message || t('toast.aiOptimizeFailed'));
    } finally {
      setAiProcessing(false);
      setAiProgress(0);
      setAiInstructions('');
    }
  }, [filteredListings, checkedIds, activeField, aiInstructions, getFieldValue, updatePending]);

  // Single-listing AI magic wand
  const handleSingleListingAI = useCallback(async (listing: SelectedListing, field: 'title' | 'description' | 'tags') => {
    if (aiLoadingId) return; // already processing
    setAiLoadingId(listing.listing_id);

    try {
      const title = getFieldValue(listing, 'title') as string;
      const tags = getFieldValue(listing, 'tags') as string[];
      const description = getFieldValue(listing, 'description') as string;
      const materials = listing.materials || [];

      if (field === 'title') {
        const res = await fetch('/api/ai/etsy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'optimize_title', title, description, tags }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'AI failed');
        const data = await res.json();
        if (data.optimized_title) {
          updatePending(listing.listing_id, { title: data.optimized_title });
          toast.success(t('toast.aiSingleDone'));
        }
      } else if (field === 'description') {
        const res = await fetch('/api/ai/etsy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'generate_description', title, tags, materials, existing_description: description }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'AI failed');
        const data = await res.json();
        if (data.description) {
          updatePending(listing.listing_id, { description: data.description });
          toast.success(t('toast.aiSingleDone'));
        }
      } else if (field === 'tags') {
        const res = await fetch('/api/ai/etsy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'suggest_tags', title, description, tags_current: tags }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'AI failed');
        const data = await res.json();
        if (data.suggestions && Array.isArray(data.suggestions)) {
          updatePending(listing.listing_id, { tags: data.suggestions });
          toast.success(t('toast.aiSingleDone'));
        }
      }
    } catch (err: any) {
      toast.error(err.message || t('toast.aiOptimizeFailed'));
    } finally {
      setAiLoadingId(null);
    }
  }, [aiLoadingId, getFieldValue, updatePending]);

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
            await stageEtsyDraft({
              shopId,
              listingId: listing.listing_id,
              media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: img.listing_image_id, altText }],
            });
          } catch { ok = false; }
        }
        if (ok) success++; else failed++;
      } catch { failed++; }
      setAiProgress(Math.round(((i + 1) / checked.length) * 100));
    }

    setAiProcessing(false);
    if (failed === 0) toast.success(t('toast.altTextSuccess', { count: success }));
    else toast.error(t('toast.altTextPartial', { success, failed }));
  }, [filteredListings, checkedIds, shopId]);

  const deleteListingImages = useCallback(async (listingId: number): Promise<boolean> => {
    const imagesRes = await fetch(
      `/api/clawd/etsy?action=get_listing_images&listing_id=${listingId}&shop_id=${shopId}`
    );
    if (!imagesRes.ok) return false;
    const imagesData = await imagesRes.json();
    const images = imagesData.images || imagesData.results || [];

    let ok = true;
    for (const img of images) {
      try {
        await stageEtsyDraft({
          shopId,
          listingId,
          media: [{ kind: 'image', operation: 'delete', etsyMediaId: img.listing_image_id }],
        });
      } catch {
        ok = false;
      }
    }
    return ok;
  }, [shopId]);

  // Bulk photo upload to all checked listings
  const handleBulkPhotoUpload = useCallback(async () => {
    if (photoFiles.length === 0) return;
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) return;
    if (photoMode === 'replace_all' && !confirm(t('confirm.replaceAllPhotos', { count: checked.length }))) return;

    setPhotoUploading(true);
    setPhotoProgress(0);
    let success = 0, failed = 0;
    const total = checked.length * (photoFiles.length + (photoMode === 'replace_all' ? 1 : 0));
    let done = 0;

    for (const listing of checked) {
      if (photoMode === 'replace_all') {
        try {
          const deleted = await deleteListingImages(listing.listing_id);
          if (!deleted) failed++;
        } catch {
          failed++;
        }
        done++;
        setPhotoProgress(Math.round((done / total) * 100));
      }

      for (let i = 0; i < photoFiles.length; i++) {
        const file = photoFiles[i];
        try {
          await stageEtsyDraftFile({
            shopId,
            listingId: listing.listing_id,
            file,
            kind: 'image',
            operation: 'upload',
            rank: i + 1,
          });
          const objectUrl = URL.createObjectURL(file);
          bulkPendingObjectUrlsRef.current.push(objectUrl);
          setListingImagesById(prev => {
            const current = prev[listing.listing_id] || [];
            const base = photoMode === 'replace_all' ? current.filter(img => img.is_pending_upload) : current;
            const pendingImage: ListingImage = {
              listing_image_id: -Date.now() - i - listing.listing_id,
              url_75x75: objectUrl,
              url_170x135: objectUrl,
              url_570xN: objectUrl,
              url_fullxfull: objectUrl,
              rank: base.length + 1,
              is_pending_upload: true,
              pending_filename: file.name,
            };
            return {
              ...prev,
              [listing.listing_id]: [...base, pendingImage].map((img, index) => ({ ...img, rank: index + 1 })),
            };
          });
          success++;
        } catch { failed++; }
        done++;
        setPhotoProgress(Math.round((done / total) * 100));
        if (done < total) await new Promise(r => setTimeout(r, 150));
      }
    }

    setPhotoUploading(false);
    setPhotoFiles([]);
    if (photoInputRef.current) photoInputRef.current.value = '';

    if (failed === 0) toast.success(t('toast.photoUploadSuccess', { count: success, listings: checked.length }));
    else toast.error(t('toast.photoUploadPartial', { success, failed }));
    onCompleted();
  }, [photoFiles, photoMode, filteredListings, checkedIds, shopId, onCompleted, t, deleteListingImages]);

  const handleBulkImageDrop = useCallback(async (listing: SelectedListing, targetImageId: number) => {
    if (!draggingBulkImage || draggingBulkImage.listingId !== listing.listing_id || draggingBulkImage.imageId === targetImageId) {
      setDraggingBulkImage(null);
      return;
    }
    if (draggingBulkImage.imageId < 0 || targetImageId < 0) {
      toast.error('Pending uploads can be reordered after they are synced to Etsy.');
      setDraggingBulkImage(null);
      return;
    }

    const currentImages = listingImagesById[listing.listing_id] || [];
    const fromIndex = currentImages.findIndex(img => img.listing_image_id === draggingBulkImage.imageId);
    const toIndex = currentImages.findIndex(img => img.listing_image_id === targetImageId);
    if (fromIndex < 0 || toIndex < 0) {
      setDraggingBulkImage(null);
      return;
    }

    const nextImages = [...currentImages];
    const [moved] = nextImages.splice(fromIndex, 1);
    nextImages.splice(toIndex, 0, moved);
    setListingImagesById(prev => ({ ...prev, [listing.listing_id]: nextImages.map((img, idx) => ({ ...img, rank: idx + 1 })) }));

    setPhotoUploading(true);
    setPhotoProgress(0);
    try {
      for (let i = 0; i < nextImages.length; i++) {
        const img = nextImages[i];
        const nextRank = i + 1;
        if (img.rank === nextRank) continue;
        await stageEtsyDraft({
          shopId,
          listingId: listing.listing_id,
          media: [{ kind: 'image', operation: 'reorder', etsyMediaId: img.listing_image_id, rank: nextRank }],
        });
        setPhotoProgress(Math.round(((i + 1) / nextImages.length) * 100));
      }
      toast.success('Photo order saved to draft. Sync to Etsy when ready.');
      onCompleted();
    } catch (err: any) {
      toast.error(err.message || t('photos.orderSaveFailed'));
      await refreshListingImages([listing.listing_id], true);
    } finally {
      setPhotoUploading(false);
      setPhotoProgress(0);
      setDraggingBulkImage(null);
    }
  }, [draggingBulkImage, listingImagesById, shopId, t, refreshListingImages, onCompleted]);

  const openBulkPreview = (listing: SelectedListing, image: ListingImage) => {
    setBulkPreviewLoaded(false);
    setBulkPreview({ listing, image });
    setBulkAltText(image.alt_text || '');
  };

  const closeBulkPreview = () => {
    setBulkPreview(null);
    setBulkPreviewLoaded(false);
  };

  const handleSaveBulkAltText = async () => {
    if (!bulkPreview) return;
    if (bulkPreview.image.is_pending_upload) {
      toast.error('Pending uploads can be edited after they are synced to Etsy.');
      return;
    }
    setSavingBulkAlt(true);
    try {
      await stageEtsyDraft({
        shopId,
        listingId: bulkPreview.listing.listing_id,
        media: [{ kind: 'image', operation: 'update_alt', etsyMediaId: bulkPreview.image.listing_image_id, altText: bulkAltText.trim() }],
      });
      toast.success('Alt text saved to draft. Sync to Etsy when ready.');
      await refreshListingImages([bulkPreview.listing.listing_id], true);
      setBulkPreview(null);
    } catch (err: any) {
      toast.error(err.message || t('photos.altTextSaveFailed'));
    } finally {
      setSavingBulkAlt(false);
    }
  };

  // Bulk video upload (by URL) to all checked listings
  const handleBulkVideoUpload = useCallback(async () => {
    if (!videoUrl.trim()) return;
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) return;

    setVideoUploading(true);
    setVideoProgress(0);
    let success = 0, failed = 0;

    for (let i = 0; i < checked.length; i++) {
      const listing = checked[i];
      try {
        await stageEtsyDraft({
          shopId,
          listingId: listing.listing_id,
          media: [{ kind: 'video', operation: 'upload', sourceUrl: videoUrl.trim() }],
        });
        success++;
      } catch { failed++; }
      setVideoProgress(Math.round(((i + 1) / checked.length) * 100));
      if (i < checked.length - 1) await new Promise(r => setTimeout(r, 200));
    }

    setVideoUploading(false);
    setVideoUrl('');
    if (failed === 0) toast.success(t('toast.videoUploadSuccess', { count: success }));
    else toast.error(t('toast.videoUploadPartial', { success, failed }));
    onCompleted();
  }, [videoUrl, filteredListings, checkedIds, shopId, onCompleted]);

  // Bulk delete all videos from checked listings
  const handleBulkVideoDelete = useCallback(async () => {
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) return;
    if (!confirm(t('confirm.deleteAllVideos', { count: checked.length }))) return;

    setVideoUploading(true);
    setVideoProgress(0);
    let success = 0, failed = 0;

    for (let i = 0; i < checked.length; i++) {
      const listing = checked[i];
      try {
        const videosRes = await fetch(
          `/api/clawd/etsy?action=get_listing_videos&listing_id=${listing.listing_id}&shop_id=${shopId}`
        );
        if (!videosRes.ok) { failed++; continue; }
        const videosData = await videosRes.json();
        const videos = videosData.videos || [];

        let ok = true;
        for (const vid of videos) {
          try {
            await stageEtsyDraft({
              shopId,
              listingId: listing.listing_id,
              media: [{ kind: 'video', operation: 'delete', etsyMediaId: vid.video_id }],
            });
          } catch { ok = false; }
        }
        if (ok) success++; else failed++;
      } catch { failed++; }
      setVideoProgress(Math.round(((i + 1) / checked.length) * 100));
      if (i < checked.length - 1) await new Promise(r => setTimeout(r, 100));
    }

    setVideoUploading(false);
    if (failed === 0) toast.success(t('toast.videoDeleteSuccess', { count: success }));
    else toast.error(t('toast.videoDeletePartial', { success, failed }));
    onCompleted();
  }, [filteredListings, checkedIds, shopId, onCompleted]);

  // Create a new shop section
  const handleCreateSection = useCallback(async () => {
    if (!newSectionName.trim()) return;
    setCreatingSec(true);
    try {
      const tempId = -Date.now();
      const newSection: ShopSection = {
        shop_section_id: tempId,
        title: `${newSectionName.trim()} (pending)`,
      };
      setStagedSectionPayloads(prev => ({ ...prev, [tempId]: { title: newSectionName.trim() } }));
      setLocalSections(prev => [...prev, newSection]);
      setTargetSectionId(newSection.shop_section_id);
      setNewSectionName('');
      toast.success('Shop section will be created when drafts sync to Etsy.');
    } catch {
      toast.error(t('toast.sectionCreateFailed'));
    } finally {
      setCreatingSec(false);
    }
  }, [newSectionName, t]);

  // Save all pending changes to local Etsy drafts. Explicit sync writes drafts to Etsy later.
  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) {
      toast(t('toast.noChangesToSave'));
      return;
    }

    setSaving(true);
    setSaveProgress(0);

    const entries = Array.from(pendingChanges.entries());
    let success = 0;
    let failed = 0;
    const failedIds: number[] = [];

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
        if (changes.taxonomy_id !== undefined) body.taxonomy_id = changes.taxonomy_id;
        const taxonomyProperties = changes.taxonomyProperties;

        let personalizationOk = true;
        if (changes.is_personalizable !== undefined) {
          const personalizationRes = changes.is_personalizable
            ? await callSetSimplePersonalization(shopId, listingId, changes)
            : await callRemovePersonalization(shopId, listingId);
          personalizationOk = personalizationRes.ok;
          if (!personalizationOk) {
            const errBody = await personalizationRes.json().catch(() => ({ error: personalizationRes.statusText }));
            console.error(`[BulkEditor] Failed to update personalization for listing ${listingId}:`, errBody);
          }
        }

        let listingOk = true;
        if (Object.keys(body).length > 0) {
          const queuedActions: Array<Record<string, any>> = [];
          if (typeof body.shop_section_id === 'number' && body.shop_section_id < 0) {
            const staged = stagedSectionPayloads[body.shop_section_id];
            if (staged) {
              queuedActions.push({ type: 'create_shop_section', tempId: body.shop_section_id, payload: staged });
            }
          }
          const listingRes = await callUpdateListing(shopId, listingId, body, queuedActions.length ? queuedActions : undefined);
          listingOk = listingRes.ok;
          if (!listingOk) {
            const errBody = await listingRes.json().catch(() => ({ error: listingRes.statusText }));
            console.error(`[BulkEditor] Failed to update listing ${listingId}:`, errBody);
          }
        }
        if (taxonomyProperties && taxonomyProperties.length > 0) {
          await stageEtsyDraft({ shopId, listingId, taxonomy: { properties: taxonomyProperties } });
        }

        if (personalizationOk && listingOk) {
          success++;
        } else {
          failedIds.push(listingId);
          failed++;
        }
      } catch (err) {
        console.error(`[BulkEditor] Exception updating listing ${listingId}:`, err);
        failedIds.push(listingId);
        failed++;
      }
      setSaveProgress(Math.round(((i + 1) / entries.length) * 100));
      if (i < entries.length - 1) await new Promise(r => setTimeout(r, 100));
    }

    setSaving(false);

    if (failed === 0) {
      toast.success(t('toast.saveSuccess', { count: success }));
      setPendingChanges(new Map());
      setStagedSectionPayloads({});
      onCompleted();
    } else {
      // Keep only failed listings in pendingChanges so user can retry
      const remainingChanges = new Map<number, any>();
      for (const id of failedIds) {
        const c = pendingChanges.get(id);
        if (c) remainingChanges.set(id, c);
      }
      setPendingChanges(remainingChanges);
      toast.error(t('toast.savePartial', { success, failed }));
    }
  }, [pendingChanges, shopId, onCompleted, stagedSectionPayloads]);

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
      if (!confirm(t('confirm.unsavedChanges', { count: pendingChanges.size }))) return;
    }
    setPendingChanges(new Map());
    onClose();
  }, [pendingChanges, onClose]);

  // Discard all pending changes
  const handleDiscard = useCallback(() => {
    setPendingChanges(new Map());
    toast.success(t('toast.allChangesDiscarded'));
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
                sx={{ color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.82rem' }}
              >
                {t(group)}
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
                  else if (key === 'personalization' && change.is_personalizable !== undefined) fieldChangeCount++;
                  else if (key === 'category' && change.taxonomy_id !== undefined) fieldChangeCount++;
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
                      primary={t(field.label)}
                      primaryTypographyProps={{
                        fontSize: '0.82rem',
                        fontWeight: isActive ? 700 : 500,
                      }}
                    />
                    {fieldChangeCount > 0 && (
                      <Badge
                        badgeContent={fieldChangeCount}
                        color="primary"
                        sx={{ '& .MuiBadge-badge': { fontSize: '0.8rem', height: 16, minWidth: 16 } }}
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
         'shipping_profile', 'item_weight', 'item_size', 'return_policy', 'state', 'variations'].includes(activeField)) {
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
            displayEmpty
            onChange={(e) => setOperation(e.target.value as OperationType)}
            sx={{
              fontSize: '0.85rem', fontWeight: 600,
              bgcolor: isAI ? 'rgba(139,92,246,0.08)' : 'primary.50',
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: isAI ? 'rgba(139,92,246,0.3)' : undefined,
              },
            }}
          >
            <MenuItem value="" disabled>
              <span style={{ color: '#9e9e9e' }}>{t('actionBar.selectOperation')}</span>
            </MenuItem>
            {ops.map(op => (
              <MenuItem key={op.value} value={op.value}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                  {(op.value === 'ai_rewrite' || op.value === 'ai_optimize') && (
                    <AIIcon sx={{ fontSize: 16, color: '#8b5cf6' }} />
                  )}
                  <span>{t(op.label)}</span>
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Input fields based on operation */}
        {isAI ? (
          <TextField
            size="small"
            placeholder={t("actionBar.additionalInstructions")}
            value={aiInstructions}
            onChange={(e) => setAiInstructions(e.target.value)}
            sx={{ flex: 1, minWidth: 150 }}
          />
        ) : isFindReplace ? (
          <>
            <TextField
              size="small"
              placeholder={t("actionBar.find")}
              value={findValue}
              onChange={(e) => setFindValue(e.target.value)}
              sx={{ flex: 1, minWidth: 100 }}
              InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 16 }} /></InputAdornment> }}
            />
            <SwapIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
            <TextField
              size="small"
              placeholder={t("actionBar.replaceWith")}
              value={replaceValue}
              onChange={(e) => setReplaceValue(e.target.value)}
              sx={{ flex: 1, minWidth: 100 }}
            />
          </>
        ) : (activeField === 'tags' || activeField === 'materials') ? (
          <TextField
            size="small"
            placeholder={t("actionBar.commaSeparated", { field: t(fieldDef.label) })}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
            sx={{ flex: 1, minWidth: 150 }}
          />
        ) : activeField === 'section' ? (
          <>
            <FormControl size="small" sx={{ minWidth: 200 }}>
              <Select
                value={targetSectionId}
                onChange={(e) => setTargetSectionId(e.target.value as number)}
                displayEmpty
                sx={{ fontSize: '0.85rem' }}
              >
                <MenuItem value="" disabled>{t("actionBar.selectSection")}</MenuItem>
                {allSections.map(s => (
                  <MenuItem key={s.shop_section_id} value={s.shop_section_id}>{s.title}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <Divider orientation="vertical" flexItem />
            <TextField
              size="small"
              placeholder={t("section.newSectionPlaceholder")}
              value={newSectionName}
              onChange={(e) => setNewSectionName(e.target.value)}
              sx={{ minWidth: 140 }}
              disabled={creatingSec}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={creatingSec ? <CircularProgress size={14} /> : <AddIcon />}
              onClick={handleCreateSection}
              disabled={creatingSec || !newSectionName.trim()}
              sx={{ minHeight: 40, textTransform: 'none', fontWeight: 600, borderRadius: '8px', whiteSpace: 'nowrap' }}
            >
              {t("section.createBtn")}
            </Button>
          </>
        ) : activeField === 'etsy_details' ? (
          <FormControl size="small" sx={{ minWidth: 260 }}>
            <InputLabel>Category group</InputLabel>
            <Select
              value={selectedTaxonomyGroup}
              label="Category group"
              onChange={(e) => {
                setSelectedTaxonomyGroup(e.target.value as number);
                setBulkTaxonomyDraft({});
              }}
            >
              {taxonomyGroups.map((group) => (
                <MenuItem key={group.taxonomyId} value={group.taxonomyId}>
                  {group.taxonomyId} ({group.listings.length} listings)
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : activeField === 'price' ? (
          <TextField
            size="small"
            placeholder={t("actionBar.amount")}
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
            placeholder={t("actionBar.quantityPlaceholder")}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            sx={{ flex: 1, minWidth: 100, maxWidth: 160 }}
            type="number"
          />
        ) : operation !== 'delete' ? (
          <TextField
            size="small"
            placeholder={`${t(fieldDef.label)}...`}
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
          disabled={saving || aiProcessing || !operation}
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
          {aiProcessing ? <CircularProgress size={18} sx={{ color: 'white' }} /> : t('actionBar.apply')}
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
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              {/* Photo upload */}
              <Box
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (photoUploading || aiProcessing) return;
                  applyPhotoFiles(Array.from(e.dataTransfer.files || []));
                }}
                sx={{
                  display: 'flex',
                  gap: 1,
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  p: 1,
                  border: '1px dashed',
                  borderColor: photoFiles.length ? 'primary.main' : 'divider',
                  borderRadius: 1.5,
                  bgcolor: photoFiles.length ? 'primary.50' : 'background.default',
                }}
              >
                <input
                  ref={photoInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  multiple
                  style={{ display: 'none' }}
                  onChange={(e) => applyPhotoFiles(Array.from(e.target.files || []))}
                />
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading || aiProcessing}
                  sx={{ minHeight: 40, textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}
                >
                  {t('photos.selectFiles')}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t('photos.dropToStage')}
                </Typography>
                {photoFiles.length > 0 && (
                  <>
                    <Chip
                      label={t('photos.filesSelected', { count: photoFiles.length })}
                      size="small"
                      onDelete={() => { setPhotoFiles([]); if (photoInputRef.current) photoInputRef.current.value = ''; }}
                    />
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={photoMode}
                      onChange={(_, value) => value && setPhotoMode(value)}
                      disabled={photoUploading}
                    >
                      <ToggleButton value="append" sx={{ px: 1.5, textTransform: 'none' }}>
                        {t('photos.appendMode')}
                      </ToggleButton>
                      <ToggleButton value="replace_all" sx={{ px: 1.5, textTransform: 'none' }}>
                        {t('photos.replaceAllMode')}
                      </ToggleButton>
                    </ToggleButtonGroup>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={photoUploading ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <ImageIcon />}
                      onClick={handleBulkPhotoUpload}
                      disabled={photoUploading}
                      sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
                    >
                      {photoUploading ? `${photoProgress}%` : photoMode === 'replace_all' ? t('photos.replaceAll') : t('photos.uploadToAll')}
                    </Button>
                  </>
                )}
                {photoFiles.length === 0 && (
                  <Button
                    variant="contained"
                    size="small"
                    startIcon={<ImageIcon />}
                    disabled
                    sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
                  >
                    {t('photos.chooseFilesFirst')}
                  </Button>
                )}
              </Box>
              {/* AI alt text */}
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<AIIcon />}
                  onClick={handleBulkAltText}
                  disabled={aiProcessing || photoUploading}
                  sx={{
                    minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                  }}
                >
                  {aiProcessing ? t('photos.aiAltTextProgress', { progress: aiProgress }) : t('photos.aiGenerateAltText')}
                </Button>
                <Typography variant="caption" color="text.secondary">
                  {t("photos.altTextHelper")}
                </Typography>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t('photos.dragPreviewHelper')}
              </Typography>
              {photoUploading && (
                <LinearProgress variant="determinate" value={photoProgress} sx={{ borderRadius: 1 }} />
              )}
            </Box>
          </Paper>
        );

      case 'videos':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                <TextField
                  size="small"
                  placeholder={t('videos.urlPlaceholder')}
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  disabled={videoUploading}
                  sx={{ flex: 1, minWidth: 200 }}
                />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={videoUploading ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <VideoIcon />}
                  onClick={handleBulkVideoUpload}
                  disabled={videoUploading || !videoUrl.trim()}
                  sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
                >
                  {videoUploading ? `${videoProgress}%` : t('videos.uploadToAll')}
                </Button>
                <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
                <Button
                  variant="outlined"
                  size="small"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={handleBulkVideoDelete}
                  disabled={videoUploading}
                  sx={{ minHeight: 40, textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}
                >
                  {t('videos.deleteAll')}
                </Button>
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t("videos.videoHelper")}
              </Typography>
              {videoUploading && (
                <LinearProgress variant="determinate" value={videoProgress} sx={{ borderRadius: 1 }} />
              )}
            </Box>
          </Paper>
        );

      case 'about':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 180 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>{t('aboutSection.whoMadeLabel')}</InputLabel>
                <Select value={whoMade} onChange={e => setWhoMade(e.target.value)} label={t("aboutSection.whoMadeLabel")} sx={{ fontSize: '0.85rem' }}>
                  {WHO_MADE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{t(o.label)}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>{t('aboutSection.whenMadeLabel')}</InputLabel>
                <Select value={whenMade} onChange={e => setWhenMade(e.target.value)} label={t("aboutSection.whenMadeLabel")} sx={{ fontSize: '0.85rem' }}>
                  {WHEN_MADE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{t(o.label)}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControlLabel
                control={<Switch checked={isSupply} onChange={e => setIsSupply(e.target.checked)} size="small" />}
                label={<Typography variant="body2" sx={{ fontSize: '0.82rem' }}>{t('aboutSection.isSupply')}</Typography>}
              />
              <Button
                variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
              >
                {t("actionBar.apply")}
              </Button>
            </Box>
          </Paper>
        );

      case 'processing_time':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" type="number" label={t("processingTime.minDays")} value={processingMin} onChange={e => setProcessingMin(e.target.value)} sx={{ width: 100 }} />
              <Typography variant="body2" color="text.secondary">{t("processingTime.to")}</Typography>
              <TextField size="small" type="number" label={t("processingTime.maxDays")} value={processingMax} onChange={e => setProcessingMax(e.target.value)} sx={{ width: 100 }} />
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                {t("actionBar.apply")}
              </Button>
            </Box>
          </Paper>
        );

      case 'shipping_profile':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 250 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>{t('shippingProfile.label')}</InputLabel>
                <Select
                  value={selectedShippingProfileId}
                  onChange={e => setSelectedShippingProfileId(e.target.value as number)}
                  label={t("shippingProfile.label")}
                  sx={{ fontSize: '0.85rem' }}
                >
                  {shippingProfiles.map(sp => (
                    <MenuItem key={sp.shipping_profile_id} value={sp.shipping_profile_id}>{sp.title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                {t("actionBar.apply")}
              </Button>
            </Box>
          </Paper>
        );

      case 'item_weight':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" type="number" label={t("itemWeight.weightLabel")} value={weightValue} onChange={e => setWeightValue(e.target.value)} sx={{ width: 120 }} />
              <FormControl size="small" sx={{ minWidth: 80 }}>
                <Select value={weightUnit} onChange={e => setWeightUnit(e.target.value)} sx={{ fontSize: '0.85rem' }}>
                  {WEIGHT_UNITS.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                {t("actionBar.apply")}
              </Button>
            </Box>
          </Paper>
        );

      case 'item_size':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <TextField size="small" type="number" label={t("itemSize.lengthLabel")} value={lengthValue} onChange={e => setLengthValue(e.target.value)} sx={{ width: 90 }} />
              <Typography variant="body2" color="text.secondary">{t("itemSize.dimensionSeparator")}</Typography>
              <TextField size="small" type="number" label={t("itemSize.widthLabel")} value={widthValue} onChange={e => setWidthValue(e.target.value)} sx={{ width: 90 }} />
              <Typography variant="body2" color="text.secondary">{t("itemSize.dimensionSeparator")}</Typography>
              <TextField size="small" type="number" label={t("itemSize.heightLabel")} value={heightValue} onChange={e => setHeightValue(e.target.value)} sx={{ width: 90 }} />
              <FormControl size="small" sx={{ minWidth: 70 }}>
                <Select value={dimensionUnit} onChange={e => setDimensionUnit(e.target.value)} sx={{ fontSize: '0.85rem' }}>
                  {DIMENSION_UNITS.map(u => <MenuItem key={u} value={u}>{u}</MenuItem>)}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                {t("actionBar.apply")}
              </Button>
            </Box>
          </Paper>
        );

      case 'return_policy':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <FormControl size="small" sx={{ minWidth: 250 }}>
                <InputLabel sx={{ fontSize: '0.82rem' }}>{t('returnPolicy.label')}</InputLabel>
                <Select
                  value={selectedReturnPolicyId}
                  onChange={e => setSelectedReturnPolicyId(e.target.value as number)}
                  label={t("returnPolicy.label")}
                  sx={{ fontSize: '0.85rem' }}
                >
                  {returnPolicies.map(rp => (
                    <MenuItem key={rp.return_policy_id} value={rp.return_policy_id}>
                      {rp.description || t('returnPolicy.policyFallback', { id: rp.return_policy_id })}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button variant="contained" size="small" onClick={handleApply} disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}>
                {t("actionBar.apply")}
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
                {t("listingState.activateAll")}
              </Button>
              <Button
                variant="outlined" size="small" color="warning"
                onClick={() => { setOperation('deactivate' as OperationType); setTimeout(handleApply, 0); }}
                disabled={saving}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
              >
                {t("listingState.deactivateAll")}
              </Button>
            </Box>
          </Paper>
        );

      case 'category':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
              <Autocomplete
                size="small"
                options={taxonomyOptions}
                getOptionLabel={(option) => option.label}
                value={selectedBulkTaxonomy}
                onChange={(_, value) => {
                  setSelectedBulkTaxonomy(value);
                  setInputValue(value ? String(value.id) : '');
                }}
                loading={taxonomyLoading}
                isOptionEqualToValue={(option, value) => option.id === value.id}
                filterOptions={(options, state) => {
                  const query = state.inputValue.trim().toLowerCase();
                  if (!query) return options.slice(0, 80);
                  return options
                    .filter((option) => option.label.toLowerCase().includes(query) || String(option.id).includes(query))
                    .slice(0, 80);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label={t('categorySection.categoryLabel')}
                    placeholder={t('categorySection.categoryPlaceholder')}
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {taxonomyLoading ? <CircularProgress color="inherit" size={16} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                sx={{ minWidth: { xs: '100%', sm: 420 }, flex: 1 }}
              />
              <TextField
                size="small"
                type="number"
                label={t('categorySection.taxonomyIdLabel')}
                placeholder={t('categorySection.taxonomyIdPlaceholder')}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  if (selectedBulkTaxonomy && String(selectedBulkTaxonomy.id) !== e.target.value) {
                    setSelectedBulkTaxonomy(null);
                  }
                }}
                sx={{ width: 150 }}
              />
              <Button
                variant="contained" size="small" onClick={handleApply} disabled={saving || (!selectedBulkTaxonomy && !inputValue)}
                sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
              >
                {t("actionBar.apply")}
              </Button>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {t('categorySection.taxonomyIdHelper')}
              </Typography>
            </Box>
          </Paper>
        );

      case 'etsy_details': {
        const taxonomyId = selectedTaxonomyGroup === '' ? null : Number(selectedTaxonomyGroup);
        const properties = taxonomyId ? (bulkTaxonomyProperties[taxonomyId] || []) : [];
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControl size="small" sx={{ minWidth: 260 }}>
                  <InputLabel>Category group</InputLabel>
                  <Select
                    value={selectedTaxonomyGroup}
                    label="Category group"
                    onChange={(e) => {
                      setSelectedTaxonomyGroup(e.target.value as number);
                      setBulkTaxonomyDraft({});
                    }}
                  >
                    {taxonomyGroups.map((group) => (
                      <MenuItem key={group.taxonomyId} value={group.taxonomyId}>
                        {group.taxonomyId} ({group.listings.length} listings)
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <Button
                  variant="contained"
                  size="small"
                  onClick={handleApply}
                  disabled={saving || !taxonomyId || Object.keys(bulkTaxonomyDraft).length === 0}
                  sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
                >
                  Apply to this category group
                </Button>
              </Box>
              {bulkTaxonomyLoading ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">Loading Etsy details...</Typography>
                </Box>
              ) : !taxonomyId ? (
                <Alert severity="info">Selected listings do not have category IDs.</Alert>
              ) : properties.length === 0 ? (
                <Alert severity="info">No Etsy details returned for this category.</Alert>
              ) : (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
                  {properties.map((prop) => {
                    const patch = bulkTaxonomyDraft[prop.property_id] || { property_id: prop.property_id, values: [] };
                    const options: TaxonomyOption[] = (prop.possible_values || [])
                      .map((value) => ({ value_id: Number(value.value_id) || undefined, name: value.name }))
                      .filter((value) => value.name);
                    const selected: TaxonomyOption[] = (patch.values || []).map((value, index) => {
                      const byId = patch.value_ids?.[index]
                        ? options.find((option) => option.value_id === patch.value_ids?.[index])
                        : undefined;
                      return byId || options.find((option) => option.name === value) || { name: value };
                    });
                    return (
                      <Box key={prop.property_id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <Autocomplete
                          multiple
                          freeSolo
                          options={options}
                          getOptionLabel={(option) => typeof option === 'string' ? option : option.name}
                          isOptionEqualToValue={(option, value) => option.name === value.name}
                          value={selected}
                          onChange={(_, value) => updateBulkTaxonomyProperty(
                            prop.property_id,
                            value.map((option) => typeof option === 'string' ? { name: option } : option)
                          )}
                          renderTags={(value, getTagProps) =>
                            value.map((option, index) => (
                              <Chip {...getTagProps({ index })} key={`${prop.property_id}-${typeof option === 'string' ? option : option.name}`} label={typeof option === 'string' ? option : option.name} size="small" />
                            ))
                          }
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label={`${prop.display_name || prop.name}${prop.is_required ? ' *' : ''}`}
                              size="small"
                              helperText={prop.supports_variations ? 'Can also be used for variations' : undefined}
                            />
                          )}
                          sx={{ flex: 1 }}
                        />
                        {prop.supports_variations && <Chip label="Variation" size="small" variant="outlined" sx={{ mt: 1 }} />}
                        {prop.scales && prop.scales.length > 0 && (
                          <FormControl size="small" sx={{ minWidth: 110 }}>
                            <InputLabel>Scale</InputLabel>
                            <Select
                              value={patch.scale_id ? String(patch.scale_id) : ''}
                              label="Scale"
                              onChange={(e) => updateBulkTaxonomyScale(prop.property_id, e.target.value ? Number(e.target.value) : null)}
                            >
                              <MenuItem value=""><em>None</em></MenuItem>
                              {prop.scales.map((scale) => (
                                <MenuItem key={scale.scale_id} value={String(scale.scale_id)}>
                                  {scale.display_name}
                                </MenuItem>
                              ))}
                            </Select>
                          </FormControl>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              )}
            </Box>
          </Paper>
        );
      }

      case 'personalization':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <FormControlLabel
                  control={<Switch checked={isPersonalizable} onChange={e => setIsPersonalizable(e.target.checked)} size="small" />}
                  label={<Typography variant="body2" sx={{ fontSize: '0.82rem', fontWeight: 600 }}>{t('personalizationSection.enableLabel')}</Typography>}
                />
                <FormControlLabel
                  control={<Switch checked={personalizationRequired} onChange={e => setPersonalizationRequired(e.target.checked)} size="small" disabled={!isPersonalizable} />}
                  label={<Typography variant="body2" sx={{ fontSize: '0.82rem' }}>{t('personalizationSection.requiredLabel')}</Typography>}
                />
                <TextField
                  size="small"
                  type="number"
                  label={t('personalizationSection.charMaxLabel')}
                  value={personalizationCharMax}
                  onChange={e => setPersonalizationCharMax(e.target.value)}
                  disabled={!isPersonalizable}
                  sx={{ width: 120 }}
                />
              </Box>
              <TextField
                size="small"
                multiline
                minRows={2}
                maxRows={4}
                label={t('personalizationSection.instructionsLabel')}
                placeholder={t('personalizationSection.instructionsPlaceholder')}
                value={personalizationInstructions}
                onChange={e => setPersonalizationInstructions(e.target.value)}
                disabled={!isPersonalizable}
                fullWidth
              />
              <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                <Button
                  variant="contained" size="small" onClick={handleApply} disabled={saving}
                  sx={{ minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none', borderRadius: '8px' }}
                >
                  {t("actionBar.apply")}
                </Button>
              </Box>
            </Box>
          </Paper>
        );

      case 'variations':
        return (
          <Paper elevation={0} sx={{ px: 2, py: 1.5, mb: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
              {t('operations.editInline')}
            </Typography>
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
    const listingImages = listingImagesById[listing.listing_id] || [];

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
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    size="small"
                    value={value as string}
                    onChange={(e) => updatePending(listing.listing_id, { title: e.target.value })}
                    multiline={false}
                    sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                  />
                  <Tooltip title={t('inlineEditor.aiMagic')}>
                    <IconButton
                      size="small"
                      onClick={() => handleSingleListingAI(listing, 'title')}
                      disabled={aiLoadingId === listing.listing_id}
                      sx={{
                        background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                        color: '#fff',
                        '&:hover': { background: 'linear-gradient(135deg, #7c3aed, #5b21b6)' },
                        '&.Mui-disabled': { background: '#e0e0e0', color: '#999' },
                        minWidth: 32, width: 32, height: 32, flexShrink: 0,
                      }}
                    >
                      {aiLoadingId === listing.listing_id ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <span style={{ fontSize: 16 }}>✨</span>}
                    </IconButton>
                  </Tooltip>
                </Box>
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
                    {t('inlineEditor.charactersRemaining', { count: 140 - (value as string).length })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('inlineEditor.charsCount', { count: (value as string).length })}
                  </Typography>
                </Box>
              </Box>
            )}

            {activeField === 'description' && (
              <Box>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                  <TextField
                    fullWidth
                    size="small"
                    value={value as string}
                    onChange={(e) => updatePending(listing.listing_id, { description: e.target.value })}
                    multiline
                    minRows={3}
                    maxRows={12}
                    sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem', overflowY: 'auto !important' } }}
                  />
                  <Tooltip title={t('inlineEditor.aiMagic')}>
                    <IconButton
                      size="small"
                      onClick={() => handleSingleListingAI(listing, 'description')}
                      disabled={aiLoadingId === listing.listing_id}
                      sx={{
                        background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                        color: '#fff',
                        '&:hover': { background: 'linear-gradient(135deg, #7c3aed, #5b21b6)' },
                        '&.Mui-disabled': { background: '#e0e0e0', color: '#999' },
                        minWidth: 32, width: 32, height: 32, flexShrink: 0, mt: 0.5,
                      }}
                    >
                      {aiLoadingId === listing.listing_id ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <span style={{ fontSize: 16 }}>✨</span>}
                    </IconButton>
                  </Tooltip>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.25 }}>
                  {t('inlineEditor.characters', { count: (value as string).length })}
                </Typography>
              </Box>
            )}

            {activeField === 'tags' && (
              <Box>
                <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'flex-start' }}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <InlineTagEditor
                      tags={value as string[]}
                      onChange={(newTags) => updatePending(listing.listing_id, { tags: newTags })}
                    />
                  </Box>
                  <Tooltip title={t('inlineEditor.aiMagic')}>
                    <IconButton
                      size="small"
                      onClick={() => handleSingleListingAI(listing, 'tags')}
                      disabled={aiLoadingId === listing.listing_id}
                      sx={{
                        background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                        color: '#fff',
                        '&:hover': { background: 'linear-gradient(135deg, #7c3aed, #5b21b6)' },
                        '&.Mui-disabled': { background: '#e0e0e0', color: '#999' },
                        minWidth: 32, width: 32, height: 32, flexShrink: 0,
                      }}
                    >
                      {aiLoadingId === listing.listing_id ? <CircularProgress size={16} sx={{ color: '#fff' }} /> : <span style={{ fontSize: 16 }}>✨</span>}
                    </IconButton>
                  </Tooltip>
                </Box>
              </Box>
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
                    {t('inlineEditor.was', { value: (listing.price.amount / (listing.price.divisor || 100)).toFixed(2) })}
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
                    {t('inlineEditor.was', { value: listing.quantity })}
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
                  <MenuItem value="">{t('inlineEditor.noSection')}</MenuItem>
                  {shopSections.map(s => (
                    <MenuItem key={s.shop_section_id} value={s.shop_section_id}>{s.title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {activeField === 'state' && (
              <Chip
                label={value === 'active' ? t('listingState.active') : value === 'inactive' ? t('listingState.inactive') : value === 'draft' ? t('listingState.draft') : String(value)}
                size="small"
                color={value === 'active' ? 'success' : value === 'inactive' ? 'default' : 'warning'}
              />
            )}

            {activeField === 'about' && (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                <Chip label={t('aboutSection.whoPrefix', { value: listing.who_made || 'i_did' })} size="small" variant="outlined" />
                <Chip label={t('aboutSection.whenPrefix', { value: listing.when_made || 'made_to_order' })} size="small" variant="outlined" />
                <Chip label={listing.is_supply ? t('aboutSection.supply') : t('aboutSection.notSupply')} size="small" variant="outlined" />
              </Box>
            )}

            {activeField === 'photos' && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  {listingImagesLoading && listingImagesById[listing.listing_id] === undefined
                    ? t('photos.loadingImages')
                    : t('photos.imageCount', { count: listingImages.length })}
                </Typography>
                <Box sx={{ mt: 0.75, display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                  {listingImages.map((img) => {
                    const src = img.url_170x135 || img.url_75x75 || img.url_570xN;
                    if (!src) return null;
                    const isPendingUpload = !!img.is_pending_upload;
                    return (
                      <Tooltip key={img.listing_image_id} title={isPendingUpload ? 'Pending upload saved to draft' : t('photos.clickToPreview')}>
                        <Box
                          draggable={!photoUploading && !isPendingUpload}
                          onDragStart={() => {
                            if (isPendingUpload) return;
                            setDraggingBulkImage({ listingId: listing.listing_id, imageId: img.listing_image_id });
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleBulkImageDrop(listing, img.listing_image_id)}
                          onDragEnd={() => setDraggingBulkImage(null)}
                          onClick={() => openBulkPreview(listing, img)}
                          sx={{
                            position: 'relative',
                            cursor: photoUploading ? 'wait' : isPendingUpload ? 'pointer' : 'grab',
                            opacity: draggingBulkImage?.imageId === img.listing_image_id ? 0.65 : 1,
                            transition: 'opacity 0.15s, transform 0.15s',
                            '&:hover': { transform: 'translateY(-1px)' },
                            '&:active': { cursor: 'grabbing' },
                          }}
                        >
                          <img
                            src={src}
                            alt={img.alt_text || `Image ${img.rank}`}
                            style={{ width: 76, height: 76, borderRadius: 6, objectFit: 'cover', border: '1px solid #e5e7eb' }}
                          />
                          <Box
                            sx={{
                              position: 'absolute',
                              top: 3,
                              left: 3,
                              minWidth: 16,
                              height: 16,
                              px: 0.4,
                              borderRadius: '999px',
                              bgcolor: 'rgba(15,23,42,0.72)',
                              color: 'white',
                              fontSize: 10,
                              lineHeight: '16px',
                              textAlign: 'center',
                              fontWeight: 700,
                            }}
                          >
                            {img.rank}
                          </Box>
                          {img.alt_text && (
                            <Box
                              sx={{
                                position: 'absolute',
                                right: 3,
                                bottom: 3,
                                width: 16,
                                height: 16,
                                borderRadius: '50%',
                                bgcolor: 'rgba(16,185,129,0.9)',
                                color: 'white',
                                fontSize: 10,
                                lineHeight: '16px',
                                textAlign: 'center',
                                fontWeight: 700,
                              }}
                            >
                              A
                            </Box>
                          )}
                          {isPendingUpload && (
                            <Box
                              sx={{
                                position: 'absolute',
                                left: 3,
                                bottom: 3,
                                px: 0.5,
                                height: 16,
                                borderRadius: '999px',
                                bgcolor: 'rgba(37,99,235,0.9)',
                                color: 'white',
                                fontSize: 9,
                                lineHeight: '16px',
                                fontWeight: 700,
                              }}
                            >
                              Draft
                            </Box>
                          )}
                        </Box>
                      </Tooltip>
                    );
                  })}
                  {!listingImagesLoading && listingImages.length === 0 && (
                    <Typography variant="caption" color="text.secondary">
                      {t('photos.noImages')}
                    </Typography>
                  )}
                </Box>
              </Box>
            )}

            {activeField === 'videos' && (
              <Typography variant="caption" color="text.secondary">
                {t('videos.videoHelper')}
              </Typography>
            )}

            {activeField === 'item_weight' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.item_weight ? `${listing.item_weight} ${listing.item_weight_unit || 'g'}` : t('inlineEditor.notSet')}
              </Typography>
            )}

            {activeField === 'item_size' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.item_length
                  ? `${listing.item_length} x ${listing.item_width || '?'} x ${listing.item_height || '?'} ${listing.item_dimensions_unit || 'cm'}`
                  : t('inlineEditor.notSet')}
              </Typography>
            )}

            {activeField === 'processing_time' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.processing_min ? t('processingTime.daysRange', { min: listing.processing_min, max: listing.processing_max ?? 0 }) : t('inlineEditor.notSet')}
              </Typography>
            )}

            {activeField === 'variations' && (
              <Box sx={{ mt: 0.5, border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden' }}>
                <VariationEditor
                  listingId={String(listing.listing_id)}
                  shopId={shopId}
                  taxonomyId={listing.taxonomy_id ?? undefined}
                  onSaved={() => {}}
                />
              </Box>
            )}

            {activeField === 'shipping_profile' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.shipping_profile_id
                  ? (shippingProfiles.find(sp => sp.shipping_profile_id === listing.shipping_profile_id)?.title || t('shippingProfile.profileFallback', { id: listing.shipping_profile_id }))
                  : t('inlineEditor.notSet')}
              </Typography>
            )}

            {activeField === 'return_policy' && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.82rem' }}>
                {listing.return_policy_id
                  ? (returnPolicies.find(rp => rp.return_policy_id === listing.return_policy_id)?.description || t('returnPolicy.policyFallback', { id: listing.return_policy_id }))
                  : t('inlineEditor.notSet')}
              </Typography>
            )}

            {activeField === 'category' && (() => {
              const pending = pendingChanges.get(listing.listing_id);
              if (pending?.taxonomy_id) {
                return (
                  <Chip label={t('categorySection.taxonomySet', { id: pending.taxonomy_id })} size="small" color="primary" variant="outlined" />
                );
              }
              return (
                <Typography variant="caption" color="text.secondary">
                  {t('categorySection.notSet')}
                </Typography>
              );
            })()}

            {activeField === 'etsy_details' && (() => {
              const pending = pendingChanges.get(listing.listing_id);
              if (selectedTaxonomyGroup !== '' && listing.taxonomy_id !== Number(selectedTaxonomyGroup)) {
                return <Typography variant="caption" color="text.secondary">Different category group</Typography>;
              }
              if (pending?.taxonomyProperties?.length) {
                return <Chip label={`${pending.taxonomyProperties.length} detail changes`} size="small" color="primary" variant="outlined" />;
              }
              return <Typography variant="caption" color="text.secondary">No detail changes staged</Typography>;
            })()}

            {activeField === 'personalization' && (() => {
              const pending = pendingChanges.get(listing.listing_id);
              const enabled = pending?.is_personalizable;
              if (enabled !== undefined) {
                return (
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip
                      label={enabled ? t('personalizationSection.enabled') : t('personalizationSection.disabled')}
                      size="small"
                      color={enabled ? 'success' : 'default'}
                    />
                    {enabled && pending?.personalization_is_required && (
                      <Chip label={t('personalizationSection.required')} size="small" color="warning" variant="outlined" />
                    )}
                    {enabled && pending?.personalization_instructions && (
                      <Typography variant="caption" color="text.secondary" sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {pending.personalization_instructions}
                      </Typography>
                    )}
                  </Box>
                );
              }
              return (
                <Typography variant="caption" color="text.secondary">
                  {t('personalizationSection.notConfigured')}
                </Typography>
              );
            })()}
          </Box>

          {/* SEO score indicator for title */}
          {activeField === 'title' && (
            <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
              <Tooltip title={t('inlineEditor.charsTooltip', { count: (value as string).length })}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.85rem',
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
              <Tooltip title={t('inlineEditor.tagsCount', { count: (value as string[]).length })}>
                <Typography
                  variant="caption"
                  sx={{
                    fontWeight: 700,
                    fontSize: '0.85rem',
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
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2, fontSize: '0.85rem' }}>
              {t('shopLabel')} &middot; {shopName}
            </Typography>
          )}
          <Typography variant="subtitle1" fontWeight={700} sx={{ fontSize: { xs: '0.9rem', sm: '1rem' } }}>
            {t('header.editingListings', { count: listings.length })}
          </Typography>
        </Box>

        {pendingCount > 0 && (
          <Chip
            label={t('header.changes', { count: pendingCount })}
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
          >{t('header.discard')}
          </Button>
        )}

        <Button
          variant="outlined"
          size="small"
          onClick={handleClose}
          sx={{ minHeight: 36, textTransform: 'none', fontWeight: 600, borderRadius: '8px', display: { xs: 'none', sm: 'flex' } }}
        >{t('header.cancel')}
        </Button>

        <IconButton onClick={handleClose} size="small" sx={{ display: { xs: 'flex', sm: 'none' } }}>
          <CloseIcon />
        </IconButton>

        <Button
          variant="contained"
          size="small"
          onClick={handleSave}
          disabled={saving || pendingCount === 0}
          startIcon={saving ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <SaveIcon />}
          sx={{
            minHeight: 36, textTransform: 'none', fontWeight: 700, borderRadius: '8px',
            px: { xs: 2, sm: 3 },
            background: 'linear-gradient(135deg, #10b981, #059669)',
            '&:hover': { background: 'linear-gradient(135deg, #059669, #047857)' },
            '&.Mui-disabled': { bgcolor: '#e0e0e0' },
          }}
        >
          {saving ? `${saveProgress}%` : isMobile ? t('header.sync') : t('header.syncUpdates')}
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
                <Typography variant="subtitle2" fontWeight={700}>{t('sidebar.selectField')}
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
          {activeField === 'photos' ? (
            <BulkPhotoStudio
              shopId={shopId}
              listings={filteredListings}
              checkedIds={checkedIds}
              onToggleChecked={(id) => setCheckedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              })}
              onToggleAll={handleToggleAll}
              onSetChecked={(ids) => setCheckedIds(new Set(ids))}
              allChecked={allChecked}
              someChecked={someChecked}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              listingImagesById={listingImagesById}
              setListingImagesById={setListingImagesById}
              listingImagesLoading={listingImagesLoading}
              refreshListingImages={refreshListingImages}
              onCompleted={onCompleted}
            />
          ) : activeField === 'videos' ? (
            <BulkVideoStudio
              shopId={shopId}
              listings={filteredListings}
              checkedIds={checkedIds}
              onToggleChecked={(id) => setCheckedIds(prev => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id); else next.add(id);
                return next;
              })}
              onToggleAll={handleToggleAll}
              onSetChecked={(ids) => setCheckedIds(new Set(ids))}
              allChecked={allChecked}
              someChecked={someChecked}
              searchTerm={searchTerm}
              onSearchChange={setSearchTerm}
              onCompleted={onCompleted}
            />
          ) : (
          <>
          {/* Bulk action bar toggle + collapsible */}
          <Box sx={{ mb: 1 }}>
            <Button
              size="small"
              variant={showBulkActions ? 'contained' : 'outlined'}
              startIcon={<TuneIcon sx={{ fontSize: 16 }} />}
              onClick={() => setShowBulkActions(prev => !prev)}
              sx={{
                mb: showBulkActions ? 1 : 0,
                textTransform: 'none', fontWeight: 600, borderRadius: '8px', fontSize: '0.8rem',
                ...(showBulkActions ? {
                  background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                  '&:hover': { background: 'linear-gradient(135deg, #1d4ed8, #4338ca)' },
                } : {}),
              }}
            >
              {t('actionBar.bulkActions')}
            </Button>
            <Collapse in={showBulkActions}>
              {renderActionBar()}
            </Collapse>
          </Box>

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
              placeholder={t("search.placeholder")}
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
              {t('search.selected', { selected: filteredListings.filter(l => checkedIds.has(l.listing_id)).length, total: filteredListings.length })}
            </Typography>

            {/* Quick field name display */}
            <Chip
              label={t(fieldDef.label)}
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
                {searchTerm ? t('search.noMatch') : t('search.noListings')}
              </Typography>
            </Paper>
          ) : (
            filteredListings.map(listing => renderListingRow(listing))
          )}
          </>
          )}
        </Box>
      </Box>

      {/* Sticky bottom save bar */}
      {pendingCount > 0 && (
        <Paper
          elevation={8}
          sx={{
            position: 'sticky', bottom: 0, left: 0, right: 0,
            px: { xs: 2, sm: 3 }, py: 1.5,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 2, zIndex: 10,
            borderTop: '2px solid', borderColor: 'primary.main',
            bgcolor: 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Chip
              label={t('header.changes', { count: pendingCount })}
              color="primary"
              size="small"
              sx={{ fontWeight: 700 }}
            />
            <Button
              variant="text"
              size="small"
              color="error"
              onClick={handleDiscard}
              sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.8rem' }}
            >
              {t('header.discard')}
            </Button>
          </Box>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving}
          startIcon={saving ? <CircularProgress size={18} sx={{ color: 'white' }} /> : <SaveIcon />}
            sx={{
              minHeight: 44, px: 4, fontWeight: 700, textTransform: 'none', borderRadius: '10px',
              fontSize: '0.95rem',
              background: 'linear-gradient(135deg, #10b981, #059669)',
              '&:hover': { background: 'linear-gradient(135deg, #059669, #047857)' },
              '&.Mui-disabled': { bgcolor: '#e0e0e0' },
            }}
          >
            {saving ? `${saveProgress}%` : t('footer.publishToEtsy')}
          </Button>
        </Paper>
      )}

      <Dialog
        open={!!bulkPreview}
        onClose={() => !savingBulkAlt && closeBulkPreview()}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>
          {t('photos.previewTitle')}
        </DialogTitle>
        <DialogContent>
          {bulkPreview && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(280px, 1fr) 320px' }, gap: 2, alignItems: 'start' }}>
              <Box
                sx={{
                  position: 'relative',
                  minHeight: { xs: 280, sm: 420 },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: '#f8fafc',
                  borderRadius: 2,
                  p: 1,
                  overflow: 'hidden',
                }}
              >
                {!bulkPreviewLoaded && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundImage: bulkPreview.image.url_170x135 ? `url(${bulkPreview.image.url_170x135})` : undefined,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      '&::before': {
                        content: '""',
                        position: 'absolute',
                        inset: 0,
                        backdropFilter: bulkPreview.image.url_170x135 ? 'blur(14px)' : 'none',
                        backgroundColor: bulkPreview.image.url_170x135 ? 'rgba(248,250,252,0.72)' : '#f8fafc',
                      },
                    }}
                  >
                    <CircularProgress size={28} sx={{ position: 'relative', zIndex: 1 }} />
                  </Box>
                )}
                <img
                  src={bulkPreview.image.url_fullxfull || bulkPreview.image.url_570xN || bulkPreview.image.url_170x135 || bulkPreview.image.url_75x75}
                  alt={bulkPreview.image.alt_text || `Image ${bulkPreview.image.rank}`}
                  onLoad={() => setBulkPreviewLoaded(true)}
                  onError={() => setBulkPreviewLoaded(true)}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '70vh',
                    objectFit: 'contain',
                    borderRadius: 8,
                    opacity: bulkPreviewLoaded ? 1 : 0,
                    transition: 'opacity 0.18s ease',
                  }}
                />
              </Box>
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                  {bulkPreview.listing.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
                  {t('photos.rankLabel', { rank: bulkPreview.image.rank })}
                </Typography>
                <TextField
                  label={t('photos.altTextLabel')}
                  placeholder={t('photos.altTextPlaceholder')}
                  fullWidth
                  multiline
                  minRows={4}
                  value={bulkAltText}
                  onChange={(e) => setBulkAltText(e.target.value.slice(0, 250))}
                  disabled={savingBulkAlt}
                  helperText={`${bulkAltText.length}/250`}
                />
              </Box>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeBulkPreview} disabled={savingBulkAlt}>
            {t('header.cancel')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSaveBulkAltText}
            disabled={savingBulkAlt || !bulkPreview}
            startIcon={savingBulkAlt ? <CircularProgress size={16} /> : undefined}
          >
            {t('photos.saveAltText')}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
