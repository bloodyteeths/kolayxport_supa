import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Typography,
  Paper,
  Chip,
  InputAdornment,
  useMediaQuery,
  useTheme,
  Drawer,
  IconButton,
  Divider,
  Collapse,
  Pagination,
  ButtonBase,
} from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridColumnVisibilityModel,
  GridPaginationModel,
  GridRenderCellParams,
} from '@mui/x-data-grid';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
} from '@mui/icons-material';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useTranslations } from 'next-intl';
import { RequireConnection } from '@/components/ui/ConnectEmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { notify } from '@/lib/notify';
import { useConfirm } from '@/lib/hooks/useConfirm';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ShopifyProductRow {
  id: string;
  shopifyProductId: string;
  title: string;
  description: string | null;
  vendor: string | null;
  productType: string | null;
  status: string | null;
  tags: string[];
  handle: string | null;
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  trackInventory: boolean;
  totalInventory: number;
  images: any[];
  thumbnailUrl: string | null;
  imageCount: number;
  variants: any[];
  options: any[];
  variantCount: number;
  seoTitle: string | null;
  seoDescription: string | null;
  shopifyCreatedAt: string | null;
  shopifyUpdatedAt: string | null;
  syncedAt: string;
}

type StatusFilter = 'all' | 'active' | 'draft' | 'archived';

type VariantErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_PRICE'
  | 'INVALID_QUANTITY'
  | 'NOT_TRACKED'
  | 'MULTI_LOCATION'
  | 'NO_LOCATION'
  | 'STOCK_CHANGED'
  | 'FAILED';

const VARIANT_ERROR_CODES: readonly VariantErrorCode[] = [
  'NOT_FOUND', 'INVALID_PRICE', 'INVALID_QUANTITY', 'NOT_TRACKED',
  'MULTI_LOCATION', 'NO_LOCATION', 'STOCK_CHANGED', 'FAILED',
];

const SHOPIFY_GREEN = '#96BF48';
const KNOWN_STATUSES = ['active', 'draft', 'archived'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number | null, currency: string) {
  if (price === null || price === undefined || Number.isNaN(price)) return '—';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: 2,
    }).format(price);
  } catch {
    return price.toFixed(2);
  }
}

function getStatusColor(status: string | null): 'success' | 'warning' | 'default' {
  switch (status) {
    case 'active': return 'success';
    case 'draft': return 'warning';
    case 'archived': return 'default';
    default: return 'default';
  }
}

function isTracked(v: any): boolean {
  return v?.inventory_management === 'shopify' && !!v?.inventory_item_id;
}

