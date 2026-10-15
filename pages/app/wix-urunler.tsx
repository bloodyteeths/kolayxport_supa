import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Box, Button, CircularProgress, Collapse, Tooltip, TextField, Select, MenuItem,
  FormControl, IconButton, Typography, Paper, Chip, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions, useMediaQuery, useTheme,
  SwipeableDrawer, Checkbox, Divider,
} from '@mui/material';
import {
  DataGrid, GridColDef, GridPaginationModel, GridRenderCellParams,
  GridRowSelectionModel, GridRowId,
} from '@mui/x-data-grid';
import {
  Search as SearchIcon, Edit as EditIcon, Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
  FilterList as FilterListIcon,
  Close as CloseIcon, 
  TextFields as TextFieldsIcon,
  CloudUpload as CloudUploadIcon, Undo as UndoIcon, ErrorOutline as ErrorOutlineIcon,
} from '@mui/icons-material';
import { Page, PageHeader, SyncMeta } from '@/components/ds/page';
import { icons } from '@/lib/ds/icons';
import withAuth from '@/components/withAuth';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';

import WixProductEditorDrawer from '@/components/wix/WixProductEditorDrawer';
import WixProductCreatorDialog from '@/components/wix/WixProductCreatorDialog';
import WixBulkOperationsBar from '@/components/wix/WixBulkOperationsBar';
import { RequireConnection } from '@/components/ui/ConnectEmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { notify, getErrorMessage, isUsageLimitError } from '@/lib/notify';
import { useConfirm } from '@/lib/hooks/useConfirm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WixProductRow {
  id: string;
  wixProductId: string;
  title: string;
  description: string | null;
  price: number | null;
  discountPrice: number | null;
  currency: string;
  quantity: number;
  visible: boolean;
  sku: string | null;
  weight: number | null;
  thumbnailUrl: string | null;
  imageCount: number;
  images: any;
  collectionIds: string[] | null;
  ribbon: string | null;
  brand: string | null;
  productType: string | null;
  customTextFields: Array<{ title: string; mandatory: boolean; maxLength: number }> | null;
  wixUpdatedDate: string | null;
  syncedAt: string;
  trackInventory?: boolean;
  variants?: unknown;
}

/**
 * Inline stock edits are only safe for single-variant products with inventory tracking on:
 * the inventory route only adjusts the first variant, and untracked products have no real count.
 */
function canEditStock(p: Pick<WixProductRow, 'trackInventory' | 'variants'>): boolean {
  if (p.trackInventory === false) return false;
  return !Array.isArray(p.variants) || p.variants.length <= 1;
}

/** Locally staged inline edits for one product. Nothing reaches Wix until "Save to Wix". */
interface StagedEdit {
  title?: string;
  price?: number;
  quantity?: number;
}
type StagedField = keyof StagedEdit;
const STAGED_FIELDS: StagedField[] = ['title', 'price', 'quantity'];

