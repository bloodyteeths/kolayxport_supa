import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Drawer,
  Box,
  Typography,
  IconButton,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Button,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  CircularProgress,
  Switch,
  FormControlLabel,
  Chip,
  Autocomplete,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tooltip,
} from '@mui/material';
import type { SelectChangeEvent } from '@mui/material/Select';
import CloseIcon from '@mui/icons-material/Close';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import SaveIcon from '@mui/icons-material/Save';
import PublishIcon from '@mui/icons-material/Publish';
import DeleteIcon from '@mui/icons-material/Delete';
import BlockIcon from '@mui/icons-material/Block';
import { toast } from 'react-hot-toast';

import SEOIndicator from './SEOIndicator';
import ImageManager from './ImageManager';
import VideoUploader from './VideoUploader';
import PersonalizationEditor, { type PersonalizationQuestion } from './PersonalizationEditor';
import VariationEditor from './VariationEditor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ListingEditorDrawerProps {
  open: boolean;
  onClose: () => void;
  listingId: string | null;
  shopId: string;
  shopSections: Array<{ shop_section_id: number; title: string }>;
  shippingProfiles: Array<{ shipping_profile_id: number; title: string }>;
  returnPolicies: Array<{ return_policy_id: number; description?: string }>;
  onSaved: () => void;
}

interface PriceInfo {
  amount: number;
  divisor: number;
  currency_code: string;
}

interface ImageInfo {
  listing_image_id: number;
  url_75x75: string;
  url_170x135: string;
  url_570xN: string;
  url_fullxfull?: string;
  rank: number;
  alt_text?: string;
}

interface VideoInfo {
  video_id: number;
  thumbnail_url?: string;
  video_url?: string;
  state?: string;
}

interface ListingData {
  listing_id: number;
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  price: PriceInfo | null;
  views: number;
  num_favorers: number;
  quantity: number;
  state: string;
  url: string;
  taxonomy_id?: number;
  shop_section_id?: number;
  processing_min?: number;
  processing_max?: number;
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
  created_timestamp?: number;
  updated_timestamp?: number;
  is_personalizable: boolean;
  personalization_is_required: boolean;
  personalization_instructions: string;
  personalization_char_count_max: number;
  personalization_questions: PersonalizationQuestion[];
  images: ImageInfo[];
}

