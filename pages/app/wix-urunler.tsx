import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  Box, Button, CircularProgress, Collapse, Tooltip, TextField, Select, MenuItem,
  FormControl, InputLabel, IconButton, Typography, Paper, Chip, InputAdornment,
  Dialog, DialogTitle, DialogContent, DialogActions, useMediaQuery, useTheme,
  Menu, ListItemIcon, ListItemText, SwipeableDrawer, Badge, Checkbox, Divider,
} from '@mui/material';
import {
  DataGrid, GridColDef, GridPaginationModel, GridRenderCellParams,
  GridRowSelectionModel, GridRowId,
} from '@mui/x-data-grid';
import {
  Search as SearchIcon, Edit as EditIcon, Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon, ExpandLess as ExpandLessIcon,
  Add as AddIcon, Sync as SyncIcon, FilterList as FilterListIcon,
  Close as CloseIcon, FileDownload as FileDownloadIcon,
  MoreVert as MoreVertIcon, Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon, TextFields as TextFieldsIcon,
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useTranslations } from 'next-intl';

import WixProductEditorDrawer from '@/components/wix/WixProductEditorDrawer';
import WixProductCreatorDialog from '@/components/wix/WixProductCreatorDialog';
import WixBulkOperationsBar from '@/components/wix/WixBulkOperationsBar';

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