/** Parse a user-typed price ("12,5" or "12.50"); null when invalid. */
function parsePrice(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!s || !/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Parse a user-typed stock count; null when not a non-negative integer. */
function parseQty(raw: string): number | null {
  const s = raw.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

function draftsFromVariants(list: any[]): Record<string, VariantDraft> {
  const drafts: Record<string, VariantDraft> = {};
  for (const v of list) {
    if (v?.id == null) continue;
    const p = Number(v.price);
    drafts[String(v.id)] = {
      price: Number.isFinite(p) ? p.toFixed(2) : '',
      qty: v.inventory_quantity != null ? String(v.inventory_quantity) : '',
    };
  }
  return drafts;
}

// ---------------------------------------------------------------------------
// Mobile Card
// ---------------------------------------------------------------------------

function MobileShopifyProductCard({
  product,
  onEdit,
  onDelete,
}: {
  product: ShopifyProductRow;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations('shopifyListings');
  const tc = useTranslations('common');
  const [expanded, setExpanded] = useState(false);
  const statusLabel = product.status && KNOWN_STATUSES.includes(product.status) ? t(product.status) : product.status || '—';

  return (
    <Paper sx={{ mb: 1, overflow: 'hidden' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', p: 1, gap: 1 }}>
        <ButtonBase
          onClick={onEdit}
          aria-label={t('edit')}
          sx={{ width: 48, height: 48, borderRadius: 1, overflow: 'hidden', flexShrink: 0, bgcolor: 'grey.200' }}
        >
          {product.thumbnailUrl && (
            <img
              src={product.thumbnailUrl}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              loading="lazy"
            />
          )}
        </ButtonBase>
        <ButtonBase
          onClick={onEdit}
          aria-label={`${t('edit')}: ${product.title || ''}`}
          sx={{ flex: 1, minWidth: 0, minHeight: 44, display: 'block', textAlign: 'left', borderRadius: 1 }}
        >
          <Typography variant="body2" fontWeight={600} noWrap>
            {product.title || '—'}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.25, flexWrap: 'wrap' }}>
            <Typography variant="caption" color="text.secondary">
              {formatPrice(product.price, product.currency)}
            </Typography>
            <Typography variant="caption" color={product.totalInventory === 0 ? 'error.main' : 'text.secondary'}>
              &middot; {t('inventory')}: {product.totalInventory ?? 0}
            </Typography>
            <Chip
              label={statusLabel}
              size="small"
              color={getStatusColor(product.status)}
              variant="outlined"
              sx={{ height: 18, fontSize: '0.65rem', ml: 0.5 }}
            />
          </Box>
        </ButtonBase>
        <IconButton
          onClick={() => setExpanded(!expanded)}
          aria-label={expanded ? t('hideDetails') : t('showDetails')}
          aria-expanded={expanded}
          sx={{ width: 44, height: 44 }}
        >
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>
      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 1, pb: 1, pt: 0 }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 1 }}>
            <Chip label={`${t('variants')}: ${product.variantCount ?? 0}`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
            {product.vendor && (
              <Chip label={`${t('vendor')}: ${product.vendor}`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
            )}
            {product.productType && (
              <Chip label={`${t('productType')}: ${product.productType}`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
            )}
            {(product.tags || []).slice(0, 6).map((tag) => (
              <Chip key={tag} label={tag} size="small" sx={{ height: 22, fontSize: '0.7rem' }} />
            ))}
          </Box>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button variant="outlined" startIcon={<EditIcon />} onClick={onEdit} fullWidth sx={{ minHeight: 44 }}>
              {t('edit')}
            </Button>
            <Button variant="outlined" color="error" startIcon={<DeleteIcon />} onClick={onDelete} fullWidth sx={{ minHeight: 44 }}>
              {tc('delete')}
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

function ShopifyProductsPage() {
  const t = useTranslations('shopifyListings');
  return (
    <AppLayout>
      <RequireConnection provider="shopify" description={t('connectDescription')}>
        <ShopifyProductsContent />
      </RequireConnection>
    </AppLayout>
  );
}

function ShopifyProductsContent() {
  const t = useTranslations('shopifyListings');
  const tc = useTranslations('common');
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const confirm = useConfirm();

  // State
  const [products, setProducts] = useState<ShopifyProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [syncing, setSyncing] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Search runs on the server so results and pagination agree; debounce keystrokes
  // and jump back to the first page whenever the query or status filter changes.
  const resetToFirstPage = () =>
    setPaginationModel(prev => (prev.page === 0 ? prev : { ...prev, page: 0 }));

  useEffect(() => {
    const next = searchText.trim();
    if (next === debouncedSearch) return;
    const handle = setTimeout(() => {
      setDebouncedSearch(next);
      resetToFirstPage();
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Editor drawer
  const [editorOpen, setEditorOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<ShopifyProductRow | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        action: 'list',
        fromCache: 'true',
        page: String(paginationModel.page),
        size: String(paginationModel.pageSize),
      });
      if (statusFilter !== 'all') params.set('status', statusFilter);
      if (debouncedSearch) params.set('q', debouncedSearch);

      const res = await fetch(`/api/shopify/products?${params}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw { status: res.status, data };

      setProducts(Array.isArray(data?.content) ? data.content : []);
      setTotalCount(Number(data?.totalElements) || 0);
      setLoadError(null);
    } catch (err) {
      setLoadError(err);
    } finally {
      setLoading(false);
    }
  }, [paginationModel, statusFilter, debouncedSearch]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  // ---------------------------------------------------------------------------
  // Sync from Shopify
  // ---------------------------------------------------------------------------

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/shopify/products?action=sync', { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw { status: res.status, data };
      notify.success(`${t('syncSuccess')} (${Number(data?.synced) || 0})`);
      await fetchProducts();
    } catch (err) {
      notify.error(err, 'shopifyListings.syncFailed');
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = useCallback(async (product: ShopifyProductRow) => {
    const ok = await confirm({
      title: t('deleteConfirm'),
      items: [product.title || product.shopifyProductId],
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/shopify/products?action=delete&id=${encodeURIComponent(product.shopifyProductId)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw { status: res.status, data };
      notify.success(t('deleteSuccess'));
      await fetchProducts();
    } catch (err) {
      notify.error(err);
    }
  }, [confirm, t, fetchProducts]);

  const openEditor = useCallback((row: ShopifyProductRow) => {
    setEditProduct(row);
    setEditorOpen(true);
  }, []);

  // ---------------------------------------------------------------------------
  // Columns
  // ---------------------------------------------------------------------------

  const columns: GridColDef[] = useMemo(() => [
    {
      field: 'image',
      headerName: '',
      width: 60,
      sortable: false,
      filterable: false,
      renderCell: (params: GridRenderCellParams) => {
        const src = params.row.thumbnailUrl;
        return src ? (
          <Box
            component="img"
            src={src}
            alt=""
            sx={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 1 }}
          />
        ) : (
          <Box sx={{ width: 40, height: 40, bgcolor: 'grey.200', borderRadius: 1 }} />
        );
      },
    },
    {
      field: 'title',
      headerName: t('title'),
      flex: 2,
      minWidth: 200,
    },
    {
      field: 'status',
      headerName: t('status'),
      width: 100,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value && KNOWN_STATUSES.includes(params.value) ? t(params.value) : params.value || '—'}
          size="small"
          color={getStatusColor(params.value)}
          variant="outlined"
        />
      ),
    },
    {
      field: 'price',
      headerName: t('price'),
      width: 110,
      renderCell: (params: GridRenderCellParams) =>
        formatPrice(params.value, params.row.currency),
    },
    {
      field: 'totalInventory',
      headerName: t('inventory'),
      width: 100,
      align: 'center',
      headerAlign: 'center',
    },
    {
      field: 'variantCount',
      headerName: t('variants'),
      width: 90,
      align: 'center',
      headerAlign: 'center',
    },
    {
      field: 'vendor',
      headerName: t('vendor'),
      width: 120,
    },
    {
      field: 'productType',
      headerName: t('productType'),
      width: 120,
    },
    {
      field: 'actions',
      headerName: '',
      width: 100,
      sortable: false,
      filterable: false,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <IconButton size="small" aria-label={t('edit')} onClick={() => openEditor(params.row)}>
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            aria-label={tc('delete')}
            onClick={() => handleDelete(params.row)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    },
  ], [t, tc, openEditor, handleDelete]);

  const [columnVisibilityModel, setColumnVisibilityModel] = useState<GridColumnVisibilityModel>({});

  const pageCount = Math.max(1, Math.ceil(totalCount / paginationModel.pageSize));
  const showError = !!loadError && products.length === 0;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <Box sx={{ p: { xs: 1, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, mb: 2, gap: 1 }}>
          <Typography variant="h5" fontWeight="bold">
            {t('title')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              startIcon={syncing ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
              onClick={handleSync}
              disabled={syncing}
              fullWidth={isMobile}
              sx={{ minHeight: 44, bgcolor: SHOPIFY_GREEN, '&:hover': { bgcolor: '#7ea33e' } }}
            >
              {syncing ? t('syncing') : t('sync')}
            </Button>
          </Box>
        </Box>

        {/* Filters */}
        <Paper sx={{ p: { xs: 1.5, md: 2 }, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: { xs: 1, md: 2 }, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder={t('searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 200, flex: 1, '& .MuiInputBase-root': { minHeight: 44 } }}
            />
            <FormControl size="small" sx={{ minWidth: 120, '& .MuiInputBase-root': { minHeight: 44 } }}>
              <InputLabel>{t('status')}</InputLabel>
              <Select
                value={statusFilter}
                label={t('status')}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  resetToFirstPage();
                }}
              >
                <MenuItem value="all">{t('all')}</MenuItem>
                <MenuItem value="active">{t('active')}</MenuItem>
                <MenuItem value="draft">{t('draft')}</MenuItem>
                <MenuItem value="archived">{t('archived')}</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              {totalCount} {t('products')}
            </Typography>
          </Box>
        </Paper>

        {showError ? (
          <Paper>
            <ErrorState
              title={t('fetchFailed')}
              error={loadError}
              onRetry={fetchProducts}
              retrying={loading}
            />
          </Paper>
        ) : !isMobile ? (
          /* Desktop DataGrid */
          <>
          {loadError != null && (
            <Box sx={{ mb: 1 }}>
              <ErrorState compact title={t('fetchFailed')} error={loadError} onRetry={fetchProducts} retrying={loading} />
            </Box>
          )}
          <Paper sx={{ height: 'calc(100vh - 280px)', minHeight: 400 }}>
            <DataGrid
              rows={products}
              columns={columns}
              columnVisibilityModel={columnVisibilityModel}
              onColumnVisibilityModelChange={setColumnVisibilityModel}
              loading={loading}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[25, 50, 100]}
              rowCount={totalCount}
              paginationMode="server"
              disableRowSelectionOnClick
              rowHeight={60}
              sx={{
                border: 'none',
                '& .MuiDataGrid-cell': { py: 1 },
              }}
            />
          </Paper>
          </>
        ) : (
          /* Mobile Card Layout */
          <Box>
            {loadError != null && (
              <Box sx={{ mb: 1 }}>
                <ErrorState compact title={t('fetchFailed')} error={loadError} onRetry={fetchProducts} retrying={loading} />
              </Box>
            )}
            {loading && <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 2 }} />}
            {!loading && products.length === 0 && (
              <Typography color="text.secondary" align="center" sx={{ py: 4 }}>
                {tc('noData')}
              </Typography>
            )}
            {products.map((product) => (
              <MobileShopifyProductCard
                key={product.id}
                product={product}
                onEdit={() => openEditor(product)}
                onDelete={() => handleDelete(product)}
              />
            ))}
            {pageCount > 1 && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2, mb: 1 }}>
                <Pagination
                  count={pageCount}
                  page={paginationModel.page + 1}
                  onChange={(_, p) => {
                    setPaginationModel(prev => ({ ...prev, page: p - 1 }));
                    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  siblingCount={0}
                  size="large"
                  disabled={loading}
                />
              </Box>
            )}
          </Box>
        )}
      </Box>

      {/* Editor Drawer */}
      <ShopifyEditorDrawer
        open={editorOpen}
        product={editProduct}
        onClose={() => {
          setEditorOpen(false);
          setEditProduct(null);
        }}
        onSaved={() => {
          setEditorOpen(false);
          setEditProduct(null);
          fetchProducts();
        }}
        onRefresh={fetchProducts}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Editor Drawer (inline for simplicity — can be extracted later)
// ---------------------------------------------------------------------------

interface EditorProps {
  open: boolean;
  product: ShopifyProductRow | null;
  onClose: () => void;
  onSaved: () => void;
  /** Refresh the list without closing the drawer (used after a partial save). */
  onRefresh: () => void;
}

type VariantDraft = { price: string; qty: string };

function ShopifyEditorDrawer({ open, product, onClose, onSaved, onRefresh }: EditorProps) {
  const t = useTranslations('shopifyListings');
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [vendor, setVendor] = useState('');
  const [productType, setProductType] = useState('');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState('active');
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  // SEO as last known on Shopify; only fields that differ from this are sent on save
  const [seoBase, setSeoBase] = useState({ title: '', description: '' });
  // Local price/stock edits per variant id; nothing is sent until Save.
  const [variantDrafts, setVariantDrafts] = useState<Record<string, VariantDraft>>({});
  // Variants as last known on Shopify. Starts from the cache row and is rebased
  // on the live product returned after a save, so retries compare against reality.
  const [baseVariants, setBaseVariants] = useState<any[]>([]);
  // Per-variant outcome of the last save that did not fully apply.
  const [variantIssues, setVariantIssues] = useState<Record<string, { code: VariantErrorCode; priceApplied: boolean }>>({});
  const variants = baseVariants;

  useEffect(() => {
    if (product) {
      setTitle(product.title || '');
      setDescription(product.description || '');
      setVendor(product.vendor || '');
      setProductType(product.productType || '');
      setTags(product.tags?.join(', ') || '');
      setStatus(product.status || 'active');
      setSeoTitle(product.seoTitle || '');
      setSeoDescription(product.seoDescription || '');
      setSeoBase({ title: product.seoTitle || '', description: product.seoDescription || '' });
      const list = Array.isArray(product.variants) ? product.variants : [];
      setBaseVariants(list);
      setVariantDrafts(draftsFromVariants(list));
      setVariantIssues({});
    }
  }, [product]);

  // The cache rarely holds SEO (REST sync does not return it), so load the live values
  useEffect(() => {
    if (!product) return;
    let cancelled = false;
    const cachedTitle = product.seoTitle || '';
    const cachedDescription = product.seoDescription || '';
    fetch(`/api/shopify/products?action=seo&id=${product.shopifyProductId}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data?.seo) return;
        const liveTitle = data.seo.title || '';
        const liveDescription = data.seo.description || '';
        setSeoBase({ title: liveTitle, description: liveDescription });
        // Don't clobber anything the user already typed
        setSeoTitle((cur) => (cur === cachedTitle ? liveTitle : cur));
        setSeoDescription((cur) => (cur === cachedDescription ? liveDescription : cur));
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [product]);

  const setVariantField = (id: string, field: keyof VariantDraft, value: string) => {
    setVariantDrafts((prev) => ({ ...prev, [id]: { ...(prev[id] || { price: '', qty: '' }), [field]: value } }));
  };

  /** Changed variants only; returns null (after toasting) when a field is invalid. */
  const collectVariantChanges = () => {
    const changes: { id: string; price?: string; inventoryQuantity?: number; expectedQuantity?: number }[] = [];
    for (const v of variants) {
      const id = String(v.id);
      const draft = variantDrafts[id];
      if (!draft) continue;
      const change: { id: string; price?: string; inventoryQuantity?: number; expectedQuantity?: number } = { id };

      const basePrice = Number(v.price);
      const basePriceStr = Number.isFinite(basePrice) ? basePrice.toFixed(2) : '';
      if (draft.price.trim() !== basePriceStr) {
        const p = parsePrice(draft.price);
        if (p === null) {
          notify.error(null, t('invalidPrice'));
          return null;
        }
        if (p.toFixed(2) !== basePriceStr) change.price = p.toFixed(2);
      }

      if (isTracked(v)) {
        const baseQty = v.inventory_quantity != null ? String(v.inventory_quantity) : '';
        if (draft.qty.trim() !== baseQty) {
          const q = parseQty(draft.qty);
          if (q === null) {
            notify.error(null, t('invalidStock'));
            return null;
          }
          if (q !== Number(v.inventory_quantity)) {
            change.inventoryQuantity = q;
            if (typeof v.inventory_quantity === 'number') change.expectedQuantity = v.inventory_quantity;
          }
        }
      }

      if (change.price !== undefined || change.inventoryQuantity !== undefined) changes.push(change);
    }
    return changes;
  };

  const handleSave = async () => {
    if (!product) return;
    const variantChanges = collectVariantChanges();
    if (variantChanges === null) return;

    setSaving(true);
    try {
      const seo: { title?: string; description?: string } = {};
      if (seoTitle !== seoBase.title) seo.title = seoTitle;
      if (seoDescription !== seoBase.description) seo.description = seoDescription;
      const res = await fetch(`/api/shopify/products?action=update&id=${product.shopifyProductId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          body_html: description,
          vendor,
          product_type: productType,
          tags: tags,
          status,
          ...(Object.keys(seo).length ? { seo } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw { status: res.status, data };
      }

      if (variantChanges.length > 0) {
        const vres = await fetch(`/api/shopify/products?action=updateVariants&id=${product.shopifyProductId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variants: variantChanges }),
        });
        const vdata = await vres.json().catch(() => null);
        if (!vres.ok) throw { status: vres.status, data: vdata };
        const failed = (Array.isArray(vdata?.results) ? vdata.results : []).filter((r: any) => r && r.ok === false);
        if (failed.length > 0) {
          // Keep the drawer open: rebase on the live product, reset drafts only for
          // variants that applied, keep the failed ones' typed values and flag them inline.
          const issues: Record<string, { code: VariantErrorCode; priceApplied: boolean }> = {};
          for (const r of failed) {
            const code: VariantErrorCode = VARIANT_ERROR_CODES.includes(r.code) ? r.code : 'FAILED';
            issues[String(r.id)] = { code, priceApplied: r.priceApplied === true };
          }
          const liveVariants: any[] = Array.isArray(vdata?.product?.variants) ? vdata.product.variants : baseVariants;
          const fresh = draftsFromVariants(liveVariants);
          setVariantDrafts((prev) => {
            const next: Record<string, VariantDraft> = { ...fresh };
            for (const id of Object.keys(issues)) {
              const kept = prev[id];
              if (!kept || !next[id]) continue;
              // A price that already reached Shopify now matches the base; keep only the stock edit.
              next[id] = issues[id].priceApplied ? { ...next[id], qty: kept.qty } : kept;
            }
            return next;
          });
          setBaseVariants(liveVariants);
          setVariantIssues(issues);
          notify.error(null, t('variantUpdatePartialInline', { count: failed.length }));
          // Product fields (and any successful variants) were saved; refresh the list behind the drawer.
          onRefresh();
          return;
        }
      }

      notify.success(t('updateSuccess'));
      onSaved();
    } catch (err) {
      notify.error(err, 'shopifyListings.updateFailed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: '100%', sm: 500 } } }}
    >
      <Box sx={{ p: { xs: 2, sm: 3 } }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{t('edit')}</Typography>
          <IconButton onClick={onClose} aria-label={t('cancel')} sx={{ width: 44, height: 44 }}>
            <CloseIcon />
          </IconButton>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* Product images */}
        {product?.images && product.images.length > 0 && (
          <Box sx={{ display: 'flex', gap: 1, mb: 2, overflowX: 'auto' }}>
            {(product.images as any[]).map((img: any, i: number) => (
              <Box
                key={img.id || i}
                component="img"
                src={img.src}
                alt={img.alt || ''}
                sx={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
              />
            ))}
          </Box>
        )}

        <TextField
          label={t('titleLabel')}
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ mb: 2 }}
        />

        <TextField
          label={t('description')}
          fullWidth
          multiline
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 2, mb: 2 }}>
          <TextField
            label={t('vendor')}
            fullWidth
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
          <TextField
            label={t('productType')}
            fullWidth
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
          />
        </Box>

        <TextField
          label={t('tags')}
          fullWidth
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          helperText={t('tagsHelp')}
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t('status')}</InputLabel>
          <Select value={status} label={t('status')} onChange={(e) => setStatus(e.target.value)}>
            <MenuItem value="active">{t('active')}</MenuItem>
            <MenuItem value="draft">{t('draft')}</MenuItem>
            <MenuItem value="archived">{t('archived')}</MenuItem>
          </Select>
        </FormControl>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('seo')}</Typography>

        <TextField
          label={t('seoTitle')}
          fullWidth
          value={seoTitle}
          onChange={(e) => setSeoTitle(e.target.value)}
          sx={{ mb: 2 }}
        />

        <TextField
          label={t('seoDescription')}
          fullWidth
          multiline
          rows={2}
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
          sx={{ mb: 2 }}
        />

        {/* Variants: price + stock, applied to Shopify only on Save */}
        {variants.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              {t('variants')} ({variants.length})
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
              {t('variantEditHint')}
            </Typography>
            {variants.map((v: any, i: number) => {
              const id = String(v.id);
              const draft = variantDrafts[id] || { price: '', qty: '' };
              const tracked = isTracked(v);
              const issue = variantIssues[id];
              const label = [v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || t('variantFallback', { n: i + 1 });
              return (
                <Paper key={v.id || i} variant="outlined" sx={{ p: 1.5, mb: 1, ...(issue ? { borderColor: 'error.main' } : {}) }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 1, mb: 1 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ minWidth: 0, wordBreak: 'break-word' }}>
                      {label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {t('sku')}: {v.sku || '—'}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <TextField
                      label={t('price')}
                      size="small"
                      fullWidth
                      value={draft.price}
                      onChange={(e) => setVariantField(id, 'price', e.target.value)}
                      inputProps={{ inputMode: 'decimal' }}
                      InputProps={{
                        endAdornment: product?.currency ? (
                          <InputAdornment position="end">{product.currency}</InputAdornment>
                        ) : undefined,
                      }}
                      sx={{ '& .MuiInputBase-root': { minHeight: 44 } }}
                    />
                    <TextField
                      label={t('inventory')}
                      size="small"
                      fullWidth
                      value={tracked ? draft.qty : ''}
                      placeholder={tracked ? undefined : '—'}
                      onChange={(e) => setVariantField(id, 'qty', e.target.value)}
                      disabled={!tracked}
                      helperText={tracked ? undefined : t('notTracked')}
                      inputProps={{ inputMode: 'numeric', pattern: '[0-9]*' }}
                      sx={{ '& .MuiInputBase-root': { minHeight: 44 } }}
                    />
                  </Box>
                  {issue && (
                    <Typography variant="caption" color="error" role="alert" sx={{ display: 'block', mt: 0.75 }}>
                      {issue.priceApplied
                        ? t('variantPriceSavedStockFailed', { reason: t(`variantErrors.${issue.code}`) })
                        : t(`variantErrors.${issue.code}`)}
                    </Typography>
                  )}
                </Paper>
              );
            })}
          </>
        )}

        <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving}
            fullWidth
            sx={{ minHeight: 44, bgcolor: SHOPIFY_GREEN, '&:hover': { bgcolor: '#7ea33e' } }}
          >
            {saving ? t('saving') : t('save')}
          </Button>
          <Button variant="outlined" onClick={onClose} fullWidth sx={{ minHeight: 44 }}>
            {t('cancel')}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}

export default withAuth(ShopifyProductsPage);