// Editable fields tracked for dirty-checking
interface EditableFields {
  title: string;
  description: string;
  tags: string[];
  materials: string[];
  price: string; // displayed as decimal string e.g. "12.50"
  quantity: number;
  who_made: string;
  when_made: string;
  is_supply: boolean;
  shop_section_id: number | '';
  shipping_profile_id: number | '';
  return_policy_id: number | '';
  processing_min: number | '';
  processing_max: number | '';
  item_weight: number | '';
  item_weight_unit: string;
  item_length: number | '';
  item_width: number | '';
  item_height: number | '';
  item_dimensions_unit: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WHO_MADE_OPTIONS = [
  { value: 'i_did', label: 'Ben yaptim' },
  { value: 'collective', label: 'Ekibimiz yapti' },
  { value: 'someone_else', label: 'Baskasi yapti' },
];

const WHEN_MADE_OPTIONS = [
  { value: 'made_to_order', label: 'Siparise ozel' },
  { value: '2020_2025', label: '2020-2025' },
  { value: '2010_2019', label: '2010-2019' },
  { value: '2004_2009', label: '2004-2009' },
  { value: 'before_2004', label: '2004 oncesi' },
  { value: '2000_2003', label: '2000-2003' },
  { value: '1990s', label: '1990\'lar' },
  { value: '1980s', label: '1980\'ler' },
  { value: '1970s', label: '1970\'ler' },
  { value: '1960s', label: '1960\'lar' },
];

const WEIGHT_UNITS = [
  { value: 'oz', label: 'oz' },
  { value: 'lb', label: 'lb' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
];

const DIMENSION_UNITS = [
  { value: 'in', label: 'in' },
  { value: 'ft', label: 'ft' },
  { value: 'mm', label: 'mm' },
  { value: 'cm', label: 'cm' },
  { value: 'm', label: 'm' },
];

const DRAWER_WIDTH = 550;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function priceToDecimal(price: PriceInfo | null): string {
  if (!price) return '0.00';
  return (price.amount / (price.divisor || 100)).toFixed(2);
}

function buildInitialFields(listing: ListingData): EditableFields {
  return {
    title: listing.title,
    description: listing.description,
    tags: [...listing.tags],
    materials: [...listing.materials],
    price: priceToDecimal(listing.price),
    quantity: listing.quantity,
    who_made: listing.who_made || 'i_did',
    when_made: listing.when_made || 'made_to_order',
    is_supply: listing.is_supply ?? false,
    shop_section_id: listing.shop_section_id ?? '',
    shipping_profile_id: listing.shipping_profile_id ?? '',
    return_policy_id: listing.return_policy_id ?? '',
    processing_min: listing.processing_min ?? '',
    processing_max: listing.processing_max ?? '',
    item_weight: listing.item_weight ?? '',
    item_weight_unit: listing.item_weight_unit || 'g',
    item_length: listing.item_length ?? '',
    item_width: listing.item_width ?? '',
    item_height: listing.item_height ?? '',
    item_dimensions_unit: listing.item_dimensions_unit || 'cm',
  };
}

/** Shallow compare two EditableFields objects and return changed keys */
function getChangedFields(
  original: EditableFields,
  current: EditableFields,
): Partial<Record<keyof EditableFields, any>> {
  const changed: Partial<Record<keyof EditableFields, any>> = {};
  const keys = Object.keys(original) as (keyof EditableFields)[];

  for (const key of keys) {
    const orig = original[key];
    const curr = current[key];

    if (Array.isArray(orig) && Array.isArray(curr)) {
      if (orig.length !== curr.length || orig.some((v, i) => v !== curr[i])) {
        changed[key] = curr;
      }
    } else if (orig !== curr) {
      (changed as any)[key] = curr;
    }
  }

  return changed;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ListingEditorDrawer({
  open,
  onClose,
  listingId,
  shopId,
  shopSections,
  shippingProfiles,
  returnPolicies,
  onSaved,
}: ListingEditorDrawerProps) {
  // Loading / data state
  const [loading, setLoading] = useState(false);
  const [listing, setListing] = useState<ListingData | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Editable fields
  const [fields, setFields] = useState<EditableFields | null>(null);
  const originalFieldsRef = useRef<EditableFields | null>(null);

  // Videos (fetched separately)
  const [videos, setVideos] = useState<VideoInfo[]>([]);
  const [videosLoading, setVideosLoading] = useState(false);

  // Action states
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [copying, setCopying] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Accordion expanded state
  const [expanded, setExpanded] = useState<string | false>('basics');

  // --------------------------------------------------
  // Fetch listing details
  // --------------------------------------------------
  const fetchListing = useCallback(async () => {
    if (!listingId || !shopId) return;

    setLoading(true);
    setFetchError(null);

    try {
      const res = await fetch(
        `/api/clawd/etsy?action=listing&listing_id=${listingId}&shop_id=${shopId}`,
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const data: ListingData = await res.json();
      setListing(data);

      const initial = buildInitialFields(data);
      setFields(initial);
      originalFieldsRef.current = { ...initial, tags: [...initial.tags], materials: [...initial.materials] };
    } catch (err: any) {
      setFetchError(err.message || 'Liste detaylari yuklenemedi');
      toast.error('Liste detaylari yuklenemedi');
    } finally {
      setLoading(false);
    }
  }, [listingId, shopId]);

  // --------------------------------------------------
  // Fetch videos
  // --------------------------------------------------
  const fetchVideos = useCallback(async () => {
    if (!listingId || !shopId) return;

    setVideosLoading(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=get_listing_videos&listing_id=${listingId}&shop_id=${shopId}`,
      );
      if (res.ok) {
        const data = await res.json();
        setVideos(data.videos || data.results || []);
      }
    } catch {
      // Non-critical, silently ignore
    } finally {
      setVideosLoading(false);
    }
  }, [listingId, shopId]);

  // --------------------------------------------------
  // Trigger fetch on open / listingId change
  // --------------------------------------------------
  useEffect(() => {
    if (open && listingId) {
      fetchListing();
      fetchVideos();
    }

    // Reset state when drawer closes
    if (!open) {
      setListing(null);
      setFields(null);
      originalFieldsRef.current = null;
      setFetchError(null);
      setVideos([]);
      setExpanded('basics');
    }
  }, [open, listingId, fetchListing, fetchVideos]);

  // --------------------------------------------------
  // Field updaters
  // --------------------------------------------------
  const updateField = <K extends keyof EditableFields>(key: K, value: EditableFields[K]) => {
    setFields((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleAccordionChange = (panel: string) => (_: React.SyntheticEvent, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false);
  };

  // --------------------------------------------------
  // Has changes?
  // --------------------------------------------------
  const hasChanges = (): boolean => {
    if (!fields || !originalFieldsRef.current) return false;
    return Object.keys(getChangedFields(originalFieldsRef.current, fields)).length > 0;
  };

  // --------------------------------------------------
  // Save (update listing)
  // --------------------------------------------------
  const handleSave = async () => {
    if (!listingId || !fields || !originalFieldsRef.current) return;

    const changed = getChangedFields(originalFieldsRef.current, fields);
    if (Object.keys(changed).length === 0) {
      toast('Degisiklik yok', { icon: '\u2139\uFE0F' });
      return;
    }

    setSaving(true);
    try {
      // Build the API payload
      const payload: Record<string, any> = {};

      if (changed.title !== undefined) payload.title = changed.title;
      if (changed.description !== undefined) payload.description = changed.description;
      if (changed.tags !== undefined) payload.tags = changed.tags;
      if (changed.materials !== undefined) payload.materials = changed.materials;
      if (changed.price !== undefined) payload.price = changed.price;
      if (changed.quantity !== undefined) payload.quantity = changed.quantity;
      if (changed.who_made !== undefined) payload.who_made = changed.who_made;
      if (changed.when_made !== undefined) payload.when_made = changed.when_made;
      if (changed.is_supply !== undefined) payload.is_supply = changed.is_supply;
      if (changed.shop_section_id !== undefined && changed.shop_section_id !== '') {
        payload.shop_section_id = changed.shop_section_id;
      }
      if (changed.shipping_profile_id !== undefined && changed.shipping_profile_id !== '') {
        payload.shipping_profile_id = changed.shipping_profile_id;
      }
      if (changed.return_policy_id !== undefined && changed.return_policy_id !== '') {
        payload.return_policy_id = changed.return_policy_id;
      }
      if (changed.processing_min !== undefined && changed.processing_min !== '') {
        payload.processing_min = Number(changed.processing_min);
      }
      if (changed.processing_max !== undefined && changed.processing_max !== '') {
        payload.processing_max = Number(changed.processing_max);
      }
      if (changed.item_weight !== undefined && changed.item_weight !== '') {
        payload.item_weight = Number(changed.item_weight);
      }
      if (changed.item_weight_unit !== undefined) payload.item_weight_unit = changed.item_weight_unit;
      if (changed.item_length !== undefined && changed.item_length !== '') {
        payload.item_length = Number(changed.item_length);
      }
      if (changed.item_width !== undefined && changed.item_width !== '') {
        payload.item_width = Number(changed.item_width);
      }
      if (changed.item_height !== undefined && changed.item_height !== '') {
        payload.item_height = Number(changed.item_height);
      }
      if (changed.item_dimensions_unit !== undefined) payload.item_dimensions_unit = changed.item_dimensions_unit;

      if (Object.keys(payload).length === 0) {
        toast('Degisiklik yok', { icon: '\u2139\uFE0F' });
        setSaving(false);
        return;
      }

      const res = await fetch(
        `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      toast.success('Liste guncellendi');

      // Refresh listing data to reset dirty state
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Guncelleme basarisiz');
    } finally {
      setSaving(false);
    }
  };

  // --------------------------------------------------
  // Publish
  // --------------------------------------------------
  const handlePublish = async () => {
    if (!listingId) return;

    setPublishing(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=publish&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'POST',
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Yayinlama basarisiz');
      }

      toast.success('Liste yayinlandi');
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Yayinlama basarisiz');
    } finally {
      setPublishing(false);
    }
  };

  // --------------------------------------------------
  // Deactivate
  // --------------------------------------------------
  const handleDeactivate = async () => {
    if (!listingId) return;

    setDeactivating(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=update_listing&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ state: 'inactive' }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Deaktif etme basarisiz');
      }

      toast.success('Liste deaktif edildi');
      await fetchListing();
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Deaktif etme basarisiz');
    } finally {
      setDeactivating(false);
    }
  };

  // --------------------------------------------------
  // Copy
  // --------------------------------------------------
  const handleCopy = async () => {
    if (!listingId) return;

    setCopying(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=copy_listing&shop_id=${shopId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ source_listing_id: listingId }),
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Kopyalama basarisiz');
      }

      toast.success('Liste kopyalandi (taslak olarak)');
      onSaved();
    } catch (err: any) {
      toast.error(err.message || 'Kopyalama basarisiz');
    } finally {
      setCopying(false);
    }
  };

