import React, { useState, useMemo, useEffect, useCallback, lazy, Suspense } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  Tooltip,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Typography,
  Paper,
  Chip,
  InputAdornment,
  Menu,
  ListItemIcon,
  ListItemText,
  Checkbox,
  useMediaQuery,
  useTheme,
  Badge,
} from '@mui/material';
import {
  DataGrid,
  GridColDef,
  GridPaginationModel,
  GridRenderCellParams,
  GridRowSelectionModel,
} from '@mui/x-data-grid';
import {
  Refresh as RefreshIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Archive as ArchiveIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Add as AddIcon,
  MoreVert as MoreVertIcon,
  FindReplace as FindReplaceIcon,
  FileDownload as FileDownloadIcon,
  FileUpload as FileUploadIcon,
  PriceChange as PriceChangeIcon,
  Inventory as InventoryIcon,
  Close as CloseIcon,
  UnfoldMore as UnfoldMoreIcon,
  UnfoldLess as UnfoldLessIcon,
} from '@mui/icons-material';
import { toast, Toaster } from 'react-hot-toast';
import AppLayout from '@/components/AppLayout';
import withAuth from '@/components/withAuth';
import { useAuth } from '@/lib/auth-context';
import { useTranslations } from 'next-intl';
import TrendyolListingEditorDrawer from '@/components/trendyol/listings/TrendyolListingEditorDrawer';

// Lazy load heavy components
const TrendyolBulkOpsBar = lazy(() => import('@/components/trendyol/listings/TrendyolBulkOpsBar'));
const TrendyolFindReplace = lazy(() => import('@/components/trendyol/listings/TrendyolFindReplace'));
const TrendyolBackupManager = lazy(() => import('@/components/trendyol/listings/TrendyolBackupManager'));

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TrendyolProductRow {
  id: string;
  barcode: string;
  stockCode: string;
  productMainId: string;
  trendyolId: string;
  title: string;
  description: string;
  brandId: number;
  brandName: string;
  categoryId: number;
  categoryName: string;
  listPrice: any;
  salePrice: any;
  currencyType: string;
  quantity: number;
  vatRate: number;
  images: { url: string }[];
  thumbnailUrl: string;
  imageCount: number;
  attributes: any[];
  approved: boolean;
  onSale: boolean;
  rejected: boolean;
  blacklisted: boolean;
  archived: boolean;
  rejectReasons: any[];
  dimensionalWeight: number;
  cargoCompanyId: number;
  syncedAt: string;
  createdAt: string;
  updatedAt: string;
  // Virtual fields for grouped rows
  _isGroupParent?: boolean;
  _variantCount?: number;
  _variants?: TrendyolProductRow[];
  _expanded?: boolean;
}

type StatusFilter = 'all' | 'approved' | 'onSale' | 'rejected' | 'archived' | 'pending';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRENDYOL_ORANGE = '#F27A1A';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatPrice(value: any): string {
  if (value == null) return '\u2014';
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (isNaN(num)) return '\u2014';
  return `\u20ba${num.toFixed(2)}`;
}

function getProductStatus(product: TrendyolProductRow): StatusFilter {
  if (product.archived) return 'archived';
  if (product.rejected) return 'rejected';
  if (product.approved && product.onSale) return 'onSale';
  if (product.approved) return 'approved';
  return 'pending';
}

function getStatusColor(status: StatusFilter): 'success' | 'info' | 'error' | 'default' | 'warning' {
  switch (status) {
    case 'onSale': return 'success';
    case 'approved': return 'info';
    case 'rejected': return 'error';
    case 'archived': return 'default';
    case 'pending': return 'warning';
    default: return 'default';
  }
}

// ---------------------------------------------------------------------------
// Health Score (100 points, 10 factors)
// ---------------------------------------------------------------------------

interface HealthResult {
  overall: number;
  grade: string;
  color: string;
  factors: { label: string; score: number; max: number }[];
}

