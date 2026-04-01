import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  Box, Typography, Paper, Button, IconButton, TextField, Select, MenuItem,
  Chip, FormControl, InputLabel, Divider, useMediaQuery, useTheme, InputAdornment,
  CircularProgress, LinearProgress, SwipeableDrawer, List, ListItem, ListItemButton,
  ListItemText, Dialog, DialogTitle, DialogContent, DialogActions, ToggleButton, ToggleButtonGroup,
  Collapse, Checkbox, Tooltip, Badge,
} from '@mui/material';
import {
  Close as CloseIcon,
  Search as SearchIcon,
  Image as ImageIcon,
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
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';

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
  state: string;
  shop_section_id: number | null;
  thumbnail?: { url_75x75?: string; url_170x135?: string } | null;
}

interface ShopSection {
  shop_section_id: number;
  title: string;
}

interface BulkEditorProps {
  open: boolean;
  onClose: () => void;
  listings: SelectedListing[];
  shopId: string;
  shopName?: string;
  shopSections: ShopSection[];
  onCompleted: () => void;
}

type FieldCategory = 'title' | 'description' | 'tags' | 'price' | 'section' | 'state';

type OperationType =
  | 'ai_optimize' | 'add_before' | 'add_after' | 'find_replace' | 'delete' | 'change_to'
  | 'add' | 'remove'
  | 'increase_pct' | 'decrease_pct' | 'increase_fixed' | 'decrease_fixed' | 'set_price'
  | 'set_section'
  | 'activate' | 'deactivate';

interface PendingChange {
  title?: string;
  description?: string;
  tags?: string[];
  price?: number;
  shop_section_id?: number;
  state?: string;
}

// ---------------------------------------------------------------------------
// Field definitions
// ---------------------------------------------------------------------------

interface FieldDef {
  key: FieldCategory;
  label: string;
  group: string;
  icon: React.ReactNode;
  operations: { value: OperationType; label: string }[];
}

const FIELD_DEFS: FieldDef[] = [
  {
    key: 'title', label: 'Baslik', group: 'Listing',
    icon: <TitleIcon fontSize="small" />,
    operations: [
      { value: 'ai_optimize', label: 'AI Optimize' },
      { value: 'add_before', label: 'Basina Ekle' },
      { value: 'add_after', label: 'Sonuna Ekle' },
      { value: 'find_replace', label: 'Bul & Degistir' },
      { value: 'delete', label: 'Temizle' },
      { value: 'change_to', label: 'Degistir' },
    ],
  },
  {
    key: 'description', label: 'Aciklama', group: 'Listing',
    icon: <DescriptionIcon fontSize="small" />,
    operations: [
      { value: 'ai_optimize', label: 'AI Optimize' },
      { value: 'add_before', label: 'Basina Ekle' },
      { value: 'add_after', label: 'Sonuna Ekle' },
      { value: 'find_replace', label: 'Bul & Degistir' },
      { value: 'delete', label: 'Temizle' },
      { value: 'change_to', label: 'Degistir' },
    ],
  },
  {
    key: 'tags', label: 'Etiketler', group: 'Listing',
    icon: <TagIcon fontSize="small" />,
    operations: [
      { value: 'ai_optimize', label: 'AI Optimize' },
      { value: 'add', label: 'Ekle' },
      { value: 'remove', label: 'Sil' },
      { value: 'change_to', label: 'Degistir' },
    ],
  },
  {
    key: 'price', label: 'Fiyat', group: 'Envanter',
    icon: <PriceIcon fontSize="small" />,
    operations: [
      { value: 'increase_pct', label: '% Artir' },
      { value: 'decrease_pct', label: '% Azalt' },
      { value: 'increase_fixed', label: '$ Artir' },
      { value: 'decrease_fixed', label: '$ Azalt' },
      { value: 'set_price', label: 'Fiyat Belirle' },
    ],
  },
  {
    key: 'section', label: 'Bolum', group: 'Listing',
    icon: <FolderIcon fontSize="small" />,
    operations: [
      { value: 'set_section', label: 'Bolum Sec' },
    ],
  },
  {
    key: 'state', label: 'Durum', group: 'Yonetim',
    icon: <InventoryIcon fontSize="small" />,
    operations: [
      { value: 'activate', label: 'Yayinla' },
      { value: 'deactivate', label: 'Deaktif Et' },
    ],
  },
];