  // --------------------------------------------------
  // Delete
  // --------------------------------------------------
  const handleDelete = async () => {
    if (!listingId) return;

    setDeleting(true);
    try {
      const res = await fetch(
        `/api/clawd/etsy?action=delete_listing&listing_id=${listingId}&shop_id=${shopId}`,
        {
          method: 'DELETE',
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Silme basarisiz');
      }

      toast.success('Liste silindi');
      setDeleteDialogOpen(false);
      onSaved();
      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Silme basarisiz');
    } finally {
      setDeleting(false);
    }
  };

  // --------------------------------------------------
  // Render helpers
  // --------------------------------------------------
  const renderHeader = () => {
    const truncatedTitle = listing?.title
      ? listing.title.length > 45
        ? listing.title.substring(0, 45) + '...'
        : listing.title
      : 'Liste Duzenle';

    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          p: 2,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          position: 'sticky',
          top: 0,
          zIndex: 10,
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, mr: 1 }}>
          <Typography variant="subtitle1" fontWeight={600} noWrap title={listing?.title}>
            {truncatedTitle}
          </Typography>
          {listing && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
              <Chip
                label={
                  listing.state === 'active'
                    ? 'Aktif'
                    : listing.state === 'draft'
                    ? 'Taslak'
                    : listing.state === 'inactive'
                    ? 'Deaktif'
                    : listing.state === 'expired'
                    ? 'Suresi Doldu'
                    : listing.state
                }
                size="small"
                color={
                  listing.state === 'active'
                    ? 'success'
                    : listing.state === 'draft'
                    ? 'warning'
                    : 'default'
                }
                sx={{ height: 20, fontSize: '0.7rem' }}
              />
              <Typography variant="caption" color="text.secondary">
                {listing.views} goruntulenme &middot; {listing.num_favorers} favori
              </Typography>
            </Box>
          )}
        </Box>

        <Box sx={{ display: 'flex', gap: 0.5, flexShrink: 0 }}>
          {listing?.url && (
            <Tooltip title="Etsy'de Goruntule">
              <IconButton
                size="small"
                component="a"
                href={listing.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title="Kopyala">
            <IconButton size="small" onClick={handleCopy} disabled={copying}>
              {copying ? <CircularProgress size={18} /> : <ContentCopyIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
      </Box>
    );
  };

  const renderLoadingState = () => (
    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 4 }}>
      <CircularProgress />
    </Box>
  );

  const renderErrorState = () => (
    <Box sx={{ p: 4, textAlign: 'center' }}>
      <Typography color="error" gutterBottom>
        {fetchError}
      </Typography>
      <Button variant="outlined" onClick={fetchListing}>
        Tekrar Dene
      </Button>
    </Box>
  );

  // --------------------------------------------------
  // Main render
  // --------------------------------------------------
  if (!fields && !loading && !fetchError) {
    // Drawer is open but no data yet — nothing to render
  }

  return (
    <>
      <Drawer
        anchor="right"
        open={open}
        onClose={onClose}
        PaperProps={{
          sx: {
            width: { xs: '100%', sm: DRAWER_WIDTH },
            maxWidth: '100vw',
          },
        }}
      >
        {/* Header — always shown */}
        {renderHeader()}

        {/* Content */}
        {loading ? (
          renderLoadingState()
        ) : fetchError ? (
          renderErrorState()
        ) : fields && listing ? (
          <Box sx={{ overflow: 'auto', flex: 1, pb: 10 }}>
            {/* ============================================================ */}
            {/* 1. Temel Bilgiler */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'basics'}
              onChange={handleAccordionChange('basics')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Temel Bilgiler</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Title */}
                  <TextField
                    label="Baslik"
                    value={fields.title}
                    onChange={(e) => {
                      if (e.target.value.length <= 140) {
                        updateField('title', e.target.value);
                      }
                    }}
                    fullWidth
                    size="small"
                    helperText={`${fields.title.length}/140 karakter`}
                    inputProps={{ maxLength: 140 }}
                  />

                  {/* Description */}
                  <TextField
                    label="Aciklama"
                    value={fields.description}
                    onChange={(e) => updateField('description', e.target.value)}
                    fullWidth
                    multiline
                    rows={6}
                    size="small"
                    helperText={`${fields.description.length} karakter`}
                  />

                  {/* Tags */}
                  <Autocomplete
                    multiple
                    freeSolo
                    options={[]}
                    value={fields.tags}
                    onChange={(_, newValue) => {
                      if (newValue.length <= 13) {
                        updateField('tags', newValue as string[]);
                      }
                    }}
                    renderTags={(value, getTagProps) =>
                      value.map((tag, index) => (
                        <Chip
                          {...getTagProps({ index })}
                          key={tag}
                          label={tag}
                          size="small"
                          sx={{ maxWidth: 180 }}
                        />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Etiketler"
                        size="small"
                        placeholder={fields.tags.length < 13 ? 'Etiket ekle...' : ''}
                        helperText={`${fields.tags.length}/13 etiket`}
                      />
                    )}
                  />

                  {/* Materials */}
                  <Autocomplete
                    multiple
                    freeSolo
                    options={[]}
                    value={fields.materials}
                    onChange={(_, newValue) => {
                      if (newValue.length <= 13) {
                        updateField('materials', newValue as string[]);
                      }
                    }}
                    renderTags={(value, getTagProps) =>
                      value.map((mat, index) => (
                        <Chip
                          {...getTagProps({ index })}
                          key={mat}
                          label={mat}
                          size="small"
                          sx={{ maxWidth: 180 }}
                        />
                      ))
                    }
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Malzemeler"
                        size="small"
                        placeholder={fields.materials.length < 13 ? 'Malzeme ekle...' : ''}
                        helperText={`${fields.materials.length}/13 malzeme`}
                      />
                    )}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 2. SEO Analizi */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'seo'}
              onChange={handleAccordionChange('seo')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>SEO Analizi</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <SEOIndicator
                  tags={fields.tags}
                  title={fields.title}
                  description={fields.description}
                  compact={false}
                />
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 3. Fiyat ve Stok */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'pricing'}
              onChange={handleAccordionChange('pricing')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Fiyat ve Stok</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', gap: 2 }}>
                  <TextField
                    label="Fiyat"
                    value={fields.price}
                    onChange={(e) => {
                      const val = e.target.value;
                      // Allow digits and one decimal point
                      if (/^\d*\.?\d{0,2}$/.test(val) || val === '') {
                        updateField('price', val);
                      }
                    }}
                    size="small"
                    sx={{ flex: 1 }}
                    InputProps={{
                      endAdornment: (
                        <Typography variant="caption" color="text.secondary">
                          {listing.price?.currency_code || 'USD'}
                        </Typography>
                      ),
                    }}
                  />
                  <TextField
                    label="Stok"
                    type="number"
                    value={fields.quantity}
                    onChange={(e) => updateField('quantity', Math.max(0, parseInt(e.target.value) || 0))}
                    size="small"
                    sx={{ width: 120 }}
                    inputProps={{ min: 0 }}
                  />
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 4. Gorseller */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'images'}
              onChange={handleAccordionChange('images')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Gorseller</Typography>
                  <Chip label={listing.images.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <ImageManager
                  listingId={String(listing.listing_id)}
                  shopId={shopId}

                  images={listing.images}
                  onImagesChanged={fetchListing}
                />
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 5. Video */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'video'}
              onChange={handleAccordionChange('video')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Video</Typography>
                  {videos.length > 0 && (
                    <Chip label={videos.length} size="small" sx={{ height: 20, fontSize: '0.7rem' }} />
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                {videosLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', p: 2 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : (
                  <VideoUploader
                    listingId={String(listing.listing_id)}
                    shopId={shopId}
  
                    videos={videos}
                    onVideoChanged={fetchVideos}
                  />
                )}
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 6. Kisiselleistirme */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'personalization'}
              onChange={handleAccordionChange('personalization')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography fontWeight={600}>Kisilestirme</Typography>
                  {listing.is_personalizable && (
                    <Chip label="Aktif" size="small" color="success" sx={{ height: 20, fontSize: '0.7rem' }} />
                  )}
                </Box>
              </AccordionSummary>
              <AccordionDetails>
                <PersonalizationEditor
                  listingId={String(listing.listing_id)}
                  shopId={shopId}

                  questions={listing.personalization_questions}
                  legacy={{
                    is_personalizable: listing.is_personalizable || false,
                    personalization_is_required: listing.personalization_is_required || false,
                    personalization_instructions: listing.personalization_instructions || '',
                    personalization_char_count_max: listing.personalization_char_count_max || 0,
                  }}
                  onSaved={fetchListing}
                />
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 7. Varyasyonlar ve Envanter */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'variations'}
              onChange={handleAccordionChange('variations')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Varyasyonlar ve Envanter</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <VariationEditor
                  listingId={String(listing.listing_id)}
                  shopId={shopId}

                  onSaved={fetchListing}
                />
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 8. Liste Detaylari */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'details'}
              onChange={handleAccordionChange('details')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Liste Detaylari</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {/* Who made */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Kim yapti</InputLabel>
                    <Select
                      value={fields.who_made}
                      label="Kim yapti"
                      onChange={(e: SelectChangeEvent) => updateField('who_made', e.target.value)}
                    >
                      {WHO_MADE_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* When made */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Ne zaman yapildi</InputLabel>
                    <Select
                      value={fields.when_made}
                      label="Ne zaman yapildi"
                      onChange={(e: SelectChangeEvent) => updateField('when_made', e.target.value)}
                    >
                      {WHEN_MADE_OPTIONS.map((opt) => (
                        <MenuItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Is supply */}
                  <FormControlLabel
                    control={
                      <Switch
                        checked={fields.is_supply}
                        onChange={(e) => updateField('is_supply', e.target.checked)}
                      />
                    }
                    label="Bu bir malzeme veya araci mi?"
                  />

                  <Divider sx={{ my: 0.5 }} />

                  {/* Shop section */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Magaza bolumu</InputLabel>
                    <Select
                      value={String(fields.shop_section_id)}
                      label="Magaza bolumu"
                      onChange={(e: SelectChangeEvent) =>
                        updateField('shop_section_id', e.target.value ? Number(e.target.value) : '')
                      }
                    >
                      <MenuItem value="">
                        <em>Secilmedi</em>
                      </MenuItem>
                      {shopSections.map((sec) => (
                        <MenuItem key={sec.shop_section_id} value={String(sec.shop_section_id)}>
                          {sec.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Shipping profile */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Kargo profili</InputLabel>
                    <Select
                      value={String(fields.shipping_profile_id)}
                      label="Kargo profili"
                      onChange={(e: SelectChangeEvent) =>
                        updateField('shipping_profile_id', e.target.value ? Number(e.target.value) : '')
                      }
                    >
                      <MenuItem value="">
                        <em>Secilmedi</em>
                      </MenuItem>
                      {shippingProfiles.map((sp) => (
                        <MenuItem key={sp.shipping_profile_id} value={String(sp.shipping_profile_id)}>
                          {sp.title}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  {/* Return policy */}
                  <FormControl size="small" fullWidth>
                    <InputLabel>Iade politikasi</InputLabel>
                    <Select
                      value={String(fields.return_policy_id)}
                      label="Iade politikasi"
                      onChange={(e: SelectChangeEvent) =>
                        updateField('return_policy_id', e.target.value ? Number(e.target.value) : '')
                      }
                    >
                      <MenuItem value="">
                        <em>Secilmedi</em>
                      </MenuItem>
                      {returnPolicies.map((rp) => (
                        <MenuItem key={rp.return_policy_id} value={String(rp.return_policy_id)}>
                          {rp.description || `Politika #${rp.return_policy_id}`}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <Divider sx={{ my: 0.5 }} />

                  {/* Processing time */}
                  <Typography variant="body2" fontWeight={500}>
                    Hazirlama suresi (gun)
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label="Min"
                      type="number"
                      value={fields.processing_min}
                      onChange={(e) =>
                        updateField('processing_min', e.target.value ? parseInt(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 1 }}
                    />
                    <TextField
                      label="Max"
                      type="number"
                      value={fields.processing_max}
                      onChange={(e) =>
                        updateField('processing_max', e.target.value ? parseInt(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 1 }}
                    />
                  </Box>

                  <Divider sx={{ my: 0.5 }} />

                  {/* Weight */}
                  <Typography variant="body2" fontWeight={500}>
                    Agirlik
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <TextField
                      label="Agirlik"
                      type="number"
                      value={fields.item_weight}
                      onChange={(e) =>
                        updateField('item_weight', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 80 }}>
                      <InputLabel>Birim</InputLabel>
                      <Select
                        value={fields.item_weight_unit}
                        label="Birim"
                        onChange={(e: SelectChangeEvent) => updateField('item_weight_unit', e.target.value)}
                      >
                        {WEIGHT_UNITS.map((u) => (
                          <MenuItem key={u.value} value={u.value}>
                            {u.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>

                  {/* Dimensions */}
                  <Typography variant="body2" fontWeight={500}>
                    Boyutlar
                  </Typography>
                  <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                    <TextField
                      label="Uzunluk"
                      type="number"
                      value={fields.item_length}
                      onChange={(e) =>
                        updateField('item_length', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label="Genislik"
                      type="number"
                      value={fields.item_width}
                      onChange={(e) =>
                        updateField('item_width', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <TextField
                      label="Yukseklik"
                      type="number"
                      value={fields.item_height}
                      onChange={(e) =>
                        updateField('item_height', e.target.value ? parseFloat(e.target.value) : '')
                      }
                      size="small"
                      sx={{ flex: 1, minWidth: 80 }}
                      inputProps={{ min: 0, step: 0.1 }}
                    />
                    <FormControl size="small" sx={{ minWidth: 70 }}>
                      <InputLabel>Birim</InputLabel>
                      <Select
                        value={fields.item_dimensions_unit}
                        label="Birim"
                        onChange={(e: SelectChangeEvent) =>
                          updateField('item_dimensions_unit', e.target.value)
                        }
                      >
                        {DIMENSION_UNITS.map((u) => (
                          <MenuItem key={u.value} value={u.value}>
                            {u.label}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  </Box>
                </Box>
              </AccordionDetails>
            </Accordion>

            {/* ============================================================ */}
            {/* 9. Islemler */}
            {/* ============================================================ */}
            <Accordion
              expanded={expanded === 'actions'}
              onChange={handleAccordionChange('actions')}
              disableGutters
              elevation={0}
              sx={{ '&:before': { display: 'none' } }}
            >
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <Typography fontWeight={600}>Islemler</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                  {/* Publish — only for draft/inactive */}
                  {(listing.state === 'draft' || listing.state === 'inactive') && (
                    <Button
                      variant="contained"
                      color="success"
                      startIcon={publishing ? <CircularProgress size={18} color="inherit" /> : <PublishIcon />}
                      onClick={handlePublish}
                      disabled={publishing}
                      fullWidth
                    >
                      {publishing ? 'Yayinlaniyor...' : 'Yayinla'}
                    </Button>
                  )}

                  {/* Deactivate — only for active */}
                  {listing.state === 'active' && (
                    <Button
                      variant="outlined"
                      color="warning"
                      startIcon={
                        deactivating ? <CircularProgress size={18} color="inherit" /> : <BlockIcon />
                      }
                      onClick={handleDeactivate}
                      disabled={deactivating}
                      fullWidth
                    >
                      {deactivating ? 'Deaktif ediliyor...' : 'Deaktif Et'}
                    </Button>
                  )}

                  {/* Copy */}
                  <Button
                    variant="outlined"
                    startIcon={copying ? <CircularProgress size={18} /> : <ContentCopyIcon />}
                    onClick={handleCopy}
                    disabled={copying}
                    fullWidth
                  >
                    {copying ? 'Kopyalaniyor...' : 'Kopyala'}
                  </Button>

                  {/* Delete */}
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={() => setDeleteDialogOpen(true)}
                    fullWidth
                  >
                    Sil
                  </Button>
                </Box>
              </AccordionDetails>
            </Accordion>
          </Box>
        ) : null}

        {/* ================================================================ */}
        {/* Footer — Save button */}
        {/* ================================================================ */}
        {fields && listing && !loading && !fetchError && (
          <Box
            sx={{
              position: 'sticky',
              bottom: 0,
              p: 2,
              borderTop: '1px solid',
              borderColor: 'divider',
              bgcolor: 'background.paper',
              zIndex: 10,
            }}
          >
            <Button
              variant="contained"
              fullWidth
              size="large"
              startIcon={saving ? <CircularProgress size={20} color="inherit" /> : <SaveIcon />}
              onClick={handleSave}
              disabled={saving || !hasChanges()}
            >
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </Box>
        )}
      </Drawer>

      {/* ================================================================ */}
      {/* Delete Confirmation Dialog */}
      {/* ================================================================ */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Listeyi Sil</DialogTitle>
        <DialogContent>
          <Typography>
            Bu listeyi kalici olarak silmek istediginizden emin misiniz? Bu islem geri alinamaz.
          </Typography>
          {listing?.title && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              &ldquo;{listing.title}&rdquo;
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>
            Iptal
          </Button>
          <Button
            onClick={handleDelete}
            color="error"
            variant="contained"
            disabled={deleting}
            startIcon={deleting ? <CircularProgress size={18} color="inherit" /> : <DeleteIcon />}
          >
            {deleting ? 'Siliniyor...' : 'Sil'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