/** Error carrying HTTP status + parsed body so notify/getErrorMessage can read them. */
async function putJson(url: string, body: unknown): Promise<any> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err: any = new Error(`Request failed with status code ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function isValidPrice(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}
function isValidQuantity(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

interface WixCollection {
  id: string;
  name: string;
}

interface WixSiteInfo {
  id: string;
  siteId: string;
  siteName: string;
}

interface StatusCounts {
  visible: number;
  hidden: number;
  all: number;
}

// ---------------------------------------------------------------------------
// Health Score
// ---------------------------------------------------------------------------

function calculateHealth(p: WixProductRow) {
  const imgCount = p.imageCount || 0;
  const titleLen = (p.title || '').length;
  const descLen = (p.description || '').length;
  const colCount = Array.isArray(p.collectionIds) ? p.collectionIds.length : 0;

  const images = Math.min(25, Math.round((Math.min(imgCount, 10) / 10) * 25));
  const title = Math.min(25, Math.round((Math.min(titleLen, 140) / 140) * 25));
  const desc = Math.min(25, Math.round((Math.min(descLen, 500) / 500) * 25));
  const collections = Math.min(25, Math.round((Math.min(colCount, 3) / 3) * 25));
  return { total: images + title + desc + collections, images, title, desc, collections };
}

function gradeColor(score: number): string {
  if (score >= 80) return '#4caf50';
  if (score >= 60) return '#ff9800';
  if (score >= 40) return '#f57c00';
  return '#f44336';
}

// ---------------------------------------------------------------------------
// Mobile Card
// ---------------------------------------------------------------------------

/** Number input that keeps a local string while typing and commits on blur/Enter. */
function StagedNumberField({
  label, value, integer, dirty, onCommit, onInvalid, disabled, helperText,
}: {
  label: string;
  value: number | null;
  integer?: boolean;
  dirty: boolean;
  disabled?: boolean;
  helperText?: string;
  onCommit: (n: number) => void;
  onInvalid: () => void;
}) {
  const [text, setText] = useState(value != null ? String(value) : '');
  useEffect(() => { setText(value != null ? String(value) : ''); }, [value]);

  const commit = () => {
    const trimmed = text.trim().replace(',', '.');
    if (trimmed === '' && value == null) return;
    const n = Number(trimmed);
    const ok = trimmed !== '' && (integer ? isValidQuantity(n) : isValidPrice(n));
    if (!ok) {
      onInvalid();
      setText(value != null ? String(value) : '');
      return;
    }
    if (n !== value) onCommit(n);
  };

  return (
    <TextField
      label={label}
      size="small"
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      inputProps={{ inputMode: integer ? 'numeric' : 'decimal' }}
      disabled={disabled}
      helperText={helperText}
      fullWidth
      sx={{
        '& .MuiInputBase-root': { minHeight: 44 },
        ...(dirty ? { '& .MuiOutlinedInput-notchedOutline': { borderColor: 'warning.main', borderWidth: 2 } } : {}),
      }}
    />
  );
}

function MobileWixProductCard({
  product, selected, onToggleSelect, onEdit, onDelete, collections, t,
  dirtyFields, saveError, onStage, onInvalid, editLocked,
}: {
  product: WixProductRow;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  collections: WixCollection[];
  t: any;
  dirtyFields: StagedField[];
  saveError?: string;
  onStage: (patch: StagedEdit) => void;
  onInvalid: (field: StagedField) => void;
  editLocked: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const stockEditable = canEditStock(product);
  const isDirty = dirtyFields.length > 0;
  const health = calculateHealth(product);
  const colNames = (product.collectionIds || [])
    .map(id => collections.find(c => c.id === id)?.name)
    .filter(Boolean);

  return (
    <Paper sx={{
      mb: 1, overflow: 'hidden',
      ...(saveError ? { borderLeft: 4, borderColor: 'error.main' } : isDirty ? { borderLeft: 4, borderColor: 'warning.main' } : {}),
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1, gap: 1 }}>
        <Checkbox checked={selected} onChange={onToggleSelect} sx={{ p: 1.25 }} />
        <Box sx={{ width: 48, height: 48, borderRadius: 1, overflow: 'hidden', flexShrink: 0 }}>
          <img
            src={product.thumbnailUrl || '/placeholder.png'}
            alt=""
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.png'; }}
            loading="lazy"
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" fontWeight={600} noWrap onClick={onEdit} sx={{ cursor: 'pointer' }}>
            {product.title || '—'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25 }}>
            <Typography variant="caption" color="text.secondary">
              {product.price != null ? `${Number(product.price).toFixed(2)} ${product.currency}` : '—'}
            </Typography>
            <Typography variant="caption" color={product.trackInventory !== false && product.quantity === 0 ? 'error.main' : 'text.secondary'}>
              &middot; {product.trackInventory === false ? '—' : product.quantity} {t('stockCol')}
            </Typography>
            <Chip
              label={product.visible ? t('statusVisible') : t('statusHidden')}
              size="small"
              color={product.visible ? 'success' : 'default'}
              variant="outlined"
              sx={{ height: 18, fontSize: '0.65rem', ml: 0.5 }}
            />
            {isDirty && (
              <Chip
                label={t('stagedUnsaved')}
                size="small"
                color="warning"
                sx={{ height: 18, fontSize: '0.65rem' }}
              />
            )}
          </Box>
        </Box>
        <Chip
          label={health.total}
          size="small"
          sx={{ bgcolor: gradeColor(health.total), color: '#fff', fontWeight: 600, minWidth: 32, height: 22 }}
        />
        <IconButton
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? t('collapseCard') : t('expandCard')}
          aria-expanded={expanded}
          sx={{ width: 44, height: 44 }}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1, pb: 1, pt: 0 }}>
          {saveError && (
            <Typography variant="caption" color="error" sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
              <ErrorOutlineIcon sx={{ fontSize: 14 }} /> {saveError}
            </Typography>
          )}
          {/* Staged quick edits — kept locally until "Save to Wix" */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
            <StagedNumberField
              label={`${t('priceCol')} (${product.currency || 'TRY'})`}
              value={product.price != null ? Number(product.price) : null}
              dirty={dirtyFields.includes('price')}
              disabled={editLocked}
              onCommit={(n) => onStage({ price: n })}
              onInvalid={() => onInvalid('price')}
            />
            <StagedNumberField
              label={t('stockCol')}
              value={product.trackInventory === false ? null : (product.quantity ?? 0)}
              integer
              dirty={dirtyFields.includes('quantity')}
              disabled={editLocked || !stockEditable}
              helperText={stockEditable ? undefined : t('stagedStockNotEditable')}
              onCommit={(n) => onStage({ quantity: n })}
              onInvalid={() => onInvalid('quantity')}
            />
          </Box>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            {colNames.map((name, i) => (
              <Chip key={i} label={name} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
            ))}
            <Chip label={t('imagesCount', { count: product.imageCount })} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />
            {product.sku && <Chip label={`SKU: ${product.sku}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.65rem' }} />}
            {Array.isArray(product.customTextFields) && product.customTextFields.length > 0 && (
              <Chip
                icon={<TextFieldsIcon sx={{ fontSize: 12 }} />}
                label={t('personalizationActive', { count: product.customTextFields.length })}
                size="small" color="primary" variant="outlined"
                sx={{ height: 20, fontSize: '0.65rem' }}
              />
            )}
          </Box>
          {/* Health breakdown */}
          <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
            {health.images < 15 && <Chip label={t('healthMissingImages')} size="small" color="warning" sx={{ height: 20, fontSize: '0.6rem' }} />}
            {health.title < 15 && <Chip label={t('healthShortTitle')} size="small" color="warning" sx={{ height: 20, fontSize: '0.6rem' }} />}
            {health.desc < 15 && <Chip label={t('healthNoDescription')} size="small" color="warning" sx={{ height: 20, fontSize: '0.6rem' }} />}
            {health.collections === 0 && <Chip label={t('healthMissingCollections')} size="small" color="warning" sx={{ height: 20, fontSize: '0.6rem' }} />}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit} fullWidth sx={{ minHeight: 44 }}>
              {t('edit')}
            </Button>
            <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={onDelete} fullWidth sx={{ minHeight: 44 }}>
              {t('delete')}
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Left Sidebar
// ---------------------------------------------------------------------------