function formatTimeSince(dateStr: string | null, t: any): string {
  if (!dateStr) return t('neverSynced');
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return t('justNow');
  if (mins < 60) return t('minutesAgo', { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t('hoursAgo', { count: hrs });
  return t('daysAgo', { count: Math.floor(hrs / 24) });
}

// ---------------------------------------------------------------------------
// Mobile Card
// ---------------------------------------------------------------------------

function MobileWixProductCard({
  product, selected, onToggleSelect, onEdit, onDelete, collections, t,
}: {
  product: WixProductRow;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  collections: WixCollection[];
  t: any;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = calculateHealth(product);
  const colNames = (product.collectionIds || [])
    .map(id => collections.find(c => c.id === id)?.name)
    .filter(Boolean);

  return (
    <Paper sx={{ mb: 1, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1, gap: 1 }}>
        <Checkbox size="small" checked={selected} onChange={onToggleSelect} sx={{ p: 0.5 }} />
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
            <Typography variant="caption" color={product.quantity === 0 ? 'error.main' : 'text.secondary'}>
              &middot; {product.quantity} {t('stockCol')}
            </Typography>
            <Chip
              label={product.visible ? t('statusVisible') : t('statusHidden')}
              size="small"
              color={product.visible ? 'success' : 'default'}
              variant="outlined"
              sx={{ height: 18, fontSize: '0.65rem', ml: 0.5 }}
            />
          </Box>
        </Box>
        <Chip
          label={health.total}
          size="small"
          sx={{ bgcolor: gradeColor(health.total), color: '#fff', fontWeight: 600, minWidth: 32, height: 22 }}
        />
        <IconButton size="small" onClick={() => setExpanded(!expanded)}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={expanded}>
        <Box sx={{ px: 1, pb: 1, pt: 0 }}>
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
            <Button size="small" variant="outlined" startIcon={<EditIcon />} onClick={onEdit} fullWidth>
              {t('edit')}
            </Button>
            <Button size="small" variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={onDelete} fullWidth>
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
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
        <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.5, flex: 1 }}>
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
      <Typography variant="caption" fontWeight={700} color="text.secondary" sx={{ mb: 0.5, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 }}>
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
  const [toolsAnchor, setToolsAnchor] = useState<null | HTMLElement>(null);

  // Cache
  const cacheRef = useRef<Record<string, { data: WixProductRow[]; count: number; statusCounts: StatusCounts; collectionCounts: Record<string, number>; ts: number }>>({});

  // ---------------------------------------------------------------------------
  // Fetch
  // ---------------------------------------------------------------------------

  const fetchProducts = useCallback(async (force = false) => {
    const cacheKey = `${statusFilter}`;
    const cached = cacheRef.current[cacheKey];
    if (!force && cached && Date.now() - cached.ts < CACHE_TTL) {
      setProducts(cached.data);
      setTotalCount(cached.count);
      setStatusCounts(cached.statusCounts);
      setCollectionCounts(cached.collectionCounts);
      return;
    }

    setLoading(true);
    try {
      const visibleParam = statusFilter === 'all' ? '' : statusFilter === 'visible' ? '&visible=true' : '&visible=false';
      const res = await fetch(`/api/wix/products?action=cached_products&page=${paginationModel.page}&size=500${visibleParam}`);
      if (!res.ok) throw new Error('Fetch failed');
      const data = await res.json();
      const prods = data.products || [];
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
    } catch (err: any) {
      toast.error(err.message || t('fetchFailed'));
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
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      toast.success(`${t('syncSuccess')} (${data.synced})`);
      setLastSyncAt(new Date().toISOString());
      cacheRef.current = {};
      fetchProducts(true);
    } catch (err: any) {
      toast.error(err.message || t('syncFailed'));
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
      if (!res.ok) throw new Error('Delete failed');
      toast.success(t('deleteSuccess'));
      setDeleteConfirmProduct(null);
      cacheRef.current = {};
      fetchProducts(true);
    } catch (err: any) {
      toast.error(err.message || t('deleteFailed'));
    }
  };

  // ---------------------------------------------------------------------------
  // Inline editing
  // ---------------------------------------------------------------------------

  const processRowUpdate = useCallback(async (newRow: any, oldRow: any) => {
    const changes: any = {};
    if (newRow.title !== oldRow.title) changes.name = newRow.title;
    if (newRow.price !== oldRow.price) changes.priceData = { price: parseFloat(newRow.price) };
    if (Object.keys(changes).length === 0) return oldRow;

    try {
      const res = await fetch('/api/wix/products?action=update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: newRow.wixProductId || newRow.id, ...changes }),
      });
      if (!res.ok) throw new Error('Update failed');
      toast.success(t('updateSuccess'));
      // Update cache
      setProducts(prev => prev.map(p => p.id === newRow.id ? { ...p, ...newRow } : p));
      return newRow;
    } catch (err: any) {
      toast.error(err.message || t('updateFailed'));
      return oldRow;
    }
  }, [t]);

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
    setToolsAnchor(null);
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
              onClick={() => { setDrawerProduct(params.row); setDrawerOpen(true); }}
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
                <IconButton size="small" onClick={() => { setDrawerProduct(params.row); setDrawerOpen(true); }}>
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
        field: 'quantity', headerName: t('stockCol'), width: 80, type: 'number',
        renderCell: (params: GridRenderCellParams) => {
          const val = params.value ?? 0;
          const color = val === 0 ? 'error.main' : val < 5 ? 'warning.main' : 'text.primary';
          return <Typography variant="body2" color={color} fontWeight={val === 0 ? 600 : 400}>{val}</Typography>;
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
  }, [t, collections, isTablet]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AppLayout title={t('pageTitle')}>
      <Toaster position="top-right" />
      <Box sx={{ display: 'flex', maxWidth: 1500, mx: 'auto', width: '100%', p: { xs: 0.5, sm: 1, md: 1.5 } }}>
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
          {/* Header */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography variant="h6" fontWeight="bold">{t('pageTitle')}</Typography>
              <Chip label={t('productCount', { count: filteredProducts.length })} size="small" variant="outlined" />
            </Box>
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
              {lastSyncAt && (
                <Typography variant="caption" color="text.secondary" sx={{ mr: 0.5 }}>
                  {formatTimeSince(lastSyncAt, t)}
                </Typography>
              )}
              <Button
                size="small" variant="outlined"
                startIcon={syncing ? <CircularProgress size={14} /> : <SyncIcon />}
                onClick={handleSync} disabled={syncing}
              >
                {syncing ? t('syncing') : t('syncBtn')}
              </Button>
              <Button size="small" variant="outlined" onClick={(e) => setToolsAnchor(e.currentTarget)} startIcon={<MoreVertIcon />}>
                {t('tools')}
              </Button>
              <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setCreateDialogOpen(true)}>
                {t('createProduct')}
              </Button>
              {isMobile && (
                <IconButton size="small" onClick={() => setFilterDrawerOpen(true)}>
                  <FilterListIcon />
                </IconButton>
              )}
            </Box>
          </Box>

          {/* Tools Menu */}
          <Menu anchorEl={toolsAnchor} open={!!toolsAnchor} onClose={() => setToolsAnchor(null)}>
            <MenuItem onClick={handleCsvExport}>
              <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('csvDownload')}</ListItemText>
            </MenuItem>
          </Menu>

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

          {/* Desktop DataGrid */}
          {!isMobile ? (
            <Paper sx={{ width: '100%' }}>
              <DataGrid
                rows={filteredProducts}
                columns={columns}
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
                autoHeight
                sx={{
                  border: 0,
                  fontSize: '0.85rem',
                  '& .MuiDataGrid-columnHeaders': { backgroundColor: '#f5f5f5' },
                  '& .MuiDataGrid-cell:focus': { outline: 'none' },
                  '& .MuiDataGrid-row:hover': { bgcolor: 'action.hover' },
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
              {filteredProducts.slice(0, mobileVisibleCount).map(product => (
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
                  onEdit={() => { setDrawerProduct(product); setDrawerOpen(true); }}
                  onDelete={() => setDeleteConfirmProduct(product)}
                  collections={collections}
                  t={t}
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
    </AppLayout>
  );
}

export default withAuth(WixProductsPage);