const GROUPS = ['Listing', 'Envanter', 'Yonetim'];

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
// Component
// ---------------------------------------------------------------------------

export default function BulkEditor({ open, onClose, listings, shopId, shopName, shopSections, onCompleted }: BulkEditorProps) {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // Navigation
  const [activeField, setActiveField] = useState<FieldCategory>('title');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Search within selected listings
  const [searchTerm, setSearchTerm] = useState('');

  // Operation state
  const [operation, setOperation] = useState<OperationType>('add_before');
  const [inputValue, setInputValue] = useState('');
  const [findValue, setFindValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [targetSectionId, setTargetSectionId] = useState<number | ''>('');

  // Per-listing changes & selection
  const [pendingChanges, setPendingChanges] = useState<Map<number, PendingChange>>(new Map());
  const [checkedIds, setCheckedIds] = useState<Set<number>>(() => new Set(listings.map(l => l.listing_id)));

  // Saving
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState(0);

  // AI processing
  const [aiProcessing, setAiProcessing] = useState(false);
  const [aiProgress, setAiProgress] = useState(0);

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

  // Get effective value for a listing field (pending change or original)
  const getFieldValue = useCallback((listing: SelectedListing, field: FieldCategory): any => {
    const pending = pendingChanges.get(listing.listing_id);
    switch (field) {
      case 'title': return pending?.title ?? listing.title;
      case 'description': return pending?.description ?? (listing.description || '');
      case 'tags': return pending?.tags ?? listing.tags;
      case 'price': {
        if (pending?.price !== undefined) return pending.price;
        return listing.price ? listing.price.amount / (listing.price.divisor || 100) : 0;
      }
      case 'section': return pending?.shop_section_id ?? listing.shop_section_id;
      case 'state': return pending?.state ?? listing.state;
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
      toast.error('Hicbir listing secili degil');
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
            case 'ai_optimize': return; // handled separately
          }
          updatePending(listing.listing_id, { [activeField]: newVal });
          break;
        }
        case 'tags': {
          let newTags = [...(current as string[])];
          switch (operation) {
            case 'add': {
              const adding = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0 && t.length <= 20);
              newTags = [...new Set([...newTags, ...adding])].slice(0, 13);
              break;
            }
            case 'remove': {
              const removing = tagsInput.split(',').map(t => t.trim().toLowerCase());
              newTags = newTags.filter(t => !removing.includes(t.toLowerCase()));
              break;
            }
            case 'change_to': {
              newTags = tagsInput.split(',').map(t => t.trim()).filter(t => t.length > 0 && t.length <= 20).slice(0, 13);
              break;
            }
            case 'ai_optimize': return; // handled separately
          }
          updatePending(listing.listing_id, { tags: newTags });
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
          updatePending(listing.listing_id, { price: Math.round(newPrice * 100) / 100 });
          break;
        }
        case 'section': {
          if (targetSectionId !== '') {
            updatePending(listing.listing_id, { shop_section_id: targetSectionId as number });
          }
          break;
        }
        case 'state': {
          updatePending(listing.listing_id, { state: operation === 'activate' ? 'active' : 'inactive' });
          break;
        }
      }
    });

    toast.success(`${checked.length} listing guncellendi (henuz kaydedilmedi)`);
  }, [filteredListings, checkedIds, activeField, operation, inputValue, findValue, replaceValue, tagsInput, targetSectionId, getFieldValue, updatePending]);

  // AI optimize
  const handleAIOptimize = useCallback(async () => {
    const checked = filteredListings.filter(l => checkedIds.has(l.listing_id));
    if (checked.length === 0) return;

    setAiProcessing(true);
    setAiProgress(0);

    try {
      const res = await fetch('/api/ai/etsy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_optimize',
          listings: checked.map(l => ({
            listing_id: l.listing_id,
            title: getFieldValue(l, 'title'),
            tags: getFieldValue(l, 'tags'),
            description: activeField === 'description' ? getFieldValue(l, 'description') : undefined,
          })),
        }),
      });

      if (!res.ok) throw new Error('AI request failed');
      const data = await res.json();
      const optimized = data.optimized || [];

      optimized.forEach((opt: any, idx: number) => {
        setAiProgress(Math.round(((idx + 1) / optimized.length) * 100));
        const changes: PendingChange = {};
        if (activeField === 'title' && opt.title) changes.title = opt.title;
        if (activeField === 'description' && opt.description) changes.description = opt.description;
        if (activeField === 'tags' && opt.tags) changes.tags = opt.tags;
        if (Object.keys(changes).length > 0) {
          updatePending(opt.listing_id, changes);
        }
      });

      toast.success(`AI ${optimized.length} listing icin oneriler uyguladi`);
    } catch (err) {
      toast.error('AI optimizasyon basarisiz');
    } finally {
      setAiProcessing(false);
    }
  }, [filteredListings, checkedIds, activeField, getFieldValue, updatePending]);

  // Save all pending changes to Etsy
  const handleSave = useCallback(async () => {
    if (pendingChanges.size === 0) {
      toast('Kaydedilecek degisiklik yok');
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
        if (changes.price !== undefined) body.price = changes.price;
        if (changes.shop_section_id !== undefined) body.shop_section_id = changes.shop_section_id;
        if (changes.state !== undefined) body.state = changes.state;

        const res = await callUpdateListing(shopId, listingId, body);
        if (res.ok) success++;
        else failed++;
      } catch {
        failed++;
      }
      setSaveProgress(Math.round(((i + 1) / entries.length) * 100));
      // Small delay to avoid rate limiting
      if (i < entries.length - 1) await new Promise(r => setTimeout(r, 100));
    }

    setSaving(false);

    if (failed === 0) {
      toast.success(`${success} listing basariyla guncellendi`);
      setPendingChanges(new Map());
      onCompleted();
    } else {
      toast.error(`${success} basarili, ${failed} basarisiz`);
    }
  }, [pendingChanges, shopId, onCompleted]);

  // Toggle all checkboxes
  const handleToggleAll = useCallback(() => {
    const allIds = filteredListings.map(l => l.listing_id);
    const allChecked = allIds.every(id => checkedIds.has(id));
    if (allChecked) {
      setCheckedIds(new Set());
    } else {
      setCheckedIds(new Set(allIds));
    }
  }, [filteredListings, checkedIds]);

  const allChecked = filteredListings.length > 0 && filteredListings.every(l => checkedIds.has(l.listing_id));
  const someChecked = filteredListings.some(l => checkedIds.has(l.listing_id)) && !allChecked;

  // Close handler with unsaved warning
  const handleClose = useCallback(() => {
    if (pendingChanges.size > 0) {
      if (!confirm(`${pendingChanges.size} kaydedilmemis degisiklik var. Cikmak istediginize emin misiniz?`)) return;
    }
    setPendingChanges(new Map());
    onClose();
  }, [pendingChanges, onClose]);

  if (!open) return null;

  // ---------------------------------------------------------------------------
  // Left sidebar content
  // ---------------------------------------------------------------------------
  const sidebarContent = (
    <Box sx={{ py: 1 }}>
      {GROUPS.map(group => {
        const fields = FIELD_DEFS.filter(f => f.group === group);
        return (
          <Box key={group} sx={{ mb: 1 }}>
            <Typography
              variant="caption"
              sx={{ px: 2, py: 0.5, display: 'block', color: 'text.secondary', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, fontSize: '0.65rem' }}
            >
              {group}
            </Typography>
            {fields.map(field => (
              <ListItemButton
                key={field.key}
                selected={activeField === field.key}
                onClick={() => handleFieldChange(field.key)}
                sx={{
                  py: 1, px: 2, minHeight: 40,
                  '&.Mui-selected': { bgcolor: 'primary.50', borderLeft: '3px solid', borderColor: 'primary.main', color: 'primary.main' },
                }}
              >
                <Box sx={{ mr: 1.5, display: 'flex', alignItems: 'center', color: 'inherit' }}>{field.icon}</Box>
                <ListItemText
                  primary={field.label}
                  primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: activeField === field.key ? 700 : 500 }}
                />
              </ListItemButton>
            ))}
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
    const isAI = operation === 'ai_optimize';
    const isFindReplace = operation === 'find_replace';

    return (
      <Paper sx={{ px: 2, py: 1.5, mb: 1.5, display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
        {/* Operation select */}
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <Select
            value={operation}
            onChange={(e) => setOperation(e.target.value as OperationType)}
            sx={{ fontSize: '0.85rem', fontWeight: 600, bgcolor: 'primary.50' }}
          >
            {ops.map(op => (
              <MenuItem key={op.value} value={op.value}>
                {op.value === 'ai_optimize' && '🤖 '}{op.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Input fields based on operation */}
        {isAI ? (
          <TextField
            size="small"
            placeholder="Ek talimat (opsiyonel)..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            sx={{ flex: 1, minWidth: 150 }}
          />
        ) : isFindReplace ? (
          <>
            <TextField
              size="small"
              placeholder="Bul..."
              value={findValue}
              onChange={(e) => setFindValue(e.target.value)}
              sx={{ flex: 1, minWidth: 100 }}
            />
            <TextField
              size="small"
              placeholder="Degistir..."
              value={replaceValue}
              onChange={(e) => setReplaceValue(e.target.value)}
              sx={{ flex: 1, minWidth: 100 }}
            />
          </>
        ) : activeField === 'tags' ? (
          <TextField
            size="small"
            placeholder="Etiketler (virgul ile)..."
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
              <MenuItem value="" disabled>Bolum sec...</MenuItem>
              {shopSections.map(s => (
                <MenuItem key={s.shop_section_id} value={s.shop_section_id}>{s.title}</MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : activeField === 'state' ? null : (
          <TextField
            size="small"
            placeholder={activeField === 'price' ? 'Miktar...' : `${fieldDef.label}...`}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            sx={{ flex: 1, minWidth: 150 }}
            type={activeField === 'price' ? 'number' : 'text'}
            InputProps={activeField === 'price' ? {
              startAdornment: <InputAdornment position="start">{operation.includes('pct') ? '%' : '$'}</InputAdornment>,
            } : undefined}
          />
        )}

        {/* Apply button */}
        <Button
          variant="contained"
          size="small"
          onClick={isAI ? handleAIOptimize : handleApply}
          disabled={saving || aiProcessing}
          sx={{
            minHeight: 40, px: 3, fontWeight: 700, textTransform: 'none',
            background: isAI ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)' : undefined,
          }}
        >
          {aiProcessing ? <CircularProgress size={18} sx={{ color: 'white' }} /> : 'Uygula'}
        </Button>
      </Paper>
    );
  };

  // ---------------------------------------------------------------------------
  // Per-listing row
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
          p: 1.5, mb: 1,
          borderColor: hasPending ? 'primary.main' : 'divider',
          borderWidth: hasPending ? 2 : 1,
          bgcolor: hasPending ? 'primary.50' : 'background.paper',
          opacity: isChecked ? 1 : 0.5,
        }}
      >
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
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
              width: 48, height: 48, borderRadius: 1, bgcolor: '#f1f5f9', flexShrink: 0,
              backgroundImage: listing.thumbnail?.url_75x75 ? `url(${listing.thumbnail.url_75x75})` : 'none',
              backgroundSize: 'cover', backgroundPosition: 'center',
            }}
          />

          {/* Content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Title (always visible as context) */}
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {listing.title}
            </Typography>

            {/* Field-specific editor */}
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
                <Typography variant="caption" color={(140 - (value as string).length) < 0 ? 'error' : 'text.secondary'}>
                  {140 - (value as string).length} karakter kaldi
                </Typography>
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
                  maxRows={4}
                  sx={{ '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
              </Box>
            )}

            {activeField === 'tags' && (
              <Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {(value as string[]).map((tag, i) => (
                    <Chip
                      key={`${tag}-${i}`}
                      label={tag}
                      size="small"
                      onDelete={() => {
                        const newTags = (value as string[]).filter((_, idx) => idx !== i);
                        updatePending(listing.listing_id, { tags: newTags });
                      }}
                      sx={{ height: 26, fontSize: '0.75rem' }}
                    />
                  ))}
                </Box>
                <Typography variant="caption" color={(value as string[]).length >= 13 ? 'error' : 'text.secondary'}>
                  {(value as string[]).length}/13 etiket
                </Typography>
              </Box>
            )}

            {activeField === 'price' && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <TextField
                  size="small"
                  type="number"
                  value={value as number}
                  onChange={(e) => updatePending(listing.listing_id, { price: parseFloat(e.target.value) || 0 })}
                  InputProps={{
                    startAdornment: <InputAdornment position="start">$</InputAdornment>,
                  }}
                  sx={{ maxWidth: 150, '& .MuiInputBase-input': { fontSize: '0.85rem' } }}
                />
                {listing.price && (
                  <Typography variant="caption" color="text.secondary">
                    (orijinal: ${(listing.price.amount / (listing.price.divisor || 100)).toFixed(2)})
                  </Typography>
                )}
              </Box>
            )}

            {activeField === 'section' && (
              <FormControl size="small" sx={{ minWidth: 200 }}>
                <Select
                  value={value as number || ''}
                  onChange={(e) => updatePending(listing.listing_id, { shop_section_id: e.target.value as number })}
                  displayEmpty
                  sx={{ fontSize: '0.85rem' }}
                >
                  <MenuItem value="">Bolum yok</MenuItem>
                  {shopSections.map(s => (
                    <MenuItem key={s.shop_section_id} value={s.shop_section_id}>{s.title}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}

            {activeField === 'state' && (
              <Chip
                label={value === 'active' ? 'Aktif' : value === 'inactive' ? 'Deaktif' : value === 'draft' ? 'Taslak' : String(value)}
                size="small"
                color={value === 'active' ? 'success' : value === 'inactive' ? 'default' : 'warning'}
              />
            )}
          </Box>
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
          display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1,
          borderBottom: '1px solid', borderColor: 'divider', bgcolor: 'white',
          position: 'sticky', top: 0, zIndex: 10,
        }}
      >
        {isMobile && (
          <IconButton onClick={() => setSidebarOpen(true)} size="small">
            <MenuIcon />
          </IconButton>
        )}

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {shopName && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
              Etsy · {shopName}
            </Typography>
          )}
          <Typography variant="subtitle1" fontWeight={700}>
            {listings.length} listing duzenleniyor
          </Typography>
        </Box>

        {pendingCount > 0 && (
          <Badge badgeContent={pendingCount} color="primary" sx={{ mr: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 600 }}>degisiklik</Typography>
          </Badge>
        )}

        <Button
          variant="outlined"
          size="small"
          onClick={handleClose}
          sx={{ minHeight: 36, textTransform: 'none', fontWeight: 600, borderRadius: '8px' }}
        >
          Iptal
        </Button>

        <Button
          variant="contained"
          size="small"
          onClick={handleSave}
          disabled={saving || pendingCount === 0}
          startIcon={saving ? <CircularProgress size={16} sx={{ color: 'white' }} /> : <SaveIcon />}
          sx={{
            minHeight: 36, textTransform: 'none', fontWeight: 700, borderRadius: '8px',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            '&:hover': { background: 'linear-gradient(135deg, #059669, #047857)' },
          }}
        >
          {saving ? `Kaydediliyor... ${saveProgress}%` : `Kaydet (${pendingCount})`}
        </Button>
      </Box>

      {/* Progress bar */}
      {(saving || aiProcessing) && (
        <LinearProgress variant="determinate" value={saving ? saveProgress : aiProgress} sx={{ height: 3 }} />
      )}

      {/* Body */}
      <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Desktop sidebar */}
        {!isMobile && (
          <Box
            sx={{
              width: 200, flexShrink: 0, bgcolor: 'white', borderRight: '1px solid', borderColor: 'divider',
              overflowY: 'auto',
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
          >
            <Box sx={{ width: 240, pt: 2 }}>
              <Typography variant="subtitle2" sx={{ px: 2, pb: 1, fontWeight: 700 }}>
                Alan Sec
              </Typography>
              {sidebarContent}
            </Box>
          </SwipeableDrawer>
        )}

        {/* Main content */}
        <Box sx={{ flex: 1, overflow: 'auto', p: { xs: 1, sm: 2 } }}>
          {/* Action bar */}
          {renderActionBar()}

          {/* Search + select all */}
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mb: 1.5 }}>
            <Checkbox
              checked={allChecked}
              indeterminate={someChecked}
              onChange={handleToggleAll}
              sx={{ p: 0.5 }}
            />
            <TextField
              size="small"
              placeholder="Ara..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              sx={{ flex: 1, maxWidth: 400 }}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 18 }} /></InputAdornment>,
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {filteredListings.length} listing
            </Typography>
          </Box>

          {/* Listing rows */}
          {filteredListings.map(listing => renderListingRow(listing))}
        </Box>
      </Box>
    </Dialog>
  );
}