function LeftSidebar({
  statusFilter, setStatusFilter, statusCounts,
  healthFilter, setHealthFilter,
  collectionFilter, setCollectionFilter,
  collections, collectionCounts,
  excludeTerm, setExcludeTerm,
  t,
}: {
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  statusCounts: StatusCounts;
  healthFilter: string;
  setHealthFilter: (v: string) => void;
  collectionFilter: string;
  setCollectionFilter: (v: string) => void;
  collections: WixCollection[];
  collectionCounts: Record<string, number>;
  excludeTerm: string;
  setExcludeTerm: (v: string) => void;
  t: any;
}) {
  const [collectionsExpanded, setCollectionsExpanded] = useState(true);

  return (
    <Box sx={{ width: 220, flexShrink: 0, pr: 1.5 }}>
      {/* Status Filters */}
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        {t('columnStatus')}
      </Typography>
      {(['all', 'visible', 'hidden'] as const).map((status) => {
        const count = status === 'all' ? statusCounts.all : status === 'visible' ? statusCounts.visible : statusCounts.hidden;
        const label = status === 'all' ? t('statusAll') : status === 'visible' ? t('statusVisible') : t('statusHidden');
        const isActive = statusFilter === status;
        return (
          <Box
            key={status}
            onClick={() => setStatusFilter(status)}
            sx={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              px: 1, py: 0.5, borderRadius: 1, cursor: 'pointer', mb: 0.25,
              bgcolor: isActive ? 'primary.main' : 'transparent',
              color: isActive ? '#fff' : 'text.primary',
              '&:hover': { bgcolor: isActive ? 'primary.dark' : 'action.hover' },
              fontSize: '0.8rem',
            }}
          >
            <span>{label}</span>
            <Chip label={count} size="small" sx={{
              height: 18, fontSize: '0.65rem', minWidth: 24,
              bgcolor: isActive ? 'rgba(255,255,255,0.2)' : 'action.selected',
              color: isActive ? '#fff' : 'text.secondary',
            }} />
          </Box>
        );
      })}

      <Divider sx={{ my: 1.5 }} />

      {/* Health Filter */}
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        {t('healthLabel')}
      </Typography>
      <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
        <Select
          value={healthFilter}
          onChange={(e) => setHealthFilter(e.target.value)}
          sx={{ fontSize: '0.8rem', height: 32 }}
          displayEmpty
        >
          <MenuItem value="">{t('healthAll')}</MenuItem>
          <MenuItem value="issues">{t('healthIssues')}</MenuItem>
          <MenuItem value="missing_images">{t('healthMissingImages')}</MenuItem>
          <MenuItem value="missing_collections">{t('healthMissingCollections')}</MenuItem>
          <MenuItem value="short_title">{t('healthShortTitle')}</MenuItem>
          <MenuItem value="no_description">{t('healthNoDescription')}</MenuItem>
          <MenuItem value="no_stock">{t('healthNoStock')}</MenuItem>
        </Select>
      </FormControl>

      <Divider sx={{ my: 1.5 }} />

      {/* Collections */}
      <Box
        onClick={() => setCollectionsExpanded(!collectionsExpanded)}
        sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', mb: 0.5 }}
      >
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ flex: 1 }}>
          {t('collectionsLabel')}
        </Typography>
        {collectionsExpanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </Box>
      <Collapse in={collectionsExpanded}>
        <Box
          onClick={() => setCollectionFilter('')}
          sx={{
            display: 'flex', justifyContent: 'space-between', px: 1, py: 0.4, borderRadius: 1, cursor: 'pointer', mb: 0.25,
            bgcolor: !collectionFilter ? 'primary.main' : 'transparent',
            color: !collectionFilter ? '#fff' : 'text.primary',
            '&:hover': { bgcolor: !collectionFilter ? 'primary.dark' : 'action.hover' },
            fontSize: '0.75rem',
          }}
        >
          <span>{t('allCollections')}</span>
        </Box>
        {collections.map(col => {
          const isActive = collectionFilter === col.id;
          return (
            <Box
              key={col.id}
              onClick={() => setCollectionFilter(col.id)}
              sx={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                px: 1, py: 0.4, borderRadius: 1, cursor: 'pointer', mb: 0.25,
                bgcolor: isActive ? 'primary.main' : 'transparent',
                color: isActive ? '#fff' : 'text.primary',
                '&:hover': { bgcolor: isActive ? 'primary.dark' : 'action.hover' },
                fontSize: '0.75rem',
              }}
            >
              <Typography variant="caption" noWrap sx={{ flex: 1, color: 'inherit' }}>{col.name}</Typography>
              {collectionCounts[col.id] != null && (
                <Chip label={collectionCounts[col.id]} size="small" sx={{
                  height: 16, fontSize: '0.6rem', minWidth: 20,
                  bgcolor: isActive ? 'rgba(255,255,255,0.2)' : 'action.selected',
                  color: isActive ? '#fff' : 'text.secondary',
                }} />
              )}
            </Box>
          );
        })}
      </Collapse>

      <Divider sx={{ my: 1.5 }} />

      {/* Exclude */}
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
        {t('excludeLabel')}
      </Typography>
      <TextField
        size="small"
        fullWidth
        placeholder={t('excludePlaceholder')}
        value={excludeTerm}
        onChange={(e) => setExcludeTerm(e.target.value)}
        sx={{ '& .MuiInputBase-root': { height: 30, fontSize: '0.75rem' } }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function WixProductsPage() {
  const t = useTranslations('wixListings');
  const tNav = useTranslations('nav.items');
  return (
    <Page title={tNav('listingsOf', { marketplace: 'Wix' })} width="list">
      <RequireConnection provider="wix" description={t('noSiteConnectedDesc')}>
        <WixProductsContent />
      </RequireConnection>
    </Page>
  );
}

function WixProductsContent() {
  const t = useTranslations('wixListings');
  const tNav = useTranslations('nav.items');
  const tc = useTranslations('common');
  const router = useRouter();
  const confirm = useConfirm();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const isTablet = useMediaQuery(theme.breakpoints.down('lg'));

  // Data state
  const [products, setProducts] = useState<WixProductRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [statusCounts, setStatusCounts] = useState<StatusCounts>({ visible: 0, hidden: 0, all: 0 });
  const [collectionCounts, setCollectionCounts] = useState<Record<string, number>>({});
  const [collections, setCollections] = useState<WixCollection[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<unknown>(null);

  // Staged inline edits (local only, keyed by row id) + per-item failures from the last save
  const [edits, setEdits] = useState<Record<string, StagedEdit>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [savingEdits, setSavingEdits] = useState(false);
  const [failuresOpen, setFailuresOpen] = useState(false);

  // Filter state
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [healthFilter, setHealthFilter] = useState('');
  const [collectionFilter, setCollectionFilter] = useState('');
  const [excludeTerm, setExcludeTerm] = useState('');

  // Selection state
  const [selectedIds, setSelectedIds] = useState<GridRowSelectionModel>({ type: 'include' as const, ids: new Set<GridRowId>() });

  // UI state
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [mobileVisibleCount, setMobileVisibleCount] = useState(20);
  const [drawerProduct, setDrawerProduct] = useState<WixProductRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [deleteConfirmProduct, setDeleteConfirmProduct] = useState<WixProductRow | null>(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  // Cache
  const cacheRef = useRef<Record<string, { data: WixProductRow[]; count: number; statusCounts: StatusCounts; collectionCounts: Record<string, number>; ts: number }>>({});
  // Status filter the current `products` list was loaded with (used to tell "filtered out" from "deleted").
  const productsFilterRef = useRef<string>('all');

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchProducts = useCallback(async (force = false) => {
    const cacheKey = `${statusFilter}`;
    const cached = cacheRef.current[cacheKey];
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL) {
      setFetchError(null);
      productsFilterRef.current = cacheKey;
      setProducts(cached.data);
      setTotalCount(cached.count);
      setStatusCounts(cached.statusCounts);
      setCollectionCounts(cached.collectionCounts);
      return;
    }

    setLoading(true);
    setFetchError(null);
    try {
      const visibleParam = statusFilter === 'all' ? '' : statusFilter === 'visible' ? '&visible=true' : '&visible=false';
      const res = await fetch(`/api/wix/products?action=cached_products&page=${paginationModel.page}&size=500${visibleParam}`);
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw Object.assign(new Error(t('fetchFailed')), { status: res.status, data: body });
      }
      const data = await res.json();
      const prods = data.products || [];
      productsFilterRef.current = cacheKey;
      setProducts(prods);
      setTotalCount(data.count || prods.length);
      if (data.statusCounts) setStatusCounts(data.statusCounts);
      if (data.collectionCounts) setCollectionCounts(data.collectionCounts);

      cacheRef.current[cacheKey] = {
        data: prods, count: data.count || prods.length,
        statusCounts: data.statusCounts || statusCounts,
        collectionCounts: data.collectionCounts || collectionCounts,
        ts: Date.now(),
      };
    } catch (err: unknown) {
      setFetchError(err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, paginationModel.page, t]);

  const fetchCollections = useCallback(async () => {
    try {
      const res = await fetch('/api/wix/collections');
      if (!res.ok) return;
      const data = await res.json();
      setCollections((data.collections || []).map((c: any) => ({ id: c.id || c._id, name: c.name })));
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchCollections(); }, [fetchCollections]);

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/wix/products?action=sync', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw Object.assign(new Error(t('syncFailed')), { status: res.status, data: body });
      }
      const data = await res.json();
      notify.success(`${t('syncSuccess')} (${data.synced})`);
      setLastSyncAt(new Date().toISOString());
      cacheRef.current = {};
      fetchProducts(true);
    } catch (err: unknown) {
      notify.error(err, t('syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async (product: WixProductRow) => {
    try {
      const productId = product.wixProductId || product.id;
      const res = await fetch(`/api/wix/products?action=delete&productId=${productId}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw Object.assign(new Error(t('deleteFailed')), { status: res.status, data: body });
      }
      notify.success(t('deleteSuccess'));
      setDeleteConfirmProduct(null);
      setEdits(prev => {
        if (!(product.id in prev)) return prev;
        const next = { ...prev };
        delete next[product.id];
        return next;
      });
      cacheRef.current = {};
      fetchProducts(true);
    } catch (err: unknown) {
      notify.error(err, t('deleteFailed'));
    }
  };

  // ---------------------------------------------------------------------------
  // Inline editing
  // ---------------------------------------------------------------------------

  const productsById = useMemo(() => {
    const m = new Map<string, WixProductRow>();
    for (const p of products) m.set(p.id, p);
    return m;
  }, [products]);

  /** Merge a patch into the staged edits for a row; fields equal to the synced value are dropped. */
  // Synced snapshot of every staged product, so edits survive a status-filter refetch
  // that no longer includes the product.
  const stagedOrigRef = useRef<Record<string, WixProductRow>>({});

  const stageEdit = useCallback((rowId: string, patch: StagedEdit) => {
    const orig = productsById.get(rowId) || stagedOrigRef.current[rowId];
    if (!orig) return;
    stagedOrigRef.current[rowId] = orig;
    setEdits(prev => {
      const merged: StagedEdit = { ...(prev[rowId] || {}), ...patch };
      if (merged.title !== undefined && merged.title === (orig.title || '')) delete merged.title;
      if (merged.price !== undefined && orig.price != null && merged.price === Number(orig.price)) delete merged.price;
      if (merged.quantity !== undefined && merged.quantity === (orig.quantity ?? 0)) delete merged.quantity;
      const next = { ...prev };
      if (Object.keys(merged).length === 0) delete next[rowId];
      else next[rowId] = merged;
      return next;
    });
    setSaveErrors(prev => {
      if (!(rowId in prev)) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }, [productsById]);

  // After a refetch, drop staged fields that already match Wix (e.g. saved via the drawer).
  useEffect(() => {
    setEdits(prev => {
      let changed = false;
      const next: Record<string, StagedEdit> = {};
      for (const [id, e] of Object.entries(prev)) {
        const orig = productsById.get(id);
        if (!orig) {
          // Keep it only if the current status filter merely hides it; otherwise it was deleted.
          const snap = stagedOrigRef.current[id];
          const f = productsFilterRef.current;
          const filteredOut = !!snap && f !== 'all' && (f === 'visible' ? !snap.visible : !!snap.visible);
          if (filteredOut) next[id] = e;
          else { delete stagedOrigRef.current[id]; changed = true; }
          continue;
        }
        stagedOrigRef.current[id] = orig;
        const kept: StagedEdit = { ...e };
        if (kept.title !== undefined && kept.title === (orig.title || '')) delete kept.title;
        if (kept.price !== undefined && orig.price != null && kept.price === Number(orig.price)) delete kept.price;
        if (kept.quantity !== undefined && kept.quantity === (orig.quantity ?? 0)) delete kept.quantity;
        if (Object.keys(kept).length !== Object.keys(e).length) changed = true;
        if (Object.keys(kept).length > 0) next[id] = kept;
      }
      return changed ? next : prev;
    });
  }, [productsById]);

  /** The drawer always edits the synced product, never the locally staged overlay. */
  const openDrawer = useCallback((row: WixProductRow) => {
    setDrawerProduct(productsById.get(row.id) || row);
    setDrawerOpen(true);
  }, [productsById]);

  const notifyInvalid = useCallback((field: StagedField) => {
    notify.error(field === 'quantity' ? t('stagedInvalidStock') : field === 'price' ? t('stagedInvalidPrice') : t('stagedInvalidTitle'));
  }, [t]);

  // DataGrid inline edit: validate, stage locally, never call Wix here.
  const processRowUpdate = useCallback((newRow: any, oldRow: any) => {
    const patch: StagedEdit = {};
    if (newRow.title !== oldRow.title) {
      const title = typeof newRow.title === 'string' ? newRow.title.trim() : '';
      if (!title) { notifyInvalid('title'); return oldRow; }
      patch.title = title;
    }
    if (newRow.price !== oldRow.price) {
      const price = Number(newRow.price);
      if (newRow.price === null || newRow.price === '' || !isValidPrice(price)) { notifyInvalid('price'); return oldRow; }
      patch.price = price;
    }
    if (newRow.quantity !== oldRow.quantity) {
      if (!canEditStock(oldRow)) return oldRow;
      const qty = Number(newRow.quantity);
      if (newRow.quantity === null || newRow.quantity === '' || !isValidQuantity(qty)) { notifyInvalid('quantity'); return oldRow; }
      patch.quantity = qty;
    }
    if (Object.keys(patch).length === 0) return oldRow;
    stageEdit(newRow.id, patch);
    return { ...newRow, ...patch };
  }, [stageEdit, notifyInvalid]);

  const dirtyCount = Object.keys(edits).length;

  // Warn before leaving the page with unsaved local edits.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirtyCount]);

  // Client-side navigation (sidebar / Next links) never fires beforeunload — guard it too.
  useEffect(() => {
    if (dirtyCount === 0) return;
    const onRouteChangeStart = (url: string) => {
      if (url.split('?')[0] === router.asPath.split('?')[0]) return;
      if (window.confirm(t('stagedLeaveConfirm'))) return;
      router.events.emit('routeChangeError', new Error('Route change aborted'), url, { shallow: false });
      // Throwing is the only way to cancel a Pages Router navigation.
      throw 'Route change aborted: unsaved Wix edits';
    };
    router.events.on('routeChangeStart', onRouteChangeStart);
    return () => router.events.off('routeChangeStart', onRouteChangeStart);
  }, [dirtyCount, router, t]);

  const handleDiscardEdits = async () => {
    const ok = await confirm({
      title: t('stagedDiscardTitle'),
      description: t('stagedDiscardConfirm', { count: dirtyCount }),
      items: Object.keys(edits).map(id => (productsById.get(id) || stagedOrigRef.current[id])?.title || id),
      confirmLabel: t('stagedDiscard'),
      destructive: true,
    });
    if (!ok) return;
    setEdits({});
    setSaveErrors({});
    setFailuresOpen(false);
    stagedOrigRef.current = {};
  };

  /**
   * Explicit push: one update request (+ one inventory request when stock changed) per product.
   * Results are merged into the latest state per product, so edits staged while the save runs
   * are never overwritten (only fields still equal to the value that was sent are cleared).
   */
  const handleSaveEdits = async () => {
    if (savingEdits || dirtyCount === 0) return;
    setSavingEdits(true);
    const entries = Object.entries(edits);
    let okCount = 0;
    let failCount = 0;
    let stopped = false;

    for (const [rowId, edit] of entries) {
      if (stopped) break;
      const orig = productsById.get(rowId) || stagedOrigRef.current[rowId];
      if (!orig) continue;
      const productId = orig.wixProductId || orig.id;
      const done: StagedEdit = {};
      let error: string | null = null;
      try {
        if (edit.title !== undefined || edit.price !== undefined) {
          const body: Record<string, unknown> = { productId };
          if (edit.title !== undefined) body.name = edit.title;
          if (edit.price !== undefined) body.priceData = { price: edit.price };
          await putJson('/api/wix/products?action=update', body);
          if (edit.title !== undefined) done.title = edit.title;
          if (edit.price !== undefined) done.price = edit.price;
        }
        if (edit.quantity !== undefined) {
          await putJson('/api/wix/products?action=inventory', { productId, quantity: edit.quantity });
          done.quantity = edit.quantity;
        }
        okCount++;
      } catch (err: unknown) {
        if (isUsageLimitError(err)) {
          notify.error(err); // handled by LimitReachedDialog; stop pushing the rest
          stopped = true;
        }
        error = getErrorMessage(err, t('updateFailed'));
        failCount++;
      }

      const doneFields = (Object.keys(done) as StagedField[]);
      if (doneFields.length > 0) {
        setProducts(prev => prev.map(p => (p.id === rowId ? { ...p, ...done } : p)));
        if (stagedOrigRef.current[rowId]) stagedOrigRef.current[rowId] = { ...stagedOrigRef.current[rowId], ...done };
        setEdits(prev => {
          const cur = prev[rowId];
          if (!cur) return prev;
          const kept: StagedEdit = { ...cur };
          for (const f of doneFields) {
            if (kept[f] === done[f]) delete kept[f];
          }
          const next = { ...prev };
          if (Object.keys(kept).length === 0) delete next[rowId];
          else next[rowId] = kept;
          return next;
        });
      }
      setSaveErrors(prev => {
        if (error) return { ...prev, [rowId]: error };
        if (!(rowId in prev)) return prev;
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
    }

    if (okCount > 0) cacheRef.current = {};
    setSavingEdits(false);

    if (failCount === 0 && !stopped) {
      notify.success(t('stagedSaveSuccess', { count: okCount }));
    } else if (failCount > 0) {
      setFailuresOpen(true);
      notify.error(t('stagedSavePartial', { ok: okCount, failed: failCount }));
    }
  };

  /** Staged fields on a row, for dirty-cell styling. */
  const dirtyFieldsOf = (rowId: string): StagedField[] => {
    const e = edits[rowId];
    return e ? STAGED_FIELDS.filter(f => e[f] !== undefined) : [];
  };

  // ---------------------------------------------------------------------------
  // Filtering (client-side)
  // ---------------------------------------------------------------------------

  const filteredProducts = useMemo(() => {
    let result = products;

    // Search
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      result = result.filter(p =>
        (p.title || '').toLowerCase().includes(term) ||
        (p.sku || '').toLowerCase().includes(term)
      );
    }

    // Collection filter
    if (collectionFilter) {
      result = result.filter(p =>
        Array.isArray(p.collectionIds) && p.collectionIds.includes(collectionFilter)
      );
    }

    // Health filter
    if (healthFilter) {
      result = result.filter(p => {
        const h = calculateHealth(p);
        switch (healthFilter) {
          case 'issues': return h.total < 60;
          case 'missing_images': return h.images < 15;
          case 'missing_collections': return h.collections === 0;
          case 'short_title': return h.title < 15;
          case 'no_description': return h.desc < 5;
          case 'no_stock': return p.quantity === 0;
          default: return true;
        }
      });
    }

    // Exclude
    if (excludeTerm.trim()) {
      const ex = excludeTerm.toLowerCase();
      result = result.filter(p => !(p.title || '').toLowerCase().includes(ex));
    }

    return result;
  }, [products, searchTerm, collectionFilter, healthFilter, excludeTerm]);

  // What the grid/cards show: synced values overlaid with local staged edits.
  const displayProducts = useMemo(
    () => filteredProducts.map(p => (edits[p.id] ? { ...p, ...edits[p.id] } : p)),
    [filteredProducts, edits],
  );

  // ---------------------------------------------------------------------------
  // CSV Export
  // ---------------------------------------------------------------------------

  const handleCsvExport = () => {
    const headers = ['Title', 'SKU', 'Price', 'Stock', 'Visible', 'Description'];
    const rows = filteredProducts.map(p => [
      `"${(p.title || '').replace(/"/g, '""')}"`,
      p.sku || '',
      p.price || '',
      p.quantity || 0,
      p.visible ? 'true' : 'false',
      `"${(p.description || '').replace(/"/g, '""').substring(0, 200)}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `wix-products-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---------------------------------------------------------------------------
  // Selected products
  // ---------------------------------------------------------------------------

  const selectedProducts = useMemo(() => {
    const ids = 'ids' in selectedIds ? selectedIds.ids : new Set<GridRowId>();
    return filteredProducts.filter(p => ids.has(p.id));
  }, [filteredProducts, selectedIds]);

  // ---------------------------------------------------------------------------
  // DataGrid Columns
  // ---------------------------------------------------------------------------

  const columns: GridColDef[] = useMemo(() => {
    const cols: GridColDef[] = [
      {
        field: 'thumbnailUrl', headerName: '', width: 60, sortable: false, filterable: false,
        renderCell: (params: GridRenderCellParams) => (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <img
              src={params.value || '/placeholder.png'}
              alt=""
              style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }}
              onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder.png'; }}
              loading="lazy"
            />
          </Box>
        ),
      },
      {
        field: 'title', headerName: t('titleCol'), flex: 2, minWidth: 240, editable: true,
        renderCell: (params: GridRenderCellParams) => (
          <Box sx={{
            display: 'flex', alignItems: 'center', width: '100%', height: '100%', gap: 0.5,
            '&:hover .row-actions': { opacity: 1 },
          }}>
            <Typography
              variant="body2" noWrap sx={{ flex: 1, cursor: 'pointer' }}
              onClick={() => openDrawer(params.row)}
            >
              {params.value}
            </Typography>
            {Array.isArray(params.row.customTextFields) && params.row.customTextFields.length > 0 && (
              <Tooltip title={t('personalizationActive', { count: params.row.customTextFields.length })}>
                <TextFieldsIcon sx={{ fontSize: 14, color: 'primary.main', flexShrink: 0 }} />
              </Tooltip>
            )}
            <Box className="row-actions" sx={{ opacity: 0, transition: '0.15s', display: 'flex', gap: 0.25 }}>
              <Tooltip title={t('edit')}>
                <IconButton size="small" onClick={() => openDrawer(params.row)}>
                  <EditIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('delete')}>
                <IconButton size="small" color="error" onClick={() => setDeleteConfirmProduct(params.row)}>
                  <DeleteIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            </Box>
          </Box>
        ),
      },
      {
        field: 'sku', headerName: t('skuCol'), width: 110,
        renderCell: (params: GridRenderCellParams) => (
          <Typography variant="body2" color="text.secondary" noWrap>{params.value || '—'}</Typography>
        ),
      },
      {
        field: 'quantity', headerName: t('stockCol'), width: 90, type: 'number', editable: true,
        renderCell: (params: GridRenderCellParams) => {
          if (params.row.trackInventory === false) {
            return (
              <Tooltip title={t('stagedStockNotEditable')}>
                <Typography variant="body2" color="text.secondary">—</Typography>
              </Tooltip>
            );
          }
          const val = params.value ?? 0;
          const color = val === 0 ? 'error.main' : val < 5 ? 'warning.main' : 'text.primary';
          const label = <Typography variant="body2" color={color} fontWeight={val === 0 ? 600 : 400}>{val}</Typography>;
          return canEditStock(params.row) ? label : <Tooltip title={t('stagedStockNotEditable')}>{label}</Tooltip>;
        },
      },
      {
        field: 'price', headerName: t('priceCol'), width: 110, type: 'number', editable: true,
        renderCell: (params: GridRenderCellParams) => {
          const val = params.value != null ? Number(params.value) : null;
          const currency = params.row.currency || 'TRY';
          return <Typography variant="body2">{val != null ? `${val.toFixed(2)} ${currency}` : '—'}</Typography>;
        },
      },
    ];

    // Collection column (hidden on tablet)
    if (!isTablet) {
      cols.push({
        field: 'collectionIds', headerName: t('collectionCol'), width: 130, sortable: false,
        renderCell: (params: GridRenderCellParams) => {
          const colIds: string[] = Array.isArray(params.value) ? params.value : [];
          const firstName = colIds.length > 0 ? collections.find(c => c.id === colIds[0])?.name : null;
          return (
            <Typography variant="body2" color="text.secondary" noWrap>
              {firstName || '—'}
              {colIds.length > 1 && <Chip label={`+${colIds.length - 1}`} size="small" sx={{ ml: 0.5, height: 16, fontSize: '0.6rem' }} />}
            </Typography>
          );
        },
      });
    }

    // Health score column (hidden on tablet)
    if (!isTablet) {
      cols.push({
        field: 'health', headerName: t('scoreCol'), width: 70, sortable: true,
        valueGetter: (value: any, row: any) => calculateHealth(row).total,
        renderCell: (params: GridRenderCellParams) => {
          const score = params.value as number;
          return (
            <Tooltip title={t('scoreLabel', { score })}>
              <Chip label={score} size="small" sx={{ bgcolor: gradeColor(score), color: '#fff', fontWeight: 600, minWidth: 32 }} />
            </Tooltip>
          );
        },
      });
    }

    return cols;
  }, [t, collections, isTablet, openDrawer]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <PageHeader
        title={tNav('listingsOf', { marketplace: 'Wix' })}
        count={filteredProducts.length}
        meta={<SyncMeta source="wix" lastPulledAt={lastSyncAt} state={syncing ? 'pulling' : 'idle'} onPull={handleSync} />}
        primaryAction={{ id: 'wix-create', label: t('createProduct'), icon: icons.add, onClick: () => setCreateDialogOpen(true) }}
        mobilePrimary="menu"
        overflowActions={[{ id: 'wix-csv', label: t('csvDownload'), icon: icons.download, onClick: handleCsvExport }]}
      />
      <Box sx={{ display: 'flex', width: '100%' }}>
        {/* Left Sidebar (desktop only) */}
        {!isMobile && (
          <LeftSidebar
            statusFilter={statusFilter} setStatusFilter={setStatusFilter} statusCounts={statusCounts}
            healthFilter={healthFilter} setHealthFilter={setHealthFilter}
            collectionFilter={collectionFilter} setCollectionFilter={setCollectionFilter}
            collections={collections} collectionCounts={collectionCounts}
            excludeTerm={excludeTerm} setExcludeTerm={setExcludeTerm}
            t={t}
          />
        )}

        {/* Main content */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {isMobile && (
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
              <IconButton size="small" onClick={() => setFilterDrawerOpen(true)} aria-label={t('filters')}>
                <FilterListIcon />
              </IconButton>
            </Box>
          )}

          {/* Search */}
          <Paper sx={{ p: 1, mb: 1 }}>
            <TextField
              size="small" fullWidth placeholder={t('searchPlaceholder')} value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              InputProps={{
                startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment>,
                endAdornment: searchTerm ? (
                  <InputAdornment position="end">
                    <IconButton size="small" onClick={() => setSearchTerm('')}><CloseIcon sx={{ fontSize: 16 }} /></IconButton>
                  </InputAdornment>
                ) : null,
              }}
              sx={{ '& .MuiInputBase-root': { height: 36, fontSize: '0.85rem' } }}
            />
          </Paper>

          {/* Bulk Operations Bar */}
          {selectedProducts.length > 0 && (
            <WixBulkOperationsBar
              selectedCount={selectedProducts.length}
              selectedProducts={selectedProducts}
              onCompleted={() => { cacheRef.current = {}; fetchProducts(true); }}
              onClearSelection={() => setSelectedIds({ type: 'include' as const, ids: new Set<GridRowId>() })}
            />
          )}

          {/* Stats chips */}
          {(statusCounts.all > 0) && (
            <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
              {filteredProducts.filter(p => p.quantity === 0).length > 0 && (
                <Chip
                  label={t('outOfStockCount', { count: filteredProducts.filter(p => p.quantity === 0).length })}
                  size="small" color="error" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }}
                />
              )}
              {filteredProducts.filter(p => calculateHealth(p).total < 60).length > 0 && (
                <Chip
                  label={t('issuesCount', { count: filteredProducts.filter(p => calculateHealth(p).total < 60).length })}
                  size="small" color="warning" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }}
                />
              )}
            </Box>
          )}

          {/* Fetch error with stale data still on screen */}
          {fetchError != null && products.length > 0 && (
            <Box sx={{ mb: 1 }}>
              <ErrorState compact error={fetchError} message={t('fetchFailed')} onRetry={() => fetchProducts(true)} />
            </Box>
          )}

          {/* Fetch error */}
          {fetchError != null && products.length === 0 && !loading ? (
            <Paper sx={{ width: '100%' }}>
              <ErrorState error={fetchError} message={t('fetchFailed')} onRetry={() => fetchProducts(true)} />
            </Paper>
          ) : !isMobile ? (
            <Paper sx={{ width: '100%' }}>
              <DataGrid
                rows={displayProducts}
                columns={columns}
                getCellClassName={(params) => {
                  const e = edits[String(params.id)];
                  return e && (e as any)[params.field] !== undefined ? 'kx-staged-cell' : '';
                }}
                getRowClassName={(params) => (saveErrors[String(params.id)] ? 'kx-failed-row' : '')}
                onProcessRowUpdateError={(err) => notify.error(err, t('updateFailed'))}
                loading={loading}
                pageSizeOptions={[25, 50, 100]}
                paginationModel={paginationModel}
                onPaginationModelChange={setPaginationModel}
                getRowId={(row) => row.id}
                rowHeight={56}
                checkboxSelection
                disableRowSelectionOnClick
                rowSelectionModel={selectedIds}
                onRowSelectionModelChange={setSelectedIds}
                processRowUpdate={processRowUpdate}
                isCellEditable={(params) => !savingEdits && (params.field !== 'quantity' || canEditStock(params.row))}
                autoHeight
                sx={{
                  border: 0,
                  fontSize: '0.85rem',
                  '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f5f5f5' },
                  '& .MuiDataGrid-cell:focus': { outline: 'none' },
                  '& .MuiDataGrid-row:hover': { bgcolor: 'action.hover' },
                  '& .kx-staged-cell': {
                    bgcolor: 'rgba(255, 152, 0, 0.12)',
                    boxShadow: 'inset 3px 0 0 #ff9800',
                  },
                  '& .kx-failed-row': { boxShadow: 'inset 4px 0 0 #f44336' },
                }}
              />
            </Paper>
          ) : (
            /* Mobile Card Layout */
            <Box>
              {loading && <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 2 }} />}
              {!loading && filteredProducts.length === 0 && (
                <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                  {t('noProductsFound')}
                </Typography>
              )}
              {displayProducts.slice(0, mobileVisibleCount).map(product => (
                <MobileWixProductCard
                  key={product.id}
                  product={product}
                  selected={'ids' in selectedIds && selectedIds.ids.has(product.id)}
                  onToggleSelect={() => {
                    setSelectedIds(prev => {
                      const ids = new Set('ids' in prev ? prev.ids : []);
                      if (ids.has(product.id)) ids.delete(product.id); else ids.add(product.id);
                      return { type: 'include' as const, ids };
                    });
                  }}
                  onEdit={() => openDrawer(product)}
                  onDelete={() => setDeleteConfirmProduct(product)}
                  collections={collections}
                  t={t}
                  dirtyFields={dirtyFieldsOf(product.id)}
                  saveError={saveErrors[product.id]}
                  onStage={(patch) => stageEdit(product.id, patch)}
                  onInvalid={notifyInvalid}
                  editLocked={savingEdits}
                />
              ))}
              {mobileVisibleCount < filteredProducts.length && (
                <Button
                  fullWidth variant="outlined" sx={{ mt: 1 }}
                  onClick={() => setMobileVisibleCount(prev => prev + 20)}
                >
                  {t('loadMore', { count: Math.min(20, filteredProducts.length - mobileVisibleCount) })}
                </Button>
              )}
            </Box>
          )}

          {/* Staged edits bar — the only path that pushes inline edits to Wix */}
          {(dirtyCount > 0 || Object.keys(saveErrors).length > 0) && (
            <Paper
              elevation={6}
              sx={{
                position: 'sticky', bottom: { xs: 8, md: 12 }, zIndex: 10, mt: 1.5,
                p: { xs: 1, sm: 1.25 }, borderRadius: 2,
                border: 1, borderColor: Object.keys(saveErrors).length > 0 ? 'error.light' : 'warning.light',
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2" fontWeight={600} sx={{ flex: 1, minWidth: 140 }}>
                  {dirtyCount > 0 ? t('stagedUnsavedCount', { count: dirtyCount }) : t('stagedNoPending')}
                </Typography>
                {Object.keys(saveErrors).length > 0 && (
                  <Button
                    color="error" size="small"
                    startIcon={<ErrorOutlineIcon />}
                    endIcon={failuresOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    onClick={() => setFailuresOpen(o => !o)}
                    sx={{ minHeight: 44 }}
                  >
                    {t('stagedFailedCount', { count: Object.keys(saveErrors).length })}
                  </Button>
                )}
                {dirtyCount > 0 && (
                  <Box sx={{ display: 'flex', gap: 1, width: { xs: '100%', sm: 'auto' } }}>
                    <Button
                      variant="outlined" color="inherit" startIcon={<UndoIcon />}
                      onClick={handleDiscardEdits} disabled={savingEdits}
                      sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }}
                    >
                      {t('stagedDiscard')}
                    </Button>
                    <Button
                      variant="contained" disableElevation
                      startIcon={savingEdits ? <CircularProgress size={16} color="inherit" /> : <CloudUploadIcon />}
                      onClick={handleSaveEdits} disabled={savingEdits}
                      sx={{ minHeight: 44, flex: { xs: 1, sm: 'none' } }}
                    >
                      {savingEdits ? t('saving') : t('stagedSaveToWix')}
                    </Button>
                  </Box>
                )}
                {dirtyCount === 0 && (
                  <IconButton
                    onClick={() => { setSaveErrors({}); setFailuresOpen(false); }}
                    aria-label={tc('close')}
                    sx={{ width: 44, height: 44 }}
                  >
                    <CloseIcon fontSize="small" />
                  </IconButton>
                )}
              </Box>
              <Collapse in={failuresOpen && Object.keys(saveErrors).length > 0}>
                <Box sx={{ mt: 1, maxHeight: 200, overflowY: 'auto' }}>
                  {Object.entries(saveErrors).map(([rowId, msg]) => (
                    <Typography key={rowId} variant="caption" component="div" sx={{ py: 0.25 }}>
                      <strong>{(productsById.get(rowId) || stagedOrigRef.current[rowId])?.title || rowId}</strong>: {msg}
                    </Typography>
                  ))}
                </Box>
              </Collapse>
            </Paper>
          )}
        </Box>
      </Box>

      {/* Editor Drawer */}
      <WixProductEditorDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerProduct(null); }}
        product={drawerProduct}
        collections={collections}
        onSaved={() => { cacheRef.current = {}; fetchProducts(true); }}
        onDeleted={() => { cacheRef.current = {}; fetchProducts(true); }}
      />

      {/* Create Dialog */}
      <WixProductCreatorDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        collections={collections}
        onCreated={() => { cacheRef.current = {}; fetchProducts(true); }}
      />

      {/* Delete Confirm Dialog */}
      <Dialog open={!!deleteConfirmProduct} onClose={() => setDeleteConfirmProduct(null)} maxWidth="xs" fullWidth>
        <DialogTitle color="error">{t('deleteProductTitle')}</DialogTitle>
        <DialogContent>
          <Typography>{t('deleteProductConfirm', { title: deleteConfirmProduct?.title || '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmProduct(null)}>{t('cancel')}</Button>
          <Button variant="contained" color="error" onClick={() => deleteConfirmProduct && handleDelete(deleteConfirmProduct)}>
            {t('delete')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Mobile Filter Drawer */}
      {isMobile && (
        <SwipeableDrawer
          anchor="bottom"
          open={filterDrawerOpen}
          onClose={() => setFilterDrawerOpen(false)}
          onOpen={() => setFilterDrawerOpen(true)}
          PaperProps={{ sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70vh', p: 2 } }}
        >
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
            <Typography variant="subtitle1" fontWeight={600}>{t('filters')}</Typography>
            <IconButton size="small" onClick={() => setFilterDrawerOpen(false)}><CloseIcon /></IconButton>
          </Box>
          <LeftSidebar
            statusFilter={statusFilter} setStatusFilter={setStatusFilter} statusCounts={statusCounts}
            healthFilter={healthFilter} setHealthFilter={setHealthFilter}
            collectionFilter={collectionFilter} setCollectionFilter={setCollectionFilter}
            collections={collections} collectionCounts={collectionCounts}
            excludeTerm={excludeTerm} setExcludeTerm={setExcludeTerm}
            t={t}
          />
          <Button fullWidth variant="outlined" sx={{ mt: 2 }} onClick={() => {
            setStatusFilter('all'); setHealthFilter(''); setCollectionFilter(''); setExcludeTerm('');
          }}>
            {t('clearFilters')}
          </Button>
        </SwipeableDrawer>
      )}
    </>
  );
}

export default withAuth(WixProductsPage);