function calculateTrendyolHealth(product: TrendyolProductRow): HealthResult {
  const titleLen = product.title?.length || 0;
  const titleLength = titleLen >= 80 && titleLen <= 150 ? 15 : titleLen >= 60 ? 10 : titleLen >= 40 ? 5 : 0;

  const brandLower = (product.brandName || '').toLowerCase();
  const titleLower = (product.title || '').toLowerCase();
  const titleBrand = brandLower && titleLower.includes(brandLower) ? 5 : 0;

  const catWords = (product.categoryName || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
  const titleCategory = catWords.length > 0 && catWords.some(w => titleLower.includes(w)) ? 5 : 0;

  const imgCount = product.imageCount || product.images?.length || 0;
  const images = imgCount >= 5 ? 20 : imgCount * 4;

  const descLen = product.description?.length || 0;
  const description = descLen >= 300 ? 15 : descLen >= 200 ? 10 : descLen >= 100 ? 5 : 0;

  const attrCount = product.attributes?.length || 0;
  const attributes = attrCount >= 5 ? 15 : attrCount >= 3 ? 12 : attrCount >= 1 ? 8 : 0;

  const lp = parseFloat(String(product.listPrice)) || 0;
  const sp = parseFloat(String(product.salePrice)) || 0;
  const priceSanity = sp > 0 && lp > sp ? 10 : sp > 0 && lp === sp ? 5 : 0;

  const stock = (product.quantity || 0) > 0 ? 5 : 0;
  const notRejected = product.approved && !product.rejected ? 5 : 0;
  const dimWeight = product.dimensionalWeight ? 5 : 0;

  const overall = titleLength + titleBrand + titleCategory + images + description + attributes + priceSanity + stock + notRejected + dimWeight;

  const grade = overall >= 95 ? 'A+' : overall >= 85 ? 'A' : overall >= 75 ? 'B+' : overall >= 65 ? 'B' : overall >= 55 ? 'C+' : overall >= 45 ? 'C' : overall >= 35 ? 'D' : 'F';
  const color = grade.startsWith('A') ? '#4caf50' : grade.startsWith('B') ? '#8bc34a' : grade.startsWith('C') ? '#ff9800' : grade.startsWith('D') ? '#ff5722' : '#f44336';

  return {
    overall, grade, color,
    factors: [
      { label: 'Title', score: titleLength, max: 15 },
      { label: 'Brand in title', score: titleBrand, max: 5 },
      { label: 'Category words', score: titleCategory, max: 5 },
      { label: 'Images', score: images, max: 20 },
      { label: 'Description', score: description, max: 15 },
      { label: 'Attributes', score: attributes, max: 15 },
      { label: 'Discount', score: priceSanity, max: 10 },
      { label: 'Stock', score: stock, max: 5 },
      { label: 'Approved', score: notRejected, max: 5 },
      { label: 'Weight', score: dimWeight, max: 5 },
    ],
  };
}

// ---------------------------------------------------------------------------
// Variation Grouping
// ---------------------------------------------------------------------------

function groupByVariations(products: TrendyolProductRow[], expandedGroups: Set<string>): TrendyolProductRow[] {
  const groups = new Map<string, TrendyolProductRow[]>();
  const standalone: TrendyolProductRow[] = [];

  for (const p of products) {
    if (p.productMainId) {
      const existing = groups.get(p.productMainId);
      if (existing) existing.push(p);
      else groups.set(p.productMainId, [p]);
    } else {
      standalone.push(p);
    }
  }

  const result: TrendyolProductRow[] = [];

  for (const [mainId, variants] of groups) {
    if (variants.length === 1) {
      // Single variant — show as regular row
      result.push(variants[0]);
    } else {
      // Group parent: use first variant as representative
      const parent = { ...variants[0], _isGroupParent: true, _variantCount: variants.length, _variants: variants };
      result.push(parent);
      if (expandedGroups.has(mainId)) {
        for (const v of variants) {
          result.push({ ...v, _expanded: true });
        }
      }
    }
  }

  result.push(...standalone);
  return result;
}

// ---------------------------------------------------------------------------
// Mobile Card Component
// ---------------------------------------------------------------------------

function MobileTrendyolCard({
  product, onEdit, selected, onToggleSelect, t,
}: {
  product: TrendyolProductRow;
  onEdit: (id: string) => void;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  t: (key: string, values?: Record<string, any>) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const health = calculateTrendyolHealth(product);
  const status = getProductStatus(product);
  const lp = parseFloat(String(product.listPrice)) || 0;
  const sp = parseFloat(String(product.salePrice)) || 0;
  const discountPct = lp > 0 && sp > 0 && lp > sp ? Math.round((1 - sp / lp) * 100) : 0;

  return (
    <Paper
      sx={{
        mb: 1, overflow: 'hidden', borderRadius: 2, maxWidth: '100%', width: '100%',
        border: selected ? '2px solid' : '1px solid',
        borderColor: selected ? TRENDYOL_ORANGE : 'divider',
      }}
    >
      <Box sx={{ display: 'flex', gap: 1, p: 1.5, cursor: 'pointer', alignItems: 'center', minHeight: 44 }}
        onClick={() => setExpanded(!expanded)}
      >
        <Checkbox checked={selected}
          onChange={(e) => { e.stopPropagation(); onToggleSelect(product.id); }}
          onClick={e => e.stopPropagation()}
          size="small" sx={{ p: 0.5, flexShrink: 0, '&.Mui-checked': { color: TRENDYOL_ORANGE } }}
        />
        {product.thumbnailUrl ? (
          <Box component="img" src={product.thumbnailUrl} alt=""
            sx={{ width: 52, height: 52, objectFit: 'cover', borderRadius: 1, flexShrink: 0 }}
          />
        ) : (
          <Box sx={{ width: 52, height: 52, borderRadius: 1, bgcolor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Typography variant="caption" color="text.disabled">N/A</Typography>
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: 1.3, fontSize: '0.82rem' }}>
            {product._isGroupParent && <Badge badgeContent={product._variantCount} color="primary" sx={{ mr: 1 }} />}
            {product.title}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 0.25, flexWrap: 'wrap' }}>
            <Typography variant="body2" fontWeight={600} fontSize="0.82rem">{formatPrice(product.salePrice)}</Typography>
            {discountPct > 0 && (
              <Chip label={`-${discountPct}%`} size="small" sx={{ height: 16, fontSize: 9, bgcolor: '#4caf5015', color: '#4caf50', fontWeight: 700 }} />
            )}
            <Chip label={t(status)} size="small" color={getStatusColor(status)} variant="outlined"
              sx={{ height: 18, fontSize: 10, '& .MuiChip-label': { px: 0.5 } }}
            />
            <Chip label={health.grade} size="small"
              sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: `${health.color}15`, color: health.color, border: `1px solid ${health.color}`, '& .MuiChip-label': { px: 0.5 } }}
            />
          </Box>
        </Box>
        <IconButton size="small" sx={{ flexShrink: 0, minWidth: 40, minHeight: 40 }}>
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ px: 1.5, pb: 1.5, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.5 }}>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('brand')}</Typography>
              <Typography variant="body2">{product.brandName || '\u2014'}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('category')}</Typography>
              <Typography variant="body2">{product.categoryName || '\u2014'}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('barcode')}</Typography>
              <Typography variant="body2" sx={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>{product.barcode || '\u2014'}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('listPrice')}</Typography>
              <Typography variant="body2">{formatPrice(product.listPrice)}</Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('quantity')}</Typography>
              <Typography variant="body2" sx={{ color: product.quantity === 0 ? '#f44336' : 'inherit', fontWeight: product.quantity === 0 ? 700 : 400 }}>
                {product.quantity}
              </Typography>
            </Box>
            <Box sx={{ flex: '1 1 45%' }}>
              <Typography variant="caption" color="text.secondary">{t('healthScore')}</Typography>
              <Typography variant="body2" sx={{ color: health.color, fontWeight: 700 }}>
                {health.grade} ({health.overall}/100)
              </Typography>
            </Box>
          </Box>
          {product.rejected && product.rejectReasons?.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography variant="caption" color="error" fontWeight={600}>{t('rejectReason')}:</Typography>
              {product.rejectReasons.map((r: any, i: number) => (
                <Typography key={i} variant="caption" color="error" display="block" sx={{ ml: 1 }}>
                  {typeof r === 'string' ? r : r.reason || JSON.stringify(r)}
                </Typography>
              ))}
            </Box>
          )}
          <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
            <Button size="small" variant="contained"
              startIcon={<EditIcon sx={{ fontSize: '16px !important' }} />}
              onClick={e => { e.stopPropagation(); onEdit(product.id); }}
              sx={{ flex: 1, minHeight: 42, borderRadius: '10px', textTransform: 'none', fontWeight: 600, fontSize: '0.8rem', background: `linear-gradient(135deg, ${TRENDYOL_ORANGE}, #e06a10)` }}
            >
              {t('editProduct')}
            </Button>
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

