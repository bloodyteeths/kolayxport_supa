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
  Add as AddIcon,
  Close as CloseIcon,
  Delete as DeleteIcon,
  Save as SaveIcon,
} from '@mui/icons-material';
import { toast } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useTranslations } from 'next-intl';

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

const SHOPIFY_GREEN = '#96BF48';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(price: number | null, currency: string) {
  if (price === null || price === undefined) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
  }).format(price);
}

function getStatusColor(status: string | null): 'success' | 'warning' | 'default' {
  switch (status) {
    case 'active': return 'success';
    case 'draft': return 'warning';
    case 'archived': return 'default';
    default: return 'default';
  }
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

function ShopifyProductsPage() {
  const t = useTranslations();
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // State
  const [products, setProducts] = useState<ShopifyProductRow[]>([]);
  const [loading, setLoading] = useState(false);
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
      if (!res.ok) throw new Error('Failed to fetch products');
      const data = await res.json();

      setProducts(data.content || []);
      setTotalCount(data.totalElements || 0);
    } catch (err: any) {
      toast.error(err.message || t('shopifyListings.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, [paginationModel, statusFilter, debouncedSearch, t]);

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
      if (!res.ok) throw new Error('Sync failed');
      const data = await res.json();
      toast.success(`${t('shopifyListings.syncSuccess')} (${data.synced})`);
      await fetchProducts();
    } catch (err: any) {
      toast.error(err.message || t('shopifyListings.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  const handleDelete = async (productId: string) => {
    if (!window.confirm(t('shopifyListings.deleteConfirm'))) return;
    try {
      const res = await fetch(`/api/shopify/products?action=delete&id=${productId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      toast.success(t('shopifyListings.deleteSuccess'));
      await fetchProducts();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

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
      headerName: t('shopifyListings.title'),
      flex: 2,
      minWidth: 200,
    },
    {
      field: 'status',
      headerName: t('shopifyListings.status'),
      width: 100,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          label={params.value || 'unknown'}
          size="small"
          color={getStatusColor(params.value)}
          variant="outlined"
        />
      ),
    },
    {
      field: 'price',
      headerName: t('shopifyListings.price'),
      width: 110,
      renderCell: (params: GridRenderCellParams) =>
        formatPrice(params.value, params.row.currency),
    },
    {
      field: 'totalInventory',
      headerName: t('shopifyListings.inventory'),
      width: 100,
      align: 'center',
      headerAlign: 'center',
    },
    {
      field: 'variantCount',
      headerName: t('shopifyListings.variants'),
      width: 90,
      align: 'center',
      headerAlign: 'center',
    },
    {
      field: 'vendor',
      headerName: t('shopifyListings.vendor'),
      width: 120,
    },
    {
      field: 'productType',
      headerName: t('shopifyListings.productType'),
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
          <IconButton
            size="small"
            onClick={() => {
              setEditProduct(params.row);
              setEditorOpen(true);
            }}
          >
            <EditIcon fontSize="small" />
          </IconButton>
          <IconButton
            size="small"
            color="error"
            onClick={() => handleDelete(params.row.shopifyProductId)}
          >
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Box>
      ),
    },
  ], [t]);

  // Hide secondary columns on small screens; still user-adjustable via the column menu
  const [columnVisibilityModel, setColumnVisibilityModel] = useState<GridColumnVisibilityModel>({
    vendor: !isMobile,
    productType: !isMobile,
  });
  useEffect(() => {
    setColumnVisibilityModel((prev) => ({ ...prev, vendor: !isMobile, productType: !isMobile }));
  }, [isMobile]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AppLayout>
      <Box sx={{ p: { xs: 1, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
        {/* Header */}
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, justifyContent: 'space-between', alignItems: { xs: 'stretch', sm: 'center' }, mb: 2, gap: 1 }}>
          <Typography variant="h5" fontWeight="bold">
            {t('shopifyListings.title')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1 }}>
            <Button
              variant="contained"
              startIcon={syncing ? <CircularProgress size={18} color="inherit" /> : <RefreshIcon />}
              onClick={handleSync}
              disabled={syncing}
              sx={{ bgcolor: SHOPIFY_GREEN, '&:hover': { bgcolor: '#7ea33e' } }}
            >
              {syncing ? t('shopifyListings.syncing') : t('shopifyListings.sync')}
            </Button>
          </Box>
        </Box>

        {/* Filters */}
        <Paper sx={{ p: 2, mb: 2 }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <TextField
              size="small"
              placeholder={t('shopifyListings.searchPlaceholder')}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
              sx={{ minWidth: 200, flex: 1 }}
            />
            <FormControl size="small" sx={{ minWidth: 120 }}>
              <InputLabel>{t('shopifyListings.status')}</InputLabel>
              <Select
                value={statusFilter}
                label={t('shopifyListings.status')}
                onChange={(e) => {
                  setStatusFilter(e.target.value as StatusFilter);
                  resetToFirstPage();
                }}
              >
                <MenuItem value="all">{t('shopifyListings.all')}</MenuItem>
                <MenuItem value="active">{t('shopifyListings.active')}</MenuItem>
                <MenuItem value="draft">{t('shopifyListings.draft')}</MenuItem>
                <MenuItem value="archived">{t('shopifyListings.archived')}</MenuItem>
              </Select>
            </FormControl>
            <Typography variant="body2" color="text.secondary">
              {totalCount} {t('shopifyListings.products')}
            </Typography>
          </Box>
        </Paper>

        {/* DataGrid */}
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
        t={t}
      />
    </AppLayout>
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
  t: any;
}

function ShopifyEditorDrawer({ open, product, onClose, onSaved, t }: EditorProps) {
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

  const handleSave = async () => {
    if (!product) return;
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
        throw new Error(data?.error || t('shopifyListings.updateFailed'));
      }
      toast.success(t('shopifyListings.updateSuccess'));
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
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
      <Box sx={{ p: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{t('shopifyListings.edit')}</Typography>
          <IconButton onClick={onClose}>
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
          label={t('shopifyListings.titleLabel')}
          fullWidth
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          sx={{ mb: 2 }}
        />

        <TextField
          label={t('shopifyListings.description')}
          fullWidth
          multiline
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
          <TextField
            label={t('shopifyListings.vendor')}
            fullWidth
            value={vendor}
            onChange={(e) => setVendor(e.target.value)}
          />
          <TextField
            label={t('shopifyListings.productType')}
            fullWidth
            value={productType}
            onChange={(e) => setProductType(e.target.value)}
          />
        </Box>

        <TextField
          label={t('shopifyListings.tags')}
          fullWidth
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          helperText={t('shopifyListings.tagsHelp')}
          sx={{ mb: 2 }}
        />

        <FormControl fullWidth sx={{ mb: 2 }}>
          <InputLabel>{t('shopifyListings.status')}</InputLabel>
          <Select value={status} label={t('shopifyListings.status')} onChange={(e) => setStatus(e.target.value)}>
            <MenuItem value="active">{t('shopifyListings.active')}</MenuItem>
            <MenuItem value="draft">{t('shopifyListings.draft')}</MenuItem>
            <MenuItem value="archived">{t('shopifyListings.archived')}</MenuItem>
          </Select>
        </FormControl>

        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('shopifyListings.seo')}</Typography>

        <TextField
          label={t('shopifyListings.seoTitle')}
          fullWidth
          value={seoTitle}
          onChange={(e) => setSeoTitle(e.target.value)}
          sx={{ mb: 2 }}
        />

        <TextField
          label={t('shopifyListings.seoDescription')}
          fullWidth
          multiline
          rows={2}
          value={seoDescription}
          onChange={(e) => setSeoDescription(e.target.value)}
          sx={{ mb: 2 }}
        />

        {/* Variants section */}
        {product?.variants && (product.variants as any[]).length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            <Typography variant="subtitle2" sx={{ mb: 1 }}>
              {t('shopifyListings.variants')} ({(product.variants as any[]).length})
            </Typography>
            {(product.variants as any[]).map((v: any, i: number) => (
              <Paper key={v.id || i} variant="outlined" sx={{ p: 1.5, mb: 1 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">
                    {[v.option1, v.option2, v.option3].filter(Boolean).join(' / ') || `Variant ${i + 1}`}
                  </Typography>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="body2" fontWeight="bold">
                      {formatPrice(parseFloat(v.price), product.currency)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      SKU: {v.sku || '—'} | Qty: {v.inventory_quantity ?? '—'}
                    </Typography>
                  </Box>
                </Box>
              </Paper>
            ))}
          </>
        )}

        <Box sx={{ mt: 3, display: 'flex', gap: 2 }}>
          <Button
            variant="contained"
            startIcon={saving ? <CircularProgress size={18} color="inherit" /> : <SaveIcon />}
            onClick={handleSave}
            disabled={saving}
            fullWidth
            sx={{ bgcolor: SHOPIFY_GREEN, '&:hover': { bgcolor: '#7ea33e' } }}
          >
            {saving ? t('shopifyListings.saving') : t('shopifyListings.save')}
          </Button>
          <Button variant="outlined" onClick={onClose} fullWidth>
            {t('shopifyListings.cancel')}
          </Button>
        </Box>
      </Box>
    </Drawer>
  );
}

export default withAuth(ShopifyProductsPage);