function TrendyolListingsPage() {
  const t = useTranslations('trendyolListings');
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  // State
  const [products, setProducts] = useState<TrendyolProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerProductId, setDrawerProductId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paginationModel, setPaginationModel] = useState<GridPaginationModel>({ page: 0, pageSize: 25 });
  const [toolsMenuAnchor, setToolsMenuAnchor] = useState<null | HTMLElement>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [findReplaceOpen, setFindReplaceOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  // ---------------------------------------------------------------------------
  // Fetch Products
  // ---------------------------------------------------------------------------

  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      const cacheRes = await fetch('/api/trendyol/products?action=list&fromCache=true&size=500');
      if (cacheRes.ok) {
        const cacheData = await cacheRes.json();
        const cached = Array.isArray(cacheData?.content) ? cacheData.content : [];
        if (cached.length > 0) {
          setProducts(cached);
          setLoading(false);
          return;
        }
      }
      const apiRes = await fetch('/api/trendyol/products?action=list&size=200');
      if (!apiRes.ok) {
        const errData = await apiRes.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${apiRes.status}`);
      }
      const apiData = await apiRes.json();
      setProducts(Array.isArray(apiData?.content) ? apiData.content : []);
    } catch (err: any) {
      console.error('Failed to fetch Trendyol products:', err);
      if (err.message?.includes('credentials')) toast.error(t('connectTrendyol'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  // ---------------------------------------------------------------------------
  // Sync
  // ---------------------------------------------------------------------------

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/trendyol/products?action=sync', { method: 'POST' });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      toast.success(`${t('syncComplete')} (${data.totalSynced || 0})`);
      const cacheRes = await fetch('/api/trendyol/products?action=list&fromCache=true&size=500');
      if (cacheRes.ok) {
        const cacheData = await cacheRes.json();
        setProducts(Array.isArray(cacheData?.content) ? cacheData.content : []);
      }
    } catch (err: any) {
      toast.error(`${t('syncFailed')}: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Filtering + Variation Grouping
  // ---------------------------------------------------------------------------

  const filteredProducts = useMemo(() => {
    let result = products;
    if (statusFilter !== 'all') {
      result = result.filter(p => getProductStatus(p) === statusFilter);
    }
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase().trim();
      result = result.filter(p =>
        p.title?.toLowerCase().includes(term) ||
        p.barcode?.toLowerCase().includes(term) ||
        p.brandName?.toLowerCase().includes(term) ||
        p.stockCode?.toLowerCase().includes(term)
      );
    }
    return result;
  }, [products, statusFilter, searchTerm]);

  const displayProducts = useMemo(() =>
    groupByVariations(filteredProducts, expandedGroups),
    [filteredProducts, expandedGroups]
  );

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectionModelChange = (model: GridRowSelectionModel) => {
    if ('ids' in model) {
      setSelectedIds(new Set(Array.from(model.ids).map(String)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const selectedProducts = useMemo(() =>
    products.filter(p => selectedIds.has(p.id)),
    [products, selectedIds]
  );

  // ---------------------------------------------------------------------------
  // Toggle variant group expansion
  // ---------------------------------------------------------------------------

  const toggleGroup = (mainId: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(mainId)) next.delete(mainId);
      else next.add(mainId);
      return next;
    });
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleEdit = (id: string) => {
    setDrawerProductId(id);
    setDrawerOpen(true);
  };

  // Get sibling variants for the editor drawer
  const drawerSiblings = useMemo(() => {
    if (!drawerProductId) return [];
    const product = products.find(p => p.id === drawerProductId);
    if (!product?.productMainId) return [];
    return products.filter(p => p.productMainId === product.productMainId);
  }, [drawerProductId, products]);

  // ---------------------------------------------------------------------------
  // DataGrid Columns
  // ---------------------------------------------------------------------------

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'thumbnail', headerName: '', width: 60, sortable: false, filterable: false,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' }}>
            {params.row.thumbnailUrl ? (
              <Box component="img" src={params.row.thumbnailUrl} alt=""
                sx={{ width: 42, height: 42, objectFit: 'cover', borderRadius: 1 }}
              />
            ) : (
              <Box sx={{ width: 42, height: 42, borderRadius: 1, bgcolor: '#e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Typography variant="caption" color="text.disabled">N/A</Typography>
              </Box>
            )}
          </Box>
        ),
      },
      {
        field: 'title', headerName: 'Title', flex: 1, minWidth: 200,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
            {params.row._isGroupParent && (
              <IconButton size="small" onClick={e => { e.stopPropagation(); toggleGroup(params.row.productMainId); }}
                sx={{ p: 0.25 }}
              >
                {expandedGroups.has(params.row.productMainId) ? <UnfoldLessIcon sx={{ fontSize: 16 }} /> : <UnfoldMoreIcon sx={{ fontSize: 16 }} />}
              </IconButton>
            )}
            {params.row._expanded && <Box sx={{ width: 20, flexShrink: 0 }} />}
            <Tooltip title={params.row.title} arrow>
              <Typography variant="body2"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500, cursor: 'pointer', '&:hover': { color: TRENDYOL_ORANGE } }}
                onClick={() => handleEdit(params.row.id)}
              >
                {params.row.title}
              </Typography>
            </Tooltip>
            {params.row._isGroupParent && params.row._variantCount && params.row._variantCount > 1 && (
              <Chip label={`${params.row._variantCount} var`} size="small"
                sx={{ height: 18, fontSize: 9, fontWeight: 700, bgcolor: '#e3f2fd', color: '#1976d2' }}
              />
            )}
          </Box>
        ),
      },
      { field: 'brandName', headerName: t('brand'), width: 110 },
      { field: 'barcode', headerName: t('barcode'), width: 130 },
      {
        field: 'listPrice', headerName: t('listPrice'), width: 95, align: 'right', headerAlign: 'right',
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Typography variant="body2" color="text.secondary">{formatPrice(params.row.listPrice)}</Typography>
        ),
      },
      {
        field: 'salePrice', headerName: t('salePrice'), width: 95, align: 'right', headerAlign: 'right',
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Typography variant="body2" fontWeight={600}>{formatPrice(params.row.salePrice)}</Typography>
        ),
      },
      {
        field: 'discount', headerName: '%', width: 55, align: 'center', headerAlign: 'center', sortable: true,
        valueGetter: (_: any, row: TrendyolProductRow) => {
          const lp = parseFloat(String(row.listPrice)) || 0;
          const sp = parseFloat(String(row.salePrice)) || 0;
          return lp > 0 && sp > 0 && lp > sp ? Math.round((1 - sp / lp) * 100) : 0;
        },
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => {
          const lp = parseFloat(String(params.row.listPrice)) || 0;
          const sp = parseFloat(String(params.row.salePrice)) || 0;
          const pct = lp > 0 && sp > 0 && lp > sp ? Math.round((1 - sp / lp) * 100) : 0;
          return pct > 0 ? (
            <Chip label={`-${pct}%`} size="small"
              sx={{ height: 20, fontSize: 10, fontWeight: 700, bgcolor: '#4caf5015', color: '#4caf50', border: '1px solid #4caf50' }}
            />
          ) : <Typography variant="caption" color="text.disabled">—</Typography>;
        },
      },
      {
        field: 'quantity', headerName: t('quantity'), width: 70, align: 'center', headerAlign: 'center',
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Chip label={params.row.quantity} size="small"
            color={params.row.quantity > 0 ? (params.row.quantity < 5 ? 'warning' : 'default') : 'error'}
            variant="outlined" sx={{ minWidth: 36, fontWeight: params.row.quantity === 0 ? 700 : 400 }}
          />
        ),
      },
      {
        field: 'status', headerName: t('filterByStatus'), width: 100, sortable: false,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => {
          const status = getProductStatus(params.row);
          return <Chip label={t(status)} size="small" color={getStatusColor(status)} variant="filled" sx={{ fontWeight: 600, fontSize: 11 }} />;
        },
      },
      {
        field: 'health', headerName: t('healthScore'), width: 80, align: 'center', headerAlign: 'center', sortable: true,
        valueGetter: (_: any, row: TrendyolProductRow) => calculateTrendyolHealth(row).overall,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => {
          const health = calculateTrendyolHealth(params.row);
          return (
            <Tooltip arrow title={
              <Box sx={{ fontSize: '0.7rem' }}>
                {health.factors.map((f, i) => (
                  <Box key={i}>{f.label}: {f.score}/{f.max}</Box>
                ))}
                <Box sx={{ mt: 0.5, fontWeight: 700 }}>Total: {health.overall}/100</Box>
              </Box>
            }>
              <Chip label={health.grade} size="small"
                sx={{ fontWeight: 700, bgcolor: `${health.color}15`, color: health.color, border: `1px solid ${health.color}`, minWidth: 36 }}
              />
            </Tooltip>
          );
        },
      },
      {
        field: 'actions', headerName: '', width: 60, sortable: false, filterable: false,
        renderCell: (params: GridRenderCellParams<TrendyolProductRow>) => (
          <Tooltip title={t('editProduct')}>
            <IconButton size="small" onClick={() => handleEdit(params.row.id)} sx={{ color: TRENDYOL_ORANGE }}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ),
      },
    ],
    [t, expandedGroups]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <AppLayout title={t('title')}>
      <Toaster position="top-right" />
      <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
        {/* Toolbar */}
        <Paper sx={{ p: { xs: 1.5, md: 2 }, mb: 2, borderRadius: 2, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <TextField size="small" placeholder={t('searchProducts')} value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon sx={{ fontSize: 20, color: 'text.secondary' }} /></InputAdornment> }}
            sx={{ flex: '1 1 200px', minWidth: 180 }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>{t('filterByStatus')}</InputLabel>
            <Select value={statusFilter} label={t('filterByStatus')} onChange={e => setStatusFilter(e.target.value as StatusFilter)}>
              <MenuItem value="all">{t('all')}</MenuItem>
              <MenuItem value="approved">{t('approved')}</MenuItem>
              <MenuItem value="onSale">{t('onSale')}</MenuItem>
              <MenuItem value="rejected">{t('rejected')}</MenuItem>
              <MenuItem value="archived">{t('archived')}</MenuItem>
              <MenuItem value="pending">{t('pending')}</MenuItem>
            </Select>
          </FormControl>
          <Button variant="contained"
            startIcon={syncing ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
            onClick={handleSync} disabled={syncing}
            sx={{ textTransform: 'none', fontWeight: 600, bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#e06a10' }, minWidth: 100 }}
          >
            {syncing ? t('syncing') : t('sync')}
          </Button>
          {/* Tools Menu */}
          <IconButton onClick={e => setToolsMenuAnchor(e.currentTarget)}
            sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5 }}
          >
            <MoreVertIcon />
          </IconButton>
          <Menu anchorEl={toolsMenuAnchor} open={Boolean(toolsMenuAnchor)} onClose={() => setToolsMenuAnchor(null)}>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setFindReplaceOpen(true); }}>
              <ListItemIcon><FindReplaceIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('findReplace')}</ListItemText>
            </MenuItem>
            <MenuItem onClick={() => { setToolsMenuAnchor(null); setBackupOpen(true); }}>
              <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>
              <ListItemText>{t('backup')}</ListItemText>
            </MenuItem>
          </Menu>
        </Paper>

        {/* Summary bar */}
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip label={`${filteredProducts.length} ${t('title').toLowerCase()}`} size="small" sx={{ fontWeight: 600 }} />
          {statusFilter !== 'all' && (
            <Chip label={t(statusFilter)} size="small" color="primary" onDelete={() => setStatusFilter('all')} sx={{ fontWeight: 600 }} />
          )}
        </Box>

        {/* Content */}
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 300 }}>
            <CircularProgress sx={{ color: TRENDYOL_ORANGE }} />
          </Box>
        ) : filteredProducts.length === 0 ? (
          <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 2 }}>
            <InventoryIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
            <Typography variant="h6" color="text.secondary" gutterBottom>{t('noProducts')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>{t('connectTrendyol')}</Typography>
            <Button variant="contained" startIcon={<RefreshIcon />} onClick={handleSync}
              sx={{ bgcolor: TRENDYOL_ORANGE, '&:hover': { bgcolor: '#e06a10' } }}
            >
              {t('sync')}
            </Button>
          </Paper>
        ) : isMobile ? (
          <Box>
            {displayProducts.map(product => (
              <MobileTrendyolCard key={product.id + (product._expanded ? '_exp' : '')}
                product={product} onEdit={handleEdit} selected={selectedIds.has(product.id)}
                onToggleSelect={handleToggleSelect} t={t}
              />
            ))}
          </Box>
        ) : (
          <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
            <DataGrid
              rows={displayProducts}
              columns={columns}
              checkboxSelection
              disableRowSelectionOnClick
              rowSelectionModel={{ type: 'include' as const, ids: new Set(selectedIds) }}
              onRowSelectionModelChange={handleSelectionModelChange}
              paginationModel={paginationModel}
              onPaginationModelChange={setPaginationModel}
              pageSizeOptions={[10, 25, 50, 100]}
              rowHeight={56}
              getRowId={row => row.id + (row._expanded ? '_exp' : '')}
              sx={{
                border: 'none',
                '& .MuiDataGrid-columnHeaders': { bgcolor: '#fafafa', borderBottom: '2px solid', borderColor: 'divider' },
                '& .MuiDataGrid-row:hover': { bgcolor: `${TRENDYOL_ORANGE}05` },
                '& .MuiDataGrid-cell': { borderColor: '#f0f0f0' },
                '& .MuiCheckbox-root.Mui-checked': { color: TRENDYOL_ORANGE },
              }}
              autoHeight
            />
          </Paper>
        )}

        {/* Bulk Operations Bar */}
        {selectedIds.size > 0 && (
          <Suspense fallback={null}>
            <TrendyolBulkOpsBar
              selectedProducts={selectedProducts}
              onClearSelection={clearSelection}
              onRefresh={fetchProducts}
              allProducts={products}
            />
          </Suspense>
        )}
      </Box>

      {/* Editor Drawer */}
      <TrendyolListingEditorDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerProductId(null); }}
        productId={drawerProductId}
        onSaved={() => { setDrawerOpen(false); setDrawerProductId(null); fetchProducts(); }}
        siblingProducts={drawerSiblings}
      />

      {/* Find & Replace Dialog */}
      <Suspense fallback={null}>
        {findReplaceOpen && (
          <TrendyolFindReplace
            open={findReplaceOpen}
            onClose={() => setFindReplaceOpen(false)}
            products={products}
            onRefresh={fetchProducts}
          />
        )}
      </Suspense>

      {/* Backup Manager Dialog */}
      <Suspense fallback={null}>
        {backupOpen && (
          <TrendyolBackupManager
            open={backupOpen}
            onClose={() => setBackupOpen(false)}
            products={products}
            onRefresh={fetchProducts}
          />
        )}
      </Suspense>
    </AppLayout>
  );
}

export default withAuth(TrendyolListingsPage);
